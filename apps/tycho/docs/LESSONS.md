# Lessons learned

One entry per milestone, written before starting the next one: what surprised us, and what it taught us. The milestone's numbers are in its results note (linked from each entry), and the decisions it made are in [`DECISIONS.md`](DECISIONS.md). Entries before 2026-10-11 also repeated their numbers and decisions here; those copies were removed in favour of the results notes and `DECISIONS.md`.

<!-- Template (docs/templates/app/docs/LESSONS.md):
## M<n>: <title> (YYYY-MM-DD)

**Results:** [`perf/results/<date>-m<n>.md`](../perf/results/<date>-m<n>.md)

**Surprises:**
- What didn't go as expected, and what it taught us. Numbers only where the surprise needs them; the rest are in the results note.
-->

## M0: Empty GPUI Kit shell on the web (2026-09-23)

**Results:** [`perf/results/2026-09-23-m0.md`](../perf/results/2026-09-23-m0.md)

**Surprises:**
- `wasm-opt` rejected the release wasm ("Atomic operations require threads") until we passed `--enable-threads`. `wasm_thread`'s atomics end up in the binary even on the single-threaded platform. Browsers accept atomics on non-shared memory.
- No `gpui_kit::open_window` in 0.6.4 (the skill docs describe a later API). The window root is `cx.open_window(...)` returning `Root::new(view, …)`.
- In 0.6.4, `Theme::change`'s `.SystemUIFont` probe (`theme/system_font.rs`) skips itself when no fonts are installed, so init may no longer panic on an empty font database. We still load fonts before init, as the rule says, because the first measured text needs the family either way.
- The debug wasm is 128.6 MiB. Dev loads are slow (~2–4 s to first frame) but fine. If it becomes painful, try `opt-level = 1` for dependencies in `[profile.dev.package."*"]`.
- **Headless DPR emulation breaks GPUI's canvas sizing.** gpui-pre-web sizes the backing store from `ResizeObserver`'s `device-pixel-content-box`. In headless Chromium with `deviceScaleFactor: 2`, that box reports CSS pixels while `devicePixelRatio` is 2, so GPUI draws 2× layout into a 1× backing store. `--force-device-scale-factor=2` does the reverse. Playwright's Firefox `deviceScaleFactor` loses DPR after `setViewportSize`; the `layout.css.devPixelsPerPx` pref is consistent. The M0 screenshots from the first run show it: Chromium's text was twice WebKit's size. This blocks the protocol's reference run (headless Chromium at DPR 2) and is a pending M1 decision.
- `build.rollupOptions` is a deprecated alias in Vite 8 (Rolldown). `onwarn` goes in `build.rolldownOptions`.
- The wasm is big: 2.6 MiB brotli for an empty shell. That's the M1 baseline to beat. Obvious candidates: `opt-level` s vs z, font subsetting, and checking what gpui-component's `init` pulls in (all components' actions and keybindings).

## M1: First-paint baseline and perf overlay skeleton (2026-09-23)

**Results:** [`perf/results/2026-09-23-m1.md`](../perf/results/2026-09-23-m1.md)

**Surprises:**
- **M0's first-frame mark was right on WebGL2 only by luck.** GPUI's window starts at 0×0, so `open_window`'s synchronous draw shows nothing. The first real draw happens in gpui-pre-web's `ResizeObserver` callback, which renders and presents synchronously. With WebGPU it can happen in GPUI's rAF instead, and GPUI first presents an empty frame there. The M0 mark (a rAF requested from the first render, via a spawned task) landed a frame late on WebGPU. Requesting that rAF synchronously made it a frame *early* on WebGL2. The fix is a microtask queued by the first render with a real viewport. It runs right after the callback that presents. The probe in `perf.ts` found both bugs: it hooks WebGL2 draws and WebGPU submits and checks the mark against them on every run. My first two versions of the probe were wrong too: "within 8 ms of the first GPU call" fails when a long callback is still one frame. The right check is a window from a GPU task's last call to its microtask checkpoint.
- **Headless DPR 2 took one line.** Deleting `ResizeObserverEntry.prototype.devicePixelContentBoxSize` makes gpui-pre-web use its Safari path, which is consistent under emulation. So the M0 blocker didn't need headed runs or a `shared/` patch.
- **`vite preview` doesn't compress.** It served the 9.5 MB wasm raw, which would have made the throttled run meaningless. Brotli quality 11 on the wasm takes 19 s, so it's cached by content hash and filled by `asset-sizes.ts` during the build.
- **Noise is close to the budget.** Reference medians for one config across the session ranged 170–191 ms (±6%), against a 10% budget. M2's "within 5% of baseline" check will need more runs or several interleaved A/B passes to be meaningful.
- GPUI logs `[WARN]` lines on WebGL2 ("Dual-source blending not available…"). The perf suite ignores GPUI's own warnings but fails on browser warnings, like an unused preload or an `instantiateStreaming` fallback.
- The Cmd+Shift+P toggle works without clicking the canvas first; gpui-pre-web's input mirror has focus from load. Firefox on macOS keeps Cmd+Shift+P for a private window, so the docs point to Ctrl+Shift+P or `?perf` there.

## M2: DuckDB in a worker, prefetched after first paint (2026-09-23)

**Results:** [`perf/results/2026-09-23-m2.md`](../perf/results/2026-09-23-m2.md)

**Surprises:**
- **A failed engine load hung the UI forever.** The negative control (block DuckDB's wasm or worker in Playwright) caught it: DuckDB-Wasm never rejects `instantiate` when its worker dies. The worker fetches its wasm in a promise nothing awaits, so a failed fetch is just an unhandled rejection inside the worker. Fix: run DuckDB's worker script inside a small classic worker that reports unhandled rejections as errors, and race `instantiate` against the `Worker`'s `error` event. The wrapper had to be a blob: URL: as a Vite worker entry, Vite's dev server serves it as an ES module, which can't `importScripts`. Both controls now run in `just tycho engine`.
- **`perf.ts` measured the wrong wasm.** It took the first `.wasm` in `dist/assets` as the app's, and with DuckDB in the build that became DuckDB's 5 MB wasm. The size budget would have compared the wrong file. It now picks `tycho_bg-*.wasm`.
- **The protocol matters for engine timing.** Playwright's default Chromium (the old headless shell) loaded DuckDB about 3× slower (~1970 ms) than `channel: 'chromium'` (headless=new, ~620 ms). `engine.ts` uses headless=new, like `perf.ts`.
- **`range(1e10)` doesn't bind in DuckDB** (`1e10` is a DOUBLE). The long query is `range(10000000000)`.
- **Firefox cancels in ~97 ms in the release build**, every run, but 0.6 ms against the dev server. It's under the 200 ms budget; the cause is unknown (likely where the cancel lands in DuckDB's poll slice). Worth a look if M4's scrolling cancels feel slow in Firefox.
- The decoder matched DuckDB's real output for all 17 test columns on the first try; the unit tests against arrow-rs-written streams had already caught the two bugs. One: Rust's `Display` for `f64` writes 1e300 as 301 digits, so floats print with `Debug` (shortest round-trip, with an exponent). Two: float32 must stay `f32`, or 0.1 prints as 0.10000000149.
- Playwright traces record no network unless `snapshots: true`.
- **Parquet isn't built into DuckDB-Wasm.** Only `core_functions` is statically linked. The first Parquet call silently autoloaded the extension from extensions.duckdb.org, which the self-hosting rule forbids and which would have made M3 depend on a third-party CDN. The code review caught it; autoload is now off, and M3 self-hosts the extension.
- **The code review found gaps the tests didn't:** a cancel during the result-fetch phase was ignored; a worker dying after load would hang its queries; `registerFile(url)` accepted a 404 (and Vite's SPA fallback answers every unknown path with `index.html` and a 200); the reader's offset math could wrap on wasm32's 32-bit `usize` (the native tests run 64-bit); and the traced perf run counted toward the median. All fixed; see `DECISIONS.md`.
- The engine JS chunk (38 KiB br) carries apache-arrow, which DuckDB's JS API imports but Tycho never calls. It loads after first paint, so it only costs engine-ready time. It could be trimmed later.

