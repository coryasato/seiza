// The elements file's layout (docs/data.md, "`elements.bin`"): a header,
// then the rows in blocks, each block a column at a time, the last one
// short. So the first rows are whole when the first block is, and a page
// can draw them while the rest arrive. No file access: prep writes with
// this, and every reader of the built file in data/ and checks/ reads with it.

import { EPOCH_JD } from './orbit.ts';

export const MAGIC = 'KWE2';
/** The magic, the row count (u32), the epoch (f64), the rows in a block (u32). */
export const HEADER_BYTES = 20;
/** A block's columns, in order: a (au), e, i, the node, the argument of
 *  perihelion, the mean anomaly at the epoch (degrees), and H. */
export const COLUMNS = ['a', 'e', 'i', 'om', 'w', 'ma', 'H'] as const;
/** The rows in a block (docs/DECISIONS.md, "Data"). */
export const BLOCK_ROWS = 16_384;

export function header(rows: number, blockRows: number): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  for (let at = 0; at < 4; at++) bytes[at] = MAGIC.charCodeAt(at);
  view.setUint32(4, rows, true);
  view.setFloat64(8, EPOCH_JD, true);
  view.setUint32(16, blockRows, true);
  return bytes;
}

/** The columns (each `rows` long) as the file's blocks: for each block of
 *  `blockRows` rows, its rows of each column in turn. */
export function blocked(columns: Float32Array[], blockRows: number): Float32Array {
  const rows = columns[0]!.length;
  if (columns.length !== COLUMNS.length || columns.some((column) => column.length !== rows)) throw new Error(`the elements are ${COLUMNS.length} columns of one length`);
  if (!Number.isInteger(blockRows) || blockRows < 1) throw new Error(`a block of ${blockRows} rows`);
  const out = new Float32Array(rows * COLUMNS.length);
  let at = 0;
  for (let from = 0; from < rows; from += blockRows) {
    const to = Math.min(rows, from + blockRows);
    for (const column of columns) {
      out.set(column.subarray(from, to), at);
      at += to - from;
    }
  }
  return out;
}

export interface ElementsFile {
  rows: number;
  blockRows: number;
  /** Each column whole, `rows` long: a copy, gathered from the blocks. */
  columns: Record<(typeof COLUMNS)[number], Float32Array>;
}

/** The file read back: its header, and each row's cells from where its
 *  block keeps them. */
export function readElements(file: Uint8Array): ElementsFile {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.length < HEADER_BYTES || String.fromCharCode(...file.subarray(0, 4)) !== MAGIC) throw new Error(`the elements file doesn't start as one (${MAGIC})`);
  const [rows, epoch, blockRows] = [view.getUint32(4, true), view.getFloat64(8, true), view.getUint32(16, true)];
  if (epoch !== EPOCH_JD) throw new Error(`the elements file's epoch is JD ${epoch}, not ${EPOCH_JD}`);
  if (blockRows < 1 || file.length !== HEADER_BYTES + rows * COLUMNS.length * 4) throw new Error(`the elements file is ${file.length} bytes, not its ${rows} rows' ${COLUMNS.length} columns`);
  const columns = COLUMNS.map(() => new Float32Array(rows));
  for (let row = 0; row < rows; row++) {
    const from = row - (row % blockRows);
    const held = Math.min(blockRows, rows - from);
    const block = HEADER_BYTES + from * COLUMNS.length * 4;
    for (let column = 0; column < COLUMNS.length; column++) columns[column]![row] = view.getFloat32(block + (column * held + (row - from)) * 4, true);
  }
  return { rows, blockRows, columns: Object.fromEntries(COLUMNS.map((name, column) => [name, columns[column]!])) as ElementsFile['columns'] };
}
