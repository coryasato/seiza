/**
 * The tall table's fixtures (`components/tall-table/fixtures/`; its README
 * says what each holds), run against the TanStack contender's data layer,
 * as the component's native tests run them against the table
 * (`src/state/fixtures.rs`, and the engine's `sql_fixture`). Paging
 * scenarios drive `TablePaging` on a script's clock, so the settle times
 * are its own timers; the source answers a read only when the scenario
 * says. Each fixture has negative controls, which must fail it.
 *
 * Run: `node --test` here (`just observatory tanstack-test`).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import type { Bridge } from '@seiza/duckdb/bridge';
import { exactText, shownText } from '../src/data/format.ts';
import { Advances, ColumnFormat, f32Text, type FormatControl, type NumberFormat, type NumberValue } from '../src/data/number.ts';
import { PAGING, TablePaging, type Clock, type Page, type PageSource, type Paging } from '../src/data/paging.ts';
import { ArrowPage, Queries, openParquet } from '../src/data/table.ts';
import { invalidateRows, setLiveControl, type LiveControl } from '../src/data/live.ts';
import { follow, isFollowing, letGo, setFollowControl, setRows, wheel, type FollowControl } from '../src/data/follow.ts';
import { asLevel } from './level.ts';
import type { Level } from '../../../../scenarios.ts';
import { pageSql } from '../src/data/sql.ts';
import { BASE_SIZES, clampWidth, layOut } from '../src/layout.ts';
import { resolveSizes } from '../src/density.ts';
import { dragWidth, pressBand } from '../src/resize.ts';
import { Pin } from '../src/pin.ts';
import { Selector, selectionJson, type SelectControl, type SheetView, type Step } from '../src/select.ts';

const fixtures = new URL('../../../../../../../components/tall-table/fixtures/', import.meta.url);
const fixture = (name: string): any => JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));

/** Lets every settled read's answer run, and the reads it starts. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Everything that can run at this instant runs: answers land, and timers
 *  already due fire (a 0 ms settle, as GPUI's test executor runs one once
 *  the step's work parks). */
async function settle(clock: ScriptClock): Promise<void> {
  await flush();
  clock.advance(0);
  await flush();
}

// --- paging ---

/** Timers that fire only when a step says time passes. */
class ScriptClock implements Clock {
  private now = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; run: () => void }>();

  setTimeout(run: () => void, ms: number): number {
    const handle = ++this.seq;
    this.timers.set(handle, { at: this.now + ms, run });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  /** Fires every timer due within `ms`, earliest first (the first set, at a tie). */
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      let next: [number, { at: number; run: () => void }] | undefined;
      for (const entry of this.timers) if (entry[1].at <= until && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.timers.delete(next[0]);
      this.now = next[1].at;
      next[1].run();
    }
    this.now = until;
  }
}

interface Read {
  page: number;
  request: number;
  cancelled: boolean;
  resolve: (page: Page) => void;
  reject: (error: Error) => void;
}

/** A source whose reads answer only when the scenario says, logging what
 *  the table asked for (`load <page>`, `cancel <page>`). */
class ScriptSource implements PageSource<Page> {
  log: string[] = [];
  open: Read[] = [];
  private next = 0;
  private readonly paging: Paging;
  /** The rows it holds: a `rows` step changes them. */
  rows: number;

  constructor(paging: Paging, rows: number) {
    this.paging = paging;
    this.rows = rows;
  }

  load([start, end]: readonly [number, number]) {
    const page = Math.floor(start / this.paging.pageRows);
    const first = page * this.paging.pageRows;
    assert.deepEqual([start, end], [first, Math.min(first + this.paging.pageRows, this.rows)], `page ${page}'s rows`);
    const request = this.next++;
    this.log.push(`load ${page}`);
    const result = new Promise<Page>((resolve, reject) => this.open.push({ page, request, cancelled: false, resolve, reject }));
    return { request, result };
  }

  cancel(request: number): void {
    const read = this.open.find((open) => open.request === request);
    assert.ok(read, 'a cancel names an open read');
    read.cancelled = true;
    this.log.push(`cancel ${read.page}`);
  }

  /** Answers the oldest open read (of `page`, if given): a cancelled read
   *  as cancelled, the rest with a page or a failure. Whether there was one. */
  answer(page: number | null, fail: boolean, bytes: number): boolean {
    const index = this.open.findIndex((read) => page === null || read.page === page);
    if (index < 0) return false;
    const [read] = this.open.splice(index, 1);
    if (read!.cancelled) read!.reject(new DOMException('Query cancelled', 'AbortError'));
    else if (fail) read!.reject(new Error('the fixture failed it'));
    else read!.resolve({ byteLength: bytes });
    return true;
  }
}

/** `paging.json`'s field names, as `Paging`'s. */
const FIELDS: Record<string, keyof Paging> = {
  page_rows: 'pageRows',
  prefetch: 'prefetch',
  budget_bytes: 'budgetBytes',
  max_in_flight: 'maxInFlight',
  scroll_settle_ms: 'scrollSettleMs',
  drag_settle_ms: 'dragSettleMs',
};

