/**
 * The comparison's numbers (`docs/DECISIONS.md`, "Page", 2026-10-20), a
 * chunk of its own rendered after the page's first paint: the window's
 * status bar (this tab's readings, each segment opening its explainer and
 * its cold comparison; Meter (`meter.ts`'s), Run benchmark, Compare; on a
 * phone Smooth, Memory, and an overflow), the panel Compare opens over the
 * frame (the scenario's numbers: Big file's cards with both devices and
 * their verdicts and its input-to-response chart; a scenario with stops'
 * keeps-up charts, its cards at the stop they pick, and the card for what
 * no stop changes), and the description below the window, per scenario.
 * The cold numbers are resolved at build time (`virtual:cold-numbers`);
 * every comparing word is computed from them (`readouts.ts`).
 *
 * The status bar's readings are written by reference (`textContent`, only
 * on a change), never by a React render: the page shares the contender's
 * main thread (the readout's cost, "Page").
 */

import { ChevronDown, ChevronUp, Ellipsis, Info, Play, X } from 'lucide-react';
import { createElement as h, Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { SOURCE } from '@seiza/site-ui/components/footer';
import cold from 'virtual:cold-numbers';
import type { Side } from '../../contenders/contract.ts';
import type { Scenario, Stop } from '../../contenders/scenarios.ts';
import { millions, SCENARIO_LINK, scenarioPath, stopShort, WHY_ANCHOR, type Component, type Contender } from './components.ts';
import { closeExplainer, Explainer } from './explainer.ts';
import { liveSnapshot, subscribeLive, useLive, type Live, type LiveSide } from './live.ts';
import { toggleMeter, useMeter } from './meter.ts';

/** The meter, in this chunk: it shares the readouts' code. */
export { Meter } from './meter.ts';
import {
  BARS,
  CARDS,
  LABELS,
  READY,
  cardOutcome,
  cardsOf,
  CHART_MS,
  coldKey,
  DEVICES,
  keepsVerdict,
  measuredWith,
  numbersOf,
  partsOf,
  PROFILES,
  cardValues,
  downloadTotal,
  evenSentence,
  number,
  outcome,
  size,
  verdict,
  wheelNote,
  winsOf,
  winsSentence,
  withUnit,
  type Card,
  type Profile,
  type ScenarioCold,
} from './readouts.ts';
import { ICON_BUTTON, PANEL_ID, seriesDot, stopSets } from './slot.ts';

const other = (side: Side): Side => (side === 'gpui' ? 'tanstack' : 'gpui');
const sideIndex = (side: Side) => (side === 'gpui' ? 0 : 1);

/** A side's reading for `card` in this tab, or null. */
const reading = (side: LiveSide | null, card: Card) => (side && card.live ? card.live(side.readings) : null);

/** A scenario's cold numbers (`hasCold`). */
const coldOf = (scenario: Scenario): ScenarioCold => cold.scenarios[scenario.id]!;

/** A reading as the status bar shows it: "—" until there is one. */
const liveText = (live: Live, side: Side, card: Card) => {
  const value = reading(live[side], card);
  return value === null ? '—' : withUnit(value, card.unit);
};

/** One text function per side and card for the module's life, so a
 *  `LiveText` subscribes once, however often its bar renders. */
const texts = new Map<string, (live: Live) => string>();
const textOf = (side: Side, card: Card) => {
  const key = `${side}:${card.key}`;
  if (!texts.has(key)) texts.set(key, (live: Live) => liveText(live, side, card));
  return texts.get(key)!;
};

/** Text that follows this tab's readings by reference: written only when it
 *  changes, with no React render. */
function LiveText({ text, className }: { text: (live: Live) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const write = () => {
      const next = text(liveSnapshot());
      if (ref.current && ref.current.textContent !== next) ref.current.textContent = next;
    };
    write();
    return subscribeLive(write);
  }, [text]);
  return h('span', { ref, className: `tabular-nums ${className ?? ''}` }, text(liveSnapshot()));
}

const better = (card: { better: 'lower' | 'higher' }) => `${card.better} is better`;

// ---------------------------------------------------------------- the status bar

const SEGMENT = 'inline-flex h-full items-center gap-1.5 whitespace-nowrap border-l px-2.5 text-xs hover:bg-accent aria-expanded:bg-accent aria-pressed:bg-accent disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent max-md:px-3 max-md:text-[13px] [&_svg]:size-3';

interface StatusProps {
  shown: Contender;
  /** The window's scenario and stop: a card measured per stop shows its cold values at it. */
  scenario: Scenario;
  stop: Stop;
  panel: boolean;
  togglePanel: () => void;
  rows: number;
  /** Whether the page has this scenario's cold numbers: without them, no
   *  cold rows in the explainers and no panel. */
  coldReady: boolean;
}

