/**
 * What the page's numbers show (`docs/DECISIONS.md`, "Page"), per scenario:
 * the window's status bar segments and the panel's cards, each a metric of
 * `perf/budgets.json` with its reading in this tab; Big file's
 * input-to-response chart, cold only; a scenario with stops' keeps-up
 * charts and its cards at a stop; the Download card's parts, each a value
 * in `perf/results/`; and the words that compare them (each card's
 * verdict, the keeps-up verdict, the description's "where each side
 * wins"). Pure: the build's plugin (`../cold.ts`) and `perf/page.ts` read
 * it too.
 */

import { KEEPS_UP_SHARE, SCROLLS, type LiveReadings } from '../../metrics/metrics.ts';
import type { Source } from '../../../../shared-web/scripts/results.ts';
import type { Side } from '../../contenders/contract.ts';
import { BIG_FILE, MARKET_WATCH, WIDE_SHEET, type Scenario, type Stop } from '../../contenders/scenarios.ts';
import { isDensity, isRate, stopShort } from './components.ts';

export type Profile = 'reference' | 'throttled';
export const PROFILES: Profile[] = ['reference', 'throttled'];

/** What the page calls each profile. */
export const DEVICES: Record<Profile, string> = { reference: 'Fast device', throttled: 'Slow device' };

export interface Card {
  /** The segment's and the card's key, and its explainer's: a status bar
   *  card's one of `SEGMENTS`. */
  key: string;
  /** A `perf/budgets.json` metric, less its scenario's prefix and its
   *  profile (`<metric>-<profile>`), and its stop's (`<stop>-<metric>-…`)
   *  when `perStop`. */
  metric: string;
  /** Measured at each of the scenario's stops. */
  perStop?: boolean;
  /** The status bar's label, and the card's. */
  segment: string;
  label: string;
  /** A count has none (''). */
  unit: 'ms' | '%' | 'MiB' | '';
  better: 'lower' | 'higher';
  /** The cold value as shown: Smoothness is the frames on time, 100 less the
   *  late share. The verdict judges the metric as measured (`cardOutcome`). */
  shown: (cold: number) => number;
  /** The value the verdict judges, lower is better: the metric as measured,
   *  unless measured higher-is-better (a share of frames drawn). */
  judged?: (cold: number) => number;
  /** The verdict's word for the winner ("TanStack 3.4× faster"). */
  word: string;
  /** Whether the verdict says how many times: not for a share. */
  ratio: boolean;
  /** Its reading in this tab, as shown, or null where there's none yet;
   *  none for a card with no reading in this tab (its row left out). */
  live?: (readings: LiveReadings) => number | null;
  /** Said in this tab before there's a reading: "—" in the status bar. */
  waiting?: string;
  /** Under the card's label, above the cold values (the fast device's caption). */
  caption?: string;
  /** The explainer: what the number means, then how it's measured. */
  explain: string;
  /** Its metric's fastest and slowest runs (`<metric>-min`, `<metric>-max`):
   *  a side wins only where the two sides' runs don't overlap (Shown in's
   *  rule, `docs/DECISIONS.md`, "Measurement"). */
  apart?: boolean;
}

const on = (share: number) => Number((100 - share * 100).toFixed(1));

/** The cards, in the status bar's order; the panel adds Download. */
export const CARDS: Card[] = [
  {
    key: 'usable',
    metric: 'usable',
    segment: 'Ready in',
    label: 'Ready in',
    unit: 'ms',
    better: 'lower',
    shown: (cold) => cold,
    word: 'faster',
    ratio: true,
    live: (readings) => readings.usableMs,
    waiting: 'loading',
    explain: 'How long until the table takes your keys and scrolls, from the page starting to load. The cold runs confirm it with a key press; this tab reads the table’s own mark.',
  },
  {
    key: 'data',
    metric: 'data',
    segment: 'Rows in',
    label: 'Rows in',
    unit: 'ms',
    better: 'lower',
    shown: (cold) => cold,
    word: 'faster',
    ratio: true,
    live: (readings) => readings.dataMs,
    waiting: 'loading',
    explain: 'How long until every row you can see shows real data, from the database engine being ready.',
  },
  {
    key: 'smooth',
    metric: 'fling-late',
    segment: 'Smooth',
    label: 'Smoothness',
    unit: '%',
    better: 'higher',
    shown: (cold) => Number((100 - cold).toFixed(1)),
    word: 'smoother',
    ratio: false,
    live: (readings) => (readings.scrolling ? on(readings.scrolling.lateShare) : null),
    waiting: 'scroll to measure',
    caption: 'A fling to the last row',
    explain:
      'The share of frames on time while you scroll. A frame is late when it takes longer than one and a half of your display’s frames: 25 ms at 60 Hz, 12.5 ms at 120 Hz. Counted on the page’s own thread: a DOM table keeps scrolling on the browser’s while its own frames run late. Cold: a scripted fling to the last row.',
  },
  {
    key: 'memory',
    metric: 'memory-equal',
    segment: 'Memory',
    label: 'Memory',
    unit: 'MiB',
    better: 'lower',
    shown: (cold) => cold,
    word: 'less',
    ratio: true,
    live: (readings) => readings.pageMiB,
    waiting: 'measuring',
    caption: 'After reading the same pages',
    explain:
      'What the table’s page holds, the database engine’s workers apart (Chrome only), less GPUI’s canvas, which holds one window-sized image or more. GPUI’s WebAssembly memory never shrinks, and neither side’s counts the GPU’s. Cold: after both read the same pages; this tab’s is now, after your scrolling.',
  },
];