/** `paging` with a fixture's or a control's fields over it. A key it
 *  doesn't know is an error: a misspelt control would change nothing. */
function pagingWith(paging: Paging, fields: Record<string, number>): Paging {
  const changed = { ...paging };
  for (const [key, value] of Object.entries(fields)) {
    const field = FIELDS[key];
    assert.ok(field, `unknown paging field ${key}`);
    changed[field] = value;
  }
  return changed;
}

/** Cancels from one decision are a set: each run of them in page order,
 *  as the fixture writes it (and as the native test sorts them). */
function normalized(log: string[]): string[] {
  const page = (event: string) => Number(event.slice(7));
  let start = 0;
  while (start < log.length) {
    let end = start;
    while (end < log.length && log[end]!.startsWith('cancel ')) end++;
    log.splice(start, end - start, ...log.slice(start, end).sort((a, b) => page(a) - page(b)));
    start = end + 1;
  }
  return log;
}

/** A scenario's controls: the cache's (`live`'s, a shrink's) and following's. */
interface Controls {
  cache?: LiveControl;
  follow?: FollowControl;
}

/** One scenario under `paging`: the first step whose requests weren't the
 *  expected ones (or with `follow`, whose flag or bottom wasn't), or null. */
async function runScenario(paging: Paging, scenario: any, controls: Controls = {}): Promise<string | null> {
  const source = new ScriptSource(paging, scenario.rows);
  const clock = new ScriptClock();
  let table: TablePaging<Page> | null = null;
  const on = () => {
    assert.ok(table, 'the table is open');
    return table;
  };
  for (const [index, step] of (scenario.steps as any[]).entries()) {
    const action = Object.keys(step).find((key) => key !== 'expect' && key !== 'why')!;
    const argument = step[action];
    switch (action) {
      case 'open':
        table = new TablePaging(scenario.rows, source, paging, clock);
        if (controls.cache) setLiveControl(table, controls.cache);
        if (controls.follow) setFollowControl(table, controls.follow);
        table.setViewportRows(scenario.viewport_rows);
        break;
      case 'scroll':
        on().scrollBy(argument);
        break;
      case 'jump':
        on().jumpTo(argument);
        break;
      case 'fraction':
        on().scrollToFraction(argument);
        break;
      // The thumb dragged (or a track pressed) to the fraction.
      case 'drag':
        on().startDrag();
        on().scrollToFraction(argument);
        break;
      case 'release':
        on().endDrag();
        break;
      case 'wait':
        clock.advance(argument);
        break;
      // `live`: rows changed in the source.
      case 'invalidate':
        invalidateRows(on(), argument);
        break;
      // The source holds that many rows now (live tail's level).
      case 'rows':
        source.rows = argument;
        setRows(on(), argument);
        break;
      // `follow`: the view follows the end.
      case 'follow':
        follow(on());
        break;
      // `follow`: the host lets go, the view where it is.
      case 'let_go':
        letGo(on());
        break;
      // Sideways, as Shift+wheel (the table's `scroll_by(0, x)`): the
      // fixture's one column fits, so nothing moves, and following stays.
      case 'scroll_x':
        wheel(on(), 0, argument, 30);
        break;
      case 'answer':
      case 'fail': {
        const fail = action === 'fail';
        if (Array.isArray(argument)) {
          for (const page of argument as number[]) {
            if (!source.answer(page, fail, scenario.page_bytes)) return `${scenario.name}, step ${index}: no read of page ${page} is open`;
            await settle(clock);
          }
        } else {
          while (source.answer(null, fail, scenario.page_bytes)) await settle(clock);
        }
        break;
      }
      default:
        throw new Error(`${scenario.name}: unknown step ${action}`);
    }
    await settle(clock);
    const actual = normalized(source.log.splice(0));
    const at = `${scenario.name}, step ${index} (${action} ${JSON.stringify(argument)})`;
    if (JSON.stringify(actual) !== JSON.stringify(step.expect)) {
      return `${at}: expected ${JSON.stringify(step.expect)}, got ${JSON.stringify(actual)}`;
    }
    if ('following' in step && isFollowing(on()) !== step.following) return `${at}: following ${isFollowing(on())}, expected ${step.following}`;
    if ('bottom' in step && on().visible()[1] !== step.bottom) return `${at}: bottom ${on().visible()[1]}, expected ${step.bottom}`;
  }
  return null;
}

