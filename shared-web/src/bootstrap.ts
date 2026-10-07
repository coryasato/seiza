/**
 * Browser-side half of the seiza bootstrap. Fetches the one UI font in
 * parallel with instantiating the wasm, then hands the font bytes to the
 * app's Rust `start`. Everything after that (fonts → init → first frame →
 * `gpui:first-frame` mark → post-paint) happens in `shared/`.
 */

export interface BootOptions {
  /** wasm-bindgen's default export: fetches and instantiates the module. */
  init: () => Promise<unknown>;
  /** The app's `#[wasm_bindgen] start(ui_font)`. */
  start: (uiFont: Uint8Array) => void;
  /** URL of the bundled UI font. */
  fontUrl: string;
  /** URL of the app wasm `init` fetches, for the load waterfall's download
   *  step (its Resource Timing entry). */
  wasmUrl: string;
}

/**
 * Load-step marks the perf panel's waterfall reads (`shared/src/perf.rs`).
 * Download start and end come from the wasm's Resource Timing entry; ready is
 * when `init` resolved (compiled and instantiated). Don't rename them.
 */
export const WASM_REQUESTED_MARK = 'seiza:wasm-requested';
export const WASM_DOWNLOADED_MARK = 'seiza:wasm-downloaded';
export const WASM_READY_MARK = 'seiza:wasm-ready';

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

export async function boot({ init, start, fontUrl, wasmUrl }: BootOptions): Promise<void> {
  try {
    const instantiated = init().then(() => markWasm(wasmUrl));
    const [, font] = await Promise.all([instantiated, fetchBytes(fontUrl)]);
    start(new Uint8Array(font));
  } catch (error) {
    showBootError(error);
    throw error;
  }
}

/** Marks the wasm's download (from Resource Timing, so a preload counts) and
 *  the moment it was ready. Streaming compilation overlaps the download, so
 *  ready minus downloaded is the compile tail a visitor waits on. */
function markWasm(wasmUrl: string): void {
  performance.mark(WASM_READY_MARK);
  const entry = performance.getEntriesByName(new URL(wasmUrl, location.href).href, 'resource')[0] as PerformanceResourceTiming | undefined;
  if (!entry) return;
  performance.mark(WASM_REQUESTED_MARK, { startTime: entry.startTime });
  performance.mark(WASM_DOWNLOADED_MARK, { startTime: entry.responseEnd });
}

/** The canvas never painted, so say so in plain DOM. */
function showBootError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const element = document.createElement('pre');
  element.setAttribute('role', 'alert');
  element.style.cssText = 'margin:0;padding:16px;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;';
  element.textContent = `This app failed to start.\n\n${message}`;
  document.body.append(element);
}
