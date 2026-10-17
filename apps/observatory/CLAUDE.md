# Observatory

The Observatory is seiza's comparison page, at `seiza.io/observatory`: it runs each component against a DOM equivalent, one at a time, on the same engine and data, and measures what each costs over a session of use. The first comparison is GPUI | TanStack: the tall table (`components/tall-table/`) against React + TanStack Virtual.

---

This is the Observatory's context. What's next is in `PLAN.md`; why things are built this way, in `docs/DECISIONS.md` (repo-wide decisions, the comparison protocol's above all, in the root `docs/DECISIONS.md`); finished milestones, in `docs/milestones.md`; budgets, in `perf/budgets.json` (the root `CLAUDE.md`, "Docs: one home per fact", says what goes where). The repo-wide rules in the root `CLAUDE.md` apply here too, its "Comparison protocol" first. Paths below are relative to `apps/observatory/`.

Current state only: say what to do and point to the decision behind it; don't retell its measurements.

## Observatory rules

These add to the repo-wide rules.

1. **Consume, don't reshape.** The observatory uses components and engines as they are. It may ask one to expose what its metrics need, or to take an option a host sets; it never changes how a utility app behaves, and every such change records its effect on each app that builds it (root `CLAUDE.md`, "Tiers").
2. **Everything lives under `/observatory/`.** The apex origin is shared with the landing page and future pages: the page, the contenders, the engine (`/observatory/duckdb/`: `@seiza/duckdb`'s `extensionDir` set to `duckdb` under the base), and the data are served under it, and nothing registers a service worker outside it.
3. **The page is JS; the contenders are what they compare.** The page and the DOM contenders are JS throughout, on purpose (root `CLAUDE.md`, "Stack and pins"). The GPUI contender is a minimal Rust host of the component.

## Stack

- **JS host:** `web/` (Vite on `shared-web/`: COOP/COEP in dev and preview, `base: '/observatory/'`). Today a static page saying the Observatory is coming; not deployed.
- **The GPUI contender** (`contenders/tall-table/gpui/`): `crate/` (package `tall-table-gpui`) is the bare host, `seiza-tall-table` over `seiza-duckdb`'s `tall-table` source on `seiza` without `panel` (the workspace's `seiza` entry turns defaults off; Tycho names `features = ["panel"]`), built alone (`-p`). `host.rs` opens the data file once the engine is ready (`open_parquet` under the SQL name `asteroids.parquet`, no metadata keys) and shows the table; until then the table's empty frame holds one status line ("Engine loading…" in the first frame). `contract.rs` publishes the contract (`docs/contender-contract.md`) from the table's events: `contender:open` and `contender:filled` (with `mark_after_current_task`, always), `__contender.state` and the targets (`seiza::targets`) with `?measure`, the drawn cells and the columns' budgets with `?cells` (the table's cell probe on, for the cell fixture; `docs/contender-contract.md`, "The cell probe"), and the replay's wasm exports (`replayOpen`, `replayJump`, `replayGeometry`, `replayView`: the count of changed frames and whether the last was filled, since a view that lands already filled sets no `contender:filled`). `state.cacheBytes` is read at most every 100 ms, outside the frames. The table probes every frame (`probe_frames(true)`), measured or not: the replay's fling reads the rows and row height from them. `web/` (Vite, `base: '/observatory/'`): `src/main.ts` creates the bridge (`extensionDir: 'duckdb'`), sets `first-pixels` and `usable` at the placeholder's paint and the first frame's, and defines the replay hooks; `vite.config.ts` has the placeholder (the frame and its line: `.sz-frame`) and serves the data file (`contenders/data.ts`). The page is at `/observatory/` of its own server until the deploy decides where the bare pages live (`PLAN.md`, "The observatory page, deployed").
- **The TanStack contender** (`contenders/tall-table/tanstack/web/`, Vite, `base: '/observatory/'`): React and TanStack Virtual over the DOM, no Wasm of its own. Today its data layer and a stub page. `src/data/` ports the tall table's own logic, so the component's fixtures hold for it: `sql.ts` (the engine's start, summary, and page SQL), `pages.ts` (`PageCache`), `paging.ts` (`TablePaging`: the row position and the state's scroll, jump, drag, and settle paths over the cache, on an injectable `Clock`; `PAGING` is the component's `Paging::default()`), `format.ts` (Rust's `{:?}` exact text and `fit_float`, rounding the double's exact value in `BigInt`s with Rust's ties: never `toFixed` or `String` alone), `table.ts` (`apache-arrow` decoding, `ArrowPage` counting its IPC `byteLength`, `openTable`). `table.ts` and Arrow load after first paint (`src/main.ts` imports them at the paint timing entry, not in a frame callback: Chromium's `first-paint` is the frame's presentation, after the task that drew it). `test/fixtures.test.ts` runs the three fixtures and their controls (`node --test`; its script clock fires due timers as each step settles, as GPUI's test executor does). Why: `docs/DECISIONS.md`, "TanStack contender".
- **Shared by the contenders:** `contenders/contract.ts` (`__contender`, the marks' relay to a parent page, `markAt`, `nextMark`, the provisional fling profile), `contenders/data.ts` (a Vite plugin serving `data/` by range under `<base>data/` in dev and preview, with the Worker's headers), and `contenders/engine.ts` (`contenderBuild`, in both Vite configs: DuckDB-Wasm's bundles emitted under `duckdb/`, content-hashed, so both contenders load the same files from `/observatory/duckdb/`; the build fails if Arrow or DuckDB-Wasm's JS is in a chunk the entry loads statically).
- **Data:** `data/asteroids.parquet` (gitignored), built by `data/prep.ts` + `prep.sql` with native DuckDB from Tycho's asteroid sample, after checking that file against the SHA-256 in Tycho's `data/MANIFEST.json`: 11 of its columns, every row, Tycho's writer settings. `data/MANIFEST.json` (committed) holds its rows, bytes, SHA-256, and row groups. It must stay under 25 MiB (a static asset); `prep.ts` fails otherwise. Why these columns: `docs/DECISIONS.md`, "Data".
- **Hosting:** Worker `observatory` (`worker/`) on the apex **https://seiza.io**, a custom domain (`workers_dev = false`, `preview_urls = false`). Everything is a static asset; the script (`worker/src/index.ts`) runs first for `/observatory/data/*`, because static assets ignore `Range` (and for any path no asset matches, which it answers 404, each a billed request): it puts the file whole into the edge cache once per location, keyed by `DATA_SHA256` (the deploy passes it from `data/MANIFEST.json`), and answers each request with `cache.match`, which serves 206s. The data goes out `no-cache, no-transform` with no Content-Encoding; don't let anything compress it. `worker/scripts/stage.ts` builds `worker/dist/` (gitignored): the data file and `_headers`. Why: `docs/DECISIONS.md`, "Hosting". The zone's WAF rules cover it (their text in the gitignored root `docs/private/zone.md`). A new path outside `/observatory/` goes into the seiza.io rule before it deploys.

## Perf script gotchas

- **The contenders' checks serve their builds themselves** (`perf/harness.ts`, `serveGpui` and `serveTanstack`: `vite preview` of each `web/dist`, the page at `<server>/observatory/`), the GPUI contender's on ports 4311–4314, `engine-files` on 4315–4316, and read `count(*)` and the last key from data/'s native DuckDB (`just observatory data` installs it). The GPUI contender's placeholder text sits 1 device px above GPUI's at DPR 2 (inside the ink's ±1), so a "text 1 px down" control can't fail the match; `perf/placeholder.ts`'s control moves it up.
- **The production scripts route the page in.** `perf/data-read.ts` opens a page at each data file's own origin with Playwright routing every path but the data to Tycho's local release build (`?bench` exposes its bridge), so the reads are same-origin under COEP and both sides run one engine. The routes reach DuckDB's worker too. Run `just tycho build` first.
- **Native scrollers under Playwright** (`docs/dom-scroll-model.md`, "Scripting it"): drive them with raw `page.mouse.wheel` deltas, not `wheel()`; Firefox applies at most one page per wheel event, so no scripted fling crosses the table there; the harness's `fling()` ends with a catch-up event a native scroller clamps, so a DOM fling sends equal events; headless Chromium hides scrollbars (`--hide-scrollbars`) and headless Firefox has none with width, so a thumb drag needs `spike/input.ts`'s `openWithScrollbars` (Chromium, WebKit) or a headed Firefox with `ui.useOverlayScrollbars: 0`.
- **Input latency and frame work come from Chromium's trace** (`docs/contender-contract.md`, "Reading the metrics"), not the page's Event Timing observer (rounded to 8 ms, nothing under 16 ms, no wheel). GPUI on WebGL2 in Chromium: an init script deleting `Navigator.prototype.gpu` makes its `Auto` backend fall back (`spike/latency.ts`, `hideWebGpu`); check the backend from its first GPU call (`gpuBackend`, which then unhooks itself, so timing runs carry no GPU-call wrapper; `gpuiProbe` stays hooked and belongs to latency runs only).
- **The tall table's fixtures are the component's** (`components/tall-table/fixtures/`, its README the formats), but `cells.json`'s drawn cells come from here: `perf/cell-fixture.ts` picks rows from data/'s file with native DuckDB, jumps the contender's release build (`?measure&cells`, 2560 px wide so every column draws) to each, and fails unless each drawn value is DuckDB's. It keeps the hand-written `rounding` cases. Regenerate it after a change to the data file, the font, or the table's cell text, then rerun `cargo test -p seiza-tall-table`.
- **A stale NXDOMAIN:** a resolver that looked seiza.io up before it had records can keep the miss for the zone's negative TTL (30 min). `worker-check` and `data-read` take `--resolve-via 1.1.1.1`.