describe('paging.json', () => {
  const paging = fixture('paging.json');
  /** The table's features each level builds into the paging: the market
   *  level's `live` (`live.ts`), live tail's `live` and `follow`
   *  (`follow.ts`); every other level's none. */
  const FEATURES: Partial<Record<Level, string[]>> = { market: ['live'], tail: ['live', 'follow'] };
  // A scenario runs at a level that builds its features and none it's
  // skipped under (`without`), unless it has a step the level doesn't
  // build: the rows grow and shrink only on live tail's (`rows`), which
  // follows (`follow`, `let_go`, `scroll_x`); every other level's row count is fixed.
  const STEPS = ['open', 'scroll', 'jump', 'fraction', 'drag', 'release', 'wait', 'answer', 'fail', 'invalidate'];
  const steps: Partial<Record<Level, Set<string>>> = { tail: new Set([...STEPS, 'rows', 'follow', 'let_go', 'scroll_x']) };
  const CHECKS = new Set(['expect', 'why', 'following', 'bottom']);
  const scenariosAt = (level: Level): any[] => {
    const built = FEATURES[level] ?? [];
    const runs = steps[level] ?? new Set(STEPS);
    return (paging.scenarios as any[]).filter(
      (scenario) =>
        (scenario.features ?? []).every((feature: string) => built.includes(feature)) &&
        !(scenario.without ?? []).some((feature: string) => built.includes(feature)) &&
        (scenario.steps as any[]).every((step) => Object.keys(step).every((key) => CHECKS.has(key) || runs.has(key))),
    );
  };
  const controls = (paging.controls as any[]).filter((control) => control.paging);

  test('its paging is the contender’s, every field', () => {
    assert.deepEqual(Object.keys(paging.paging).sort(), Object.keys(FIELDS).sort());
    assert.deepEqual(pagingWith(PAGING, paging.paging), PAGING);
  });

  for (const level of ['base', 'market', 'tail'] satisfies Level[]) {
    test(`every scenario, on the ${level} level`, () =>
      asLevel(level, async () => {
        const failures: string[] = [];
        for (const scenario of scenariosAt(level)) {
          const failure = await runScenario(PAGING, scenario);
          if (failure) failures.push(failure);
        }
        assert.deepEqual(failures, []);
      }));

    test(`every control fails a scenario, on the ${level} level`, () =>
      asLevel(level, async () => {
        for (const control of controls) {
          const changed = pagingWith(PAGING, control.paging);
          assert.notDeepEqual(changed, PAGING, `control ${control.name} changes the paging`);
          let failed = 0;
          for (const scenario of scenariosAt(level)) if (await runScenario(changed, scenario)) failed++;
          assert.ok(failed > 0, `control ${control.name} passed every scenario`);
        }
      }));
  }

  test('the market level runs every live scenario but those that grow or shrink the rows', () => {
    const live = (paging.scenarios as any[]).filter((scenario) => scenario.features?.includes('live'));
    const run = new Set(scenariosAt('market'));
    const skipped = live.filter((scenario) => !run.has(scenario)).map((scenario) => scenario.name);
    assert.ok(live.filter((scenario) => run.has(scenario)).length >= 7, 'the live scenarios run');
    for (const name of skipped) assert.ok(live.find((scenario) => scenario.name === name).steps.some((step: object) => 'rows' in step), `${name} is skipped without a rows step`);
  });

  test('the tail level runs every scenario but sort’s and those skipped under live', () => {
    const all = paging.scenarios as any[];
    const expected = all.filter((scenario) => !scenario.features?.includes('sort') && !scenario.without?.includes('live'));
    assert.deepEqual(
      scenariosAt('tail').map((scenario) => scenario.name),
      expected.map((scenario) => scenario.name),
    );
    // Among them, follow's, and those that grow or shrink the rows.
    assert.ok(expected.some((scenario) => scenario.features?.includes('follow')), 'a follow scenario runs');
    assert.ok(expected.some((scenario) => scenario.steps.some((step: object) => 'rows' in step)), 'a rows scenario runs');
  });

  // `live`'s controls: each a way to re-read wrongly. `drop-grown` drops a
  // short last page that grows, which needs `rows`: live tail's alone.
  const liveControls = (level: Level): LiveControl[] => (level === 'tail' ? ['reread-unwanted', 'restart-stale', 'drop-grown'] : ['reread-unwanted', 'restart-stale']);
  for (const level of ['market', 'tail'] satisfies Level[]) {
    test(`every live control fails a scenario, on the ${level} level`, () =>
      asLevel(level, async () => {
        const live = (paging.controls as any[]).filter((control) => control.live).map((control) => control.live as string);
        assert.deepEqual(live.sort(), ['drop-grown', 'reread-unwanted', 'restart-stale']);
        for (const control of liveControls(level)) {
          let failed = 0;
          for (const scenario of scenariosAt(level)) if (await runScenario(PAGING, scenario, { cache: control })) failed++;
          assert.ok(failed > 0, `control ${control} passed every scenario`);
        }
      }));
  }

  // A shrink's control (`cache`) and following's, each a way to get them
  // wrong: live tail's level, where the rows change and the view follows.
  test('the cache’s and following’s controls fail a scenario, on the tail level', () =>
    asLevel('tail', async () => {
      const cache = (paging.controls as any[]).filter((control) => control.cache).map((control) => control.cache as LiveControl);
      const following = (paging.controls as any[]).filter((control) => control.follow).map((control) => control.follow as FollowControl);
      assert.deepEqual(cache, ['keep-past-end']);
      assert.deepEqual([...following].sort(), ['follow-at-end', 'follow-ignores-reader', 'let-go-to-end', 'pin-to-rows', 'top-first']);
      const runs: Controls[] = [...cache.map((control) => ({ cache: control })), ...following.map((control) => ({ follow: control }))];
      for (const controls of runs) {
        let failed = 0;
        for (const scenario of scenariosAt('tail')) if (await runScenario(PAGING, scenario, controls)) failed++;
        assert.ok(failed > 0, `control ${JSON.stringify(controls)} passed every scenario`);
      }
    }));
});

