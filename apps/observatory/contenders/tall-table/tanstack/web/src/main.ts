/**
 * The TanStack contender's page. Its first screen, the table's empty frame
 * with one status line (the GPUI contender's first frame), is prerendered
 * into the HTML (`vite.config.ts`); the view (React, in the entry) hydrates
 * it. Once the HTML has painted and the hydration has committed, the data
 * layer and Arrow load with the engine, the file opens, and the table
 * replaces the line.
 *
 * The contract's page marks (`docs/contender-contract.md`): `first-pixels`
 * at the first screen's paint, `usable` in the hydration commit, `open` as
 * the file starts opening; the view marks `filled` (`contract.ts`).
 */

import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { hydrateRoot } from 'react-dom/client';
import { createBridge } from '@seiza/duckdb/bridge';
import { MARKS, followPageTheme, measuring, publishContender, readingOut } from '../../../../contract.ts';
import { DATA, ENGINE_DIR, OBSERVATORY } from '../../../../paths.ts';
import { pickScenario, type MarketScenario, type RateStop } from '../../../../scenarios.ts';
import { replay } from './contract.ts';
import { heatCss, wideScene, type WideScene } from './scene.ts';
import { App, FIRST_SCREEN, type Load } from './view.ts';
// The market level's, after the view's: imported first, it'd move the
// other levels' modules in their bundles.
import { marketCss } from './market.ts';
import type { TablePage } from './data/table.ts';
import './theme.css';
import './view.css';
import './level.css';

// The scenario and stop the URL asks for, on this build's level
// (`contenders/scenarios.ts`); one it doesn't have is a failure the frame
// shows (`contender:failed`), and nothing opens.
const picked = pickScenario(__LEVEL__, new URLSearchParams(location.search));
/** The data file's SQL name, which the page SQL names: the same on both
 *  sides (root `CLAUDE.md`, "Comparison protocol"). */
const FILE = picked instanceof Error ? '' : picked.scenario.data;
/** What the wide level sets on the table at the stop (`scene.ts`); a
 *  scenario the build can't set fails the load as an unknown one does, never
 *  drawing the base's table in its place. */
let scene: WideScene | undefined;
let unset: Error | null = null;
if (__LEVEL__ === 'wide' && !(picked instanceof Error)) {
  if (picked.scenario.level === 'wide' && 'rowHeight' in picked.stop) {
    scene = wideScene(picked.scenario, picked.stop);
    const heat = document.createElement('style');
    heat.textContent = heatCss(picked.scenario);
    document.head.append(heat);
  } else unset = new Error(`the wide level can't set ${picked.scenario.id} at ${picked.stop.id}`);
}
/** `?ticks=<n>`: the feed ends after n ticks (0, the default: never). */
const TICKS_PARAM = 'ticks';
/** What the market level runs at the stop: the scenario, its rate, and the
 *  feed's limit. Anything else (a scenario of another level, `?ticks` not a
 *  count) fails the load, as an unknown id does. */
let market: { scenario: MarketScenario; stop: RateStop; limit: number } | undefined;
if (__LEVEL__ === 'market' && !(picked instanceof Error)) {
  const asked = new URLSearchParams(location.search).get(TICKS_PARAM) ?? '0';
  const limit = /^\d+$/.test(asked) ? Number(asked) : Number.NaN;
  if (picked.scenario.level !== 'market' || !('rate' in picked.stop)) unset = new Error(`the market level can't set ${picked.scenario.id} at ${picked.stop.id}`);
  else if (!Number.isSafeInteger(limit)) unset = new Error(`?${TICKS_PARAM}=${asked}: not a count of ticks`);
  else {
    market = { scenario: picked.scenario, stop: picked.stop, limit };
    const colors = document.createElement('style');
    colors.textContent = marketCss(picked.scenario);
    document.head.append(colors);
  }
}
/** Why this frame opens nothing, if it doesn't. */
const failure = picked instanceof Error ? picked : unset;

const firstPixels = markFirstPixels();

let resolveHydrated!: () => void;
const hydrated = new Promise<void>((resolve) => (resolveHydrated = resolve));
const onHydrated = () => {
  performance.mark(MARKS.usable);
  resolveHydrated();
};
const root = hydrateRoot(document.getElementById('root')!, h(App, { load: FIRST_SCREEN, hydrated: onHydrated }));
const show = (load: Load) => root.render(h(App, { load, hydrated: onHydrated }));

// The page's theme, live: the root's `data-theme`, which theme.css follows.
followPageTheme();

