# Research: scenarios

Research for the observatory's long-term goal "Scenarios" ([`../../PLAN.md`](../../PLAN.md)). Drafted 2026-10-23 in a planning discussion; planned as milestones on 2026-10-30, one per scenario in this order ([`../../PLAN.md`](../../PLAN.md)). The table's features are measured in its bare host, reading from memory; nothing here is measured against the engine yet. The decisions are in [`../DECISIONS.md`](../DECISIONS.md), "Scenarios".

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
- **Workload:** hundreds of columns (GHCN-Daily's 365, a day each: "Data"), compact rows, heat-map and data-bar cells; later, a column-resize drag and a range selection copied.
- **Mechanisms:** A, C.
- **Measures:** the visible cells each side holds at the display's rate; a horizontal and a vertical fling's late frames and per-frame work; with `resize`, a resize drag's frame cost.
- **Dial:** the cells on screen (each stop a row height, column width, and text size, named by its cell count), then cell style (text → heat → bars).
- **Needs:** a file of its own (GHCN-Daily, "Data"), the first beside the asteroids, measured against columns derived from the asteroid file's five floats; the table's `custom-cells` (built) and its TanStack counterpart (cell renderers); `pin` (built) for its key columns (the station's name and place), frozen as every wide sheet freezes them, and TanStack's column pinning; the table's `density` (a row height, a width set without `resize`, and a text size), asked of the table: at the base's 120 px columns and 30 px rows only ~360 cells are on screen, too few for the dial ([the table's M1 results](../../../../components/tall-table/perf/results/2026-10-23-m1.md)); column virtualization on the TanStack side, which it doesn't have at 11 columns.
- **Why first:** the fewest new features, and the cheapest test that scenarios separate the stacks at all.

### 2. Market watch

- **Real use:** a trading blotter, a crypto exchange's market list, betting odds. Precedent: FINOS Perspective, a WebAssembly engine for streaming financial data.
- **Workload:** ~20 columns × ~50 rows, cells **updated in place** at 1k–50k updates/s, each change flashing or colored.
- **Mechanisms:** A, B, C. The strongest test of what WebAssembly adds beyond the canvas (B).
- **Measures:** update → pixel latency; the highest sustained update rate before frames go late; GC pauses in the trace (V8's GC events against late frames).
- **Dial:** updates per second.
- **Needs:** the table's `live` (changed rows re-read in place) and its flash with `custom-cells`, both built: reading from memory in the bare host they keep up at 1k–50k updates/s ([the table's README](../../../../components/tall-table/README.md), "Features"), so the dial's ceiling is likely the engine's update rate; a seeded feed over fictional instruments ("Data"); the TanStack side's port of `live`'s re-reads and its flash.

### 3. Live tail

- **Real use:** an observability tool's live tail, a SIEM, CI logs.
- **Workload:** rows **appended** at 1k–100k/s while the view follows the tail; scrolling back while rows keep arriving; minutes long.
- **Mechanisms:** B, and A at density.
- **Measures:** the append rate held while following; scroll-back latency during the feed; memory and late frames over a 10-minute soak.
- **Dial:** rows per second.
- **Needs:** the table's `follow` (built: the view kept at the tail as `set_rows` grows the rows, let go when the reader scrolls up; from memory it keeps up at 1k–100k rows/s, [the table's README](../../../../components/tall-table/README.md), "Features"); NASA's 1995 web server logs ("Data"), replayed by growing the rows read, so the engine inserts nothing and the dial's ceiling is the UI's; an insert path only if that replay falls short.
- **Not a log viewer:** wrapped lines of varying height break the table's uniform f64 row index. A `log-view` component would be a comparison of its own.

### 4. Admin table (the control)

- **Real use:** the table in almost every app: a few hundred rows, text-heavy, many languages, used with screen readers and Ctrl+F.
- **Workload:** 50–500 rows of multilingual text (CJK, Arabic, emoji among them).
- **Mechanisms:** D, E. **The DOM's scenario:** the page's verdict is "use the DOM for this".
- **Shown as capabilities, not speed:** prompts to try on each side (Ctrl+F a name, drag-select a cell's text, VoiceOver, every script rendered, a load on a throttled network), a yes/no list beside them, and the numbers TanStack already wins (first usable, bytes, memory).
- **Needs:** the base level and the countries file ("Data"). GPUI's web build bundles one face (IBM Plex Sans), so scripts outside it don't render there: their glyphs are missing, not shaped badly, so the scenario can't yet test GPUI's shaping. Its milestone decides what the page shows: the gap as it is, or script fonts loaded on the GPUI side after first paint (their bytes, and root rule 1), which would test the shaping; the page says which.
- **Cheap:** it could move earlier if the page needs its honest counterweight sooner.

### 5. Monitoring wall (last)

- **Real use:** a NOC screen, an ops dashboard, live sports.
- **Workload:** 4–8 small tables, all updating.
- **Mechanisms:** A, B: one canvas against N DOM trees.
- **Needs:** market watch's updates, N times; a page layout of several tables.

---

## Data

Decided 2026-10-30 ([`../DECISIONS.md`](../DECISIONS.md), "Scenarios"): **each scenario's data makes immediate sense to a visitor.** The row is something they recognize, the headers are plain words with units, and the data gives the scenario's paint a meaning (a heat map's pattern, an update's direction). Real where it can be, labelled synthetic where it can't, the label on the page.

**Every file:**
- A static asset under 25 MiB, never R2; built by a script, byte-identically, from a pinned source; pinned in `data/MANIFEST.json` (source, license, fetch date, SHA-256, rows, bytes); credited on the page.
- Public domain, CC0, or CC BY (credited), its terms checked before it's committed. No personal data and no user-written text: public user text on seiza.io brings whatever it contains.
- In the column kinds the fixtures cover today (integer, float, text, boolean, date). Another kind (a timestamp, a decimal) widens `cells.json` and the TanStack contender's formatter, a choice its milestone makes knowingly.
- **Several files change the hosting:** the Worker's edge cache is keyed by one `DATA_SHA256`, and `MANIFEST.json`, `prep.ts`, `contenders/data.ts`, the deploy, and `worker-check` assume one file. The first new file, the wide sheet's, carries the change.
- **The numbers come from recorded or seeded data,** the same on both sides (only the UI differs), replayed at the dial's rates: reproducible for cold runs. A live connection would be a warm-only mode, labelled not measured.
- **The tall table's bare host keeps its synthetic values:** it measures the table, and hashed values keep the branch predictor from learning the data. Readable data is the observatory's.

**Per scenario:**

| Scenario | Data | Why it reads at a glance | To check, in its milestone |
|---|---|---|---|
| Base level | The asteroids, as today | Real and large (1.57 M rows); row 1 is Ceres | — |
| Wide sheet | NOAA's GHCN-Daily: a row per weather station, a column per day of a year, the day's temperature as a heat cell (precipitation as bars, a candidate), the rows ordered by latitude | Seasons show as a warm band across each row, and scrolling down runs from the Arctic through the tropics to the south, where the band flips | Its terms (US government data, likely public domain; it asks for a citation); its size (~40 k stations × 365 days ≈ 15 M values, stored as `INT16` tenths of a degree and read as `DOUBLE` in the page SQL, so the cells stay the fixtures' float kind; stations cut if it's over); the requests a page read sends with 365 physical columns (DuckDB reads column chunks by range, against the zone's rate limit); all against columns derived from the asteroid file's five floats (no new bytes, but synthetic: a heat map of noise) |
| Market watch | A seeded feed over ~50 fictional instruments from realistic price levels: bid, ask, last, change, change %, volume, labelled synthetic | A trading screen at a glance. Fictional, because real symbols with made-up prices could be read as quotes, and real tick data rarely allows redistribution | Where the feed lives, and DuckDB-Wasm's update rate (its spike) |
| Live tail | NASA Kennedy Space Center's web server logs, July 1995 (~1.9 M requests): time, request, status, bytes. Replayed by growing the rows read (`set_rows`), looped past the file's end (row *i* is the file's row *i* mod *n*, its time shifted by a lap), so the engine inserts nothing | Real log lines any developer reads, and on theme | Its terms (the Internet Traffic Archive's); its host column (1995 visitors' hostnames and IPs: dropped, or cut to the domain's suffix); its times as text or a `Timestamp` (a new kind); its size |
| Admin table | The world's countries (~250), each name in its own script, with its capital, languages, population, and flag emoji, from CLDR or Wikidata | Multilingual by nature (CJK, Arabic, Devanagari, Thai), with no fake people; the flags show the font gap at a glance | Their terms (Unicode's license, CC0); what the GPUI side draws ("Admin table", above) |
| Monitoring wall | The market and tail feeds, several small tables at once | Reuses the feeds; no new file | — |

**Rejected:** OpenSky's aircraft positions for market watch (restrictive terms; each row identifies an aircraft, private owners among them; and ~10 k rows with most updates off screen is not a blotter of ~50 all changing); Wikipedia's pageviews for the wide sheet (article titles bring whatever they name); generated access logs for live tail (NASA's are real and on theme); GeoNames' cities for the admin table (a city's native name needs its language-tagged alternate names; CLDR gives a country's directly); a recorded live stream (Wikimedia EventStreams, Bluesky Jetstream: user text, and 100 k rows/s needs a replay anyway).

**Arbitrary datasets (HuggingFace, a dropped file) are Tycho's,** not the observatory's: they'd widen the cell fixtures to every column kind.

---

## What changes in the protocol

The root `CLAUDE.md`'s "Comparison protocol" defines a comparison by its level (base, or base plus features). A scenario adds a workload to it: the dataset or feed, the script, and the stops, each stop with cold numbers. The protocol change, and its entry in root `docs/DECISIONS.md`, land with the first scenario's milestone. Features stay the component's and Tycho's ([`components/tall-table/PLAN.md`](../../../../components/tall-table/PLAN.md)); a scenario is the observatory's.

---

## Open questions

- **Saying "canvas or WebAssembly" on the page:** whether each scenario names the mechanisms behind its result now (A against B and C), or waits until a Glide contender can measure the split.
- **The stops per scenario:** how many, and what each holds, decided in its milestone's part A.
- **The engine's feed:** where market watch's seeded generator lives (`engines/duckdb/`, behind a feature, or the observatory's own worker code), and DuckDB-Wasm's update rate in its worker, which likely caps its dial (the table keeps up past it from memory). A spike opens market watch's milestone. Live tail's replay inserts nothing ("Data").
- **How the page presents scenarios:** a picker in the contender's window, a route per scenario (`/observatory/tall-table/<scenario>`), or both. Decided in the design milestone that comes before the first scenario.
