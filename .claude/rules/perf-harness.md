---
paths:
  - "**/perf/**"
  - "apps/kirkwood/checks/**"
---

# The perf harness (`shared-web/perf/`) and headless Chromium

## The harness's app-agnostic half

An app's `perf/` keeps only what knows the app, and never redefines a helper from `shared-web/perf/`: look there first (the list below, then the module's exports).

- `protocol.ts`: throttle profiles, the DPR shim, `budgetLimits` over an app's `budgets.json`, run summaries, machine labels and the versions measured with.
- `trace.ts` (pure): Chromium's trace, each frame's main-thread work (`frameWork`), late frames.
- `harness.ts`: opening a page per the protocol, `firstDrawProbe` (TTFP's mark against the first GPU work), the perf panel's rows, target clicks, `wheel` and `gesture`, `waitMark`, `fling`, and the recorders (frames, work, `presentingTaskRecorder` (armed at a mark with `after`, so what's timed before it runs unwrapped) and `presentedMark` for marks set right after a presented frame, `presentedRecorder` for each presented frame's sample).
- `placeholder-shots.ts`: the placeholder shell against the first frame, in screenshots.
- `home-paths.ts`: home-directory paths in a built wasm, and its control (a package built without `trim-paths`).
- `serve.ts`: `serveApp` (with `lan`, at the machine's LAN address alone, not `localhost`: an insecure context; and `outDir`, another build such as an A/B's kept one), the counting proxy, and `startThrottlingProxy` (a profile's latency and shared download where Chromium's network emulation doesn't reach, such as a same-process frame's worker).

What it reads from an app: canvas controls are clicked through the bounds the app publishes to `globalThis.__seizaTargets[id] = [x, y, width, height]` (CSS pixels; `seiza::targets::publish`), and `frameRecorder` records whatever the app's `globalThis.__seizaFrameSample()` returns with each rAF, and times its own callback (`recorderCost`).

## Headless Chromium

- **Headless DPR emulation breaks GPUI's canvas sizing.** gpui-pre-web sizes the backing store from `ResizeObserver`'s device-pixel-content-box, which headless Chromium misreports under `deviceScaleFactor`. Real HiDPI browsers are fine. Measurements at DPR 2 hide `ResizeObserverEntry.prototype.devicePixelContentBoxSize` in an init script, which sends gpui-pre-web down its Safari path (`contentRect × devicePixelRatio`) and gives a true 2× backing store. `shared-web/perf/`'s `open` does this (`hideDevicePixelContentBox`); reuse it.
- **Headless DPR emulation also halves scripted wheel deltas.** Under Playwright's `deviceScaleFactor: 2`, Chromium delivers `mouse.wheel(0, 1000)` to the page as `deltaY` 500. A scripted fling or scroll then covers half the distance it claims. Chromium's gesture scroll (`Input.synthesizeScrollGesture`) reaches GPUI's listeners halved too. Scale deltas by `devicePixelRatio` (a gesture's distance and speed both, so it lasts as long); `shared-web/perf/`'s `wheel()` does this for a wheel and its `gesture()` (`scaleByDpr`) for a gesture, so reuse them for GPUI. A native scroller is the exception: it moves the whole of Playwright's delta whatever `deltaY` says, so `wheel()` scrolls it twice as far; drive a DOM scroller with raw `page.mouse.wheel` for distance. For how often a native scroller's side draws, don't: a bare `mouse.wheel` reaches its compositor only every other frame in headless Chromium, so a reading of its rate uses Chromium's gesture scroll (CDP `Input.synthesizeScrollGesture`, `gestureSourceType: 'mouse'`), which GPUI also takes as wheel events (`docs/DECISIONS.md`, "Comparison protocol").

## What every app's scripts meet

- **WebKit can deliver a scripted press before hover updates,** and GPUI fires a press only on a hovered element. Wait two frames after moving to a control before pressing it.
- **The placeholder shell hides the canvas until the first frame and fades out over 120 ms after it.** A script that screenshots the app or reads canvas pixels waits for `#seiza-placeholder` to be gone, not just for `gpui:first-frame` (`placeholder-shots.ts`). The placeholder checks run with `reducedMotion: 'reduce'`, which stops the skeleton pulse and the fade.
- **`workRecorder` (an init script) times every rAF callback that made a GPU call.** On Tycho's fling it matched the perf panel within 5% at p50 and p95 (the panel times from the shell's render to a microtask after the present). Both are the rAF callback only: the observatory's per-frame work (each frame's `BeginMainFrame` in Chromium's trace, with the input and the rendering update around the callback) runs ~0.4 ms more on the same fling, so `workRecorder`'s and the panel's numbers don't compare with the observatory's (`apps/observatory/docs/DECISIONS.md`, "Measurement").
- **The open perf panel swallows clicks under it.** Its bounds are `globalThis.__seizaPerfOverlayRect` (`[x, y, w, h]`, gone while hidden). Click only targets clear of it, or hide it first (`setPanel`), and have every check confirm the result, not the click: a click on the panel fails silently.
- **The perf panel publishes at its refresh (~4 Hz), not every frame:** `globalThis.__seizaPerfOverlay` (rows) and `__seizaPerfOverlayAt` (when they were taken; the live rows cover the 2 s before it). Compare a live row against your own measurement over that window. Load steps publish as rows under their own names.
- **An A/B against HEAD builds HEAD in a worktree with its own `target/`.** An app's justfile reads the wasm from the repo's `target/`, so a worktree build pointed there overwrote the main tree's fingerprints, and the next build in the main tree was called fresh and shipped HEAD's wasm (same hash). Give the worktree its own `target/`, or `cargo clean -p <app> -p seiza --release --target wasm32-unknown-unknown` after it, and check the built wasm's hash differs from HEAD's. Run each side's script asynchronously when the same process hosts the preview servers: `execFileSync` blocks the servers and every navigation times out.
