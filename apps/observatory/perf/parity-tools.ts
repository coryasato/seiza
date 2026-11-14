// The wide level's tools on the TanStack contender against the GPUI
// contender's (`tanstack-parity` runs it at the wide level; run alone, it
// serves both wide builds itself): the table's `resize` and `select`, each
// through real input, with `?measure` (the selection, the set widths, and
// the layout on `__contender`, `docs/contender-contract.md`, "State").
//
// - The bands: a day's (Jan 1) and a pinned column's (Place) hairline at
//   its column's right edge less a pixel, as the layout places it on both
//   sides; the column-resize cursor; a press there takes the band (the
//   band is what's under the pointer). Control: a band's place a column
//   off isn't found there.
// - The drag: live (the header cell's width follows the pointer before
//   the release; no widths published until it), clamped (far left: the
//   least width, GPUI's), back where it started (the set width it had), and
//   the sideways scroll held through a narrowing at the right end, a
//   trackpad's wheel meanwhile moving the rows, clamped at the release. A
//   pinned column narrowed: the scrolled columns fill the view it frees.
// - Two ↓ in one task from the last whole row: the view follows by two.
// - The fit (a double-click): Jan 1's and Station's widths within a pixel
//   of GPUI's, from the same view.
// - The selection: the same presses (a cell, Shift+press, a drag, a
//   header, the gutter, the corner) and keys (arrows, Shift+arrows, Page
//   Down, End, Cmd+↑, Escape, Cmd+A) on both sides give the same selection
//   and the same top row after each.
// - The tint's place: a block across the pinned edge, and one in the days,
//   drawn where GPUI draws it (the box of the pixels the selection changed
//   in the cells, within a pixel). Control: the box of a block a row off
//   differs.
// - The copy: Cmd+C on a block (the tint's last) puts the same text on
//   the clipboard on both sides, read by a real paste. Control: with
//   nothing selected, the key copies nothing (no copy mark).
//
// Usage (alone): node apps/observatory/perf/parity-tools.ts [--browsers chromium,firefox,webkit]
// Needs `just observatory data`; run `just observatory tanstack-build wide`
// and `gpui-build wide` first.

import { chromium, type Browser, type Page } from '@playwright/test';
import { option } from '../../../shared-web/perf/protocol.ts';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import { WIDE_SHEET } from '../contenders/scenarios.ts';
import { COPY_MARKS } from '../contenders/tools.ts';
import { copyMarks, paste } from './wide-tools.ts';
import { BROWSER_TYPES, KNOWN_WARNINGS, MARKS, frames, near, problems, protocolContext, serveGpui, serveTanstack } from './harness.ts';

interface Layout {
  left: number;
  top: number;
  rowHeight: number;
  cellsWidth: number;
  pinned: number;
  columns: { name: string; x: number; width: number }[];
}
interface Selection {
  kind: string;
  anchor: [number, number];
  head: [number, number];
}
interface Contender {
  layout?: Layout;
  widths?: (number | null)[];
  selection?: Selection | null;
  state?: { first: number; top: number; rows: number } | null;
}
type Global = { __contender?: Contender };


const QUERY = `?measure&scenario=${WIDE_SHEET.id}&stop=${WIDE_SHEET.defaultStop}`;
const JAN1 = WIDE_SHEET.heatFrom;
const PLACE = WIDE_SHEET.pinned - 1;
const read = <K extends keyof Contender>(page: Page, key: K) => page.evaluate((key) => (globalThis as Global).__contender?.[key] ?? null, key) as Promise<Contender[K] | null>;

/** The layout, once published (`?measure`). */
const layoutOf = async (page: Page): Promise<Layout> =>
  (await (await page.waitForFunction(() => (globalThis as Global).__contender?.layout ?? false, null, { timeout: 10_000 })).jsonValue()) as Layout;

