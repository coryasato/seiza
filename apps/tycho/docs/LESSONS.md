# Lessons learned

One entry per milestone, written before starting the next one: what surprised us, the numbers, and the decisions made. Raw measurements live in `perf/results/`.

<!-- Template:
## M<n>: <title> (YYYY-MM-DD)

**Numbers:** TTFP ref/throttled, wasm brotli, plus milestone-specific metrics.
**Decisions:** what we chose and the measurement behind it.
**Surprises:** what didn't go as expected, including upstream issues hit.
-->

## M0: Empty GPUI Kit shell on the web (2026-09-23)

**Numbers:** release wasm 9522.8 KiB raw / 3740.2 KiB gzip / **2615.6 KiB brotli** (first build 2589.2 KiB; the overlay-layer fix added +26.4 KiB brotli); JS 18.9 KiB brotli; UI font 69.3 KiB brotli (full IBM Plex Sans Regular, not subset). TTFP isn't measured to protocol until M1. Single cold smoke runs saw the first-frame mark at 437–1147 ms (release, headless). Details: `perf/results/2026-09-23-m0.md`.

**Decisions:**
- **Nightly Rust, dated** (`nightly-2026-09-20` in `rust-toolchain.toml`). `gpui-pre-web` enables its `multithreaded` feature by default. That pulls in `wasm_thread`, which uses `#![feature(stdarch_wasm_atomic_wait)]`, and we can't turn it off through `gpui-kit`. Upstream's story-web is on nightly for the same reason.
- **Lockfile pinned to gpui-kit 0.6.4's published set.** `gpui-kit = "=0.6.4"` alone still let caret requirements float `gpui-component`/`gpui-base` to 0.6.6 and `gpui-pre-*` to 0.3.6. We seeded `Cargo.lock` from the crate's own published lock, so the whole family (gpui-pre 0.3.5, wasm-bindgen 0.2.121) is what 0.6.4 shipped with. `wasm-bindgen-cli` must match the lock exactly (0.2.121).
- **WebGL2 forced, single-threaded platform.** `WebPlatform::new_with_backend_and_font_fallback(false, WebGl, Emoji)`. GPUI's default probes WebGPU first and falls back to WebGL2; the project targets WebGL2, and the probe costs an adapter request on every cold start. M1 should measure `Auto` vs `WebGl` before this is final.
- **The one UI face is IBM Plex Sans Regular,** because `gpui-pre-web` maps `.SystemUIFont` to that family. Bundling it means no theme font override is needed. The JS host fetches it in parallel with the wasm and passes the bytes to `start`, rather than `include_bytes!`. That keeps it out of the wasm, and lets M1 preload it.
- **First-frame mark:** `AppShell`'s first render requests a rAF. That callback sets `performance.mark("gpui:first-frame")` directly, then resolves a promise the post-paint hook awaits, so the mark never waits on executor scheduling. The first draw happens synchronously inside `cx.open_window`, outside any rAF, and presents nothing. It's presented by GPUI's frame-loop rAF, which `WebWindow::new` requested earlier. rAF callbacks run in request order, so the mark lands just after the first present. That depends on the order of registration: re-check it on every gpui-kit bump, and M1's overlay-vs-Playwright comparison is the guard. (Our first write-up said the first render ran inside a rAF. The code review caught that it doesn't.)
- **`AppShell` renders the overlay layers.** In 0.6.4, `Root` doesn't draw the sheet, dialog, or notification layers; the view under it must call `Root::render_*_layer`. Without that, `open_dialog`/`push_notification` update state but nothing appears. Cost: +26.4 KiB brotli. Verified by pushing a notification from `after_first_paint`.
- **The theme follows live light/dark changes** through `observe_window_appearance` → `Theme::sync_system_appearance`. gpui-pre-web listens to `prefers-color-scheme` and fires the observer.
- **Smoke checks that the canvas followed each resize, not exact device pixels.** It checks the CSS box matches the viewport and the backing/CSS ratio holds from first paint. A negative control (canvas pinned at 1440×900) fails in every engine.

**Surprises:**
- `wasm-opt` rejected the release wasm ("Atomic operations require threads") until we passed `--enable-threads`. `wasm_thread`'s atomics end up in the binary even on the single-threaded platform. Browsers accept atomics on non-shared memory.
- No `gpui_kit::open_window` in 0.6.4 (the skill docs describe a later API). The window root is `cx.open_window(...)` returning `Root::new(view, …)`.
- In 0.6.4, `Theme::change`'s `.SystemUIFont` probe (`theme/system_font.rs`) skips itself when no fonts are installed, so init may no longer panic on an empty font database. We still load fonts before init, as the rule says, because the first measured text needs the family either way.
- The debug wasm is 128.6 MiB. Dev loads are slow (~2–4 s to first frame) but fine. If it becomes painful, try `opt-level = 1` for dependencies in `[profile.dev.package."*"]`.
- **Headless DPR emulation breaks GPUI's canvas sizing.** gpui-pre-web sizes the backing store from `ResizeObserver`'s `device-pixel-content-box`. In headless Chromium with `deviceScaleFactor: 2`, that box reports CSS pixels while `devicePixelRatio` is 2, so GPUI draws 2× layout into a 1× backing store. `--force-device-scale-factor=2` does the reverse. Playwright's Firefox `deviceScaleFactor` loses DPR after `setViewportSize`; the `layout.css.devPixelsPerPx` pref is consistent. The M0 screenshots from the first run show it: Chromium's text was twice WebKit's size. This blocks the protocol's reference run (headless Chromium at DPR 2) and is a pending M1 decision.
- `build.rollupOptions` is a deprecated alias in Vite 8 (Rolldown). `onwarn` goes in `build.rolldownOptions`.
- The wasm is big: 2.6 MiB brotli for an empty shell. That's the M1 baseline to beat. Obvious candidates: `opt-level` s vs z, font subsetting, and checking what gpui-component's `init` pulls in (all components' actions and keybindings).

## M1: First-paint baseline and perf overlay skeleton (2026-09-23)

**Numbers:** baseline TTFP **177.3 ms** reference and **3465.2 ms** throttled (median of 10, Chromium headless=new, true DPR 2), wasm **2619.5 KiB** brotli. M0's single cold runs were 437–1147 ms, at DPR 1 with WebGL2. The overlay added +2.1 KiB brotli. Details and every experiment: `perf/results/2026-09-23-m1.md`.

**Decisions:**
- **The graphics backend mattered most, not the profile.** GPUI's `Auto` (WebGPU, WebGL2 fallback) beat forced WebGL2 by 40% reference (173.5 vs 291.0 ms) and 8% throttled, at the same size. WebKit: 296 vs 412 ms. Firefox's headless adapter is blocklisted, so it falls back at no measurable cost. M0 forced WebGL2 to skip the probe. The probe turned out to be cheap, and the WebGL2 path's first draw is what's slow.
- **`opt-level = "z"`** over "s": "s" is 8.6% bigger and slower on both runs. The other profile settings (`lto`, `codegen-units = 1`, `panic = "abort"`, `strip`, `wasm-opt -Oz`) were already on from M0 and weren't re-tested one by one.
- **Preloading the wasm and font** saves ~10 ms reference and ~188 ms (5%) throttled. They must be `as=fetch crossorigin` to match the `fetch()` that uses them, or they download twice.
- **Kept:** the full font face (a subset saves 0.6% throttled but loses Greek and Cyrillic for user data) and release logging (0.8 KiB, no TTFP cost, and it's how a backend fallback shows up).
- **Budget check:** `just tycho check` = lint + build + a 10-run reference perf pass against `perf/baseline.json`. Size increases are accepted by a row in `perf/budget-notes.md`.

**Surprises:**
- **M0's first-frame mark was right on WebGL2 only by luck.** GPUI's window starts at 0×0, so `open_window`'s synchronous draw shows nothing. The first real draw happens in gpui-pre-web's `ResizeObserver` callback, which renders and presents synchronously. With WebGPU it can happen in GPUI's rAF instead, and GPUI first presents an empty frame there. The M0 mark (a rAF requested from the first render, via a spawned task) landed a frame late on WebGPU. Requesting that rAF synchronously made it a frame *early* on WebGL2. The fix is a microtask queued by the first render with a real viewport. It runs right after the callback that presents. The probe in `perf.ts` found both bugs: it hooks WebGL2 draws and WebGPU submits and checks the mark against them on every run. My first two versions of the probe were wrong too: "within 8 ms of the first GPU call" fails when a long callback is still one frame. The right check is a window from a GPU task's last call to its microtask checkpoint.
- **Headless DPR 2 took one line.** Deleting `ResizeObserverEntry.prototype.devicePixelContentBoxSize` makes gpui-pre-web use its Safari path, which is consistent under emulation. So the M0 blocker didn't need headed runs or a `shared/` patch.
- **`vite preview` doesn't compress.** It served the 9.5 MB wasm raw, which would have made the throttled run meaningless. Brotli quality 11 on the wasm takes 19 s, so it's cached by content hash and filled by `asset-sizes.ts` during the build.
- **Noise is close to the budget.** Reference medians for one config across the session ranged 170–191 ms (±6%), against a 10% budget. M2's "within 5% of baseline" check will need more runs or several interleaved A/B passes to be meaningful.
- GPUI logs `[WARN]` lines on WebGL2 ("Dual-source blending not available…"). The perf suite ignores GPUI's own warnings but fails on browser warnings, like an unused preload or an `instantiateStreaming` fallback.
- The Cmd+Shift+P toggle works without clicking the canvas first; gpui-pre-web's input mirror has focus from load. Firefox on macOS keeps Cmd+Shift+P for a private window, so the docs point to Ctrl+Shift+P or `?perf` there.

## M2: DuckDB in a worker, prefetched after first paint (2026-09-23)

**Numbers:** reference TTFP **168.7 ms** (−4.8% vs the 177.3 ms baseline; earlier runs of M2 gave 170.7 and 180.7 ms, so this is noise, not a speedup), throttled **3493.0 ms** (+0.8%). Interleaved A/B against a rebuilt M1, 20 runs each: 170.0 vs 173.8 ms median (+2.2%). App wasm **2631.8 KiB** brotli (+12.3 KiB for all of M2's Rust). Engine ready **622 ms** reference, **9.7 s** throttled. `SELECT 42` round trip 3.0 ms; cancel stops a query in 4.7 ms (Chromium median). DuckDB loads 5.3 MB brotli after first paint (EH wasm 5065 KiB, worker 152 KiB, JS 38 KiB). Details: `perf/results/2026-09-23-m2.md`.

**Decisions:**
- **Hand-rolled Arrow IPC reader.** arrow-rs 60 (ipc + array + schema, default features off) costs +127.3 KiB brotli more, because it brings chrono, half, flatbuffers, and arrow-select/data/buffer. The reader walks the flatbuffer metadata by hand and keeps each column as byte ranges into the one IPC buffer, decoded per cell. Types it doesn't show decode as a named placeholder column instead of failing the whole result.
- **No fourth bridge call to start the engine.** `bridge.ts` loads DuckDB on its first call, and the post-paint callback's warm-up (`SELECT 42 AS x`) is that call. The warm-up's answer is checked in Rust before the UI says "Engine ready", so "ready" means a query made the whole round trip.
- **Pending-query API, one connection per query.** `startPendingQuery` → `pollPendingQuery` → `fetchQueryResults` gives raw IPC bytes, so JS never decodes Arrow. Separate connections let queries interleave and be cancelled one at a time, which M4's page cache needs.
- **DuckDB-Wasm 1.32.0, pinned exactly.** npm's `latest` tag is a dev build.
- **The DuckDB wasm bundles go to R2 in M8** (32.7 and 37.5 MiB, over Cloudflare's 25 MiB asset limit). The build names them instead of failing.

**Surprises:**
- **A failed engine load hung the UI forever.** The negative control (block DuckDB's wasm or worker in Playwright) caught it: DuckDB-Wasm never rejects `instantiate` when its worker dies. The worker fetches its wasm in a promise nothing awaits, so a failed fetch is just an unhandled rejection inside the worker. Fix: run DuckDB's worker script inside a small classic worker that reports unhandled rejections as errors, and race `instantiate` against the `Worker`'s `error` event. The wrapper had to be a blob: URL: as a Vite worker entry, Vite's dev server serves it as an ES module, which can't `importScripts`. Both controls now run in `just tycho engine`.
- **`perf.ts` measured the wrong wasm.** It took the first `.wasm` in `dist/assets` as the app's, and with DuckDB in the build that became DuckDB's 5 MB wasm. The size budget would have compared the wrong file. It now picks `tycho_bg-*.wasm`.
- **The protocol matters for engine timing.** Playwright's default Chromium (the old headless shell) loaded DuckDB about 3× slower (~1970 ms) than `channel: 'chromium'` (headless=new, ~620 ms). `engine.ts` uses headless=new, like `perf.ts`.
- **`range(1e10)` doesn't bind in DuckDB** (`1e10` is a DOUBLE). The long query is `range(10000000000)`.
- **Firefox cancels in ~97 ms in the release build**, every run, but 0.6 ms against the dev server. It's under the 200 ms budget; the cause is unknown (likely where the cancel lands in DuckDB's poll slice). Worth a look if M4's scrolling cancels feel slow in Firefox.
- The decoder matched DuckDB's real output for all 17 test columns on the first try; the unit tests against arrow-rs-written streams had already caught the two bugs. One: Rust's `Display` for `f64` writes 1e300 as 301 digits, so floats print with `Debug` (shortest round-trip, with an exponent). Two: float32 must stay `f32`, or 0.1 prints as 0.10000000149.
- Playwright traces record no network unless `snapshots: true`.
- **Parquet isn't built into DuckDB-Wasm.** Only `core_functions` is statically linked. The first Parquet call silently autoloaded the extension from extensions.duckdb.org, which the self-hosting rule forbids and which would have made M3 depend on a third-party CDN. The code review caught it; autoload is now off, and M3 self-hosts the extension.
- **The code review found gaps the tests didn't:** a cancel during the result-fetch phase was ignored; a worker dying after load would hang its queries; `registerFile(url)` accepted a 404 (and Vite's SPA fallback answers every unknown path with `index.html` and a 200); the reader's offset math could wrap on wasm32's 32-bit `usize` (the native tests run 64-bit); and the traced perf run counted toward the median. All fixed; see the decisions log.
- The engine JS chunk (38 KiB br) carries apache-arrow, which DuckDB's JS API imports but Tycho never calls. It loads after first paint, so it only costs engine-ready time. It could be trimmed later.

## M3: Asteroid sample over HTTP (2026-09-24)

**Numbers:** sample click → schema **87.8 ms** median reference (budget 300), 1012.0 ms throttled. **34,759 bytes (0.098%)** of the 35.5 MB file transferred before the schema showed. Reference TTFP 190.1 ms (+7.2%), but an interleaved A/B against a rebuilt M2 gives 186.2 vs 186.9 ms (+0.4%): the machine was loaded, not slower code. App wasm **2637.6 KiB** brotli (+5.8 KiB). The Parquet extension (EH) is 487 KiB brotli, loaded right after engine ready. Data: 1,567,523 asteroids, fetched 2026-09-24. Details: `perf/results/2026-09-24-m3.md`.

**Decisions:**
- **Range reads only.** DuckDB-Wasm 1.32.0 with default settings downloaded the *entire* file to show its schema: it misreads its own `bytes=0-0` probe (it looks for the total in Content-Length) and falls back to a full GET. `filesystem: { reliableHeadRequests: true, allowFullHTTPReads: false, forceFullHTTPReads: false }` makes it size files with a ranged HEAD and read only the footer. The Worker answers a ranged HEAD with 206.
- **The Worker parses `Range` itself.** R2's `get(key, { range: request.headers })` returns the whole object for a multi-range or past-the-end header, with no error. That would go out as a false 206. PLAN.md's Hosting section is corrected.
- **Self-hosted Parquet extension**, pinned by SHA-256, served from our origin; DuckDB's extension repository points there with autoload on. Rust prefetches it (`LOAD parquet`) right after the warm-up, so a warm click doesn't wait for it, and an early click still works through autoload.
- **The credit rides in the Parquet file** (`tycho.credit`, `tycho.fetched` key/value metadata), so the header reads it with SQL: no manifest fetch, no new bridge call.
- **Data scripts in TypeScript**, `prep.sql` on `@duckdb/node-api` 1.4.x (same DuckDB line as the wasm engine). Dev keeps one origin by proxying `/data/*` from Vite to `wrangler dev`, and the Worker falls through to static assets, so M8 adds config, not code.

**Surprises:**
- **Playwright doesn't see DuckDB's requests** (sync XHRs inside its worker). Its network log showed one "200, whole file" request that the server never sent. Bytes are now counted at the server, with a counting proxy in `perf/sample.ts`.
- **The M3 transfer check can't hold as written.** "Footer + first row group < 2%": row group 0 is 9.5% of the file at 122,880 rows per group, and a `LIMIT 50` pulled ~5.5 MB with readahead. It passes for M3 only because M3 shows no rows. It's now an M4 decision (row-group size, ~20k rows for 2%).
- **WebKit lays the first frame out before the window's real size:** the button's first bounds were off-screen (−91, 1271) at 1440×900. My first early-click runs "failed" in WebKit because the harness clicked there. It may affect what WebKit's first-frame mark means; check before quoting WebKit TTFP.
- **`execFileSync` from a script that hosts the preview server deadlocks it.** The A/B harness hung until it used async `execFile`.
- **The CSV fixture defeats DuckDB's sniffer:** the tricky rows come after 1.5M quote-free rows, so auto-detect picks no quote character. Good for M6: the CSV path can't rely on sniffing a prefix.
- **The code review found what my checks couldn't:** autoload of an extension we don't host got Vite's `index.html` as "wasm"; the byte count skipped requests still streaming at the frame, the exact shape of the bug M3 found (it now has a negative control); R2's clamping was verified only in Miniflare. All fixed; see `perf/results/2026-09-24-m3.md`.
- **The load average (5–12) made the first budget check fail** at 222 ms. The A/B is the tool for telling load from regression; a single protocol run on a busy machine isn't.
