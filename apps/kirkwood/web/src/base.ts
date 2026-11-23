/**
 * The path Kirkwood is served under: the root of its own hostname
 * (`kirkwood.seiza.io`; `docs/DECISIONS.md`, "Hosting"). The build's base in
 * dev, preview, and production, what its Worker serves, and what the checks
 * open. No DOM or Node: the Worker reads it too.
 */
export const BASE = '/';