/** A column's right edge on screen, at no sideways scroll. */
const edgeX = (layout: Layout, column: number) => layout.left + layout.columns[column]!.x + layout.columns[column]!.width;
const headerY = (layout: Layout) => layout.top - layout.rowHeight / 2;
const cellAt = (layout: Layout, row: number, column: number): [number, number] => [layout.left + layout.columns[column]!.x + layout.columns[column]!.width / 2, layout.top + (row + 0.5) * layout.rowHeight];
/** Off the table, inside the page: no hover, no tooltip. */
const away = (page: Page) => page.mouse.move(6, 450);

async function open(page: Page, url: string): Promise<Layout> {
  await page.goto(`${url}${QUERY}`);
  await waitMark(page, MARKS.filled, 0, 60_000);
  await frames(page, 4);
  return layoutOf(page);
}

/** A side's run of the same input: what it published after each step. */
interface Run {
  layout: Layout;
  /** Jan 1's and Station's widths after a fit from the opening view. */
  fits: number[];
  /** Jan 1's width after a drag far left, and back where it started. */
  clamped: number | null;
  back: number | null;
  /** After each selection step: its name, the selection, the top row. */
  steps: { name: string; selection: Selection | null; first: number | null }[];
  /** The rows the side's view holds: the rows less the top at End (each
   *  side's own screen: GPUI's horizontal scrollbar is its own, the DOM's
   *  may be an overlay). */
  viewRows: number;
  /** The tint's box in CSS px (the selection's changed pixels), per block. */
  tints: Record<string, number[] | null>;
  /** Cmd+C on the last block: the text a paste read. */
  copied: string;
  /** Cmd+C with nothing selected: the copy marks it set (none). */
  unselectedMarks: string[];
}

/** Drags from x to x + dx along the header, in steps, and lets go. */
async function drag(page: Page, x: number, y: number, dx: number, between?: () => Promise<void>): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await frames(page, 3);
  await between?.();
  await page.mouse.up();
  await frames(page, 3);
}

/** The box (CSS px, `[left, top, right, bottom]`) of the pixels that differ
 *  between two screenshots of the clip, or null if none does. */
async function changedBox(page: Page, before: Buffer, after: Buffer, clip: { x: number; y: number }, dpr: number): Promise<number[] | null> {
  const box = await page.evaluate(
    async ({ a, b }) => {
      const load = async (base64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
      };
      const [pa, pb] = await Promise.all([load(a), load(b)]);
      let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let y = 0; y < pa.height; y++) {
        for (let x = 0; x < pa.width; x++) {
          const i = (y * pa.width + x) * 4;
          if (Math.max(Math.abs(pa.data[i]! - pb.data[i]!), Math.abs(pa.data[i + 1]! - pb.data[i + 1]!), Math.abs(pa.data[i + 2]! - pb.data[i + 2]!)) <= 3) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
      }
      return Number.isFinite(left) ? [left, top, right, bottom] : null;
    },
    { a: before.toString('base64'), b: after.toString('base64') },
  );
  return box ? box.map((value, index) => value / dpr + (index % 2 === 0 ? clip.x : clip.y)) : null;
}

