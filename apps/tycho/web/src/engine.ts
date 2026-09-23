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
        await db.open({});
        await disableExtensionDownloads(db);
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
            await db.registerFileURL(name, url, DuckDBDataProtocol.HTTP, false);
            return { name, size };
          }
          // Read through FileReader as DuckDB asks for byte ranges; never copied whole.
          await db.registerFileHandle(name, source, DuckDBDataProtocol.BROWSER_FILEREADER, true);
          return { name, size: source.size };
        })(),
      ),
    query: (sql, signal) => guard(runQuery(db, sql, signal)),
  };
}

/**
 * Stops DuckDB from fetching extensions on its own. By default it autoloads a
 * known extension (Parquet included: it isn't built into DuckDB-Wasm) from
 * extensions.duckdb.org the first time a query needs it. Tycho self-hosts
 * everything, so until our origin serves the extensions (M3), a query that
 * needs one fails with DuckDB's "extension not loaded" error instead.
 */
async function disableExtensionDownloads(db: AsyncDuckDB): Promise<void> {
  const conn = await db.connectInternal();
  try {
    await db.runQuery(conn, 'SET GLOBAL autoload_known_extensions = false; SET GLOBAL autoinstall_known_extensions = false');
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

/**
 * Starts DuckDB's worker script inside a small classic worker that reports
 * unhandled promise rejections as errors.
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