// --- cells ---

/** A text value as the source hands it: the fixture's, unchanged. */
const asRead = (text: string): string => text;
/** The control's text: its UTF-8 read as Latin-1, as a source decoding the
 *  wrong charset would hand it. */
const asLatin1 = (text: string): string => Buffer.from(text, 'utf8').toString('latin1');

/** The fixture's cells whose text `shown` (the column, the value) or
 *  `exact` (the value) doesn't give, at each column's budget plus `skew`:
 *  the top section's (its `rounding` too), or a scenario's (`scenarios`).
 *  A text column's value is handed over as `text` makes it from the
 *  fixture's (the source's decoding), its exact text the value's own. */
function cellMismatches(skew: number, exact: (value: number) => string, scenario?: string, text: (value: string) => string = asRead): string[] {
  const top = fixture('cells.json');
  const cells = scenario ? top.scenarios[scenario] : top;
  assert.ok(cells, `cells.json has no scenario ${scenario}`);
  const budgets = new Map<string, { kind: 'float' | 'text'; budget: number }>();
  for (const column of cells.columns) {
    assert.ok(column.kind === 'float' || column.kind === 'text', "the fixture's columns are floats or text");
    budgets.set(column.name, { kind: column.kind, budget: Math.max(1, column.budget + skew) });
  }
  const mismatches: string[] = [];
  for (const cell of [...cells.cells, ...(cells.rounding ?? [])]) {
    const column = budgets.get(cell.column);
    assert.ok(column, "the cell's column is listed");
    const { kind, budget } = column;
    if (kind === 'text') {
      const value = cell.value === null ? null : text(cell.value);
      const exactText = value ?? 'NULL';
      const shown = shownText('text', value, budget);
      if (exactText !== cell.exact || shown !== cell.shown) mismatches.push(`${cell.column} ${JSON.stringify(cell.value)}: exact ${exactText}, shown ${shown}; the fixture's ${cell.exact} ${cell.shown}`);
      continue;
    }
    const value = cell.value === null ? null : Number(cell.value);
    const exactText = value === null ? 'NULL' : exact(value);
    const shown = shownText('float', value, budget);
    if (exactText !== cell.exact || shown !== cell.shown) {
      mismatches.push(`${cell.column} ${cell.value}: exact ${exactText}, shown ${shown}; the fixture's ${cell.exact} ${cell.shown}`);
    }
  }
  return mismatches;
}

/**
 * `cells.json`'s `format` cases the contender's format (`number.ts`) and
 * its fallback (`shownText` at the budget rule) don't give, under
 * `control`, as the native test reads them (`state/fixtures/format.rs`):
 * the room the content box less a pixel, the fallback's budget the cells'.
 */
function formatMismatches(control: FormatControl): string[] {
  const cells = fixture('cells.json');
  const section = cells.format;
  const advance = (ch: string): number => {
    const px = section.advances[ch];
    assert.equal(typeof px, 'number', `no advance for ${ch}`);
    return px;
  };
  const advances = new Advances(advance);
  const mismatches: string[] = [];
  for (const item of section.cases) {
    const spec = item.format;
    const format: NumberFormat = { decimals: spec.decimals, sign: spec.sign, grouping: spec.grouping, suffix: spec.suffix };
    const suffixPx = [...format.suffix].reduce((sum, ch) => Math.fround(sum + Math.fround(advance(ch))), 0);
    const width = Math.fround(item.width);
    const float = item.kind === 'float' || item.kind === 'float32';
    const value: NumberValue =
      item.value === null
        ? null
        : item.kind === 'float'
          ? { kind: 'float', value: rustFloat(item.value) }
          : item.kind === 'float32'
            ? { kind: 'float32', value: Math.fround(rustFloat(item.value)) }
            : { kind: 'text', value: item.value };
    const exact = value === null ? 'NULL' : value.kind === 'float' ? exactText(value.value) : value.kind === 'float32' ? f32Text(value.value) : value.value;
    // The page's decimals are asked only of a float column.
    const decimals = float ? item.decimals : null;
    const column = new ColumnFormat(format, float, suffixPx, control);
    const room = Math.fround(Math.fround(width - 16) - 1);
    const fitted = column.fit(advances, room, value, decimals);
    const budget = Math.max(1, Math.floor((width - 17) / cells.number_px));
    const shown = fitted ?? (value === null ? 'NULL' : value.kind === 'text' ? value.value : shownText('float', value.value, budget));
    const got = [exact, shown, fitted === null, fitted === null ? null : column.rounded(fitted, value)];
    const want = [item.exact, item.shown, item.fallback, item.rounded];
    if (JSON.stringify(got) !== JSON.stringify(want)) mismatches.push(`${item.why}: ${JSON.stringify(got)}; the fixture's ${JSON.stringify(want)}`);
  }
  return mismatches;
}

