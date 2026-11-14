---
name: milestone
description: Open, plan, and close a milestone in an app's, component's, or engine's PLAN.md. Use when starting a milestone, splitting its spec into parts (one session each), naming a component's milestone or commit, finishing a part, or closing a milestone (its results note, decisions, lessons, report, and the spec's move to milestones.md).
---

# A milestone: open, plan in parts, close

The rules every milestone follows (one at a time, its checks restated at the start and their evidence shown at the end) are in the root `CLAUDE.md`, "Working agreements"; where each fact goes, in its "Docs: one home per fact". These are the steps between.

## Where it lives

A component's or engine's work is a milestone in its own `PLAN.md` when it has one, else in the app that drives it. A component measures what's its own (each feature's added wasm and frame work, in a bare host) in its own `perf/results/`; each app measures a feature against its own budgets when it adopts it, in its own `perf/`. Outside its own files, a component's milestone is named with the component ("tall-table M<n>"), and its commits start with its name (`tall-table: … (M<n>)`).

## Plan in parts, one session each

When a milestone's spec and "done when" checks are written (after its research, if it has one), split the work into Part A, Part B, … in order, each one session's worth: what it builds and the checks it closes (A1, B1, …), with the research and spec as Part A when the milestone opens with research. Each part ends with its results note (if it measured, from `docs/templates/app/perf/results-note.md`) and a `docs/LESSONS.md` entry; the milestone closes after the last. A part that a measurement shows is needed (a fix, a path a check asked for) is specced and inserted before the close. The tall table's `docs/milestones.md` has worked examples.

## Close

The last milestone closes before the next one starts. Close by the PLAN's own "Closing a milestone" line: every PLAN has one (from its template, `docs/templates/app/PLAN.md` or `docs/templates/component/PLAN.md`), with the steps that app or component closes with. A showcase's has no results note and no `report` (it's exempt from rule 3); a component's flips each waiting app's "Waiting on" row to *Ready*.
