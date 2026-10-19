# Observatory M5 part A: the placeholder's `data-theme`, the engine's `extensionBase` (2026-10-19)

Shared changes the observatory's page needs, measured on Tycho, the other app that builds them (observatory `PLAN.md`, M5 part A).

Measured on Apple M1, Darwin 25.6.0, machine `local`: Tycho's Vite build (`web/`, on the release wasm already in `web/pkg/`) with and without the two changes, brotli at quality 11 (`shared-web/src/brotli.ts`). Bytes only: neither change runs anything Tycho reaches (it sets no `data-theme` and no `extensionBase`).

## What changed

- **`shared-web`'s placeholder follows a page-set `data-theme`** beside `prefers-color-scheme`: `:root[data-theme="dark"]` takes the dark colors, `data-theme="light"` keeps the light ones. Without the attribute it's what it was. The observatory's contenders set it from `?theme=`.
- **`@seiza/duckdb`'s `extensionBase` option:** the path the extension directory sits under, Vite's `BASE_URL` by default (Tycho's, `/`). The observatory's contenders load one engine from `/observatory/duckdb/`, outside their bases.
- `shared-web`'s new `prerender` plugin and `serveDirs` (and `previewBrotli`'s file lookup split into helpers) aren't in Tycho's build; `vite preview` serves its build as before.

## Size effect on Tycho

| File | Before, raw / brotli | After, raw / brotli | Change, brotli |
|---|---|---|---|
| `index.html` (the placeholder's CSS; before first paint) | 21,624 / 11,549 B | 22,133 / 11,591 B | +42 B |
| `assets/engine-*.js` (after first paint) | 198,589 / 39,939 B | 198,764 / 39,971 B | +32 B |
| `assets/index-*.js` (the entry: the engine chunk's new hash) | 116,381 / 21,495 B | 116,381 / 21,497 B | +2 B |

The wasm doesn't change. +42 B before first paint, under 0.1 ms on Fast 4G; inside every budget.

## Reproducing it

Build Tycho's web host (`npm run build --workspace @seiza/tycho-web`) with and without the two files (`shared-web/src/placeholder.ts`, `engines/duckdb/web/src/engine.ts`), and compare `shared-web/scripts/asset-sizes.ts apps/tycho/web/dist` or each file's brotli bytes.