/** A float column at set width `set`, laid out: what it's drawn at, and its budget. */
const laidOutAt = (set: number): { width: number; budget: number } => layOut({ name: 'x', kind: 'float', width: set });

/** `cells.json`'s `resize` widths and cells that `layout` (a set width →
 *  its width and budget) doesn't give, each budget `skew` characters off. */
function resizeMismatches(skew: number, layout: (set: number) => { width: number; budget: number }): string[] {
  const section = fixture('cells.json').resize;
  const mismatches: string[] = [];
  for (const item of section.widths) {
    const { width, budget } = layout(item.set);
    if (width !== item.width || Math.max(1, budget + skew) !== item.budget) mismatches.push(`${item.why}: ${width} px, ${budget + skew} characters; the fixture's ${item.width}, ${item.budget}`);
  }
  for (const cell of section.cells) {
    const value = Number(cell.value);
    const budget = Math.max(1, layout(cell.set).budget + skew);
    const got = [exactText(value), shownText('float', value, budget)];
    if (got[0] !== cell.exact || got[1] !== cell.shown) mismatches.push(`${cell.why}: ${JSON.stringify(got)}; the fixture's ${cell.exact} ${cell.shown}`);
  }
  return mismatches;
}

/** A float as Rust's `parse` reads the fixture's text (`inf`, `NaN`). */
const rustFloat = (text: string): number => (text === 'inf' ? Infinity : text === '-inf' ? -Infinity : Number(text));

describe('cells.json', () => {
  test('every cell’s exact and shown text', () => {
    assert.deepEqual(cellMismatches(0, exactText), []);
  });

  test('controls fail', () => {
    // JS's own text (`8` for 8.0, `1e+21`) isn't the table's.
    assert.notDeepEqual(cellMismatches(0, String), [], "String's text passed the cell fixture");
    // A character more or less of room rounds differently.
    for (const skew of [-1, 1]) assert.notDeepEqual(cellMismatches(skew, exactText), [], `a budget ${skew} passed the cell fixture`);
  });

  // `number_px` and `resize` pin a resized column's budgets and text (the
  // wide level's, `resize.ts`): as the native test reads them
  // (`state/fixtures/resize.rs`).
  test('resize', () => {
    assert.equal(fixture('cells.json').number_px, BASE_SIZES.numberPx, "the fixture's number advance is the layout's");
    assert.deepEqual(resizeMismatches(0, laidOutAt), []);
    // The clamp a resize uses is the one `layOut` writes inline: at the
    // base's sizes, a scaled density's, and the `least-fixed` control's.
    const scaledSizes = resolveSizes({ rowHeight: 20, text: { px: 11 } });
    for (const sizes of [BASE_SIZES, scaledSizes, { ...scaledSizes, control: 'least-fixed' as const }]) {
      for (const set of [0, 10, 30, 31, 40, 60, 1200, 5000]) assert.equal(clampWidth(set, sizes), layOut({ name: 'x', kind: 'float', width: set }, sizes).width, `the clamp at ${set}, ${JSON.stringify(sizes)}`);
    }
    // A drag to each width (from a float column at its kind's 120 px) lands
    // where the layout draws that set width.
    const kind = layOut({ name: 'x', kind: 'float' });
    for (const { set } of fixture('cells.json').resize.widths) {
      if (set === kind.width) continue;
      const drag = pressBand(0, 0, kind, undefined, false, 0, 1000);
      assert.equal(dragWidth(drag, set - kind.width, BASE_SIZES), laidOutAt(set).width, `a drag to ${set}`);
    }
  });

  test('resize: controls fail', () => {
    for (const skew of [-1, 1]) assert.notDeepEqual(resizeMismatches(skew, laidOutAt), [], `a budget ${skew} passed the resize fixture`);
    // Widths laid out without the clamps: the set width as it is.
    const unclamped = (set: number) => ({ width: set, budget: Math.max(1, Math.floor((set - 17) / BASE_SIZES.numberPx)) });
    assert.notDeepEqual(resizeMismatches(0, unclamped), [], 'widths laid out without the clamps passed the resize fixture');
  });

  // `format` pins a formatted column's text (market watch's level, `number.ts`).
  test('format', () => {
    assert.deepEqual(formatMismatches(null), []);
  });

  test('format: controls fail', () => {
    for (const control of ['plus-on-zero', 'sign-from-text', 'ties-up', 'group-by-four', 'fit-by-count', 'page-ignored'] satisfies FormatControl[])
      assert.notDeepEqual(formatMismatches(control), [], `control ${control} passed the format fixture`);
  });

  // Each scenario's file at its stop: the same text at the same budgets
  // (the budgets themselves are the layout's, `view.test.ts`).
  for (const scenario of Object.keys(fixture('cells.json').scenarios ?? {})) {
    test(`the ${scenario} scenario's cells`, () => {
      assert.ok(fixture('cells.json').scenarios[scenario].cells.length > 0);
      assert.deepEqual(cellMismatches(0, exactText, scenario), []);
    });
    // A file of floats: no value in it is long enough for a budget a
    // character off to round it (the budgets are `view.test.ts`'s), but
    // whole numbers are there, which JS's own text writes without the `.0`.
    // A file of text: its characters past ASCII, which a source decoding
    // Latin-1 wouldn't hand over as they are.
    test(`the ${scenario} scenario's control fails`, () => {
      const text = fixture('cells.json').scenarios[scenario].columns.every((column: { kind: string }) => column.kind === 'text');
      if (text) assert.notDeepEqual(cellMismatches(0, exactText, scenario, asLatin1), [], `Latin-1 text passed ${scenario}'s cells`);
      else assert.notDeepEqual(cellMismatches(0, String, scenario), [], `String's text passed ${scenario}'s cells`);
    });
  }
});

