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

export function createBridge(): Bridge {
  let engine: Promise<Engine> | null = null;
  const load = () => (engine ??= import('./engine.ts').then(({ startEngine }) => startEngine()));
  // Per request, so a cancel that arrives while the engine is still loading
  // still takes effect.
  const inFlight = new Map<number, AbortController>();

  return {
    async registerFile(name, source) {
      return (await load()).registerFile(name, source);
    },
    async query(sql, requestId) {
      const controller = new AbortController();
      inFlight.set(requestId, controller);
      try {
        const loaded = await load();
        controller.signal.throwIfAborted();
        return await loaded.query(sql, controller.signal);
      } finally {
        inFlight.delete(requestId);
      }
    },
    cancel(requestId) {
      inFlight.get(requestId)?.abort(new DOMException('Query cancelled', 'AbortError'));
    },
  };
}
