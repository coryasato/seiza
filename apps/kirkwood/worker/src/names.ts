// What the Worker and the scripts that stage for it agree on. Its own
// module: the scripts run in Node, without the Worker's types.

/** The files the page asks for (web/src/main.ts): nothing else of the bucket is served. */
export const FILES = ['elements.bin', 'rows.bin', 'stars.bin'];
/** The build's files served as their `.br`. */
export const PRECOMPRESSED = ['wasm', 'js', 'ttf', 'html'];
/** On a file's 503 while the data is paused. */
export const PAUSED_HEADER = 'X-Kirkwood-Paused';
