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
import { MARKS, followPageTheme, publishContender } from '../../../../contract.ts';
import { DATA, ENGINE_DIR, OBSERVATORY } from '../../../../paths.ts';
import { replay } from './contract.ts';
import { App, FIRST_SCREEN, type Load } from './view.ts';
import './theme.css';
import './view.css';

/** The data file's SQL name, which the page SQL names: the same on both
 *  sides (root `CLAUDE.md`, "Comparison protocol"). */
const FILE = 'asteroids.parquet';

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
    const paging = new data.TablePaging(file.rows, file.source);
    shownPaging = paging;
    // The first screen is gone: its paint, if it never came (a hidden
    // page), isn't waited for any longer.
    firstPixels.disconnect();
    const id = ++opens;
    show({ kind: 'open', id, rows: file.rows, columns: file.columns, paging });
    return id;
  } catch (error) {
    show({ kind: 'waiting', status: `Couldn't open ${FILE}: ${message(error)}`, failed: true });
    performance.mark(MARKS.failed);
    throw error;
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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

publishContender('tanstack', replay(openAfter));

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
