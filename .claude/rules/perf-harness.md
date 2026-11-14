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
