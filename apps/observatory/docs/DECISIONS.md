# Decisions: Observatory

Why the Observatory is built the way it is. Decisions that bind every app, the comparison protocol among them, are in the root [`docs/DECISIONS.md`](../../../docs/DECISIONS.md).

One bullet per decision, under its area, oldest first: what was chosen, the numbers that chose it, and *[where they came from]* (a milestone, a code review, a results file in `perf/results/`). A decision that replaces another marks the old one *Superseded* rather than deleting it.

## Hosting

- **2026-10-14** · **Everything under `/observatory/`.** The page's Vite `base` is `/observatory/` from the first commit, so dev, preview, and production share paths, and the engine's extensions are served from `/observatory/duckdb/` (`@seiza/duckdb`'s `extensionDir`, added for it; `engines/duckdb/docs/DECISIONS.md`). Tycho keeps `/duckdb-ext`: its app wasm byte-identical, its engine chunk +206 B raw (+187 B brotli), `just tycho engine` passing. `shared-web`'s brotli preview strips the base as well, so preview serves the build as production will. *[M0 part A and its code review, `apps/tycho/perf/results/2026-10-14-observatory-m0-a-engine-review.json`]*
