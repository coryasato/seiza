// Tycho's own pieces of the perf harness: its budgets, serving the release
// build with its Worker, dropping files, and the table probe. Everything
// app-agnostic (the protocol, page helpers, recorders, the counting proxy) is
// in shared-web/perf/.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { recordedBetween, frameStats } from '../../../shared-web/perf/harness.ts';
import { budgetLimits } from '../../../shared-web/perf/protocol.ts';
import { serveApp, type AppServer } from '../../../shared-web/perf/serve.ts';
import { startWorkerDev, WORKER_DEV_PORT } from '../worker/scripts/dev.ts';

/** A script's budgets, from perf/budgets.json (`limits('table', [...])`). */
export const limits = budgetLimits(new URL('./budgets.json', import.meta.url));

/**
 * Tycho under test (`serveApp`). With `given` (a script's `--url`:
 * production) nothing starts. Otherwise the release build (web/dist) on
 * `previewPort`, and, with `worker`, its /data/* (proxied by vite.config.ts
 * to WORKER_DEV_PORT) through a counting proxy there to a fresh
 * `wrangler dev` on `worker.port`.
 */
export function serveTycho(given: string | undefined, previewPort: number, worker?: { port: number; requireObject: string }): Promise<AppServer> {
  const webDir = join(dirname(fileURLToPath(import.meta.url)), '../web');
  const data = worker && { proxyPort: WORKER_DEV_PORT, port: worker.port, start: () => startWorkerDev(worker) };
  return serveApp(given, { webDir, port: previewPort, data });
}

type DropGlobal = { __tychoDropInput?: HTMLInputElement };

/**
 * Drops the file at `file` (a disk path) on the canvas, the way the OS does:
 * dragenter, dragover, drop, each carrying a DataTransfer with the file. The
 * file is set on a scratch <input type=file> by path, so Chromium reads it
 * from disk (no copy), like a visitor's file. Returns the page time just
 * before the drop event.
 */
export async function dropFile(page: Page, file: string): Promise<number> {
  await page.evaluate(() => {
    const g = globalThis as DropGlobal;
    if (!g.__tychoDropInput) {
      const input = document.createElement('input');
      input.type = 'file';
      input.hidden = true;
      document.body.append(input);
      g.__tychoDropInput = input;
    }
  });
  const input = await page.evaluateHandle(() => (globalThis as DropGlobal).__tychoDropInput!);
  await input.asElement()!.setInputFiles(file);
  return page.evaluate(() => {
    const file = (globalThis as DropGlobal).__tychoDropInput!.files![0]!;
    const canvas = document.querySelector('canvas')!;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const fire = (type: string) => canvas.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: 720, clientY: 450 }));
    fire('dragenter');
    fire('dragover');
    const at = performance.now();
    fire('drop');
    return at;
  });
}

/** What the table publishes to `globalThis.__tychoTable` with `?perf` or `?bench`. */
export interface TableProbe {
  rows: number;
  top: number;
  first: number;
  end: number;
  loaded: number;
  pending: number;
  failed: number;
  lastCell: string | null;
  /** The row the last jump landed on (0-based), highlighted; null before one. */
  marked: number | null;
}

/** What the table showed in a recorded frame: its top row, and whether it
 *  drew a blank row position, a placeholder, or every visible row loaded
 *  (`filled`). */
export interface TableFrame {
  top: number | null;
  blank: boolean;
  pending: boolean;
  filled: boolean;
}

/** Sets `__seizaFrameSample` so `frameRecorder` records a `TableFrame` with
 *  every rAF. Install it the same way as the recorder. */
export function tableFrames(): void {
  (globalThis as { __seizaFrameSample?: () => TableFrame }).__seizaFrameSample = () => {
    const table = (globalThis as { __tychoTable?: TableProbe }).__tychoTable;
    const shown = table ? table.loaded + table.pending + table.failed : 0;
    return {
      top: table ? table.top : null,
      blank: !!table && (table.end <= table.first || shown !== table.end - table.first),
      pending: !!table && table.pending > 0,
      filled: !!table && (table.rows === 0 || (table.end > table.first && table.loaded === table.end - table.first)),
    };
  };
}

/** Frame intervals (ms) recorded between two page times (`frameStats`),
 *  plus what the table showed in those frames. */
export async function framesBetween(page: Page, from: number, to: number) {
  const frames = await recordedBetween<TableFrame>(page, from, to);
  return {
    ...frameStats(frames),
    blankFrames: frames.filter((frame) => frame.blank).length,
    placeholderFrames: frames.filter((frame) => frame.pending).length,
  };
}
