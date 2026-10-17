// Writes the tall table's cell fixture (components/tall-table/fixtures/
// cells.json) from the GPUI contender: the values come from the data file,
// and the budgets and the text from what the contender draws.
//
// 1. Native DuckDB (data/'s) picks rows from each float column of the data
//    file: its smallest and largest values, the longest texts, the smallest
//    magnitudes, a whole number, a NULL, and rows spread through the file.
// 2. The contender's release build, opened with `?measure&cells` (the table
//    probes its cells), jumps to each row and reads what it drew
//    (`__contender.cells`) and how it laid the columns out
//    (`__contender.columns`, the table's `ColumnProbe`s), on a page wide
//    enough to show every column. The budgets are read at DPR 2 and DPR 1
//    and must agree.
// 3. Each drawn value must be DuckDB's (its exact text parses to the same
//    double, or both are NULL), so the fixture pins the file's values.
//
// The component's native test (`cargo test -p seiza-tall-table`) checks
// the table still draws this text; the TanStack contender's tests check
// its own against it.
//
// Usage: node apps/observatory/perf/cell-fixture.ts [--check]
// --check: compare with the committed fixture instead of writing it. Needs
// `just observatory data`; run `just observatory gpui-build` first.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from '@playwright/test';
import { flag, hideDevicePixelContentBox } from '../../../shared-web/perf/protocol.ts';
import { waitMark } from '../../../shared-web/perf/harness.ts';
import { MARKS, dataFile, problems, serveGpui, nativeDuckDB } from './harness.ts';

const PORT = 4313;
const fixturePath = fileURLToPath(new URL('../../../components/tall-table/fixtures/cells.json', import.meta.url));
/** The fixture's synthetic values, which this script keeps as they are: no
 *  value in the data file is long enough for its column to round it, so
 *  these exercise the rounding at the same budgets (README.md). */
const rounding = existsSync(fixturePath) ? ((JSON.parse(readFileSync(fixturePath, 'utf8')) as { rounding?: unknown[] }).rounding ?? []) : [];
if (rounding.length === 0) throw new Error(`no rounding cases in ${fixturePath}: restore them before writing`);
const manifest = JSON.parse(readFileSync(new URL('../data/MANIFEST.json', import.meta.url), 'utf8')) as Record<string, { sha256: string }>;

// --- the rows, from native DuckDB ---

const conn = await nativeDuckDB();
const rowsOf = async (sql: string) => (await conn.runAndReadAll(sql)).getRows();
const file = `read_parquet('${dataFile.replaceAll("'", "''")}', file_row_number = true)`;

const count = Number((await rowsOf(`SELECT count(*) FROM ${file}`))[0]![0]);
const described = await rowsOf(`DESCRIBE SELECT * FROM read_parquet('${dataFile.replaceAll("'", "''")}')`);
// The fixture's values are f64 (`CellValue::Float`); a FLOAT column's
// exact text is an f32's, which this script and the native test don't read.
if (described.some((row) => row[1] === 'FLOAT')) throw new Error('the data file has a FLOAT column: the cell fixture holds DOUBLEs only');
const floats = described.filter((row) => row[1] === 'DOUBLE').map((row) => String(row[0]));
if (floats.length === 0) throw new Error('the data file has no float column');

/**
 * A double's exact text as the table writes it (Rust's `{:?}`): the
 * shortest round-trip digits, in scientific notation below 1e-4 or from
 * 1e16 up, plain otherwise, a whole number with `.0`. Only picks rows here;
 * each drawn cell's `exact` is checked against it.
 */
function tableText(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const [mantissa = '', exponent = '0'] = value.toExponential().split('e');
  const exp = Number(exponent);
  const sign = value < 0 ? '-' : '';
  const digits = mantissa.replace('-', '').replace('.', '');
  const abs = Math.abs(value);
  if (abs >= 1e16 || abs < 1e-4) return `${sign}${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ''}e${exp}`;
  if (exp < 0) return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
  const whole = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
  const fraction = digits.slice(exp + 1);
  return `${sign}${whole}.${fraction || '0'}`;
}

/** The row whose value in `column` has the longest table text, and its length. */
async function longestRow(column: string): Promise<[number, number]> {
  const c = `"${column.replaceAll('"', '""')}"`;
  let best: [number, number] = [-1, -1];
  for (const [row, value] of await rowsOf(`SELECT file_row_number, ${c} FROM ${file} WHERE ${c} IS NOT NULL`)) {
    const length = tableText(Number(value)).length;
    if (length > best[1]) best = [Number(row), length];
  }
  return best;
}

