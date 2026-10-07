/**
 * DuckDB-Wasm in a Web Worker. Only `bridge.ts` imports this, dynamically, on
 * the first bridge call, so this module, DuckDB's JS, its worker, and its
 * wasm are all separate requests that start after first paint.
 *
 * The bundles are self-hosted (Vite emits them into our dist/), never loaded
 * from a CDN: they must work under COEP, and load time must not depend on a
 * third party. `selectBundle` picks EH (wasm exceptions) where the browser
 * supports it, MVP otherwise. The COI (threads) bundle isn't used.
 */

import { AsyncDuckDB, DuckDBDataProtocol, selectBundle, VoidLogger } from '@duckdb/duckdb-wasm';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehModule from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import mvpModule from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import type { FileInfo } from './bridge.ts';

/** Set when the engine starts loading and when it's open. Rust reads the
 *  second (`ENGINE_READY_MARK` in `crate/src/engine/bridge.rs`); the perf
 *  suite reads both. */
export const ENGINE_START_MARK = 'tycho:engine-start';
export const ENGINE_READY_MARK = 'tycho:engine-ready';

/**
 * HTTP files are read by byte range, never downloaded whole. With DuckDB-Wasm
 * 1.32.0's defaults, a URL is sized by a `bytes=0-0` GET whose answer it then
 * misreads (it looks for the total in Content-Length, not Content-Range), so
 * it falls back to downloading the entire file: all 34 MB of the asteroid
 * sample to show its schema. With these settings it sizes the file with a
 * ranged HEAD (the Worker answers 206) and reads only what queries need; a
 * server without range support fails instead of silently downloading
 * everything. See perf/results/2026-09-24-m3.md.
 */
const RANGE_READS_ONLY = { reliableHeadRequests: true, allowFullHTTPReads: false, forceFullHTTPReads: false };

export interface Engine {
  registerFile(name: string, source: File | string): Promise<FileInfo>;
  query(sql: string, signal: AbortSignal): Promise<Uint8Array>;
}

export async function startEngine(): Promise<Engine> {
  performance.mark(ENGINE_START_MARK);
  const bundle = await selectBundle({
    mvp: { mainModule: mvpModule, mainWorker: mvpWorker },
    eh: { mainModule: ehModule, mainWorker: ehWorker },
  });
  const worker = startWorker(bundle.mainWorker!);
  const countReads = readCounter(worker);
  // Rejects on the worker's first error, at load or any time after. Every
  // call races it: DuckDB-Wasm never settles a pending call when its worker
  // dies, so without this a crash mid-query (out of memory on a big file, a
  // failed range read) would leave that query pending forever.
  const workerFailed = new Promise<never>((_, reject) => {
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      reject(new Error(event.message ? `DuckDB worker: ${event.message}` : "DuckDB's worker failed to load"));
    });
  });
  workerFailed.catch(() => {}); // Reported through the calls that race it.
  const guard = <T>(call: Promise<T>): Promise<T> => Promise.race([call, workerFailed]);

  const db = new AsyncDuckDB(new VoidLogger(), worker);
  // Absolute: the worker's own URL is a blob: URL, which can't resolve paths.
  const mainModule = new URL(bundle.mainModule, location.href).href;
  try {
    await guard(
      (async () => {
        await db.instantiate(mainModule);
        await db.open({ filesystem: RANGE_READS_ONLY });
        await useSelfHostedExtensions(db);
      })(),
    );
  } catch (error) {
    worker.terminate();
    throw error;
  }
  performance.mark(ENGINE_READY_MARK);

  return {
    registerFile: (name, source) =>
      guard(
        (async () => {
          if (typeof source === 'string') {
            const url = new URL(source, location.href).href;
            const size = await remoteSize(url);
            const bytesRead = countReads(url);
            await db.registerFileURL(name, url, DuckDBDataProtocol.HTTP, false);
            return { name, size, bytesRead };
          }
          // Read through FileReader as DuckDB asks for byte ranges; never copied whole.
          const bytesRead = source instanceof File ? countReads(fileKey(source)) : null;
          await db.registerFileHandle(name, source, DuckDBDataProtocol.BROWSER_FILEREADER, true);
          return { name, size: source.size, bytesRead };
        })(),
      ),
    query: (sql, signal) => guard(runQuery(db, sql, signal)),
  };
}

