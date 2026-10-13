# PLAN.md — Observatory

What's next for the Observatory: milestone status, the next milestone's "done when" checks, long-term goals, and open questions. Only what's still open lives here. The rules are the root `CLAUDE.md`'s, its "Comparison protocol" above all; this app gets its own `CLAUDE.md` with its first code.

**Goal:** one site, at `seiza.io/observatory`, that puts each component's base level, in a minimal GPUI host, next to a 1:1 React equivalent (same engine, same data, same paging numbers) and shows with measured numbers where each side wins. The first component is the table, coming out of Tycho ([`../tycho/PLAN.md`](../tycho/PLAN.md), M9).

**Deciding metrics:** first pixels, first usable UI, and first rows painted, per side (root `CLAUDE.md`, "Comparison protocol"); TTFP as the protocol defines it for the GPUI side.

**Where everything else lives:** the decisions so far are repo-wide, in the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md) ("Repo structure", "Comparison protocol", "Hosting"). `docs/`, `perf/budgets.json`, and `perf/results/` come with the first milestone, from [`docs/templates/app/`](../../docs/templates/app/).

---

## Status

| Milestone | Title | Status |
|---|---|---|
| M0 | Table, base level: GPUI vs React research | Not started; starts when Tycho's M9 closes |
| M1 | The comparison site | Not started; only if M0 says build it |

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

---

## Active milestone

None until Tycho's M9 closes: the GPUI contender needs the table component and the DuckDB engine it extracts.

### Next: M0: Table, base level: GPUI vs React research

Build both contenders for the table's base level as prototypes, measure them through the shared harness (`shared-web/perf/`, from Tycho's M9), and decide whether the site is worth building. The base level is what the component does with no features on: open a sample, scroll, fling, jump by scrollbar. Nothing from Tycho's app (drops, CSV, jump to row).

- **`contenders/table/gpui/`:** a minimal GPUI host (cdylib) of `seiza-table` with `seiza-duckdb`'s `table` adapter: the samples' buttons and the table. `seiza` gets `shell` and `panel` features (on by default; the contender turns them off), and the bytes they save are recorded. Built with `-p` alone, and a size check guards it against features leaking in through Cargo's unification.
- **`contenders/table/react/`:** React + TanStack Virtual over a DOM grid, on `@seiza/duckdb`, the same SQL, and the table's paging numbers. Its first screen prerendered to static HTML.
- **The paging fixture:** a JSON scenario (scroll and jump steps → expected page requests) that a native test runs against `seiza-table`'s page cache and a TS test against the React cache.
- **The three metrics** (first pixels, first usable UI, first rows painted), marked on both sides and each checked its own way (GPU calls; Element Timing plus a presented frame).

**Done when:**
- [ ] Both contenders open both samples (1.57 M and 25.1 M rows) and reach the last row. Where the React grid can't (browsers cap element height at roughly 33 M px in Chrome and under 18 M px in Firefox, below 25 M rows at any usable row height), record what TanStack Virtual does past the cap (scales, pages, or breaks) and what fixing it would take.
- [ ] The paging fixture passes on both sides: same pages, same order.
- [ ] Measured under the root protocol, reference and throttled, median of 10, for each contender: bundle size (brotli; wasm + JS for GPUI, JS for React), the three metrics, first rows and jump to 90% on both samples, fling top → bottom in 3 s (frame intervals p95/worst and work per frame).
- [ ] The GPUI contender's wasm, with and without `seiza`'s `shell` and `panel`, recorded.
- [ ] The decision (build the site or not, and with a Glide Data Grid third column or not) in the root `docs/DECISIONS.md` with the numbers, and the results note in `perf/results/`.

---

## Long-term goals

### M1: The comparison site

Only if M0 says build it. The contender contract made real: bare contender pages publishing the same marks, targets, and replay hooks (load, fling, jump to 90%); the shell that runs them one at a time in the visitor's browser (labelled warm) and shows the recorded cold numbers beside them, including where React wins; an optional React + canvas column (Glide Data Grid) that separates "canvas vs DOM" from "wasm vs JS". Deployed at `seiza.io/observatory`, likely by one apex Worker that will also serve a landing page at the root, binding Tycho's `tycho-data` R2 bucket. Before it goes live: the zone's WAF rules widened to cover it (one rate-limit counter for both sites, its paths in the allowlist), the same pause switch honoured and flipped by one recipe, and the burst measurement rerun against its replay (root `docs/DECISIONS.md`, "Hosting"). Its `README.md` then carries generated numbers.

### Feature levels

When a table feature (sorting, …) lands in Tycho and is worth comparing, a level adds it on both sides (root `CLAUDE.md`, "Comparison protocol"), each feature's cost measured against the base.

---

## Open questions

- **Where the replay runs in a visitor's browser:** a full-size iframe per contender (same origin; the parent idles while it runs) or a navigation per contender with results carried in the URL or session storage. Decide in M1 with a measurement of what the iframe costs.
- **Does the GPUI contender show an observation panel?** The protocol has the observatory draw the results outside the contenders, so neither side pays for a panel during a fling; a visitor may still want the GPUI one. Decide in M1.
