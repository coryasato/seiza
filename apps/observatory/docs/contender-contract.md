# The contender contract

What every contender page publishes, so one metrics module (`metrics/metrics.ts`), the Playwright scripts, and the observatory's page can measure any of them the same way (root `CLAUDE.md`, "Comparison protocol"). Contenders set marks and publish state; they compute no metric. How each metric is then read is under "Reading the metrics" below; the choices behind it are in [`DECISIONS.md`](DECISIONS.md), "Measurement".

The GPUI contender builds this from the tall table's events in its host; the TanStack contender from its own view. Names are the same on both sides.

## Where a contender lives

Each contender is a bare page at `/observatory/contenders/<component>/<stack>/` (the tall table's: `…/tall-table/gpui/`, `…/tall-table/tanstack/`), its build's base. What both load sits outside either base, at one path each, so the second to load finds it cached: the engine at `/observatory/duckdb/` (DuckDB-Wasm's bundles and extensions), the data at `/observatory/data/`, the font at `/fonts/`. The list is `contenders/paths.ts`.

## The measured-run switch

Always published, measured or not: every mark but the probe key's (the page's readouts and the replay hooks need `contender:filled`) and `globalThis.__contender` with `side` and `replay`. `?measure` in the URL adds what only a measurement reads: `__contender.state`, the targets, the probe key, and on the DOM side the `elementtiming` attributes on cells. Without it `state` is null. The cost of publishing is the same kind on both sides (a few property writes per frame).

## Marks

`performance.mark`s, set only by the contender. Two kinds:

- **Steps** (`contender:first-pixels`, `usable`, `open`): set once per load, again only on a retry. Readers take the last entry, as for every mark (root `CLAUDE.md`, "`shared/` and `shared-web/` conventions").
- **Events** (`contender:filled`, `input`): set every time it happens. A reader takes the first entry after the moment it times (the open, an input), as the harness's `waitMark(page, mark, since)` does; the last entry is only the latest fill.

| Mark | When | GPUI | TanStack |
|---|---|---|---|
| `contender:first-pixels` | The first frame with anything of the contender's own on screen. | `seiza:placeholder-painted`'s moment (the placeholder shell). | The prerendered first screen's paint: the Element Timing entry of its status line (`elementtiming="first-screen"`); its first contentful paint where there's no Element Timing (Firefox, WebKit). |
| `contender:usable` | The candidate moment of first usable: from here an input should change state within a frame or two. The scripts confirm it with the probe key (`contender:input`). | Right after GPUI's first frame (`gpui:first-frame`'s microtask). | The hydration commit (the view's first layout effect). It can come before the HTML's paint or after it. |
| `contender:open` | The contender starts opening the data file (the engine is ready). | The host's open call. | The same. |
| `contender:filled` | Right after a frame in which every visible row holds real data, each time the viewport becomes filled (after an open, a jump, a scroll that outran the cache). The first after `contender:open` is time to data. | Set from `TallTableEvent::Filled` with `mark_after_current_task`, so it lands right after the presented frame; checked against the GPU calls, as `tycho:viewport-filled` is. | Set in the commit that makes the visible rows real (or after a move no commit followed, into rows already drawn); its presentation is read from Element Timing on the cells that commit created. |
| `contender:input` | `?measure` only: the view handled the first key (any key) and committed the state it changed. The probe: a key right after `usable` should set it within two frames of the key's event; a key before `usable` shouldn't. The scripts press `PROBE_KEY` (`x`, a plain key event on both sides: GPUI hears a modifier alone only on its release). | The first key the window gets once `gpui:first-frame` is set (`intercept_keystrokes`, before anything handles it) notifies the host, and the host's next render sets the mark with `mark_after_current_task`, right after that frame's task. Later keys cost one check. | A small component of its own (nothing else re-renders) takes the first key in its state, from a listener added in the hydration commit; the commit that draws it sets the mark, in the key's task. Later keys cost nothing. |

| `contender:failed` | The view shows a failure: the engine didn't load or stopped, or the file didn't open. No `filled` is coming; the page unlocks its toggle on it. | The host's open failing, or `EngineStatus` turning `Failed` or `Stopped`. | The open failing (the engine's start or the file's). |

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

`state` is replaced only when something in it changed. GPUI writes it while the frame renders; TanStack in the animation frame after a commit or a move (so an idle page asks for no frames), from the paging's visible rows (`top` is the scroll model's V).

**The probe.** To find the first frame drawn at a new position, the scripts mark the frame in which `state.top` changes. On GPUI, `state` is read right after the task that made the frame's GPU calls (a microtask queued at its first call); on the DOM, in a rAF. Each is tied to that animation frame's presentation in Chromium's trace.

## The cell probe (GPUI only)

