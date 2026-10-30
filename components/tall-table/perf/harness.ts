// What the tall table's scripts share, and only what knows the bare host:
// its paths, its port, its marks and globals. Everything app-agnostic is
// shared-web/perf/'s.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { option } from '../../../shared-web/perf/protocol.ts';

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
/** With `follow` or `copy` (`host/crate/src/rows.rs`, `Reads`): the reads
 *  the host's source was sent so far, and those cancelled in flight, each
 *  set as it changes. */
export const READS_SENT_GLOBAL = '__tallTableReadsSent';
export const READS_DRAINED_GLOBAL = '__tallTableReadsDrained';

/** With `resize` (`host/crate/src/host.rs`, `WIDTHS_GLOBAL`): each
 *  column's set width (CSS px, `null` for its kind's), replaced at each
 *  release or fit that changed one. */
export const WIDTHS_GLOBAL = '__tallTableWidths';

/** With `select` (`host/crate/src/host.rs`, `SELECTION_GLOBAL`): what's
 *  selected (`Selection`, or `null`), replaced at each change. */
export const SELECTION_GLOBAL = '__tallTableSelection';

/** With `sort` (`host/crate/src/host.rs`): the order (`Sort`, or `null`),
 *  replaced at each change, and the mark set as it changes, in the task
 *  that changed it (a click's). */
export const SORTED_GLOBAL = '__tallTableSorted';
export const SORTED_MARK = 'tall-table:sorted';
/** The column each shape's sort scripts sort by (`perf.ts`'s sorted
 *  segments, `sort.ts`'s clicks, `smoke.ts`'s opened run): the narrow
 *  shape's `H` and the wide's first, floats, so a click sorts descending
 *  first. */
export const SORTED_COLUMN: Record<Shape, number> = { narrow: 5, wide: 0 };

/** With `pin` (`host/crate/src/host.rs`, `PINNED_GLOBAL`): the columns
 *  pinned in effect, replaced as the run changes. */
export const PINNED_GLOBAL = '__tallTablePinned';
/** The columns each shape pins by default (`host/crate/src/rows.rs`,
 *  `Shape::pinned`): the narrow shape's `spkid` and `full_name`, the
 *  wide's first. */
export const DEFAULT_PINNED: Record<Shape, number> = { narrow: 2, wide: 1 };

/** With `copy` (`host/crate/src/host.rs`): what became of the last copy
 *  (`CopyState`), replaced at each step; set as a copy starts (in the
 *  key's task), as its text is all in, and as the browser wrote it. */
export const COPY_GLOBAL = '__tallTableCopy';
export const COPY_STARTED_MARK = 'tall-table:copy-started';
export const COPIED_MARK = 'tall-table:copied';
export const COPY_WRITTEN_MARK = 'tall-table:copy-written';

/** The host's paint styles with `custom-cells` (`host/crate/src/rows.rs`,
 *  `Cells`, `?cells=`): `text` paints nothing, the control. */
export const CELL_STYLES = ['text', 'heat', 'bars', 'color'] as const;
export type CellStyle = (typeof CELL_STYLES)[number];

/** `--name`'s value, which must be one of `known`; all of them without it. */
export function pick<T extends string>(name: string, known: readonly T[]): T[] {
  const given = option(name);
  if (given === undefined) return [...known];
  if (!known.includes(given as T)) throw new Error(`--${name} ${given}: not one of ${known.join(', ')}`);
  return [given as T];
}

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

export type { Cell, CopyState, Layout, Selection, Shown, Sort } from '../host/web/src/probe.ts';
import type { Cell, CopyState, Layout, Selection, Shown, Sort } from '../host/web/src/probe.ts';

type Global = {
  __tallTable?: Shown;
  __tallTableLayout?: Layout;
  __tallTableCells?: Cell[];
  __tallTableCopy?: CopyState;
  /** With `copy` or `sort` and `?perf` (`host/crate/src/host.rs`, `script_hooks`). */
  __tallTableExact?: (row: number, column: number) => string | null;
  __tallTableSort?: (column: number, direction: string) => boolean;
  __tallTableSourceRow?: (row: number) => number;
  __tallTableDrained?: () => number;
  __tallTableSelect?: (kind: string, anchorRow: number, anchorColumn: number, headRow: number, headColumn: number) => void;
  __tallTableClose?: () => void;
  /** With `pin` and `?perf`. */
  __tallTablePin?: (columns: number) => boolean;
};

/** The cells the last frame drew, with their paint (`custom-cells`, a
 *  painted style). */
export async function drawnCells(page: Page): Promise<Cell[]> {
  const handle = await page.waitForFunction(() => (globalThis as Global).__tallTableCells ?? false, null, { timeout: 30_000, polling: 10 });
  return (await handle.jsonValue()) as Cell[];
}

