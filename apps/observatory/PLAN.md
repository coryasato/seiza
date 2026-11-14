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
| M5 | The observatory page (parts 0, A, A1–A2, B, C, D1–D4) | Done 2026-10-21 ([`docs/milestones.md`](docs/milestones.md)) |
| M6 | The deploy | Done 2026-10-21 ([`docs/milestones.md`](docs/milestones.md)) |
| M7 | `trim-paths`: no home paths in the shipped wasm; the asteroids credited; redeployed | Done 2026-11-01 ([`docs/milestones.md`](docs/milestones.md)) |
| M8 | The scenarios on the page: the design (a design session, no code) | Done 2026-11-02 ([`docs/milestones.md`](docs/milestones.md)) |
| M9 | Scenario: wide sheet (parts A1–E4) | Done 2026-11-04 ([`docs/milestones.md`](docs/milestones.md)) |
| M10 | Scenario: market watch (parts A1–F) | Done 2026-11-06 ([`docs/milestones.md`](docs/milestones.md)) |
| M11 | Scenario: live tail (parts A1–A2, B1–B2, C1–C2, D1–D2, E, E2, F) | Done 2026-11-09 ([`docs/milestones.md`](docs/milestones.md)) |
| M12 | Scenario: admin table (the control) (parts A1–A3, B1–B2, C1–C2, D–E) | Done 2026-11-10 ([`docs/milestones.md`](docs/milestones.md)) |
| M13 | Scenario: monitoring wall (parts A1–A3, B1–B2, C1–C2, D1–D2, E, F) | Done 2026-11-11 ([`docs/milestones.md`](docs/milestones.md)) |
| M14 | The wide sheet's later steps: a resize drag, a range copied (parts A1–A2, B, C1–C2, D1–D2, E1–E2, F) | Done 2026-11-14 ([`docs/milestones.md`](docs/milestones.md)) |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them ([`CLAUDE.md`](CLAUDE.md), rule 1). What it has asked of each is recorded with the milestone that asked, in [`docs/milestones.md`](docs/milestones.md).