// --- sql ---

/** A bridge that answers DuckDB's summary queries for a file of `rows`
 *  rows and logs what it was sent. */
function scriptBridge(sent: string[], rows = 1_567_523): Bridge {
  const describe = tableToIPC(tableFromArrays({ column_name: ['spkid'], column_type: ['BIGINT'] }), 'stream');
  const metadata = tableToIPC(tableFromArrays({ num_rows: BigInt64Array.from([BigInt(rows)]), num_row_groups: BigInt64Array.from([52n]) }), 'stream');
  return {
    registerFile: async (name) => ({ name, size: null, bytesRead: null }),
    query: async (sql) => {
      sent.push(sql);
      return sql.startsWith('DESCRIBE') ? describe : metadata;
    },
    cancel: () => {},
  };
}

/** The fixture's queries that `page` (a page's SQL) and the open don't
 *  send: the top section's, or a scenario's (`scenarios`; only the summary
 *  of one whose pages are its own `query`). */
async function sqlMismatches(page: (file: string, start: number, end: number) => string, scenario?: string, openFile?: string): Promise<string[]> {
  const sql = scenario ? fixture('sql.json').scenarios[scenario] : fixture('sql.json');
  assert.ok(sql, `sql.json has no scenario ${scenario}`);
  const mismatches: string[] = [];
  // A scenario whose pages are its own query (`query`, live tail's loop:
  // `tail.test.ts`) has only its open's summary checked here.
  for (const { rows, sql: expected } of sql.query ? [] : sql.pages) {
    const actual = page(sql.file, rows[0], rows[1]);
    if (actual !== expected) mismatches.push(`page ${rows}: ${actual}`);
  }
  // The rows the scripted summary answers (any count: the open reads it back).
  const rows = scenario ? 10_632 : 1_567_523;
  const sent: string[] = [];
  const bridge = scriptBridge(sent, rows);
  const name = openFile ?? sql.file;
  const opened = await openParquet(bridge, new Queries(bridge), Promise.resolve(), name, `/data/${name}`);
  assert.equal(opened.rows, rows);
  if (JSON.stringify(sent) !== JSON.stringify(sql.summary)) mismatches.push(`summary: ${JSON.stringify(sent)}`);
  return mismatches;
}

describe('sql.json', () => {
  test('the page and summary queries', async () => {
    assert.deepEqual(await sqlMismatches(pageSql), []);
  });

  test('controls fail', async () => {
    for (const control of fixture('sql.json').controls) {
      const page = (file: string, start: number, end: number) => (start === control.rows[0] && end === control.rows[1] ? control.sql : pageSql(file, start, end));
      assert.notDeepEqual(await sqlMismatches(page), [], `control ${control.name} passed the SQL fixture`);
    }
  });

  for (const scenario of Object.keys(fixture('sql.json').scenarios ?? {})) {
    test(`the ${scenario} scenario's page and summary queries`, async () => {
      assert.deepEqual(await sqlMismatches(pageSql, scenario), []);
    });
    if (fixture('sql.json').scenarios[scenario].query) {
      // Its pages are its own query's (`tail.test.ts`): only its summary is
      // checked here, and another file's summary must fail it.
      test(`the ${scenario} scenario's summary control fails`, async () => {
        assert.notDeepEqual(await sqlMismatches(pageSql, scenario, 'another.parquet'), [], `another file's summary passed ${scenario}'s`);
      });
      continue;
    }
    test(`the ${scenario} scenario's controls fail`, async () => {
      // Another file's name, and the controls' query shapes on this file's.
      assert.notDeepEqual(await sqlMismatches((_file, start, end) => pageSql('asteroids.parquet', start, end), scenario), [], `another file's SQL passed ${scenario}'s`);
      for (const control of fixture('sql.json').controls) {
        const shaped = (file: string, start: number, end: number) => control.sql.replaceAll(fixture('sql.json').file, file).replaceAll(String(control.rows[0]), String(start)).replaceAll(String(control.rows[1]), String(end));
        assert.notDeepEqual(await sqlMismatches(shaped, scenario), [], `control ${control.name} passed ${scenario}'s SQL`);
      }
    });
  }
});

