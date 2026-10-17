/**
 * The TanStack contender's page. For now the data layer alone, headless: a
 * status line, then (after first paint) the engine started, the file
 * opened, and the first screen of rows read through the paging. The view
 * replaces it.
 */

import { createBridge } from '@seiza/duckdb/bridge';

const status = document.getElementById('status')!;
// The engine's bundles and extensions are served from /observatory/duckdb/ (vite.config.ts).
const bridge = createBridge({ extensionDir: 'duckdb' });
const dataUrl = `${import.meta.env.BASE_URL}data/asteroids.parquet`;
/** Rows the first screen holds: the GPUI contender's viewport at 1440×900,
 *  as the paging fixture's scenarios give it. The view measures its own. */
const SCREEN_ROWS = 27.5;
/** A float's characters at the pinned column width (cells.json's budgets). */
const FLOAT_BUDGET = 12;

async function open(): Promise<void> {
  // The data layer and Arrow load here, after first paint, with the engine.
  const [{ openTable }, { shownText }] = await Promise.all([import('./data/table.ts'), import('./data/format.ts')]);
  const { file, paging } = await openTable(bridge, 'asteroids.parquet', dataUrl);
  status.textContent = `${file.rows.toLocaleString('en-US')} rows, ${file.columns.length} columns. Reading the first rows…`;
  paging.onChange = () => {
    const row = paging.row(0);
    if (row.kind === 'pending') return;
    if (row.kind === 'failed') {
      status.textContent = `The first rows failed: ${row.message}`;
      return;
    }
    const cells = file.columns.map((column, index) => `${column.name}: ${shownText(column.kind, row.page.value(row.index, index) ?? null, FLOAT_BUDGET)}`);
    status.textContent = `${file.rows.toLocaleString('en-US')} rows, ${file.columns.length} columns, ${paging.cacheBytes()} bytes cached.\nRow 1: ${cells.join(', ')}`;
  };
  paging.setViewportRows(SCREEN_ROWS);
}

/** Runs `run` once the first paint is on screen: at its paint timing entry
 *  (the frame's presentation, which comes after the task that drew it), or
 *  two frames on where there's no paint timing. */
function afterFirstPaint(run: () => void): void {
  if (!PerformanceObserver.supportedEntryTypes.includes('paint')) {
    requestAnimationFrame(() => requestAnimationFrame(run));
    return;
  }
  const observer = new PerformanceObserver(() => {
    observer.disconnect();
    run();
  });
  observer.observe({ type: 'paint', buffered: true });
}

afterFirstPaint(() =>
  open().catch((error: unknown) => {
    status.textContent = `The data didn't load: ${error instanceof Error ? error.message : String(error)}`;
  }),
);
