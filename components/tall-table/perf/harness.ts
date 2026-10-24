// What the tall table's scripts share, and only what knows the bare host:
// its paths, its port, its marks and globals. Everything app-agnostic is
// shared-web/perf/'s.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';

export const perfDir = fileURLToPath(new URL('.', import.meta.url));
export const componentDir = join(perfDir, '..');
export const repo = join(componentDir, '../..');
export const hostWebDir = join(componentDir, 'host/web');

/** `vite preview` of the host's release build. */
export const PORT = 4350;

/** The host's shapes (`host/crate/src/rows.rs`, `?shape=`). */
export const SHAPES = ['narrow', 'wide'] as const;
export type Shape = (typeof SHAPES)[number];

/** Set right after each frame in which the viewport became filled
 *  (`host/crate/src/host.rs`, `FILLED_MARK`). */
export const FILLED_MARK = 'tall-table:filled';
export const FIRST_FRAME_MARK = 'gpui:first-frame';

export type { Layout, Shown } from '../host/web/src/probe.ts';
import type { Layout, Shown } from '../host/web/src/probe.ts';

type Global = { __tallTable?: Shown; __tallTableLayout?: Layout };

/** The probe and layout, once the table has drawn both. */
export async function shown(page: Page): Promise<{ shown: Shown; layout: Layout }> {
  const handle = await page.waitForFunction(() => {
    const g = globalThis as Global;
    return g.__tallTable && g.__tallTableLayout ? { shown: g.__tallTable, layout: g.__tallTableLayout } : false;
  }, null, { timeout: 60_000, polling: 10 });
  return (await handle.jsonValue()) as { shown: Shown; layout: Layout };
}

/** Waits until the view satisfies `test` with every visible row loaded. */
export async function filledWhere(page: Page, test: string, timeout = 30_000): Promise<Shown> {
  const handle = await page.waitForFunction(
    (test) => {
      const s = (globalThis as Global).__tallTable;
      // eslint-disable-next-line no-new-func
      return s && s.end > s.first && s.loaded === s.end - s.first && new Function('s', `return ${test}`)(s) ? s : false;
    },
    test,
    { timeout, polling: 10 },
  );
  return (await handle.jsonValue()) as Shown;
}

/** The columns at least partly visible at `scrollX` (CSS px). */
export function visibleColumns(layout: Layout, scrollX: number): number {
  return layout.columns.filter((column) => column.x + column.width > scrollX && column.x < scrollX + layout.cellsWidth).length;
}