/** The status bar's segments, in order: every scenario's cards have these keys. */
export const SEGMENTS = CARDS.map((card) => card.key);

const card = (key: string): Card => CARDS.find((candidate) => candidate.key === key)!;
const drawn = (cold: number) => 100 - cold;
const { down, sideways, fast } = SCROLLS;
const px = (value: number) => Math.abs(value).toLocaleString('en-US');

/** The wide sheet's status bar: Big file's vocabulary, its cold numbers
 *  the scenario's (Smooth at the window's stop, as "keeps up" reads it). */
export const WIDE_CARDS: Card[] = [
  { ...card('usable'), metric: 'usable' },
  { ...card('data'), metric: 'data' },
  {
    ...card('smooth'),
    metric: 'keeps',
    perStop: true,
    shown: (cold) => cold,
    judged: drawn,
    caption: undefined,
    explain:
      `The share of frames on time while you scroll: a frame is late when it takes longer than one and a half of your display’s frames. Counted on the page’s own thread. Cold: the share of the display’s frames that drew new cells in a steady scroll at this stop, down (${px(down.speed)} px/s) and sideways (${px(sideways.speed)} px/s), the slower of the two.`,
  },
  {
    ...card('memory'),
    metric: 'memory',
    caption: 'After reading the file and a sideways session',
    explain:
      'What the table’s page holds, the database engine’s workers apart (Chrome only), less GPUI’s canvas, which holds one window-sized image or more. GPUI’s WebAssembly memory never shrinks, and neither side’s counts the GPU’s. Cold: after both read the whole file, then scroll across every day and back five times, at the default stop; this tab’s is now, after your scrolling.',
  },
];

/** The wide sheet's cards at a stop, under its keeps-up charts: the fast
 *  fling, work per frame, and memory (measured once, at the default stop). */
export const WIDE_STOP_CARDS: Card[] = [
  {
    key: 'fling',
    metric: 'fast',
    perStop: true,
    segment: 'Smooth',
    label: 'Smoothness',
    unit: '%',
    better: 'higher',
    shown: (cold) => cold,
    judged: drawn,
    word: 'smoother',
    ratio: false,
    caption: 'A fast fling',
    explain: `The share of the display’s frames that drew new cells in a fast fling down: ${px(fast.y)} px at ${px(fast.speed)} px/s, past what a steady scroll asks. Not part of “keeps up”: a fling this fast is a jump, not reading.`,
  },
  {
    key: 'work',
    metric: 'down-work',
    perStop: true,
    segment: 'Work',
    label: 'Work per frame',
    unit: 'ms',
    better: 'lower',
    shown: (cold) => cold,
    word: 'less work',
    ratio: true,
    caption: 'Scrolling down, p95',
    explain: `The main thread’s time in each frame that drew new cells, the 95th percentile, in the steady scroll down (${px(down.speed)} px/s): its layout, its drawing, and GPUI’s present. Past one display frame, frames are skipped.`,
  },
  { ...WIDE_CARDS.find((card) => card.key === 'memory')!, caption: 'After the sideways session' },
];

/** "Shown in"'s explainer: what it reads in this tab and cold. */
const SHOWN_EXPLAIN =
  'From the feed sending a price change to the first frame that draws it: in this tab, the middle of the last 5 seconds, from the frame’s own clock. The feed stamps each batch as it sends it, and the side notes the frame that first draws it. Cold: the middle run’s median, to the frame on screen, at this stop. A side is faster only where its runs and the other’s don’t overlap.';

/** Market watch's status bar (the design canvas's): Ready in, Shown in,
 *  Smooth, and Memory; Shown in and Smooth at the window's stop. */
export const MARKET_CARDS: Card[] = [
  { ...card('usable'), metric: 'usable' },
  {
    key: 'shown',
    metric: 'shown',
    perStop: true,
    segment: 'Shown in',
    label: 'Update shown in',
    unit: 'ms',
    better: 'lower',
    shown: (cold) => cold,
    word: 'faster',
    ratio: true,
    apart: true,
    live: (readings) => readings.shownMs,
    waiting: 'waiting for the feed',
    caption: 'The middle of the batches',
    explain: SHOWN_EXPLAIN,
  },
  {
    ...card('smooth'),
    metric: 'late',
    perStop: true,
    live: (readings) => (readings.scrolling ? on(readings.scrolling.lateShare) : null),
    waiting: 'measuring',
    caption: 'Under the feed',
    explain:
      'The share of frames on time while the feed runs and you scroll. A frame is late when it takes longer than one and a half of your display’s frames: 25 ms at 60 Hz, 12.5 ms at 120 Hz. Counted on the page’s own thread. Cold: 10 seconds of the feed at this stop.',
  },
  {
    ...card('memory'),
    metric: 'memory',
    caption: 'After the feed’s 10,000 ticks',
    explain:
      'What the table’s page holds, the database engine’s workers apart (Chrome only), less GPUI’s canvas, which holds one window-sized image or more. GPUI’s WebAssembly memory never shrinks, and neither side’s counts the GPU’s. Cold: once each side has drawn the feed’s first 10,000 ticks, at the default stop; this tab’s is now.',
  },
];

/** Market watch's cards at a stop, under its keeps-up charts (the design
 *  canvas's): Smoothness, Update shown in, and Collection pauses in 10 s. */