**Waiting on** (features of a component or engine the observatory needs; only that crate's `PLAN.md` builds them, and the session that closes one flips its row here to *Ready*): nothing. Every feature the six scenarios asked for is built and adopted.

---

## Active milestone

None: M14 closed 2026-11-14 (its spec and evidence in [`docs/milestones.md`](docs/milestones.md)).

---

## Next milestones

None planned: the six scenarios the research laid out are built, measured, and live. A new milestone starts from a long-term goal or an open question below.

**A new scenario milestone** (decided 2026-10-30, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios"), each item a "done when" check of its own:
- **Its builds:** each contender builds once per feature level (Cargo features are compile-time, and the same scope keeps a level's code out of every other's bundle), at a base of its own under the contender's (`contenders/paths.ts`), staged and served beside the others, with its TTFP and wasm (or first-paint JS) budgets in `perf/budgets.json`, gated by `check` (root rule 1). A scenario on a level that exists shares its build (the admin table the base's; the monitoring wall has a level of its own, `wall`, since it needs `density`, which market watch's lacks).
- **Its data credited:** the credit on the page and in the README, the license in `MANIFEST.json`; a synthetic feed is labelled synthetic on the page.
- **Its runs:** `check` gates its builds' budgets and runs its smoke, fixtures, and contract checks, never the full protocol. The full cold protocol (its stops × both sides × both devices × 10 runs, and its soaks) runs once, in its numbers part, on the final build (a long run: ask about a code review first); its part A estimates that time before fixing the stops. Its results files are labelled with its name, so it re-runs without the others.
- **Its versions:** each results file records what it was measured with (gpui-kit, React, TanStack Virtual, Arrow, DuckDB-Wasm, Chromium), and the scenario's explainer shows them ("measured with …"). A bump of any of them re-measures the scenarios it touches or labels their numbers with the versions they came from, decided per bump.

---

## Measurements

Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json) and the newest matching file in `perf/results/`; don't edit between the markers. A metric's history is its dated results files.

<!-- report:plan:start -->
| Metric | Budget | Gate | Local | Production | From |
|---|---|---|---|---|---|
| GPUI contender: time to first paint | ≤ 187.6 ms (baseline 170.5 + 10%) | `check` | 170.5 ms | 329.5 ms | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json), [2026-10-21-gpui-cold-production](perf/results/2026-10-21-gpui-cold-production.json) |
| GPUI contender: time to first paint, throttled | — | recorded | 3502.5 ms | 3550.5 ms | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json), [2026-10-21-gpui-cold-production](perf/results/2026-10-21-gpui-cold-production.json) |
| GPUI contender: wasm (brotli) | ≤ 3113.3 KiB (baseline 2707.2 + 15%) | `check` | 2695.4 KiB | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
| GPUI contender at the wide level: time to first paint | ≤ 168.7 ms (baseline 153.4 + 10%) | `check` | 153.4 ms | — | [2026-11-12-gpui-cold-wide](perf/results/2026-11-12-gpui-cold-wide.json) |
| GPUI contender at the wide level: time to first paint, throttled | — | recorded | 3621.1 ms | — | [2026-11-12-gpui-cold-wide](perf/results/2026-11-12-gpui-cold-wide.json) |
| GPUI contender at the wide level: wasm (brotli) | ≤ 3219.4 KiB (baseline 2799.5 + 15%) | `check` | 2799.5 KiB | — | [2026-11-12-gpui-cold-wide](perf/results/2026-11-12-gpui-cold-wide.json) |
| GPUI contender at the market level: time to first paint | ≤ 195.8 ms (baseline 178 + 10%) | `check` | 178 ms | — | [2026-11-05-gpui-cold-market](perf/results/2026-11-05-gpui-cold-market.json) |
| GPUI contender at the market level: time to first paint, throttled | — | recorded | 3610.4 ms | — | [2026-11-05-gpui-cold-market](perf/results/2026-11-05-gpui-cold-market.json) |
| GPUI contender at the market level: wasm (brotli) | ≤ 3209.2 KiB (baseline 2790.6 + 15%) | `check` | 2790.6 KiB | — | [2026-11-05-gpui-cold-market](perf/results/2026-11-05-gpui-cold-market.json) |
| GPUI contender at the tail level: time to first paint | ≤ 189 ms (baseline 171.8 + 10%) | `check` | 171.8 ms | — | [2026-11-07-gpui-cold-tail](perf/results/2026-11-07-gpui-cold-tail.json) |
| GPUI contender at the tail level: time to first paint, throttled | — | recorded | 3595.2 ms | — | [2026-11-07-gpui-cold-tail](perf/results/2026-11-07-gpui-cold-tail.json) |
| GPUI contender at the tail level: wasm (brotli) | ≤ 3208.7 KiB (baseline 2790.2 + 15%) | `check` | 2790.2 KiB | — | [2026-11-07-gpui-cold-tail](perf/results/2026-11-07-gpui-cold-tail.json) |
| GPUI contender at the wall level: time to first paint | ≤ 176.6 ms (baseline 160.5 + 10%) | `check` | 160.5 ms | — | [2026-11-10-gpui-cold-wall](perf/results/2026-11-10-gpui-cold-wall.json) |
| GPUI contender at the wall level: time to first paint, throttled | — | recorded | 3633.9 ms | — | [2026-11-10-gpui-cold-wall](perf/results/2026-11-10-gpui-cold-wall.json) |
| GPUI contender at the wall level: wasm (brotli) | ≤ 3218.6 KiB (baseline 2798.8 + 15%) | `check` | 2798.8 KiB | — | [2026-11-10-gpui-cold-wall](perf/results/2026-11-10-gpui-cold-wall.json) |
| TanStack contender: first-paint JS (brotli) | ≤ 79.3 KiB (baseline 72.1 + 10%) | `check` | 73.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes](perf/results/2026-11-09-m12-b1-tanstack-sizes.json) |
| TanStack contender at the wide level: first-paint JS (brotli) | ≤ 90.6 KiB (baseline 82.4 + 10%) | `check` | 82.4 KiB | — | [2026-11-12-m14-c2-tanstack-sizes-wide](perf/results/2026-11-12-m14-c2-tanstack-sizes-wide.json) |
| TanStack contender at the market level: first-paint JS (brotli) | ≤ 83.1 KiB (baseline 75.5 + 10%) | `check` | 75.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-market](perf/results/2026-11-09-m12-b1-tanstack-sizes-market.json) |
| TanStack contender at the tail level: first-paint JS (brotli) | ≤ 84.2 KiB (baseline 76.5 + 10%) | `check` | 76.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-tail](perf/results/2026-11-09-m12-b1-tanstack-sizes-tail.json) |
| TanStack contender at the wall level: first-paint JS (brotli) | ≤ 84.6 KiB (baseline 76.9 + 10%) | `check` | 76.9 KiB | — | [2026-11-10-m13-c1-tanstack-sizes-wall](perf/results/2026-11-10-m13-c1-tanstack-sizes-wall.json) |
| TanStack contender: data layer and Arrow, after first paint (brotli) | ≤ 38.2 KiB (baseline 34.7 + 10%) | `check` | 34.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes](perf/results/2026-11-09-m12-b1-tanstack-sizes.json) |
| TanStack contender at the wide level: data layer and Arrow, after first paint (brotli) | ≤ 43.1 KiB (baseline 39.2 + 10%) | `check` | 39.2 KiB | — | [2026-11-12-m14-c2-tanstack-sizes-wide](perf/results/2026-11-12-m14-c2-tanstack-sizes-wide.json) |
| TanStack contender at the market level: data layer and Arrow, after first paint (brotli) | ≤ 44.8 KiB (baseline 40.7 + 10%) | `check` | 40.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-market](perf/results/2026-11-09-m12-b1-tanstack-sizes-market.json) |
| TanStack contender at the tail level: data layer and Arrow, after first paint (brotli) | ≤ 42.6 KiB (baseline 38.7 + 10%) | `check` | 39.2 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-tail](perf/results/2026-11-09-m12-b1-tanstack-sizes-tail.json) |
| TanStack contender at the wall level: data layer and Arrow, after first paint (brotli) | ≤ 47.7 KiB (baseline 43.4 + 10%) | `check` | 43.4 KiB | — | [2026-11-10-m13-c1-tanstack-sizes-wall](perf/results/2026-11-10-m13-c1-tanstack-sizes-wall.json) |
| Page: first paint (paint timing), /observatory/tall-table/big-file/ | ≤ 72.5 ms (baseline 60.4 + 20%) | `check` | 60.4 ms | 210.2 ms | [2026-11-10-m12-d-page](perf/results/2026-11-10-m12-d-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first paint (paint timing), throttled | — | recorded | 439.3 ms | 474.7 ms | [2026-11-10-m12-d-page](perf/results/2026-11-10-m12-d-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first-paint JS (brotli) | ≤ 95.5 KiB (baseline 86.8 + 10%) | `check` | 86.8 KiB | — | [2026-11-10-m12-d-page](perf/results/2026-11-10-m12-d-page.json) |
| Requests in the busiest 10 s, one visitor (the zone's rate limit counts per IP) | — | recorded | 142 requests | — | [2026-11-14-m14-f-burst](perf/results/2026-11-14-m14-f-burst.json) |
<!-- report:plan:end -->

---

## Long-term goals

Not milestones. Each starts with research.

- **The landing page.** The observatory's Worker holds the apex `seiza.io` (everything outside `/observatory/` a 404). The page is basic (a title, a catchy line, a link to the observatory), built in `site/landing/` on `site/ui/`'s shell (root `docs/DECISIONS.md`, "Repo structure"); when it ships is open. Shipping it moves the Worker to `site/worker/` and adds `/`, `/index.html`, and `/assets/` to the seiza.io WAF rule (`/fonts/` is in it already).
- **Remove the benchmark button** (decided 2026-11-14, built in a session of its own): the goal is dropped, but the page still draws the button, disabled. Its case was a sweep of a scenario's stops on each side, drawing where each stops keeping up, and the Compare panel's "Where each side keeps up" already draws that from cold runs; an in-tab run would only add warm numbers that could read as contradicting them, and the dials and the status bar's live readings already give a visitor something to play with. The session:
  - `web/src/numbers.ts`: the status bar's disabled "Run benchmark" (`later(…, 'The benchmark')`) and the phone overflow's "Run benchmark: coming soon" go. `Play` stays imported: live tail's follow toggle uses it.
  - `perf/page.ts` names neither, but its checks of the status bar's boxes and the phone's overflow run on the change: `just observatory page --check`.
  - `web/src/numbers.ts`'s header comment and `web/CLAUDE.md`'s page description ("Run benchmark disabled until it's built") lose it.
  - The replay hooks stay (`__contender.replay`: `perf/burst.ts` and the contract checks drive them); only the comments that call them the benchmark's change (`docs/contender-contract.md`, "Replay hooks"; `perf/burst.ts`'s header).
  - A decision in `docs/DECISIONS.md`, "Page", superseding 2026-10-23's ("deferred to a long-term goal; it stays in the status bar, disabled").
  - The design canvas loses the button, light and dark, desktop and phone.
  - A code change: it goes through `/code-review`.

---

## Known bugs

Found and not yet fixed; each gets a session of its own (a fix in the part that owns the code, or a part of its own).

None open.

## Open questions

- **Big file's fling, re-measured as the later scenarios read theirs.** Two gaps in the base level's numbers (last run 2026-10-19), settled by one measuring session:
  - **Its input.** A bare `mouse.wheel` reaches a native scroller's compositor every other frame in headless Chromium (`perf/results/2026-11-02-m9-a2.md`), and the base level's TanStack fling and Smooth were read through it; the scenarios use Chromium's gesture scroll (`docs/DECISIONS.md`, "Measurement"). Whether to re-measure them on the gesture, and say so on the page meanwhile, is open; so is whether a real trackpad in a headed Chromium matches the gesture's rate. One of these numbers is the root README's headline (the fling's per-frame work).
  - **The DOM's compositor.** The fling's late frames and lag are main-thread readings on both sides (`underLoad`), which on GPUI are the presented frames but on the DOM aren't: its compositor scrolls on through a late main-thread frame (the README says so). The admin table's Smooth already reads TanStack's compositor frames (`compositorScrolls`); whether Big file's fling reports them too (`cc`'s frames and `Scroll Delta This Frame`) beside the main-thread reading, and which the page headlines, is a protocol change for root `docs/DECISIONS.md`.
- **GPUI's lost mark offsets upstream.** gpui-pre-wgpu 0.3.11 drops cosmic-text's `x_offset` and `y_offset` (`perf/results/2026-11-09-m12-a2.md`), and 0.3.12 (gpui-kit 0.9.1) still does: its `cosmic_text_system.rs` is byte-identical. The user files the issue upstream; whether a fix lands, and the admin table's shaping verdicts (Arabic, Khmer, Sinhala) are read again on it, is open.
