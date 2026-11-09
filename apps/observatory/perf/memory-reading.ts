// The page's memory as the memory scripts read it (`metric-memory.ts`,
// `metric-soak.ts`): `performance.measureUserAgentSpecificMemory`'s
// breakdown (the page's own by type, its workers' apart: `memoryOf`), and
// the wasm's linear memory (every module the page instantiates, which a
// garbage collection never shrinks). Needs a cross-origin-isolated page and
// `MEMORY_ARGS` (else the measurement waits for a collection, up to 20 s).

import type { Page } from '@playwright/test';
import { memoryOf, type MemoryEntry } from '../metrics/metrics.ts';
import type { Session } from './contender.ts';

/** Chromium's flag that measures memory at once. */
export const MEMORY_ARGS = ['--enable-blink-features=ForceEagerMeasureMemory'];

/** The page's memory types the readings account for (the canvas's backing
 *  store apart, the rest "JavaScript"); any other fails a run. */
export const KNOWN_TYPES = new Set(['JavaScript', 'Canvas']);

/** Init script: every wasm memory the page instantiates. */
export function wasmRecorder(): void {
  const g = globalThis as { __wasmMemories?: WebAssembly.Memory[] };
  g.__wasmMemories = [];
  const keep = (result: WebAssembly.WebAssemblyInstantiatedSource | WebAssembly.Instance) => {
    const instance = 'instance' in result ? result.instance : result;
    for (const value of Object.values(instance.exports)) if (value instanceof WebAssembly.Memory) g.__wasmMemories!.push(value);
    return result;
  };
  const streaming = WebAssembly.instantiateStreaming;
  WebAssembly.instantiateStreaming = (...args) => streaming(...args).then(keep) as never;
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = ((...args: Parameters<typeof instantiate>) => instantiate(...args).then(keep)) as typeof instantiate;
}

export interface PageMemory {
  /** The page's own (its window), by `types` ("JavaScript", "Canvas", …), and its workers'. */
  pageBytes: number;
  pageByType: Record<string, number>;
  workerBytes: number;
  wasmBytes: number;
}

export async function pageMemory(page: Page): Promise<PageMemory> {
  const breakdown = await page.evaluate(async () => (await (performance as Performance & { measureUserAgentSpecificMemory(): Promise<{ breakdown: MemoryEntry[] }> }).measureUserAgentSpecificMemory()).breakdown);
  const { pageBytes, workerBytes, pageByType } = memoryOf(breakdown);
  const wasmBytes = await page.evaluate(() => ((globalThis as { __wasmMemories?: WebAssembly.Memory[] }).__wasmMemories ?? []).reduce((sum, memory) => sum + memory.buffer.byteLength, 0));
  return { pageBytes, pageByType, workerBytes, wasmBytes };
}

/** A forced garbage collection of the page (the engine's worker isn't
 *  collected), `passes` times with a task between: a `WeakRef`'s target is
 *  kept until the job that read it ends, so a weak reference read before
 *  the first pass clears only at the second. */
export async function collectGarbage(session: Pick<Session, 'context' | 'page'>, passes = 1): Promise<void> {
  const cdp = await session.context.newCDPSession(session.page);
  for (let pass = 0; pass < passes; pass++) {
    if (pass) await session.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await cdp.send('HeapProfiler.collectGarbage');
  }
  await cdp.detach();
}

/** The memory types in `taken` the readings don't account for, as failures. */
export const unknownTypes = (taken: PageMemory): string[] => Object.keys(taken.pageByType).filter((type) => !KNOWN_TYPES.has(type)).map((type) => `page memory of an unaccounted type: ${type}`);
