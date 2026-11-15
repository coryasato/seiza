/**
 * The path Kirkwood is served under, on Tycho's hostname
 * (`tycho.seiza.io/kirkwood/`; the root `docs/DECISIONS.md`, "Hosting"): the
 * build's base in dev, preview, and production, the routes its Worker takes,
 * and what the checks open. No DOM or Node: the Worker reads it too.
 */
export const BASE = '/kirkwood/';
