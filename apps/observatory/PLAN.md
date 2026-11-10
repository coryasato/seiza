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
| M12 | Scenario: admin table (the control) (parts A1–A3, B1–B2, C1–C2, D–E) | Active (opened 2026-11-09) |
| M13 | Scenario: monitoring wall | Planned |
| M14 | The wide sheet's later steps: a resize drag, a range copied | Planned (after M13) |

**Parts are sized to one working session.** Each ends with its own checks passing and its evidence written down, so the next session starts from this file, not from the last one's context. A part that grows past a session splits before it's started, not halfway through.

**Closing a milestone:** as for every app (root `CLAUDE.md`, "Working agreements"): every "done when" check passes; the numbers are in `perf/results/` with a note; new decisions are in `docs/DECISIONS.md` (repo-wide ones in the root's); a `docs/LESSONS.md` entry is written; and the milestone's spec and evidence move from here to `docs/milestones.md`, leaving one row above.

**Component and engine changes:** the observatory consumes the tall table and the DuckDB engine; it doesn't reshape them (root `docs/DECISIONS.md`, "Repo structure"). The changes it needs, all listed here (each done, and recorded in `docs/milestones.md`): `Paging` gains the two settle times (M2 part A, the one change to the table's internals, defaults unchanged), the table's fixtures and their native tests (M2 part C, with `shown_text` split out of the render loop for them, and `seiza-duckdb`'s `summary_queries` returning the queries `open_parquet` sends), `@seiza/duckdb` takes its extension directory as an option (done, M0 part A), and `seiza` gains a `panel` feature (on by default) while its title bar and theme toggle move to Tycho, with the Mac input bindings opt-in (M2 part A), and `seiza::targets` (publishing a control's bounds) moves there from Tycho, as do Tycho's first-draw probe and placeholder screenshot match to `shared-web/perf/` (M2 part B), and `cells.json` gains two hand-written `rounding` cases (M3 part A: fixture data only, no code). Each records its effect on Tycho. The scenarios ask for more, each built by its own crate's plan: the table's `density` (tall-table M10, adopted in M9), and its `format` (asked 2026-11-04 for market watch). Market watch's seeded feed is the observatory's own, not the engine's (decided 2026-11-04, M10 below).

**Waiting on** (features of a component or engine the observatory needs, and repo-wide changes it adopts; only that crate's `PLAN.md` (or the change's plan) builds them, and the session that closes one flips its row to *Ready*):

