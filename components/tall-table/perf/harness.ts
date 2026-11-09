// What the tall table's scripts share, and only what knows the bare host:
// its paths, its port, its marks and globals. Everything app-agnostic is
// shared-web/perf/'s.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

/** With `density` (`host/crate/src/host.rs`, `Density`): the host's
 *  default `?density=`, the dense setting: 18 px rows, 11 px text, 56 px
 *  floats. `?density=30,14` is the control, the base's numbers. */
export const DEFAULT_DENSITY = { row: 18, text: 11, width: 56 } as const;

/** With `format`: the table's advances at the text in effect, from the
 *  layout probe (`Layout`'s `advances`). */
export async function advances(page: Page): Promise<Record<string, number>> {
  const { layout } = await shown(page);
  if (!layout.advances) throw new Error('no advances in the layout probe: is the host built with format?');
  return layout.advances;
}

/** A number format, as `fixtures/cells.json`'s `format` cases spell it. */
export interface NumberFormat {
  decimals: number | null;
  sign: 'negative' | 'always';
  grouping: boolean;
  suffix: string;
}

/** The text `format` writes for a value of `kind` (`float`, `float32`,
 *  `integer`, `decimal`) written `value` (a float's shortest text; an
 *  integer's or decimal's as the source writes it), at `decimals` if a
 *  float's are given, or `null` where the table writes none (NULL, NaN, an
 *  infinity, a text that isn't a plain number; here also a float past 1e21
 *  at fixed decimals, which `toFixed` won't write out, and a float without
 *  decimals, whose shortest text JS and Rust write apart). The table's
 *  rules (README, "Format"): a float at fixed decimals rounds its exact
 *  binary value half to even (Rust's `{:.N}`; a `float32`'s value widened),
 *  the sign is the raw value's and an exact zero's none (a written minus
 *  dropped), the grouping a `,` every three whole digits, then the suffix. */
export function formatNumber(kind: string, value: string | null, format: NumberFormat, decimals: number | null = format.decimals): string | null {
  if (value === null) return null;
  let negative: boolean;
  let zero: boolean;
  let whole: string;
  let fraction: string | null;
  if (kind === 'float' || kind === 'float32') {
    let number = Number(value);
    if (kind === 'float32') number = Math.fround(number);
    if (value.trim() === '' || !Number.isFinite(number) || decimals === null || Math.abs(number) >= 1e21) return null;
    [whole, fraction = null] = fixedHalfEven(Math.abs(number), decimals).split('.') as [string, string?];
    negative = number < 0;
    zero = number === 0;
  } else if (kind === 'integer' || kind === 'decimal') {
    const match = /^([-+]?)(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match) return null;
    [, , whole, fraction] = match as unknown as [string, string, string, string | null];
    fraction ??= null;
    negative = match[1] === '-';
    zero = /^0*$/.test(whole + (fraction ?? ''));
  } else {
    return null;
  }
  const sign = zero ? '' : negative ? '-' : format.sign === 'always' ? '+' : '';
  return `${sign}${format.grouping ? grouped(whole) : whole}${fraction === null ? '' : `.${fraction}`}${format.suffix}`;
}

/** The host's formats (`host/crate/src/rows.rs`, `with_format`): every
 *  float column at 2 decimals, a `+` on a rise, grouped, with the page
 *  answering 3 on every fourth row of the source; the narrow shape's
 *  `spkid` grouped. */
export const HOST_FLOAT_FORMAT: NumberFormat = { decimals: 2, sign: 'always', grouping: true, suffix: '' };
export const HOST_SPKID_FORMAT: NumberFormat = { decimals: null, sign: 'negative', grouping: true, suffix: '' };

/** A drawn cell's text in the host's format (unsorted: the row is the
 *  source's) and the decimals it's at, or `null` for a column the host
 *  leaves alone or a value the format doesn't write. */
