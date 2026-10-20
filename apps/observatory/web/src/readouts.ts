/**
 * What the page's numbers show (`docs/DECISIONS.md`, "Page"): the window's
 * status bar segments and the panel's cards, each a metric of
 * `perf/budgets.json` with its reading in this tab; the input-to-response
 * chart, cold only; the Download card's parts, each a value in
 * `perf/results/`; and the words that compare them (each card's verdict,
 * the description's "where each side wins"). Pure: the build's plugin
 * (`../cold.ts`) and `perf/page.ts` read it too.
 */

import type { LiveReadings } from '../../metrics/metrics.ts';
import type { Source } from '../../../../shared-web/scripts/results.ts';
import type { Side } from '../../contenders/contract.ts';

export type Profile = 'reference' | 'throttled';
export const PROFILES: Profile[] = ['reference', 'throttled'];

/** What the page calls each profile. */
export const DEVICES: Record<Profile, string> = { reference: 'Fast device', throttled: 'Slow device' };

export interface Card {
  /** The segment's and the card's key, and its explainer's. */
  key: 'usable' | 'data' | 'smooth' | 'memory';
  /** A `perf/budgets.json` metric, less its profile: `<metric>-<profile>`. */
  metric: string;
  /** The status bar's label, and the card's. */
  segment: string;
  label: string;
  unit: 'ms' | '%' | 'MiB';
  better: 'lower' | 'higher';
  /** The cold value as shown: Smoothness is the frames on time, 100 less the
   *  late share. The verdict judges the metric as measured (`cardOutcome`). */
  shown: (cold: number) => number;
  /** The verdict's word for the winner ("TanStack 3.4× faster"). */
  word: string;
  /** Whether the verdict says how many times: not for a share. */
  ratio: boolean;
  /** Its reading in this tab, as shown, or null where there's none yet. */
  live: (readings: LiveReadings) => number | null;
  /** Said in this tab before there's a reading: "—" in the status bar. */
  waiting: string;
  /** Under the card's label, above the cold values (the fast device's caption). */
  caption?: string;
  /** The explainer: what the number means, then how it's measured. */
  explain: string;
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

/** Every budgets.json metric the page shows. */
export const METRICS = [...CARDS, ...BARS].flatMap(({ metric }) => PROFILES.map((profile) => `${metric}-${profile}`));

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

const wire = (side: Side, kind: string): Source => ({ glob: '*-memory.json', path: `profiles.reference.${side}.summary.bytesKiB.${kind}` });
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

/** The cold numbers, resolved at build time (`virtual:cold-numbers`). */
export interface ColdNumbers {
  /** Each metric's GPUI and TanStack medians. */
  values: Record<string, [number, number]>;
  /** The Download card's parts, KiB. */
  parts: Record<string, number>;
  /** The data file's rows (`data/MANIFEST.json`). */
  rows: number;
  /** The metrics' results files' runs per median, and machine. */
  runs: number[];
  cpus: string[];
}

// ---------------------------------------------------------------- words

/** Two cold medians this close (relative) read as even: inside the runs'
 *  own spread, which the protocol holds under 6%. */
export const EVEN = 0.05;

/** A number as the page prints it: whole above 100, else one decimal at most. */
export const number = (value: number): string => (Math.abs(value) >= 100 ? String(Math.round(value)) : String(Number(value.toFixed(1))));

/** A reading with its unit: "41.7 ms", "99.1 %". */
export const withUnit = (value: number, unit: string): string => `${number(value)} ${unit}`;

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
export const cardOutcome = (card: Card, values: ColdNumbers['values'], profile: Profile): Outcome => outcome(values[`${card.metric}-${profile}`]!, 'lower');

/** A card's cold values as shown, per device. */
export const cardValues = (card: Card, values: ColdNumbers['values'], profile: Profile): [number, number] => {
  const [gpui, tanstack] = values[`${card.metric}-${profile}`]!;
  return [card.shown(gpui), card.shown(tanstack)];
};

/** Each side's Download total, KiB: its files, not the parts within them. */
export const downloadTotal = (side: Side, parts: ColdNumbers['parts']): number => PARTS[side].filter((part) => !part.within).reduce((total, part) => total + parts[part.id]!, 0);

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
export function wins(cold: ColdNumbers): Wins {
  const out: Wins = { gpui: [], tanstack: [], even: [] };
  const credit = (fast: Outcome, slow: Outcome | null, won: string, even: string) => {
    if (!fast.winner && !slow?.winner) return void out.even.push(even);
    if (slow && fast.winner && slow.winner && fast.winner !== slow.winner) {
      out[fast.winner].push(`${won} on a fast device`);
      out[slow.winner].push(`${won} on a slow device`);
    } else if (!fast.winner) out[slow!.winner!].push(`${won} on a slow device`);
    // As the verdict says "· even on a slow device".
    else if (slow && !slow.winner) out[fast.winner].push(`${won} on a fast device`);
    else out[fast.winner].push(won);
  };
  const download = outcome([downloadTotal('gpui', cold.parts), downloadTotal('tanstack', cold.parts)], 'lower');
  credit(download, null, 'downloads less', 'the download');
  const said: Record<Card['key'], [string, string]> = {
    usable: ['is ready sooner', 'ready'],
    data: ['puts rows on screen sooner after opening', 'rows on screen after opening'],
    smooth: ['stays smoother', 'smoothness'],
    memory: ['holds less memory', 'memory'],
  };
  for (const card of CARDS) {
    const [won, even] = said[card.key];
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
export function wheelNote(values: ColdNumbers['values']): string {
  const moves = outcome(values['wheel-reference']!, 'lower').winner;
  const fills = outcome(values['wheel-real-reference']!, 'lower').winner;
  const name = (side: Side | null) => (side ? LABELS[side] : 'Neither');
  if (moves && moves === fills) return `The wheel rows: ${name(moves)} moves first and fills the rows first.`;
  return `The wheel rows: ${moves ? `${name(moves)} moves first` : 'both move together'}; ${fills ? `${name(fills)} fills the rows first` : 'both fill the rows together'}.`;
}