## M3: Asteroid sample over HTTP (2026-09-24)

**Results:** [`perf/results/2026-09-24-m3.md`](../perf/results/2026-09-24-m3.md)

**Surprises:**
- **Playwright doesn't see DuckDB's requests** (sync XHRs inside its worker). Its network log showed one "200, whole file" request that the server never sent. Bytes are now counted at the server, with a counting proxy in `perf/sample.ts`.
- **The M3 transfer check can't hold as written.** "Footer + first row group < 2%": row group 0 is 9.5% of the file at 122,880 rows per group, and a `LIMIT 50` pulled ~5.5 MB with readahead. It passes for M3 only because M3 shows no rows. It's now an M4 decision (row-group size, ~20k rows for 2%).
- **WebKit lays the first frame out before the window's real size:** the button's first bounds were off-screen (−91, 1271) at 1440×900. My first early-click runs "failed" in WebKit because the harness clicked there. It may affect what WebKit's first-frame mark means; check before quoting WebKit TTFP.
- **`execFileSync` from a script that hosts the preview server deadlocks it.** The A/B harness hung until it used async `execFile`.
- **The CSV fixture defeats DuckDB's sniffer:** the tricky rows come after 1.5M quote-free rows, so auto-detect picks no quote character. Good for M6: the CSV path can't rely on sniffing a prefix.
- **The code review found what my checks couldn't:** autoload of an extension we don't host got Vite's `index.html` as "wasm"; the byte count skipped requests still streaming at the frame, the exact shape of the bug M3 found (it now has a negative control); R2's clamping was verified only in Miniflare. All fixed; see `perf/results/2026-09-24-m3.md`.
- **The load average (5–12) made the first budget check fail** at 222 ms. The A/B is the tool for telling load from regression; a single protocol run on a busy machine isn't.