| Needs | For | Status |
|---|---|---|
| tall-table `follow` (same; [its README](../../components/tall-table/README.md), "Following the tail") | Live tail (M11) | *Ready* (2026-10-25, tall-table M4) |
| tall-table `let_go`: following turned off by the host, the view left where it is, `Following(false)` emitted (the reader's moves do it today; `set_following` is private) | Live tail's Pause (M11 part E2) | *Ready* (2026-11-09, tall-table M13; the TanStack contender's `letGo` built with it, in `follow.ts`, its fixture scenario and control run on the tail level) |
| tall-table `resize`, `select`, `copy` ([its PLAN](../../components/tall-table/PLAN.md), "Columns" and "Selection") | The wide sheet's later steps, a resize drag and a range copied (M14) | *Ready* (`resize` 2026-10-26, tall-table M5; `select` 2026-10-26, M6; `copy` 2026-10-27, M7) |

---

## Active milestone

### M12: Scenario: admin table (the control)

Opened 2026-11-09. The table in almost every app: a few hundred rows of text in many languages, used with Ctrl+F, text selection, and screen readers ([the research](docs/research/scenarios.md), "Admin table"). Mechanisms: scrolling off the main thread (D) and the platform's tools (E). **The DOM's scenario:** shown as capabilities, not speed; its verdict is "Use the DOM for this". No dial. No feature is waited on: its level is the base. M11's spec and evidence are in [`docs/milestones.md`](docs/milestones.md).

**The design is M8's canvas** (https://claude.ai/artifact/6cHBgVwwSqpTad8GP9KnGK, its main board's `admin` scenario and its "Admin" board), followed as drawn ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Page"):
- The lead: "The world's countries in their own scripts. Try finding one."
- Five columns: `flag`, `name` (the native name), `in English`, `capital`, `population` (`212 M`).
- The status bar: Ready in, Rows in, Smooth, Memory (on a phone, Ready in and Memory).
- The panel, "What each side can do": six capabilities, each with a prompt to try on both sides and yes or no per side with why (Ctrl+F "Ísland", select and copy "Reykjavík", VoiceOver through a row, every script drawn, the flags, the browser's Translate). Its verdict is "Use the DOM for this. A few hundred rows of text need the browser's own tools more than speed.", then three cards: Ready in, Download, Memory.
- The gallery card: the scripts drawn small, "Not a speed test"; the mechanisms D and E.

Every number on the canvas is a sketch. The canvas is wrong on one point, and two things aren't drawn:
- **The flags draw on GPUI too:** gpui-pre-web's Canvas fallback for emoji, which `shared/` turns on. The canvas drew them missing; A2 confirms it.
- **The fonts toggle** (decided below) has no board yet.
- **The shaping verdicts** have no board either.

Each is specced here and decided with the user, never built silently.

**The fonts** (decided 2026-11-09, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios"): the GPUI side opens with its font gap as it is. Latin, Greek, and Cyrillic draw in IBM Plex Sans, every other script's glyphs are missing, and the flags draw through the browser. A control in the window, "Load fonts for these scripts", reloads the GPUI side with fonts:
- Each non-CJK script in the file gets its whole Noto face, loaded after first paint, its bytes recorded per script.
- CJK is drawn by the browser (`CanvasFontFallback::EmojiAndCjk`, a `Bootstrap` option set at startup from a URL parameter).
- With fonts loaded, the page says "Fonts loaded after first paint: N KB. CJK drawn by the browser.", then a shaping verdict per script, stated plainly, including any script drawn wrong.

The DOM side has no toggle: it has the system's fonts. **How GPUI reaches a loaded face**, read from the pinned sources, which A2's spike tries in this order:
1. **Automatic fallback by coverage.** gpui-pre-web lays text out through gpui-pre-wgpu's cosmic text system, created without system fonts. It shapes with cosmic-text 0.19 (`Shaping::Advanced`, bidi included). When the requested face lacks a glyph, cosmic-text's fallback, after its platform lists (empty on wasm), tries every face in its database (`FontFallbackIter`'s last pass). The text system maps the face it picked back to a GPUI font. So a Noto face added with `add_fonts` should be used where IBM Plex Sans has no glyph, with nothing else changed.
2. **A fallback list on the text style.** If 1 falls short, gpui-pre 0.3.11 has `FontFallbacks`: `TextStyle::font_fallbacks`, which the cosmic text system honors by each character's coverage (`compute_run_spans`). The tall table's cells take the window's text style, so the host sets the list once on its root. That's a style the host sets, not a change to the table, and the scenario stays on the base level.
3. **Widening the browser's Canvas fallback to other scripts** (rejected). It draws each grapheme on its own, so Arabic's joining, Indic conjuncts across clusters, and bidi order would break. It would also change gpui-pre-web itself.

If neither 1 nor 2 works, the cells would have to name a family per script: a change to the table or a GPUI level of its own, which would bring the spec back to the user.

**The data** (decided 2026-11-09, the same entry): the world's regions from CLDR (the Unicode License v3), with:
- each region's name in its likely language (`likelySubtags`' `und-<region>`), and its English name;
- its population, written by prep as text in the canvas's form;
- its flag, from the region code;
- its capital, from a pinned Wikidata query (CC0).

The file is ~250 rows, in the base level's column kinds (text only), so `cells.json` gains a scenario section and no new kind.

**Parts** (each one session; B–E confirmed by A3, which split B and C):
- **A1: the data, the capabilities, and their checks.**
  - The sources pinned (CLDR's JSON release and the Wikidata query's result, each a SHA-256 in `MANIFEST.json`'s `sources`), their terms quoted.
  - Which regions count (CLDR's two-letter regions; the macro-regions, `EU`, `UN`, `EZ`, `QO`, `ZZ`, and the deprecated codes out), and the native name's rule.
  - The population text's rule (the canvas's `3.0 M`, `0.39 M`, `1.41 B`: its significant figures and units written down).
  - The regions without a capital (Antarctica, …) and what their cell holds.
  - A draft `prep-countries` with native DuckDB: rows, bytes, row groups.
  - The scripts the file holds, counted, each with its Noto face and that face's size.
  - Each capability's check on both sides, scripted where a script can see it, with the control each needs (a Ctrl+F proxy, `window.find`; a drag and `getSelection()`; the accessibility tree by CDP; the flags' and scripts' pixels; Translate, a manual check, its text nodes scripted), and what's left to the manual cross-browser check.
  - No `lang` on the DOM side (decided 2026-11-09, below).
- **A2: the fonts spike and the toggle's build shape** (split from A3, 2026-11-09: the spike is engineering, the boards a design session that needs its verdicts).
  - The bare host (or the GPUI contender's base build) on A1's draft file, at its default (the gap; the flags confirmed drawn) and with Noto faces added after first paint and `EmojiAndCjk`: which route reaches them (automatic fallback, else `FontFallbacks` on the host's root style), each script's shaping against the DOM's drawing of the same names in the same face (screenshots side by side, and a scripted check where one exists: an Arabic name's drawn width against its isolated forms', RTL order), the bytes per script, and the time from the fonts' load to the frame drawn with them.
  - The toggle's build shape: a runtime parameter on the base build (its bytes in Big file's wasm, recorded) or a GPUI level of its own (the base untouched). The `Bootstrap` option's effect on Tycho.
- **A3: the measures, the suite's time, the boards, and B–E confirmed.**
  - The measures made exact: Ready in, Rows in, Smooth (which scroll), Memory, Download, and the toggle's own (the fonts' bytes, fonts in → drawn, memory with them).
  - The suite's time.
  - The boards on M8's canvas, decided with the user before anything is built: the toggle in the window (where the dial would be), what the frame says while fonts load, the per-script verdicts in the panel, the flags row corrected, light and dark, desktop and phone.
- **B: the data and the scenario on both sides** (split in A3: the TanStack contender's changes at every level and the fonts path are a session each).
- **B1: the data, the scenario, and the TanStack contender's two changes.**
  - The data: `prep-countries` in `prep.ts` (`--only countries`, the sources' pins), its `MANIFEST.json` entry with credit and terms.
  - The scenario in `contenders/scenarios.ts` on the base level (both sides' `pickScenario`), and `cells.json`'s scenario section by `cell-fixture`.
  - The TanStack contender's two changes at every level (decided 2026-11-09): ARIA table semantics (`table`, `row`, `columnheader`, `cell`, `aria-rowcount`, each row's `aria-rowindex`), and, on the base level, every row rendered when the rows fit in one page (1,024; market watch and live tail stay virtualized). Each level's first-paint JS against its baseline, `tanstack-contract` and `tanstack-parity` unchanged at every level, and each scenario's README section saying its numbers predate them.
- **B2: the fonts path and the capabilities' check.**
  - The fonts path on the GPUI side, as A2 decided (a runtime parameter on the base build; automatic fallback): the `Bootstrap` option, shaped so Tycho's wasm doesn't change, else its effect recorded in Tycho's `perf/results/`; the export that adds the faces after first paint; Big file's wasm bytes recorded against its budgets; the Noto faces pinned to a release and staged under `/observatory/`, their OFL credited; the faces fetched once the rows are in (A3), and the mark after the first frame drawn with them, checked against its GPU work.
  - A check script (`perf/admin.ts`, in `check`) proving each capability's yes and no on both sides, with its controls; and the TanStack side's drawn text, Arrow's decoding included, the same as `cells.json`'s admin table cells (the fixture's runners pin each side's cell text, not its decoding: B1's code review).
- **C: the numbers** (split in A3, as live tail's D was: the metrics at the level are code, reviewed before the long run).
- **C1: the metrics at the level.** A3's measures in the metric scripts on `--scenario admin-table`: Smooth's read-through gesture (GPUI's presented frames, TanStack's compositor scroll deltas, one total), memory's equal work, and `?fonts` on GPUI (each face's bytes, Scripts drawn in and its split, memory with them); smoke runs only, then the code review.
- **C2: the runs.** The cold suite at the base level on the countries file, both sides, both devices, median of 10, the toggle's runs beside it (~1 h, A3), each results file labeled `admin-table`, with its versions, and a results note.
- **D: the page,** as the canvas draws it and A3's boards add (its memory card and the second buffer's line as C2 decided: `metric-memory`'s summary gains the page less its "Canvas" and the runs holding a second buffer, read again from C2's files' runs, never re-measured): the route, the status bar, the panel (capabilities, verdict, cards, the shaping verdicts), the toggle, the description, the gallery card, and the Overview's rule's DOM half ("text-heavy", which M9 E3 left waiting on these numbers).
- **E: shipped.** The README's admin table section by `report` (its canvas tradeoffs too: root rule 4), `burst` under the zone's limit, the deploy, `worker-check`.

**Done when** (the measures made exact in A1 and A3):
- [ ] **Its builds:** the admin table on the base level on both sides; the TanStack contender's ARIA roles at every level and its rendering of a one-page table on the base level, each level's bytes recorded against its budget; Big file's wasm with the fonts toggle (a runtime parameter on the base build), its bytes recorded and the base's budgets holding; the fonts path's bytes after first paint recorded per script; `shared/`'s `Bootstrap` option with its effect on Tycho recorded.
- [ ] **Its data credited:** the countries file in `MANIFEST.json` (rows, bytes, SHA-256, its pinned sources, credit, terms); the page and the README credit CLDR (Unicode License v3) and Wikidata (CC0), and the Noto faces (OFL).
- [ ] **The same on both sides:** `cells.json`'s scenario section passes on both sides with its controls; both sides' columns at the same x and width.
- [ ] **Its capabilities proven:** each of the panel's yes and no checked by `perf/admin.ts` on both sides (and with fonts), with its control, in `check`; the rest by the manual cross-browser check, written down; each script's shaping verdict with its evidence (screenshots against the DOM's) in a results note.
- [x] **Its runs and numbers:** the cold suite once, in part C, both sides, both devices, median of 10, the toggle's runs beside it, each file labeled `admin-table` with its versions; a results note. *Evidence:* part C2 below.
- [ ] **The page:** as the canvas and A3's boards draw it; `page --check` covers it.
- [ ] **Shipped:** the README's section by `report`, `burst` under the zone's limit, the deploy, `worker-check`.

#### Part A1: the data, the capabilities, and their checks

**Done when:**
- [x] **A1-1, the sources and their terms:** CLDR's JSON release and the Wikidata query's result downloaded into `data/raw/countries/` (gitignored), each SHA-256 recorded, their terms quoted. *Evidence:* [`perf/results/2026-11-09-m12-a1.md`](perf/results/2026-11-09-m12-a1.md), "The sources": `cldr-core` and `cldr-localenames-full` 49.0.0 from npm (`085b1c7d…`, `d00bafb5…`), the Wikidata query's result (`b7cc2309…`, labels in `en`, else `mul`, a live query: `--repin` as GHCN's); the Unicode License v3's grant quoted (redistribution provided the notice appears with the copies or in associated documentation: `MANIFEST.json`'s terms and the README's credits carry it).
- [x] **A1-2, what's kept:** the regions and the rules (native name, population text, no capital), a draft `prep-countries` with native DuckDB (rows, bytes, row groups, byte-identical across two builds), the scripts the file holds and each one's Noto face and size. *Evidence:* the rules decided with the user ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios", 2026-11-09, "The countries file's rules"); [`data/countries.ts`](data/countries.ts) and [`data/prep-countries.sql`](data/prep-countries.sql) drafted: 250 rows, five text columns, 8,226 bytes in one row group, byte-identical across two builds (`8e46b48d…`); 17 boundary cases of the population's text pass. 18 scripts in the names; IBM Plex Sans lacks exactly 15 (Han and Hangul to the CJK fallback, 13 to Noto faces, 582.3 KiB brotli in all, Noto Serif Tibetan 182.1 of it); the note's "The scripts and their faces".
- [x] **A1-3, the capabilities' checks:** each capability's yes or no on each side, how a script proves it and its control, and what stays manual. *Evidence:* the probe on both base builds (the note's "The capabilities' probe": `window.find`, a drag's selection, and CDP's accessibility tree each work, each with a control of DOM text on the same page), which found two gaps on the DOM side, both decided with the user (DECISIONS, "Scenarios", 2026-11-09): no table semantics (ARIA roles at every level) and the virtualized rows (every row of a table that fits in one page rendered). The checks `perf/admin.ts` runs in part B, on each side's frame after it fills, Chromium:
  - *Ctrl+F "Ísland":* `window.find` finds it on TanStack and the row lands in view; not on GPUI. Control: DOM text added to each page is found, and a word not in the file isn't. Manual: the real find bar, in Chrome, Firefox, and Safari.
  - *Select and copy "Reykjavík":* a drag across its cell selects exactly `Reykjavík` on TanStack, and Cmd+C puts it on the clipboard (`clipboard-read` granted); nothing is selected on GPUI. Control: DOM text added to the page selects on both.
  - *A screen reader:* CDP's tree holds a `table` with 251 `row`s (the header's own and 250, `aria-rowcount` 251, the data rows' `aria-rowindex` 2–251), and Iceland's row's cells named, on TanStack; on GPUI no node is named by any cell. Control: DOM text added to the page is named on both. Manual: VoiceOver through a row, in Safari.
  - *Every script drawn* and *the flags:* by pixels, each side's cells against what it should draw, made exact in part A2 with the fonts spike (how GPUI draws a missing glyph, and a flag's color against a text cell's gray).
  - *Translate:* scripted only as its precondition, every name in the TanStack page's text (`innerText`) with no `translate="no"`, and none on GPUI's. Manual: Chrome's Translate on both.
- [x] **A1-4, `lang` on the DOM side,** decided with the user. *Evidence:* [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios", 2026-11-09: no language column, so no `lang` on the TanStack side's cells.

#### Part A2: the fonts spike and the toggle's build shape

**Done when:**
- [x] **A2-1, the spike:** the default (the gap; the flags drawn) and the fonts (Noto faces after first paint, `EmojiAndCjk`) on A1's file: which route reaches them (automatic, else `FontFallbacks`); each script's shaping against the DOM's, with screenshots; bytes per script; fonts in → drawn. *Evidence:* [`perf/results/2026-11-09-m12-a2.md`](perf/results/2026-11-09-m12-a2.md): by default every missing glyph is a notdef box and every flag draws in color (the canvas's flags row is wrong); automatic fallback reaches all 13 faces with nothing else set (`FontFallbacks` drew the same glyphs, so the host sets none), each name's width the DOM's within 1 px, Arabic joined and right to left; gpui-pre-wgpu 0.3.11 drops the marks' GPOS offsets, so 29 of the file's 733 texts draw a mark off its place, Sri Lanka's Sinhala name and Palestinian Territories' Arabic misread, Cambodia's Khmer and some Arabic dots visibly off; 601.6 KiB brotli for the 13 faces (Noto Serif Tibetan 192.7); fonts in → drawn 24.5 ms median (n = 7, reference).
- [x] **A2-2, the toggle's build shape** and the `Bootstrap` option's effect on Tycho, decided with the user. *Evidence:* [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios", 2026-11-09: a runtime parameter on the base build (+487 B brotli in Big file's wasm, a minimal toggle), automatic fallback with no list on the host; the option's cost to Tycho (+23 B raw, +1,378 B brotli, unset) to zero in part B, else recorded there; the lost mark offsets stated in the verdicts, the issue to be filed upstream by the user.

#### Part A3: the measures, the suite's time, the boards, and B–E confirmed

**Done when:**
- [x] **A3-1, the measures and the suite's time.** *Evidence:* [`docs/DECISIONS.md`](docs/DECISIONS.md), "Measurement", 2026-11-09, "The admin table's measures": Ready in and Rows in as defined; Smooth a read-through gesture (6,000 px at 3,000 px/s, inside the table's 6,810 px), the share of the display's frames that moved the view, one total on both sides (GPUI's presented frames, TanStack's compositor scroll deltas: every row rendered, no main-thread frame to count), the scroll decided with the user; Memory at equal work (the one page read at the open, the scroll down and back), less the canvas, with fonts the scripts drawn before the scroll; Download by kind from the memory run; the toggle's bytes per face, Scripts drawn in (`timeOrigin` → the first frame drawn with the faces, split), and memory with them; Ready in and Rows in with `?fonts` within 5% of the default's (the user's tolerance); GPUI's Rows in with fonts states its boxes, Scripts drawn in the like-for-like number (decided with the user after the code review). The suite: 220 runs, ~46 minutes, about 1 h with the builds. The faces fetched once the rows are in ("Scenarios", 2026-11-09, with the user).
- [ ] **A3-2, the boards,** drawn on M8's canvas and decided with the user.
- [x] **A3-3, B–E confirmed** (split where a part is over a session). *Evidence:* the parts above: B split as B1 (the data, the scenario, the TanStack contender's two changes at every level) and B2 (the fonts path and `perf/admin.ts`); C as C1 (the metrics at the level, smoke runs, then the code review) and C2 (the runs, ~1 h); D and E as written.

#### Part B1: the data, the scenario, and the TanStack contender's two changes

**Done when:**
- [x] **B1-1, the data:** `prep-countries` in `prep.ts` (`--only countries`), its sources pinned, its `MANIFEST.json` entry with credit and terms. *Evidence:* [`perf/results/2026-11-09-m12-b1.md`](perf/results/2026-11-09-m12-b1.md), "What changed": 250 rows, 8,392 bytes, one row group, byte-identical across two builds (`a4fa4aa0…`); CLDR's tarballs pinned by version in `prep.ts`, the Wikidata result in `MANIFEST.json` (a new download fails without `--repin`: checked); CLDR's notice verbatim in `MANIFEST.json`'s `notice` and the README's data credits ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios", 2026-11-09, "The countries file's sources").
- [x] **B1-2, the scenario and its fixtures:** `ADMIN_TABLE` on the base level, both sides' `pickScenario`; `cells.json`'s section by `cell-fixture`, passing on both sides with its control; both sides' columns at the same x and width. *Evidence:* the note's "The admin table on both sides": 220 cells, every drawn text DuckDB's; the native and TS runners pass and their Latin-1 control fails; `view.test.ts`'s x and widths; `sql.json`'s section too ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios", 2026-11-09, "The admin table's cell fixture is text").
- [x] **B1-3, the TanStack contender's two changes:** ARIA table semantics at every level, every row of a one-page table on the base level; each level's first-paint JS against its baseline; the README's scenario sections saying their numbers predate them. *Evidence:* the note's "Against the budgets" (base +0.2 KiB, wide +0.1, market and tail under 0.1, every level under its limit) and its probe (the admin table's 251 rows and 1,250 cells in CDP's tree, `window.find("Ísland")` found; Big file still virtualized); [`docs/DECISIONS.md`](docs/DECISIONS.md), "TanStack contender", 2026-11-09; the README's four sections.
- [x] **B1-4, nothing else moved** (re-run after the code review's fixes): `tanstack-contract` and `tanstack-parity` unchanged at every level. *Evidence:* the note's "Regressions": `tanstack-contract` (base, market, tail), `tanstack-parity` (every level; Chromium, Firefox, WebKit), and `tanstack-view --gpui` pass.

#### Part B2: the fonts path and the capabilities' check

**Done when:**
- [x] **B2-1, the `Bootstrap` option:** `EmojiAndCjk` settable through `shared/`, Tycho's wasm unchanged (else its effect recorded). *Evidence:* [`perf/results/2026-11-09-m12-b2.md`](perf/results/2026-11-09-m12-b2.md), "Against the budgets": `Bootstrap::canvas_font_fallback` behind the `canvas-font-fallback` feature, Tycho's release wasm byte-identical to HEAD's (`cmp`; the first shape moved three panic locations' lines and cost 2.1 KiB brotli); root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Shell and input", 2026-11-09.
- [x] **B2-2, the fonts path:** `?fonts` on the base build (`EmojiAndCjk` at startup, the 13 faces fetched once the rows are in, added by an export, `contender:fonts` right after the first frame drawn with them, checked against its GPU work); the faces pinned and served at `/observatory/fonts/` with their OFL, credited; Big file's wasm against its budgets. *Evidence:* the note's "The fonts path" (13 faces fetched once, after the fill, each checked against its pin, 582.3 KiB brotli; fonts in → drawn 23.7 and 32.3 ms in two runs; the mark under 0.8 ms after its frame's last GPU call; a face off its pin marks `fonts-failed`) and "Against the budgets" (the crate's `fonts` on the base alone: base −101 B brotli, 2,771.1 KiB against 3,113.3, TTFP 170.8 ms against 187.6; wide, market, and tail byte-identical to HEAD's); `contenders/fonts/faces.ts` (notofonts at `4cf78353`, each face's version and SHA-256, both in its served name), staged by the deploy; the README's "Font credits"; [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios", 2026-11-09, "The fonts path's shape".
- [x] **B2-3, `perf/admin.ts` in `check`:** each capability's yes and no on both sides with its control, the scripts by default and with fonts, and the TanStack side's drawn text against cells.json's admin table cells. *Evidence:* the note's "The capabilities, as `perf/admin.ts` proves them" and `2026-11-09-m12-b2-admin.json`: every check and every control as the panel says; `window.find` doesn't scroll to its match, so the landing joins the manual check.

#### Part C1: the metrics at the level

**Done when:**
- [x] **C1-1, Smooth's read-through** in `metric-scroll --scenario admin-table`: one gesture from the top (`READ_THROUGH`, 6,000 px at 3,000 px/s), GPUI's presented frames and TanStack's compositor scroll deltas (`compositorScrolls`, timed), one total (`drewShare`), traced with `cc` on both sides; the wide sheet's scrolls unchanged. *Evidence:* smoke, reference, 2 runs a side: GPUI 100% (60 frames/s, 6,000 px moved), TanStack 99.6% (6,000 px; 120 main frames at 2.6 ms p50 beside the compositor's); the wide sheet at `rows-26` as before (both keep up).
- [x] **C1-2, memory's equal work** in `metric-memory --scenario admin-table`: the one page at the open, the read-through down and back, each landing filled; readings once open and at the end, by type (the canvas apart); Download by kind. *Evidence:* smoke, reference, 4 runs a side: every run's cache 16,776 bytes on both sides; GPUI's page 30.7 → 31.6 MiB (Canvas 19.8), TanStack's 4.4 → 4.8.
- [x] **C1-3, `--fonts` on GPUI** (`usable`, `data`, `memory`; refused for TanStack, another scenario, and `scroll`): Scripts drawn in and its split, the mark checked against its frame's GPU work (`presentingTaskRecorder` armed at `contender:fonts-in`), each face's bytes; memory with the scripts drawn first; files labelled `admin-table-fonts`. *Evidence:* smoke, reference: Ready in 149.5 ms, confirmed and guarded (2 runs); Scripts drawn in 1,005 ms (rows 949, fetch 30, fonts in → drawn 25.5), the mark after its frame's GPU work in every run, 586 KiB of faces, each once after the rows; memory 33.4 → 53.7 MiB, "Canvas" doubled at the end (C1-5); `admin`, `lint` pass; [`docs/DECISIONS.md`](docs/DECISIONS.md), "Measurement", 2026-11-09, "The fonts toggle's runs".
- [x] **C1-4, the code review** of this part's changes, its fixes smoke-run again. *Evidence:* six fixed (the scroll back past the top, `fonts-failed` in memory, the window's canvas subtracted at most the measured "Canvas", `compositorScrolls` once per presented vsync, the faces check shared, the categories from `shared-web`'s); two kept and documented (`cc` traced on both sides; fonts in → drawn's one wrapped frame); one deferred (a per-scenario plan for `metric-scroll`, at a third scroll scenario). Smoke again, reference: the read-through 100% on both sides; Scripts drawn in 945 ms, 586 KiB of faces; memory at the end less the window's canvas, GPUI 12.0 MiB, with fonts 33.9, TanStack 4.8; `admin`, `lint` pass.
- [x] **C1-5, the second "Canvas"** with fonts, found and decided: Chromium counting a second buffer for the window's canvas, no second canvas; less the window's one buffer, the rest the side's cost. *Evidence:* [`docs/DECISIONS.md`](docs/DECISIONS.md), "Measurement", 2026-11-09, "GPUI's memory is less the window's canvas"; with fonts doubled at the scroll back in 3 of 3 runs, without in 0 of 3 (and 1 of 5 from the open, in a memory run).


#### Part C2: the runs

**Done when:**
- [x] **C2-1, the cold suite:** usable, data, the read-through, and memory on both sides, both devices, median of 10; usable, data, and memory with `?fonts` on GPUI beside them; each file labeled `admin-table` (`-fonts`) with its versions; every run passing. *Evidence:* [`perf/results/2026-11-09-m12-c2.md`](perf/results/2026-11-09-m12-c2.md) and its seven `2026-11-10-m12-c2-*-admin-table*.json`: 220 runs in 28 minutes, no failures. Ready in GPUI 145.3 ms, TanStack 42.4 (throttled 3,563 and 482); Rows in GPUI 194.2, TanStack 252.1 (throttled 1,315 and 1,507); Smooth 100% on both, both devices; memory less every canvas buffer GPUI 11.8 MiB, TanStack 4.8 (throttled 11.8 and 4.9; C2-3).
- [x] **C2-2, the toggle's runs:** Ready in and Rows in with fonts within 5% of the default's; Scripts drawn in, its split, its mark checked, the faces' bytes, memory with them. *Evidence:* the note's "The fonts toggle": within 1.1% on both devices; Scripts drawn in 832.7 ms (throttled 12,241), the mark after its frame's GPU work in 20/20 runs, 586.1 KiB of faces, memory 14.1 MiB less every canvas buffer (+2.3 against the default's; C2-3).
- [x] **C2-3, the second canvas buffer on a slow device,** decided with the user: Chromium counted it in 10 of 10 throttled default runs (reference 2 of 10), so GPUI's throttled memory reads 31.6 MiB against 11.8 at the reference, and the toggle's memory cost +2.4 MiB throttled against +22.1. *Evidence:* the note's "Memory: a second canvas buffer on a slow device"; decided: the card is the page less every canvas buffer (GPUI 11.8 MiB on both devices, the toggle +2.3 at the reference and +2.4 throttled), the second buffer on a line of its own, for part D to show ([`docs/DECISIONS.md`](docs/DECISIONS.md), "Measurement", 2026-11-09).
---

## Next milestones

The "done when" checks are drafts until their milestone becomes active. The scenarios (M9–M13) are in the research's build order ([`docs/research/scenarios.md`](docs/research/scenarios.md), where each one's workload, measures, dial, and needs are); each scenario's research and spec open its milestone as part A, as the table's features do, and its later parts are split there.

**Every scenario milestone** (decided 2026-10-30, [`docs/DECISIONS.md`](docs/DECISIONS.md), "Scenarios"), each item a "done when" check of its own:
- **Its builds:** each contender builds once per feature level (Cargo features are compile-time, and the same scope keeps a level's code out of every other's bundle), at a base of its own under the contender's (`contenders/paths.ts`), staged and served beside the others, with its TTFP and wasm (or first-paint JS) budgets in `perf/budgets.json`, gated by `check` (root rule 1). A scenario on a level that exists shares its build (the admin table the base's; the monitoring wall market watch's, if its features match).
- **Its data credited:** the credit on the page and in the README, the license in `MANIFEST.json`; a synthetic feed is labelled synthetic on the page.
- **Its runs:** `check` gates its builds' budgets and runs its smoke, fixtures, and contract checks, never the full protocol. The full cold protocol (its stops × both sides × both devices × 10 runs, and its soaks) runs once, in its numbers part, on the final build (a long run: ask about a code review first); its part A estimates that time before fixing the stops. Its results files are labelled with its name, so it re-runs without the others.
- **Its versions:** each results file records what it was measured with (gpui-kit, React, TanStack Virtual, Arrow, DuckDB-Wasm, Chromium), and the scenario's explainer shows them ("measured with …"). A bump of any of them re-measures the scenarios it touches or labels their numbers with the versions they came from, decided per bump.

### M13: Scenario: monitoring wall

4–8 small tables updating at once: one canvas against N DOM trees. Market watch's updates N times, in the layout M8 decides. The last scenario.

### M14: The wide sheet's later steps: a resize drag, a range copied

The research's later steps for the wide sheet ([`docs/research/scenarios.md`](docs/research/scenarios.md), "Wide sheet"): a column-resize drag, and a range selected and copied. They come after the other scenarios (decided with the user, 2026-11-04). Their features are *Ready* ("Waiting on"). **The wide level grows** (decided with the user, 2026-11-04): its one build on each side gains the table's `resize`, `select`, and `copy` and their counterparts, so a visitor resizes and copies in the frame they scroll. No second wide build and no switch between them. The same scope still holds: the base level carries none of it. Because each side's bundle grows, the wide sheet's numbers are measured again at the grown level and replace M9's.

- **The GPUI side:** the crate's feature `wide` turns on `resize`, `select`, and `copy` (and the bridge's), the host writing the clipboard through `tall-table-bridge`'s `clipboard::Clipboard`, the key columns resizable as `pin` allows, the copy's limits the table's defaults (`key_max_cells`, `max_bytes`), and a declined copy said in the window. New contract marks for the measures below; `docs/contender-contract.md` gains them.
- **The TanStack side:** each feature's counterpart on its scroll model, ported from the table's own logic as the paging is. The resize band, its drag (live, clamped, the sideways scroll held until the release) and double-click fit, and a pinned column's limit. The selection model (`Rows`, `Columns`, `Cells` from an anchor to a head; the pointer, the keys, the tint and the active cell's edge). The copy: tab-separated exact values (`format.ts`), read a page at a time beside the cache, the same caps and events, the clipboard written as the bridge writes it (`ClipboardItem` with a promise opened at the key).
- **Fixtures prove "the same":** `cells.json`'s `resize` section (skipped by the TanStack contender today) and `selection.json` in TS with their controls, and a copy fixture of the component's (a range → its text, exact; the caps) if the table has none, asked of the component's PLAN, never written here. `tanstack-parity` gains the resize band and drag, the selection's pointer and keys, and Cmd+C.
- **The measures** (the research's, made exact in part A): a resize drag's frame cost (each frame's work while a day's column is dragged, both sides, at each stop), a selection drag's, and a copy's time (the key → the clipboard written) for a range under `key_max_cells` and for one past it confirmed (the copy's turns spread over frames: does the view keep up meanwhile?).
- **The page:** how the window offers the tools and where their numbers go (the status bar, the panel's cards, the description), designed first: new boards on M8's canvas, light and dark, desktop and phone, decided with the user before anything is built (the canvas draws none of it today). The admin table's capability list (M12) may already say GPUI's selection by then; part A checks the two read as one story.
- **Parts (draft):** A, the design and the spec (the boards, the measures and their scripts, the suite's time); B, the GPUI side at the grown level (its wasm and TTFP against the level's baselines, rewritten); C, the TanStack side (its first-paint JS and data layer against the level's baselines); D, the numbers (the wide sheet's whole cold suite at the grown level, then the new measures: a long run, so a code review first); E, the page; F, shipped (the README's sections, `burst`, the deploy, `worker-check`).

**Done when** (draft):
1. **Its builds:** the wide level on both sides carries `resize`, `select`, `copy` and their counterparts, and nothing else new; the base level byte-identical to before; the level's budgets (`gpui-wide-*`, `tanstack-wide-*`) against rewritten baselines, gated by `check`, with each feature's added bytes in a results note.
2. **The same on both sides:** the fixtures above pass on both sides with their controls; `tanstack-parity` covers the band, the drag, the selection's input, and the copy, in Chromium, Firefox, and WebKit; a copied range's text is byte-identical on both sides and against native DuckDB's values.
3. **Its numbers:** the wide sheet's cold suite again at every stop (M9's measures, replacing part D's on the page and in the README), and the new measures, both sides, both devices, median of 10, each results file with its versions; a results note.
4. **The page:** the tools in the window and their numbers as the design draws them; `page --check` covers them.
5. **Shipped:** the README's wide sheet sections with the new rows by `report`, `burst` under the zone's limit, the deploy, `worker-check`.

---

## Measurements

Generated by `just observatory report` from [`perf/budgets.json`](perf/budgets.json) and the newest matching file in `perf/results/`; don't edit between the markers. A metric's history is its dated results files.

<!-- report:plan:start -->
| Metric | Budget | Gate | Local | Production | From |
|---|---|---|---|---|---|
| GPUI contender: time to first paint | ≤ 187.6 ms (baseline 170.5 + 10%) | `check` | 170.5 ms | 329.5 ms | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json), [2026-10-21-gpui-cold-production](perf/results/2026-10-21-gpui-cold-production.json) |
| GPUI contender: time to first paint, throttled | — | recorded | 3502.5 ms | 3550.5 ms | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json), [2026-10-21-gpui-cold-production](perf/results/2026-10-21-gpui-cold-production.json) |
| GPUI contender: wasm (brotli) | ≤ 3113.3 KiB (baseline 2707.2 + 15%) | `check` | 2695.4 KiB | — | [2026-10-16-m2-b-gpui-cold](perf/results/2026-10-16-m2-b-gpui-cold.json) |
| GPUI contender at the wide level: time to first paint | ≤ 198.9 ms (baseline 180.8 + 10%) | `check` | 180.8 ms | — | [2026-11-02-gpui-cold-wide](perf/results/2026-11-02-gpui-cold-wide.json) |
| GPUI contender at the wide level: time to first paint, throttled | — | recorded | 3585.2 ms | — | [2026-11-02-gpui-cold-wide](perf/results/2026-11-02-gpui-cold-wide.json) |
| GPUI contender at the wide level: wasm (brotli) | ≤ 3191.2 KiB (baseline 2775 + 15%) | `check` | 2775 KiB | — | [2026-11-02-gpui-cold-wide](perf/results/2026-11-02-gpui-cold-wide.json) |
| GPUI contender at the market level: time to first paint | ≤ 195.8 ms (baseline 178 + 10%) | `check` | 178 ms | — | [2026-11-05-gpui-cold-market](perf/results/2026-11-05-gpui-cold-market.json) |
| GPUI contender at the market level: time to first paint, throttled | — | recorded | 3610.4 ms | — | [2026-11-05-gpui-cold-market](perf/results/2026-11-05-gpui-cold-market.json) |
| GPUI contender at the market level: wasm (brotli) | ≤ 3209.2 KiB (baseline 2790.6 + 15%) | `check` | 2790.6 KiB | — | [2026-11-05-gpui-cold-market](perf/results/2026-11-05-gpui-cold-market.json) |
| GPUI contender at the tail level: time to first paint | ≤ 189 ms (baseline 171.8 + 10%) | `check` | 171.8 ms | — | [2026-11-07-gpui-cold-tail](perf/results/2026-11-07-gpui-cold-tail.json) |
| GPUI contender at the tail level: time to first paint, throttled | — | recorded | 3595.2 ms | — | [2026-11-07-gpui-cold-tail](perf/results/2026-11-07-gpui-cold-tail.json) |
| GPUI contender at the tail level: wasm (brotli) | ≤ 3208.7 KiB (baseline 2790.2 + 15%) | `check` | 2790.2 KiB | — | [2026-11-07-gpui-cold-tail](perf/results/2026-11-07-gpui-cold-tail.json) |
| TanStack contender: first-paint JS (brotli) | ≤ 79.3 KiB (baseline 72.1 + 10%) | `check` | 73.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes](perf/results/2026-11-09-m12-b1-tanstack-sizes.json) |
| TanStack contender at the wide level: first-paint JS (brotli) | ≤ 84.5 KiB (baseline 76.8 + 10%) | `check` | 77.7 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-wide](perf/results/2026-11-09-m12-b1-tanstack-sizes-wide.json) |
| TanStack contender at the market level: first-paint JS (brotli) | ≤ 83.1 KiB (baseline 75.5 + 10%) | `check` | 75.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-market](perf/results/2026-11-09-m12-b1-tanstack-sizes-market.json) |
| TanStack contender at the tail level: first-paint JS (brotli) | ≤ 84.2 KiB (baseline 76.5 + 10%) | `check` | 76.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-tail](perf/results/2026-11-09-m12-b1-tanstack-sizes-tail.json) |
| TanStack contender: data layer and Arrow, after first paint (brotli) | ≤ 38.2 KiB (baseline 34.7 + 10%) | `check` | 34.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes](perf/results/2026-11-09-m12-b1-tanstack-sizes.json) |
| TanStack contender at the wide level: data layer and Arrow, after first paint (brotli) | ≤ 38.3 KiB (baseline 34.8 + 10%) | `check` | 34.8 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-wide](perf/results/2026-11-09-m12-b1-tanstack-sizes-wide.json) |
| TanStack contender at the market level: data layer and Arrow, after first paint (brotli) | ≤ 44.8 KiB (baseline 40.7 + 10%) | `check` | 40.9 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-market](perf/results/2026-11-09-m12-b1-tanstack-sizes-market.json) |
| TanStack contender at the tail level: data layer and Arrow, after first paint (brotli) | ≤ 42.6 KiB (baseline 38.7 + 10%) | `check` | 39.2 KiB | — | [2026-11-09-m12-b1-tanstack-sizes-tail](perf/results/2026-11-09-m12-b1-tanstack-sizes-tail.json) |
| Page: first paint (paint timing), /observatory/tall-table/big-file/ | ≤ 85 ms (baseline 70.8 + 20%) | `check` | 70.8 ms | 210.2 ms | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first paint (paint timing), throttled | — | recorded | 437.4 ms | 474.7 ms | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json), [2026-10-21-page-production](perf/results/2026-10-21-page-production.json) |
| Page: first-paint JS (brotli) | ≤ 86 KiB (baseline 78.2 + 10%) | `check` | 78.2 KiB | — | [2026-10-19-m5-a-page](perf/results/2026-10-19-m5-a-page.json) |
| Requests in the busiest 10 s, one visitor (the zone's rate limit counts per IP) | — | recorded | 141 requests | — | [2026-11-09-m11-f-burst](perf/results/2026-11-09-m11-f-burst.json) |
<!-- report:plan:end -->

---

## Long-term goals

Not milestones. Each starts with research.

- **A scenario's advanced panel:** its parameters beyond the stops, a later toggle, its readings labelled warm and never published ([`docs/research/scenarios.md`](docs/research/scenarios.md)). The scenarios themselves are M9–M13 ("Next milestones").
- **A third contender: Glide Data Grid** (GPUI | TanStack / Glide): a DOM-hosted canvas grid, which would separate "canvas vs DOM" from "Wasm vs JS" (the scenarios' mechanisms A against B and C, [`docs/research/scenarios.md`](docs/research/scenarios.md)). Another contender app against the same GPUI side, under the same protocol. It may never happen.
- **A dataset easier to read at a glance** than a sea of floats, within the static-asset budget. The wide sheet's heat and bar cells answer part of it.
- **Feature levels:** a level adds a table feature on both sides (root `CLAUDE.md`, "Comparison protocol"), each feature's cost measured against the base. A level comes in with the scenario that needs it, not on its own. The features, their order, and each one's TanStack counterpart are in [the table's `PLAN.md`](../../components/tall-table/PLAN.md); a level is a milestone here that links to it.
- **The benchmark button:** "Run benchmark" plays a scripted session on each side in turn (the order alternated between runs), drives each through its own input path (script-made wheel events reach GPUI's listeners but never scroll a native scroller, so the DOM side is driven through its scroll position), and shows the results labelled warm beside the cold ones, from production too. Deferred: at the base level its session (load, fling, jump to 90%) replays what the cold numbers already show, a workload on which the GPUI side reads mostly as heavier in memory. It's worth building once the scenarios exist: it then sweeps a scenario's stops on each side and draws each side's curve, where each one stops keeping up. The status bar keeps it, disabled.
- **Future UI improvements** (ideas, none designed; each is drawn on M8's canvas, light and dark, desktop and phone, and decided with the user before it's built, on both sides):
  - **Live tail's "Back to the tail" button,** shown once a reader has let go of the tail (the table's `Following(false)`, its README's suggestion), returning the view to the tail and following again. Until then the way back is the table's own: End, or a move that reaches the end.
- **Dropping your own file:** out of the base level. It would widen the cell fixtures to every column kind (decimals, timestamps, 128-bit integers). Opening any dataset (a dropped file, HuggingFace) is Tycho's, as a utility app's job.

---

## Open questions

- **The base level's wheel readings.** A bare `mouse.wheel` reaches a native scroller's compositor every other frame in headless Chromium (`perf/results/2026-11-02-m9-a2.md`), and the base level's TanStack fling and Smooth were read through it. Whether to re-measure them on the gesture scroll, which the wide sheet uses from part D on (`docs/DECISIONS.md`, "Measurement"), and say so on the page meanwhile, is open; so is whether a real trackpad in a headed Chromium matches the gesture's rate.
- **The DOM's fling, read from its compositor.** The fling's late frames and lag are main-thread readings on both sides (`underLoad`), which on GPUI are the presented frames but on the DOM aren't: its compositor scrolls on through a late main-thread frame. The README says so. Whether the DOM side should also report what its compositor presented (`cc`'s frames and `Scroll Delta This Frame`, as the wheel's guard reads them) beside it, and which reading the page headlines, is a protocol change for root `docs/DECISIONS.md`.
- **A short page's missing cells.** The tall table draws a value past a page's end as `NULL` (`render_body`'s `unwrap_or(CellValue::Null)`); the TanStack contender draws it empty. A static file never answers short, so nothing measured differs; whether the component should draw it empty too is the component's call (Tycho drives it).

- **GPUI's key at the wide level.** In 6 of 120 key inputs (`perf/results/2026-11-03-m9-d.md`) no `EventLatency` of GPUI's key reached a frame, though the view moved and filled; the base level read all 120. And GPUI's first usable at the wide level was confirmed in 8 of 10 reference runs, its probe frame ~3 ms later than the base's. Whether either is Chromium's attribution or GPUI's first frames after usable doing more at the level is untested.

- **The pill's compositor frames.** Throttled, the meter as a pill dropped more compositor frames than hidden on both sides (TanStack 7.98% against 3.5%, GPUI 4.21% against 0), while the open meter dropped none more (`perf/results/2026-10-21-m5-d4.md`). The pill isn't the default, so nothing gates it; whether it should get a layer of its own (`will-change: transform`, as the open meter has), and whether that's the cause, is untested.
- **A spread for a short mark.** The quiet-machine gate is (max − min) / median under 6% of each variant's open mark. TanStack's reference mark is ~500 ms, so one 15–30 ms stray fails it (7.0–7.7% in both D4 runs, while its gates read 0 against 0). Whether short marks get a floor in ms, or the gate uses the interquartile range over the median, is open.
- **GPUI's lost mark offsets upstream.** gpui-pre-wgpu 0.3.11 drops cosmic-text's `x_offset` and `y_offset` (`perf/results/2026-11-09-m12-a2.md`). The user files the issue; whether a fix lands before part C, so the shaping verdicts are measured on it, is open.
- **The landing page.** The observatory's Worker holds the apex `seiza.io` (everything outside `/observatory/` a 404). The page is basic (a title, a catchy line, a link to the observatory), built in `site/landing/` on `site/ui/`'s shell (root `docs/DECISIONS.md`, "Repo structure"); when it ships is open. Shipping it moves the Worker to `site/worker/` and adds `/`, `/index.html`, and `/assets/` to the seiza.io WAF rule (`/fonts/` is in it already).
