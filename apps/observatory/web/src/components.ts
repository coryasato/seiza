/**
 * The components the observatory compares, each with its contenders and
 * its scenarios: the page's list (its nav, its routes, its frames). A
 * contender is only a name, a label, and a URL here: its page is a bare
 * build of its own, one per feature level, fetched when its frame is
 * created (root `CLAUDE.md`, "Comparison protocol"), never part of this
 * bundle. The scenarios are `contenders/scenarios.ts`'s, the one list; this
 * file adds what the page says of each.
 *
 * The routes (`docs/DECISIONS.md`, "Page", 2026-11-02): the Overview at
 * `/observatory/`, a component's page at `/observatory/<component>/`, and
 * a scenario's at `/observatory/<component>/<scenario>/`, the only kind
 * that takes a parameter (`?side=`, `?stop=`).
 */

import { createElement as h } from 'react';
import type { Side } from '../../contenders/contract.ts';
import { contenderBase, OBSERVATORY } from '../../contenders/paths.ts';
import { BIG_FILE, SCENARIOS, WIDE_SHEET, type DensityStop, type Level, type Scenario, type Stop } from '../../contenders/scenarios.ts';

export interface Contender {
  side: Side;
  /** What the comparison calls it: GPUI | TanStack. */
  label: string;
  /** Its stack, in a few words. */
  stack: string;
  /** Its bare page at a level: that level's build's base. */
  url: (level: Level) => string;
}

/** Where the two stacks differ, by id: the mechanisms a scenario leans on
 *  (`gallery.ts`'s `MECHANISMS`, their names and definitions). */
export type MechanismId = 'cells' | 'gc' | 'decoding' | 'compositor' | 'platform';

/** The component's page's section on the mechanisms. */
export const WHY_ANCHOR = 'why';

/** What the page says of a scenario, beside `scenarios.ts`'s facts. */
export interface ScenarioCopy {
  /** The title bar's lead, from the data file's rows. */
  lead: (rows: number) => string;
  /** The dial: what its stops set, and the explainer's line on them. None
   *  for a scenario with one stop. */
  dial?: { label: string; about: string };
  /** The mechanisms it leans on (`MECHANISMS`). */
  leans: readonly MechanismId[];
  /** For a scenario without a dial: what its numbers are instead, for the
   *  component's page's "How far each side keeps up". */
  session?: string;
}

export interface Component {
  id: string;
  label: string;
  /** The component's page: `/observatory/<id>/`. */
  path: string;
  /** One line: what it is (the component's page opens with it). */
  line: string;
  /** The Overview's card's line: what it is, through what. */
  card: string;
  /** What each of its uses runs against. */
  against: string;
  contenders: [Contender, Contender];
  scenarios: readonly Scenario[];
}

/** Each side's series color as Tailwind classes, written out whole so
 *  Tailwind's scan finds them. */
const SERIES: Record<Side, Record<'bg' | 'text' | 'border', string>> = {
  gpui: { bg: 'bg-series-gpui', text: 'text-series-gpui', border: 'border-series-gpui' },
  tanstack: { bg: 'bg-series-tanstack', text: 'text-series-tanstack', border: 'border-series-tanstack' },
};

/** A side's series color as a Tailwind class: `bg-series-gpui`, … */
export const seriesClass = (side: Side, kind: 'bg' | 'text' | 'border') => SERIES[side][kind];

/** A series' dot: each side's color, beside its name (never instead). Here,
 *  not in the window's module, so the galleries' chunk shares it without
 *  splitting the window out of the first-paint chunk. */
export const seriesDot = (side: Side) => h('span', { className: `size-2 shrink-0 rounded-full ${seriesClass(side, 'bg')}`, 'aria-hidden': true });

/** A count as the page says it: "1.57 million". */
export const millions = (count: number) => `${(count / 1e6).toFixed(2)} million`;