## M4: Virtualized table over paged queries (2026-09-25)

**Results:** [`perf/results/2026-09-25-m4.md`](../perf/results/2026-09-25-m4.md)

**Surprises:**
- **DuckDB-Wasm's readahead sets a 1.39 MB floor per page read.** `WebFileSystem` reads sequential regions in growing requests (16 K, 64 K, 256 K, 1 M), and no `db.open` option or Parquet setting changes it. So the M3 goal "first rows under 2% of the file" can't hold for a 38 MB file at any row-group size. On Fast 4G that ramp is four round trips, ~2.1 s per page.
- **A scrollbar drag's stale page reads blocked the page it ended on.** Cancel can't stop a read already in DuckDB's worker, which uses sync XHRs. The throttled jump took 4.3 s, one stale read plus the real one. Waiting for the pointer to rest brought it to 2.2 s, and the reference jump from 184 to 133 ms.
- **Headless DPR 2 halves Playwright's wheel deltas.** `mouse.wheel(0, 1000)` arrives as `deltaY` 500. The first sweep and protocol run flung at half speed. That surfaced only as an intermittent "didn't reach the last row", and it had made 4096-row pages look better than they are. `harness.ts`'s `wheel()` corrects for it.
- **Two failing loads of one extension at once crash DuckDB-Wasm** ("table index is out of bounds") without a worker error, and every later query hangs. The M3 retry check caught it when a click raced the prefetch, in 4 of 8 runs. It likely predates M4; the bigger footer made the race more likely.
- **A quick click on the scrollbar left the drag on.** The drag's move and release listeners were registered at paint, and only while dragging, so a release in the same frame as the press was missed. Playwright's WebKit showed it first; a negative control shows it in Chromium and Firefox too. The listeners now register every frame.
- **Memory:** wasm plateaus at the page-cache budget plus ~21 MiB of allocator slack, and doesn't keep growing over 5 passes. Wasm memory never shrinks. The live JS heap is ~4 MiB, but without a forced GC it swings ~20 MiB between identical passes, so the check forces one.
- **The bigger footer** (52 row groups instead of 13) costs the M3 click → schema ~20 ms (108 ms, budget 300). Bytes before the schema rose from 34.8 KB to 90.8 KB.

## M5: Drop a Parquet file (2026-09-27)

**Results:** [`perf/results/2026-09-27-m5.md`](../perf/results/2026-09-27-m5.md)

**Surprises:**
- **Our own row-group size was the slowest layout for a local 1 GB file.** First measurement: first rows 2.66 s at 30,720-row groups vs 0.59 s at 122,880 and 0.48 s at 1,048,576. M4 picked 30,720 for HTTP, where the readahead's bytes dominate; locally, per-row-group CPU does.
- **A `file_row_number` filter doesn't prune row groups.** Each page query sets up every row group's column readers: ~0.4 ms per group with 19 columns, whatever the page size. That's ~20 ms on the M4 sample, invisible there, and ~490 ms at 1,378 groups. Native DuckDB 1.4.5 does the same. It isn't fixed here; it's carried to M7, where Gaia (25 M rows) picks its row-group size.
- **DuckDB re-parsed the footer on every query.** The metadata cache is off by default, and a plain `SET` is per connection; each of our queries has its own, so the first try changed nothing. With `SET GLOBAL`, a metadata query on the 1 GB file went from ~165 ms to 1–2 ms.
- **Round-robin query slices tripled first rows.** DuckDB-Wasm interleaves every pending query, so the visible page finished only when its two prefetch neighbours did. Holding prefetch until the visible pages are in also cut M4's jump to 90% from 133 to 92 ms.
- **The file dialog needed no workaround in any engine.** The expectation was that Safari would refuse `input.click()` outside a "real" click handler; GPUI's synchronous dispatch was enough.
- **The code review found a fix I'd reported but never landed** (a stale notice after a sample open): my edit script printed the change and never wrote it. Check a change is in the file before reporting it. The review also caught a failed open leaving queries running, a failed page blocking prefetch, and that parsed footers now stay in the worker for the session (recorded as a known cost).
- **A script bug looked like a focus bug.** The memory check hung after Home, which looked like the page had no keyboard focus after a drop. It did; Home landed on cached pages, so the viewport never went unfilled and no `tycho:viewport-filled` mark came. The check now waits on what the table shows.

