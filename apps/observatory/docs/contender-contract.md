# The contender contract

What every contender page publishes, so one metrics module, the Playwright scripts, and the observatory's page can measure any of them the same way (root `CLAUDE.md`, "Comparison protocol"). Contenders set marks and publish state; they compute no metric. How each metric is then read is under "Reading the metrics" below; the choices behind it are in [`DECISIONS.md`](DECISIONS.md), "Measurement".

The GPUI contender builds this from the tall table's events in its host; the TanStack contender from its own view. Names are the same on both sides.

## The measured-run switch

Always published, measured or not: every mark (the page's readouts and the replay hooks need `contender:filled`) and `globalThis.__contender` with `side` and `replay`. `?measure` in the URL adds what only a measurement reads: `__contender.state`, the targets, and on the DOM side the `elementtiming` attributes. Without it `state` is null. The cost of publishing is the same kind on both sides (a few property writes per frame).

## Marks

`performance.mark`s, set only by the contender. Two kinds:

- **Steps** (`contender:first-pixels`, `usable`, `open`): set once per load, again only on a retry. Readers take the last entry, as for every mark (root `CLAUDE.md`, "`shared/` and `shared-web/` conventions").
- **Events** (`contender:filled`): set every time it happens. A reader takes the first entry after the moment it times (the open, an input), as the harness's `waitMark(page, mark, since)` does; the last entry is only the latest fill.

| Mark | When | GPUI | TanStack |
|---|---|---|---|
| `contender:first-pixels` | The first frame with anything of the contender's own on screen. | `seiza:placeholder-painted`'s moment (the placeholder shell). | The prerendered first screen's paint (Element Timing on its first element). |
| `contender:usable` | The candidate moment of first usable: from here an input should change state within a frame or two. The scripts confirm it with a probe key press. | Right after GPUI's first frame (`gpui:first-frame`'s microtask). | The hydration commit. |
| `contender:open` | The contender starts opening the data file (the engine is ready). | The host's open call. | The same. |
| `contender:filled` | Right after a frame in which every visible row holds real data, each time the viewport becomes filled (after an open, a jump, a scroll that outran the cache). The first after `contender:open` is time to data. | Set from `TallTableEvent::Filled` with `mark_after_current_task`, so it lands right after the presented frame; checked against the GPU calls, as `tycho:viewport-filled` is. | Set in the commit that makes the visible rows real; its presentation is read from Element Timing on the cells that commit created. |

Marks reach the observatory's page by `postMessage` too: `parent.postMessage({ seiza: 'mark', name, at: performance.timeOrigin + startTime }, location.origin)`, one message per mark, `at` in epoch milliseconds because the page and the iframe have different time origins.

## State

`globalThis.__contender` (always; `state` only with `?measure`):

```ts
interface Contender {
  side: 'gpui' | 'tanstack';
  /** What the last presented frame showed (GPUI: updated while the frame
   *  renders; TanStack: in the commit). Replaced, never mutated in place. */
  state: {
    rows: number;        // the row count the view uses (after the open's count(*))
    top: number;         // the content's position, CSS px from row 0's top
    first: number;       // first visible row, 0-based
    end: number;         // one past the last visible row
    loaded: number;      // visible rows with real data
    pending: number;     // visible rows drawn as placeholders
    lastCell: string | null; // the key (spkid) of the last row, when it's visible
    cacheBytes: number;  // the page cache's Arrow IPC bytes (the 64 MiB budget's unit)
  } | null;
  replay: Replay;
}
```

