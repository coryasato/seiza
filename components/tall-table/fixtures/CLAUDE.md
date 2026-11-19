# The fixtures (`fixtures/`)

What "the same" means for a DOM contender, pinned in JSON and run natively against the table. Claude Code loads this file when a file under `fixtures/` is read. The table's rules and the map of its folders are in `components/tall-table/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. So does `.claude/rules/comparison-protocol.md`. Paths are relative to `components/tall-table/`.

## Where each fixture comes from

`fixtures/README.md`'s table says, for each fixture, what it pins, its native test, and which parts are by hand and which a recipe writes; its sections give the formats. Never hand-edit a value a recipe writes: change its source and run the recipe (`--check` compares).

`sort.json`'s orders are tested in the bare host (`host/crate/src/rows.rs`), whose in-memory order the scripts sort. `just observatory fixtures` runs the first three (`paging.json`, `cells.json`, `sql.json`) and `copy.json`'s native test (the TanStack contender's test runs `selection.json`, `cells.json`'s `resize`, and `copy.json` against its wide level's ports).

## Files

```
  fixtures/         # paging.json, cells.json, sql.json, paint.json, selection.json, sort.json, pin.json, density.json, copy.json, reorder.json, group-headers.json, find.json; README.md (the formats)
```

## Commands

The recipes that write `paint.json`, `density.json`, and `cells.json`'s advances run from `perf/` (`perf/CLAUDE.md`); `cells.json`'s drawn cells, from the observatory.