const COPY: Record<string, ScenarioCopy> = {
  'big-file': {
    lead: (rows) => `Scroll ${millions(rows)} asteroids. Flip the switch to compare.`,
    // The base level's numbers (the research's "Where the two stacks
    // differ"): GPUI's throttled fling (cells, garbage), TanStack's first
    // usable and memory (the platform), its scroll on the compositor.
    leans: ['cells', 'gc', 'compositor', 'platform'],
    session: 'one session of opening the file, a fling, and a jump, in its own Compare',
  },
  'wide-sheet': {
    lead: (rows) => `${rows.toLocaleString('en-US')} weather stations × 365 days. Turn up the cells to find where each side stops keeping up.`,
    dial: { label: 'Cells on screen', about: 'Each stop sets the row height, the days’ width, and the text size: the same on both sides.' },
    leans: ['cells', 'decoding'],
  },
};

export const scenarioCopy = (scenario: Scenario): ScenarioCopy => {
  const copy = COPY[scenario.id];
  if (!copy) throw new Error(`no page copy for scenario ${scenario.id}`);
  return copy;
};

const tallTable = (side: Side) => (level: Level) => contenderBase('tall-table', side, level);

export const COMPONENTS: Component[] = [
  {
    id: 'tall-table',
    // As gpui-kit names its `DataTable` (docs/DECISIONS.md, "Page", the copy).
    label: 'TallTable',
    path: `${OBSERVATORY}tall-table/`,
    line: 'A GPUI table that reads its rows a page at a time.',
    card: 'A table that reads its rows a page at a time, through DuckDB-Wasm.',
    against: 'React with TanStack Virtual',
    contenders: [
      { side: 'gpui', label: 'GPUI', stack: 'the TallTable component, written in Rust and drawn by the GPU on a canvas, from WebAssembly', url: tallTable('gpui') },
      { side: 'tanstack', label: 'TanStack', stack: 'React and TanStack Virtual, in the page’s own HTML', url: tallTable('tanstack') },
    ],
    scenarios: SCENARIOS,
  },
];

/** The scenarios whose cold numbers the page shows: `cold.ts` resolves
 *  each one's, and fails the build on a missing value. A scenario joins
 *  once its numbers part has run. */
const COLD: readonly string[] = [BIG_FILE.id, WIDE_SHEET.id];

/** Whether the page has a scenario's cold numbers: without them its status
 *  bar has no cold rows, its Compare is off, and it has no description. */
export const hasCold = (scenario: Scenario): boolean => COLD.includes(scenario.id);

/** A scenario's route's fragment that opens its Compare once the page has
 *  painted (the component's page's rows link it); cleared when it does. */
export const COMPARE_HASH = 'compare';

/** A link to a scenario from a scenario's route, which carries `?side=`
 *  (`page.ts`'s `carrySide`). */
export const SCENARIO_LINK = 'data-scenario-link';

export const isDensity = (stop: Stop): stop is DensityStop => 'cells' in stop;

/** A stop as the dial names it ("~710"): the keeps-up verdict and the
 *  panel's stops name it so too. */
export const stopShort = (stop: Stop): string => (isDensity(stop) ? `~${stop.cells}` : stop.label);

/** A scenario's route: one level below its component's. */
export const scenarioPath = (component: Component, scenario: Scenario) => `${component.path}${scenario.id}/`;

/** What a route shows. */
export type Route =
  | { kind: 'overview'; path: string; html: string }
  | { kind: 'component'; path: string; html: string; component: Component }
  | { kind: 'scenario'; path: string; html: string; component: Component; scenario: Scenario };

/** Every route the build prerenders: its path, and its HTML file from the
 *  web root (Vite's multi-page input). */
export const ROUTES: Route[] = [
  { kind: 'overview', path: OBSERVATORY, html: '/index.html' },
  ...COMPONENTS.flatMap((component): Route[] => [
    { kind: 'component', path: component.path, html: `/${component.id}/index.html`, component },
    ...component.scenarios.map((scenario): Route => ({ kind: 'scenario', path: scenarioPath(component, scenario), html: `/${component.id}/${scenario.id}/index.html`, component, scenario })),
  ]),
];

export const routeAt = (path: string): Route => ROUTES.find((route) => route.path === path) ?? ROUTES[0]!;

/** The URL parameter naming the side that loads first (`?side=tanstack`);
 *  GPUI without it. */
export const SIDE_PARAM = 'side';
/** The URL parameter naming the dial's stop (`?stop=rows-26`), the
 *  scenario's default without it: the frames' own (`scenarios.ts`). */
export { STOP_PARAM } from '../../contenders/scenarios.ts';