export function StatusBar({ shown, scenario, stop, panel, togglePanel, rows, coldReady }: StatusProps) {
  const side = shown.side;
  const meter = useMeter().mode !== 'off';
  const cards = cardsOf(scenario);
  const phone = numbersOf(scenario).phone;
  const coldFast = (card: Card) => cardValues(card, coldOf(scenario).values, 'reference', stop.id);
  const at = (card: Card) => (card.perStop ? ` at ${stop.label}` : '');
  const segment = (card: Card) => {
    const text = textOf(side, card);
    return h(
      Explainer,
      {
        key: card.key,
        className: `h-full ${phone.includes(card.key) ? '' : 'max-md:hidden'}`,
        placement: 'above-end',
        trigger: h(
          Fragment,
          null,
          h('span', { className: `text-muted-foreground ${card.key === 'memory' ? 'max-md:hidden' : ''}` }, card.segment),
          h(LiveText, { text }),
        ),
        triggerProps: { 'data-segment': card.key, className: SEGMENT },
      },
      h('span', { className: 'block' }, `${card.segment} · ${better(card)}`),
      h('span', { className: 'mt-1 block text-muted-foreground' }, card.explain),
      h(
        'span',
        { className: 'mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-muted-foreground' },
        h('span', null, `This tab, ${LABELS[side]}`),
        h(LiveText, { text, className: 'text-right text-foreground' }),
        ...(coldReady
          ? [
              h('span', { key: 'own' }, `Cold, ${LABELS[side]}${at(card)}`),
              h('span', { key: 'own-value', className: 'text-right text-foreground tabular-nums' }, withUnit(coldFast(card)[sideIndex(side)], card.unit)),
              h('span', { key: 'other' }, `Cold, ${LABELS[other(side)]}${at(card)}`),
              h('span', { key: 'other-value', className: 'text-right text-foreground tabular-nums' }, withUnit(coldFast(card)[sideIndex(other(side))], card.unit)),
            ]
          : []),
      ),
    );
  };
  const later = (label: ReactNode, what: string) => h('button', { type: 'button', disabled: true, title: `${what}: coming soon`, className: `${SEGMENT} max-md:hidden` }, label);
  return h(
    'div',
    { 'data-status-ready': '', className: 'flex h-full items-stretch justify-between' },
    h(
      'div',
      { className: 'flex min-w-0 items-stretch' },
      h('span', { className: 'inline-flex items-center gap-1.5 px-2.5 text-xs max-md:px-2 max-md:text-[13px]' }, seriesDot(side), shown.label),
      h('span', { className: 'inline-flex items-center px-2.5 text-xs text-muted-foreground tabular-nums max-md:hidden' }, `${rows.toLocaleString('en-US')} rows`),
    ),
    h(
      'div',
      { className: 'flex min-w-0 items-stretch' },
      ...cards.map(segment),
      h('button', { type: 'button', 'data-meter-toggle': '', 'aria-pressed': meter, onClick: toggleMeter, className: `${SEGMENT} max-md:hidden` }, 'Meter'),
      later(h(Fragment, null, h(Play, { 'aria-hidden': true }), 'Run benchmark'), 'The benchmark'),
      h(
        'button',
        { type: 'button', 'data-compare': '', 'aria-expanded': panel, 'aria-controls': PANEL_ID, onClick: togglePanel, disabled: !coldReady, title: coldReady ? undefined : 'This scenario’s cold numbers: coming soon', className: `${SEGMENT} max-md:hidden` },
        'Compare',
        h(panel ? ChevronDown : ChevronUp, { 'aria-hidden': true }),
      ),
      h(
        Explainer,
        {
          className: 'h-full md:hidden',
          placement: 'above-end',
          width: 240,
          menu: true,
          trigger: h(Ellipsis, { 'aria-hidden': true }),
          triggerProps: { 'aria-label': 'More numbers', className: `${SEGMENT} min-w-11 justify-center` },
        },
        ...cards.filter((card) => !phone.includes(card.key)).map((card) =>
          h(
            'div',
            { key: card.key, role: 'none', className: 'flex justify-between gap-3 p-2.5' },
            h('span', { className: 'text-muted-foreground' }, card.segment),
            h(LiveText, { text: textOf(side, card) }),
          ),
        ),
        h(MenuButton, { onClick: () => (closeExplainer(), panel || togglePanel()), disabled: !coldReady }, coldReady ? 'Compare with cold runs' : 'Compare: coming soon'),
        h(MenuButton, { onClick: () => (closeExplainer(), toggleMeter()) }, meter ? 'Hide the meter' : 'Show the meter'),
        h(MenuButton, { disabled: true }, 'Run benchmark: coming soon'),
      ),
    ),
  );
}

const MenuButton = ({ onClick, disabled, children }: { onClick?: () => void; disabled?: boolean; children?: ReactNode }) =>
  h('button', { type: 'button', role: 'menuitem', onClick, disabled, className: 'flex min-h-11 w-full items-center rounded-md px-2.5 text-left text-sm hover:bg-accent disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent' }, children);

// ---------------------------------------------------------------- the panel

const runsOf = (scenario: Scenario) => coldOf(scenario).runs.join(' and ');

/** An (i) and its explainer. */
const info = (label: string, children: ReactNode, width = 340) =>
  h(Explainer, { trigger: h(Info, { 'aria-hidden': true }), triggerProps: { 'aria-label': label, className: ICON_BUTTON }, width }, children);

interface PanelProps {
  id: string;
  contenders: [Contender, Contender];
  /** The window's scenario, and its stop: a scenario with stops' cards start at it. */
  scenario: Scenario;
  stop: Stop;
  onClose: () => void;
}

export function Panel({ id, contenders, scenario, stop, onClose }: PanelProps) {
  const numbers = coldOf(scenario);
  const runs = runsOf(scenario);
  const live = useLive();
  const [edge, setEdge] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
    // An open explainer hears Esc first (it stops it); otherwise Esc closes the panel.
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const cpus = numbers.cpus.join(', ');
  return h(
    'section',
    { ref, id, tabIndex: -1, 'aria-label': 'How they compare', className: 'absolute inset-0 z-10 flex flex-col overflow-hidden bg-background outline-none' },
    h(
      'div',
      { 'data-panel-header': '', 'data-edge': edge ? '' : undefined, className: 'relative z-[1] flex shrink-0 items-center gap-4 border-b border-transparent bg-background py-2.5 pr-3 pl-4 data-edge:border-border data-edge:shadow-[0_4px_12px_oklch(0_0_0/8%)] max-md:pr-2' },
      h(
        'div',
        { className: 'min-w-0 flex-1' },
        h('h2', { className: 'text-[15px]' }, `How they compare: ${scenario.label}`),
        h(
          'p',
          { className: 'flex items-center gap-1 text-[13px] text-muted-foreground' },
          `The middle of ${runs} cold loads per side, on two devices`,
          info(
            'About the devices',
            h(
              Fragment,
              null,
              `Fast device: ${cpus === 'Apple M1' ? 'an Apple M1' : cpus} at full speed. Slow device: the same machine with its processor slowed 4×, on a Fast 4G network.`,
              h('span', { className: 'mt-1 block text-muted-foreground' }, `Each side loads alone in a fresh browser, ${runs} times, by a test script; the number is the middle run.`),
            ),
          ),
        ),
      ),
      h('button', { type: 'button', 'aria-label': 'Close, back to the table', onClick: onClose, className: 'inline-flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-accent [&_svg]:size-[18px]' }, h(X, { 'aria-hidden': true })),
    ),
    h(
      'div',
      { 'data-panel-body': '', onScroll: (event: { currentTarget: HTMLElement }) => setEdge(event.currentTarget.scrollTop > 0), className: '@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 max-md:p-3' },
      numbersOf(scenario).stopCards
        ? // A new stop in the window starts the cards at it again.
          h(StopsBody, { key: stop.id, scenario, numbers, stop, live, contenders })
        : h(
            Fragment,
            null,
            h(
              'div',
              { className: 'grid gap-3 @3xl:grid-cols-3' },
              ...CARDS.map((card) => h(StatCard, { key: card.key, card, values: numbers.values, live, contenders })),
              h(DownloadCard, { key: 'download', scenario, numbers, contenders }),
            ),
            h(Chart, { values: numbers.values, contenders }),
          ),
    ),
  );
}

