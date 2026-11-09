/**
 * The contender's window (`docs/DECISIONS.md`, "Page"): one contender at a
 * time, in a same-origin frame (root `CLAUDE.md`, "Comparison protocol"),
 * between a title bar and a status bar, at its scenario's level (the
 * build `scenarios.ts` names) and stop. The title bar holds the GPUI |
 * TanStack toggle, the dial (a scenario with stops: a segmented control on
 * a desktop, a menu on a phone), live tail's follow toggle (`numbers.ts`'s,
 * after first paint), the side's state (the page's only
 * `aria-live` text, changed only by a load, never by a scroll) and its
 * explainer (what this load fetched and what came from the cache), and the
 * lead; the status bar every number and the panel's button. The window is
 * fixed in size: resizing it would change the rows on screen, and so the
 * numbers.
 *
 * A flip or a stop destroys the frame and creates the new one, never hides
 * it (`docs/DECISIONS.md`, "Page", 2026-11-02: a switch is a load); the
 * toggle and the dial stay disabled until the frame shown paints its first
 * rows (its `contender:filled`, relayed by `postMessage`) or says it failed
 * (`contender:failed`), so a switch never lands mid-load, a stop's readings
 * are its own, and a failure never locks it. `?side=` and `?stop=` pick the
 * first frame's; a switch writes them, the defaults omitted. The first frame is created after the page's first paint. The
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

import { ChevronDown, Info } from 'lucide-react';
import { createElement as h, lazy, Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@seiza/site-ui/components/toggle-group';
import { currentTheme, onThemeChange } from '@seiza/site-ui/theme';
import rows from 'virtual:data-rows';
import { MARKS, type Side, type ThemeMessage } from '../../contenders/contract.ts';
import { FONTS } from '../../contenders/paths.ts';
import { SCENARIO_PARAM, type DensityStop, type Scenario, type Stop } from '../../contenders/scenarios.ts';
import { COMPARE_HASH, feeds, hasCold, seriesDot, isDensity, READOUT_PARAM, scenarioCopy, SIDE_PARAM, stopSets, stopShort, STOP_PARAM, type Component, type Contender } from './components.ts';
import { closeExplainer, Explainer } from './explainer.ts';
import { cached, frameMark, isWarm, trackFrame, warmth } from './live.ts';
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

const stopsOf = (scenario: Scenario): readonly Stop[] => scenario.stops;
const defaultStop = (scenario: Scenario): Stop => stopsOf(scenario).find((stop) => stop.id === scenario.defaultStop)!;

/** The stop `?stop=` names, or the scenario's default (an unknown one too:
 *  the page never sends a frame a stop it doesn't have). */
function firstStop(scenario: Scenario): Stop {
  const named = new URLSearchParams(location.search).get(STOP_PARAM);
  return stopsOf(scenario).find((stop) => stop.id === named) ?? defaultStop(scenario);
}

export { stopSets } from './components.ts';

/**
 * About how many cells a wide sheet's stop shows in a stage of `width` ×
 * `height` CSS px: its 1440 × 900 count scaled by the days' share of the
 * width (right of the ~200 px the row numbers and the pinned keys take)
 * and the rows' share of the height (below the ~60 px of header and
 * scrollbar), to tens. An estimate: the explainer says "about".
 */
export function cellsHere(stop: DensityStop, width: number, height: number): number {
  const across = Math.max(0, width - 200) / (1440 - 200);
  const down = Math.max(0, height - 60) / (900 - 60);
  return Math.round((stop.cells * across * down) / 10) * 10;
}

/** What a load fetched or took from the browser's cache, from the frame's
 *  Resource Timing (and its navigation's, the app's HTML), by path. */
type From = 'fetched' | 'from your cache' | 'partly from your cache';
function loadedFrom(frame: HTMLIFrameElement | null, prefix: string): From | null {
  const timing = frame?.contentWindow?.performance;
  if (!timing) return null;
  const entries = [...timing.getEntriesByType('navigation'), ...timing.getEntriesByType('resource')].filter(
    (entry) => new URL(entry.name, location.href).pathname.startsWith(prefix),
  ) as PerformanceResourceTiming[];
  if (!entries.length) return null;
  const hits = entries.filter(cached).length;
  return hits === entries.length ? 'from your cache' : hits ? 'partly from your cache' : 'fetched';
}

export { seriesDot } from './components.ts';

