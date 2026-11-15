// What the Worker and the scripts that stage for it agree on. Its own
// module: the scripts run in Node, without the Worker's types.

/** The files the page asks for (web/src/main.ts): nothing else of the bucket is served. */
export const FILES = ['elements.bin', 'rows.bin', 'stars.bin'];
/** The build's files served as their `.br`. */
export const PRECOMPRESSED = ['wasm', 'js', 'ttf', 'html'];
/** A build file's Content-Type, by extension. */
export const CONTENT_TYPES: Record<string, string> = {
  wasm: 'application/wasm',
  js: 'text/javascript',
  html: 'text/html; charset=utf-8',
  ttf: 'font/ttf',
};
/** On a file's 503 while the data is paused. */
export const PAUSED_HEADER = 'X-Kirkwood-Paused';