/** Rows (file_row_number) whose values in `column` test the formatting. */
async function rowsFor(column: string): Promise<number[]> {
  const c = `"${column.replaceAll('"', '""')}"`;
  const picks = [
    `SELECT file_row_number FROM ${file} WHERE ${c} IS NOT NULL ORDER BY ${c}, file_row_number LIMIT 2`,
    `SELECT file_row_number FROM ${file} WHERE ${c} IS NOT NULL ORDER BY ${c} DESC, file_row_number LIMIT 2`,
    // DuckDB's text for a double isn't the table's; the longest by the
    // table's text is `longestRow`'s.
    `SELECT file_row_number FROM ${file} WHERE ${c} IS NOT NULL ORDER BY length(${c}::VARCHAR) DESC, file_row_number LIMIT 4`,
    `SELECT file_row_number FROM ${file} WHERE ${c} <> 0 ORDER BY abs(${c}), file_row_number LIMIT 3`,
    `SELECT file_row_number FROM ${file} WHERE ${c} = 0 ORDER BY file_row_number LIMIT 1`,
    `SELECT file_row_number FROM ${file} WHERE ${c} = floor(${c}) AND ${c} <> 0 ORDER BY file_row_number LIMIT 1`,
    `SELECT file_row_number FROM ${file} WHERE ${c} < 0 ORDER BY file_row_number LIMIT 2`,
    `SELECT file_row_number FROM ${file} WHERE ${c} IS NULL ORDER BY file_row_number LIMIT 1`,
    // Spread through the file: every tenth of it, the first value there.
    `SELECT min(file_row_number) FROM ${file} WHERE ${c} IS NOT NULL GROUP BY file_row_number * 10 // ${count} ORDER BY 1`,
  ];
  const [longest, length] = await longestRow(column);
  longestText.set(column, length);
  const rows: number[] = [longest];
  for (const sql of picks) rows.push(...(await rowsOf(sql)).map((row) => Number(row[0])));
  return rows;
}

/** Each column's longest table text, over every value in the file. */
const longestText = new Map<string, number>();
const wanted = new Set<number>();
for (const column of floats) for (const row of await rowsFor(column)) wanted.add(row);
const targets = [...wanted].sort((a, b) => a - b);
const quoted = floats.map((column) => `"${column.replaceAll('"', '""')}"`).join(', ');
const values = new Map<number, (number | null)[]>();
for (const row of await rowsOf(`SELECT file_row_number, ${quoted} FROM ${file} WHERE file_row_number IN (${targets.join(', ')})`)) {
  values.set(Number(row[0]), row.slice(1).map((value) => (value === null ? null : Number(value))));
}
console.log(`native DuckDB: ${count} rows; float columns ${floats.join(', ')}; ${targets.length} rows picked; longest table text ${[...longestText].map(([column, length]) => `${column} ${length}`).join(', ')}`);

// --- what the contender draws ---

interface ColumnProbe {
  name: string;
  kind: string;
  width: number;
  budget: number;
}
interface CellProbe {
  row: number;
  column: number;
  exact: string;
  shown: string;
}
type Global = { __contender?: { columns?: ColumnProbe[]; cells?: CellProbe[]; replay: { jump(fraction: number): Promise<void> } } };

/** The contender's columns at `dpr`, and, with `rows`, the cells it drew
 *  for them. Wide enough to show every column. */
async function drawn(browser: Browser, url: string, dpr: number, rows: number[]) {
  const context = await browser.newContext({ viewport: { width: 2560, height: 900 }, deviceScaleFactor: dpr });
  if (dpr !== 1) await context.addInitScript(hideDevicePixelContentBox);
  const page = await context.newPage();
  const found = problems(page);
  await page.goto(`${url}?measure&cells`);
  await waitMark(page, MARKS.filled, 0);
  const columns = await page
    .waitForFunction(() => (globalThis as Global).__contender?.columns ?? false, null, { timeout: 60_000 })
    .then(async (handle) => (await handle.jsonValue()) as ColumnProbe[]);
  const cells: CellProbe[] = [];
  for (const row of rows) {
    await page.evaluate((fraction) => (globalThis as Global).__contender!.replay.jump(fraction), (row + 0.5) / count);
    // The jump resolves once the view is filled; its frame's cells hold the row.
    const drawnRow = await page
      .waitForFunction(
        ({ row, columns }) => {
          const cells = ((globalThis as Global).__contender?.cells ?? []).filter((cell) => cell.row === row);
          return cells.length === columns ? cells : false;
        },
        { row, columns: columns.length },
        { timeout: 30_000, polling: 20 },
      )
      .then(async (handle) => (await handle.jsonValue()) as CellProbe[]);
    cells.push(...drawnRow);
  }
  await context.close();
  return { columns, cells, problems: found };
}

