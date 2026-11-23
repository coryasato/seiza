# The fixtures' window tests (`src/state/fixtures/`)

Each feature's fixture run natively in a window of GPUI's test app, children of `src/state/fixtures.rs`. Claude Code loads this file when a file under `src/state/fixtures/` is read. The table's rules and the map of its folders are in `components/tall-table/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. `src/CLAUDE.md` and `src/state/CLAUDE.md` load with it. Paths are relative to `components/tall-table/`.

## Architecture

A file a feature, each built with its feature (`flash.rs` with `live` and `custom-cells`): it runs the feature's fixture and its controls against the pure functions, then draws the feature in a window over rows answered from memory or the paging scenarios' scripted delegate, driving the pointer with `simulate_event`, and checks what the fixture doesn't pin (the events, the frames asked for, the drawing, and its meeting with each other feature built). Each file's doc comment lists its checks.

## Gotchas

- **Keys go through the element's contexts only from a host view:** `select.rs` and `reorder.rs` put `TallTable` in a host view with an Escape binding of its own, so Escape's propagation is tested as a host sees it.
- **Subscribe as the table is made** to hear its first frame's events: `pin.rs`'s shell view does, for the first `Pinned`.
- **A table opened at its rows reads before the window has its size:** `copy.rs` opens it at 0 rows and gives it its rows once the window is sized, so only the first page is read; the test app is set up once a test and each case's window closed after it.
- **`live.rs`'s delegate's values say which read is on screen;** `flash.rs`'s source takes the values each test sets, on the test clock (`advance_clock`), so the tooltip through a re-read is tested there too.
- **`click.rs` hangs a gpui-kit `ContextMenuExt` round the table** in its host view, as a host would, and counts the menus its builder makes: the check that a stopped right or long press opens none.
- **Cmd+C and Ctrl+C are bound only with `copy` or `popover`,** so `select.rs` doesn't test them; `popover.rs` puts gpui-base's `TextSelectionLayer` in its host view, as `Root` draws it, to select and copy a part of the popover's text.
- **The test app's asset source loads nothing,** so an icon set at `new` never draws: `header_icon.rs` opens the table with no columns, gives the state its own source (`icon_state.assets`, as `sort.rs` does for `set_sort_icons`), then sets the columns. Its presses are made at the points the frame drew each icon's target, so the target is checked with the press. `popover.rs` does the same for the cue's open mark (`popover_state.assets`, set before `set_popover_cue`, which loads the path), and reads which mark a cell painted from `DrawnText::mark_look`.
- **A finger is a raw `TouchEvent`** (started, then ended; each touch its own `TouchId`): `header_tap.rs` sends it so GPUI's recognizer makes the tap or, after `advance_clock` past 500 ms, the long press, and the window's pointer reads touch; a mouse's press there is moved to first, so it reads mouse. Two taps within 16 px and 400 ms (wall time: the recognizer reads `Instant::now`) are a double tap.
- **A popover covers the rows under its cell:** a hover there is the popover's, not a cell's, so `popover.rs` hovers a row above the open one.
- **`DrawnText::glyphs` (with `popover`) is each painted glyph's x and alpha,** what the fade's tests read; a cell's whole record compared with its record at rest is the check that nothing else moved.
- **A value planted in `find.rs`'s source after the first page is read isn't drawn** until a page is read again: a drawing test plants, then reloads (`replace_rows`); its finds answer only when the test calls `answer`, so a test can leave one out across a cancel.

## Files

```
src/state/fixtures/ # paint.rs, live.rs, flash.rs, follow.rs, resize.rs, select.rs, sort.rs, pin.rs, density.rs, format.rs, copy.rs, reorder.rs, groups.rs, click.rs, hide.rs, find.rs, popover.rs, header_icon.rs, header_tap.rs (`clicks`' header tap, with `sort`, `resize`, `select`, and `header-icon`) and replace.rs (no fixture of their own: the window's checks only; `hide`'s `hidden` cases run in each fixture's own file; `replace.rs` in every build, its reads pinned by `paging.json`)
```

## Commands

They run in `cargo test -p seiza-tall-table` with their features on (`components/tall-table/CLAUDE.md`).
