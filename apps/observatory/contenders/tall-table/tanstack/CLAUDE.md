# The TanStack contender (`contenders/tall-table/tanstack/`)

React and TanStack Virtual over the DOM, the DOM side of GPUI | TanStack. Claude Code loads this file when a file under `contenders/tall-table/tanstack/` is read. The observatory's rules and the map of its folders are in `apps/observatory/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/observatory/`.

## What it is

`contenders/tall-table/tanstack/web/`: Vite, base `/observatory/contenders/tall-table/tanstack/`, React without JSX (`createElement`), no Wasm of its own. Its data layer (`src/data/`) ports the tall table's own logic, so the component's fixtures hold for it; its view follows the table's input where the browser's differs (the keys, a track press that jumps, the drag and its settle, Shift+wheel: `docs/dom-scroll-model.md`), and `tanstack-parity` checks it item by item against the GPUI contender. The contract it publishes is `docs/contender-contract.md`'s. Why each choice: `docs/DECISIONS.md`, "TanStack contender".

## A build per level

- **A build per level:** `--mode wide|market|tail|wall` into `web/dist-<level>/` at `…/tanstack/<level>/`, the base's `web/dist/`. `__LEVEL__` is a build constant (`contenders/level.ts`'s `levelConstants`, in the prerender's server too), so another level's branches drop out of a level's bundle, and `./level.css` resolves to the level's CSS (`wide.css`, `market.css`, `tail.css`, `wall.css`, the base's empty `base.css`).
- **How its levels keep each other's bundles byte-identical** (the rule: `contenders/CLAUDE.md`):
  - a top-level call in a level's module (`memo(…)`) is marked `/* @__PURE__ */`;
  - a level's imports in `main.ts` come after the view's (imported first, they reorder the other levels' modules);
  - anything Vite transforms whatever the branch (a worker's `new Worker(new URL(…))`) sits only in a module the level alone imports;
  - a level's value rides on the view's one `scene` prop (`LevelScene`), never a prop of its own;
  - in the data layer, `pages.ts` and `paging.ts` reach `copy.ts` only behind `__LEVEL__ === 'wide'`, `live.ts` only behind `'market'`, `'tail'`, or `'wall'`, and `follow.ts` (and `live.ts`'s grown page) only behind `'tail'`; what only a level does is a function, never a method (a bundler drops an unused function, not a method), reaching the classes' private members through a typed view (`CacheInside`, `PagingInside`);
  - a value import that would close a cycle or move a shared chunk is copied instead: `follow.ts` imports only types from `paging.ts` (so it keeps its own `clamp` and its own copy of `invalidateRows`' deferred plan), `data/copy.ts` keeps its own `f32Text`, the wall's data layer is `data/wall.ts` rather than market watch's `quotes.ts` shared, and `layout.ts`'s `clampWidth` is written inline by `layOut` (the test pins the two equal);
  - a level's CSS is a file of its own (`wall-theme.css`, `wide-theme.css`), so no other level's CSS changes.

## First paint

- **The first screen is prerendered:** the table's empty frame with one status line, as the GPUI contender's. `vite.config.ts` gives `shared-web`'s `prerender` the view's `App` (`FIRST_SCREEN`), rendered into `index.html` in dev and build, so `view.ts` and everything it imports must not touch browser globals at import.
- **`src/main.ts`** hydrates it (`hydrateRoot`), sets `contender:first-pixels` at the line's Element Timing paint and `usable` in the hydration commit, and once both the paint timing entry and that commit have happened, imports the data layer and Arrow, starts the engine, marks `open`, and opens the file. "After first paint" is the paint timing entry, not a frame callback (Chromium's `first-paint` is the frame's presentation, after the task that drew it). A page that can't paint starts at once: hidden now or before its paint (a background tab), or with an empty viewport (a `display: none` frame, which reports itself visible and never paints).
- `main.ts` resolves `?scenario=` and `?stop=` against the build's level (`pickScenario`): an unknown id shows the failure, marks `contender:failed`, opens nothing, and the replay rejects at once. The theme follows the page's live (`followPageTheme`: the root's `data-theme`). The face is IBM Plex Sans at `/fonts/`, GPUI's.
- **What a level adds loads after first paint:** its data module (`data/quotes.ts`, `data/replay.ts`, `data/wall.ts`) is imported by `main.ts` on that level only, after first paint, and makes its feed's or clock's worker itself, so no other build carries it; the wide level's `copy.ts` loads with the data layer and reaches the tools on the wide scene (`WideScene.copy`), so first-paint JS carries only its key's wiring.

## Rules in the view and the data layer

- **`theme.css`, `wall-theme.css`, and `wide-theme.css` are generated: don't edit them** (`just observatory theme-css`, from gpui-kit's resolved default theme by `gpui/crate/examples/theme_css.rs`, light and dark by the media query or the root's `data-theme`). The minifier rewrites their values' text (`#ffffff` as `#fff`): read a theme color in the page through a computed style, never the variable's text.
- **A color a cell mixes is a variable of a fixed value per theme,** never `light-dark()` of `oklch()`, which costs style work in every cell's `color-mix`: `scene.ts`'s `heatCss` writes the ramp's stops as hex, `market.ts`'s `marketCss` the rise, the fall, and their flash in sRGB, each a style element `main.ts` adds before the view renders.
- **A cell's text is the table's, exactly:** `data/format.ts` is Rust's `{:?}` and `fit_float`, rounding the double's exact value in `BigInt`s with Rust's ties, never `toFixed` or `String` alone; `data/number.ts` is `format.rs`'s `ColumnFormat`, its fit the characters' advances summed in f32, as the browser measures them at the cells' font (loaded first).
- **What's published only for a measurement:** with `?cells`, each cell's exact text (`data-exact`) too; with `?measure`, the contract's state and targets and `elementtiming` (`row:<row>` on each row's cells; the wall's `row:<50t + r>`; at the wide level only on cells created with a row's page, never on a column a sideways scroll brings in); with `?cells`, the cells on screen as the GPUI contender's probes publish them; `?probe` (`__tanstackProbe`, for `tanstack-parity`) never in a measured run.
- **A row that loads gets new cells:** rows are memoized by their page (market watch's and the wall's by their quote), and a row's placeholder cells are keyed apart from its loaded ones, so Element Timing never reads a placeholder turned real.
- **Under a feed, the replay, or a drag, what landed draws once a frame,** in the frame's callback (`flushSync`). The wide level's column virtualizer is told only of sideways moves (`observeElementOffset`), so a vertical scroll never re-renders for it.
- **The copy reads as the table's does:** its reads go beside the cache (`loadWantedCopy`): after the visible pages and before prefetch, at most `maxInFlight − 1`, none while a visible page has nothing to show, never cached, prefetch skipping a page the copy reads; its turns each run on a `MessageChannel` task, never a clamped `setTimeout`.
- **The browser's tools reach every row of a small table:** on the base level a table that fits in one page renders every row (the admin table: find, Translate, a screen reader), while Big file stays virtualized; `aria.ts` gives every level the table's ARIA semantics.
- **Live tail's scroller has scroll anchoring off** (`tail.css`): its rows change under it every frame.

## Where each piece is

`web/src/`, the view:

```
main.ts         the entry: hydration, the level's scene, the data layer's import after first paint
view.ts         the frame, the sticky header and gutter, TanStack Virtual over a 4,096-row window; WallGrid
scroll.ts       the scroll model (docs/dom-scroll-model.md): the scaled spacer, the table's input, the scrollbar
contract.ts     the contract from the view (TableContract): marks, state, targets, the replay's jump and fling
tooltip.ts      the cells' tooltip, at the table's timing and placement
aria.ts         the ARIA table semantics
layout.ts       the widths by kind, the gutter, the 30 px rows, pinned to the GPUI contender's; every length through Sizes
cells.ts        a row's state as its cells' text (a NULL muted; past a short page's end, empty)
view.css, theme.css (generated)
wide level:     density.ts (Sizes::resolve), pin.ts (pin.rs's geometry), paint.ts (Oklab, the ramps, FramePaint),
                scene.ts (the stop's level), wide.ts (the column virtualizer, the pinned run, the selection drawn),
                select.ts and resize.ts (the table's select and resize, ported pure), wide-tools.ts (their DOM),
                copy.ts (the copy's DOM: the keys, the clipboard), wide.css, wide-theme.css (generated)
market level:   market.ts (MarketRow, the flash, marketCss), market.css
tail level:     tail.ts (TailRow, TailReader: the reader's moves, following), tail.css
wall level:     wall.ts (the grid, wallContract, wallCss), wall.css, wall-theme.css (generated)
```

`web/src/data/`, the data layer, each a port of the table's or the GPUI side's Rust:

```
sql.ts          the engine's start, summary, and page SQL
pages.ts        PageCache
paging.ts       TablePaging: scroll, jump, drag, settle, on an injectable Clock; PAGING is Paging::default()
format.ts       a cell's exact and shown text (Rust's {:?}, fit_float)
table.ts        Arrow decoding (ArrowPage counts its IPC bytes), startEngine, openParquet
number.ts       format.rs's ColumnFormat
live.ts         live: invalidateRows, re-reads, takeRefreshed, the grown page
flash.ts        the flash: change, opacity, Flashes
follow.ts       set_rows, follow, let_go, pinToTail
copy.ts         copy.rs: a selection as TSV, the key's limit, the reads beside the cache
market.ts       market watch's store, QuoteStore
quotes.ts       market watch's table and feed (the GPUI side's scene/market.rs and feed.rs)
tail.ts         live tail's time text (timeText)
replay.ts       live tail's table and clock (scene/tail.rs and clock.rs)
wall.ts         the monitoring wall's tables and feed (scene/wall.rs and wall.rs)
```

`web/test/` (`node --test`; the data layer reads `__LEVEL__` as it runs: `level.ts` sets the base level at import, and `asLevel` runs a test as another level's): `fixtures.test.ts` runs the component's fixtures and their controls at each level (which scenarios each level runs: `components/tall-table/fixtures/README.md`); `live`, `follow`, `replay`, `tail`, `wide`, `market`, `quotes`, `wall`, and `view.test.ts` each pin what the fixtures don't, their header saying what.

## Commands

Its checks (`tanstack-view`, `tanstack-parity`, `tanstack-contract`, `tanstack-sizes`, and each level's) are in `perf/CLAUDE.md`.

```
just observatory tanstack-dev [level]     # the TanStack contender's Vite dev server at /observatory/contenders/tall-table/tanstack/ (a level's under it: `wide`, `market`, `tail`, `wall`), with the engine, the font, and the data files by range
just observatory tanstack-build [level]   # its release build at a level (`base`, `wide`, `market`, `tail`, `wall`) into web/dist[-<level>]/ (Arrow or DuckDB's JS in a first-paint chunk fails it), asset sizes
just observatory tanstack-preview [level] # serve that build (brotli), with the data files
just observatory theme-css [--check] # the TanStack contender's theme.css from gpui-kit's default theme (native; --check compares)
```