/** Where DuckDB loads extensions from: our origin, `public/duckdb-ext/`,
 *  filled by `scripts/extensions.ts` from the pins in `duckdb-extensions.json`. */
export const EXTENSION_REPOSITORY = '/duckdb-ext';

/**
 * Points DuckDB's extension loading at our origin. Parquet isn't built into
 * DuckDB-Wasm; by default DuckDB would fetch it from extensions.duckdb.org the
 * first time a query needs it. Tycho self-hosts everything (CLAUDE.md), so
 * the repository is ours. DuckDB builds the URL as
 * `<repository>/<version>/<platform>/<name>.duckdb_extension.wasm`.
 *
 * Autoload is off: an extension loads only through an explicit `LOAD`, which
 * Rust sends one at a time (`Engine::load_parquet`). Two failing loads of one
 * extension at once crash DuckDB-Wasm 1.32.0's worker without an error event
 * (M4), and with autoload on, any query could start one. A query that needs an
 * extension nobody loaded fails with a clear error instead.
 */
async function useSelfHostedExtensions(db: AsyncDuckDB): Promise<void> {
  const repository = new URL(EXTENSION_REPOSITORY, location.href).href.replaceAll("'", "''");
  const conn = await db.connectInternal();
  try {
    await db.runQuery(
      conn,
      `SET GLOBAL custom_extension_repository = '${repository}'; ` +
        `SET GLOBAL autoinstall_extension_repository = '${repository}'; ` +
        'SET GLOBAL autoinstall_known_extensions = true; SET GLOBAL autoload_known_extensions = false',
    );
  } finally {
    await db.disconnect(conn);
  }
}

/**
 * Checks that a remote file exists and can be read by byte range (DuckDB reads
 * remote files only that way), and returns its size from `Content-Range`.
 * Anything but a `206` fails here rather than at the first query: a missing
 * file, a server without range support, or an SPA fallback that answers every
 * path with `index.html` (Vite's dev and preview servers do).
 */
async function remoteSize(url: string): Promise<number | null> {
  const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  // Only the headers are needed; a server that ignored the range would send it all.
  void response.body?.cancel();
  if (response.status !== 206) {
    throw new Error(`Can't read ${url}: expected a byte-range (206) response, got ${response.status} ${response.statusText}`);
  }
  const total = response.headers.get('Content-Range')?.match(/\/(\d+)$/)?.[1];
  return total === undefined ? null : Number(total);
}

/** The message `readCounter` sends the worker; the worker's wrapper keeps it
 *  from DuckDB. */
const COUNT_MESSAGE = '__tychoCountReads';

/** How the worker's wrapper names a dropped file. The worker gets its own
 *  copy of the `File`, so identity can't match; these fields do. */
const fileKey = (file: File) => `file:${file.name}\0${file.size}\0${file.lastModified}`;

/**
 * Counts the bytes DuckDB reads from a registered file, for the perf panel's
 * "read X of Y". DuckDB reads inside its worker, with synchronous XHRs (by
 * byte range) for a URL and `FileReaderSync` on slices for a dropped file, so
 * the page never sees them. The worker's wrapper (`startWorker`) counts both
 * into a shared counter per file, which Rust reads with `Atomics.load`: the
 * counter rides on `registerFile`'s answer, so the bridge stays at three calls
 * (Tycho rule 2). Null without cross-origin isolation (no
 * `SharedArrayBuffer`), which Tycho always has.
 */
function readCounter(worker: Worker): (key: string) => BigInt64Array | null {
  return (key) => {
    if (typeof SharedArrayBuffer === 'undefined') return null;
    const counter = new BigInt64Array(new SharedArrayBuffer(8));
    // Ordered before DuckDB's register message, so no read goes uncounted.
    worker.postMessage({ [COUNT_MESSAGE]: { key, counter } });
    return counter;
  };
}

