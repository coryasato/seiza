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

import { Check, ChevronDown, ChevronUp, Contrast, Database, Ellipsis, Info, Pause, Play, Type, X } from 'lucide-react';
import { createElement as h, Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { SOURCE } from '@seiza/site-ui/components/footer';
import cold from 'virtual:cold-numbers';
import type { Side } from '../../contenders/contract.ts';
import type { FollowMessage, FollowingMessage } from '../../contenders/follow.ts';
import { FONTS_LICENSE, SCRIPT_FACES } from '../../contenders/fonts/faces.ts';
import { SCRIPTS, SCRIPT_ROWS } from './scripts.ts';
import { SCRIPT_FONTS } from '../../contenders/paths.ts';
import { ADMIN_TABLE, MARKET_WATCH, MONITORING_WALL, oklchCss, type Scenario, type Stop } from '../../contenders/scenarios.ts';
import { DESK_ROWS } from '../../contenders/wall/desks.ts';
import { compact, listOf, millions, SCENARIO_LINK, scenarioCopy, scenarioPath, stopShort, WHY_ANCHOR, type Component, type Contender } from './components.ts';
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
import { ICON_BUTTON, PANEL_ID, seriesDot, stopSets, type FontsState } from './slot.ts';

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
  const dataLabel = scenarioCopy(scenario).dataLabel;
  const dataRowsText = `${rows.toLocaleString('en-US')} rows`;
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
    { 'data-status-ready': '', className: '@container flex h-full items-stretch justify-between' },
    h(
      'div',
      { className: 'flex min-w-0 items-stretch' },
      h('span', { className: 'inline-flex items-center gap-1.5 px-2.5 text-xs max-md:px-2 max-md:text-[13px]' }, seriesDot(side), shown.label),
      // What the data is and its rows; in a bar too narrow for both sides'
      // text (the wide sheet's needs ~1,010 px), an icon that opens them. A
      // phone has no room for either.
      h(
        'span',
        { 'data-file': '', className: 'inline-flex min-w-0 items-center gap-1.5 px-2.5 text-xs text-muted-foreground tabular-nums max-md:hidden @max-[1100px]:hidden' },
        h('span', { className: 'truncate text-foreground' }, dataLabel),
        h('span', { className: 'whitespace-nowrap' }, dataRowsText),
      ),
      h(
        'span',
        { className: 'hidden @max-[1100px]:flex max-md:hidden' },
        h(
          Explainer,
          {
            className: 'h-full',
            placement: 'above-start',
            width: 320,
            trigger: h(Database, { 'aria-hidden': true }),
            triggerProps: { 'aria-label': 'The data', 'data-file-icon': '', className: `${SEGMENT} min-w-9 justify-center` },
          },
          h('span', { className: 'text-foreground' }, dataLabel),
          h('span', { className: 'block text-muted-foreground tabular-nums' }, dataRowsText),
        ),
      ),
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

// ---------------------------------------------------------------- the follow toggle

/**
 * Live tail's follow toggle, beside the dial (`docs/DECISIONS.md`, "Page"):
 * a log tool's pause. The replay keeps running; only the view stops
 * following. "Pause" while the frame says its view follows; once it
 * doesn't (pressed, or the reader scrolled up), "Follow · <n> new rows",
 * the rows the clock set since following was let go; pressing it follows
 * again, which jumps to the newest. It shows what the frame says
 * (`FollowingMessage`), never what it asked: the frame hears the ask
 * (`FollowMessage`) with `?readout` only (`docs/contender-contract.md`,
 * "The follow toggle"). A phone's is its icon and the count.
 */
export function FollowToggle({ frame, disabled }: { frame: RefObject<HTMLIFrameElement | null>; disabled: boolean }) {
  const [following, setFollowing] = useState(true);
  const [count, setCount] = useState(0);
  /** The rows when following was let go. */
  const since = useRef<number | null>(null);
  useEffect(() => {
    const listen = (event: MessageEvent<Partial<FollowingMessage>>) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.seiza !== 'following') return;
      const { on, rows } = event.data;
      if (typeof on !== 'boolean' || typeof rows !== 'number') return;
      if (on) since.current = null;
      else since.current ??= rows;
      setFollowing(on);
      setCount(on ? 0 : Math.max(0, rows - since.current!));
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [frame]);
  const ask = () => {
    const message: FollowMessage = { seiza: 'follow', on: !following };
    frame.current?.contentWindow?.postMessage(message, location.origin);
  };
  return h(
    'button',
    {
      type: 'button',
      'data-follow': following ? 'on' : 'off',
      disabled,
      onClick: ask,
      title: following ? 'Stop following the newest rows; the replay keeps running' : 'Follow the newest rows again',
      className: 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13px] whitespace-nowrap hover:bg-accent disabled:opacity-50 disabled:hover:bg-background max-md:h-8 max-md:px-2 [&_svg]:size-3.5',
    },
    h(following ? Pause : Play, { 'aria-hidden': true }),
    h('span', { className: 'max-md:sr-only' }, following ? 'Pause' : 'Follow'),
    following
      ? null
      : h(
          'span',
          { 'data-follow-count': '', className: 'text-muted-foreground tabular-nums' },
          h('span', { className: 'max-md:sr-only' }, '· '),
          count.toLocaleString('en-US'),
          h('span', { className: 'max-md:sr-only' }, count === 1 ? ' new row' : ' new rows'),
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
  /** The admin table's fonts toggle on the shown side: its scripts row. */
  fonts: FontsState;
  onClose: () => void;
}

export function Panel({ id, contenders, scenario, stop, fonts, onClose }: PanelProps) {
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
  // Not a speed test: what each side can do, then the numbers the DOM wins.
  const capabilities = !!scenarioCopy(scenario).capabilities;
  return h(
    'section',
    { ref, id, tabIndex: -1, 'aria-label': capabilities ? 'What each side can do' : 'How they compare', className: 'absolute inset-0 z-10 flex flex-col overflow-hidden bg-background outline-none' },
    h(
      'div',
      { 'data-panel-header': '', 'data-edge': edge ? '' : undefined, className: 'relative z-[1] flex shrink-0 items-center gap-4 border-b border-transparent bg-background py-2.5 pr-3 pl-4 data-edge:border-border data-edge:shadow-[0_4px_12px_oklch(0_0_0/8%)] max-md:pr-2' },
      h(
        'div',
        { className: 'min-w-0 flex-1' },
        h('h2', { className: 'text-[15px]' }, capabilities ? `What each side can do: ${scenario.label}` : `How they compare: ${scenario.label}`),
        h(
          'p',
          { className: 'flex items-center gap-1 text-[13px] text-muted-foreground' },
          capabilities ? `The DOM’s scenario. Try each on both sides; the numbers below are cold, the middle of ${runs} loads.` : `The middle of ${runs} cold loads per side, on two devices`,
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
        : capabilities
          ? h(CapabilitiesBody, { scenario, numbers, live, contenders, fonts })
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

function DownloadCard({ scenario, numbers, contenders, span = true }: { scenario: Scenario; numbers: ScenarioCold; contenders: [Contender, Contender]; span?: boolean }) {
  const totals = contenders.map((contender) => downloadTotal(contender.side, numbers.parts, scenario)) as [number, number];
  const fast = outcome(totals, 'lower');
  return h(
    'div',
    { 'data-card': 'download', className: `${CARD} ${span ? '@3xl:col-span-2' : ''}` },
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

// ---------------------------------------------------------------- what each side can do

/** A capability's answer on a side: yes, partly, or no. */
type Answer = 'yes' | 'partly' | 'no';

interface Capability {
  key: string;
  what: string;
  /** What to try, on both sides. */
  how: string;
  gpui: Answer;
  /** Why, per side. */
  whyGpui: string;
  whyTanstack: string;
}

/** The six capabilities (the design canvas's), each one's answer as
 *  `perf/admin.ts` proves it; the scripts' with fonts loaded on GPUI. */
export function capabilities(fonts: FontsState): Capability[] {
  const right = SCRIPT_ROWS.filter((row) => row.right).length;
  const wrong = SCRIPT_ROWS.filter((row) => !row.right).map((row) => row.script);
  return [
    { key: 'find', what: 'Find a country with Ctrl+F', how: 'Search the page for “Ísland”.', gpui: 'no', whyGpui: 'The canvas holds no text the browser can search.', whyTanstack: 'The browser finds it and scrolls to it: every row is on the page.' },
    { key: 'select', what: 'Select and copy a capital', how: 'Drag across “Reykjavík”, then copy.', gpui: 'no', whyGpui: 'No text selection in this build.', whyTanstack: 'Native selection.' },
    { key: 'reader', what: 'Hear it with a screen reader', how: 'VoiceOver: Ctrl+Option+arrows through a row.', gpui: 'no', whyGpui: 'One image to the screen reader: no cell is named.', whyTanstack: 'A table, read cell by cell with its headers.' },
    fonts === 'on'
      ? { key: 'scripts', what: 'Every script drawn', how: 'Scroll to Sri Lanka, Thailand, Egypt.', gpui: 'partly', whyGpui: `With fonts: ${right} of ${SCRIPT_ROWS.length} scripts right. ${listOf(wrong, 'and')} draw a mark out of place (below).`, whyTanstack: 'The system’s fonts, shaped by the browser.' }
      : { key: 'scripts', what: 'Every script drawn', how: 'Scroll to Thailand, India, Egypt.', gpui: 'no', whyGpui: `One bundled face: ${SCRIPTS.length} scripts draw as boxes. Load fonts to see them shaped (below).`, whyTanstack: 'The system’s fonts, shaped by the browser.' },
    { key: 'flags', what: 'The flags', how: 'Look at the first column.', gpui: 'yes', whyGpui: 'The browser draws each flag into the canvas.', whyTanstack: 'The system’s emoji.' },
    { key: 'translate', what: 'Translate the page', how: 'Your browser’s Translate.', gpui: 'no', whyGpui: 'Nothing to translate.', whyTanstack: 'The names and headers translate.' },
  ];
}

const answer = (said: Answer) =>
  h(
    'span',
    { 'data-answer': said, className: `inline-flex items-center gap-1.5 ${said === 'no' ? 'text-muted-foreground' : ''} [&_svg]:size-3.5 [&_svg]:shrink-0` },
    h(said === 'yes' ? Check : said === 'partly' ? Contrast : X, { 'aria-hidden': true }),
    said === 'yes' ? 'Yes' : said === 'partly' ? 'Partly' : 'No',
  );

/** "The three": a count of the scripts drawn wrong, as the footnote says it. */
const capitalWord = (count: number) => `The ${['no script', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][count] ?? count}`;

/** A table's cell, a rule above it but the first row's. */
const CELL = 'flex min-w-0 flex-col justify-center gap-0.5 border-t px-3.5 py-2.5';
const HEAD = 'flex items-center gap-1.5 px-3.5 py-2.5 text-xs text-muted-foreground';

/**
 * The admin table's panel (the design canvas's "What each side can do"):
 * its verdict, the six capabilities, each script with fonts loaded, then
 * the cards the DOM wins and the fonts' own.
 */
function CapabilitiesBody({ scenario, numbers, live, contenders, fonts }: { scenario: Scenario; numbers: ScenarioCold; live: Live; contenders: [Contender, Contender]; fonts: FontsState }) {
  const cards = numbersOf(scenario).cards;
  const ready = cards.find((card) => card.key === 'usable')!;
  const memory = cards.find((card) => card.key === 'memory')!;
  const [buffer] = numbers.values[coldKey('canvas-buffer', 'reference')]!;
  // Of the runs each device measured (`runsMeasured`), not those asked for.
  const [fast, slow] = PROFILES.map((profile) => `${numbers.values[coldKey('memory-second', profile)]![0]} of ${numbers.values[coldKey('memory-runs', profile)]![0]}`);
  const secondLine = `Beyond the card: Chromium counted a second ${number(buffer!)} MiB buffer for GPUI’s canvas in ${fast} runs on a fast device and ${slow} on a slow one.`;
  const rows = capabilities(fonts);
  return h(
    'div',
    { 'data-capabilities': '', className: 'flex flex-col gap-4' },
    h('p', { 'data-verdict': '', className: 'text-sm leading-snug' }, 'Use the DOM for this. A few hundred rows of text need the browser’s own tools more than speed.'),
    h(
      'div',
      { role: 'table', 'aria-label': 'Capabilities', className: 'grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,9rem)] overflow-hidden rounded-[10px] border text-[13px] @2xl:grid-cols-[minmax(0,1fr)_160px_160px]' },
      h('div', { role: 'row', className: 'contents' }, h('span', { role: 'columnheader', className: HEAD }, 'Try it'), ...contenders.map((contender) => h('span', { key: contender.side, role: 'columnheader', className: HEAD }, seriesDot(contender.side), contender.label))),
      ...rows.map((row) =>
        h(
          'div',
          { key: row.key, role: 'row', 'data-capability': row.key, className: 'contents' },
          h('span', { role: 'cell', className: CELL }, h('span', null, row.what), h('small', { className: 'text-xs leading-snug text-muted-foreground' }, row.how)),
          h('span', { role: 'cell', 'data-side': 'gpui', className: CELL }, answer(row.gpui), h('small', { className: 'text-xs leading-snug text-muted-foreground' }, row.whyGpui)),
          h('span', { role: 'cell', 'data-side': 'tanstack', className: CELL }, answer('yes'), h('small', { className: 'text-xs leading-snug text-muted-foreground' }, row.whyTanstack)),
        ),
      ),
    ),
    h(
      'div',
      { className: 'flex flex-col gap-0.5' },
      h('h3', { className: 'text-sm' }, 'Every script, with fonts loaded'),
      h('p', { className: 'text-xs leading-snug text-muted-foreground' }, `GPUI with a Noto face for each of ${SCRIPT_FACES.length} scripts and the browser drawing Chinese and Korean, against the DOM’s drawing of the same names in the same faces. Load fonts in the window to see it.`),
    ),
    h(
      'div',
      {
        role: 'table',
        'aria-label': 'Each script on GPUI, with fonts loaded',
        'data-scripts': '',
        // "Drawn wrong" in the design canvas's red, market watch's fall per theme.
        style: Object.fromEntries((['light', 'dark'] as const).map((theme) => [`--wrong-${theme}`, oklchCss(MARKET_WATCH.signs[theme].down)])),
        className: 'grid grid-cols-[96px_minmax(0,1fr)_96px] overflow-hidden rounded-[10px] border text-[13px] @2xl:grid-cols-[110px_150px_120px_minmax(0,1fr)]',
      },
      h(
        'div',
        { role: 'row', className: 'contents' },
        h('span', { role: 'columnheader', className: HEAD }, 'Script'),
        h('span', { role: 'columnheader', className: HEAD }, 'A name in it'),
        h('span', { role: 'columnheader', className: HEAD }, seriesDot('gpui'), 'GPUI draws it'),
        h('span', { role: 'columnheader', className: `${HEAD} max-@2xl:hidden` }, 'Why'),
      ),
      ...SCRIPT_ROWS.map((row) =>
        h(
          'div',
          { key: row.script, role: 'row', 'data-script': row.script, className: 'contents' },
          h('span', { role: 'cell', className: CELL }, row.script),
          h('span', { role: 'cell', className: CELL }, row.name),
          h('span', { role: 'cell', 'data-right': row.right ? 'yes' : 'no', className: `${CELL} ${row.right ? '' : 'observatory-wrong'}` }, row.right ? 'Right' : 'Drawn wrong'),
          h('span', { role: 'cell', className: `${CELL} col-span-3 border-t-0 pt-0 text-xs leading-snug text-muted-foreground @2xl:col-span-1 @2xl:border-t @2xl:pt-2.5` }, row.why ?? 'The same shapes as the DOM’s.'),
        ),
      ),
    ),
    h(
      'p',
      { className: 'text-xs leading-snug text-muted-foreground' },
      `GPUI’s text system shapes every script here right. ${capitalWord(SCRIPT_ROWS.filter((row) => !row.right).length)} drawn wrong ${SCRIPT_ROWS.filter((row) => !row.right).length === 1 ? 'is' : 'are'} its glyph placement: the text renderer in gpui-kit ${numbers.versions.find(([name]) => name === 'gpui-kit')?.[1].join(' and ') ?? ''} drops the font’s mark offsets, so a mark the font moves draws where the pen is. Latin, Greek, and Cyrillic draw in the bundled face, unaffected.`,
    ),
    h(
      'div',
      { className: 'grid gap-3 @3xl:grid-cols-2 @5xl:grid-cols-4' },
      h(StatCard, { key: 'usable', card: ready, values: numbers.values, live, contenders }),
      h(DownloadCard, { key: 'download', scenario, numbers, contenders, span: false }),
      h(StatCard, { key: 'memory', card: memory, values: numbers.values, note: secondLine, live, contenders }),
      h(FontsCard, { key: 'fonts', numbers, contenders }),
    ),
  );
}

/** The fonts toggle's card: the faces' bytes against TanStack's none, with
 *  Scripts drawn in and memory with them in its note (GPUI's alone). */
function FontsCard({ numbers, contenders }: { numbers: ScenarioCold; contenders: [Contender, Contender] }) {
  const gpui = (metric: string, profile: Profile = 'reference') => numbers.gpui[coldKey(metric, profile)]!;
  const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const [bytes, unit] = size(gpui('fonts-bytes')).split(' ') as [string, string];
  const ofRuns = (profile: Profile) => `${gpui('fonts-second', profile)} of ${gpui('fonts-runs', profile)}`;
  return h(
    'div',
    { 'data-card': 'fonts', className: CARD },
    h(CardHead, {
      label: 'Fonts for these scripts',
      explain: `What GPUI fetches to draw every script in the file: a Noto face for each of ${SCRIPT_FACES.length}, whole, brotli as sent, once its rows are in. TanStack has the system’s fonts. Scripts drawn in: from the page starting to load to the first frame on screen drawn with the faces. Memory with them: after the same scroll down and back as the Memory card, less every canvas buffer.`,
      note: 'lower is better',
    }),
    h('span', { 'data-verdict': '', className: 'text-sm leading-snug' }, 'TanStack needs none'),
    h(
      'div',
      { className: 'grid grid-cols-2 items-baseline gap-x-2.5' },
      ...sideHeads(contenders),
      h('span', { className: CAPTION }, 'Either device'),
      ...contenders.map((contender) =>
        h(Fragment, { key: contender.side }, contender.side === 'gpui' ? big(bytes, unit, false, { 'data-cold-reference': 'gpui' }) : big('none', '', true, { 'data-cold-reference': 'tanstack' })),
      ),
    ),
    h(
      'span',
      { 'data-card-note': '', className: 'text-[11px] leading-snug text-muted-foreground' },
      `GPUI’s ${SCRIPT_FACES.length} faces, fetched once the rows are in: every script drawn ${seconds(gpui('fonts-drawn'))} after the page starts (${seconds(gpui('fonts-drawn', 'throttled'))} on a slow device); memory with them ${number(gpui('fonts-memory'))} MiB (${number(gpui('fonts-memory', 'throttled'))} on a slow device). The canvas held a second buffer in ${ofRuns('reference')} runs with them on a fast device, ${ofRuns('throttled')} on a slow one.`,
    ),
  );
}

/**
 * The admin table's fonts toggle (`docs/DECISIONS.md`, "Page", 2026-11-09),
 * where a dial would be, after first paint (as live tail's follow toggle):
 * on GPUI a pressed or unpressed button that reloads its side with the
 * script faces, or without them again; disabled while a load or the faces
 * are coming. On TanStack it stays, disabled, so the title bar doesn't
 * shift on a flip: the browser draws every script with the system's fonts.
 * The window keeps its state (`slot.ts`).
 */
export function FontsToggle({ gpui, state, busy, faces, toggle }: { gpui: boolean; state: FontsState; busy: boolean; faces: number; toggle: () => void }) {
  const [long, short] = !gpui || state === 'off' ? ['Load fonts for these scripts', gpui ? 'Load fonts' : 'Fonts'] : state === 'loading' ? ['Loading fonts…', 'Loading fonts…'] : state === 'on' ? ['Fonts loaded', 'Fonts on'] : ['The fonts didn’t load', 'Fonts failed'];
  return h(
    'span',
    { className: 'flex shrink-0 items-center gap-0.5' },
    h(
      'button',
      {
        type: 'button',
        'data-fonts': state,
        'aria-pressed': gpui && state !== 'off',
        disabled: !gpui || busy || state === 'loading',
        onClick: toggle,
        className: 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13px] whitespace-nowrap hover:bg-accent aria-pressed:bg-accent disabled:opacity-50 disabled:hover:bg-background max-md:h-8 max-md:px-2 [&_svg]:size-3.5 [&_svg]:text-muted-foreground',
      },
      h(Type, { 'aria-hidden': true }),
      h('span', { className: 'max-md:hidden' }, long),
      h('span', { className: 'md:hidden' }, short),
    ),
    info('About the fonts', h(FontsAbout, { gpui, faces })),
  );
}

/** The fonts toggle's explainer: what it loads, its cold bytes. */
function FontsAbout({ gpui, faces }: { gpui: boolean; faces: number }) {
  const numbers = cold.scenarios[ADMIN_TABLE.id];
  const bytes = numbers?.gpui[coldKey('fonts-bytes', 'reference')];
  const rows: [string, string][] = [
    [`${faces} Noto faces, whole`, bytes === undefined ? '—' : size(bytes)],
    ['Chinese, Japanese, Korean', 'drawn by the browser'],
    ['Fetched', 'after the rows are in'],
  ];
  return h(
    Fragment,
    null,
    gpui
      ? `GPUI’s app ships one face, IBM Plex Sans: Latin, Greek, and Cyrillic. Loading fonts reloads this side; once the rows are in, it fetches a Noto face for each of the ${faces} other scripts in the file and draws the table again. Press again to reload without them.`
      : 'TanStack has nothing to load: the browser draws every script with your system’s fonts. Flip to GPUI to try it.',
    h('span', { 'data-fonts-rows': '', className: 'mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-muted-foreground' }, ...rows.flatMap(([what, how]) => [h('span', { key: what }, what), h('span', { key: `${what}:how`, className: 'text-right text-foreground' }, how)])),
    h('span', { className: 'mt-2 block text-muted-foreground' }, 'As an app loads a face when its text needs one. The faces are under the SIL Open Font License.'),
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
  /** More to credit beside the data (the admin table's script faces). */
  credits?: ReactNode[];
  /** Where the canvas falls short in this scenario, beyond every scenario's. */
  shortfalls?: string[];
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
        'Cost per cell: the DOM pays style, layout, and paint for each cell’s element, so its frames grow with the cells on screen, while the GPU draws them all as quads and glyphs. That’s the canvas’s doing rather than WebAssembly’s, and the two aren’t measured apart yet. WebAssembly’s part is decoding and formatting each visible cell. The platform’s tools are the DOM’s here as everywhere: it downloads less and is ready sooner. ',
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
          'Garbage under churn: each tick makes new objects on the DOM side, and the page pauses to collect them, more often the faster the feed; GPUI’s store is Rust’s plain buffers, which make none. That’s WebAssembly’s doing rather than the canvas’s. Cost per cell: the DOM renders only the rows a tick moved, while the GPU draws the whole screen each frame, so at the lower stops the DOM does less. The platform’s tools are the DOM’s here as everywhere: it downloads less and is ready sooner. ',
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
          'Garbage under a growing table: the DOM side makes new objects for each page it reads and each row it renders, and its page spends longer paused collecting them; GPUI’s pages are Rust’s plain buffers. That’s WebAssembly’s doing rather than the canvas’s. Cost per cell matters less here than on the wide sheet: each frame only a few rows are new, so the two sides spend about the same time on a frame, and where the rows come faster than a slow device can draw them, both fall behind. A scroll back is the DOM’s: the browser moves its page on the compositor before the page’s own thread hears of it. The platform’s tools are the DOM’s here as everywhere: it downloads less and is ready sooner. ',
          h('a', { href: `${component.path}#${WHY_ANCHOR}`, className: 'text-foreground underline underline-offset-4' }, `What each one means, on the ${component.label} page`),
          '.',
        ),
      },
    ],
    terms: 'The Internet Traffic Archive’s terms: “The traces may be freely redistributed.” The visitors’ hosts are left out, every query string is cut, and a request naming a person is dropped.',
  },
  'monitoring-wall': {
    shows: (numbers) =>
      `An ops screen: a network operations wall, a trading floor’s desks, live sports. Several small tables share one frame, all updating at once. Here each table is a desk of ${DESK_ROWS} fictional instruments, from a file of ${numbers.rows}, every price changed in place and each change flashing. One seeded feed, the same on both sides, runs in a worker of each side’s own and sends every desk’s ticks as the same bytes, ${compact(MONITORING_WALL.rate)} updates a second a table; each side folds every tick into its own store, none dropped, and draws every table once a frame. Each stop of the dial adds tables. GPUI draws them all on one canvas; TanStack renders a tree of elements for each. The instruments come from one small file, opened by the same database engine; their symbols, their prices, and the feed are made up.`,
    after: (_, component) => [
      {
        title: 'Why',
        body: h(
          'p',
          null,
          'Cost per cell, times the tables: each frame the DOM restyles and repaints every cell a tick changed in every table, so its frames grow with the tables, while the GPU draws the whole canvas as quads and glyphs. That’s the canvas’s doing rather than WebAssembly’s. Garbage under churn: each tick makes new objects on the DOM side, and the page pauses to collect them; GPUI’s store is Rust’s plain buffers, which make none. That’s WebAssembly’s. The platform’s tools are the DOM’s here as everywhere: it downloads less and is ready sooner. ',
          h('a', { href: `${component.path}#${WHY_ANCHOR}`, className: 'text-foreground underline underline-offset-4' }, `What each one means, on the ${component.label} page`),
          '.',
        ),
      },
    ],
    shortfalls: ['On a phone, GPUI’s column of tables scrolls only from a table’s title or a gap between tables, since a swipe over a table scrolls that table; TanStack’s scrolls on from a table that reaches its end.'],
  },
  'admin-table': {
    shows: (numbers) =>
      `The table in almost every app: a few hundred rows of text. Here it’s the world’s ${numbers.rows} countries and territories, each named in its own language and script, then in English, with its capital and its population. Both sides read it from one small file through the same database engine, and both scroll it smoothly: this scenario isn’t about speed. Try the browser’s own tools on each side (find, select and copy, a screen reader, Translate), and look at the scripts. GPUI draws its text itself, from the one face it bundles; “Load fonts for these scripts” loads a face for each script the file holds, as an app would, and the window’s Compare says which it draws right.`,
    after: (_, component) => [
      {
        title: 'Why',
        body: h(
          'p',
          null,
          'The platform’s tools: the DOM’s text is the page’s own, so the browser can find it, select it, translate it, and hand it to a screen reader, and it draws every script with the system’s fonts. A canvas’s text is pixels: GPUI shapes and draws it itself, from the faces it has, and shows the browser none of it. The platform’s tools also give the DOM fewer bytes and a sooner start. Scrolling off the main thread is the DOM’s too, though a few hundred rows are light enough that both keep up. ',
          h('a', { href: `${component.path}#${WHY_ANCHOR}`, className: 'text-foreground underline underline-offset-4' }, `What each one means, on the ${component.label} page`),
          '.',
        ),
      },
    ],
    credits: [
      h(
        'p',
        { key: 'faces', 'data-credit-faces': '', className: 'mt-1 text-muted-foreground' },
        `The fonts toggle’s ${SCRIPT_FACES.length} faces: Noto, by the Noto Project Authors, under the SIL Open Font License 1.1 (`,
        h('a', { href: `${SCRIPT_FONTS}${FONTS_LICENSE}`, className: 'text-foreground underline underline-offset-4' }, 'their license'),
        ').',
      ),
    ],
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
    ...(story.credits ?? []),
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
        stops
          ? `How far each keeps up is read on both devices; the cards, at ${byDefault.label}, the default stop. Every number is under Compare, in the window’s status bar.`
          : scenarioCopy(scenario).capabilities
            ? 'What each side can do is checked by a script on both sides; the numbers are read on both devices. All of it is under Compare, in the window’s status bar.'
            : 'The inputs are read on the fast device. Every number is under Compare, in the window’s status bar.',
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
        ...(story.shortfalls ?? []).map((text) => h(Fragment, { key: text }, item(null, text))),
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