export const MARKET_STOP_CARDS: Card[] = [
  { ...MARKET_CARDS.find((card) => card.key === 'smooth')!, live: undefined },
  { ...MARKET_CARDS.find((card) => card.key === 'shown')!, live: undefined },
  {
    key: 'collections',
    metric: 'collections',
    perStop: true,
    segment: 'Collections',
    label: 'Collection pauses in 10 s',
    unit: '',
    better: 'lower',
    shown: (cold) => cold,
    word: 'pauses less',
    ratio: false,
    caption: 'Under the feed',
    explain:
      'How often the page’s garbage collector ran in 10 seconds of the feed: JavaScript’s objects are collected, and each collection pauses the page’s thread; WebAssembly’s memory isn’t collected. Read from Chromium’s trace, cold; a page can’t read them.',
  },
];

/** A scenario's status bar cards. */
export const cardsOf = (scenario: Scenario): Card[] => numbersOf(scenario).cards;

/** A scenario's metrics' prefix in `perf/budgets.json`: none for the base
 *  level's, whose results are Big file's (`resultLabel`). */
export const metricPrefix = (scenario: Scenario): string => (scenario.level === 'base' ? '' : `${scenario.id}-`);

/** A cold value's key in a scenario's numbers: its metric less the
 *  scenario's prefix, its stop's first when measured per stop. */
export const coldKey = (metric: string, profile: Profile, stop?: string): string => (stop ? `${stop}-${metric}-${profile}` : `${metric}-${profile}`);
const cardKey = (card: Card, profile: Profile, stop?: string, metric = card.metric) => coldKey(metric, profile, card.perStop ? stop : undefined);


/** The chart's rows: input to visible response, cold. `native`: the rows a
 *  DOM side answers by the browser's own scrolling, which the CPU throttle
 *  doesn't slow (the chart's footnote). */
export const BARS: { metric: string; label: string; input: Input; reading: 'moves' | 'fills'; native: boolean }[] = [
  { metric: 'key', label: 'Key press → table moves', input: 'key', reading: 'moves', native: false },
  { metric: 'track', label: 'Scrollbar press → table moves', input: 'track', reading: 'moves', native: true },
  { metric: 'track-real', label: 'Scrollbar press → rows filled', input: 'track', reading: 'fills', native: false },
  { metric: 'wheel', label: 'Wheel → table moves', input: 'wheel', reading: 'moves', native: true },
  { metric: 'wheel-real', label: 'Wheel → rows filled', input: 'wheel', reading: 'fills', native: false },
];

type Input = 'key' | 'track' | 'wheel';
const INPUTS: Record<Input, string> = { key: 'a key', track: 'a scrollbar press', wheel: 'a wheel' };

/** The device the description's input wins are read on. */
export const CHART_DEVICE: Profile = 'reference';

/** The chart's fixed scale, ms: both devices on one. */
export const CHART_MS = 50;

/** Every budgets.json metric a scenario's page shows, each with its key
 *  in the scenario's numbers (`coldKey`). */
export function metricsOf(scenario: Scenario): { id: string; key: string }[] {
  const { once, perStop } = numbersOf(scenario);
  const keys = [...once.flatMap((metric) => PROFILES.map((profile) => coldKey(metric, profile))), ...scenario.stops.flatMap((stop) => perStop.flatMap((metric) => PROFILES.map((profile) => coldKey(metric, profile, stop.id))))];
  return keys.map((key) => ({ id: `${metricPrefix(scenario)}${key}`, key }));
}

/** The values a scenario's numbers derive from the measured ones: at each
 *  stop, "keeps up"'s share, the slower of the steady scrolls (`keepsUp`). */
export function derive(scenario: Scenario, values: ScenarioCold['values']): ScenarioCold['values'] {
  // A feed's keeps up is measured as one share (`metric feed`).
  if (!numbersOf(scenario).stopCards || scenario.level !== 'wide') return values;
  const out = { ...values };
  for (const stop of scenario.stops)
    for (const profile of PROFILES) {
      const [d, w] = [values[coldKey('down', profile, stop.id)]!, values[coldKey('sideways', profile, stop.id)]!];
      out[coldKey('keeps', profile, stop.id)] = [Math.min(d[0], w[0]), Math.min(d[1], w[1])];
    }
  return out;
}

/** The Download card: each side's page as fetched, brotli, by file and
 *  part (`metric memory`'s wire bytes, `gpui-parts`' wasm by crate,
 *  `tanstack-sizes`' JS by chunk). The engine and the data
 *  are the same files on both sides, and left out. */
export interface Part {
  id: string;
  label: string;
  /** Inside the one above it, not counted again. */
  within?: boolean;
}

const wire = (side: Side, kind: string, glob = '*-memory.json'): Source => ({ glob, path: `profiles.reference.${side}.summary.bytesKiB.${kind}` });
const crate = (index: number, part: string): Source => ({ glob: '*-gpui-parts.json', path: `parts.${index}.brotliKiB`, where: { [`parts.${index}.part`]: part } });

export const PART_SOURCES: Record<string, Source> = {
  'gpui.wasm': wire('gpui', 'wasm'),
  'gpui.framework': crate(0, 'framework'),
  'gpui.component': crate(1, 'component'),
  'gpui.data': crate(2, 'data layer'),
  'gpui.js': wire('gpui', 'js'),
  'gpui.html': wire('gpui', 'html'),
  'gpui.font': wire('gpui', 'font'),
  'tanstack.js': wire('tanstack', 'js'),
  'tanstack.first': { glob: '*-tanstack-sizes.json', path: 'firstPaintJsBrotliKiB' },
  'tanstack.data': { glob: '*-tanstack-sizes.json', path: 'dataLayerJsBrotliKiB' },
  'tanstack.css': wire('tanstack', 'css'),
  'tanstack.html': wire('tanstack', 'html'),
  'tanstack.font': wire('tanstack', 'font'),
};

