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
- **Cmd+C and Ctrl+C are bound only with `copy`,** so `select.rs` doesn't test them.

## Files

```
src/state/fixtures/ # paint.rs, live.rs, flash.rs, follow.rs, resize.rs, select.rs, sort.rs, pin.rs, density.rs, format.rs, copy.rs, reorder.rs, groups.rs, click.rs, hide.rs, and replace.rs (no fixture of their own: the window's checks only; `hide`'s `hidden` cases run in each fixture's own file; `replace.rs` in every build, its reads pinned by `paging.json`)
```

## Commands

They run in `cargo test -p seiza-tall-table` with their features on (`components/tall-table/CLAUDE.md`).