`?cells` (never in a measured run: the table then formats every cell twice) turns on the table's cell probe, and the GPUI contender publishes what it drew: `__contender.columns` (each column's `name`, `kind`, `width` in CSS px, and `budget`, the characters a float may take: the table's `ColumnProbe`s) and `__contender.cells` (every cell of the last frame: `row`, `column` by index, `exact`, `shown`). `perf/cell-fixture.ts` pins the tall table's cell fixture from them (`components/tall-table/fixtures/`); a DOM contender reads its budgets from that fixture, not from a page, and publishes neither.

## Targets

`globalThis.__seizaTargets[id] = [x, y, width, height]` in CSS pixels, as every app does: `table` (the rows' area: right of the row numbers, under the header, to the scrollbar), `table-scroll-track` and `table-scroll-thumb` (the vertical scrollbar; GPUI from the table's `Scrollbar` event, TanStack from the scroller's geometry, the native bar's width (an overlay bar counted 16 px), and the scroll model's estimate of the thumb). Republished when they change.

## Element Timing on cells (DOM only)

With `?measure`, each loaded cell carries `elementtiming="row:<row>"` (0-based), so the browser reports its first paint. Element Timing reports an element once, when it's first painted, so a row that loads gets new cells: its placeholder cells are keyed apart from its loaded ones, measured or not, and never turn real in place. A reader needs its own `PerformanceObserver` from the page's start (an init script): the entries' buffer holds 150, and one screen of cells is ~330.

## Theme

The page passes its theme in two ways, and a contender follows the system without either, so a bare page's cold runs don't change:

- **`?theme=light|dark`** when the frame loads, applied before the first screen paints: an inline script at the head of the `<head>` (`THEME_SCRIPT`, `contenders/contract.ts`) sets the root's `data-theme`, which the GPUI side's placeholder and body and the TanStack side's `theme.css` follow. The GPUI host reads it as it starts (`start`'s `theme`) and draws its first frame in it.
- **`{ seiza: 'theme', theme }` by `postMessage`** from the parent (same origin) for every later change (`followPageTheme`): the root's `data-theme` changes, and the GPUI host repaints its canvas in it (the wasm export `setTheme`; before the wasm has started, `start` reads the root's `data-theme`). The frame isn't reloaded, so its state and its warm cache stay. The page sends the theme again at the frame's `load`: a change made while the frame was loading reached no listener.

The GPUI host stops following the system once the page has given a theme (`seiza::stop_following_system_appearance`), as Tycho's toggle does.

## Replay hooks

`__contender.replay`, for the page's benchmark (in-page, warm, labelled so); the published numbers come from Playwright driving real input instead.

```ts
interface Replay {
  open(): Promise<void>;                 // close and reopen the file; resolves once the view is filled
  fling(): Promise<void>;                // top to bottom in ~3 s; resolves once it rests at the end and fills
  jump(fraction: number): Promise<void>; // to that fraction of the rows (0.9: the 90% jump); resolves once the view is filled
}
```