/** The shown contender: its app loading (before `contender:usable`), its
 *  engine starting, its data loading (`contender:open`), its first rows
 *  painted, or failed. */
type FrameState = 'app' | 'engine' | 'data' | 'filled' | 'failed';
const loading = (state: FrameState) => state === 'app' || state === 'engine' || state === 'data';

/** The panel's id, for the status bar's Compare (`aria-controls`). */
export const PANEL_ID = 'observatory-panel';

/** The status bar's contents, the panel, and the meter: the numbers' chunk, after first paint. */
const StatusBar = lazy(() => import('./numbers.ts').then(({ StatusBar }) => ({ default: StatusBar })));
const Panel = lazy(() => import('./numbers.ts').then(({ Panel }) => ({ default: Panel })));
const Meter = lazy(() => import('./numbers.ts').then(({ Meter }) => ({ default: Meter })));
const Follow = lazy(() => import('./numbers.ts').then(({ FollowToggle }) => ({ default: FollowToggle })));

/** Sends the page's theme to a contender's frame. */
function sendTheme(frame: HTMLIFrameElement | null, theme = currentTheme()): void {
  const message: ThemeMessage = { seiza: 'theme', theme };
  frame?.contentWindow?.postMessage(message, location.origin);
}

export function ContenderSlot({ component, scenario }: { component: Component; scenario: Scenario }) {
  // Null until hydrated: the prerendered HTML can't know `?side=`, and the
  // frame waits for the page's first paint anyway. The dial shows the
  // default stop until then, as the HTML does.
  const [side, setSide] = useState<Side | null>(null);
  const [stop, setStop] = useState<Stop>(() => defaultStop(scenario));
  const [painted, setPainted] = useState(false);
  /** Each frame's number: a flip or a stop makes a new one (React's key). */
  const [frame, setFrame] = useState(0);
  const [state, setState] = useState<FrameState>('app');
  /** The shown frame marked a failure: after its first rows, a feed that stopped. */
  const [stopped, setStopped] = useState(false);
  const [panel, setPanel] = useState(false);
  const ref = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const copy = scenarioCopy(scenario);
  const fileRows = rows[scenario.data]!;
  const dial = copy.dial && stopsOf(scenario).length > 1 ? copy.dial : null;
  const busy = loading(state);

  useEffect(() => {
    setSide(firstSide(component));
    setStop(firstStop(scenario));
    afterFirstPaint(() => {
      setPainted(true);
      void loadMetrics();
      // A link to this scenario's Compare (the component's page's rows):
      // opened once, and the fragment cleared, so a reload shows the table.
      if (location.hash === `#${COMPARE_HASH}` && hasCold(scenario)) {
        setPanel(true);
        history.replaceState(history.state, '', `${location.pathname}${location.search}`);
      }
    });
  }, [component, scenario]);

  // The shown frame's marks: only its own, and only from this origin.
  useEffect(() => {
    const listen = (event: MessageEvent<Partial<MarkMessage>>) => {
      if (event.origin !== location.origin || event.source !== ref.current?.contentWindow) return;
      if (event.data?.seiza !== 'mark') return;
      if (typeof event.data.name === 'string' && typeof event.data.at === 'number') frameMark(event.source, event.data.name, event.data.at);
      // A state changes only on a load: a scroll's filled marks set the same one.
      if (event.data.name === MARKS.filled) setState('filled');
      else if (event.data.name === MARKS.usable) setState((state) => (state === 'app' ? 'engine' : state));
      else if (event.data.name === MARKS.open) setState((state) => (state === 'app' || state === 'engine' ? 'data' : state));
      else if (event.data.name === MARKS.failed) {
        // After the first rows the state stays filled; the feed's row says it stopped.
        setStopped(true);
        setState((state) => (state === 'filled' ? state : 'failed'));
      }
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  // The page's theme, live.
  useEffect(() => onThemeChange((theme) => sendTheme(ref.current, theme)), []);

  const shown = component.contenders.find((contender) => contender.side === side) ?? null;
  const base = shown?.url(scenario.level) ?? null;
  // Once per frame: a later theme goes in by message, and a changed `src`
  // would reload the frame.
  const src = useMemo(() => {
    if (!base || !painted) return null;
    const params = new URLSearchParams({ [SCENARIO_PARAM]: scenario.id, [STOP_PARAM]: stop.id, theme: currentTheme() });
    // A feed's frame keeps what this tab's Shown in reads (`live.ts`).
    if (feeds(scenario)) params.set(READOUT_PARAM, '');
    return `${base}?${params}`;
  }, [base, painted, frame, stop, scenario]);
  // This tab's readouts follow each frame from its creation (`live.ts`).
  useEffect(() => {
    if (shown && base && src && ref.current) trackFrame(shown.side, ref.current, base, feeds(scenario));
  }, [src]);

  /** A new frame, and the URL's parameters, the defaults omitted. */
  const reload = (params: Record<string, string | null>) => {
    setState('app');
    setStopped(false);
    setFrame((frame) => frame + 1);
    const url = new URL(location.href);
    for (const [name, value] of Object.entries(params)) {
      if (value === null) url.searchParams.delete(name);
      else url.searchParams.set(name, value);
    }
    history.replaceState(history.state, '', url);
  };
  const flip = (next: Side) => {
    if (next === side || busy) return;
    setSide(next);
    reload({ [SIDE_PARAM]: next === component.contenders[0].side ? null : next });
  };
  const pick = (next: Stop) => {
    if (next.id === stop.id || busy) return;
    setStop(next);
    reload({ [STOP_PARAM]: next.id === scenario.defaultStop ? null : next.id });
  };
  // The panel's close and Esc: back to the table.
  const closePanel = () => {
    setPanel(false);
    ref.current?.focus();
  };

  const text = status(shown, state);
  return h(
    'section',
    { className: 'observatory-window flex flex-1 flex-col overflow-hidden border-b bg-card md:rounded-xl md:border md:shadow-xs', 'aria-label': `${component.label}, ${scenario.label}: the contenders` },
    h(
      'div',
      { className: 'flex h-11 shrink-0 items-center gap-3 border-b bg-sidebar px-2 max-md:gap-2' },
      h(
        ToggleGroup,
        {
          variant: 'segmented',
          value: side ? [side] : [],
          onValueChange: (value: string[]) => {
            const next = component.contenders.find((contender) => contender.side === value[0]);
            if (next) flip(next.side);
          },
          disabled: busy,
          'aria-label': 'Contender',
        },
        ...component.contenders.map((contender) => h(ToggleGroupItem, { key: contender.side, value: contender.side, className: 'h-7 gap-2 px-3 text-[13px]' }, seriesDot(contender.side), contender.label)),
      ),
      dial ? h(Dial, { scenario, dial, stop, pick, busy, stage, rows: fileRows }) : null,
      // Live tail's follow toggle, after first paint, each frame's its own.
      painted && scenario.level === 'tail' ? h(Suspense, { fallback: null }, h(Follow, { key: frame, frame: ref, disabled: state !== 'filled' || stopped })) : null,
      dial ? h('span', { className: 'h-5 w-px shrink-0 bg-border max-md:hidden', 'aria-hidden': true }) : null,
      h(
        'span',
        { className: 'flex shrink-0 items-center gap-0.5' },
        // The full text is the live region; a phone shows it cut, to fit beside the dial.
        h('span', { 'data-state': state, className: `whitespace-nowrap text-[13px] text-muted-foreground ${dial ? 'max-md:sr-only' : ''}`, 'aria-live': 'polite' }, text),
        dial ? h('span', { className: 'text-[13px] text-muted-foreground md:hidden', 'aria-hidden': true }, state === 'filled' ? 'Ready' : state === 'failed' ? 'Failed' : 'Loading…') : null,
        h(
          Explainer,
          { trigger: h(Info, { 'aria-hidden': true }), triggerProps: { 'aria-label': 'About this load', className: ICON_BUTTON }, width: 320 },
          'One side runs at a time, alone in this frame, so the two never share the processor. Each scenario is a build of its own, so another scenario loads its app; a flip or a stop reloads this frame, from your cache where it can.',
          painted && shown ? h(LoadRows, { shown, scenario, state, stopped, frame: ref }) : null,
        ),
      ),
      copy.synthetic ? h('span', { 'data-synthetic': '', className: 'shrink-0 rounded-sm border px-1.5 text-[11px] leading-[18px] whitespace-nowrap text-muted-foreground max-md:hidden' }, 'Synthetic data') : null,
      h('span', { className: 'ml-auto hidden min-w-0 truncate pr-2 text-[13px] text-muted-foreground md:block' }, copy.lead(fileRows)),
    ),
    h(
      'div',
      { ref: stage, 'data-stage': '', className: 'relative min-h-[480px] flex-1 overflow-hidden' },
      shown && src
        ? h('iframe', {
            key: frame,
            ref,
            src,
            onLoad: () => sendTheme(ref.current),
            title: `${component.label}, ${scenario.label}: the ${shown.label} contender`,
            className: 'absolute inset-0 size-full border-0',
          })
        : null,
      painted && shown ? h(Suspense, { fallback: null }, h(Meter, { side: shown.side, panel })) : null,
      panel ? h(Suspense, { fallback: null }, h(Panel, { id: PANEL_ID, contenders: component.contenders, scenario, stop, onClose: closePanel })) : null,
    ),
    h(
      'div',
      { 'data-status-bar': '', className: 'observatory-status' },
      painted && shown
        ? h(Suspense, { fallback: null }, h(StatusBar, { shown, scenario, stop, panel, togglePanel: () => (panel ? closePanel() : setPanel(true)), rows: fileRows, coldReady: hasCold(scenario) }))
        : null,
    ),
  );
}

/** The state's explainer's rows: each part of this load, fetched or from
 *  the cache (unrevalidated, as `live.ts` counts a warm load), read when it
 *  renders (Resource Timing), and why the load is warm or cold, as the
 *  state says it. The frame is read only once its app is past loading: a
 *  mark re-renders the slot after the new frame is in place, while the
 *  render a switch makes still holds the old one. The engine's worker
 *  loads its bundles and reads the data, and a worker's requests aren't
 *  in the frame's timing: those rows say so rather than guess. A failed
 *  load claims nothing past the app. */
function LoadRows({ shown, scenario, state, stopped, frame }: { shown: Contender; scenario: Scenario; state: FrameState; stopped: boolean; frame: RefObject<HTMLIFrameElement | null> }) {
  const failed = state === 'failed';
  const copy = scenarioCopy(scenario);
  const step = { app: 0, engine: 1, data: 2, filled: 3, failed: 3 }[state];
  const at = (n: number, done: string) => (step < n ? 'next' : step === n ? 'loading…' : done);
  const read = (prefix: string) => loadedFrom(frame.current, prefix) ?? '—';
  const rowsOf: [string, string][] = [
    [`${shown.label}’s app at this level`, at(0, read(shown.url(scenario.level)))],
    ['The engine (DuckDB-Wasm)', failed ? 'its frame says what failed' : at(1, 'in its own worker, not timed here')],
    [`The data (${copy.data?.what ?? scenario.data})`, failed ? 'not read' : at(2, copy.data?.how ?? 'read a page at a time')],
    // A feed's (market watch's prices, live tail's clock): made in the frame once it fills.
    ...(copy.made ? ([[copy.made.what, failed ? 'not started' : stopped ? 'stopped: its frame says why' : state === 'filled' ? copy.made.filled : 'next']] as [string, string][]) : []),
    ['The font', at(0, read(FONTS))],
  ];
  const why = warmth(shown.side);
  return h(
    'span',
    // The labels keep room of their own: a long value wraps rather than squeezing them.
    { 'data-load-rows': '', className: 'mt-2 grid grid-cols-[minmax(9rem,1fr)_auto] gap-x-3 gap-y-0.5 text-muted-foreground' },
    ...rowsOf.flatMap(([what, how]) => [h('span', { key: what }, what), h('span', { key: `${what}:how`, className: 'text-right text-foreground' }, how)]),
    state === 'filled'
      ? h(
          'span',
          { className: 'col-span-2 mt-1 block' },
          why === 'cache'
            ? 'Warm: some of this load came from your cache, so its readings aren’t comparable with the cold numbers.'
            : why === 'second'
              ? 'Warm: this tab loaded a contender before this one, so its readings aren’t comparable with the cold numbers.'
              : 'Cold: nothing came from your cache.',
        )
      : null,
  );
}

interface DialProps {
  scenario: Scenario;
  dial: NonNullable<ReturnType<typeof scenarioCopy>['dial']>;
  stop: Stop;
  pick: (stop: Stop) => void;
  busy: boolean;
  stage: RefObject<HTMLDivElement | null>;
  /** The scenario's file's rows, for what each stop sets. */
  rows: number;
}

/** The dial: its stops named by value, each one's parameters in its title
 *  and in the explainer, with this window's count; a phone's menu button. */
function Dial({ scenario, dial, stop, pick, busy, stage, rows }: DialProps) {
  const stops = stopsOf(scenario);
  const sets = (candidate: Stop) => stopSets(scenario, candidate, rows);
  const here = () => {
    const box = stage.current;
    return box && isDensity(stop) ? cellsHere(stop, box.clientWidth, box.clientHeight) : null;
  };
  const foot = () => {
    if (!isDensity(stop)) return 'A stop reloads this frame, from your cache where it can; its numbers are its own.';
    const count = here();
    return `Cells counted at 1440 × 900, where the numbers were measured${count === null ? '' : `; this window shows about ${count} at this stop`}. A stop reloads this frame, from your cache where it can.`;
  };
  return h(
    'div',
    { role: 'group', 'aria-label': dial.label, 'data-dial': '', className: 'flex shrink-0 items-center gap-2' },
    h('span', { className: 'whitespace-nowrap text-[13px] text-muted-foreground max-md:hidden' }, dial.label),
    h(
      ToggleGroup,
      {
        variant: 'segmented',
        value: [stop.id],
        onValueChange: (value: string[]) => {
          const next = stops.find((candidate) => candidate.id === value[0]);
          if (next) pick(next);
        },
        disabled: busy,
        'aria-label': dial.label,
        className: 'max-md:hidden',
      },
      ...stops.map((candidate) => h(ToggleGroupItem, { key: candidate.id, value: candidate.id, title: sets(candidate), ...{ 'data-stop': candidate.id }, className: 'h-7 px-2.5 text-[13px] tabular-nums' }, stopShort(candidate))),
    ),
    h(
      Explainer,
      { className: 'max-md:hidden', trigger: h(Info, { 'aria-hidden': true }), triggerProps: { 'aria-label': 'About the stops', className: ICON_BUTTON }, width: 340 },
      dial.about,
      h(
        'span',
        { className: 'mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground' },
        ...stops.flatMap((candidate) => [h('span', { key: candidate.id, className: 'text-foreground tabular-nums' }, candidate.label), h('span', { key: `${candidate.id}:sets` }, sets(candidate))]),
      ),
      h('span', { className: 'mt-2 block text-muted-foreground' }, foot()),
    ),
    h(
      Explainer,
      {
        className: 'md:hidden',
        menu: true,
        width: 260,
        trigger: h('span', { className: 'flex items-center gap-1 tabular-nums' }, stopShort(stop), h(ChevronDown, { 'aria-hidden': true, className: 'size-3.5 text-muted-foreground' })),
        triggerProps: { 'aria-label': `${dial.label}: ${stop.label}`, disabled: busy, 'data-dial-menu': '', className: 'flex h-8 items-center rounded-md border bg-background px-2 text-[13px] disabled:opacity-50 aria-expanded:bg-accent' },
      },
      h('div', { role: 'none', className: 'px-2.5 pt-1.5 pb-1 text-xs text-muted-foreground' }, dial.label),
      ...stops.map((candidate) =>
        h(
          'button',
          {
            key: candidate.id,
            type: 'button',
            role: 'menuitemradio',
            'aria-checked': candidate.id === stop.id,
            disabled: busy,
            // Closed first: the pick disables its trigger and replaces the
            // frame its press-outside listens on.
            onClick: () => {
              closeExplainer();
              pick(candidate);
            },
            className: 'flex min-h-11 w-full flex-col items-start justify-center rounded-md px-2.5 text-left hover:bg-accent aria-checked:bg-accent',
          },
          h('span', { className: 'text-sm tabular-nums' }, candidate.label),
          h('span', { className: 'text-xs text-muted-foreground' }, sets(candidate)),
        ),
      ),
      h('div', { role: 'none', className: 'px-2.5 pt-1 pb-1.5 text-xs text-muted-foreground' }, foot()),
    ),
  );
}

/** The icon button an explainer's (i) is. */
export const ICON_BUTTON = 'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground [&_svg]:size-3.5';

function status(shown: Contender | null, state: FrameState): string {
  if (state === 'failed' && shown) return `${shown.label} didn't load its data: its frame says why.`;
  if (state === 'filled' && shown) return `Ready · ${isWarm(shown.side) ? 'warm' : 'cold load'}`;
  return state === 'app' ? 'Loading the app…' : state === 'data' ? 'Loading the data…' : 'Loading the engine…';
}
