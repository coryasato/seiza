/**
 * The scenarios: the one list, read by the page, the contenders, and the
 * perf scripts, as `paths.ts` is (`docs/DECISIONS.md`, "Scenarios"). A
 * scenario is a workload on a feature level (root `CLAUDE.md`, "Comparison
 * protocol"): its level names the build, its data the file in `data/`
 * (`MANIFEST.json` has its rows and credit), and its stops the parameters
 * each cold result is labelled by (`<scenario>-<stop>`). A frame picks one
 * by `?scenario=<id>&stop=<id>`; without them a contender loads its level's
 * first scenario at its default stop, and an id it doesn't know fails the
 * load (`contender:failed`), so a typo never measures the default. Nothing
 * here touches the browser, so a Vite config imports it.
 */

import type { Side } from './contract.ts';
import { DATA_FILE } from './tail/data.ts';

/** A build of each contender: the base, or the base with a set of features
 *  built the same on both sides. */
export type Level = 'base' | 'wide' | 'market' | 'tail';

/** The features each level turns on (the GPUI contender's Cargo feature of
 *  the level's name turns on the table's), every level's, built or not:
 *  what a results file labels a build with. Which levels each side builds
 *  is `BUILT`'s, below; nothing else reads which levels exist from here. */
export const LEVEL_FEATURES: Record<Level, readonly string[]> = {
  base: [],
  wide: ['custom-cells', 'pin', 'density'],
  market: ['custom-cells', 'live', 'format'],
  tail: ['custom-cells', 'follow', 'live', 'format', 'density'],
};

export interface Stop {
  id: string;
  /** As the dial says it. */
  label: string;
}

/** A wide sheet's stop: the table's density and the days' width, px. */
export interface DensityStop extends Stop {
  /** The cells the GPUI contender draws at the top at 1440 × 900, rounded:
   *  the label's number (`~N cells`), the dial's short label. */
  cells: number;
  rowHeight: number;
  textSize: number;
  columnWidth: number;
}

interface ScenarioOf<L extends Level, S extends Stop> {
  id: string;
  label: string;
  /** The kind of app it is, in a few words. */
  use: string;
  level: L;
  /** The file in `data/`, served at `paths.ts`'s `DATA`, and its SQL name. */
  data: string;
  stops: readonly S[];
  defaultStop: string;
}

export type BaseScenario = ScenarioOf<'base', Stop>;
export interface WideScenario extends ScenarioOf<'wide', DensityStop> {
  /** The first columns pinned (the key columns). */
  pinned: number;
  /** The first column painted as heat; every column from it on is. */
  heatFrom: number;
  heat: Heat;
}

/** A color in Oklch: lightness 0..1, chroma, hue in degrees. */
export type Oklch = readonly [l: number, c: number, h: number];

/** CSS's form of `color`: `oklch(0.6 0.13 262)`. */
export const oklchCss = ([l, c, h]: Oklch): string => `oklch(${l} ${c} ${h})`;

/**
 * A diverging heat ramp: its three stops (cold, the middle, warm) per
 * theme, mixed continuously in Oklab, and the values at its ends and its
 * middle, clamped past them. Both contenders draw it (the GPUI side's
 * stops are constants in its `scene.rs`, which `perf/wide.ts` checks
 * against these), and so do the page's drawings.
 */
export interface Heat {
  stops: Record<'light' | 'dark', readonly [cold: Oklch, mid: Oklch, warm: Oklch]>;
  domain: { lo: number; mid: number; hi: number };
}

/** A market watch's stop: the feed's updates a second. */
export interface RateStop extends Stop {
  rate: number;
}

/** A theme's rise and fall: the text by a change's sign, and the flash. */
export interface Signs {
  up: Oklch;
  down: Oklch;
}

export interface MarketScenario extends ScenarioOf<'market', RateStop> {
  /** The feed's seed (`contenders/market/feed.ts`): the same ticks on both sides. */
  seed: number;
  /** A rise and a fall per theme: Change and Change % drawn by sign (a zero
   *  in the foreground), the flash in the same two colors. */
  signs: Record<'light' | 'dark', Signs>;
  /** The table's flash on the columns named: a changed cell's color at
   *  `mix` (of the rise or the fall over the cell), fading linearly to
   *  nothing over `ms`. */
  flash: { ms: number; mix: number; columns: readonly string[] };
}

/** A live tail's stop: the rows appended a second. */
export interface RowsStop extends Stop {
  rate: number;
}