const failures: string[] = [];
const server = await serveGpui(PORT);
const browser = await chromium.launch({ channel: 'chromium' });
let fixture: unknown;
try {
  const atTwo = await drawn(browser, server.url, 2, targets);
  const atOne = await drawn(browser, server.url, 1, []);
  failures.push(...atTwo.problems, ...atOne.problems);
  const budgets = (columns: ColumnProbe[]) => JSON.stringify(columns.map(({ name, kind, budget }) => ({ name, kind, budget })));
  if (budgets(atTwo.columns) !== budgets(atOne.columns)) failures.push(`the budgets differ by DPR: ${budgets(atTwo.columns)} vs ${budgets(atOne.columns)}`);

  const floatColumns = floats.map((name) => {
    const index = atTwo.columns.findIndex((column) => column.name === name);
    const column = atTwo.columns[index];
    if (!column || column.kind !== 'float') throw new Error(`the contender lays ${name} out as ${column?.kind ?? 'nothing'}`);
    return { index, ...column };
  });
  const seen = new Set<string>();
  const cells: { column: string; row: number; value: string | null; exact: string; shown: string }[] = [];
  for (const [position, column] of floatColumns.entries()) {
    for (const cell of atTwo.cells.filter((cell) => cell.column === column.index).sort((a, b) => a.row - b.row)) {
      const value = values.get(cell.row)?.[position];
      if (value === undefined) {
        failures.push(`row ${cell.row} wasn't picked`);
        continue;
      }
      // The contender drew the file's value.
      // Compared as text: NaN never equals itself, and Rust writes `inf`.
      const same = cell.exact === (value === null ? 'NULL' : tableText(value));
      if (!same) failures.push(`${column.name} row ${cell.row}: drawn ${cell.exact}, DuckDB ${value} (${value === null ? 'NULL' : tableText(value)})`);
      const key = `${column.name} ${value === null ? 'null' : String(value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ column: column.name, row: cell.row, value: value === null ? null : String(value), exact: cell.exact, shown: cell.shown });
    }
  }
  fixture = {
    about:
      "Cell text: each float column's budget as the GPUI contender laid it out (its ColumnProbe); values from the data file with the exact text and the shown text the contender drew (cells, written by apps/observatory/perf/cell-fixture.ts); and synthetic values the same columns round (rounding, kept by it). See README.md.",
    source: { file: 'apps/observatory/data/asteroids.parquet', sha256: manifest['asteroids.parquet']!.sha256, contender: 'tall-table-gpui, release build, Chromium, 2560x900 at DPR 2 (budgets the same at DPR 1)' },
    columns: floatColumns.map(({ name, kind, width, budget }) => ({ name, kind, width, budget })),
    cells,
    rounding,
  };
  const rounded = cells.filter((cell) => cell.shown !== cell.exact && cell.value !== null).length;
  // Whether anything in the file rounds: its longest text against its budget.
  for (const column of floatColumns) {
    const longest = longestText.get(column.name) ?? 0;
    if (longest > column.budget && rounded === 0) failures.push(`${column.name}: a value of ${longest} characters rounds at ${column.budget}, but no drawn cell did`);
  }
  console.log(`budgets: ${floatColumns.map((column) => `${column.name} ${column.budget}`).join(', ')} (width ${floatColumns.map((column) => column.width).join('/')} px); ${cells.length} cells, ${rounded} rounded`);
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
const text = `${JSON.stringify(fixture, null, 2)}\n`;
if (flag('check')) {
  if (readFileSync(fixturePath, 'utf8') !== text) {
    console.error('FAIL: the contender draws other text than components/tall-table/fixtures/cells.json holds');
    process.exit(1);
  }
  console.log('the committed cell fixture matches what the contender draws');
} else {
  writeFileSync(fixturePath, text);
  console.log("wrote components/tall-table/fixtures/cells.json");
}