## M6: Drop a CSV with progressive loading (2026-09-30)

**Results:** [`perf/results/2026-09-30-m6.md`](../perf/results/2026-09-30-m6.md)

**Surprises:**
- **DuckDB's sniffer reads only the head.** The asteroid CSV quotes nothing until its last 8 rows, so the sniffer picked *no* quote character, and the file failed to parse at line 1,567,525: even native DuckDB can't read the fixture with defaults. Its types were wrong too: `pdes` is numeric for 895,910 rows, then "1988 PF1". Tycho forces RFC 4180 quoting, and widens a column to text when a chunk's value doesn't fit (the error names the column; a failed `CREATE TABLE` leaves nothing behind).
- **The append stalls weren't what they looked like.** They weren't GC (40 ms in total over the trace), not wasm memory growth (pre-growing the heap changed nothing), and not parsing (parsing without storing ran a steady ~45 ms per 8 MiB). They were deterministic, at the same chunks every run, inside DuckDB's table append. They weren't explained further; one table per chunk sidesteps them.
- **A page read sent during a `CREATE TABLE AS` waits for it to finish.** M5 found DuckDB-Wasm round-robins query slices; this statement doesn't share. That set the 200 ms chunk target.
- **Throughput depends more on layout than on parsing.** DuckDB parses this CSV at ~190 MB/s. One whole-file `CREATE TABLE AS` stores it at 131 MB/s, compressed per-chunk tables at ~68 MB/s. The price of progressive loading plus compression is about half the throughput. First rows come in 0.2 s rather than after 8 s.
- **The code review found a leak my checks couldn't see.** The supersede check replaced a CSV only *while it loaded*, where the task drops its own tables; once a load finished, the task was gone, and replacing the file left its ~300 MiB in DuckDB. The check now replaces a loaded CSV and a stopped one too. The review also caught a real-world format bug for each assumption: a `rowid` column hides DuckDB's own, and a stray `12"` would have made the rest of a file one "quoted" chunk. The `formats` check generates each.
- **Throttled, the load costs frames.** At CPU 4× a fling during the load reaches 33–50 ms p95 and 66.7 ms at worst (16.7 / 33.3 ms without a load, M5). The budget is the reference run's, which holds at 16.7 ms. Carried to M7 with the per-frame work time to find out why.

## Upgrade: gpui-kit 0.6.4 → 0.7.1 (2026-10-07)

**Results:** [`perf/results/2026-10-07-gpui-kit-0.7.1.md`](../perf/results/2026-10-07-gpui-kit-0.7.1.md)