const CARD = 'flex min-w-0 flex-col gap-2 rounded-[10px] border px-3.5 py-3';
const CAPTION = 'col-span-2 mt-1.5 text-[11px] text-muted-foreground';

function CardHead({ label, explain, note }: { label: string; explain: string; note: string }) {
  return h(
    'div',
    { className: 'flex items-center justify-between gap-2 text-[13px]' },
    h('span', { className: 'inline-flex items-center gap-0.5' }, label, info(`About ${label}`, explain)),
    h('small', { className: 'text-[11px] whitespace-nowrap text-muted-foreground' }, note),
  );
}

const sideHeads = (contenders: [Contender, Contender]) =>
  contenders.map((contender) => h('span', { key: contender.side, className: 'flex items-center gap-1.5 text-xs text-muted-foreground' }, seriesDot(contender.side), contender.label));

/** A cold value, large, its unit small, "best" beside the winner's. */
const big = (text: string, unit: string, best: boolean, attributes: Record<string, string>) =>
  h(
    'span',
    { ...attributes, className: 'text-xl leading-tight tracking-tight tabular-nums' },
    text,
    unit ? h('small', { className: 'ml-0.5 text-xs tracking-normal text-muted-foreground' }, unit) : null,
    best ? h('span', { className: 'ml-1.5 align-[2px] text-[11px] tracking-normal text-muted-foreground' }, 'best') : null,
  );

interface StatCardProps {
  card: Card;
  values: ScenarioCold['values'];
  /** The stop a card measured per stop shows. */
  stop?: string;
  /** Under the verdict: where it was measured, when not at the stop shown. */
  note?: string;
  live: Live;
  contenders: [Contender, Contender];
}

/** Beside the collection card's time: the longest pause and those in a
 *  late frame, per side, the fast device's then the slow one's. */
function Pauses({ values, stop, contenders }: { values: ScenarioCold['values']; stop?: string; contenders: [Contender, Contender] }) {
  const at = (metric: string, side: Side) => PROFILES.map((profile) => values[coldKey(metric, profile, stop)]![sideIndex(side)]!);
  const row = (label: string, metric: string, unit: string) => [
    h('span', { key: `${metric}-label`, className: CAPTION }, label),
    ...contenders.map((contender) =>
      h('span', { key: `${metric}-${contender.side}`, 'data-pauses': `${metric}:${contender.side}`, className: 'text-xs tabular-nums' }, `${at(metric, contender.side).map(number).join(' · ')}${unit}`),
    ),
  ];
  return h(
    'div',
    { 'data-pauses': '', className: 'grid grid-cols-2 gap-x-2.5 border-t pt-0.5' },
    ...row('The longest pause, fast · slow device', 'collection-longest', ' ms'),
    ...row('Pauses in a late frame, fast · slow device', 'collection-late', ''),
  );
}

function StatCard({ card, values, stop, note, live, contenders }: StatCardProps) {
  const outcomes = PROFILES.map((profile) => cardOutcome(card, values, profile, stop));
  // This tab: only once a side has loaded, for a card with a reading here.
  const loaded = card.live ? contenders.filter((contender) => live[contender.side]) : [];
  return h(
    'div',
    { 'data-card': card.key, className: CARD },
    h(CardHead, { label: card.label, explain: card.explain, note: better(card) }),
    h('span', { 'data-verdict': '', className: 'text-sm leading-snug' }, verdict(outcomes[0]!, outcomes[1]!, card.word, card.ratio)),
    note ? h('span', { 'data-card-note': '', className: 'text-[11px] text-muted-foreground' }, note) : null,
    h(
      'div',
      { className: 'grid grid-cols-2 items-baseline gap-x-2.5' },
      ...sideHeads(contenders),
      ...PROFILES.flatMap((profile, index) => {
        const shown = cardValues(card, values, profile, stop);
        return [
          h('span', { key: `${profile}-caption`, className: CAPTION }, index === 0 && card.caption ? `${DEVICES[profile]}, ${card.caption.toLowerCase()}` : DEVICES[profile]),
          ...contenders.map((contender) =>
            h(Fragment, { key: `${profile}-${contender.side}` }, big(number(shown[sideIndex(contender.side)]!), card.unit, outcomes[index]!.winner === contender.side, { [`data-cold-${profile}`]: contender.side })),
          ),
        ];
      }),
    ),
    card.pauses ? h(Pauses, { values, stop, contenders }) : null,
    loaded.length
      ? h(
          'div',
          { className: 'grid grid-cols-2 gap-x-2.5 border-t pt-0.5' },
          h('span', { className: CAPTION }, 'This tab'),
          ...contenders.map((contender) => {
            const side = live[contender.side];
            const value = reading(side, card);
            return h(
              'span',
              { key: contender.side, 'data-live': contender.side, className: 'inline-flex items-center gap-1.5 text-xs tabular-nums' },
              h('span', { className: value === null ? 'text-muted-foreground' : '' }, !side ? '—' : value === null ? (card.waiting ?? '—') : withUnit(value, card.unit)),
              side?.warm && value !== null ? h('span', { className: 'rounded-sm border px-1 text-[11px] leading-4 text-muted-foreground' }, 'warm') : null,
            );
          }),
        )
      : null,
  );
}

