# The bridge (`bridge/`)

The host-side crate `tall-table-bridge`: the table's events turned into a seiza host's marks, globals, and clipboard writes. Claude Code loads this file when a file under `bridge/` is read. The table's rules and the map of its folders are in `components/tall-table/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `components/tall-table/`.

## Architecture

What a seiza host does with the table's events, written once for every host (Tycho, the observatory's GPUI contender, the bare host). It depends on `seiza` and the table, so it can't live in either (`docs/DECISIONS.md`, "Hosts"). `Publish` sets the marks, the scrollbar's targets, and each feature's globals, on names the host gives; `js` turns the probes into JS values for a host that puts them somewhere of its own; with `copy`, `clipboard::Clipboard` writes a copy to the clipboard. What each sets, and the clipboard's paths, are in `src/lib.rs`'s and `src/clipboard.rs`'s doc comments. A host's own state and panel rows stay in its own `match`.

## Rules

- **A global is set before its mark** (`live`'s highest generation drawn before the refreshed mark, `follow`'s flag and tail before the tail mark, `sort`'s order before its mark), so a script that waits on the mark reads the global it goes with. A JS value's shape is its fixture's where one spells it (a selection as `fixtures/selection.json` does).
- **`Publish::event` is `#[inline]`:** its unused arms fold away in each host.
- **The clipboard's write opens at `Started`,** in the task that asked (a key's, so the browser still counts the gesture), as a `ClipboardItem` whose promise resolves at `Copied` and rejects at `Failed` or when the table closes, leaving the clipboard as it was. Without `ClipboardItem`, `writeText` at `Copied`, which lands only within ~5 s of the key. A host hands `Clipboard` each `TallTableEvent::Copy` (`Publish` drops them) and tells it when the table closes (`closed`). When it can't write (no `navigator.clipboard`, or the browser refuses while the copy runs), `event` returns the copy for the host to cancel (`cancel_copy`). The outcome's callback runs outside GPUI, when the browser settles the write; the paths are in `src/clipboard.rs`'s doc comment.

## Files

```
  bridge/           # tall-table-bridge: src/lib.rs (Publish, js), src/clipboard.rs (`copy`'s writer)
```