/** The selection's steps, the same on both sides. */
function selectionSteps(layout: Layout): { name: string; run: (page: Page) => Promise<void> }[] {
  const click = (point: [number, number], shift = false) => async (page: Page) => {
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(...point);
    if (shift) await page.keyboard.up('Shift');
  };
  const key = (keys: string) => async (page: Page) => page.keyboard.press(keys);
  const header = (column: number): [number, number] => [cellAt(layout, 0, column)[0], headerY(layout)];
  const gutter = (row: number): [number, number] => [layout.left - 12, cellAt(layout, row, 0)[1]];
  return [
    { name: 'a cell', run: click(cellAt(layout, 2, JAN1)) },
    { name: 'Shift+press', run: click(cellAt(layout, 6, JAN1 + 2), true) },
    {
      name: 'a drag',
      run: async (page) => {
        await page.mouse.move(...cellAt(layout, 1, JAN1 + 1));
        await page.mouse.down();
        await page.mouse.move(...cellAt(layout, 4, JAN1 + 4), { steps: 10 });
        await frames(page, 3);
        await page.mouse.up();
      },
    },
    { name: 'a header', run: click(header(JAN1 + 1)) },
    { name: 'Shift+press a header', run: click(header(JAN1 + 3), true) },
    { name: 'the gutter', run: click(gutter(3)) },
    { name: 'Shift+press a cell, rows', run: click(cellAt(layout, 8, 0), true) },
    { name: '↓', run: key('ArrowDown') },
    { name: '→', run: key('ArrowRight') },
    { name: 'Shift+→ twice', run: async (page) => { await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); } },
    { name: 'Page Down', run: key('PageDown') },
    { name: 'Shift+↑', run: key('Shift+ArrowUp') },
    { name: 'End', run: key('End') },
    { name: 'Cmd+↑', run: key('ControlOrMeta+ArrowUp') },
    { name: 'Escape', run: key('Escape') },
    { name: 'Escape again', run: key('Escape') },
    { name: 'the corner', run: click([layout.left - 12, headerY(layout)]) },
    { name: 'a cell again', run: click(cellAt(layout, 0, PLACE)) },
    { name: 'Cmd+A', run: key('ControlOrMeta+KeyA') },
    { name: 'Escape last', run: key('Escape') },
  ];
}

/** The input on one side, recording what it published. */
async function runSide(page: Page, url: string, side: string, fail: (what: string) => void): Promise<Run> {
  let layout = await open(page, url);
  const y = headerY(layout);
  const run: Run = { layout, fits: [], clamped: null, back: null, steps: [], tints: {}, viewRows: NaN, copied: '', unselectedMarks: [] };
  const dpr = await page.evaluate(() => devicePixelRatio);

  // The fits, from the opening view.
  for (const column of [JAN1, 0]) {
    await page.mouse.dblclick(edgeX(layout, column) - 1, y);
    const width = await page
      .waitForFunction((column) => (globalThis as Global).__contender?.widths?.[column] ?? false, column, { timeout: 5_000 })
      .then((handle) => handle.jsonValue() as Promise<number>)
      .catch(() => null);
    if (width === null) fail(`${side} fit: column ${column} published no width`);
    run.fits.push(width ?? NaN);
    await frames(page, 3);
  }
  layout = await layoutOf(page);
  // Clamped: Jan 1 dragged far left; then a drag that ends where it started.
  const x = edgeX(layout, JAN1) - 1;
  await drag(page, x, y, -400);
  run.clamped = (await read(page, 'widths'))?.[JAN1] ?? null;
  layout = await layoutOf(page);
  const x2 = edgeX(layout, JAN1) - 1;
  await page.mouse.move(x2, y);
  await page.mouse.down();
  await page.mouse.move(x2 + 50, y, { steps: 4 });
  await page.mouse.move(x2, y, { steps: 4 });
  await frames(page, 3);
  await page.mouse.up();
  await frames(page, 3);
  run.back = (await read(page, 'widths'))?.[JAN1] ?? null;

  // Reopen for the selection, so both sides start from the same view.
  layout = await open(page, url);
  for (const step of selectionSteps(layout)) {
    await step.run(page);
    await frames(page, 4);
    await page.waitForTimeout(60);
    const state = await read(page, 'state');
    run.steps.push({ name: step.name, selection: (await read(page, 'selection')) ?? null, first: state?.first ?? null });
    if (step.name === 'End' && state) run.viewRows = state.rows - state.top / layout.rowHeight;
  }

  // The tint's place: from Home, nothing selected, the pointer away.
  await page.keyboard.press('Home');
  await frames(page, 6);
  const clip = { x: layout.left, y: layout.top, width: Math.min(layout.cellsWidth, 900), height: layout.rowHeight * 12 };
  const blocks: Record<string, [[number, number], [number, number]]> = {
    'across the pinned edge': [[3, PLACE], [9, JAN1 + 1]],
    'in the days': [[2, JAN1 + 2], [5, JAN1 + 4]],
    'a row off (control)': [[4, JAN1 + 2], [6, JAN1 + 4]],
  };
  for (const [name, [from, to]] of Object.entries(blocks)) {
    await page.keyboard.press('Escape');
    await away(page);
    await frames(page, 4);
    await page.waitForTimeout(100);
    const before = await page.screenshot({ clip });
    await page.mouse.click(...cellAt(layout, ...from));
    await page.keyboard.down('Shift');
    await page.mouse.click(...cellAt(layout, ...to));
    await page.keyboard.up('Shift');
    await away(page);
    await frames(page, 4);
    await page.waitForTimeout(100);
    const after = await page.screenshot({ clip });
    run.tints[name] = await changedBox(page, before, after, clip, dpr);
  }

  // The copy: Cmd+C on the block selected last, read by a real paste; then
  // with nothing selected, Cmd+C copies nothing.
  const since = await page.evaluate(() => performance.now());
  await page.keyboard.press('ControlOrMeta+KeyC');
  const written = await waitMark(page, COPY_MARKS.written, since, 30_000).then(() => true, () => false);
  if (!written) fail(`${side} copy: Cmd+C on a block wrote nothing (${JSON.stringify(await page.evaluate(() => (globalThis as { __contender?: { copy?: unknown } }).__contender?.copy))})`);
  run.copied = await paste(page);
  await page.mouse.click(...cellAt(layout, 1, JAN1));
  await page.keyboard.press('Escape');
  await frames(page, 2);
  const bare = await page.evaluate(() => performance.now());
  await page.keyboard.press('ControlOrMeta+KeyC');
  await page.waitForTimeout(500);
  run.unselectedMarks = await copyMarks(page, bare);
  return run;
}