The scripts record `state` with every frame through `shared-web/perf/`'s `frameRecorder` (`__seizaFrameSample = () => __contender.state`), as Tycho's `tableFrames` does: a frame showing placeholders, whether the view keeps up with the input, reach (`end === rows`, `lastCell` the file's last key), and the cache's bytes on both sides.

**The probe.** To find the first frame drawn at a new position, the scripts mark the frame in which `state.top` changes. On GPUI, `state` is read right after the task that made the frame's GPU calls (a microtask queued at its first call); on the DOM, in a rAF. Each is tied to that animation frame's presentation in Chromium's trace.

## Targets

`globalThis.__seizaTargets[id] = [x, y, width, height]` in CSS pixels, as every app does: `table` (the rows' area), `table-scroll-track` and `table-scroll-thumb` (the vertical scrollbar; GPUI from the table's `Scrollbar` event, TanStack from the scroller's geometry and the native bar's width). Republished when they change.

## Replay hooks

`__contender.replay`, for the page's benchmark (in-page, warm, labelled so); the published numbers come from Playwright driving real input instead.

```ts
interface Replay {
  open(): Promise<void>;                 // close and reopen the file; resolves at contender:filled
  fling(): Promise<void>;                // top to bottom in ~3 s; resolves once it rests at the end and fills
  jump(fraction: number): Promise<void>; // to that fraction of the rows (0.9: the 90% jump); resolves at contender:filled
}
```

Each side replays through its own input path: GPUI through script-made wheel events dispatched on its canvas (they reach GPUI's listeners); TanStack through its scroller's position (`scrollBy` each frame), since a script-made wheel event never scrolls a native scroller. One fling profile for both, defined in the metrics module: equal steps per frame, so no step outruns a native scroller's room (`dom-scroll-model.md`, "Scripting it").

## Reading the metrics

Chromium only, under the measurement protocol; the reasons and the numbers are in [`DECISIONS.md`](DECISIONS.md), "Measurement".

- **Input to visible response** (a key, a track press, a wheel event): Chromium's trace, `EventLatency` (categories `input` and `latencyInfo`): the event's own timestamp to the presentation of the frame it reached, for the input's type (`KEY_PRESSED`, `MOUSE_PRESSED`, and for the wheel `MOUSE_WHEEL` on GPUI and `FIRST_GESTURE_SCROLL_UPDATE` on a native scroller), the first that reached a frame (it carries a `display_trace_id`).
- **Every reading is guarded on every run** by an independent one that names the frame showing the new position: on GPUI the probe (it must match); on the DOM, for a main-thread move (the contender's keys) the probe, and for a native scroll (the wheel, a track press) the compositor's first frame that applied the scroll (`Scroll Delta This Frame` on the compositor thread, category `cc`, to the end of the next `SubmitCompositorFrameToPresentationCompositorFrame`). The main-thread probe can't guard a native scroll: the compositor moves the content first, by up to two frames, and on a session's first track press the main thread learns of it a frame after it's on screen.
- **→ that frame's rows being real:** GPUI, `contender:filled` after the input; TanStack, the latest Element Timing `renderTime` among the visible rows' cells created after the input.
- **Event Timing** (the page's `PerformanceObserver`) is only for the observatory page's live readouts of keys and presses: it rounds to 8 ms, drops anything under 16 ms, and has no wheel. The trace's `EventTiming` events carry the unrounded duration of every event and equal `EventLatency` for keys and presses.
- **Per-frame work:** the trace's `ProxyMain::BeginMainFrame` on the page's main thread, each frame's whole rendering update, itemized by its children: input dispatched in the frame (`WidgetBaseInputHandler::OnHandleInputEvent`), animate (`WebFrameWidgetImpl::BeginMainFrame`: rAF callbacks, scroll events), lifecycle (`WebFrameWidgetImpl::UpdateLifecycle`: style, layout, paint), and the rest (commit, bookkeeping). The rAF callbacks inside it (`FireAnimationFrame`) are what `workRecorder` and Tycho's panel time, and agree with them; the frame is more, on purpose.
- **Main-thread CPU:** the busy time of every task on the page's main thread (`ThreadControllerImpl::RunTask`), with the tasks outside any frame tallied by kind. Some work runs in no frame (on GPUI the engine's page results, read in wasm in the message's task, and timers), so frames × per-frame work undercounts it.
- **Trace categories:** `devtools.timeline` (the animation frames and their presentations, `FireAnimationFrame`), `blink.user_timing` (the marks, and the page clock's offset: `trace:origin`, set right after tracing starts), `input` and `latencyInfo` (`EventLatency`), `benchmark` (`BeginMainFrame`), `toplevel` (tasks); for latency also `cc` (the compositor's scrolling); for work also `blink` (the frame's parts, and what runs outside frames). `spike/latency.ts` is the reference reading until the metrics module replaces it.
