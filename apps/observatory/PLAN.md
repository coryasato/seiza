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
| M5 | The observatory page, deployed (parts 0, A–C) | In progress: part 0 done 2026-10-19, part A next |
| M6 | Split mode | Not started |
| M7 | The benchmark button | Not started |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here (each done, and recorded in `docs/milestones.md`): `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C, with `shown_text` split out of the render loop for them, and `seiza-duckdb`'s `summary_queries` returning the queries `open_parquet` sends), `@seiza/duckdb` takes its extension directory as an option (done, M0 part A), and `seiza` gains a `panel` feature (on by default) while its title bar and theme toggle move to Tycho, with the Mac input bindings opt-in (M2 part A), and `seiza::targets` (publishing a control's bounds) moves there from Tycho, as do Tycho's first-draw probe and placeholder screenshot match to `shared-web/perf/` (M2 part B), and `cells.json` gains two hand-written `rounding` cases (M3 part A: fixture data only, no code). Each records its effect on Tycho.

---

## Active milestone

M5, the observatory page, deployed: its spec and checks are under "Next milestones" below, part 0 done, part A next. Restate part A's checks at the start of its session.

---

## Next milestones

The "done when" checks are drafts until their milestone becomes active.

### M5: The observatory page, deployed

React with shadcn on Base UI and Tailwind v4, every dependency pinned exactly.

**Part 0: how the web builds sit in the repo, explored before part A.** The apex will hold more than the observatory: a landing page at `/` now (deliberately basic: a title, a catchy line, and a link to the observatory; maybe Astro or another zero-JS build later), and other sections later. Options to weigh, each against first paint, caching, and the comparison protocol: one site app for the apex (a Vite multi-page build, base `/`, shared styles and components); the observatory's `web/` on its own with the landing page as a separate static build (simple, cached hard, no shared bundle); or a site directory of its own that the observatory's page joins. Fixed either way: the contenders are separate bare builds, never in any site bundle (root `CLAUDE.md`, "Comparison protocol"), and one Worker serves the apex. The choice is recorded in root `docs/DECISIONS.md` ("Repo structure") before part A, with what it changes: `web/`'s base, the observatory's rule 2, and `/` in the seiza.io WAF rule (`docs/private/zone.md`).
- [x] The options compared and one chosen, with the landing page's first paint and bytes estimated for each: a `site/` directory, `site/ui/` (the shell) now, the landing page and the apex Worker in `site/` when the landing page ships. Evidence: root `docs/DECISIONS.md`, "Repo structure" (2026-10-19, the apex site's builds: the options, the estimates, the URL map).
- [x] The site's theme decided: shadcn's Neutral with a sky primary and a blue chart ramp, IBM Plex Sans, one toggle for the apex that reaches into the contenders, and no UI shared with Tycho. Evidence: root `docs/DECISIONS.md`, "Comparison protocol" (2026-10-19, the theme and the toggle) and "Repo structure" (2026-10-19, the apex site and Tycho). The token file, as exported, is below (part A puts it in the site's directory).

**Part A: the shell.**
- [ ] `site/ui/` (`@seiza/site-ui`): the shell (navbar, theme toggle, footer), rendered to HTML at build time, its behaviors plain JS with React wrappers; documented where it's created (root `CLAUDE.md`'s layout and a `site/` section, its own README and CLAUDE.md); the prerender plugin moved from the TanStack contender to `shared-web/`.
- [ ] The URLs: the page prerendered per route (`/observatory/`, `/observatory/tall-table/`); the contenders' bases moved to `/observatory/contenders/tall-table/gpui/` and `…/tanstack/` (their perf scripts, `docs/contender-contract.md`, and the observatory's rule 2 follow), the engine still at `/observatory/duckdb/`; the font at `/fonts/`; the cold numbers unchanged (a `check` run).
- [ ] The page's own budgets in `perf/budgets.json` (first-paint JS, first paint from paint timing), gated by `check`; a contender's iframe created only after the page's first paint, and the metrics module loaded after it.
- [ ] Inside the shell, a collapsible nav listing components (one entry), `/observatory/tall-table`, one slot with the GPUI | TanStack toggle (disabled until the GPUI contender paints its first rows), a same-origin iframe per contender that a flip destroys and replaces, contenders reporting marks by `postMessage`, a URL parameter choosing which side loads first.
- [ ] The site's theme: the token file below in the site's directory, plus `--series-gpui` and `--series-tanstack` (`--chart-2`/`--chart-5` light, `--chart-1`/`--chart-3` dark); IBM Plex Sans; the navbar's theme toggle, its choice in one `localStorage` key, applied before first paint by an inline script in `<head>`; a lint check holding the site's shared grays within a tolerance of the contenders' generated `theme.css`.
- [ ] The contenders take the theme: `?theme=` applied before their first screen paints (the GPUI side's placeholder, the TanStack side's prerender), then `postMessage` live; `theme_css.rs` writes `:root[data-theme]` overrides and `color-scheme` beside the media query; the GPUI contender stops following the system on the page's theme; `docs/contender-contract.md` gains both; without the parameter each follows the system, and the cold numbers are unchanged (a `check` run of each).

<details><summary>The site's token file, as exported from shadcn's theme creator (2026-10-19)</summary>

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.5 0.134 242.749);
  --primary-foreground: oklch(0.977 0.013 236.62);
  --secondary: oklch(0.967 0.001 286.375);
  --secondary-foreground: oklch(0.21 0.006 285.885);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.809 0.105 251.813);
  --chart-2: oklch(0.623 0.214 259.815);
  --chart-3: oklch(0.546 0.245 262.881);
  --chart-4: oklch(0.488 0.243 264.376);
  --chart-5: oklch(0.424 0.199 265.638);
  --radius: 0.625rem;
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.588 0.158 241.966);
  --sidebar-primary-foreground: oklch(0.977 0.013 236.62);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.443 0.11 240.79);
  --primary-foreground: oklch(0.977 0.013 236.62);
  --secondary: oklch(0.274 0.006 286.033);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.809 0.105 251.813);
  --chart-2: oklch(0.623 0.214 259.815);
  --chart-3: oklch(0.546 0.245 262.881);
  --chart-4: oklch(0.488 0.243 264.376);
  --chart-5: oklch(0.424 0.199 265.638);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.685 0.169 237.323);
  --sidebar-primary-foreground: oklch(0.293 0.066 243.157);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
}
```

</details>

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