**Surprises:**
- **A full perf run right after the bump read +6% TTFP. It was load.** A single before/after pair minutes apart under a load of ~4 isn't a comparison. Alternating the builds (after, before, after, before) showed no difference.
- **The overlay code is now linked whether or not it's used.** 0.6.4 made the app render the layers (+26.4 KiB in M0). 0.7 registers per-window presentation for every component in `Root` and cost +31.2 KiB more, though Tycho opens no dialog yet.
- **The perf overlay now sits under dialogs.** It's drawn inside the shell, and `Root` draws its overlays above the shell. M7's observation panel should account for that if it ever needs to cover a dialog.
- One web gotcha is gone: the skill docs' `open_window` now matches the pinned API. Another is fixed upstream but untested here: Input's context-menu Paste falls back to an async clipboard read (#3244). Tycho has no text input until M7's jump to row, which checks it. File drops are still swallowed by gpui-pre-web 0.3.8.

## M7 part A: Observation panel (2026-10-07)

M7 is split into five parts, one session each (`milestones.md`, M7). Part E writes the milestone's full entry; this one covers part A.

**Results:** [`perf/results/2026-10-07-m7-panel.md`](../perf/results/2026-10-07-m7-panel.md)

**Surprises:**
- **The frame interval hid the real cost of scrolling.** Both a fling and a steady scroll pin at 16.7 ms. Work per frame shows the steady scroll at 12.7 ms p50 and 15.1 p95, ~1.6 ms from a dropped frame, while the fling (mostly placeholders) is at 5.2. Loaded rows are what's expensive; part B checks whether that's cell formatting.
- **js-sys's `Atomics::load_bigint` passes its index as a BigInt, which `Atomics.load` rejects.** The JS exception unwound through a GPUI update, and every later `cx.update` panicked "RefCell already borrowed". The first error in the log was the real one. Tycho declares its own `Atomics.load` binding with a number index.
- **A `check` at 194.9 ms against a 195.0 ms limit was load, not the panel** (load 4–7). The interleaved A/B put master at 195.8 ms under the same load.
- **Under CPU 4× throttling, work per frame is ~4× the reference but the interval p95 stays 16.7 ms.** Throttled work times compare with each other, not with a 60 Hz frame.
- **A cached GPUI view saves its own render, not the frame.** Notifying it marks every ancestor dirty, so each 4 Hz refresh redraws the whole window, and a hidden panel that kept notifying redrew the app for nothing (code review). The panel now notifies only while it's visible, and says that its frame rows include the frames its refreshes draw.
- **The code review caught swapped legend colors** that the screenshots missed: `cargo fmt` had rewrapped the sparkline's call, so a text replacement changed only the legend. The sparkline and legend now share one color definition.
- **DuckDB's worker leaves room for counting.** Its main handler is `globalThis.onmessage`, set during `importScripts`, so a listener the wrapper adds first can take our own message (`stopImmediatePropagation`) before DuckDB sees it. Its reads go through `XMLHttpRequest` and `FileReaderSync` on `File.slice`, so wrapping those three counts every byte.

## M7 part B: Gaia sample (2026-10-07)

**Results:** [`perf/results/2026-10-07-m7-gaia.md`](../perf/results/2026-10-07-m7-gaia.md)

**Surprises:**
- **The readahead doesn't stop at 1 MB.** M4 saw 16 K/64 K/256 K/1 M and called 1.39 MB the floor. It keeps growing ×4 (4 M, 16 M) while reads stay sequential, so bytes per page jump in steps with the row-group size: 5.6 MB for Gaia at 30,720 and 61,440 rows, 22.4 MB from 122,880. The row-group choice became "the biggest group under a step", not a curve.
- **A filter pushdown can't help a sky-sorted catalog.** Every HATS partition holds every magnitude, so keeping 2% of Gaia meant reading 100% of its columns. Keeping one extract per partition made every later build local (4–5 s).
- **The source has duplicates.** 17,842 identical rows inside two HATS partitions. The distinct count matched the ESA archive's to the row. Without the archive check they'd have shipped.
- **Part A's own hypothesis was wrong.** Its note guessed that loaded rows cost more than placeholders because of cell formatting. Timed alone, formatting is 0.075 ms of a 13 ms draw; the cost is text layout and drawing.
- **A wrong number came from a script, not the app.** The first Gaia runs read 21 ms of steady-scroll work against 12.7 in a probe. It took a bisection to find: since part A, the panel covers the scrollbar's bottom, so the script's drag after a fling pressed the panel, and the "steady scroll" wheeled against the last row. Its memory pass hung for the same reason. The script now checks where the scroll starts. A visitor hits the same wall (part D).
- `rows += await …` in a pool of concurrent jobs loses updates: the fetch's progress log read 4.6 M rows when the extracts held 36.9 M.

## M7 part C: Jump to row (2026-10-08)

**Results:** [`perf/results/2026-10-08-m7-jump.md`](../perf/results/2026-10-08-m7-jump.md)

**Surprises:**
- **One single-line input links three editors.** gpui-kit's `Input` element dispatches over its single-line, textarea, and code-editor states, so all three engines come along: search panels, LSP sync, completion lists, ropey. That's 194 KiB brotli for a box that takes digits, the largest single addition since M1. gpui-base's own `Input` element renders only the single-line state: with the menu rebuilt in 30 lines, it costs 88 KiB, and the menu is 2.1 KiB of that. The bulk was never the features we use.
- **Cmd shortcuts are compiled out of the web build.** gpui-kit gates them on `target_os = "macos"`, which wasm never is, so a Mac user's Cmd+A did nothing and their next Backspace ate one character. Cmd+V worked anyway, because an unbound Cmd+V falls through to the browser's paste event. That's also why `shared/` must not bind it: the `Paste` action reads the clipboard asynchronously, behind a permission.
- **A fix can show up as a wrong label.** The first Cmd bindings worked, but a screenshot of the context menu read "Win+A": a menu shows an action's latest binding, and wasm spells Cmd "Win". Binding them before `gpui_kit::init` fixed it. None of the checks would have caught it; only the screenshot did.
- **Focus restore runs after the frame that lost focus.** GPUI's focus-lost listeners run in the frame's focus phase, after render, so the published state said `null` for one frame. A check that read it once failed one run in two, and an instrumented counter showed the restore landing every time. The listener now notifies, and the check waits for the restored frame.
- **The panel trap from part B came back on the first try.** The focus check clicked the scrollbar track's center to focus the table, and that's under the open panel. Scripts now check targets against the panel's published bounds, and they focus the table through a jump.
- **The budget had already run out.** After the change, `check` read 196.5 ms against its 195.0 limit, but HEAD read 194.9 right after. Today's machine sits ~10% above the September baseline before any change, so a +3.4 ms change fails or passes on noise. A/Bs against HEAD in the same session are what separate the change from the machine. The decision: keep 195.0 as the target, accept part C's +3.4 ms, re-record the baseline when the machine is quiet, and win back the throttled +101 ms with part E's placeholder shell.
- **A focus fix can steal focus.** Tracking focus on the workbench's root, so lost focus had somewhere to go, also made the root take focus on every press that reached it: a click on the header strip took the table's arrow keys (code review). GPUI focuses a tracked element on mouse-down unless a listener that runs first prevents it. The root now prevents its own, and `jump.ts` presses the header and checks ArrowDown still scrolls; without the fix that check fails.
- **Jumps back to row 1 are always cached.** Its page stays in the 64 MiB cache after the middle and last jumps, so there's no fill to time. The script counts those jumps as cached instead of timing them.

## M7 part D: Hardening (2026-10-08)

**Results:** [`perf/results/2026-10-08-m7-hardening.md`](../perf/results/2026-10-08-m7-hardening.md)

**Surprises:**
- **DuckDB-Wasm lost rows without an error.** Past ~2.1 GiB of in-memory tables (its `memory_limit` says 3.1 GiB), `CREATE TABLE … AS` answered normally with empty tables: an 8.6 GB CSV reported "done" with 8.8 M rows missing. The plan expected the tab to run out of memory, loudly. The guard checks DuckDB's memory after every chunk and treats an empty chunk as out of memory.
- **One failed read breaks a file for good.** After a dropped connection, every later read of those bytes failed with a Thrift error, online, after re-registering the same URL under the same name, and with the external file cache off. Only a new SQL name read again. The first fix (same name) passed a probe that re-registered before anything re-read the bytes, and failed in the app, which re-registers after.
- **The planned fix measured as nothing.** In-flight tracking was meant to keep a replaced file's cancelled reads out of the next open, and part A's review thought they leaked into its "Read". A build without the wait read the same bytes and the same first rows. DuckDB's worker runs messages in order, and every queued poll was posted before the next open's. The negative control is what showed the check had no power, and the code went.
- **Unregistering doesn't free a footer.** `dropFile` and toggling the metadata cache left DuckDB's memory exactly where keeping the files did, to the 0.1 MiB, over 20 opens.
- **A stopped engine restarted itself, unseen.** The bridge forgot the dead worker as soon as it died, so the next stray page read started a new engine without the Parquet extension, and the app showed "ready". A check that counted engine starts between the stop and Retry caught it. The bridge now forgets an engine only after it has told a call that it stopped.
- **A rate limit can strand rows.** A 5 s guard against re-registering in a loop dropped the failure that came during it, and rows in view never retry by themselves. The guard now schedules the next try instead of dropping it.
- **The panel trap, a third time.** Retry, placed after a long status line, sat under the open panel and couldn't be clicked. It's now first in the centered row. The panel itself now keeps clear of the scrollbars.
- **Part B's "wheel at the end still redraws" was the panel.** With the panel closed, wheeling against the last row draws nothing. With it open, its 4 Hz refresh is a ~20 ms whole-window draw.
- **The scanner window wasn't the CSV fling's cost.** 1 MiB, 256 KiB, and 64 KiB gave the same frames during a throttled load. The long tasks are frames that take ~10 ms more work while loading; carried.
- **The code review found the stray-restart bug still open** behind its own check. Rust heard of a stopped engine only through a call whose future someone still awaited, and an open replaced mid-flight drops its futures. Every call's answer is now watched. The new check for that case passes without the fix too (the stop reaches Rust another way in that sequence), so the fix rests on the code path, and the results say so.
- **Chromium remembers a failed dynamic import.** Retry after the engine chunk failed to download failed at once, with no request. The review guessed it, and a check blocking the chunk proved it. The bridge now imports it again under a new query.
- **`check` failed twice after the review fixes, at 203 ms. It was load.** An interleaved A/B in the same minutes read this change at 193 ms and HEAD at 203.

## M7 part E: Close-out (2026-10-08)

**Results:** [`perf/results/2026-10-08-m7-close-out.md`](../perf/results/2026-10-08-m7-close-out.md)

**Surprises:**
- **The decision the plan expected to be close wasn't.** On Fast 4G the HTML arrives at 171 ms and the 2.8 MiB of wasm keeps the canvas blank until 3.7 s; an HTML copy of the shell paints 63 ms after the HTML. 3.46 s of blank page is the biggest number M7 has moved, and it moves without touching TTFP, so the metric the repo is built on never saw it.
- **The font can't be shared for free.** GPUI gets its font bytes through `fetch`, so the preload is `as=fetch`; CSS `@font-face` needs `as=font` and won't reuse it. A placeholder in Plex downloads Plex twice on the slow link it exists for.
- **The suite's first failure was the check.** The panel's wasm memory read 1.3 MiB under the script's in 2 of 10 throttled runs: the script read memory up to 250 ms after the refresh, while pages arrived. Wasm memory only grows, so reads just before and just after the refresh bracket what the panel saw.
- **The helpers had already agreed.** Part A's review found three mark readers disagreeing on first vs last entry; part D's Retry work had moved the outlier to "last" for its own reasons. Merging them changed no number, and cost 1.8 KiB.
- **A blocked event loop looks like a dead server.** The first A/B harness started the preview servers and ran `perf.ts` with `execFileSync` in the same process: every navigation timed out. The children must run async.
- **`check` failed again on the machine:** 201.6 ms, and HEAD read 197.1 in the interleaved A/B (this change 199.8). Three parts in a row now, the September baseline is the problem; today never got below load 2 to re-record it.
- **The code review found the suite trusting stdout.** It scraped `FAIL` blocks from each script's stderr, and `csv.ts` prints `N failure(s):` instead, so a failing CSV part would have kept one line of its failures. Each script now writes its `failures` into its results, and the suite reads them there. The review also caught the panel's new memory row clamping the panel's value into the bracket and comparing it to itself (it couldn't fail; now a range check, said as such), and the placeholder A/B timing with FCP, which the protocol rules out (now Element Timing: same numbers).
- **A worktree on a shared `target/` shipped HEAD's wasm.** The A/B build in a worktree overwrote the main tree's cargo fingerprints, and the next release build called itself fresh: same hash as HEAD's. Caught only because the hash matched the worktree's. Measurements before it were safe (built first); the trap is in CLAUDE.md's perf gotchas.
- **The manual check found what the suite couldn't.** Safari and Firefox passed everything, including a fling through the largest CSV as it loaded. But on Gaia, numbers wider than their column were cut at the front with no ellipsis: right-aligned cells spill left, so `45.12345678901234` can read as `5.12345678901234`. Every scripted check reads values through the bridge, never the drawn text, so none could see it. Part F fixes it and adds a check that compares shown text with values.