function DownloadCard({ scenario, numbers, contenders }: { scenario: Scenario; numbers: ScenarioCold; contenders: [Contender, Contender] }) {
  const totals = contenders.map((contender) => downloadTotal(contender.side, numbers.parts, scenario)) as [number, number];
  const fast = outcome(totals, 'lower');
  return h(
    'div',
    { 'data-card': 'download', className: `${CARD} @3xl:col-span-2` },
    h(CardHead, { label: 'Download', explain: 'What each side’s page fetches, compressed as sent. The database engine and the data are the same files on both sides, so they’re left out.', note: 'lower is better' }),
    h('span', { 'data-verdict': '', className: 'text-sm leading-snug' }, verdict(fast, null, 'smaller', true)),
    h(
      'div',
      { className: 'grid grid-cols-2 items-baseline gap-x-2.5' },
      ...sideHeads(contenders),
      h('span', { className: CAPTION }, 'Either device'),
      ...contenders.map((contender, index) => {
        const [value, unit] = size(totals[index]!).split(' ') as [string, string];
        return h(Fragment, { key: contender.side }, big(value, unit, fast.winner === contender.side, { 'data-cold-reference': contender.side }));
      }),
    ),
    h(
      'div',
      { className: 'grid grid-cols-2 gap-x-2.5 border-t pt-2' },
      ...contenders.map((contender) =>
        h(
          'dl',
          { key: contender.side, 'data-parts': contender.side, className: 'grid grid-cols-[1fr_auto] gap-x-3 text-[11px] leading-[1.6] text-muted-foreground' },
          ...partsOf(scenario)[contender.side].flatMap((part) => [
            h('dt', { key: `${part.id}-label`, className: part.within ? 'pl-3' : 'text-foreground' }, part.label),
            h('dd', { key: `${part.id}-value`, className: `text-right tabular-nums ${part.within ? '' : 'text-foreground'}` }, `${number(numbers.parts[part.id]!)} KiB`),
          ]),
        ),
      ),
    ),
    h('span', { className: 'text-[11px] leading-snug text-muted-foreground' }, 'Brotli, as fetched. Both sides load the same font, the same database engine, and the same data; the engine and the data are left out. The WebAssembly’s rest is Rust’s runtime, its static data, and the module’s tables.'),
  );
}