export function hostFormat(column: Layout['columns'][number], row: number, exact: string): { text: string; decimals: number | null } | null {
  if (column.kind === 'integer' && column.name === 'spkid') {
    const text = formatNumber('integer', exact, HOST_SPKID_FORMAT);
    return text === null ? null : { text, decimals: null };
  }
  if (column.kind !== 'float') return null;
  const decimals = row % 4 === 0 ? 3 : 2;
  const text = formatNumber('float', exact, HOST_FLOAT_FORMAT, decimals);
  return text === null ? null : { text, decimals };
}

/** `digits` with a `,` every three from the right. */
function grouped(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+$)/g, ',');
}

/** A non-negative `value` (under 1e21) at `decimals`, its exact binary value
 *  rounded half to even, as Rust's `{:.N}`: `toFixed(100)` writes the exact
 *  expansion of any value at least 2^-48 (a double's fraction digits), and
 *  a tie below that can't reach the decimals kept. */
function fixedHalfEven(value: number, decimals: number): string {
  const [whole, fraction] = value.toFixed(100).split('.') as [string, string];
  const kept = whole + fraction.slice(0, decimals);
  const rest = fraction.slice(decimals);
  const half = '5'.padEnd(rest.length, '0');
  const up = rest > half || (rest === half && Number(kept.at(-1)) % 2 === 1);
  let digits = kept;
  if (up) {
    // The kept digits plus one in the last place.
    const chars = [...kept];
    let at = chars.length - 1;
    while (at >= 0 && chars[at] === '9') chars[at--] = '0';
    if (at < 0) chars.unshift('1');
    else chars[at] = String(Number(chars[at]) + 1);
    digits = chars.join('');
  }
  const cut = digits.length - decimals;
  return decimals ? `${digits.slice(0, cut)}.${digits.slice(cut)}` : digits;
}

/** `text`'s width at `advances` (`advances`'s), as the table's fit sums it. */
export function advancesWidth(text: string, advances: Record<string, number>): number {
  return [...text].reduce((sum, ch) => {
    const advance = advances[ch];
    if (advance === undefined) throw new Error(`no advance for ${JSON.stringify(ch)} (in ${JSON.stringify(text)})`);
    return sum + advance;
  }, 0);
}

/** With `density`: a length the base fixes for 14 px text, at a `px` text
 *  size (the table's `Sizes::scaled`: scaled by the text over 14 px and
 *  rounded to a whole px; at 14 px the base's own, unrounded). */
export function scaledAt(length: number, textPx: number): number {
  return textPx === 14 ? length : Math.round((length * textPx) / 14);
}

/** With `density`: the cells' padding a side at a `px` text size (8 px
 *  scaled, `Sizes::pad`). */
export const paddingAt = (textPx: number) => scaledAt(8, textPx);

/** With `density`: a column's least width at a `px` text size unless it
 *  sets its own (40 px scaled, `Sizes::least`). */
export const leastAt = (textPx: number) => scaledAt(40, textPx);

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

/** What draws the table: the Rust sources, the manifests, the fonts. */
const SOURCES = ['*.rs', '*Cargo.toml', 'Cargo.lock', 'shared-web/fonts'];

/** The tree a screen or build is drawn from: the commit, and a hash of its
 *  changes to `SOURCES` (the diff against HEAD and each untracked source
 *  file's path and bytes), so a screen from another tree is refused. */
export function drawnFrom(): { commit: string; changes: string } {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
  const hash = createHash('sha256').update(git('diff', 'HEAD', '--binary', '--', ...SOURCES));
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z', '--', ...SOURCES).toString().split('\0').filter(Boolean).sort();
  for (const file of untracked) hash.update(`\0${file}\0`).update(readFileSync(join(repo, file)));
  return { commit: git('rev-parse', 'HEAD').toString().trim(), changes: hash.digest('hex').slice(0, 16) };
}

/** The hash of no changes: a clean tree's. */
export const UNCHANGED = createHash('sha256').digest('hex').slice(0, 16);

/** The tree the release build in `host/web/dist` was built from
 *  (`dist/build.json`'s `tree`, written by `perf/build-info.ts`); `null`
 *  for a build that wrote none. */
