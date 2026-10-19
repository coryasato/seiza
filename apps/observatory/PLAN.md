# PLAN.md — Observatory

What's next for the Observatory: milestone status, the active milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. The rules are the root `CLAUDE.md`'s, its "Comparison protocol" above all; this app's own are in its [`CLAUDE.md`](CLAUDE.md).

**Goal:** one page, at `seiza.io/observatory`, that runs each component against a DOM equivalent and shows with measured numbers what each costs over a session of use: opening data, scrolling, flinging, jumping. The first comparison is GPUI | TanStack: the tall table ([`components/tall-table/`](../../components/tall-table/), at `seiza.io/observatory/tall-table`) against React + TanStack Virtual, on the same engine and the same file.

**Deciding metrics:** per-use cost, as the root `CLAUDE.md`'s "Comparison protocol" defines it (time to first usable, time to data, input to visible response, behavior under load, reach and correctness, cost). One-time costs (first pixels, bundle size) are footnotes. TTFP still gates each contender's own build (root rule 1).

**Where everything else lives:** the decisions so far are repo-wide, in the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md) ("Comparison protocol", "Hosting", "Repo structure"). This app's own context and rules are in [`CLAUDE.md`](CLAUDE.md), its decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | Groundwork: the app, its data file, and static hosting (parts A–B) | Done 2026-10-14 ([`docs/milestones.md`](docs/milestones.md)) |
| M1 | Spikes: the DOM scroll model and the input-latency method (parts A–B) | Done 2026-10-15 ([`docs/milestones.md`](docs/milestones.md)) |
| M2 | The GPUI contender and the fixtures (parts A–C) | Done 2026-10-17 ([`docs/milestones.md`](docs/milestones.md)) |
| M3 | The TanStack contender (parts A–D) | Done 2026-10-18 ([`docs/milestones.md`](docs/milestones.md)) |
| M4 | The numbers: cold runs of both contenders (parts A–B) | Done 2026-10-18 ([`docs/milestones.md`](docs/milestones.md)) |
| M5 | The observatory page, deployed (parts 0, A–C) | In progress: parts 0 and A done 2026-10-19, part B next |
| M6 | Split mode | Not started |
| M7 | The benchmark button | Not started |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here (each done, and recorded in `docs/milestones.md`): `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C, with `shown_text` split out of the render loop for them, and `seiza-duckdb`'s `summary_queries` returning the queries `open_parquet` sends), `@seiza/duckdb` takes its extension directory as an option (done, M0 part A), and `seiza` gains a `panel` feature (on by default) while its title bar and theme toggle move to Tycho, with the Mac input bindings opt-in (M2 part A), and `seiza::targets` (publishing a control's bounds) moves there from Tycho, as do Tycho's first-draw probe and placeholder screenshot match to `shared-web/perf/` (M2 part B), and `cells.json` gains two hand-written `rounding` cases (M3 part A: fixture data only, no code). Each records its effect on Tycho.

---

## Active milestone

M5, the observatory page, deployed: its spec and checks are under "Next milestones" below, parts 0 and A done, part B next. Restate part B's checks at the start of its session.

---

## Next milestones

The "done when" checks are drafts until their milestone becomes active.

### M5: The observatory page, deployed

React with shadcn on Base UI and Tailwind v4, every dependency pinned exactly.

**Part 0: how the web builds sit in the repo, explored before part A.** The apex will hold more than the observatory: a landing page at `/` now (deliberately basic: a title, a catchy line, and a link to the observatory; maybe Astro or another zero-JS build later), and other sections later. Options to weigh, each against first paint, caching, and the comparison protocol: one site app for the apex (a Vite multi-page build, base `/`, shared styles and components); the observatory's `web/` on its own with the landing page as a separate static build (simple, cached hard, no shared bundle); or a site directory of its own that the observatory's page joins. Fixed either way: the contenders are separate bare builds, never in any site bundle (root `CLAUDE.md`, "Comparison protocol"), and one Worker serves the apex. The choice is recorded in root `docs/DECISIONS.md` ("Repo structure") before part A, with what it changes: `web/`'s base, the observatory's rule 2, and `/` in the seiza.io WAF rule (`docs/private/zone.md`).
- [x] The options compared and one chosen, with the landing page's first paint and bytes estimated for each: a `site/` directory, `site/ui/` (the shell) now, the landing page and the apex Worker in `site/` when the landing page ships. Evidence: root `docs/DECISIONS.md`, "Repo structure" (2026-10-19, the apex site's builds: the options, the estimates, the URL map).
- [x] The site's theme decided: shadcn's Neutral with a sky primary and a blue chart ramp, IBM Plex Sans, one toggle for the apex that reaches into the contenders, and no UI shared with Tycho. Evidence: root `docs/DECISIONS.md`, "Comparison protocol" (2026-10-19, the theme and the toggle) and "Repo structure" (2026-10-19, the apex site and Tycho). The token file, as exported, is in `site/ui/src/tokens.css` (part A).

**Part A: the shell.**
- [x] `site/ui/` (`@seiza/site-ui`): the shell (navbar, theme toggle, footer), rendered to HTML at build time, its behaviors plain JS with React wrappers; documented where it's created (root `CLAUDE.md`'s layout and a `site/` section, its own README and CLAUDE.md); the prerender plugin moved from the TanStack contender to `shared-web/`. Evidence: `site/ui/src/` (`SiteShell`, `Navbar` + `ThemeToggle`, `Footer`; `theme.ts` the toggle's plain JS, bound by `ThemeToggle`'s effect or `bindShell`; shadcn's `Button`, `ToggleGroup`, `Collapsible` on Base UI 1.8.0, Tailwind 4.3.3, every dependency pinned exactly); both routes' `web/dist/**/index.html` hold the shell's markup before any JS; root `CLAUDE.md`, "The apex site" and the layout; `site/ui/README.md`, `CLAUDE.md`; `shared-web/src/prerender.ts`, used by the TanStack contender's config and the page's (`tanstack-contract`: its first screen still hydrated in place, PASS).
- [x] The URLs: the page prerendered per route (`/observatory/`, `/observatory/tall-table/`); the contenders' bases moved to `/observatory/contenders/tall-table/gpui/` and `…/tanstack/` (their perf scripts, `docs/contender-contract.md`, and the observatory's rule 2 follow), the engine still at `/observatory/duckdb/`; the font at `/fonts/`; the cold numbers unchanged (a `check` run). Evidence: `contenders/paths.ts` (every path); `web/dist/index.html`, `web/dist/tall-table/index.html`; the engine's bundles referenced at `/observatory/duckdb/` (`renderBuiltUrl`), its extensions through `@seiza/duckdb`'s new `extensionBase`; `engine-files --controls`: both builds' `duckdb/` byte-identical, every engine request under `/observatory/duckdb/`, PASS. `check` (2026-10-19, every step PASS): GPUI reference TTFP 165.4 ms (baseline 170.5, limit 187.6), wasm 2696.6 KiB (2695.4); TanStack first-paint JS 72.3 KiB (72.1; +0.2 for the theme's listener and the paths), data layer 34.7 KiB (34.7); placeholder, reach, tanstack-view, tanstack-contract, tanstack-parity, and the fixtures PASS. Tycho's side: `apps/tycho/perf/results/2026-10-19-observatory-m5-a.md` (+42 B brotli before first paint).
- [x] The page's own budgets in `perf/budgets.json` (first-paint JS, first paint from paint timing), gated by `check`; a contender's iframe created only after the page's first paint, and the metrics module loaded after it. Evidence: `limits.page` (+20% first paint, +10% first-paint JS; why: `docs/DECISIONS.md`, "Page") and the metrics `page-first-paint`, `page-first-paint-throttled`, `page-first-paint-js` (table above); `perf/page.ts` (`just observatory page`, in `check`): baseline 70.8 ms reference (60.6–82), 437.4 ms throttled, 78.2 KiB first-paint JS (`perf/results/2026-10-19-m5-a-page.json`); `check`'s run 75.2 ms, PASS. Every run checks that nothing but the HTML, CSS, entry, and font is requested before first paint, that the frame is created after it (~10–20 ms after, reference) and the metrics chunk requested after it; the manifest keeps the metrics module out of the first-paint JS.
- [x] Inside the shell, a collapsible nav listing components (one entry), `/observatory/tall-table`, one slot with the GPUI | TanStack toggle (disabled until the GPUI contender paints its first rows), a same-origin iframe per contender that a flip destroys and replaces, contenders reporting marks by `postMessage`, a URL parameter choosing which side loads first. Evidence: `web/src/nav.ts`, `slot.ts`; `perf/page.ts`'s hosting checks, PASS: the toggle disabled until GPUI's relayed `contender:filled`, then enabled; a flip disconnects the GPUI frame, creates TanStack's, and disables the toggle until TanStack fills (the rule holds for whichever side is shown: `docs/DECISIONS.md`, "Page"); `?side=tanstack` (written by the flip) loads TanStack first after a reload; with the data file missing, each side marks `contender:failed` and the toggle unlocks; `…/tall-table/index.html` hydrates as its route; the overview lists the tall table and has no frame.
- [x] The site's theme: the token file in the site's directory, plus `--series-gpui` and `--series-tanstack` (`--chart-2`/`--chart-5` light, `--chart-1`/`--chart-3` dark); IBM Plex Sans; the navbar's theme toggle, its choice in one `localStorage` key, applied before first paint by an inline script in `<head>`; a lint check holding the site's shared grays within a tolerance of the contenders' generated `theme.css`. Evidence: `site/ui/src/tokens.css` (the export, verbatim, and the two series), `site.css` (IBM Plex Sans at `/fonts/`), `theme.ts` (`seiza-theme`; `THEME_SCRIPT` first in each route's `<head>`); `perf/page.ts`: the toggle flips the page's `.dark` and the choice survives a reload, PASS; `web/scripts/grays.ts` in `lint`: background, foreground, muted foreground, border, ring within ΔE 2.5 in both modes (worst: dark border 1.44), the popover reported apart by design (dark ΔE 6.0), its control (0.03 lighter) failing at 3.05.
- [x] The contenders take the theme: `?theme=` applied before their first screen paints (the GPUI side's placeholder, the TanStack side's prerender), then `postMessage` live; `theme_css.rs` writes `:root[data-theme]` overrides and `color-scheme` beside the media query; the GPUI contender stops following the system on the page's theme; `docs/contender-contract.md` gains both; without the parameter each follows the system, and the cold numbers are unchanged (a `check` run of each). Evidence: `contenders/contract.ts` (`THEME_SCRIPT`, first in each contender's `<head>` by `contenderBuild`; `followPageTheme`); `shared-web`'s placeholder and the GPUI host's body follow `data-theme`; `theme.css` regenerated (`theme-css --check` in `lint`); `contract.rs` `apply_theme` / `setTheme` (`stop_following_system_appearance`, then `Theme::change`); `docs/contender-contract.md`, "Where a contender lives" and "Theme". `perf/page.ts`, PASS: a toggle while the frame's HTML is held back reaches it at its load (control without the re-send: fails); the page's toggle reaches GPUI's frame (`data-theme` set, its canvas's brightness 244 → 22, the same frame: `timeOrigin` unchanged) and TanStack's (`data-theme`, its body `rgb(255, 255, 255)` in light). Without the parameter the cold numbers held: `check` as above (TTFP 165.4 ms; the placeholder's light and dark matches PASS).

**Part B: the readouts.**
- [ ] Passive readouts from M4's metrics module at ~4 Hz, the second contender's labelled warm, beside M4's cold numbers.

**Part C: the deploy.**
- [ ] The Worker serves the page (one HTML file per route), the contenders at their bases, and the engine as static assets (precompressed brotli, COOP/COEP/CORP), and the data file by range through the edge cache (as it does today), at `seiza.io/observatory`; the zone's WAF rules cover its paths; a production check passes.

### M6: Split mode

- [ ] A toggle mounts both contenders side by side with a draggable divider, labelled "not measured: both running"; each half scrolls sideways inside itself; memory with both running recorded.

### M7: The benchmark button

- [ ] "Run benchmark" plays load, fling, and jump to 90% on each side in turn, alternating which goes first between runs, driving each through its own input path (script-made wheel events reach GPUI's listeners but never scroll a native scroller, so the DOM side is driven through its scroll position), and shows the results labelled warm beside the cold ones.

---

## Measurements

Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json) and the newest matching file in `perf/results/`; don't edit between the markers. A metric's history is its dated results files.

<!-- report:plan:start -->
| Metric | Budget | Gate | Local | Production | From |
|---|---|---|---|---|---|
| GPUI contender: time to first paint | ≤ 187.6 ms (baseline 170.5 + 10%) | `check` | 170.5 ms | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
| GPUI contender: time to first paint, throttled | — | recorded | 3502.5 ms | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
| GPUI contender: wasm (brotli) | ≤ 3099.7 KiB (baseline 2695.4 + 15%) | `check` | 2695.4 KiB | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
| TanStack contender: first-paint JS (brotli) | ≤ 79.3 KiB (baseline 72.1 + 10%) | `check` | 72.2 KiB | — | [2026-10-18-m4-b-tanstack-sizes](perf/results/2026-10-18-m4-b-tanstack-sizes.json) |
| TanStack contender: data layer and Arrow, after first paint (brotli) | ≤ 38.2 KiB (baseline 34.7 + 10%) | `check` | 34.7 KiB | — | [2026-10-18-m4-b-tanstack-sizes](perf/results/2026-10-18-m4-b-tanstack-sizes.json) |
| Page: first paint (paint timing), /observatory/tall-table/ | ≤ 85 ms (baseline 70.8 + 20%) | `check` | 70.8 ms | — | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json) |
| Page: first paint (paint timing), throttled | — | recorded | 437.4 ms | — | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json) |
| Page: first-paint JS (brotli) | ≤ 86 KiB (baseline 78.2 + 10%) | `check` | 78.2 KiB | — | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json) |
<!-- report:plan:end -->

---

## Long-term goals

Not milestones. Each starts with research.

- **A third contender: Glide Data Grid** (GPUI | TanStack / Glide): a DOM-hosted canvas grid, which would separate "canvas vs DOM" from "Wasm vs JS". Another contender app against the same GPUI side, under the same protocol. It may never happen.
- **A dataset easier to read at a glance** than a sea of floats, within the static-asset budget.
- **Feature levels:** when a table feature (sorting, …) exists in the component and is worth comparing, a level adds it on both sides (root `CLAUDE.md`, "Comparison protocol"), each feature's cost measured against the base.
- **Dropping your own file:** out of the base level. It would widen the cell fixtures to every column kind (decimals, timestamps, 128-bit integers).

---

## Open questions

- **The DOM's fling, read from its compositor.** The fling's late frames and lag are main-thread readings on both sides (`underLoad`), which on GPUI are the presented frames but on the DOM aren't: its compositor scrolls on through a late main-thread frame. The README says so. Whether the DOM side should also report what its compositor presented (`cc`'s frames and `Scroll Delta This Frame`, as the wheel's guard reads them) beside it, and which reading the page headlines, is a protocol change for root `docs/DECISIONS.md`.
- **A short page's missing cells.** The tall table draws a value past a page's end as `NULL` (`render_body`'s `unwrap_or(CellValue::Null)`); the TanStack contender draws it empty. A static file never answers short, so nothing measured differs; whether the component should draw it empty too is the component's call (Tycho drives it).

- **The pause switch.** The observatory's data never reaches R2, but every data read now runs its Worker (static assets can't serve ranges), so each is a billed request. Whether it honours the switch for them is decided at the deploy (M5), with the WAF rules' widening to seiza.io's paths.
- **The landing page.** The observatory's Worker holds the apex `seiza.io` (everything outside `/observatory/` a 404). The page is basic (a title, a catchy line, a link to the observatory), built in `site/landing/` on `site/ui/`'s shell (root `docs/DECISIONS.md`, "Repo structure"); when it ships is open. Shipping it moves the Worker to `site/worker/` and adds `/`, `/index.html`, `/assets/`, and `/fonts/` to the seiza.io WAF rule.