## M7 part F: Cell overflow (2026-10-09)

**Results:** [`perf/results/2026-10-09-m7-cells.md`](../perf/results/2026-10-09-m7-cells.md)

**Surprises:**
- **`.truncate()` was on every cell all along.** GPUI cuts text only when the text node's width is definite, and a flex item's isn't: it's measured at its full width. The fix was taking the flex off, not adding truncation.
- **Measuring first was the wrong plan.** Sizing each column to its widest value in the first pages covers only those pages: a jump, a sorted file, or a later CSV chunk shows wider ones. Rounding to a budget has no such gap, and costs a float format per too-long double instead of a measured page.
- **Parquet can't hold a HUGEINT.** DuckDB writes one as DOUBLE, and the CSV sniffer never picks it, so the integer middle cut is a fallback no source reaches today. The fixture tests a 38-digit DECIMAL instead.
- **CJK draws as boxes.** The fixture's Japanese column showed only tofu: the canvas has Plex (Latin, Greek, Cyrillic) and emoji. Not part F's, but a visitor's dropped file will show it; it's in the README's canvas tradeoffs.
- **The first negative control proved nothing.** `cargo fmt` had reflowed one match arm, the patch missed it, and the "old cells" build still rounded. 1,722 rounded doubles in the control's output gave it away; a control has to show it's the control.
- **The code review found a crash the checks couldn't.** A text value with a line break (a quoted CSV field) reached `shape_line`, which debug-asserts there's none: a debug build would abort on hover, and a release build showed one line with no "…" and no tooltip. Cells now show line breaks as `¶`. It also found a DECIMAL end cut losing the magnitude (now a middle cut), a tooltip that never came for a cell whose page landed after the delay, and a fixture branch that never rounded: DuckDB adds `0.1 + 0.2` as DECIMAL, exactly.
- **`max_w` on gpui-kit's `Tooltip` doesn't wrap its text.** It lays the text out in a flex row, so a long value drew as one line across the table, and in the dark theme it read as one more row (manual check). The content is now a width-capped block, with `shadow_lg`.
- **Root's tooltip layer is crate-private** in gpui-kit 0.7.1, so the table draws gpui-kit's `Tooltip` view itself, positioned by gpui-base's public `TooltipPositioner` in a `deferred`. It doesn't get the slide-in animation.