export function builtFrom(): { commit: string; changes: string } | null {
  const file = join(hostWebDir, 'dist/build.json');
  if (!existsSync(file)) return null;
  return (JSON.parse(readFileSync(file, 'utf8')) as { tree?: { commit: string; changes: string } }).tree ?? null;
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
  /** With `density` and `?perf`. */
  __tallTableDensity?: (row: number, text: number) => boolean;
  /** With `follow` and `?perf`. */
  __tallTableLetGo?: () => void;
};

/** The cells the last frame drew, with their paint (`custom-cells`, a
 *  painted style), once they're drawn: with `first`, from a frame whose
 *  rows start at or past it (after a scroll); with `column`, from a frame
 *  laid out with that column at that width (after a resize). */
export async function drawnCells(page: Page, where: { first?: number; column?: { index: number; width: number } } = {}): Promise<Cell[]> {
  const handle = await page.waitForFunction(
    ({ first, column }) => {
      const g = globalThis as Global;
      const cells = g.__tallTableCells;
      if (!cells) return false;
      if (first !== undefined && !(cells.length && Math.min(...cells.map((cell) => cell.row)) >= first)) return false;
      // A frame drawn at the width: the table publishes its layout and its
      // cells in the same render, so the cells beside a layout at it are
      // that frame's or a later one's.
      if (column && !(g.__tallTableLayout && Math.abs(g.__tallTableLayout.columns[column.index]!.width - column.width) < 0.01)) return false;
      return cells;
    },
    where,
    { timeout: 30_000, polling: 10 },
  );
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

/** In the page: the view if it satisfies `test` with every visible row
 *  loaded, else `false`. Self-contained, so `filledWhere` waits on it and
 *  `filledNow` reads it, one test of "filled". */
function viewFilled(test: string): Shown | false {
  const s = (globalThis as Global).__tallTable;
  // eslint-disable-next-line no-new-func
  return s && s.end > s.first && s.loaded === s.end - s.first && new Function('s', `return ${test}`)(s) ? s : false;
}

/** Waits until the view satisfies `test` with every visible row loaded. */
export async function filledWhere(page: Page, test: string, timeout = 30_000): Promise<Shown> {
  const handle = await page.waitForFunction(viewFilled, test, { timeout, polling: 10 });
  return (await handle.jsonValue()) as Shown;
}

/** The view now if it satisfies `test` with every visible row loaded. */
export async function filledNow(page: Page, test: string): Promise<Shown | null> {
  return (await page.evaluate(viewFilled, test)) || null;
}

/** The rAFs `shared-web/perf/`'s `workRecorder` has seen draw so far. */
export const presentedSoFar = (page: Page) => page.evaluate(() => (globalThis as { __seizaWork?: unknown[] }).__seizaWork?.length ?? 0);

/** A rest: the view satisfies `test` with every visible row loaded, and no
 *  frame has been presented for `quietMs` (Playwright resolves a wheel
 *  before the page handles it, so a slow table still scrolls through queued
 *  wheels after the last one resolves). Waited for in slices of `sliceMs`
 *  while the table presents frames (a slice with none ends it), `capMs` in
 *  all; `null` if it didn't rest. Needs `workRecorder` installed. */
export async function restedWhere(page: Page, test: string, { sliceMs = 10_000, capMs = 300_000, quietMs = 300 } = {}): Promise<Shown | null> {
  const start = Date.now();
  while (Date.now() - start < capMs) {
    const before = await presentedSoFar(page);
    const view = await filledWhere(page, test, sliceMs).catch(() => null);
    const quiet =
      view &&
      (await page
        .waitForFunction((quietMs) => performance.now() - ((globalThis as { __seizaWork?: { t: number }[] }).__seizaWork?.at(-1)?.t ?? 0) >= quietMs, quietMs, { timeout: sliceMs, polling: 20 })
        .then(
          () => true,
          () => false,
        ));
    // Still where `test` wants it once quiet, or the input moved it on.
    const still = quiet && (await filledNow(page, test));
    if (still) return still;
    if ((await presentedSoFar(page)) === before) return null;
  }
  return null;
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

/** Waits until the table's following flag (`FOLLOWING_GLOBAL`, the
 *  bridge's at each `Following`) is `on`. */
export async function followingIs(page: Page, on: boolean, timeout = 10_000): Promise<void> {
  await page.waitForFunction(({ name, on }) => (globalThis as Record<string, unknown>)[name] === on, { name: FOLLOWING_GLOBAL, on }, { timeout, polling: 10 });
}

/** With `follow` and `?perf`: the table's `let_go`, through the host's
 *  hook, then the flag off. */
export async function letGo(page: Page): Promise<void> {
  await page.evaluate(() => (globalThis as Global).__tallTableLetGo!());
  await followingIs(page, false);
}

/** With `pin` and `?perf`: the table's `set_pinned`, through the host's
 *  hook, then the layout once `inEffect` (by default the count) pin. */
export async function pinThrough(page: Page, columns: number, inEffect = columns): Promise<Layout> {
  const sent = await page.evaluate((columns) => (globalThis as Global).__tallTablePin!(columns), columns);
  if (!sent) throw new Error(`the host's pin hook refused ${columns}`);
  return pinnedAs(page, inEffect);
}

/** With `density` and `?perf`: the table's `set_density` at a row height
 *  and a text size in px, through the host's hook, then the layout once a
 *  new one is reported with its row `inEffect` (by default the row
 *  height), so a call that changes only the text waits for its widths. A
 *  call that changes nothing reports no new layout, and times out. */
export async function densityThrough(page: Page, row: number, text: number, inEffect = row, timeout = 10_000): Promise<Layout> {
  const before = await page.evaluate(() => (globalThis as Global).__tallTableLayout);
  const sent = await page.evaluate(({ row, text }) => (globalThis as Global).__tallTableDensity!(row, text), { row, text });
  if (!sent) throw new Error(`the host's density hook refused ${row}, ${text}`);
  const handle = await page.waitForFunction(
    ({ row, before }) => {
      const layout = (globalThis as Global).__tallTableLayout;
      return layout && layout.rowHeight === row && JSON.stringify(layout) !== before && layout;
    },
    { row: inEffect, before: JSON.stringify(before ?? null) },
    { timeout, polling: 10 },
  );
  return (await handle.jsonValue()) as Layout;
}

/** Where the screen in `clip` (CSS px) has ink: each pixel compared with
 *  its row's leftmost pixel (so `clip` starts on a cell's bare padding,
 *  and a row's stripe, border, or tint is no ink), more than `within` off
 *  in a color channel. `x` and `y` say, for each device pixel column and
 *  row of the clip, whether it holds any; `scale` is device pixels a CSS
 *  px. Read in the page, so the pixels never cross to Node. */
export async function inkIn(page: Page, clip: { x: number; y: number; width: number; height: number }, within = 48): Promise<{ x: boolean[]; y: boolean[]; scale: number }> {
  const png = await screenshot(page, clip);
  return page.evaluate(
    async ({ png, within, width }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const x = new Array<boolean>(image.width).fill(false);
      const y = new Array<boolean>(image.height).fill(false);
      for (let row = 0; row < image.height; row++) {
        const base = row * image.width * 4;
        for (let column = 1; column < image.width; column++) {
          const at = base + column * 4;
          if (Math.abs(data[at]! - data[base]!) > within || Math.abs(data[at + 1]! - data[base + 1]!) > within || Math.abs(data[at + 2]! - data[base + 2]!) > within) {
            x[column] = true;
            y[row] = true;
          }
        }
      }
      return { x, y, scale: image.width / width };
    },
    { png, within, width: clip.width },
  );
}

/** The runs of `true` in `marks`, each `[from, to)`, divided by `scale`
 *  (device pixels to CSS px) and offset by `at`. */
export function runsOf(marks: boolean[], scale: number, at: number): [number, number][] {
  const runs: [number, number][] = [];
  let from = -1;
  marks.forEach((mark, index) => {
    if (mark && from < 0) from = index;
    if (!mark && from >= 0) (runs.push([at + from / scale, at + index / scale]), (from = -1));
  });
  if (from >= 0) runs.push([at + from / scale, at + marks.length / scale]);
  return runs;
}