export const PARTS: Record<Side, Part[]> = {
  gpui: [
    { id: 'gpui.wasm', label: 'WebAssembly' },
    { id: 'gpui.framework', label: 'the framework', within: true },
    { id: 'gpui.data', label: 'the data layer', within: true },
    { id: 'gpui.component', label: 'the component', within: true },
    { id: 'gpui.js', label: 'JS' },
    { id: 'gpui.html', label: 'HTML' },
    { id: 'gpui.font', label: 'The font' },
  ],
  tanstack: [
    { id: 'tanstack.js', label: 'JS' },
    { id: 'tanstack.first', label: 'the first screen', within: true },
    { id: 'tanstack.data', label: 'the data layer and Arrow', within: true },
    { id: 'tanstack.css', label: 'CSS' },
    { id: 'tanstack.html', label: 'HTML' },
    { id: 'tanstack.font', label: 'The font' },
  ],
};

/** A scenario's page as fetched, by file alone, from its memory run at its
 *  default stop (`metric memory` on its level's builds): Big file's files,
 *  their parts within them left out, which only Big file's builds are split
 *  into. */
const filesOf = (scenario: Scenario): { parts: Record<Side, Part[]>; sources: Record<string, Source> } => {
  const glob = `*-memory-${scenario.id}-${scenario.defaultStop}.json`;
  const parts = Object.fromEntries((['gpui', 'tanstack'] as const).map((side) => [side, PARTS[side].filter((part) => !part.within)])) as Record<Side, Part[]>;
  const sources = Object.fromEntries(Object.values(parts).flatMap((list) => list.map((part) => { const [side, kind] = part.id.split('.') as [Side, string]; return [part.id, wire(side, kind, glob)]; })));
  return { parts, sources };
};

/** What a scenario's page shows of its numbers: its status bar cards, its
 *  metrics measured once and at each stop (`metricsOf`), its Download
 *  parts, and, for a scenario with stops, its cards at a stop under the
 *  keeps-up charts (Big file's panel without them: its cards and chart). */
interface ScenarioNumbers {
  cards: Card[];
  /** The status bar's cards on a phone; the rest go in its overflow menu. */
  phone: string[];
  once: string[];
  perStop: string[];
  parts: Record<Side, Part[]>;
  sources: Record<string, Source>;
  stopCards?: Card[];
  /** A scenario with stops: what "keeps up" reads at a stop, in the panel's
   *  explainer and its chart's label, and its win in "where each side wins". */
  keeps?: { reads: string; explain: string; won: string };
}

/** The status bar's cards on a phone, by default. */
const PHONE = ['smooth', 'memory'];

const NUMBERS: Record<string, ScenarioNumbers> = {
  [BIG_FILE.id]: { cards: CARDS, phone: PHONE, once: [...CARDS, ...BARS].map(({ metric }) => metric), perStop: [], parts: PARTS, sources: PART_SOURCES },
  [WIDE_SHEET.id]: {
    cards: WIDE_CARDS,
    phone: PHONE,
    once: ['usable', 'data', 'memory'],
    perStop: ['down', 'sideways', 'fast', 'down-work'],
    ...filesOf(WIDE_SHEET),
    stopCards: WIDE_STOP_CARDS,
    keeps: {
      reads: 'the share of the display’s frames that drew new cells',
      explain: 'of the display’s frames draw new cells in a steady scroll down and in one sideways; the slower of the two is drawn. GPUI’s frames are those it presents; the DOM’s, those its page renders rows in.',
      won: 'keeps up with more cells on screen',
    },
  },
  [MARKET_WATCH.id]: {
    cards: MARKET_CARDS,
    // The design canvas's phone: Shown in and Smooth.
    phone: ['shown', 'smooth'],
    once: ['usable', 'memory'],
    perStop: ['keeps', 'late', 'shown', 'shown-min', 'shown-max', 'collections'],
    ...filesOf(MARKET_WATCH),
    stopCards: MARKET_STOP_CARDS,
    keeps: {
      reads: 'the share of the feed’s batches shown in a frame of their own',
      explain: 'of the feed’s batches that change a row on screen are each shown in a frame of their own (over the display’s frames, where batches outnumber them), in 10 seconds of the feed. GPUI’s frames are those it presents; the DOM’s, those its page renders rows in.',
      won: 'keeps up with more updates a second',
    },
  },
};

/** A scenario's numbers' shape; a scenario without one fails the build (`cold.ts`). */
export function numbersOf(scenario: Scenario): ScenarioNumbers {
  const numbers = NUMBERS[scenario.id];
  if (!numbers) throw new Error(`no numbers for scenario ${scenario.id} (readouts.ts)`);
  return numbers;
}

/** A scenario's Download parts and where each is measured. */
export const partSourcesOf = (scenario: Scenario): Record<string, Source> => numbersOf(scenario).sources;
export const partsOf = (scenario: Scenario): Record<Side, Part[]> => numbersOf(scenario).parts;

/** A scenario's cold numbers, resolved at build time. */
export interface ScenarioCold {
  /** Each metric's GPUI and TanStack medians, by `coldKey`, with the
   *  values `derive` adds. */
  values: Record<string, [number, number]>;
  /** The Download card's parts, KiB. */
  parts: Record<string, number>;
  /** The data file's rows (`data/MANIFEST.json`). */
  rows: number;
  /** The data file's credit, license, and citation (`data/MANIFEST.json`). */
  credit: string;
  license: string | null;
  citation: string | null;
  /** The metrics' results files' runs per median, and machine. */
  runs: number[];
  cpus: string[];
  /** What the results were measured with (`machineInfo().versions`), each
   *  package's versions across the files; empty unless every file records them. */
  versions: [string, string[]][];
}

