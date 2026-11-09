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
import { BIG_FILE, LIVE_TAIL, MARKET_WATCH, SCENARIOS, WIDE_SHEET, type DensityStop, type Level, type RateStop, type Scenario, type Stop } from '../../contenders/scenarios.ts';

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
  /** Its data is made up (the design canvas's "Synthetic data" tag, in the
   *  title bar and on its card). */
  synthetic?: boolean;
  /** The load explainer's data row, where it isn't the file read a page at
   *  a time: what the data is, and how this load reads it. */
  data?: { what: string; how: string };
  /** What the data is, plainly, for the status bar beside its rows: what a
   *  row is and whose it is (the description has the full credit). */
  dataLabel: string;
  /** What the frame makes beside the data, after its first rows: the load
   *  explainer's row for it (the feed, the replay's clock), and what it says
   *  once the frame has filled. */
  made?: { what: string; filled: string };
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
    dataLabel: 'Asteroid catalog, NASA/JPL',
    lead: (rows) => `Scroll ${millions(rows)} asteroids. Flip the switch to compare.`,
    // The base level's numbers (the research's "Where the two stacks
    // differ"): GPUI's throttled fling (cells, garbage), TanStack's first
    // usable and memory (the platform), its scroll on the compositor.
    leans: ['cells', 'gc', 'compositor', 'platform'],
    session: 'one session of opening the file, a fling, and a jump, in its own Compare',
  },
  'wide-sheet': {
    dataLabel: 'Daily highs by weather station, 2025 (NOAA)',
    lead: (rows) => `${rows.toLocaleString('en-US')} weather stations × 365 days. Turn up the cells to find where each side stops keeping up.`,
    dial: { label: 'Cells on screen', about: 'Each stop sets the row height, the days’ width, and the text size: the same on both sides.' },
    // TanStack ready sooner and downloading less, as in every scenario: the platform.
    leans: ['cells', 'decoding', 'platform'],
  },
  'market-watch': {
    dataLabel: 'Simulated stock prices',
    lead: () => 'Fifty instruments, every price live. Turn up the updates.',
    dial: { label: 'Updates per second', about: 'Each stop sets how many price changes the seeded feed sends per second: the same feed on both sides.' },
    // The design canvas's: cost per cell, garbage under churn, decoding;
    // and the platform, TanStack ready sooner and downloading less.
    leans: ['cells', 'gc', 'decoding', 'platform'],
    synthetic: true,
    made: { what: 'The feed (seeded, generated here)', filled: 'in its own worker' },
  },
  'live-tail': {
    dataLabel: 'NASA web server log, July 1995',
    lead: () => 'NASA’s web server, July 1995, replayed. Turn up the rows.',
    dial: { label: 'Rows per second', about: 'Each stop sets how many log rows the replay appends a second while the view follows the newest: the same clock on both sides. Each frame draws the rows that came since the last.' },
    // The design canvas's: cost per cell, garbage under a growing table;
    // TanStack's scroll back on the compositor, and the platform (ready
    // sooner, downloading less).
    leans: ['cells', 'gc', 'compositor', 'platform'],
    data: { what: 'NASA-HTTP logs', how: 'by range, then whole' },
    // Its worker starts once the file is fetched whole, after the first
    // rows: the page can't see that moment, so the row says the order.
    made: { what: 'The replay’s clock (generated here)', filled: 'once the file is whole' },
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
const COLD: readonly string[] = [BIG_FILE.id, WIDE_SHEET.id, MARKET_WATCH.id, LIVE_TAIL.id];

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
/** A rate's stop: market watch's updates or live tail's rows a second. */
export const isRate = (stop: Stop): stop is RateStop => 'rate' in stop;

/** A scenario under a feed: its frames keep this tab's Shown in
 *  (`?readout`), and the page records every frame from its first rows. */
export const feeds = (scenario: Scenario): boolean => scenario.level === 'market' || scenario.level === 'tail';

/** A stop as the dial names it ("~710", "1k"): the keeps-up verdict and
 *  the panel's stops name it so too. */
export const stopShort = (stop: Stop): string => (isDensity(stop) ? `~${stop.cells}` : isRate(stop) ? stop.id : stop.label);

/** What a stop sets, in its title and the dial's explainer; `rows`, its
 *  scenario's file's. */
export const stopSets = (scenario: Scenario, stop: Stop, rows: number): string =>
  isDensity(stop)
    ? `${stop.rowHeight} px rows · ${stop.columnWidth} px days · ${stop.textSize} px text`
    : scenario.level === 'market'
      ? `across ${rows} instruments, 10 of their 12 columns`
      : scenario.level === 'tail' && isRate(stop)
        ? // What a frame takes in at a 60 Hz display, to two figures: ~17, ~170, ~830, ~1,700.
          `~${Number((stop.rate / 60).toPrecision(2)).toLocaleString('en-US')} rows a frame at 60 Hz`
        : '';

/** Items in a sentence: "a and b", "a, b, or c" (the wins, the Overview's rule). */
export const listOf = (items: readonly string[], conjunction: 'and' | 'or'): string =>
  items.length < 3 ? items.join(` ${conjunction} `) : `${items.slice(0, -1).join(', ')}, ${conjunction} ${items.at(-1)}`;

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

/** A frame's parameter asking it to keep what this tab's readouts read
 *  beyond its marks (a feed's Shown in); the bare cold runs never send it. */
export { READOUT_PARAM } from '../../contenders/contract.ts';

/** The URL parameter naming the side that loads first (`?side=tanstack`);
 *  GPUI without it. */
export const SIDE_PARAM = 'side';
/** The URL parameter naming the dial's stop (`?stop=rows-26`), the
 *  scenario's default without it: the frames' own (`scenarios.ts`). */
export { STOP_PARAM } from '../../contenders/scenarios.ts';
