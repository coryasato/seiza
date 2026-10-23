# Research: scenarios

Research for the observatory's long-term goal "Scenarios" ([`../../PLAN.md`](../../PLAN.md)). Drafted 2026-10-23 in a planning discussion; nothing here is measured yet. The decision to lead by scenarios is in [`../DECISIONS.md`](../DECISIONS.md), "Scenarios".

**The question a visitor brings:** "for my table, should I use the DOM (TanStack) or WebAssembly drawn on the GPU (GPUI)?" The base level (scrolling 1.57 M asteroids) answers it only for one use, and on it GPUI reads mostly as the heavier side. A scenario answers it for a real use: a kind of app people build, its workload, and what that workload costs on each side.

---

## Where the two stacks differ

Every scenario works through some of these mechanisms. Only B and C are WebAssembly's; A is the canvas's, and a JS canvas grid (the Glide contender, a long-term goal) would share it.

| | Mechanism | Favours | WebAssembly or the canvas |
|---|---|---|---|
| A | **Cost per cell.** The DOM pays style, layout, and paint per cell element, growing with cells × changes; a GPU-drawn view pays for quads and glyphs. | GPUI | The canvas |
| B | **Allocation and garbage collection.** Row objects, cell strings, and React's reconciliation make garbage; sustained churn turns it into GC pauses mid-frame. Rust has no GC, and pages are plain buffers. | GPUI | WebAssembly |
| C | **Decoding and formatting:** Arrow → values → the shown text, per visible cell, per frame. | GPUI, likely modestly | WebAssembly |
| D | **Scrolling off the main thread.** The compositor moves a DOM scroll while the main thread is busy; a canvas can't. | TanStack | — |
| E | **The platform's text and tools:** shaping and fonts for every script, accessibility, Ctrl+F, selection, first paint, bytes. | TanStack | — |

The base level's numbers already fit: GPUI wins the throttled fling (A, B); TanStack wins first usable and memory (E, and the canvas's backing store).

---

## The scenarios, in build order

Each is a real use, built from a feature level of the table (both sides), a dataset or a deterministic feed, a script, and a few **intensity stops**: fixed parameter sets that get cold numbers. The page shows a scenario picker and one dial over the stops; an advanced panel exposing a scenario's parameters is a later toggle, its readings labelled warm, unpublished.

### 1. Wide sheet

- **Real use:** spreadsheets, BI exploration, a notebook's table output. Precedents (check before citing): Google Sheets' move to canvas rendering; Quadratic, a Rust/WebAssembly and WebGL spreadsheet.
- **Workload:** 100–500 columns, compact rows, heat-map and data-bar cells; later, a column-resize drag and a range selection copied.
- **Mechanisms:** A, C.
- **Measures:** the visible cells each side holds at the display's rate; a horizontal and a vertical fling's late frames and per-frame work; with `resize`, a resize drag's frame cost.
- **Dial:** columns and row height (cells on screen), then cell style (text → heat → bars).
- **Needs:** columns from the SQL projection over the same file (no new bytes); the table's `custom-cells` feature and its TanStack counterpart (cell renderers); column virtualization on the TanStack side, which it doesn't have at 11 columns.
- **Why first:** the fewest new features, and the cheapest test that scenarios separate the stacks at all.

### 2. Market watch

- **Real use:** a trading blotter, a crypto exchange's market list, betting odds. Precedent: FINOS Perspective, a WebAssembly engine for streaming financial data.
- **Workload:** ~20 columns × ~50 rows, cells **updated in place** at 1k–50k updates/s, each change flashing or colored.
- **Mechanisms:** A, B, C. The strongest test of what WebAssembly adds beyond the canvas (B).
- **Measures:** update → pixel latency; the highest sustained update rate before frames go late; GC pauses in the trace (V8's GC events against late frames).
- **Dial:** updates per second.
- **Needs:** a table call for "these rows changed" (pages re-read or patched), and `custom-cells` for the flash; a deterministic feed.

### 3. Live tail

- **Real use:** an observability tool's live tail, a SIEM, CI logs.
- **Workload:** rows **appended** at 1k–100k/s while the view follows the tail; scrolling back while rows keep arriving; minutes long.
- **Mechanisms:** B, and A at density.
- **Measures:** the append rate held while following; scroll-back latency during ingest; memory and late frames over a 10-minute soak.
- **Dial:** rows per second.
- **Needs:** the table's `follow` feature (pinned to the last row while rows arrive, released when the reader scrolls up; `set_rows` already grows the source); the engine's append path; a deterministic feed.
- **Not a log viewer:** wrapped lines of varying height break the table's uniform f64 row index. A `log-view` component would be a comparison of its own.

### 4. Admin table (the control)

- **Real use:** the table in almost every app: a few hundred rows, text-heavy, many languages, used with screen readers and Ctrl+F.
- **Workload:** 50–500 rows of multilingual text (CJK, Arabic, emoji among them).
- **Mechanisms:** D, E. **The DOM's scenario:** the page's verdict is "use the DOM for this".
- **Shown as capabilities, not speed:** prompts to try on each side (Ctrl+F a name, drag-select a cell's text, VoiceOver, every script rendered, a load on a throttled network), a yes/no list beside them, and the numbers TanStack already wins (first usable, bytes, memory).
- **Needs:** the base level and a small multilingual file. GPUI's web build bundles one face (IBM Plex Sans), so scripts outside it don't render there: the gap is the point.
- **Cheap:** it could move earlier if the page needs its honest counterweight sooner.

### 5. Monitoring wall (last)

- **Real use:** a NOC screen, an ops dashboard, live sports.
- **Workload:** 4–8 small tables, all updating.
- **Mechanisms:** A, B: one canvas against N DOM trees.
- **Needs:** market watch's updates, N times; a page layout of several tables.

---

## Data

- **A deterministic feed, generated from a seed** in the engine's worker, the same on both sides (only the UI differs): no bytes, any rate, reproducible for cold runs. Market watch and live tail start here.
- **A recorded real feed** (Wikimedia EventStreams, Bluesky Jetstream, an exchange's trades; check each before relying on it) is a later option, replayed from a static asset within today's size, at a rate the dial sets. A live connection would be a warm-only mode. Show metadata columns only: public user text on seiza.io brings whatever it contains.
- **Arbitrary datasets (HuggingFace, a dropped file) are Tycho's,** not the observatory's: they'd widen the cell fixtures to every column kind, and the observatory's data stays a static asset of today's size.

---

## What changes in the protocol

The root `CLAUDE.md`'s "Comparison protocol" defines a comparison by its level (base, or base plus features). A scenario adds a workload to it: the dataset or feed, the script, and the stops, each stop with cold numbers. The protocol change, and its entry in root `docs/DECISIONS.md`, land with the first scenario's milestone. Features stay the component's and Tycho's ([`components/tall-table/PLAN.md`](../../../../components/tall-table/PLAN.md)); a scenario is the observatory's.

---

## Open questions

- **Saying "canvas or WebAssembly" on the page:** whether each scenario names the mechanisms behind its result now (A against B and C), or waits until a Glide contender can measure the split.
- **The stops per scenario:** how many, and what each holds, decided when its milestone is drafted.
- **The engine's feed and append path:** where the seeded generator lives (`engines/duckdb/`, behind a feature, or the observatory's own worker code), and DuckDB-Wasm's insert rate in its worker, which caps live tail's dial.
- **How the page presents scenarios:** a picker in the contender's window, a route per scenario (`/observatory/tall-table/<scenario>`), or both.