Each side replays through its own input path: GPUI through script-made wheel events dispatched on its canvas (they reach GPUI's listeners); TanStack through its scroller's position (the scroll model's `step`: a `scrollBy` each frame that the model takes 1:1, as a wheel's), since a script-made wheel event never scrolls a native scroller. "Filled" is the first `contender:filled` after the input, or at once when the view lands already filled (rows in the cache) or doesn't move, which sets no mark: the mark is a change to filled. One fling profile for both, the metrics module's (`FLING_FRAMES`, `flingStep`): equal steps per frame, so no step outruns a native scroller's room (`dom-scroll-model.md`, "Scripting it"). The Playwright scripts' fling is the same profile through real input.

## Reading the metrics

Chromium only, under the measurement protocol; the reasons and the numbers are in [`DECISIONS.md`](DECISIONS.md), "Measurement". `metrics/metrics.ts` computes each one from the marks, the recorded state, the cells' paints, and the trace; `perf/metric-*.ts` gather them, one script per metric, against either bare page (`perf/contender.ts`).

- **Time to first usable:** `contender:usable`, confirmed by the probe key pressed right after it: the frame that drew its change must be presented within two frames of the key's event (`firstUsable`). The frame, from a light trace through the load (`PROBE_CATEGORIES`): the animation frame `contender:input` lands in (GPUI), or the first that begins after it (the DOM's commit runs in the key's task) (`probePresented`). On GPUI the key's own `EventLatency` must end on that frame; the DOM's probe changes nothing visible, so its key reaches no presented frame and that reading is unguarded. First pixels is recorded beside it.
- **Time to data:** `contender:open` → every visible row painted with real data (`timeToData`): GPUI's first `contender:filled` after the open; on the DOM the latest Element Timing paint among the visible rows' cells (`rowsPainted`).
- **Behavior under load:** the fling, `FLING_FRAMES` wheel steps one per frame on a fixed schedule (not paced by each event's handling), `state` recorded as each animation frame starts (`underLoad`): late frames (intervals over 1.5 refreshes), the share of frames showing placeholder rows, how far the view trailed the input in fling steps (by the wheel events' summed `deltaY`, since a browser coalesces them), and the last input → the view at rest at the end, filled. Late frames come from the main thread's frames on both sides: Chromium's compositor frame reporter (`PipelineReporter`) doesn't see GPUI's canvas frames. Per-frame work and main-thread CPU over the fling, from the trace (below).
- **Reach and correctness:** `state.rows` against native DuckDB's `count(*)`, End showing the last row filled with the file's last key (`reach`).
- **Cost** over a session (the cold load, then the fling to rest): main-thread CPU from a trace started before the page loads, the load and the use apart; memory once open and at the end (`performance.measureUserAgentSpecificMemory`, the page's own and its workers' apart, plus Chromium's JS heap and DOM nodes); bytes received by kind: the page's own, the engine's (the same files on both sides), the data.
- **Input to visible response** (a key, a track press, a wheel event): Chromium's trace, `EventLatency` (categories `input` and `latencyInfo`): the event's own timestamp to the presentation of the frame it reached, for the input's type (`KEY_PRESSED`, `MOUSE_PRESSED`, and for the wheel `MOUSE_WHEEL` on GPUI and `FIRST_GESTURE_SCROLL_UPDATE` on a native scroller), the first that reached a frame (it carries a `display_trace_id`) (`readInputs`). The script starts the view mid-file (the replay's jump) and presses the probe key first, so no measured key is the first; each input sits in its own window, `input:<n>` right before it and `input:<n>:end` once the view moved, filled, and rested, before the next input's setup.
- **Every reading is guarded on every run** by an independent one that names the frame showing the new position: on GPUI the probe (it must match); on the DOM, for a main-thread move (the contender's keys) the probe, and for a native scroll (the wheel, a track press) the compositor's first frame that applied the scroll (`Scroll Delta This Frame` on the compositor thread, category `cc`, to the end of the next `SubmitCompositorFrameToPresentationCompositorFrame`). The main-thread probe can't guard a native scroll: the compositor moves the content first, by up to two frames, and on a session's first track press the main thread learns of it a frame after it's on screen.
- **→ that frame's rows being real:** GPUI, the presentation of the first `contender:filled` after the input, or the visible response itself when the frame that moved held no placeholder (the probe's mark says so: `probe:moved:<pending>`); TanStack, the latest Element Timing `renderTime` among the visible rows' cells created after the input (a visible row with no new cell was already real; after an open or a jump every visible row has one, landing within a few frames after `contender:filled`, `perf/tanstack-contract.ts` checks), or the visible response when no cell is new.
- **The page's live readouts** (`liveReadings`, `web/src/live.ts`): what a page can read of a frame, without `?measure` or a trace: usable from the frame's time origin (unconfirmed), open → the first `filled` after it (the DOM's at its commit), late frames from the page's rAF intervals while the visitor scrolls at the refresh they show, and the frame's own memory by `measureUserAgentSpecificMemory`'s attribution. Labelled "this tab", never mixed with the cold numbers.
- **Event Timing** (the page's `PerformanceObserver`) isn't used, not even by the page's live readouts: it rounds to 8 ms, drops anything under 16 ms, and has no wheel ([`DECISIONS.md`](DECISIONS.md), "Page"). The trace's `EventTiming` events carry the unrounded duration of every event and equal `EventLatency` for keys and presses.
- **Per-frame work:** the trace's `ProxyMain::BeginMainFrame` on the page's main thread, each frame's whole rendering update, itemized by its children: input dispatched in the frame (`WidgetBaseInputHandler::OnHandleInputEvent`), animate (`WebFrameWidgetImpl::BeginMainFrame`: rAF callbacks, scroll events), lifecycle (`WebFrameWidgetImpl::UpdateLifecycle`: style, layout, paint), and the rest (commit, bookkeeping). The rAF callbacks inside it (`FireAnimationFrame`) are what `workRecorder` and Tycho's panel time, and agree with them; the frame is more, on purpose.
- **Main-thread CPU:** the busy time of every task on the page's main thread (`ThreadControllerImpl::RunTask`), with the tasks outside any frame tallied by kind. Some work runs in no frame (on GPUI the engine's page results, read in wasm in the message's task, and timers), so frames × per-frame work undercounts it.
- **Trace categories:** `devtools.timeline` (the animation frames and their presentations, `FireAnimationFrame`), `blink.user_timing` (the marks, and the page clock's offset: `trace:origin`, set right after tracing starts), `input` and `latencyInfo` (`EventLatency`), `benchmark` (`BeginMainFrame`), `toplevel` (tasks); for latency also `cc` (the compositor's scrolling); for work also `blink` (the frame's parts, and what runs outside frames).
