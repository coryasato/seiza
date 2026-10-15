# The TanStack contender's scroll model

How the DOM side scrolls 1,567,523 rows of 30 px (47,025,690 px) natively, on the compositor, with the content moving 1:1 with the input (root `CLAUDE.md`, "Comparison protocol"). It was sized on the throwaway page in `spike/`, whose `src/scaled.ts` is the reference implementation; the numbers are in [`perf/results/2026-10-15-m1-a.md`](../perf/results/2026-10-15-m1-a.md), the choices in [`DECISIONS.md`](DECISIONS.md), "Scroll model".

## The browsers' limits

| | Tallest element | Past it | Wheel event |
|---|---|---|---|
| Chromium 153 | 33,554,428 px | clamped | any size |
| WebKit 26.6 | 33,554,428 px | clamped | any size |
| Firefox 155 | 17,895,696 px | **dropped**: the element lays out 0 px tall | at most one page (868 px in a 900 px scroller) |

So a plain native scroller over the full table loses its last ~0.45 M rows in Chromium and WebKit and doesn't scroll at all in Firefox.

## The model

```
scroller   native, overflow: auto           s = scrollTop, 0 … M = S − viewport
└ spacer   height S = 2^24 = 16,777,216 px
  └ content  absolute, translateY(base × 30 − D)
    └ row    absolute, translateY((row − base) × 30)
```

- **V** is the content's position (0 … T = rows × 30 − viewport), **s** the scroller's. V = s + D.
- **The canonical map** `anchorFor(V)` (V → s): 1:1 within Z = 2^20 px of either end, linear between (a stretch of 3.06; 2.80 overall). Its inverse is `valueFor(s)`.
- **Wheel, key, and touch move the content 1:1:** V = s + D with D fixed, so the compositor moves the rows and the main thread only fills them in. So does any step of at most a screen (a track press's page; the tail of a smooth scroll that outlived its input).
- **Re-anchor** when s has drifted more than P = 1,800 px (two screens) from `anchorFor(V)`, or is pinned at an end the content isn't at: `scrollBy` to `anchorFor(V)`, read `scrollTop` back (the browser rounds it), set D = V − s, and move the content's transform in the same task. The thumb moves back by at most P / M of its track (~0.1 px), and the content shouldn't move. At rest (150 ms with no scroll), re-anchor fully. Jumps (the ends, a jump to a row) go through the same `scrollBy`. Use `scrollBy`, not a `scrollTop` assignment: it composes with a scroll the browser is still animating, and the assignment lost input in Firefox and WebKit. The scroll event a re-anchor fires has no step from the s it set, and is ignored.
- **The thumb:** a step bigger than a screen with no wheel, key, or touch in the last 300 ms, or any scroll while the pointer is down on the scrollbar, maps s to V through `valueFor(s)`. One pixel of thumb travel is ~19,000 px of s, so a drag is never mistaken for a step; no browser event is needed to tell them apart.
- **The ends are exact:** s pinned at an end inside its zone puts V at that end. The zones (1:1, 1 MiB) mean a wheel event of up to Z near an end is never cut short.
- **The base row** moves when V is more than W / 4 rows from it, so no transform holds a coordinate past a few thousand rows.
- **Keys** are the contender's, not the browser's: ↑/↓ a row, Page Up/Down and Space/Shift+Space a screen (an instant `scrollBy`, so they stay 1:1 and on the compositor), Home/End with or without Ctrl, and Cmd+↑/↓, set V to an end. Native arrows move 40 px in Chromium, WebKit (under Playwright) doesn't arrow-scroll a focused element at all, and the browser's Ctrl+End runs the scroller to its end, not the content. (`scaled.ts`'s `keys: 'native'` keeps the browser's smooth keys, for measuring a re-anchor mid-animation.)

## TanStack Virtual over a moving window

`@tanstack/react-virtual` (pinned exactly) is given W = 4,096 rows around the base, not the full count: `count: W`, `observeElementOffset` subscribing to the model and reporting V − windowBase × 30, `scrollToFn` jumping the model. The full count costs ~30 MiB (a `Float64Array` of every row's start and size) and ~29 ms to build, for no saving in the fling. One catch: when the window moves, TanStack can see the same index range and skip its render; the subscriber forces one (`flushSync`) whenever the window's base or the content's base changed since the last render, or rows go stale under a fling.

## The drag settle

A scroll in thumb mode loads nothing until no scroll event has arrived for 80 ms (a resting pointer sends none); `pointerup`, where it arrives, ends the drag at once. Chromium, WebKit, and Firefox send `pointerdown` and `pointerup` to the scroller for a press on its scrollbar (Chromium and WebKit no `pointermove` during the drag); a Firefox drag released far below the window can lose its `pointerup` and snap the scroller back to 0. A press on the track pages the content 1:1, as the browser does, where the component jumps to the press: a base-level parity item.

## Scripting it

- **Drive a native scroller with raw `page.mouse.wheel` deltas.** Under Chromium's DPR 2 emulation the page's `deltaY` is half Playwright's delta, but a native scroller moves the whole of it, so the harness's `wheel()` (which doubles the delta for GPUI's listeners) scrolls the DOM side twice as far.
- **A fling of equal events reaches the end; the harness's `fling()` doesn't.** Its catch-up last event (up to ~4.4 M px) is clamped by the scroller's room. Firefox clamps every event to a page, so no scripted fling crosses the table there.
- **Headless browsers hide the scrollbar:** Playwright launches Chromium with `--hide-scrollbars`, and headless Firefox has only overlay scrollbars of no width. `spike/input.ts`'s `openWithScrollbars` turns Chromium's off; Firefox's drag needs a headed Firefox with `ui.useOverlayScrollbars: 0`.

## Size

React 19.3.1 and ReactDOM alone: 58.0 KB brotli. With TanStack Virtual, the model, and the rows: 68.0 KB, so the scroll model and TanStack add ~10 KB brotli (37 KB raw). The contender adds its data layer and theme to that; Arrow loads with the engine, after first paint.