/** The bands, the live drag, and the held sideways scroll: the TanStack
 *  side's own DOM, against its layout (which `compare` checks is GPUI's). */
async function checkBands(page: Page, url: string, name: string, fail: (what: string) => void): Promise<Record<string, unknown>> {
  const layout = await open(page, url);
  const y = headerY(layout);
  const found: Record<string, unknown> = {};
  for (const column of [JAN1, PLACE]) {
    const hairline = edgeX(layout, column) - 1;
    const at = await page.evaluate(
      ({ x, y, column }) => {
        const hit = document.elementFromPoint(x + 0.5, y)?.closest<HTMLElement>('.band');
        const line = document.querySelector(`.band[data-band="${column}"] > .hairline`)?.getBoundingClientRect();
        // Control: a column off isn't this band.
        const off = document.elementFromPoint(x + 0.5 - 40, y)?.closest<HTMLElement>('.band');
        return { hit: hit ? Number(hit.dataset.band) : null, cursor: hit ? getComputedStyle(hit).cursor : null, line: line ? line.left : null, off: off ? Number(off.dataset.band) : null };
      },
      { x: hairline, y, column },
    );
    if (at.hit !== column) fail(`${name} band ${column}: the press at its edge finds band ${at.hit}`);
    if (at.cursor !== 'col-resize') fail(`${name} band ${column}: cursor ${at.cursor}`);
    if (at.line === null || !near(at.line, hairline, 0.5)) fail(`${name} band ${column}: the hairline at ${at.line}, its edge less a pixel at ${hairline}`);
    if (at.off === column) fail(`${name} band ${column} control: found 40 px left of its edge`);
    found[`band${column}`] = at;
  }

  // Live: the header cell follows the pointer before the release; nothing published until it.
  const before = layout.columns[JAN1]!.width;
  const mid: { live: { width: number; published: unknown } | null } = { live: null };
  await drag(page, edgeX(layout, JAN1) - 1, y, 50, async () => {
    mid.live = await page.evaluate((column) => {
      const cell = [...document.querySelectorAll<HTMLElement>('.head > .cell')].find((cell) => cell.textContent === 'Jan 1')!;
      return { width: cell.getBoundingClientRect().width, published: (globalThis as Global).__contender?.widths?.[column] ?? null };
    }, JAN1);
  });
  const { live } = mid;
  if (!live || !near(live.width, before + 50, 0.5)) fail(`${name} drag: Jan 1 ${live?.width} px mid-drag, not ${before} + 50`);
  if (live && live.published !== null) fail(`${name} drag: widths published mid-drag (${live.published})`);
  const released = (await read(page, 'widths'))?.[JAN1];
  if (released !== before + 50) fail(`${name} drag: Jan 1 published ${released} at the release, not ${before + 50}`);
  found.live = { before, mid: live, released };

  // The sideways scroll held: at the right end, the last day narrowed.
  const end = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.scroller')!;
    scroller.scrollLeft = scroller.scrollWidth;
    return scroller.scrollLeft;
  });
  await frames(page, 4);
  const lastBand = await page.evaluate(() => {
    const bands = [...document.querySelectorAll<HTMLElement>('.head > .band')];
    const band = bands.at(-1)!;
    const box = band.getBoundingClientRect();
    return { column: Number(band.dataset.band), x: box.left + box.width / 2 };
  });
  let held = NaN;
  let moved = { from: NaN, to: NaN };
  const topRow = () => page.evaluate(() => (globalThis as Global).__contender?.state?.top);
  await drag(page, lastBand.x, y, -40, async () => {
    // A trackpad's wheel meanwhile, in the body, a little sideways in it:
    // the rows move, the sideways scroll doesn't.
    await page.mouse.move(lastBand.x - 40, layout.top + 200);
    const from = (await topRow()) ?? NaN;
    await page.mouse.wheel(3, 120);
    await frames(page, 6);
    moved = { from, to: (await topRow()) ?? NaN };
    held = await page.evaluate(() => document.querySelector<HTMLElement>('.scroller')!.scrollLeft);
    await page.mouse.move(lastBand.x - 40, y);
    await frames(page, 3);
  });
  const after = await page.evaluate(() => document.querySelector<HTMLElement>('.scroller')!.scrollLeft);
  if (held !== end) fail(`${name} held: the sideways scroll at ${held} mid-drag, not ${end}`);
  if (!(moved.to > moved.from)) fail(`${name} held: a trackpad's wheel mid-drag left the rows at ${moved.to} px (from ${moved.from})`);
  if (!(after < end)) fail(`${name} held: the sideways scroll at ${after} after the release, not clamped below ${end}`);
  found.held = { end, mid: held, after, column: lastBand.column, rows: moved };

  // A pinned column narrowed: the scrolled columns fill the view it frees
  // (the column virtualizer told the new view's width).
  const fresh = await open(page, url);
  await drag(page, edgeX(fresh, PLACE) - 1, headerY(fresh), -150);
  await frames(page, 4);
  const filled = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.scroller')!;
    const right = scroller.getBoundingClientRect().left + scroller.clientLeft + scroller.clientWidth;
    const cells = [...document.querySelectorAll<HTMLElement>('.head > .cell:not(.pin)')];
    return { right, reached: Math.max(...cells.map((cell) => cell.getBoundingClientRect().right)) };
  });
  if (!(filled.reached >= filled.right - 0.5)) fail(`${name} narrowed pin: the scrolled names end at ${filled.reached}, short of the view's right ${filled.right}`);
  found.narrowedPin = filled;

  // Two ↓ in one task from the last whole row: the view follows by two
  // rows, the active cell flush with its bottom.
  await page.mouse.click(...cellAt(fresh, 0, JAN1));
  const viewRows = await page.evaluate((rowHeight) => (document.querySelector<HTMLElement>('.scroller')!.clientHeight - rowHeight) / rowHeight, fresh.rowHeight);
  const bottom = Math.floor(viewRows) - 1;
  await page.mouse.click(...cellAt(fresh, bottom, JAN1));
  await frames(page, 3);
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.scroller')!;
    for (let k = 0; k < 2; k++) scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  });
  await frames(page, 6);
  await page.waitForTimeout(100);
  const keyed = { anchor: (await read(page, 'selection'))?.anchor[0], top: ((await read(page, 'state'))?.top ?? NaN) / fresh.rowHeight };
  const want = bottom + 3 - viewRows;
  if (keyed.anchor !== bottom + 2 || !near(keyed.top, want, 0.05)) fail(`${name} two keys in a task: the active row ${keyed.anchor}, the top ${keyed.top}; not ${bottom + 2} flush at the bottom (top ${want})`);
  found.twoKeys = { ...keyed, want };
  return found;
}

