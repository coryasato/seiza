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
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

export async function boot({ init, start, fontUrl }: BootOptions): Promise<void> {
  try {
    const [, font] = await Promise.all([init(), fetchBytes(fontUrl)]);
    start(new Uint8Array(font));
  } catch (error) {
    showBootError(error);
    throw error;
  }
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
