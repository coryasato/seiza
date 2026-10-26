// What the tall table's scripts share, and only what knows the bare host:
// its paths, its port, its marks and globals. Everything app-agnostic is
// shared-web/perf/'s.

import { existsSync, readFileSync } from 'node:fs';
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

/** With `live` (`host/crate/src/host.rs`): set right after each frame that
 *  first draws a re-read page, the highest generation drawn so far in
 *  `REFRESHED_GLOBAL` (set while the frame renders, before the mark); and
 *  as each batch of the feed's updates is invalidated, its last generation
 *  in `INVALIDATED_GLOBAL`, set first. */
export const REFRESHED_MARK = 'tall-table:refreshed';
export const REFRESHED_GLOBAL = '__tallTableRefreshed';
export const INVALIDATED_MARK = 'tall-table:invalidated';
export const INVALIDATED_GLOBAL = '__tallTableInvalidated';

/** With `follow` (`host/crate/src/host.rs`): set right after each frame
 *  whose drawn tail grew while following, the end of the tail it drew in
 *  `TAIL_GLOBAL` (set while the frame renders, before the mark); whether
 *  the table follows in `FOLLOWING_GLOBAL`; and as each batch of the tail
 *  feed is appended, the rows the source holds in `APPENDED_GLOBAL`, set
 *  first. */
export const TAIL_MARK = 'tall-table:tail';
export const TAIL_GLOBAL = '__tallTableTail';
export const FOLLOWING_GLOBAL = '__tallTableFollowing';
export const APPENDED_MARK = 'tall-table:appended';
export const APPENDED_GLOBAL = '__tallTableAppended';
/** With `follow` (`host/crate/src/rows.rs`, `Reads`): the reads the host's
 *  source was sent so far, and those cancelled in flight, each set as it
 *  changes. */
export const READS_SENT_GLOBAL = '__tallTableReadsSent';
export const READS_DRAINED_GLOBAL = '__tallTableReadsDrained';

/** The host's paint styles with `custom-cells` (`host/crate/src/rows.rs`,
 *  `Cells`, `?cells=`): `text` paints nothing, the control. */
export const CELL_STYLES = ['text', 'heat', 'bars', 'color'] as const;
export type CellStyle = (typeof CELL_STYLES)[number];

/** The host features the release build in `host/web/dist` was built with
 *  (`just tall-table build <features>` writes `dist/build.json`); none, the
 *  base, for a build that wrote none. */
export function builtFeatures(): string[] {
  const file = join(hostWebDir, 'dist/build.json');
  if (!existsSync(file)) return [];
  const { features } = JSON.parse(readFileSync(file, 'utf8')) as { features: string };
  return features.split(/[ ,]+/).filter(Boolean);
}

/** The build's name in results: `base`, or its features. */
export function buildName(features: string[]): string {
  return features.length ? features.join('+') : 'base';
}

export type { Cell, Layout, Shown } from '../host/web/src/probe.ts';
import type { Cell, Layout, Shown } from '../host/web/src/probe.ts';

type Global = { __tallTable?: Shown; __tallTableLayout?: Layout; __tallTableCells?: Cell[] };

/** The cells the last frame drew, with their paint (`custom-cells`, a
 *  painted style). */
export async function drawnCells(page: Page): Promise<Cell[]> {
  const handle = await page.waitForFunction(() => (globalThis as Global).__tallTableCells ?? false, null, { timeout: 30_000, polling: 10 });
  return (await handle.jsonValue()) as Cell[];
}

/** The screen's color at (`x`, `y`) in CSS px, 8-bit RGBA: a 1×1 CSS px
 *  screenshot, its top-left device pixel. */
export async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = (await page.screenshot({ clip: { x, y, width: 1, height: 1 } })).toString('base64');
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  }, png);
}

/** Global `name` on the page. */
export async function global<T>(page: Page, name: string): Promise<T | undefined> {
  return page.evaluate((name) => (globalThis as Record<string, unknown>)[name] as T | undefined, name);
}

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