/** The screen's color at (`x`, `y`) in CSS px, 8-bit RGBA: a 1×1 CSS px
 *  screenshot, its top-left device pixel. */
export async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return (await decoded(page, [await screenshot(page, { x, y, width: 1, height: 1 })], null)) as number[];
}

/** The screen in `clip` (CSS px), a PNG as base64, at the screenshot's
 *  device pixels. */
export async function screenshot(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<string> {
  return (await page.screenshot({ clip })).toString('base64');
}

/** How many pixels of two screenshots (`screenshot`'s) differ by more than
 *  `within` in a color channel, compared in the page: 0 for the same,
 *  every pixel for different sizes. */
export async function differingPixels(page: Page, a: string, b: string, within: number): Promise<number> {
  return a === b ? 0 : ((await decoded(page, [a, b], within)) as number);
}

/** The screenshots `pngs` decoded in the page: with `within` null, the
 *  first one's pixels (8-bit RGBA, row by row); else the count of the two's
 *  pixels differing by more than `within` in a color channel. Decoded and
 *  compared there, so a large clip's pixels never cross to Node. */
async function decoded(page: Page, pngs: string[], within: number | null): Promise<number[] | number> {
  return page.evaluate(
    async ({ pngs, within }) => {
      const images = await Promise.all(
        pngs.map(async (png) => {
          const image = new Image();
          image.src = `data:image/png;base64,${png}`;
          await image.decode();
          const canvas = new OffscreenCanvas(image.width, image.height);
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, image.width, image.height);
        }),
      );
      const [a, b] = images as [ImageData, ImageData | undefined];
      if (within === null || !b) return Array.from(a.data);
      if (a.width !== b.width || a.height !== b.height) return Math.max(a.width * a.height, b.width * b.height);
      let count = 0;
      for (let index = 0; index < a.data.length; index += 4) {
        if (Math.abs(a.data[index]! - b.data[index]!) > within || Math.abs(a.data[index + 1]! - b.data[index + 1]!) > within || Math.abs(a.data[index + 2]! - b.data[index + 2]!) > within) count++;
      }
      return count;
    },
    { pngs, within },
  );
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

/** With `pin`, the run's edge (*P*): the pinned columns' right edge, in
 *  CSS px from the cells' left; 0 with none pinned (or without `pin`). */
export function pinEdge(layout: Layout): number {
  const pinned = layout.pinned ?? 0;
  return pinned ? Math.min(layout.columns[pinned - 1]!.x + layout.columns[pinned - 1]!.width, layout.cellsWidth) : 0;
}

/** Column `column`'s left edge on screen at `scrollX`, CSS px from the
 *  cells' left: a pinned column (`pin`) stays at its `x`. */
export function screenLeft(layout: Layout, column: number, scrollX: number): number {
  return layout.columns[column]!.x - (column < (layout.pinned ?? 0) ? 0 : scrollX);
}

/** The columns at least partly visible at `scrollX` (CSS px): with `pin`,
 *  every pinned one, and the scrolled ones reaching right of the run. */
export function visibleColumns(layout: Layout, scrollX: number): number {
  const edge = pinEdge(layout);
  return layout.columns.filter((column, index) => {
    const left = screenLeft(layout, index, scrollX);
    return index < (layout.pinned ?? 0) || (left + column.width > edge && left < layout.cellsWidth);
  }).length;
}

/** The middle of column `column`'s band at `scrollX` (CSS px), with
 *  `resize`: its hairline, the column's right edge's last pixel, in the
 *  header, the row above the body. */
export function bandAt(layout: Layout, column: number, scrollX: number): { x: number; y: number } {
  const { width } = layout.columns[column]!;
  return { x: layout.left + screenLeft(layout, column, scrollX) + width - 0.5, y: layout.top - layout.rowHeight / 2 };
}

/** The cells' sideways room: how far `scrollX` can go. */
export function sidewaysRoom(layout: Layout): number {
  const last = layout.columns.at(-1)!;
  return Math.max(0, last.x + last.width - layout.cellsWidth);
}

/** The layout once column `column` is `width` wide in it (the table
 *  reports it at a resize's release). */
export async function laidOutAt(page: Page, column: number, width: number, timeout = 10_000): Promise<Layout> {
  const handle = await page.waitForFunction(
    ({ column, width }) => {
      const layout = (globalThis as Global).__tallTableLayout;
      return layout && Math.abs(layout.columns[column]!.width - width) < 0.01 ? layout : false;
    },
    { column, width },
    { timeout, polling: 10 },
  );
  return (await handle.jsonValue()) as Layout;
}

/** Where to press, in CSS px, with `select`: the middle of a visible
 *  cell, of a visible row's number (just left of the cells), of a column's
 *  header, or of the corner over the row numbers. */
export function cellAt(layout: Layout, view: Shown, row: number, column: number): { x: number; y: number } {
  const { width } = layout.columns[column]!;
  return { x: layout.left + screenLeft(layout, column, view.scrollX) + width / 2, y: layout.top + (row - view.top + 0.5) * layout.rowHeight };
}
export function gutterAt(layout: Layout, view: Shown, row: number): { x: number; y: number } {
  return { x: layout.left - 6, y: layout.top + (row - view.top + 0.5) * layout.rowHeight };
}
export function headerAt(layout: Layout, view: Shown, column: number): { x: number; y: number } {
  return { ...cellAt(layout, view, 0, column), y: layout.top - layout.rowHeight / 2 };
}
export function cornerAt(layout: Layout): { x: number; y: number } {
  return { x: layout.left - 6, y: layout.top - layout.rowHeight / 2 };
}

/** The probe once its selection is `want` (compared as JSON; `null` for
 *  none) and the published global agrees. */
export async function selected(page: Page, want: Selection | null, timeout = 10_000): Promise<Shown> {
  const handle = await page.waitForFunction(
    ({ want, name }) => {
      const g = globalThis as Global & Record<string, unknown>;
      const s = g.__tallTable;
      const json = JSON.stringify(want);
      return s && JSON.stringify(s.selection ?? null) === json && JSON.stringify(g[name] ?? null) === json ? s : false;
    },
    { want, name: SELECTION_GLOBAL },
    { timeout, polling: 10 },
  );
  return (await handle.jsonValue()) as Shown;
}

/** With `copy`: the copy's state once a copy after `afterId` (or a
 *  declined one, `afterId` given as is) reaches one of `states`. */
export async function copyReached(page: Page, afterId: number, states: CopyState['state'][], timeout = 30_000): Promise<CopyState> {
  const handle = await page
    .waitForFunction(
      ({ afterId, states }) => {
        const copy = (globalThis as Global).__tallTableCopy;
        return copy && states.includes(copy.state) && (copy.id === null || copy.id > afterId) ? copy : false;
      },
      { afterId, states },
      { timeout, polling: 20 },
    )
    .catch(async () => {
      const now = await page.evaluate(() => (globalThis as Global).__tallTableCopy);
      throw new Error(`no copy after ${afterId} reached ${states.join(' or ')} in ${timeout} ms: ${JSON.stringify(now ?? null)}`);
    });
  const state = (await handle.jsonValue()) as CopyState;
  if (state.id !== null) seenIds.set(page, Math.max(seenIds.get(page) ?? 0, state.id));
  return state;
}

/** The highest copy id each page has published, kept here: a declined
 *  copy's outcome has none. */
const seenIds = new WeakMap<Page, number>();

/** The id of the last copy started, 0 before any: the global's, or (while
 *  it shows a declined copy) the last one seen. */
export async function lastCopyId(page: Page): Promise<number> {
  const id = await page.evaluate(() => (globalThis as Global).__tallTableCopy?.id ?? null);
  const last = Math.max(id ?? 0, seenIds.get(page) ?? 0);
  seenIds.set(page, last);
  return last;
}

/** With `copy` and `?perf`: the table's `select`, through the host's hook,
 *  then the probe agreeing. */
export async function selectThrough(page: Page, want: Selection): Promise<void> {
  await page.evaluate(({ kind, anchor, head }) => (globalThis as Global).__tallTableSelect!(kind, anchor[0], anchor[1], head[0], head[1]), want);
  await selected(page, want);
}

/** With `copy` or `sort` and `?perf`: each `[row, column]`'s exact text,
 *  `null` for NULL (the host's source, as a read now answers it). */
export async function exactTexts(page: Page, cells: [number, number][]): Promise<(string | null)[]> {
  return page.evaluate((cells) => cells.map(([row, column]) => (globalThis as Global).__tallTableExact!(row, column)), cells);
}

/** A real paste of the clipboard: a textarea put over the page, focused,
 *  given Cmd+V (Ctrl+V elsewhere), read, and removed, with the element
 *  that had the focus before (gpui-pre-web's key target) focused again for
 *  the table's keys. */
export async function paste(page: Page): Promise<string> {
  await page.evaluate(() => {
    (globalThis as { __pasteFocus?: Element | null }).__pasteFocus = document.activeElement;
    const area = document.createElement('textarea');
    area.id = '__paste';
    area.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;opacity:0';
    document.body.append(area);
    area.focus();
  });
  await page.keyboard.press('ControlOrMeta+V');
  // The paste lands in the key's task; a large one may take a while more
  // (Firefox's 2 MB took past 2 s). An empty clipboard waits it all out.
  const text = await page
    .waitForFunction(() => (document.getElementById('__paste') as HTMLTextAreaElement).value || false, null, { timeout: 15_000, polling: 20 })
    .then((handle) => handle.jsonValue() as Promise<string>)
    .catch(() => '');
  await page.evaluate(() => {
    document.getElementById('__paste')!.remove();
    ((globalThis as { __pasteFocus?: Element | null }).__pasteFocus as HTMLElement | null)?.focus();
  });
  return text;
}

/** Text in a spreadsheet's TSV (`copy`'s): tab-separated fields, a row a
 *  line, a field holding a tab, a line break, or `"` quoted with its quotes
 *  doubled. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let index = 0;
  while (index <= text.length) {
    if (text[index] === '"' && field === '') {
      // Quoted: to the closing quote, `""` an escaped one.
      index++;
      while (index < text.length) {
        if (text[index] === '"' && text[index + 1] === '"') (field += '"'), (index += 2);
        else if (text[index] === '"') break;
        else field += text[index++];
      }
      index++;
      continue;
    }
    const char = text[index];
    if (char === undefined || char === '\n' || char === '\t') {
      row.push(field);
      field = '';
      if (char !== '\t') (rows.push(row), (row = []));
    } else field += char;
    index++;
  }
  return rows;
}

/** With `sort`: the middle of column `column`'s arrow box at `scrollX`, in
 *  the header (CSS px); `null` where it draws none. */
export function arrowAt(layout: Layout, column: number, scrollX: number): { x: number; y: number } | null {
  const { arrow } = layout.columns[column]!;
  return arrow ? { x: layout.left + screenLeft(layout, column, scrollX) + arrow.x + arrow.width / 2, y: layout.top - layout.rowHeight / 2 } : null;
}

/** With `sort`: the probe once its order is `want` (`null` for the
 *  source's) and the published global agrees. */
export async function sortedAs(page: Page, want: Sort | null, timeout = 30_000): Promise<Shown> {
  const handle = await page.waitForFunction(
    ({ want, name }) => {
      const g = globalThis as Global & Record<string, unknown>;
      const s = g.__tallTable;
      const json = JSON.stringify(want);
      return s && JSON.stringify(s.sort ?? null) === json && JSON.stringify(g[name] ?? null) === json ? s : false;
    },
    { want, name: SORTED_GLOBAL },
    { timeout, polling: 10 },
  );
  return (await handle.jsonValue()) as Shown;
}

/** With `sort` and `?perf`: the table's `set_sort`, through the host's
 *  hook, then the probe agreeing. */
export async function sortThrough(page: Page, want: Sort | null, timeout = 30_000): Promise<Shown> {
  const sent = await page.evaluate((want) => (globalThis as Global).__tallTableSort!(want?.column ?? 0, want?.direction ?? 'none'), want);
  if (!sent) throw new Error(`the host's sort hook refused ${JSON.stringify(want)}: no such column`);
  return sortedAs(page, want, timeout);
}

/** With `sort` and `?perf`: the source's own row at each row of the order
 *  read now. */
export async function sourceRows(page: Page, rows: number[]): Promise<number[]> {
  return page.evaluate((rows) => rows.map((row) => (globalThis as Global).__tallTableSourceRow!(row)), rows);
}

/** With `sort` and `?perf`: the reads the host's source was cancelled in
 *  flight so far. */
export async function drainedReads(page: Page): Promise<number> {
  return page.evaluate(() => (globalThis as Global).__tallTableDrained!());
}

/** With `pin`: the layout once `pinned` columns are pinned in effect and
 *  the published global agrees. */
export async function pinnedAs(page: Page, pinned: number, timeout = 10_000): Promise<Layout> {
  const handle = await page.waitForFunction(
    ({ pinned, name }) => {
      const g = globalThis as Global & Record<string, unknown>;
      const layout = g.__tallTableLayout;
      return layout && layout.pinned === pinned && (g[name] ?? 0) === pinned ? layout : false;
    },
    { pinned, name: PINNED_GLOBAL },
    { timeout, polling: 10 },
  );
  return (await handle.jsonValue()) as Layout;
}

/** With `pin` and `?perf`: the table's `set_pinned`, through the host's
 *  hook, then the layout once `inEffect` (by default the count) pin. */
export async function pinThrough(page: Page, columns: number, inEffect = columns): Promise<Layout> {
  const sent = await page.evaluate((columns) => (globalThis as Global).__tallTablePin!(columns), columns);
  if (!sent) throw new Error(`the host's pin hook refused ${columns}`);
  return pinnedAs(page, inEffect);
}
