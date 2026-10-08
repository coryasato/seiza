/**
 * The Rust ↔ JS bridge. Only three calls cross it (Tycho's CLAUDE.md, rule 2):
 * `registerFile`, `query`, and `cancel`. Rust's side is
 * `crate/src/engine/bridge.rs`.
 *
 * Creating the bridge loads nothing. DuckDB (its JS, worker, and wasm) loads
 * on the first call, which Rust makes from the post-paint callback, so
 * nothing about the engine can delay first paint.
 */

import type { Engine } from './engine.ts';

export interface FileInfo {
  name: string;
  /** Bytes, or null when a URL's HEAD had no Content-Length. */
  size: number | null;
  /** Bytes DuckDB has read from it so far, live: a shared counter its worker
   *  adds to (read with `Atomics.load`). Null for a `Blob` that isn't a
   *  `File` (a CSV chunk), or without cross-origin isolation. */
  bytesRead: BigInt64Array | null;
}

export interface Bridge {
  /** Makes a dropped `File` or a same-origin URL readable from SQL as `name`. */
  registerFile(name: string, source: File | string): Promise<FileInfo>;
  /** Runs `sql`; resolves to the whole result as Arrow IPC stream bytes.
   *  Rejects with an `AbortError` if `cancel(requestId)` is called first. */
  query(sql: string, requestId: number): Promise<Uint8Array>;
  /** Stops the query with this id. Unknown or finished ids are ignored. */
  cancel(requestId: number): void;
}

/** The name of the error every call rejects with once DuckDB's worker has
 *  stopped (`ENGINE_STOPPED` in engine.ts, which loads only on first use). */
const ENGINE_STOPPED = 'EngineStopped';

export function createBridge(): Bridge {
  let engine: Promise<Engine> | null = null;
  // A load that fails is forgotten, so the next call starts a new one. So is
  // an engine whose worker stopped, but only once a call has been told
  // (rejected with `EngineStopped`): Rust then sends nothing until its
  // Retry, whose call starts the new engine. Forgetting it sooner would let
  // any stray call start one unseen (M7).
  // Where the engine chunk failed to load, if it did. A browser remembers a
  // failed dynamic import (Chromium does): importing the same URL again
  // fails at once, without a request. Retry imports it under a new query.
  let failedChunk: string | null = null;
  let retries = 0;
  const importEngine = (): Promise<typeof import('./engine.ts')> =>
    failedChunk ? import(/* @vite-ignore */ `${failedChunk}?retry=${++retries}`) : import('./engine.ts');
  const load = () => {
    if (!engine) {
      const started: Promise<Engine> = importEngine().then(({ startEngine }) => startEngine());
      started.catch((error: unknown) => {
        if (engine === started) engine = null;
        // Chromium and Firefox name the module in the message; Safari's
        // doesn't, and then the plain import is tried again.
        const chunk = /dynamically imported module: (\S+?\.[jt]s)\b/.exec(error instanceof Error ? error.message : '')?.[1];
        if (chunk) failedChunk = chunk;
      });
      engine = started;
    }
    return engine;
  };
  const call = async <T>(run: (loaded: Engine) => Promise<T>): Promise<T> => {
    const current = load();
    try {
      return await run(await current);
    } catch (error) {
      if (error instanceof Error && error.name === ENGINE_STOPPED && engine === current) engine = null;
      throw error;
    }
  };
  // Per request, so a cancel that arrives while the engine is still loading
  // still takes effect.
  const inFlight = new Map<number, AbortController>();

  return {
    registerFile(name, source) {
      return call((loaded) => loaded.registerFile(name, source));
    },
    async query(sql, requestId) {
      const controller = new AbortController();
      inFlight.set(requestId, controller);
      try {
        return await call((loaded) => {
          controller.signal.throwIfAborted();
          return loaded.query(sql, controller.signal);
        });
      } finally {
        inFlight.delete(requestId);
      }
    },
    cancel(requestId) {
      inFlight.get(requestId)?.abort(new DOMException('Query cancelled', 'AbortError'));
    },
  };
}