// --- the cache's bytes ---

test('the cache counts each page’s Arrow IPC bytes', async () => {
  const pages = [10, 1024].map((rows) => tableToIPC(tableFromArrays({ x: Float64Array.from({ length: rows }, (_, i) => i / 3) }), 'stream'));
  for (const bytes of pages) assert.equal(new ArrowPage(bytes).byteLength, bytes.byteLength);
  // Two pages through the paging: its bytes are theirs, summed.
  let next = 0;
  const source: PageSource<ArrowPage> = {
    load: () => ({ request: next, result: Promise.resolve(new ArrowPage(pages[next++ % 2]!)) }),
    cancel: () => {},
  };
  const table = new TablePaging(2048, source, { ...PAGING, prefetch: 0 }, new ScriptClock());
  table.setViewportRows(1500);
  await flush();
  assert.equal(table.cacheBytes(), pages[0]!.byteLength + pages[1]!.byteLength);
});

test('an open without a row count fails, naming it', async () => {
  const describe = tableToIPC(tableFromArrays({ column_name: ['spkid'], column_type: ['BIGINT'] }), 'stream');
  const metadata = tableToIPC(tableFromArrays({ rows: BigInt64Array.from([1n]), num_row_groups: BigInt64Array.from([1n]) }), 'stream');
  const bridge: Bridge = {
    registerFile: async (name) => ({ name, size: null, bytesRead: null }),
    query: async (sql) => (sql.startsWith('DESCRIBE') ? describe : metadata),
    cancel: () => {},
  };
  await assert.rejects(openParquet(bridge, new Queries(bridge), Promise.resolve(), 'a.parquet', '/a.parquet'), /no count in num_rows/);
});

// --- selection ---

// `selection.json` pins what `select` selects and scrolls to (the wide
// level's, `select.ts`), as the native test drives the element
// (`state/fixtures/select.rs`): the fixture's targets as points in the
// table, the base's keys and wheel where the selection doesn't take them.

describe('selection.json', () => {
  const scenarios = fixture('selection.json').scenarios as { name: string }[];
  for (const scenario of scenarios) {
    test(scenario.name, () => {
      assert.deepEqual(selectionMismatches(null, scenario.name), []);
    });
  }

  test('controls fail', () => {
    for (const control of fixture('selection.json').controls as SelectControl[]) assert.notDeepEqual(selectionMismatches(control), [], `control ${control} passed the selection fixture`);
  });
});

// --- copy ---

// `copy.json` pins a copy's text and its limits: the wide level ports the
// copy against it.
test('copy.json', { skip: 'the contender has no copy' }, () => {});

// --- sort ---

// `sort.json` pins a sort's cycle and the order a source answers in, and
// `paging.json`'s sort scenario what a sort reads: the level is added only
// when both sides build sorting.
test('sort.json', { skip: 'the contender has no sort' }, () => {});

// --- selection.json's table ---

/** The fixture's row height and gutter: any will do (its targets are rows
 *  and columns), but not one a hit test could round onto another row. */
const SELECT_ROW = 30;
const SELECT_GUTTER = 50;

/** `selection.json`'s table under a `Selector`: the view's numbers, the
 *  base's keys and wheel where the selection doesn't take them. */
class FixtureSheet {
  rows: number;
  top = 0;
  scrollX = 0;
  readonly columns: { x: number; width: number }[];
  readonly cellsWidth: number;
  readonly viewRows: number;
  readonly selector: Selector;

  constructor(table: any, rows: number, selectable: string[], control: SelectControl) {
    this.rows = rows;
    this.columns = Array.from({ length: table.columns }, (_, index) => ({ x: index * table.column_width, width: table.column_width }));
    this.cellsWidth = table.cells_width;
    this.viewRows = table.viewport_rows;
    const kinds = { rows: selectable.includes('rows'), columns: selectable.includes('columns'), cells: selectable.includes('cells') };
    this.selector = new Selector({ view: () => this.view(), scrollTo: (top, scrollX) => ((this.top = top), (this.scrollX = scrollX)), changed: () => {} }, kinds, control);
  }

  view(): SheetView {
    const content = this.columns.reduce((sum, column) => sum + column.width, 0);
    return {
      rows: this.rows,
      columns: this.columns,
      pin: new Pin(this.columns, 0, this.cellsWidth),
      cellsWidth: this.cellsWidth,
      viewHeight: this.viewRows * SELECT_ROW,
      rowHeight: SELECT_ROW,
      top: this.top,
      scrollX: this.scrollX,
      maxScrollX: Math.max(0, content - this.cellsWidth),
    };
  }