/**
 * The worker's side of `readCounter`, run before DuckDB's script. Wraps
 * `XMLHttpRequest` (counting each GET's response body) and `FileReaderSync`
 * (counting each read of a slice of a counted file: `Blob.prototype.slice` is
 * wrapped to remember a slice's file). Runs as worker source, so it's plain JS.
 */
const COUNT_READS_SOURCE = `
const counters = new Map();
const roots = new WeakMap();
const fileKey = (file) => 'file:' + file.name + '\\0' + file.size + '\\0' + file.lastModified;
const add = (key, bytes) => {
  const counter = key && counters.get(key);
  if (counter && bytes > 0) Atomics.add(counter, 0, BigInt(bytes));
};
self.addEventListener('message', (event) => {
  const message = event.data && event.data[${JSON.stringify(COUNT_MESSAGE)}];
  if (!message) return;
  event.stopImmediatePropagation();
  counters.set(message.key, message.counter);
});
const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  this.__tychoKey = String(method).toUpperCase() === 'GET' ? String(url) : null;
  return open.call(this, method, url, ...rest);
};
const send = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (...args) {
  const result = send.apply(this, args);
  if (this.__tychoKey && this.readyState === 4 && this.response) add(this.__tychoKey, this.response.byteLength);
  return result;
};
const slice = Blob.prototype.slice;
Blob.prototype.slice = function (...args) {
  const part = slice.apply(this, args);
  roots.set(part, roots.get(this) ?? this);
  return part;
};
const read = FileReaderSync.prototype.readAsArrayBuffer;
FileReaderSync.prototype.readAsArrayBuffer = function (blob) {
  const bytes = read.call(this, blob);
  const root = roots.get(blob) ?? blob;
  if (root instanceof File) add(fileKey(root), bytes.byteLength);
  return bytes;
};
`;

/**
 * Starts DuckDB's worker script inside a small classic worker that reports
 * unhandled promise rejections as errors, and counts the bytes DuckDB reads
 * (`readCounter`).
 *
 * DuckDB-Wasm 1.32.0 doesn't reject `instantiate` when its worker fails: a
 * worker script that doesn't load, or a wasm fetch that fails (DuckDB fetches
 * it in a promise nothing awaits), would leave the load pending forever and
 * the UI on "Engine loading…". Both now fire `error` on the `Worker`. The
 * wrapper is a blob: URL, not a Vite worker entry, because Vite's dev server
 * serves workers as ES modules, and those can't `importScripts`.
 */
function startWorker(scriptUrl: string): Worker {
  const script = new URL(scriptUrl, location.href).href;
  const source =
    `self.addEventListener('unhandledrejection', (event) => self.reportError(event.reason));\n` +
    COUNT_READS_SOURCE +
    `importScripts(${JSON.stringify(script)});\n`;
  // Not revoked: that could race the worker's own fetch of it; it's one small blob.
  return new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
}

/**
 * Runs one query on its own connection, so queries can interleave and each
 * can be cancelled alone. DuckDB-Wasm executes a pending query in slices
 * (`pollPendingQuery`); a cancel lands between two slices.
 */
async function runQuery(db: AsyncDuckDB, sql: string, signal: AbortSignal): Promise<Uint8Array> {
  const conn = await db.connectInternal();
  const onAbort = () => void db.cancelPendingQuery(conn).catch(() => {});
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    signal.throwIfAborted();
    // The schema message, once the result is ready…
    let header = await db.startPendingQuery(conn, sql, false);
    while (header === null) {
      signal.throwIfAborted();
      header = await db.pollPendingQuery(conn);
    }
    signal.throwIfAborted();
    // …then one message per record batch, until an empty chunk. The query
    // isn't pending any more, so DuckDB can't cancel it; stop fetching instead.
    const chunks = [header];
    for (;;) {
      signal.throwIfAborted();
      const chunk = await db.fetchQueryResults(conn);
      if (chunk === null) continue;
      if (chunk.length === 0) break;
      chunks.push(chunk);
    }
    return concat(chunks);
  } finally {
    signal.removeEventListener('abort', onAbort);
    void db.disconnect(conn).catch(() => {});
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