// The engine's bundles and extensions are served from /observatory/duckdb/ (`contenderBuild`).
const bridge = createBridge({ extensionDir: ENGINE_DIR, extensionBase: OBSERVATORY });
const dataUrl = `${DATA}${FILE}`;
/** Each open's table, by number. */
let opens = 0;
/** The open running, if one is: the replay's `open` waits for it. */
let opening: Promise<number> | null = null;
/** The shown table's paging, closed as the next open starts (its reads
 *  would compete with the open's, as the GPUI host cancels them), in the
 *  task that takes the table off screen. */
let shownPaging: { close(): void } | null = null;

type DataLayer = typeof import('./data/table.ts') & typeof import('./data/paging.ts');
/** The market level's data layer (`data/quotes.ts`), loaded with the rest. */
let marketLayer: Promise<typeof import('./data/quotes.ts')> | null = null;
/** The market level's feed starts once a page: a table opened again (the
 *  replay's `open`) gets none, since its store starts over and would miss
 *  the ticks sent meanwhile. */
let feedStarted = false;
/** Waits for the shown table's first fill to start the feed; a reopen
 *  stops it waiting. */
let feedWatch: PerformanceObserver | null = null;
interface Engine {
  data: DataLayer;
  queries: InstanceType<DataLayer['Queries']>;
  parquet: Promise<void>;
}
let engine: Promise<Engine> | null = null;

/** The data layer and Arrow, loaded here, after first paint, with the
 *  engine, which starts once. */
function startEngine(): Promise<Engine> {
  if (!engine) {
    const started = (async () => {
      if (__LEVEL__ === 'market') marketLayer = import('./data/quotes.ts');
      const [table, paging] = await Promise.all([import('./data/table.ts'), import('./data/paging.ts')]);
      const data = { ...table, ...paging };
      const queries = new data.Queries(bridge);
      const { parquet } = await data.startEngine(queries);
      return { data, queries, parquet };
    })();
    // A start that failed, or whose Parquet extension didn't load, is tried
    // again by the next open.
    started.then(({ parquet }) => parquet).catch(() => {
      if (engine === started) engine = null;
    });
    engine = started;
  }
  return engine;
}

/** Opens the file (again, for the replay's `open`), showing its status
 *  meanwhile; resolves with the open's number, or rejects, with the
 *  failure shown, if it couldn't. */