## Layout

```
apps/observatory/
  web/              # Vite host for the page, served under /observatory/
  contenders/       # contract.ts, data.ts, engine.ts (shared by the contenders); tall-table/gpui/ (crate/: package tall-table-gpui; web/: its Vite host, public/duckdb/ downloaded); tall-table/tanstack/web/ (src/data/: the data layer; test/: the fixtures in TS; public/duckdb/ downloaded)
  worker/           # Cloudflare Worker: src/index.ts (the data by range through the edge cache), wrangler.toml, scripts/ (stage.ts, check.ts)
  data/             # prep.ts + prep.sql (native DuckDB, its own lockfile), MANIFEST.json (committed); asteroids.parquet gitignored
  perf/             # harness.ts, cold.ts, placeholder.ts, reach.ts, sizes.ts, cell-fixture.ts (the GPUI contender), engine-files.ts (both), data-read.ts, budgets.json, baseline.json, results/
  spike/            # throwaway: the scaled-scroller page (fake rows, no DuckDB; src/scaled.ts is the scroll model's reference), run.ts, latency.ts (input latency and frame work, on it and on Tycho), sizes.ts; its own lockfile; deleted once the contenders replace it
  docs/             # DECISIONS.md, LESSONS.md, milestones.md, dom-scroll-model.md (the TanStack contender's scroll model), contender-contract.md (what each contender publishes, how each metric is read)
  README.md         # for visitors
  CLAUDE.md         # this file
  PLAN.md           # what's next
  justfile          # loaded from the root as the `observatory` module
```

