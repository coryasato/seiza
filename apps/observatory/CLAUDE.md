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
- **Hosting:** Worker `observatory` (`worker/`) on the apex **https://seiza.io**, a custom domain (`workers_dev = false`, `preview_urls = false`). Everything is a static asset; the script (`worker/src/index.ts`) runs first for `/observatory/data/*`, because static assets ignore `Range` (and for any path no asset matches, which it answers 404, each a billed request): it puts the file whole into the edge cache once per location, keyed by `DATA_SHA256` (the deploy passes it from `data/MANIFEST.json`), and answers each request with `cache.match`, which serves 206s. The data goes out `no-cache, no-transform` with no Content-Encoding; don't let anything compress it. `worker/scripts/stage.ts` builds `worker/dist/` (gitignored): the data file and `_headers`. Why: `docs/DECISIONS.md`, "Hosting". The zone's WAF rules (Tycho's `docs/hosting.md`, "Abuse guards") don't cover seiza.io yet (`PLAN.md`, the WAF item above the active milestone).

## Perf script gotchas

- **The production scripts route the page in.** `perf/data-read.ts` opens a page at each data file's own origin with Playwright routing every path but the data to Tycho's local release build (`?bench` exposes its bridge), so the reads are same-origin under COEP and both sides run one engine. The routes reach DuckDB's worker too. Run `just tycho build` first.
- **A stale NXDOMAIN:** a resolver that looked seiza.io up before it had records can keep the miss for the zone's negative TTL (30 min). `worker-check` and `data-read` take `--resolve-via 1.1.1.1`.

## Layout

```
apps/observatory/
  web/              # Vite host for the page, served under /observatory/
  worker/           # Cloudflare Worker: src/index.ts (the data by range through the edge cache), wrangler.toml, scripts/ (stage.ts, check.ts)
  data/             # prep.ts + prep.sql (native DuckDB, its own lockfile), MANIFEST.json (committed); asteroids.parquet gitignored
  perf/             # data-read.ts, budgets.json, results/
  docs/             # DECISIONS.md, LESSONS.md, milestones.md
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
just observatory report        # regenerate the docs' numbers from perf/budgets.json and perf/results/
just observatory lint          # check-terms, `report --check`, tsc (web, worker, perf, data)
```