## M7 part G: Static placeholder shell and theme toggle (2026-10-09)

**Results:** [`perf/results/2026-10-10-m7-placeholder.md`](../perf/results/2026-10-10-m7-placeholder.md)

**Surprises:**
- **Every DPR 2 check passed while a DPR 1 screen jumped.** GPUI and the browser round half-pixels in opposite directions: half a CSS pixel at DPR 2, invisible; a whole one at DPR 1. A headed window, opened at the screen's real scale, showed it at once. The checks now run at both.
- **An inlined font still races the first paint.** A `data:` URL decodes asynchronously; Chrome sometimes painted the placeholder laid out in the fallback font's metrics (text invisible under `font-display: block`), then re-laid it out. `document.fonts.check()` said true before that paint. The first steadiness control missed it because the race is timing-dependent; serving the font 300 ms late made both arms deterministic.
- **The same font isn't the same text.** GPUI measures glyphs its own way (a label ~1 px narrower than Chrome's), rasterizes them itself (crisper, ~2 px lower at DPR 1), and rounds line heights to device pixels, half down. Boxes can match exactly; glyphs can't. Skeletons for the buttons and a fade for the rest beat any amount of nudging, and the nudges came out.
- **GPUI's layout rule was readable from outside.** Sampling the published button bounds over window heights 900–906 at DPR 1 and 2 gave it directly: line heights rounded to device pixels, positions of exactly x.5 rounded down. Copying it took four lines of script and a −0.03 px nudge.
- **The first comparison metric couldn't see real errors.** A whole-image differing share had a noise floor of 0.21% and moved 0.05% for a 1 px shift; a wrong title bar height didn't register. Splitting it by region (text and icons as ink boxes, skeletons as edges, the rest as shift-tolerant surfaces) and setting every limit from a negative control fixed that. Twice the controls showed a metric was being satisfied by noise (ink color, then a loose mass limit) rather than by the control.
- **A placeholder that costs nothing still moved TTFP,** through the wasm: the icon toggle cost +11.9 KiB where the same toggle as a text label cost +1.9 KiB, though the two SVGs are a few hundred bytes (likely GPUI's SVG path linking in; not profiled). The four-way A/B (HEAD, no placeholder, no pulse, full) is what separated them.
- **"Step away" isn't quiet.** With the usual apps open and nobody at the keyboard the load sat at 2–4 and TTFP at 195–210 ms; a baseline taken then (210.3) was thrown out. With them closed (load under 1) it read 195.3, matching the interleaved A/B. The September baseline (177.3) was a quieter machine, not a faster build: `check` had been failing on that for four parts. Re-recorded; `check` passes at 194.2. The re-record also caught a flake in part G's own check (the panel's placeholder row, filled when its mark arrives late).

## M8: Deploy to Cloudflare (2026-10-10)

**Results:** [`perf/results/2026-10-10-m8.md`](../perf/results/2026-10-10-m8.md)

**Surprises:**
- **Cloudflare's compression undid the budget.** Every local number assumed br at quality 11, which the preview server serves. Cloudflare compresses on the fly at a low level and picks zstd when Chromium offers it: the app wasm grew by a third on the wire, and the throttled TTFP gap to local (+1.1 s) was almost exactly that extra megabyte at Fast 4G. Static assets can't serve precompressed files; running the Worker first for the build can, at ~5 ms.
- **The zone injected a script.** Cloudflare Web Analytics added `beacon.min.js` to the HTML, which loaded before first paint and failed every cold run. curl never saw it (it was injected only into what Chromium got), and `Cache-Control: no-transform` on the page stopped it whatever the zone's settings.
- **"Within 15% of local" was a zero-network comparison.** 15% of 195 ms is one TLS handshake. Splitting TTFP at wasm ready showed where production's time goes, and that the app's own part didn't move at all. The same held for first rows: ~8 sequential range requests per first page, each a round trip.
- **R2 is the slow hop, not the Worker.** A range from R2 took 55–125 ms, a static asset 20–35. The edge cache (keyed by the file's SHA, so stable names stay safe) halved first rows; the first visitor at a data center still pays R2.
- **A string export broke `wrangler dev` but not production.** workerd treats every named export of the Worker module as an entrypoint; exporting a constant made the local runtime refuse to start, while the deployed Worker ran. The suite's local panel part caught it; Worker modules now export only functions.
- **Small Cloudflare details each cost a check run:** HEAD loses `Content-Length` on an encoded response (count a raw GET's bytes), a new version takes seconds to reach the edge (the deploy's check retries), and `git grep workers.dev` matches `workers_dev` (the dot is a regex; use `-F`).
- **Measurements against production move with the link.** The same build read 304.8 and 327.2 ms TTFP an hour apart; interleaving every production run with a local one is what kept the comparison honest.