function Chart({ values, contenders }: { values: ScenarioCold['values']; contenders: [Contender, Contender] }) {
  const end = Math.max(CHART_MS, Math.ceil(Math.max(...BARS.flatMap((bar) => PROFILES.flatMap((profile) => values[`${bar.metric}-${profile}`]!))) / 10) * 10);
  const ticks = Array.from({ length: end / 10 + 1 }, (_, index) => index * 10);
  const pair = (bar: (typeof BARS)[number], profile: Profile) =>
    h(
      'div',
      { key: profile, className: 'flex flex-col gap-0.5' },
      h('span', { className: 'hidden text-[11px] text-muted-foreground max-md:block' }, DEVICES[profile]),
      ...contenders.map((contender, index) => {
        const value = values[`${bar.metric}-${profile}`]![index]!;
        const mark = bar.native && profile === 'throttled' && contender.side === 'tanstack' ? ' †' : '';
        return h(
          'div',
          { key: contender.side, className: 'flex items-center gap-2' },
          h('div', {
            className: `h-2.5 rounded-r-[3px] ${contender.side === 'gpui' ? 'bg-series-gpui' : 'bg-series-tanstack'}`,
            style: { width: `calc((100% - 4rem) * ${(value / end).toFixed(4)})` },
            'aria-hidden': true,
          }),
          h('span', { className: 'text-xs text-muted-foreground tabular-nums' }, h('span', { className: 'sr-only' }, `${contender.label}, ${DEVICES[profile].toLowerCase()}: `), `${number(value)} ms${mark}`),
        );
      }),
    );
  const axis = (key: string) =>
    h(
      'div',
      { key, className: 'flex justify-between border-t pt-1 pr-16 text-xs text-muted-foreground tabular-nums max-md:hidden', 'aria-hidden': true },
      ...ticks.map((tick, index) => h('span', { key: tick }, index === ticks.length - 1 ? `${tick} ms` : tick)),
    );
  return h(
    'section',
    { 'aria-label': 'From your input to the table moving', className: 'flex flex-col gap-3 rounded-[10px] border px-4 pt-3 pb-3.5' },
    h(
      'div',
      { className: 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1' },
      h('h3', { className: 'text-[13px] text-muted-foreground' }, 'From your input to the table moving, cold. Lower is better.'),
      h('div', { className: 'flex items-center gap-3 text-xs text-muted-foreground' }, ...sideHeads(contenders)),
    ),
    h(
      'div',
      { role: 'list', className: 'grid items-center gap-x-6 gap-y-2.5 md:grid-cols-[190px_minmax(0,1fr)_minmax(0,1fr)] max-md:gap-y-1' },
      h('span', { className: 'max-md:hidden' }),
      ...PROFILES.map((profile) => h('span', { key: profile, className: 'text-xs text-muted-foreground max-md:hidden' }, DEVICES[profile])),
      ...BARS.flatMap((bar) => [
        h('span', { key: `${bar.metric}-label`, role: 'listitem', className: 'text-[13px] max-md:mt-2' }, bar.label),
        ...PROFILES.map((profile) => h(Fragment, { key: `${bar.metric}-${profile}` }, pair(bar, profile))),
      ]),
      h('span', { className: 'max-md:hidden' }),
      axis('fast'),
      axis('slow'),
    ),
    h('p', { className: 'text-xs text-muted-foreground' }, wheelNote(values)),
    h('p', { className: 'text-xs text-muted-foreground' }, '† The slow device slows the processor for page code, not the browser’s own scrolling, so these rows flatter native scrolling. A real slow phone is slower here too.'),
  );
}

// ---------------------------------------------------------------- a scenario's stops

interface StopsProps {
  scenario: Scenario;
  numbers: ScenarioCold;
  /** The window's stop: the cards' first, until a stop under the charts is pressed. */
  stop: Stop;
  live: Live;
  contenders: [Contender, Contender];
}

/** "Where each side keeps up": a chart per device, the verdict, and the
 *  stops that pick the cards' (the frame isn't reloaded); then the cards at
 *  that stop, and the one for what no stop changes. */
function StopsBody({ scenario, numbers, stop, live, contenders }: StopsProps) {
  const stops = scenario.stops as readonly Stop[];
  const [picked, setPicked] = useState<string | null>(null);
  const at = stops.find((candidate) => candidate.id === (picked ?? stop.id)) ?? stop;
  const byDefault = stops.find((candidate) => candidate.id === scenario.defaultStop)!;
  const shape = numbersOf(scenario);
  const keeps = shape.keeps!;
  const line = `${keeps.better === 'lower' ? '≤ ' : ''}${number(keeps.line)} ${keeps.unit}`;
  const note = shape.stopNote?.(at, numbers.values) ?? null;
  // Two a row (a 2 × 2) where the scenario says so; three otherwise.
  const pairs = shape.stopColumns === 2;
  return h(
    Fragment,
    null,
    h(
      'section',
      { 'data-card': 'keeps', 'aria-label': 'Where each side keeps up', className: CARD },
      h(CardHead, {
        label: 'Where each side keeps up',
        explain: `A side keeps up at a stop when ${keeps.better === 'higher' ? `at least ${line} ` : ''}${keeps.explain} Cold, the middle of ${runsOf(scenario)} runs.`,
        note: `${keeps.better} is better`,
      }),
      h('span', { 'data-verdict': '', className: 'text-sm leading-snug' }, keepsVerdict(scenario, numbers.values)),
      h(
        'div',
        { className: 'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground' },
        ...sideHeads(contenders),
        h('span', { className: 'inline-flex items-center gap-1.5' }, h('span', { className: 'w-4 border-t border-dashed border-muted-foreground', 'aria-hidden': true }), `keeps up: ${line}`),
      ),
      h('div', { className: 'grid gap-4 @2xl:grid-cols-2' }, ...PROFILES.map((profile) => h(KeepsChart, { key: profile, scenario, values: numbers.values, profile, picked: at.id, pick: setPicked }))),
    ),
    h(
      'div',
      { 'data-stop-heading': '', className: 'flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-0.5' },
      h('h3', { className: 'text-sm' }, `At ${at.label}`),
      h('span', { className: 'text-xs text-muted-foreground' }, stopSets(scenario, at, numbers.rows)),
      at.id === stop.id ? h('span', { className: 'text-xs text-muted-foreground' }, 'this window’s stop') : null,
    ),
    note ? h('p', { 'data-stop-note': '', className: '-mt-2 px-0.5 text-xs leading-snug text-muted-foreground' }, note) : null,
    h(
      'div',
      { className: `grid gap-3 ${pairs ? '@2xl:grid-cols-2' : '@3xl:grid-cols-3'}` },
      ...shape.stopCards!.map((card) =>
        h(StatCard, { key: card.key, card, values: numbers.values, stop: at.id, note: !card.perStop && at.id !== byDefault.id ? `Measured once, at ${byDefault.label}, the default stop` : undefined, live, contenders }),
      ),
      h(OnceCard, { key: 'once', scenario, numbers, contenders, pairs }),
    ),
  );
}

/** The chart's plot: its height, its top and bottom lines in it, and the
 *  gutters its labels and its last marker take, CSS px. Its x is a share
 *  of the plot's width, so the chart keeps its height and text size at any
 *  width. */
const [PLOT, TOP, BOTTOM, GUTTER, END] = [150, 8, 142, 46, 8];

/** A chart's y scale: a share from 0 to 100 % (higher up), or a latency on
 *  a log scale from 10 ms to 1 s (lower down), the decades its lines
 *  (`docs/DECISIONS.md`, "Page", 2026-11-09). */
interface Scale {
  y: (value: number) => number;
  lines: { value: number; label: string }[];
}

const SHARE_SCALE: Scale = {
  y: (share) => TOP + ((100 - share) / 100) * (BOTTOM - TOP),
  lines: [100, 50, 0].map((share) => ({ value: share, label: `${share} %` })),
};

const [LOG_LO, LOG_HI] = [10, 1000];
const LOG_SCALE: Scale = {
  y: (ms) => TOP + ((Math.log10(LOG_HI) - Math.log10(Math.min(LOG_HI, Math.max(LOG_LO, ms)))) / (Math.log10(LOG_HI) - Math.log10(LOG_LO))) * (BOTTOM - TOP),
  lines: [
    { value: 1000, label: '1 s' },
    { value: 100, label: '100 ms' },
    { value: 10, label: '10 ms' },
  ],
};

function KeepsChart({ scenario, values, profile, picked, pick }: { scenario: Scenario; values: ScenarioCold['values']; profile: Profile; picked: string; pick: (stop: string) => void }) {
  const stops = scenario.stops as readonly Stop[];
  const keeps = numbersOf(scenario).keeps!;
  const { y, lines } = keeps.unit === '%' ? SHARE_SCALE : LOG_SCALE;
  const x = (index: number) => `${(((index + 0.5) / stops.length) * 100).toFixed(2)}%`;
  const shares = (side: Side) => stops.map((stop) => values[coldKey('keeps', profile, stop.id)]![sideIndex(side)]!);
  const label = `${DEVICES[profile]}, ${keeps.reads} at ${stops.map((stop) => stop.label).join(', ')}: ${(['gpui', 'tanstack'] as const).map((side) => `${LABELS[side]} ${shares(side).map(number).join(', ')} ${keeps.unit}`).join('; ')}`;
  const selected = stops.findIndex((stop) => stop.id === picked);
  // Each side's line as segments: a polyline's points can't be a share of the width.
  const segments = (side: Side, className: string) =>
    shares(side)
      .slice(1)
      .map((share, index) => h('line', { key: `${side}${index}`, x1: x(index), y1: y(shares(side)[index]!), x2: x(index + 1), y2: y(share), strokeWidth: 2, strokeLinecap: 'round', className }));
  return h(
    'div',
    { 'data-keeps-chart': profile, className: 'flex min-w-0 flex-col gap-1.5' },
    h('span', { className: 'text-xs text-muted-foreground' }, DEVICES[profile]),
    h(
      'div',
      { className: 'relative', style: { height: PLOT } },
      ...lines.map(({ value, label }) =>
        h('span', { key: value, 'aria-hidden': true, className: 'absolute left-0 -translate-y-1/2 whitespace-nowrap text-right text-[11px] leading-none text-muted-foreground tabular-nums', style: { top: y(value), width: GUTTER - 8 } }, label),
      ),
      h(
        'svg',
        { role: 'img', 'aria-label': label, className: 'absolute top-0 overflow-visible', style: { left: GUTTER, width: `calc(100% - ${GUTTER + END}px)`, height: PLOT } },
        h('rect', { x: `${((selected / stops.length) * 100).toFixed(2)}%`, y: TOP, width: `${(100 / stops.length).toFixed(2)}%`, height: BOTTOM - TOP, className: 'fill-accent' }),
        ...lines.map(({ value }) => h('line', { key: value, x1: '0%', x2: '100%', y1: y(value), y2: y(value), className: 'stroke-border' })),
        h('line', { 'data-keeps-line': keeps.line, x1: '0%', x2: '100%', y1: y(keeps.line), y2: y(keeps.line), strokeDasharray: '4 3', className: 'stroke-muted-foreground' }),
        ...segments('gpui', 'stroke-series-gpui'),
        ...segments('tanstack', 'stroke-series-tanstack'),
        // A circle for GPUI, a square for TanStack: told apart without the color.
        ...shares('gpui').map((share, index) => h('circle', { key: `g${index}`, cx: x(index), cy: y(share), r: 3.5, className: 'fill-series-gpui' })),
        ...shares('tanstack').map((share, index) => h('svg', { key: `s${index}`, x: x(index), y: y(share), overflow: 'visible' }, h('rect', { x: -3.5, y: -3.5, width: 7, height: 7, className: 'fill-series-tanstack' }))),
        // On a latency's chart, each point past the line says its value, and so
        // does one the axis clamps to 10 ms or 1 s: GPUI's to its left,
        // TanStack's to its right, so two near misses don't overlap.
        ...(keeps.better === 'lower'
          ? (['gpui', 'tanstack'] as const).flatMap((side) =>
              shares(side).flatMap((value, index) =>
                value > keeps.line || value < LOG_LO || value > LOG_HI
                  ? [
                      h(
                        'text',
                        { key: `miss-${side}${index}`, 'data-miss': `${side}:${stops[index]!.id}`, x: x(index), y: y(value), dx: side === 'gpui' ? -7 : 7, dy: 3.5, textAnchor: side === 'gpui' ? 'end' : 'start', // A halo in the card's color keeps it legible over the lines it crosses.
                          style: { paintOrder: 'stroke', stroke: 'var(--background)', strokeWidth: 3, strokeLinejoin: 'round' },
                          className: `text-[10px] tabular-nums ${side === 'gpui' ? 'fill-series-gpui' : 'fill-series-tanstack'}` },
                        `${number(value)} ms`,
                      ),
                    ]
                  : [],
              ),
            )
          : []),
      ),
    ),
    h(
      'div',
      { role: 'group', 'aria-label': `${DEVICES[profile]}: the stop the cards show`, className: 'grid', style: { gridTemplateColumns: `repeat(${stops.length}, minmax(0, 1fr))`, marginLeft: GUTTER, marginRight: END } },
      ...stops.map((stop) =>
        h(
          'button',
          {
            key: stop.id,
            type: 'button',
            'data-pick': stop.id,
            'aria-pressed': stop.id === picked,
            'aria-label': stop.label,
            onClick: () => pick(stop.id),
            className: 'h-7 rounded-md text-xs text-muted-foreground tabular-nums hover:bg-accent hover:text-foreground aria-pressed:text-foreground',
          },
          stopShort(stop),
        ),
      ),
    ),
  );
}

/** What no stop changes, one build per side: Ready in on both devices, and Download. */
function OnceCard({ scenario, numbers, contenders, pairs }: { scenario: Scenario; numbers: ScenarioCold; contenders: [Contender, Contender]; pairs: boolean }) {
  const ready = PROFILES.map((profile) => cardOutcome(READY, numbers.values, profile));
  // Live tail's memory after 10 minutes, measured at one stop.
  const extras = numbersOf(scenario).onceCards ?? [];
  const extraOutcomes = extras.map((card) => PROFILES.map((profile) => cardOutcome(card, numbers.values, profile)));
  const totals = contenders.map((contender) => downloadTotal(contender.side, numbers.parts, scenario)) as [number, number];
  const download = outcome(totals, 'lower');
  const head = (text: string) => h('span', { key: text, className: 'text-right text-[11px] text-muted-foreground' }, text);
  return h(
    'div',
    { 'data-card': 'once', className: `${CARD} ${pairs ? '@2xl:col-span-2' : '@3xl:col-span-3'}` },
    h(CardHead, {
      label: 'The same at every stop',
      explain: `One build per side, whatever the stop. ${READY.explain} Download: what each side’s page fetches, compressed as sent; the database engine and the data are the same files on both sides, so they’re left out.${extras.map((card) => ` ${card.label}: ${card.explain}`).join('')}`,
      note: 'lower is better',
    }),
    h(
      'span',
      { 'data-verdict': '', className: 'text-sm leading-snug' },
      `Ready in: ${verdict(ready[0]!, ready[1]!, READY.word, READY.ratio)}. ${extras.map((card, index) => `${card.label}, ${card.caption!.toLowerCase()}: ${verdict(extraOutcomes[index]![0]!, extraOutcomes[index]![1]!, card.word, card.ratio)}. `).join('')}Download: ${verdict(download, null, 'smaller', true)}.`,
    ),
    h(
      'div',
      { className: 'overflow-x-auto' },
      h(
      'div',
      { className: 'grid items-baseline gap-x-6 gap-y-1', style: { gridTemplateColumns: `minmax(0,1fr) repeat(${3 + 2 * extras.length}, auto)` } },
      h('span', { key: 'corner' }),
      head('Ready in, fast device'),
      head('Ready in, slow device'),
      ...extras.flatMap((card) => [head(`${card.label}, fast device`), head(`${card.label}, slow device`)]),
      head('Download'),
      ...contenders.flatMap((contender, index) => [
        h('span', { key: `${contender.side}-name`, className: 'flex items-center gap-1.5 text-xs text-muted-foreground' }, seriesDot(contender.side), contender.label),
        ...PROFILES.map((profile, at) =>
          h(
            'span',
            { key: `${contender.side}-${profile}`, className: 'text-right' },
            big(number(cardValues(READY, numbers.values, profile)[index]!), READY.unit, ready[at]!.winner === contender.side, { [`data-cold-${profile}`]: contender.side }),
          ),
        ),
        ...extras.flatMap((card, which) =>
          PROFILES.map((profile, at) =>
            h(
              'span',
              { key: `${contender.side}-${card.key}-${profile}`, className: 'text-right' },
              big(number(cardValues(card, numbers.values, profile)[index]!), card.unit, extraOutcomes[which]![at]!.winner === contender.side, { [`data-${card.metric}-${profile}`]: contender.side }),
            ),
          ),
        ),
        h(
          'span',
          { key: `${contender.side}-download`, className: 'text-right' },
          (() => {
            const [value, unit] = size(totals[index]!).split(' ') as [string, string];
            return big(value, unit, download.winner === contender.side, { 'data-download': contender.side });
          })(),
        ),
      ]),
      ),
    ),
  );
}

// ---------------------------------------------------------------- below the window

type Block = { title: string; body: ReactNode };

/** What a scenario's description says beyond its numbers: what the window
 *  shows (its opening paragraph), and its blocks before and after "Where
 *  each side wins" (why its data is the size it is; why each side wins). */
interface Story {
  shows: (numbers: ScenarioCold) => string;
  before?: (numbers: ScenarioCold, component: Component) => Block[];
  after?: (numbers: ScenarioCold, component: Component) => Block[];
  /** The data's terms, after its credit, where it has no license. */
  terms?: string;
}

const STORIES: Record<string, Story> = {
  'big-file': {
    shows: (numbers) => `Two tables scroll the same ${numbers.rows.toLocaleString('en-US')} asteroids, read a page at a time from one file by the same database engine. Only the table differs.`,
    before: (numbers) => [
    {
      title: `Why ${millions(numbers.rows)} rows`,
      body: h(
        'p',
        null,
        'It’s the whole asteroid file that fits our hosting’s 25 MiB file limit, not the TallTable’s limit: it scrolls by row, not by pixel, so it handles tens of millions. A browser caps how tall a page element can be, so a plain DOM list stops near 560,000 rows of this height in Firefox and 1.1 million in Chrome. The TanStack side reaches the last row through a scaled scroller built for this comparison.',
      ),
    },
  ],
  },
  'wide-sheet': {
    shows: (numbers) =>
      `A spreadsheet, a BI tool’s sheet, a notebook’s output: hundreds of columns, compact rows, and color telling each value’s story. Here a row is one of ${numbers.rows.toLocaleString('en-US')} weather stations, from the far north to the far south, and a column is a day of 2025, its high drawn as heat. The seasons show as a warm band along each row; scrolling south, the band flips. The station and its place stay pinned as the days scroll by. Each stop of the dial packs more cells on screen, the same on both sides, read from one file by the same database engine.`,
    after: (_, component) => [
    {
      title: 'Why',
      body: h(
        'p',
        null,
        'Cost per cell: the DOM pays style, layout, and paint for each cell’s element, so its frames grow with the cells on screen, while the GPU draws them all as quads and glyphs. That’s the canvas’s doing rather than WebAssembly’s, and the two aren’t measured apart yet. WebAssembly’s part is decoding and formatting each visible cell. ',
        h('a', { href: `${component.path}#${WHY_ANCHOR}`, className: 'text-foreground underline underline-offset-4' }, `What each one means, on the ${component.label} page`),
        '.',
      ),
    },
  ],
  },
  'market-watch': {
    shows: (numbers) =>
      `A trading screen: ${numbers.rows} fictional instruments, every price changed in place, each change flashing. One seeded feed, the same on both sides, runs in a worker of each side’s own and sends every tick as the same bytes; each side folds every tick into its own store, none dropped, and draws once a frame. Each stop of the dial sends more updates a second. The instruments come from one small file, opened by the same database engine; their names, their prices, and the feed are made up.`,
    after: (_, component) => [
      {
        title: 'Why',
        body: h(
          'p',
          null,
          'Garbage under churn: each tick makes new objects on the DOM side, and the page pauses to collect them, more often the faster the feed; GPUI’s store is Rust’s plain buffers, which make none. That’s WebAssembly’s doing rather than the canvas’s. Cost per cell: the DOM renders only the rows a tick moved, while the GPU draws the whole screen each frame, so at the lower stops the DOM does less. ',
          h('a', { href: `${component.path}#${WHY_ANCHOR}`, className: 'text-foreground underline underline-offset-4' }, `What each one means, on the ${component.label} page`),
          '.',
        ),
      },
    ],
  },
  'live-tail': {
    shows: (numbers) =>
      `An observability tool’s live tail: the web server log of NASA’s Kennedy Space Center from July 1995, ${numbers.rows.toLocaleString('en-US')} requests, replayed into the table while the view follows the newest row. One clock, the same on both sides, runs in a worker of each side’s own and posts how many rows are due; each side reads them from the same file through the same database engine, a page at a time, and draws once a frame. Each stop of the dial adds more rows a second. Past the file’s end the replay loops, each lap’s times moved on by the log’s length, so it never runs out. Scroll up and the view lets go of the tail and holds where you put it; End, or scrolling back to the bottom, follows the tail again.`,
    after: (_, component) => [
      {
        title: 'Why',
        body: h(
          'p',
          null,
          'Garbage under a growing table: the DOM side makes new objects for each page it reads and each row it renders, and its page spends longer paused collecting them; GPUI’s pages are Rust’s plain buffers. That’s WebAssembly’s doing rather than the canvas’s. Cost per cell matters less here than on the wide sheet: each frame only a few rows are new, so the two sides spend about the same time on a frame, and where the rows come faster than a slow device can draw them, both fall behind. A scroll back is the DOM’s: the browser moves its page on the compositor before the page’s own thread hears of it. ',
          h('a', { href: `${component.path}#${WHY_ANCHOR}`, className: 'text-foreground underline underline-offset-4' }, `What each one means, on the ${component.label} page`),
          '.',
        ),
      },
    ],
    terms: 'The Internet Traffic Archive’s terms: “The traces may be freely redistributed.” The visitors’ hosts are left out, every query string is cut, and a request naming a person is dropped.',
  },
};

/** A scenario's story: one without fails its description by name. */
function storyOf(scenario: Scenario): Story {
  const story = STORIES[scenario.id];
  if (!story) throw new Error(`no description for scenario ${scenario.id} (numbers.ts)`);
  return story;
}

export function Description({ component, scenario }: { component: Component; scenario: Scenario }) {
  const numbers = coldOf(scenario);
  const story = storyOf(scenario);
  const contenders = component.contenders;
  const won = winsOf(scenario, numbers);
  const stops = !!numbersOf(scenario).stopCards;
  const byDefault = (scenario.stops as readonly Stop[]).find((stop) => stop.id === scenario.defaultStop)!;
  const measured = measuredWith(numbers.versions);
  const others = component.scenarios.filter((other) => other.id !== scenario.id);
  const item = (dot: ReactNode, children: ReactNode) => h('li', { className: 'flex items-baseline gap-2.5' }, dot ? h('span', { className: 'inline-flex -translate-y-px' }, dot) : null, h('span', { className: 'text-muted-foreground' }, children));
  const name = (text: string) => h('span', { className: 'text-foreground' }, text);
  const block = (title: string, ...children: ReactNode[]) => h('div', { key: title }, h('h2', { className: 'mb-1.5 text-[15px]' }, title), ...children);
  const muted = h('span', { className: 'inline-block size-2 shrink-0 rounded-full bg-muted-foreground', 'aria-hidden': true });
  const link = 'text-foreground underline underline-offset-4';
  const data = [
    h('p', { key: 'credit', 'data-credit': '', className: 'text-muted-foreground' }, `Data: ${numbers.credit}.${numbers.license ? ` ${numbers.license}.` : story.terms ? ` ${story.terms}` : ''}`),
    numbers.citation ? h('p', { key: 'citation', 'data-citation': '', className: 'mt-1 text-muted-foreground' }, `Its citation: ${numbers.citation}`) : null,
    measured ? h('p', { key: 'measured', 'data-measured': '', className: 'mt-1 text-muted-foreground' }, measured) : null,
  ];
  return h(
    'section',
    { 'data-description': '', 'aria-label': 'About this comparison', className: 'flex max-w-[76ch] flex-col gap-5 px-3 pt-1 pb-6 text-sm max-md:px-4' },
    block(
      stops ? 'What it models' : 'What you’re looking at',
      h('p', null, story.shows(numbers)),
      h(
        'ul',
        { className: 'mt-2 flex flex-col gap-1.5' },
        ...contenders.map((contender) => h(Fragment, { key: contender.side }, item(seriesDot(contender.side), h(Fragment, null, name(`${contender.label}:`), ` ${contender.stack}.`)))),
      ),
      // With one data file to credit and no citation, its credit stays here.
      numbers.citation ? null : h('div', { className: 'mt-2' }, ...data),
    ),
    ...(story.before?.(numbers, component) ?? []).map(({ title, body }) => block(title, body)),
    block(
      'Where each side wins',
      h(
        'ul',
        { 'data-wins': '', className: 'flex flex-col gap-1.5' },
        ...contenders.filter((contender) => won[contender.side].length).map((contender) => h(Fragment, { key: contender.side }, item(seriesDot(contender.side), winsSentence(contender.side, won[contender.side])))),
        won.even.length ? item(muted, evenSentence(won.even)) : null,
      ),
      h(
        'p',
        { className: 'mt-2 text-muted-foreground' },
        stops ? `How far each keeps up is read on both devices; the cards, at ${byDefault.label}, the default stop. Every number is under Compare, in the window’s status bar.` : 'The inputs are read on the fast device. Every number is under Compare, in the window’s status bar.',
      ),
    ),
    ...(story.after?.(numbers, component) ?? []).map(({ title, body }) => block(title, body)),
    numbers.citation ? block('The data', ...data) : null,
    block(
      'Where the canvas falls short',
      h(
        'ul',
        { className: 'flex flex-col gap-1.5' },
        item(null, 'On touch, a swipe scrolls GPUI’s table one way at a time; TanStack’s pans diagonally.'),
        item(null, 'DevTools’ device mode draws GPUI’s table zoomed; a real phone draws it normally.'),
      ),
      h('p', { className: 'mt-2 text-muted-foreground' }, 'More, and how each number is measured: ', h('a', { href: `${SOURCE}/tree/master/apps/observatory#canvas-tradeoffs`, className: link }, 'the observatory’s README'), '.'),
    ),
    others.length
      ? block(
          'Other scenarios',
          h(
            'ul',
            { 'data-others': '', className: 'grid gap-2 sm:grid-cols-2' },
            ...others.map((other) =>
              h(
                'li',
                { key: other.id },
                h('a', { href: scenarioPath(component, other), [SCENARIO_LINK]: '', className: 'flex flex-col gap-1 rounded-[10px] border px-3 py-2.5 hover:bg-accent' }, h('span', null, other.label), h('span', { className: 'text-xs text-muted-foreground' }, other.use)),
              ),
            ),
          ),
        )
      : null,
  );
}
