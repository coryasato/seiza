# The fixtures (`fixtures/`)

What "the same" means for a DOM contender, pinned in JSON and run natively against the table. Claude Code loads this file when a file under `fixtures/` is read. The table's rules and the map of its folders are in `components/tall-table/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. So does `.claude/rules/comparison-protocol.md`. Paths are relative to `components/tall-table/`.

## Fixtures

**The fixtures** (`fixtures/README.md`) pin what a DOM contender must match. `cells.json`'s drawn cells come from the observatory's GPUI contender (`just observatory cell-fixture`; `--check` compares); its `rounding` cases, `paging.json`, and `sql.json` (whose test is the DuckDB engine's, where the SQL is written) are edited by hand. `paint.json`'s cases and stops are by hand and its expectations come from Chromium (`just tall-table paint-fixture`; `--check` compares). `selection.json`, `sort.json`, `pin.json`, `density.json`, `copy.json`, and `reorder.json`'s cases are by hand (`density.json`'s `number_px` from the bare host in Chromium: `just tall-table density-fixture`; `--check` compares); `sort.json`'s orders are tested in the bare host (`host/crate/src/rows.rs`), whose in-memory order the scripts sort. `just observatory fixtures` runs the first three and `copy.json`'s native test (the TanStack contender's test runs `selection.json`, `cells.json`'s `resize`, and `copy.json` against its wide level's ports).

## Files

```
  fixtures/         # paging.json, cells.json, sql.json, paint.json, selection.json, sort.json, pin.json, density.json, copy.json, reorder.json: what "the same" means for a DOM contender; README.md (the formats)
```

## Commands

The recipes that write `paint.json`, `density.json`, and `cells.json`'s advances run from `perf/` (`perf/CLAUDE.md`); `cells.json`'s drawn cells, from the observatory.
