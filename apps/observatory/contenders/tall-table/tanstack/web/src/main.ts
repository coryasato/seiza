/**
 * The TanStack contender's page: the view (React, in the entry) shows the
 * table's empty frame with one status line, as the GPUI contender's first
 * frame does; after first paint the data layer and Arrow load with the
 * engine, the file opens, and the table replaces the line.
 */

import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { createBridge } from '@seiza/duckdb/bridge';
import { App, type Load } from './view.ts';
import './theme.css';
import './view.css';

/** The data file's SQL name, which the page SQL names: the same on both
 *  sides (root `CLAUDE.md`, "Comparison protocol"). */
const FILE = 'asteroids.parquet';

const root = createRoot(document.getElementById('root')!);
const show = (load: Load) => root.render(h(App, { load }));
show({ kind: 'waiting', status: 'Engine loading…' });

// The engine's bundles and extensions are served from /observatory/duckdb/ (vite.config.ts).
const bridge = createBridge({ extensionDir: 'duckdb' });
const dataUrl = `${import.meta.env.BASE_URL}data/${FILE}`;
/** Each open's table, by number. */
let opens = 0;

async function open(): Promise<void> {
  // The data layer and Arrow load here, after first paint, with the engine.
  const [{ Queries, openParquet, startEngine }, { TablePaging }] = await Promise.all([import('./data/table.ts'), import('./data/paging.ts')]);
  const queries = new Queries(bridge);
  let parquet: Promise<void>;
  try {
    ({ parquet } = await startEngine(queries));
  } catch (error) {
    show({ kind: 'waiting', status: `The engine didn't load: ${message(error)}`, failed: true });
    return;
  }
  show({ kind: 'waiting', status: `Opening ${FILE}…` });
  try {
    const file = await openParquet(bridge, queries, parquet, FILE, dataUrl);
    show({ kind: 'open', id: ++opens, rows: file.rows, columns: file.columns, paging: new TablePaging(file.rows, file.source) });
  } catch (error) {
    show({ kind: 'waiting', status: `Couldn't open ${FILE}: ${message(error)}`, failed: true });
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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

afterFirstPaint(() => {
  open().catch((error: unknown) => show({ kind: 'waiting', status: `The data didn't load: ${message(error)}`, failed: true }));
});
