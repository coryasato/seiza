/**
 * The contender's window (`docs/DECISIONS.md`, "Page"): one contender at a
 * time, in a same-origin frame (root `CLAUDE.md`, "Comparison protocol"),
 * between a title bar and a status bar. The title bar holds the GPUI |
 * TanStack toggle, the side's state (the page's only `aria-live` text,
 * changed only by a load, never by a scroll) and its explainer, and the
 * lead; the status bar every number and the panel's button. The window is
 * fixed in size: resizing it would change the rows on screen, and so the
 * numbers.
 *
 * A flip destroys the frame and creates the other side's, never hides it;
 * the toggle stays disabled until the side shown paints its first rows (its
 * `contender:filled`, relayed by `postMessage`) or says it failed
 * (`contender:failed`), so a flip never lands mid-load and a failure never
 * locks it. The first frame is created after the page's first paint. The
 * page's theme goes in as `?theme=` and, live, as a message, so a toggle
 * never reloads the frame; the frame's `load` sends it again, for a change
 * made before the contender was listening.
 *
 * The status bar's box is in the prerendered HTML (`page.css`'s
 * `.observatory-status`), its contents rendered after first paint with the
 * panel's code (`numbers.ts`), so nothing shifts when they arrive. The
 * meter (`meter.ts`) sits over the frame, after first paint too, hidden
 * while the panel is open.
 */

import { Info } from 'lucide-react';
import { createElement as h, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@seiza/site-ui/components/toggle-group';
import { currentTheme, onThemeChange } from '@seiza/site-ui/theme';
import rows from 'virtual:data-rows';
import { MARKS, type Side, type ThemeMessage } from '../../contenders/contract.ts';
import { millions, SIDE_PARAM, type Component, type Contender } from './components.ts';
import { Explainer } from './explainer.ts';
import { frameMark, isWarm, trackFrame } from './live.ts';
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

/** The shown contender: its engine starting, its data loading (`contender:open`), its first rows painted, or failed. */
type FrameState = 'engine' | 'data' | 'filled' | 'failed';

/** The panel's id, for the status bar's Compare (`aria-controls`). */
export const PANEL_ID = 'observatory-panel';

/** The status bar's contents, the panel, and the meter: the numbers' chunk, after first paint. */
const StatusBar = lazy(() => import('./numbers.ts').then(({ StatusBar }) => ({ default: StatusBar })));
const Panel = lazy(() => import('./numbers.ts').then(({ Panel }) => ({ default: Panel })));
const Meter = lazy(() => import('./numbers.ts').then(({ Meter }) => ({ default: Meter })));

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
  const [state, setState] = useState<FrameState>('engine');
  const [panel, setPanel] = useState(false);
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
      // A state changes only on a load: a scroll's filled marks set the same one.
      if (event.data.name === MARKS.filled) setState('filled');
      else if (event.data.name === MARKS.open) setState((state) => (state === 'engine' ? 'data' : state));
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
    setState('engine');
    setFrame((frame) => frame + 1);
    const url = new URL(location.href);
    url.searchParams.set(SIDE_PARAM, next);
    history.replaceState(history.state, '', url);
  };
  // The panel's close and Esc: back to the table.
  const closePanel = () => {
    setPanel(false);
    ref.current?.focus();
  };

  return h(
    'section',
    { className: 'observatory-window flex flex-1 flex-col overflow-hidden border-b bg-card md:rounded-xl md:border md:shadow-xs', 'aria-label': `${component.label}: the contenders` },
    h(
      'div',
      { className: 'flex h-11 shrink-0 items-center gap-3 border-b bg-sidebar px-2' },
      h(
        ToggleGroup,
        {
          variant: 'segmented',
          value: side ? [side] : [],
          onValueChange: (value: string[]) => {
            const next = component.contenders.find((contender) => contender.side === value[0]);
            if (next) flip(next.side);
          },
          disabled: state === 'engine' || state === 'data',
          'aria-label': 'Contender',
        },
        ...component.contenders.map((contender) => h(ToggleGroupItem, { key: contender.side, value: contender.side, className: 'h-7 gap-2 px-3 text-[13px]' }, seriesDot(contender.side), contender.label)),
      ),
      h(
        'span',
        { className: 'flex min-w-0 items-center gap-0.5' },
        h('span', { className: 'truncate text-[13px] text-muted-foreground', 'aria-live': 'polite' }, status(shown, state)),
        h(
          Explainer,
          { trigger: h(Info, { 'aria-hidden': true }), triggerProps: { 'aria-label': 'About switching sides', className: ICON_BUTTON } },
          'One side runs at a time, alone in this frame, so the two never share the processor. Switching closes this side and loads the other. ',
          h('span', { className: 'mt-1 block text-muted-foreground' }, 'The side you load second starts warm: the database engine is already in your browser’s cache.'),
        ),
      ),
      h('span', { className: 'ml-auto hidden min-w-0 truncate pr-2 text-[13px] text-muted-foreground md:block' }, `Scroll ${millions(rows)} asteroids. Flip the switch to compare.`),
    ),
    h(
      'div',
      { 'data-stage': '', className: 'relative min-h-[480px] flex-1 overflow-hidden' },
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
      painted && shown ? h(Suspense, { fallback: null }, h(Meter, { side: shown.side, panel })) : null,
      panel ? h(Suspense, { fallback: null }, h(Panel, { id: PANEL_ID, contenders: component.contenders, onClose: closePanel })) : null,
    ),
    h(
      'div',
      { 'data-status-bar': '', className: 'observatory-status' },
      painted && shown ? h(Suspense, { fallback: null }, h(StatusBar, { shown, panel, togglePanel: () => (panel ? closePanel() : setPanel(true)), rows })) : null,
    ),
  );
}

/** The icon button an explainer's (i) is. */
export const ICON_BUTTON = 'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground [&_svg]:size-3.5';

function status(shown: Contender | null, state: FrameState): string {
  if (state === 'failed' && shown) return `${shown.label} didn't load its data: its frame says why.`;
  if (state === 'filled' && shown) return `Ready · ${isWarm(shown.side) ? 'warm' : 'cold load'}`;
  return state === 'data' ? 'Loading the data…' : 'Loading the engine…';
}