/** The cold numbers, resolved at build time (`virtual:cold-numbers`): each
 *  scenario's with them (`hasCold`). */
export interface ColdNumbers {
  scenarios: Record<string, ScenarioCold>;
}

// ---------------------------------------------------------------- words

/** Two cold medians this close (relative) read as even: inside the runs'
 *  own spread, which the protocol holds under 6%. */
export const EVEN = 0.05;

/** A number as the page prints it: whole above 100, else one decimal at most. */
export const number = (value: number): string => (Math.abs(value) >= 100 ? String(Math.round(value)) : String(Number(value.toFixed(1))));

/** A reading with its unit: "41.7 ms", "99.1 %". */
export const withUnit = (value: number, unit: string): string => (unit ? `${number(value)} ${unit}` : number(value));

/** KiB as a page size: MiB from 1 MiB, one decimal; whole KiB below. */
export const size = (kib: number): string => (kib >= 1024 ? `${(kib / 1024).toFixed(1)} MiB` : `${Math.round(kib)} KiB`);

export const LABELS: Record<Side, string> = { gpui: 'GPUI', tanstack: 'TanStack' };
const SIDES: Side[] = ['gpui', 'tanstack'];

/** One device's outcome: the winner (null when even) and how many times. */
export interface Outcome {
  winner: Side | null;
  times: number;
}

export function outcome([gpui, tanstack]: readonly [number, number], better: 'lower' | 'higher'): Outcome {
  const [low, high] = [Math.min(gpui, tanstack), Math.max(gpui, tanstack)];
  if (high - low <= EVEN * high) return { winner: null, times: 1 };
  const gpuiWins = better === 'lower' ? gpui < tanstack : gpui > tanstack;
  return { winner: gpuiWins ? 'gpui' : 'tanstack', times: low > 0 ? high / low : Infinity };
}

const times = (value: number) => `${value.toFixed(1)}×`;

/**
 * A card's verdict, one pattern: "TanStack 3.4× faster · 7.1× on a slow
 * device", "Even", "GPUI smoother on a slow device". `slow` is null for a
 * card measured on one device.
 */
export function verdict(fast: Outcome, slow: Outcome | null, word: string, ratio: boolean): string {
  const says = (o: Outcome) => `${LABELS[o.winner!]} ${ratio ? `${times(o.times)} ` : ''}${word}`;
  if (!slow) return fast.winner ? says(fast) : 'Even';
  if (!fast.winner && !slow.winner) return 'Even';
  if (!fast.winner) return `${says(slow)} on a slow device`;
  if (!slow.winner) return `${says(fast)} · even on a slow device`;
  if (fast.winner === slow.winner) return ratio ? `${says(fast)} · ${times(slow.times)} on a slow device` : `${says(fast)} on both devices`;
  return `${says(fast)} · ${says(slow)} on a slow device`;
}

/**
 * A card's outcome on one device, judged on the metric as measured, every
 * card's lower-is-better (Smoothness's late share, not the share on time
 * it shows: 2% against 6% late is no tie, though 98 against 94 is within 5%).
 */
export const cardOutcome = (card: Card, values: ScenarioCold['values'], profile: Profile, stop?: string): Outcome => {
  const judged = card.judged ?? ((cold: number) => cold);
  const [gpui, tanstack] = values[cardKey(card, profile, stop)]!;
  const out = outcome([judged(gpui), judged(tanstack)], 'lower');
  if (!card.apart || !out.winner) return out;
  const [least, most] = [values[cardKey(card, profile, stop, `${card.metric}-min`)]!, values[cardKey(card, profile, stop, `${card.metric}-max`)]!];
  // Each side's runs from its fastest to its slowest: overlapping, even.
  return least[0]! <= most[1]! && least[1]! <= most[0]! ? { winner: null, times: 1 } : out;
};

/** A card's cold values as shown, per device (at `stop` for a card measured per stop). */
export const cardValues = (card: Card, values: ScenarioCold['values'], profile: Profile, stop?: string): [number, number] => {
  const [gpui, tanstack] = values[cardKey(card, profile, stop)]!;
  return [card.shown(gpui), card.shown(tanstack)];
};

/** Each side's Download total, KiB: its files, not the parts within them. */
export const downloadTotal = (side: Side, parts: ScenarioCold['parts'], scenario: Scenario): number =>
  partsOf(scenario)[side].filter((part) => !part.within).reduce((total, part) => total + parts[part.id]!, 0);

/** What each side wins and what's even, for the description below the window. */
export interface Wins {
  gpui: string[];
  tanstack: string[];
  even: string[];
}

