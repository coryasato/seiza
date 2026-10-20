/**
 * The contender slot: one contender at a time, in a same-origin frame, with
 * the GPUI | TanStack toggle above it (root `CLAUDE.md`, "Comparison
 * protocol"). A flip destroys the frame and creates the other side's, never
 * hides it; the toggle stays disabled until the side shown paints its first
 * rows (its `contender:filled`, relayed by `postMessage`) or says it failed
 * (`contender:failed`), so a flip never lands mid-load and a failure never
 * locks it. The first frame is created after the page's first paint. The
 * page's theme goes in as `?theme=` and, live, as a message, so a toggle
 * never reloads the frame; the frame's `load` sends it again, for a change
 * made before the contender was listening.
 */

import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@seiza/site-ui/components/toggle-group';
import { currentTheme, onThemeChange } from '@seiza/site-ui/theme';
import { MARKS, type Side, type ThemeMessage } from '../../contenders/contract.ts';
import { SIDE_PARAM, type Component, type Contender } from './components.ts';
import { frameMark, trackFrame } from './live.ts';
import { loadMetrics } from './metrics.ts';
import { afterFirstPaint } from './paint.ts';

/** The marks a contender relays to its parent (`publishContender`). */
interface MarkMessage {
  seiza: 'mark';
  name: string;
  /** Epoch ms. */
  at: number;
}

/** The side `?side=` names, or the first contender's. */
function firstSide(component: Component): Side {
  const named = new URLSearchParams(location.search).get(SIDE_PARAM);
  return component.contenders.find((contender) => contender.side === named)?.side ?? component.contenders[0].side;
}

/** A series' dot: each side's color, beside its name (never instead). */
export const seriesDot = (side: Side) => h('span', { className: `size-2 shrink-0 rounded-full ${side === 'gpui' ? 'bg-series-gpui' : 'bg-series-tanstack'}`, 'aria-hidden': true });

/** The shown contender: still loading, its first rows painted, or failed. */
type FrameState = 'loading' | 'filled' | 'failed';

/** Sends the page's theme to a contender's frame. */
function sendTheme(frame: HTMLIFrameElement | null, theme = currentTheme()): void {
  const message: ThemeMessage = { seiza: 'theme', theme };
  frame?.contentWindow?.postMessage(message, location.origin);
}

export function ContenderSlot({ component }: { component: Component }) {
  // Null until hydrated: the prerendered HTML can't know `?side=`, and the
  // frame waits for the page's first paint anyway.
  const [side, setSide] = useState<Side | null>(null);
  const [painted, setPainted] = useState(false);
  /** Each frame's number: a flip makes a new one (React's key). */
  const [frame, setFrame] = useState(0);
  const [state, setState] = useState<FrameState>('loading');
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setSide(firstSide(component));
    afterFirstPaint(() => {
      setPainted(true);
      void loadMetrics();
    });
  }, [component]);

  // The shown frame's marks: only its own, and only from this origin.
  useEffect(() => {
    const listen = (event: MessageEvent<Partial<MarkMessage>>) => {
      if (event.origin !== location.origin || event.source !== ref.current?.contentWindow) return;
      if (event.data?.seiza !== 'mark') return;
      if (typeof event.data.name === 'string' && typeof event.data.at === 'number') frameMark(event.source, event.data.name, event.data.at);
      if (event.data.name === MARKS.filled) setState('filled');
      else if (event.data.name === MARKS.failed) setState((state) => (state === 'filled' ? state : 'failed'));
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  // The page's theme, live.
  useEffect(() => onThemeChange((theme) => sendTheme(ref.current, theme)), []);

  const shown = component.contenders.find((contender) => contender.side === side) ?? null;
  // Once per frame: a later theme goes in by message, and a changed `src`
  // would reload the frame.
  const src = useMemo(() => (shown && painted ? `${shown.url}?theme=${currentTheme()}` : null), [shown, painted, frame]);
  // This tab's readouts follow each frame from its creation (`live.ts`).
  useEffect(() => {
    if (shown && src && ref.current) trackFrame(shown.side, ref.current, shown.url);
  }, [src]);
  const flip = (next: Side) => {
    if (next === side) return;
    setSide(next);
    setState('loading');
    setFrame((frame) => frame + 1);
    const url = new URL(location.href);
    url.searchParams.set(SIDE_PARAM, next);
    history.replaceState(history.state, '', url);
  };

  return h(
    'section',
    { className: 'flex flex-1 flex-col overflow-hidden border-b bg-card md:rounded-xl md:border md:shadow-xs', 'aria-label': `${component.label}: the contenders` },
    h(
      'div',
      { className: 'flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2.5' },
      h(
        ToggleGroup,
        {
          variant: 'segmented',
          value: side ? [side] : [],
          onValueChange: (value: string[]) => {
            const next = component.contenders.find((contender) => contender.side === value[0]);
            if (next) flip(next.side);
          },
          disabled: state === 'loading',
          'aria-label': 'Contender',
        },
        ...component.contenders.map((contender) => h(ToggleGroupItem, { key: contender.side, value: contender.side, className: 'gap-2 px-3' }, seriesDot(contender.side), contender.label)),
      ),
      h('p', { className: 'text-[13px] text-muted-foreground', 'aria-live': 'polite' }, status(shown, painted, state)),
    ),
    h(
      'div',
      { className: 'relative min-h-[480px] flex-1' },
      shown && src
        ? h('iframe', {
            key: frame,
            ref,
            src,
            onLoad: () => sendTheme(ref.current),
            title: `${component.label}: the ${shown.label} contender`,
            className: 'absolute inset-0 size-full border-0',
          })
        : null,
    ),
    // The GPUI side's limits on a phone, where a visitor meets them (root
    // CLAUDE.md, rule 4; the README's "Canvas tradeoffs").
    shown?.side === 'gpui'
      ? h(
          'p',
          { className: 'hidden border-t px-3 py-2 text-xs text-muted-foreground pointer-coarse:block' },
          "On touch, GPUI's table scrolls one axis per swipe. DevTools' device mode draws it zoomed: Chromium's emulation, not a real phone.",
        )
      : null,
  );
}

function status(shown: Contender | null, painted: boolean, state: FrameState): string {
  if (!shown || !painted) return 'The contender loads once this page has painted.';
  if (state === 'loading') return `Loading ${shown.label}…`;
  if (state === 'failed') return `The ${shown.label} contender didn't load its data: its frame says why.`;
  return `${shown.label} is loaded. Switching destroys this frame and loads the other.`;
}