/** The TanStack side's runs against the GPUI side's. */
function compare(name: string, gpui: Run, tanstack: Run, fail: (what: string) => void): void {
  const a = gpui.layout;
  const b = tanstack.layout;
  if (!near(a.left, b.left, 0.5) || !near(a.top, b.top, 0.5) || a.pinned !== b.pinned) fail(`${name} layout: left ${b.left}, top ${b.top}, pinned ${b.pinned}; GPUI's ${a.left}, ${a.top}, ${a.pinned}`);
  for (const [index, column] of a.columns.entries()) {
    const other = b.columns[index];
    if (!other || !near(other.x, column.x, 0.01) || !near(other.width, column.width, 0.01)) {
      fail(`${name} layout: ${column.name} at ${other?.x}, ${other?.width} px; GPUI's ${column.x}, ${column.width}`);
      break;
    }
  }
  for (const [index, width] of gpui.fits.entries()) if (!near(tanstack.fits[index]!, width, 1)) fail(`${name} fit ${index}: ${tanstack.fits[index]} px; GPUI's ${width}`);
  if (tanstack.clamped !== gpui.clamped) fail(`${name} clamp: Jan 1 at ${tanstack.clamped} px; GPUI's ${gpui.clamped}`);
  if (tanstack.back !== gpui.back) fail(`${name} back at the press: Jan 1 at ${tanstack.back}; GPUI's ${gpui.back}`);
  // A page key moves by each side's own page (the rows its view holds less
  // one): GPUI's steps, its page swapped for this side's.
  const page = (viewRows: number) => Math.max(Math.floor(viewRows - 1), 1);
  const shift = page(tanstack.viewRows) - page(gpui.viewRows);
  if (!(Math.abs(shift) <= 1)) fail(`${name} page: ${page(tanstack.viewRows)} rows; GPUI's ${page(gpui.viewRows)}`);
  const paged = (selection: Selection | null): Selection | null =>
    selection && { ...selection, anchor: [selection.anchor[0] + shift, selection.anchor[1]], head: [selection.head[0] + shift, selection.head[1]] };
  for (const [index, step] of gpui.steps.entries()) {
    const other = tanstack.steps[index]!;
    const byPage = step.name === 'Page Down' || step.name === 'Shift+↑';
    const want = byPage ? paged(step.selection) : step.selection;
    // The top row: a page down from the top is the page's rows; End's, the side's own end.
    const first = byPage ? Math.floor(Math.max(tanstack.viewRows - 1, 1)) : step.name === 'End' ? other.first : step.first;
    if (JSON.stringify(other.selection) !== JSON.stringify(want) || other.first !== first) {
      fail(`${name} ${step.name}: ${JSON.stringify(other.selection)}, top row ${other.first}; GPUI's ${JSON.stringify(want)}, ${first}${byPage ? ` (its page ${shift} rows off)` : ''}`);
    }
  }
  for (const block of ['across the pinned edge', 'in the days']) {
    const want = gpui.tints[block];
    const got = tanstack.tints[block];
    if (!want || !got || got.some((value, index) => !near(value, want[index]!, 1))) fail(`${name} tint ${block}: ${JSON.stringify(got)}; GPUI's ${JSON.stringify(want)}`);
  }
  if (!gpui.copied || tanstack.copied !== gpui.copied) fail(`${name} copy: pasted ${JSON.stringify(tanstack.copied.slice(0, 80))}; GPUI's ${JSON.stringify(gpui.copied.slice(0, 80))}`);
  for (const [side, run] of [['GPUI', gpui], [name, tanstack]] as const) if (run.unselectedMarks.length) fail(`${side} copy control: Cmd+C with nothing selected set ${run.unselectedMarks.join(', ')}`);
  const control = tanstack.tints['a row off (control)'];
  const days = gpui.tints['in the days'];
  if (control && days && control.every((value, index) => near(value, days[index]!, 1))) fail(`${name} tint control: a block a row off drew where the days' block does`);
}