async function openFile(): Promise<number> {
  if (failure) {
    show({ kind: 'waiting', status: `Couldn't load the scenario: ${failure.message}`, failed: true });
    performance.mark(MARKS.failed);
    throw failure;
  }
  let ready: Engine;
  try {
    ready = await startEngine();
  } catch (error) {
    show({ kind: 'waiting', status: `The engine didn't load: ${message(error)}`, failed: true });
    performance.mark(MARKS.failed);
    throw error;
  }
  const { data, queries, parquet } = ready;
  performance.mark(MARKS.open);
  // The table comes off screen now, so nothing scrolls it once it's closed.
  flushSync(() => show({ kind: 'waiting', status: `Opening ${FILE}…` }));
  shownPaging?.close();
  shownPaging = null;
  try {
    const file = await data.openParquet(bridge, queries, parquet, FILE, dataUrl);
    if (__LEVEL__ === 'market') return await openMarket(data, file);
    const paging = new data.TablePaging<TablePage>(file.rows, file.source);
    shownPaging = paging;
    // The first screen is gone: its paint, if it never came (a hidden
    // page), isn't waited for any longer.
    firstPixels.disconnect();
    const id = ++opens;
    show({ kind: 'open', id, rows: file.rows, columns: file.columns, paging, scene });
    return id;
  } catch (error) {
    show({ kind: 'waiting', status: `Couldn't open ${FILE}: ${message(error)}`, failed: true });
    performance.mark(MARKS.failed);
    throw error;
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The market level's open (`openFile`'s, once the file's summary is read):
 * the file checked as the feed's instruments, its table over the store
 * (`data/quotes.ts`), shown; the feed's worker started once the table first
 * fills (after first paint, root rule 2), ended by the next open. A feed
 * that stops (a refused batch, the worker failing) replaces the table with
 * the failure, marked `contender:failed`.
 */
async function openMarket(data: DataLayer, file: Awaited<ReturnType<DataLayer['openParquet']>>): Promise<number> {
  const layer = await marketLayer!;
  const wrong = layer.checkFile(file.columns, file.rows);
  if (wrong) throw new Error(wrong);
  const source = new layer.MarketSource(file.source);
  const paging = new data.TablePaging(file.rows, source);
  const { scenario, stop, limit } = market!;
  let cells: Awaited<ReturnType<typeof layer.marketTable>>;
  try {
    cells = await layer.marketTable(scenario, stop, limit, paging, source, file.columns, measuring(), readingOut());
  } catch (error) {
    // Its reads, if any started, cancelled as a shown table's are.
    paging.close();
    throw error;
  }
  shownPaging = {
    close: () => {
      cells.stop();
      paging.close();
    },
  };
  firstPixels.disconnect();
  const id = ++opens;
  show({ kind: 'open', id, rows: file.rows, columns: file.columns, paging, scene: cells });
  // Started at this table's first fill, if no table has had the feed yet:
  // set as it starts, so a table that never filled leaves it to the next.
  feedWatch?.disconnect();
  feedWatch = null;
  if (!feedStarted) {
    const filled = new PerformanceObserver((list) => {
      if (!list.getEntriesByName(MARKS.filled).length) return;
      filled.disconnect();
      if (feedWatch === filled) feedWatch = null;
      if (id !== opens || feedStarted) return;
      feedStarted = true;
      cells.startFeed((why) => {
        if (id !== opens) return;
        shownPaging?.close();
        shownPaging = null;
        show({ kind: 'waiting', status: `The feed stopped: ${why}`, failed: true });
        performance.mark(MARKS.failed);
      });
    });
    feedWatch = filled;
    filled.observe({ type: 'mark' });
  }
  return id;
}

/** Opens the file once nothing else is: after the hydration commit and
 *  any open still running, so the replay's `open` never races the first. */
function openAfter(): Promise<number> {
  const previous = opening;
  const next = (async () => {
    await hydrated;
    await previous?.catch(() => {});
    return openFile();
  })();
  opening = next;
  return next;
}

// A frame whose scenario or stop this build lacks opens nothing: its replay
// fails at once rather than wait for a fill.
const unknown = (): Promise<never> => Promise.reject(failure);
publishContender('tanstack', failure ? { open: unknown, fling: unknown, jump: unknown } : replay(openAfter));

/**
 * `contender:first-pixels` at the prerendered screen's paint: its line's
 * Element Timing entry (the first screen has nothing else of its own to
 * paint). Without Element Timing (Firefox, WebKit), its first contentful
 * paint, where there is one; the measured runs are Chromium's.
 */
function markFirstPixels(): PerformanceObserver {
  type ElementTiming = PerformanceEntry & { identifier: string; renderTime: number };
  const paintedAt = (entry: PerformanceEntry): number | null => {
    // `renderTime` can be 0 (as shared-web's placeholder allows for): the
    // entry's `startTime` then, its load time.
    if (entry.entryType === 'element') return (entry as ElementTiming).identifier === 'first-screen' ? (entry as ElementTiming).renderTime || entry.startTime : null;
    return entry.name === 'first-contentful-paint' ? entry.startTime : null;
  };
  const observer = new PerformanceObserver((list) => {
    const at = list.getEntries().map(paintedAt).find((at) => at !== null);
    if (at === undefined || at === null) return;
    performance.mark(MARKS.firstPixels, { startTime: at });
    observer.disconnect();
  });
  const types = PerformanceObserver.supportedEntryTypes;
  if (types.includes('element')) observer.observe({ type: 'element', buffered: true });
  else if (types.includes('paint')) observer.observe({ type: 'paint', buffered: true });
  return observer;
}

/**
 * Runs `run` once, after the first paint: at its paint timing entry (the
 * frame's presentation, which comes after the task that drew it), or two
 * frames on where there's no paint timing. A page that can't paint starts
 * it at once, as there's nothing to wait for: one hidden now or before its
 * paint (a background tab, with neither paint nor frames), and one whose
 * viewport is empty (a frame with `display: none`, which reports itself
 * visible and never paints).
 */
function afterFirstPaint(run: () => void): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    observer?.disconnect();
    document.removeEventListener('visibilitychange', unpaintable);
    window.removeEventListener('resize', unpaintable);
    run();
  };
  const unpaintable = () => {
    if (document.visibilityState === 'hidden' || window.innerWidth === 0 || window.innerHeight === 0) once();
  };
  let observer: PerformanceObserver | undefined;
  if (PerformanceObserver.supportedEntryTypes.includes('paint')) {
    observer = new PerformanceObserver(once);
    observer.observe({ type: 'paint', buffered: true });
  } else {
    requestAnimationFrame(() => requestAnimationFrame(once));
  }
  document.addEventListener('visibilitychange', unpaintable);
  window.addEventListener('resize', unpaintable);
  unpaintable();
}

// The engine starts once the page is usable: the HTML's paint usually comes
// first, and starting there would put the data layer's import and the
// engine's start in hydration's way (the GPUI contender starts it after its
// first frame, its usable moment).
afterFirstPaint(() => {
  openAfter().catch(() => {});
});
