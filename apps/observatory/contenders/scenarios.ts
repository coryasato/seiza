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

/** A build of each contender: the base, or the base with a set of features
 *  built the same on both sides. */
export type Level = 'base' | 'wide';

/** The features each level turns on (the GPUI contender's Cargo feature of
 *  the level's name turns on the table's). */
export const LEVEL_FEATURES: Record<Level, readonly string[]> = {
  base: [],
  wide: ['custom-cells', 'pin', 'density'],
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
  /** The first column painted as heat; every column from it on is, each
   *  through the file's whole range (`MANIFEST.json`'s `range`). */
  heatFrom: number;
}
export type Scenario = BaseScenario | WideScenario;

export const BIG_FILE: BaseScenario = {
  id: 'big-file',
  label: 'Big file',
  use: 'A file far past what a page can hold, opened and read anywhere',
  level: 'base',
  data: 'asteroids.parquet',
  stops: [{ id: 'all', label: 'All rows' }],
  defaultStop: 'all',
};

/** A wide sheet's stop, its label from its count. */
const densityStop = (id: string, cells: number, rowHeight: number, textSize: number, columnWidth: number): DensityStop => ({ id, label: `~${cells} cells`, cells, rowHeight, textSize, columnWidth });

/**
 * The wide sheet's four stops (`docs/DECISIONS.md`, "Scenarios"): each
 * named by the cells the GPUI contender draws at the top at 1440 × 900
 * (`perf/wide.ts` counts them, and fails past 5% off the label), heat
 * throughout.
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
};

/** Every scenario, each level's first its default. */
export const SCENARIOS: readonly Scenario[] = [BIG_FILE, WIDE_SHEET];

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
  const ofLevel = SCENARIOS.filter((scenario) => scenario.level === level);
  const asked = params.get(SCENARIO_PARAM);
  const scenario = asked === null ? ofLevel[0] : ofLevel.find((candidate) => candidate.id === asked);
  if (!scenario) return new Error(`no scenario "${asked}" in this build (${ofLevel.map((s) => s.id).join(', ')})`);
  const stopId = params.get(STOP_PARAM) ?? scenario.defaultStop;
  const stop = (scenario.stops as readonly Stop[]).find((candidate) => candidate.id === stopId);
  if (!stop) return new Error(`no stop "${stopId}" in ${scenario.id} (${scenario.stops.map((s) => s.id).join(', ')})`);
  return { scenario, stop } as Picked;
}

/** A cold result's label: `<scenario>-<stop>`; the base level's are Big file's, unlabelled. */
export const resultLabel = ({ scenario, stop }: Picked): string => (scenario.level === 'base' ? '' : `${scenario.id}-${stop.id}`);
