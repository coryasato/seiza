---
name: split-claude-md
description: Split a large app's or component's CLAUDE.md into per-folder CLAUDE.md files that Claude Code loads only when a file in that folder is read, then audit the split (nothing lost, nothing duplicated, no rule hidden by the folder layout). Use when asked to apply the observatory's CLAUDE.md pattern to Tycho, Kirkwood, the tall table, or another app or component, or when a CLAUDE.md has outgrown a few thousand words.
---

# Split a CLAUDE.md into per-folder files

The model is `apps/observatory/`: its `CLAUDE.md` (about 1,200 words) holds the rules, a map of the folders, the rules whose cause is outside any folder, and a line per command; each folder's architecture, gotchas, and commands are in that folder's own `CLAUDE.md` (`web/`, `contenders/`, `contenders/tall-table/gpui/`, `…/tanstack/`, `metrics/`, `perf/`, `data/`, `worker/`). Read it before starting. The rule behind it is the root `CLAUDE.md`'s "Docs: one home per fact" ("Rules, architecture, gotchas, commands").

**Why it works:** Claude Code loads the `CLAUDE.md` files from the working directory up at the start, and a deeper folder's `CLAUDE.md` only when a file under that folder is read. Editing a file means reading it first, so a folder's rules arrive before its files change. Running a `just` recipe or a grep loads nothing, which is why some rules must stay at the top (step 3).

One app or component a session. Move the text verbatim; don't condense it in the same pass (condensing is a judgment the user reviews on its own, and a verbatim move is what the audit can prove lossless).

## 1. Measure

```sh
f=<dir>/CLAUDE.md
wc -w $f
awk '/^## /{if(n)printf "%-30s %6d\n",n,w; n=$0; w=0; next} {w+=NF} END{printf "%-30s %6d\n",n,w}' $f
awk '{printf "%3d %5d  %s\n", NR, NF, substr($0,1,90)}' $f   # every line: its number and words
```

Show the user a table: each section (and each long bullet: an architecture section is often one bullet per folder) with its words and which folder's work needs it, and the before/after of what a typical session loads. Agree on the folders before moving anything.

## 2. Map each piece to one folder

- **Architecture and gotchas:** to the folder whose files the work reads. A section about two folders splits at a sentence boundary (the observatory's "Metrics" bullet: `metrics.ts` to `metrics/`, "The scripts:" on to `perf/`).
- **Commands:** to where the recipe's script lives (a check in `perf/` goes to `perf/`, even when it checks another folder's build); the recipes that cross every folder (`check`, `lint`, `report`, `builds`) keep their full line at the top.
- **A small folder still gets its own file** if only its work needs the text (the observatory's `worker/` is 430 words).
- **Every nested file** starts with the same header, then its sections, a `## Files` block (its folder's line from the old Layout), and `## Commands`:

```markdown
# <What it is> (`<folder>/`)

<One sentence.> Claude Code loads this file when a file under `<folder>/` is read. The <app>'s rules and the map of its folders are in `<dir>/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `<dir>/`.
```

Do the move with a script that reads the old file by line number and writes each piece out, so no text is retyped. Keep a copy of the old file in the scratchpad.

## 3. Find the rules whose cause is outside their folder

A rule moved into folder X is seen only when a file in X is read. Read every imperative in the moved text (step 5's audit lists them) and ask: what change triggers it, and is that change made in X? The observatory's four that weren't:

- a gpui-kit bump (made in the root `Cargo.toml`) regenerates the TanStack contender's theme;
- a change to the UI font (`shared-web/`) or the component's cell text regenerates a fixture;
- a new path outside the app's prefix needs the zone's WAF rule before it deploys;
- a number on a page or in a doc is never typed.

Each goes into the top file's "When something outside a folder changes it", once, as the trigger and the command, pointing down for the detail; remove it from the nested text. Check first whether another `CLAUDE.md` already carries it (the component's own often does for the component's side): then it needs no copy.

## 4. Write the top file

Keep its intro and its rules as they are, then: "Where the detail is" (a table: folder, what it is, its file; and how a new component or folder joins it), "When something outside a folder changes it", a short Layout (one line a folder, naming its file), and Commands (one line each, recipes grouped, the folder in brackets; the cross-cutting recipes' full lines). Aim for about 1,000–1,500 words.

## 5. Audit

```sh
node .claude/skills/split-claude-md/audit.ts <dir> --base <commit with the unsplit file>   # HEAD until the split is committed
```

1. **Sentences in no file:** each must be one you moved up, rewrote, or folded away on purpose; name them to the user. **In two files:** pick one home.
2. **Passages two files share** (headers and command lines apart): the run fails on any. Point instead of repeating, including where the top file restates a nested rule: say the trigger above, the mechanism below.
3. **Imperatives:** read every one against step 3.

Then:

- **References:** grep the repo (history files apart: `milestones.md`, `LESSONS.md`, `DECISIONS.md`, `perf/results/`) for citations of the old file's sections ("Stack", "Perf script gotchas", "`CLAUDE.md`'s …") and repoint them to the folder's file. A citation of the top file's rules ("the observatory's CLAUDE.md, rule 2") still holds if the rules stayed.
- **Builds:** check that no build or deploy copies a whole folder that now holds a `CLAUDE.md` (Vite's `publicDir`, a stage script's walk, a Worker's assets directory, a crate's packaged files if it's ever published).
- **The repo's checks:** `node shared-web/scripts/check-terms.ts` (it covers every `CLAUDE.md`; no milestone IDs) and `node shared-web/scripts/report.ts <dir> --check` where the target has a report.

## 6. Finish

Report the before/after words, the audit's findings and what was done with each, and anything left for later (condensing, the next target). Give a one-line commit message; the user commits.