## Commands

```
just observatory dev           # the page's Vite dev server, with COOP/COEP
just observatory gpui-dev      # the GPUI contender: debug wasm + Vite dev server at /observatory/, with the data file by range
just observatory gpui-build    # its release build: wasm alone (-p) + wasm-opt, Vite build, asset sizes
just observatory gpui-preview  # serve that build (brotli), with the data file
just observatory tanstack-dev  # the TanStack contender's Vite dev server at /observatory/, with the data file by range
just observatory tanstack-build # its release build (Arrow or DuckDB's JS in a first-paint chunk fails it), asset sizes
just observatory tanstack-preview # serve that build (brotli), with the data file
just observatory engine-files [flags] # both builds' duckdb/ byte-identical, both pages loading it from /observatory/duckdb/, the TanStack page's JS after first paint, the engine chunk shared or not (--controls, --label)
just observatory check         # lint + gpui-build + tanstack-build + sizes --check + cold --check (reference TTFP and wasm against perf/baseline.json) + placeholder + reach + engine-files --controls + fixtures
just observatory cold [flags]  # its cold load, reference + throttled, median of 10 → perf/results/ (--label, --runs, --reference-only, --write-baseline)
just observatory placeholder [flags] # its placeholder shell against its first frame, light and dark, DPR 2 and 1 (--controls, --label)
just observatory reach [flags] # opens the file, End reaches the last row (= count(*)), the contract (marks, state and targets with ?measure, replay, relay) (--label)
just observatory fixtures      # the tall table's fixtures (components/tall-table/fixtures/): their native tests and controls, the TanStack contender's TS run of them, and cell-fixture --check (run gpui-build first)
just observatory cell-fixture [--check] # cells.json's drawn cells from the GPUI contender's build: values picked by native DuckDB, budgets and text as drawn (--check compares with the committed file)
just observatory sizes [flags] # its wasm with and without seiza's panel, and the panel-leak check with its controls (--check: Cargo's view and the shipped wasm only; --label)
just observatory data          # data/asteroids.parquet + data/MANIFEST.json from Tycho's pinned sample (`just tycho data` first)
just observatory deploy [flags] # stage worker/dist/, `wrangler deploy` with DATA_SHA256, then worker-check (retries for a minute); needs `wrangler login`
just observatory worker-check [flags] # production: ranged HEAD and bytes=0-0 → 206, closed ranges byte-exact on the wire, no Content-Encoding, headers, SHA-256 (--url, --resolve-via)
just observatory data-read [flags] # DuckDB-Wasm reading the data in production next to Tycho's R2 path: register, first page, 90% page, bytes, count, digest → perf/results/ (--runs, --label, --resolve-via; needs `just tycho build`)
just observatory spike [flags] # the scroll spike in Chromium, Firefox, WebKit → perf/results/ (--only caps,reach,continuity,bar,tanstack,latency,work, --runs, --label, --browsers, --anchors, --sessions, --count); latency and work also drive Tycho's release build (`just tycho build` first)
just observatory spike-sizes   # the spike's JS against React alone, brotli → perf/results/
just observatory report        # regenerate the docs' numbers from perf/budgets.json and perf/results/
just observatory lint          # check-terms, `report --check`, fmt, clippy (the GPUI contender, wasm32 and native), tsc (web, both contenders' hosts and the TanStack contender's tests, worker, perf, data, spike)
```