/** The tools' parity in `browsers` (GPUI's runs once, in Chromium). */
export async function toolsParity(browsers: string[], tanstackUrl: string, gpuiUrl: string, fail: (what: string) => void): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  let gpui: Run;
  {
    const browser = await chromium.launch({ channel: 'chromium' });
    try {
      const context = await protocolContext(browser);
      // Headless Chromium refuses every async clipboard write without it.
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(gpuiUrl).origin });
      const page = await context.newPage();
      gpui = await runSide(page, gpuiUrl, 'gpui', fail);
      out.gpui = gpui;
    } finally {
      await browser.close();
    }
  }
  for (const name of browsers) {
    const browser: Browser = await BROWSER_TYPES[name]!.launch(name === 'chromium' ? { channel: 'chromium' } : {});
    try {
      const context = await protocolContext(browser);
      if (name === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(tanstackUrl).origin });
      const page = await context.newPage();
      const found = problems(page);
      const run = await runSide(page, tanstackUrl, name, fail);
      compare(`${name} tools`, gpui, run, fail);
      const bands = await checkBands(page, tanstackUrl, `${name} tools`, fail);
      for (const problem of found) if (!KNOWN_WARNINGS.some((warning) => warning.test(problem))) fail(`${name} tools: ${problem}`);
      out[name] = { run, bands };
      console.log(`${name} tools: held ${JSON.stringify(bands.held)}; a pinned column narrowed ${JSON.stringify(bands.narrowedPin)}; two keys ${JSON.stringify(bands.twoKeys)}`);
      console.log(`${name} tools: the view ${run.viewRows.toFixed(2)} rows (GPUI ${gpui.viewRows.toFixed(2)}); fits ${run.fits.join(', ')} px (GPUI ${gpui.fits.join(', ')}); clamped ${run.clamped}, back ${run.back}; ${run.steps.length} selection steps; tints ${JSON.stringify(run.tints['across the pinned edge'])} (GPUI ${JSON.stringify(gpui.tints['across the pinned edge'])}); Cmd+C pasted ${run.copied.length} characters, GPUI's: ${run.copied === gpui.copied}`);
    } finally {
      await browser.close();
    }
  }
  return out;
}

if (import.meta.main) {
  const browsers = (option('browsers') ?? 'chromium,firefox,webkit').split(',');
  const failures: string[] = [];
  const tanstack = await serveTanstack(4393, undefined, 'wide');
  const gpui = await serveGpui(4394, undefined, 'wide');
  try {
    await toolsParity(browsers, tanstack.url, gpui.url, (what) => failures.push(what));
  } finally {
    await tanstack.close();
    await gpui.close();
  }
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.log(failures.length ? `${failures.length} failures` : 'PASS');
  process.exit(failures.length ? 1 : 0);
}
