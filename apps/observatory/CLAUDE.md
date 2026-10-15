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
- **Data:** `data/asteroids.parquet` (gitignored), built by `data/prep.ts` + `prep.sql` with native DuckDB from Tycho's asteroid sample, after checking that file against the SHA-256 in Tycho's `data/MANIFEST.json`: 11 of its columns, every row, Tycho's writer settings. `data/MANIFEST.json` (committed) holds its rows, bytes, SHA-256, and row groups. It must stay under 25 MiB (a static asset); `prep.ts` fails otherwise. Why these columns: `docs/DECISIONS.md`, "Data".
- **Hosting:** Worker `observatory` (`worker/`) on the apex **https://seiza.io**, a custom domain (`workers_dev = false`, `preview_urls = false`). Everything is a static asset; the script (`worker/src/index.ts`) runs first for `/observatory/data/*`, because static assets ignore `Range` (and for any path no asset matches, which it answers 404, each a billed request): it puts the file whole into the edge cache once per location, keyed by `DATA_SHA256` (the deploy passes it from `data/MANIFEST.json`), and answers each request with `cache.match`, which serves 206s. The data goes out `no-cache, no-transform` with no Content-Encoding; don't let anything compress it. `worker/scripts/stage.ts` builds `worker/dist/` (gitignored): the data file and `_headers`. Why: `docs/DECISIONS.md`, "Hosting". The zone's WAF rules cover it (their text in the gitignored root `docs/private/zone.md`). A new path outside `/observatory/` goes into the seiza.io rule before it deploys.

## Perf script gotchas

- **The production scripts route the page in.** `perf/data-read.ts` opens a page at each data file's own origin with Playwright routing every path but the data to Tycho's local release build (`?bench` exposes its bridge), so the reads are same-origin under COEP and both sides run one engine. The routes reach DuckDB's worker too. Run `just tycho build` first.
- **Native scrollers under Playwright** (`docs/dom-scroll-model.md`, "Scripting it"): drive them with raw `page.mouse.wheel` deltas, not `wheel()`; Firefox applies at most one page per wheel event, so no scripted fling crosses the table there; the harness's `fling()` ends with a catch-up event a native scroller clamps, so a DOM fling sends equal events; headless Chromium hides scrollbars (`--hide-scrollbars`) and headless Firefox has none with width, so a thumb drag needs `spike/input.ts`'s `openWithScrollbars` (Chromium, WebKit) or a headed Firefox with `ui.useOverlayScrollbars: 0`.
- **Input latency and frame work come from Chromium's trace** (`docs/contender-contract.md`, "Reading the metrics"), not the page's Event Timing observer (rounded to 8 ms, nothing under 16 ms, no wheel). GPUI on WebGL2 in Chromium: an init script deleting `Navigator.prototype.gpu` makes its `Auto` backend fall back (`spike/latency.ts`, `hideWebGpu`); check the backend from its first GPU call (`gpuBackend`, which then unhooks itself, so timing runs carry no GPU-call wrapper; `gpuiProbe` stays hooked and belongs to latency runs only).
- **A stale NXDOMAIN:** a resolver that looked seiza.io up before it had records can keep the miss for the zone's negative TTL (30 min). `worker-check` and `data-read` take `--resolve-via 1.1.1.1`.

## Layout

```
apps/observatory/
  web/              # Vite host for the page, served under /observatory/
  worker/           # Cloudflare Worker: src/index.ts (the data by range through the edge cache), wrangler.toml, scripts/ (stage.ts, check.ts)
  data/             # prep.ts + prep.sql (native DuckDB, its own lockfile), MANIFEST.json (committed); asteroids.parquet gitignored
  perf/             # data-read.ts, budgets.json, results/
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
just observatory data          # data/asteroids.parquet + data/MANIFEST.json from Tycho's pinned sample (`just tycho data` first)
just observatory deploy [flags] # stage worker/dist/, `wrangler deploy` with DATA_SHA256, then worker-check (retries for a minute); needs `wrangler login`
just observatory worker-check [flags] # production: ranged HEAD and bytes=0-0 → 206, closed ranges byte-exact on the wire, no Content-Encoding, headers, SHA-256 (--url, --resolve-via)
just observatory data-read [flags] # DuckDB-Wasm reading the data in production next to Tycho's R2 path: register, first page, 90% page, bytes, count, digest → perf/results/ (--runs, --label, --resolve-via; needs `just tycho build`)
just observatory spike [flags] # the scroll spike in Chromium, Firefox, WebKit → perf/results/ (--only caps,reach,continuity,bar,tanstack,latency,work, --runs, --label, --browsers, --anchors, --sessions, --count); latency and work also drive Tycho's release build (`just tycho build` first)
just observatory spike-sizes   # the spike's JS against React alone, brotli → perf/results/
just observatory report        # regenerate the docs' numbers from perf/budgets.json and perf/results/
just observatory lint          # check-terms, `report --check`, tsc (web, worker, perf, data, spike)
```