export interface TailScenario extends ScenarioOf<'tail', RowsStop> {
  /** An error status (4xx and 5xx) per theme, as the canvas draws a 404
   *  (`--down`): market watch's fall. */
  error: Record<'light' | 'dark', Oklch>;
  /** Each column's width, px, in the file's order (time, request, status,
   *  bytes): the design canvas's, set through the table's `density`. */
  widths: readonly [time: number, request: number, status: number, bytes: number];
}

export type Scenario = BaseScenario | WideScenario | MarketScenario | TailScenario;

export const BIG_FILE: BaseScenario = {
  id: 'big-file',
  label: 'Big file',
  use: 'A file far past what a page can hold, opened and read anywhere',
  level: 'base',
  data: 'asteroids.parquet',
  stops: [{ id: 'all', label: 'All rows' }],
  defaultStop: 'all',
};

/**
 * The admin table (`docs/DECISIONS.md`, "Scenarios"): the world's regions,
 * each named in its own script, in a table a few hundred rows long. The
 * DOM's scenario, shown as capabilities (find, select, a screen reader,
 * every script drawn, Translate), not speed; no dial, so one stop. On the
 * base level: its file is text alone, the base's kinds.
 */
export const ADMIN_TABLE: BaseScenario = {
  id: 'admin-table',
  label: 'Admin table',
  use: 'The table in almost every app: a few hundred rows of text in many languages',
  level: 'base',
  data: 'countries.parquet',
  stops: [{ id: 'all', label: 'All rows' }],
  defaultStop: 'all',
};

/** A wide sheet's stop, its label from its count. */
const densityStop = (id: string, cells: number, rowHeight: number, textSize: number, columnWidth: number): DensityStop => ({ id, label: `~${cells} cells`, cells, rowHeight, textSize, columnWidth });

/**
 * The wide sheet's four stops (`docs/DECISIONS.md`, "Scenarios"): each
 * named by the cells the GPUI contender draws at the top at 1440 × 900
 * (`perf/wide.ts` counts them, and fails past 5% off the label), heat
 * throughout: a day's high from cold blue through a neutral middle to warm
 * red, 12 °C at the middle (the design canvas's ramp and domain,
 * `docs/DECISIONS.md`, "Scenarios").
 */
export const WIDE_SHEET: WideScenario = {
  id: 'wide-sheet',
  label: 'Wide sheet',
  use: 'A spreadsheet or BI view: hundreds of columns, compact rows, heat',
  level: 'wide',
  data: 'ghcn-2025-tmax.parquet',
  stops: [
    densityStop('rows-26', 380, 26, 13, 96),
    densityStop('rows-22', 570, 22, 12, 80),
    densityStop('rows-20', 710, 20, 11, 68),
    densityStop('rows-18', 940, 18, 11, 56),
  ],
  defaultStop: 'rows-20',
  pinned: 2,
  heatFrom: 3,
  heat: {
    stops: {
      light: [[0.6, 0.13, 262], [0.985, 0, 0], [0.64, 0.18, 32]],
      dark: [[0.48, 0.12, 262], [0.2, 0, 0], [0.55, 0.17, 32]],
    },
    domain: { lo: -35, mid: 12, hi: 40 },
  },
};

/** A market watch's stop, named by its rate as the dial says it ("1k"),
 *  its label with the unit ("1k updates/s"). */
const rateStop = (id: string, rate: number): RateStop => ({ id, label: `${id} updates/s`, rate });

/**
 * Market watch (`docs/DECISIONS.md`, "Scenarios"): 50 fictional
 * instruments, their prices updated in place by one seeded feed, each
 * change flashing. Its stops sit where the work still grows (from ~5k
 * nearly every visible row changes every frame); the colors are the
 * design canvas's, the rise lighter than the fall in both themes.
 */
export const MARKET_WATCH: MarketScenario = {
  id: 'market-watch',
  label: 'Market watch',
  use: 'A trading screen: every price live, each change flashing',
  level: 'market',
  data: 'market-instruments.parquet',
  stops: [rateStop('100', 100), rateStop('500', 500), rateStop('1k', 1000), rateStop('5k', 5000)],
  defaultStop: '500',
  seed: 0x5eed,
  signs: {
    light: { up: [0.55, 0.15, 149], down: [0.45, 0.17, 27] },
    dark: { up: [0.82, 0.17, 149], down: [0.68, 0.19, 27] },
  },
  flash: { ms: 400, mix: 0.3, columns: ['Last', 'Bid', 'Ask'] },
};