  private maxTop(): number {
    return Math.max(0, this.rows - this.viewRows);
  }

  /** The base's vertical scroll, clamped. */
  scrollBy(rows: number): void {
    this.top = Math.min(Math.max(this.top + rows, 0), this.maxTop());
  }

  /** A target's point, from the cells' left and the rows' top. */
  at(target: any): [number, number] {
    const rowY = (row: number) => {
      assert.ok(row >= Math.floor(this.top) && row < this.top + this.viewRows, `row ${row} isn't in view`);
      return (row - this.top + 0.5) * SELECT_ROW;
    };
    const columnX = (column: number) => this.columns[column]!.x + this.columns[column]!.width / 2 - this.scrollX;
    if (target.cell) return [columnX(target.cell[1]), rowY(target.cell[0])];
    if (target.gutter !== undefined) return [-SELECT_GUTTER / 2, rowY(target.gutter)];
    if (target.header !== undefined) return [columnX(target.header), -SELECT_ROW / 2];
    if (target.corner) return [-SELECT_GUTTER / 2, -SELECT_ROW / 2];
    if (target.right !== undefined) return [this.cellsWidth + 4, rowY(target.right)];
    if (target.below !== undefined) return [columnX(target.below), this.viewRows * SELECT_ROW + 4];
    throw new Error(`an unknown target: ${JSON.stringify(target)}`);
  }

  /** Keys as GPUI writes them: the selection's, else the base's. */
  key(keys: string): void {
    const parts = keys.split('-');
    const key = parts.pop()!;
    const shift = parts.includes('shift');
    const cmd = parts.includes('cmd');
    if (key === 'a' && (cmd || parts.includes('ctrl'))) {
      this.selector.selectAll();
      return;
    }
    if (key === 'escape') {
      this.selector.escape();
      return;
    }
    const step: Step | null =
      cmd && key === 'up' ? 'first'
      : cmd && key === 'down' ? 'last'
      : ({ up: 'up', down: 'down', left: 'left', right: 'right', pageup: 'pageUp', pagedown: 'pageDown', home: 'first', end: 'last' } as Record<string, Step>)[key] ?? null;
    if (step && this.selector.key(step, shift)) return;
    // The base's.
    const page = Math.max(this.viewRows - 1, 1);
    if (step === 'up') this.scrollBy(-1);
    else if (step === 'down') this.scrollBy(1);
    else if (step === 'pageUp' || (key === 'space' && shift)) this.scrollBy(-page);
    else if (step === 'pageDown' || key === 'space') this.scrollBy(page);
    else if (step === 'first') this.top = 0;
    else if (step === 'last') this.top = this.maxTop();
    else throw new Error(`no base key ${keys} in the fixture`);
  }
}

/** `selection.json`'s steps whose outcome the `Selector` (under `control`)
 *  doesn't give; every scenario, or the one named. */
function selectionMismatches(control: SelectControl, only?: string): string[] {
  const table = fixture('selection.json');
  const mismatches: string[] = [];
  for (const scenario of table.scenarios) {
    if (only !== undefined && scenario.name !== only) continue;
    const sheet = new FixtureSheet(table, scenario.rows ?? table.rows, scenario.selectable, control);
    const { selector } = sheet;
    for (const [index, step] of (scenario.steps as any[]).entries()) {
      try {
        if (step.press) {
          const [x, y] = sheet.at(step.press);
          selector.press(x, y, { shift: step.press.shift, ctrl: step.press.ctrl });
        } else if (step.drag) {
          selector.dragTo(...sheet.at(step.drag));
        } else if (step.release) {
          selector.release();
        } else if (step.wheel) {
          const [x, y] = sheet.at(step.wheel.at);
          sheet.scrollBy(step.wheel.rows);
          selector.scrolled(x, y);
        } else if (step.key) {
          sheet.key(step.key);
        } else if (step.rows !== undefined) {
          sheet.rows = step.rows;
          sheet.scrollBy(0);
          selector.rowsChanged(step.rows);
        } else if (step.columns) {
          selector.columnsChanged();
        } else if (step.jump !== undefined) {
          sheet.top = Math.min(step.jump, Math.max(0, sheet.rows - sheet.viewRows));
          selector.jumped(step.jump);
        } else {
          throw new Error(`an unknown step: ${JSON.stringify(step)}`);
        }
      } catch (error) {
        mismatches.push(`${scenario.name}, step ${index}: ${(error as Error).message}`);
        break;
      }
      const got = { selection: selectionJson(selector.selection), top: sheet.top, scroll_x: sheet.scrollX };
      if (JSON.stringify(got) !== JSON.stringify(step.expect)) {
        mismatches.push(`${scenario.name}, step ${index} (${JSON.stringify(step).slice(0, 80)}): ${JSON.stringify(got)}; the fixture's ${JSON.stringify(step.expect)}`);
        break;
      }
    }
  }
  return mismatches;
}

// `pin.json`, `density.json`, and `paint.json`, the wide level's features:
// `wide.test.ts`.