const join = (items: string[]) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`);

/** A side's wins as a sentence: "GPUI stays smoother on a slow device, and …". */
export const winsSentence = (side: Side, wins: string[]) => `${LABELS[side]} ${join(wins)}.`;
export const evenSentence = (even: string[]) => `Even: ${join(even)}.`;

/**
 * Where each side wins, from the same cold numbers as the cards: each card
 * by both devices (as its verdict), Download, and the chart's rows grouped by
 * input, by the fast device (`CHART_DEVICE`): the throttle doesn't slow the
 * rows the browser's own scrolling answers, and the panel shows both.
 */
/** A comparison credited to its winner by both devices, as its verdict
 *  reads; to "even" when neither device has one. */
const creditor = (out: Wins) => (fast: Outcome, slow: Outcome | null, won: string, even: string) => {
  if (!fast.winner && !slow?.winner) return void out.even.push(even);
  if (slow && fast.winner && slow.winner && fast.winner !== slow.winner) {
    out[fast.winner].push(`${won} on a fast device`);
    out[slow.winner].push(`${won} on a slow device`);
  } else if (!fast.winner) out[slow!.winner!].push(`${won} on a slow device`);
  // As the verdict says "· even on a slow device".
  else if (slow && !slow.winner) out[fast.winner].push(`${won} on a fast device`);
  else out[fast.winner].push(won);
};

export function wins(cold: ScenarioCold): Wins {
  const out: Wins = { gpui: [], tanstack: [], even: [] };
  const credit = creditor(out);
  const download = outcome([downloadTotal('gpui', cold.parts, BIG_FILE), downloadTotal('tanstack', cold.parts, BIG_FILE)], 'lower');
  credit(download, null, 'downloads less', 'the download');
  const said: Record<string, [string, string]> = {
    usable: ['is ready sooner', 'ready'],
    data: ['puts rows on screen sooner after opening', 'rows on screen after opening'],
    smooth: ['stays smoother', 'smoothness'],
    memory: ['holds less memory', 'memory'],
  };
  for (const card of CARDS) {
    const [won, even] = said[card.key]!;
    credit(cardOutcome(card, cold.values, 'reference'), cardOutcome(card, cold.values, 'throttled'), won, even);
  }
  // The chart: per side, the inputs after which it moves the table, or fills its rows, sooner.
  for (const reading of ['moves', 'fills'] as const) {
    const bySide: Record<Side, Input[]> = { gpui: [], tanstack: [] };
    const even: Input[] = [];
    for (const bar of BARS.filter((bar) => bar.reading === reading)) {
      const { winner } = outcome(cold.values[`${bar.metric}-${CHART_DEVICE}`]!, 'lower');
      if (winner) bySide[winner].push(bar.input);
      else even.push(bar.input);
    }
    const what = reading === 'moves' ? 'moves the table sooner after' : 'fills the rows sooner after';
    for (const side of SIDES) if (bySide[side].length) out[side].push(`${what} ${bySide[side].map((input) => INPUTS[input]).join(' or ')}`);
    if (even.length) out.even.push(`${reading === 'moves' ? 'the table moving' : 'the rows filling'} after ${even.map((input) => INPUTS[input]).join(' or ')}`);
  }
  return out;
}

/** The chart's note on the wheel rows: which side moves first, which fills first. */
export function wheelNote(values: ScenarioCold['values']): string {
  const moves = outcome(values['wheel-reference']!, 'lower').winner;
  const fills = outcome(values['wheel-real-reference']!, 'lower').winner;
  const name = (side: Side | null) => (side ? LABELS[side] : 'Neither');
  if (moves && moves === fills) return `The wheel rows: ${name(moves)} moves first and fills the rows first.`;
  return `The wheel rows: ${moves ? `${name(moves)} moves first` : 'both move together'}; ${fills ? `${name(fills)} fills the rows first` : 'both fill the rows together'}.`;
}

// ---------------------------------------------------------------- a scenario's stops

/** Whether a side keeps up at a stop: "keeps up"'s share at or over the
 *  dashed line (`KEEPS_UP_SHARE`, `derive`'s `keeps`). */
export const keepsUpAt = (values: ScenarioCold['values'], side: Side, profile: Profile, stop: string): boolean =>
  values[coldKey('keeps', profile, stop)]![side === 'gpui' ? 0 : 1] >= KEEPS_UP_SHARE * 100;

/** How far a side keeps up: the index of the last stop in the dial's
 *  first run of stops it keeps up at, -1 at none. */
export function reachOf(scenario: Scenario, values: ScenarioCold['values'], side: Side, profile: Profile): number {
  let last = -1;
  for (const [index, stop] of (scenario.stops as readonly Stop[]).entries()) {
    if (!keepsUpAt(values, side, profile, stop.id)) break;
    last = index;
  }
  return last;
}

/** Names a scenario's stops for one sentence: its unit ("~380 cells")
 *  the first time, the number alone ("~940") after. */
const stopNamer = (scenario: Scenario) => {
  const stops = scenario.stops as readonly Stop[];
  let unit = true;
  return (index: number) => {
    const stop = stops[index]!;
    const text = unit ? stop.label : stopShort(stop);
    unit = false;
    return text;
  };
};

/** How far each side keeps up on one device, in words: "TanStack keeps up
 *  to ~380 cells; GPUI keeps up at every stop, to ~940", the side that
 *  keeps up less named first. */
function keepsOn(scenario: Scenario, values: ScenarioCold['values'], profile: Profile, to = stopNamer(scenario)): string {
  const last = scenario.stops.length - 1;
  const reach = (index: number) => (index < 0 ? 'keeps up at no stop' : index === last ? `keeps up at every stop, to ${to(index)}` : `keeps up to ${to(index)}`);
  const [gpui, tanstack] = SIDES.map((side) => reachOf(scenario, values, side, profile)) as [number, number];
  if (gpui === tanstack) {
    if (gpui < 0) return 'neither keeps up at any stop';
    return `both ${reach(gpui).replace('keeps', 'keep')}`;
  }
  const [first, second] = gpui < tanstack ? (['gpui', 'tanstack'] as const) : (['tanstack', 'gpui'] as const);
  const of = { gpui, tanstack };
  return `${LABELS[first]} ${reach(of[first])}; ${LABELS[second]} ${reach(of[second])}`;
}

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * The keeps-up verdict over both devices: "TanStack keeps up to ~380
 * cells; GPUI keeps up at every stop, to ~940 · on a slow device, neither
 * keeps up at any stop". The side that keeps up less is named first; the
 * stops' unit is said once.
 */
export function keepsVerdict(scenario: Scenario, values: ScenarioCold['values']): string {
  const to = stopNamer(scenario);
  return `${capital(keepsOn(scenario, values, 'reference', to))} · on a slow device, ${keepsOn(scenario, values, 'throttled', to)}`;
}

/** The keeps-up comparison on one device, for "where each side wins":
 *  the side that keeps up at more stops. */
const reachOutcome = (scenario: Scenario, values: ScenarioCold['values'], profile: Profile): Outcome => {
  const [gpui, tanstack] = SIDES.map((side) => reachOf(scenario, values, side, profile));
  return { winner: gpui === tanstack ? null : gpui! > tanstack! ? 'gpui' : 'tanstack', times: 1 };
};

/** The wide sheet's card for what no stop changes: Ready in, by device. */
export const READY = WIDE_CARDS.find((card) => card.key === 'usable')!;

/**
 * Where each side wins in a scenario with stops, from the panel's numbers:
 * how far each keeps up, the cards at the default stop (the dial's
 * first), Ready in, and Download.
 */
export function stopWins(scenario: Scenario, cold: ScenarioCold): Wins {
  const out: Wins = { gpui: [], tanstack: [], even: [] };
  const credit = creditor(out);
  const both = (card: Card, stop?: string): [Outcome, Outcome] => [cardOutcome(card, cold.values, 'reference', stop), cardOutcome(card, cold.values, 'throttled', stop)];
  const numbers = numbersOf(scenario);
  credit(reachOutcome(scenario, cold.values, 'reference'), reachOutcome(scenario, cold.values, 'throttled'), numbers.keeps!.won, 'how far each keeps up');
  const said: Record<string, [string, string]> = {
    fling: ['stays smoother in a fast fling', 'a fast fling'],
    work: ['spends less time on each frame', 'the time each frame takes'],
    memory: ['holds less memory', 'memory'],
    smooth: ['stays smoother under the feed', 'smoothness under the feed'],
    shown: ['shows each update sooner', 'how soon an update shows'],
    collections: ['pauses less for garbage collection', 'collection pauses'],
  };
  for (const card of numbers.stopCards ?? []) credit(...both(card, scenario.defaultStop), ...said[card.key]!);
  credit(...both(READY), 'is ready sooner', 'ready');
  // A card the status bar has and the panel's cards don't: memory, measured once.
  const memory = numbers.cards.find((card) => card.key === 'memory');
  if (memory && !numbers.stopCards?.some((card) => card.key === 'memory')) credit(...both(memory), ...said.memory!);
  const download = outcome([downloadTotal('gpui', cold.parts, scenario), downloadTotal('tanstack', cold.parts, scenario)], 'lower');
  credit(download, null, 'downloads less', 'the download');
  return out;
}

/** Where each side wins in a scenario. */
export const winsOf = (scenario: Scenario, cold: ScenarioCold): Wins => (numbersOf(scenario).stopCards ? stopWins(scenario, cold) : wins(cold));

// ---------------------------------------------------------------- measured with

/** Each measured package as the page names it, in this order. */
export const PACKAGES: [string, string][] = [
  ['gpui-kit', 'gpui-kit'],
  ['react', 'React'],
  ['@tanstack/react-virtual', 'TanStack Virtual'],
  ['apache-arrow', 'Apache Arrow'],
  ['@duckdb/duckdb-wasm', 'DuckDB-Wasm'],
  ['chromium', 'Chromium'],
];

/** "Measured with gpui-kit 0.9.0 · React 19.3.1 · …", or null where any
 *  of the results predates the versions. */
export function measuredWith(versions: ScenarioCold['versions']): string | null {
  if (!versions.length) return null;
  const of = new Map(versions);
  return `Measured with ${PACKAGES.filter(([name]) => of.has(name))
    .map(([name, label]) => `${label} ${of.get(name)!.join(' and ')}`)
    .join(' · ')}.`;
}

// ---------------------------------------------------------------- the galleries

/** The side a scenario's verdict leans to: one, both ("split": each wins
 *  something the verdict names), or neither (null: even). */
export type Lean = Side | 'split' | null;

/** A scenario's card on its component's page: its verdict in a line. */
export interface ScenarioVerdict {
  text: string;
  lean: Lean;
}

const leanOf = (winners: (Side | null)[]): Lean => {
  const sides = new Set(winners.filter((side) => side !== null));
  return sides.size === 2 ? 'split' : sides.size === 1 ? [...sides][0]! : null;
};

/** A scenario without stops' verdict: Ready in and Smoothness, each by the
 *  fast device, or the slow one where the fast is even ("TanStack ready
 *  3.4× sooner; GPUI smoother on a slow device"). */
const HEADLINE: { key: string; says: (o: Outcome) => string }[] = [
  { key: 'usable', says: (o) => `ready ${times(o.times)} sooner` },
  { key: 'smooth', says: () => 'smoother' },
];

/**
 * A scenario's verdict for its card: with stops, how far each side keeps
 * up on the fast device (as the panel's verdict opens); without, what each
 * side wins of Ready in and Smoothness.
 */
export function scenarioVerdict(scenario: Scenario, cold: ScenarioCold): ScenarioVerdict {
  if (numbersOf(scenario).stopCards) {
    // The fast device, and the slow one too where the fast shows no edge.
    const reach = reachesOf(scenario, cold);
    const [gpui, tanstack] = reach.reference;
    const to = stopNamer(scenario);
    const fast = capital(keepsOn(scenario, cold.values, 'reference', to));
    if (gpui !== tanstack) return { text: fast, lean: gpui > tanstack ? 'gpui' : 'tanstack' };
    const [slowGpui, slowTanstack] = reach.throttled;
    if (slowGpui === slowTanstack) return { text: fast, lean: null };
    return { text: `${fast} · on a slow device, ${keepsOn(scenario, cold.values, 'throttled', to)}`, lean: slowGpui > slowTanstack ? 'gpui' : 'tanstack' };
  }
  const said: string[] = [];
  const winners: (Side | null)[] = [];
  for (const { key, says } of HEADLINE) {
    const shown = card(key);
    const [fast, slow] = [cardOutcome(shown, cold.values, 'reference'), cardOutcome(shown, cold.values, 'throttled')];
    const won = fast.winner ? fast : slow.winner ? slow : null;
    winners.push(won?.winner ?? null);
    if (won) said.push(`${LABELS[won.winner!]} ${says(won)}${won === fast ? '' : ' on a slow device'}`);
  }
  return { text: said.length ? said.join('; ') : 'Even', lean: leanOf(winners) };
}

/** How far each side keeps up at a scenario with stops, per device: each
 *  side's last stop index (`reachOf`), GPUI's then TanStack's. */
export type Reach = Record<Profile, [number, number]>;

export const reachesOf = (scenario: Scenario, cold: ScenarioCold): Reach =>
  Object.fromEntries(PROFILES.map((profile) => [profile, SIDES.map((side) => reachOf(scenario, cold.values, side, profile))])) as Reach;

/** A component's decision rule (`docs/DECISIONS.md`, "Page"): each half
 *  said only where its numbers back it. */
export interface Rule {
  /** "Use the DOM for small tables.": the DOM keeps up at a density
   *  dial's smaller stops, where GPUI keeps up further. */
  dom: boolean;
  /** "Use GPUI past ~380 cells on screen.": a clause per scenario with a
   *  density or a rate dial where GPUI keeps up further than the DOM. */
  gpui: string[];
}

/** What a rule's clause counts a dial's stops in. */
const DIAL_UNITS = { density: 'cells on screen', rate: 'updates a second' } as const;

/**
 * A component's rule from its scenarios' numbers: past the last stop where
 * the DOM keeps up ("past ~380 cells on screen"), or from the first where
 * it keeps up at none, wherever GPUI keeps up further, on the fast device;
 * where the fast device shows no edge, on the slow one, and the clause says
 * so ("past 1k updates a second on a slow device"). Neither half until a
 * scenario with a density or a rate dial has numbers.
 */
export function ruleOf(scenarios: readonly Scenario[], numbers: ColdNumbers): Rule {
  const rule: Rule = { dom: false, gpui: [] };
  for (const scenario of scenarios) {
    const cold = numbers.scenarios[scenario.id];
    const stops = scenario.stops as readonly Stop[];
    const kind = stops.every(isDensity) ? 'density' : stops.every(isRate) ? 'rate' : null;
    if (!cold || stops.length < 2 || !numbersOf(scenario).stopCards || !kind) continue;
    const reach = reachesOf(scenario, cold);
    // The slow device only where the fast one shows no edge: a fast device
    // the DOM leads on says nothing for GPUI.
    const [fastGpui, fastTanstack] = reach.reference;
    const profile = fastGpui > fastTanstack ? 'reference' : fastGpui === fastTanstack && reach.throttled[0] > reach.throttled[1] ? 'throttled' : null;
    if (!profile) continue;
    const tanstack = reach[profile][1];
    if (tanstack >= 0 && kind === 'density') rule.dom = true;
    const device = profile === 'reference' ? '' : ' on a slow device';
    rule.gpui.push(`${tanstack < 0 ? `from ${stopShort(stops[0]!)}` : `past ${stopShort(stops[tanstack]!)}`} ${DIAL_UNITS[kind]}${device}`);
  }
  return rule;
}

/** What the Overview and the component's page say of the scenarios,
 *  resolved at build time (`virtual:gallery`), so their first screen is in
 *  the prerendered HTML with none of this module's code. */
export interface Gallery {
  /** Each component's rule, by its id. */
  rules: Record<string, Rule>;
  /** Each scenario's with numbers. */
  verdicts: Record<string, ScenarioVerdict>;
  /** Each scenario with stops' reach. */
  reach: Record<string, Reach>;
  /** "Keeps up"'s line, a percentage. */
  share: number;
}

export function galleryOf(components: readonly { id: string; scenarios: readonly Scenario[] }[], numbers: ColdNumbers): Gallery {
  const gallery: Gallery = { rules: {}, verdicts: {}, reach: {}, share: KEEPS_UP_SHARE * 100 };
  for (const component of components) {
    gallery.rules[component.id] = ruleOf(component.scenarios, numbers);
    for (const scenario of component.scenarios) {
      const cold = numbers.scenarios[scenario.id];
      if (!cold) continue;
      gallery.verdicts[scenario.id] = scenarioVerdict(scenario, cold);
      if (numbersOf(scenario).stopCards) gallery.reach[scenario.id] = reachesOf(scenario, cold);
    }
  }
  return gallery;
}
