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
- **Keys** are the contender's, not the browser's: ↑/↓ a row, Page Up/Down and Space/Shift+Space a screen less a row, as the tall table pages (an instant `scrollBy`, so they stay 1:1 and on the compositor), Home/End with or without Ctrl, and Cmd+↑/↓, set V to an end. Native arrows move 40 px in Chromium, WebKit (under Playwright) doesn't arrow-scroll a focused element at all, and the browser's Ctrl+End runs the scroller to its end, not the content. (`scaled.ts`'s `keys: 'native'` keeps the browser's smooth keys, for measuring a re-anchor mid-animation.)

## TanStack Virtual over a moving window

`@tanstack/react-virtual` (pinned exactly) is given W = 4,096 rows around the base, not the full count: `count: W`, `observeElementOffset` subscribing to the model and reporting V − windowBase × 30, `scrollToFn` jumping the model. The full count costs ~30 MiB (a `Float64Array` of every row's start and size) and ~29 ms to build, for no saving in the fling. One catch: when the window moves, TanStack can see the same index range and skip its render; the subscriber forces one (`flushSync`) whenever the window's base or the content's base changed since the last render, or rows go stale under a fling.

## The drag settle

A scroll in thumb mode is a drag: the model tells the paging (`onDrag` → `TablePaging.startDrag`), and the drag ends at `pointerup`, after 80 ms with no scroll event (the paging's drag settle: a resting pointer sends none, and a release can go missing), or at a wheel, a key, or a touch (none comes from a held thumb). While it lasts, reads wait for the pointer to rest 80 ms, or for the release, as the tall table's do. Chromium, WebKit, and Firefox send `pointerdown` and `pointerup` to the scroller for a press on its scrollbar (Chromium and WebKit no `pointermove` during the drag); a Firefox drag released far below the window can lose its `pointerup` and snap the scroller back to 0.

## The track press

The tall table jumps to a press on its track, the thumb centered on it, and drags that thumb while the press is held; the browser pages toward the press instead, and no browser lets the page cancel that (`preventDefault` on `pointerdown` or `mousedown` changes nothing). So the model jumps first: in the press's `pointerdown` it `scrollBy`s the scroller so the thumb is centered under the pointer and maps the step through the thumb path in the same task (a quick release then ends the drag and loads at once). With the thumb under the pointer the browser has nothing left to page toward, except where noted:

- **On the bar** is a press whose target is the scroller itself, in the bar's strip (its width, or the last 16 px for an overlay scrollbar) above any horizontal bar. A hidden overlay scrollbar (macOS's, until the pointer or a scroll brings it up) lets a press through to the cells, which then isn't the bar's.
- **The thumb** is estimated, at least 24 px long (the browsers' are 22–26 px at their shortest, which a scaled table's always is); a press within 4 px of it is left to the browser, which grabs it.
- **Arrow buttons:** a classic scrollbar's ends may be arrow buttons (Windows), so a press within the bar's width of either end is left to the browser, a line's step. Their length isn't taken off the track the thumb is estimated on, so where there are buttons a jump lands up to a button's length off.
- **The grab after the jump** is the browser's: Chromium grabs the thumb under the pointer with classic scrollbars and pages a little with overlay ones; Firefox sends the page its `pointermove`s, and the model drags the thumb itself; WebKit pages on toward the pointer (twice, after an exact jump). Steps of at most the scroller's height (a browser's page step is at most that; Chromium's is 87.5% of it, more than the rows' viewport in a scroller under 240 px) while the jumped press is held, and until the scroller rests after it, are that paging and move nothing. A drag step is more wherever the table is scaled (a thumb pixel is ~9,500 px of scroller here); in a table short enough for a thumb pixel to be less, a drag right after a jump would be taken for paging. Pointer capture doesn't bring Chromium's or WebKit's moves either. So a press jumps everywhere; a held press then dragged follows the pointer in Chromium (classic scrollbars) and Firefox only.

A press at a fraction of the track lands where the canonical map puts it: at 30% of the track, 27.5% of the rows (the 1:1 end zones), where the tall table, linear, lands at 30%.

## Shift+wheel

Shift turns a vertical wheel sideways, as the tall table does, where the platform hasn't already (macOS turns a mouse's itself; a trackpad sends its own sideways deltas). That needs a listener that can cancel the wheel, and a listener without `passive` makes the browser wait for the page before every scroll, so it's added only while Shift is down. WebKit can't let the page cancel a wheel in the frame Shift went down (it hasn't seen the listener yet): that one scrolls the rows, as the browser would. Shift pressed while another frame or window had the keys (the observatory page around the contender's frame) is seen on the first wheel, which scrolls the rows; the next goes sideways.

## Scripting it

- **Drive a native scroller with raw `page.mouse.wheel` deltas.** Under Chromium's DPR 2 emulation the page's `deltaY` is half Playwright's delta, but a native scroller moves the whole of it, so the harness's `wheel()` (which doubles the delta for GPUI's listeners) scrolls the DOM side twice as far.
- **A fling of equal events reaches the end; the harness's `fling()` doesn't.** Its catch-up last event (up to ~4.4 M px) is clamped by the scroller's room. Firefox clamps every event to a page, so no scripted fling crosses the table there.
- **Headless browsers hide the scrollbar:** Playwright launches Chromium with `--hide-scrollbars`, and headless Firefox has only overlay scrollbars of no width. `spike/input.ts`'s `openWithScrollbars` turns Chromium's off; Firefox's drag needs a headed Firefox with `ui.useOverlayScrollbars: 0`.
- **An overlay scrollbar takes a press only while it's shown** (Chromium and WebKit on macOS): bring it up with a wheel there and back, a frame apart, and the pointer over it (`perf/tanstack-parity.ts`'s `showBar`), or the press lands on the cells; it can still fade out before the press (`downOnBar` checks the press's target and tries again).
- **WebKit's scripted wheel can take ~80 ms to arrive**, as long as the drag settle, so a wheel meant to land inside a drag may arrive after it ended; a key arrives at once.

## Size

React 19.3.1 and ReactDOM alone: 58.0 KB brotli. With TanStack Virtual, the model, and the rows: 68.0 KB, so the scroll model and TanStack add ~10 KB brotli (37 KB raw). The contender adds its data layer and theme to that; Arrow loads with the engine, after first paint.