/** A live tail's stop, named by its rate as the dial says it ("10k"),
 *  its label with the unit ("10k rows/s"). */
const rowsStop = (id: string, rate: number): RowsStop => ({ id, label: `${id} rows/s`, rate });

/**
 * Live tail (`docs/DECISIONS.md`, "Scenarios"): NASA-HTTP's July 1995 log
 * replayed into the table by the clock (`contenders/tail/`) while the view
 * follows the newest, looping past the file's end. The file is opened by
 * range under its own name, then fetched whole and every page read from
 * that copy (`contenders/tail/data.ts`). Its stops are the canvas's.
 */
export const LIVE_TAIL: TailScenario = {
  id: 'live-tail',
  label: 'Live tail',
  use: 'An observability tool: a log growing while the view follows the newest',
  level: 'tail',
  data: DATA_FILE,
  stops: [rowsStop('1k', 1_000), rowsStop('10k', 10_000), rowsStop('50k', 50_000), rowsStop('100k', 100_000)],
  defaultStop: '10k',
  error: { light: MARKET_WATCH.signs.light.down, dark: MARKET_WATCH.signs.dark.down },
  widths: [196, 470, 72, 90],
};

/** Every scenario, each level's first its default: what a frame can load
 *  (`pickScenario`) and what the scripts measure, on whichever sides build
 *  its level (`BUILT`). */
export const ALL_SCENARIOS: readonly Scenario[] = [BIG_FILE, WIDE_SHEET, MARKET_WATCH, LIVE_TAIL, ADMIN_TABLE];

/** The scenarios the page shows: a scenario joins once both sides build its
 *  level and the page draws it (`docs/DECISIONS.md`, "Scenarios"). The
 *  page's routes and cold numbers read it. */
export const SCENARIOS: readonly Scenario[] = [BIG_FILE, WIDE_SHEET, MARKET_WATCH, LIVE_TAIL];

/** The levels each side builds, the base first: a level joins a side with
 *  its build there. What builds, serves, sizes, and stages each side's
 *  levels (the recipes, `sizes`, `cold`, `tanstack-sizes`, `placeholder`,
 *  the page's servers, `stage.ts`) reads it, never `LEVEL_FEATURES`. */
export const BUILT: Record<Side, readonly Level[]> = {
  gpui: ['base', 'wide', 'market', 'tail'],
  tanstack: ['base', 'wide', 'market', 'tail'],
};

/** `side`'s levels past the base. */
export const featureLevels = (side: Side): readonly Level[] => BUILT[side].filter((level) => level !== 'base');

export const SCENARIO_PARAM = 'scenario';
export const STOP_PARAM = 'stop';

/** A scenario at a stop, as a contender loads it. */
export interface Picked<S extends Scenario = Scenario> {
  scenario: S;
  stop: S['stops'][number];
}

/**
 * The scenario and stop `params` ask for on `level`'s build: the level's
 * first scenario at its default stop without them, an error for an id
 * that isn't one of the level's (a contender shows it and marks
 * `contender:failed`).
 */
export function pickScenario(level: Level, params: URLSearchParams): Picked | Error {
  const ofLevel = ALL_SCENARIOS.filter((scenario) => scenario.level === level);
  const asked = params.get(SCENARIO_PARAM);
  const scenario = asked === null ? ofLevel[0] : ofLevel.find((candidate) => candidate.id === asked);
  if (!scenario) return new Error(`no scenario "${asked}" in this build (${ofLevel.map((s) => s.id).join(', ')})`);
  const stopId = params.get(STOP_PARAM) ?? scenario.defaultStop;
  const stop = (scenario.stops as readonly Stop[]).find((candidate) => candidate.id === stopId);
  if (!stop) return new Error(`no stop "${stopId}" in ${scenario.id} (${scenario.stops.map((s) => s.id).join(', ')})`);
  return { scenario, stop } as Picked;
}

/** A cold result's label: `<scenario>-<stop>`, a scenario with one stop
 *  (no dial) its id alone; Big file's, the first, unlabelled. */
export const resultLabel = ({ scenario, stop }: Picked): string => (scenario.id === BIG_FILE.id ? '' : scenario.stops.length === 1 ? scenario.id : `${scenario.id}-${stop.id}`);
