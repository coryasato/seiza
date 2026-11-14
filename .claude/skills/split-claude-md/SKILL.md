---
name: split-claude-md
description: Shrink what a CLAUDE.md costs every session. Split a large app's, component's, or the root's CLAUDE.md into per-folder CLAUDE.md files and path-scoped rules that load only when a matching file is read, then condense by sorting each piece into rule, procedure, reference, code narration, or stale. Includes an audit (nothing lost, nothing duplicated, no rule hidden by the layout). Use when asked to apply the observatory's CLAUDE.md pattern to the root, Tycho, Kirkwood, the tall table, or another app or component, or when a CLAUDE.md has outgrown a couple of thousand words.
---

# Shrink a CLAUDE.md: split it, then condense it

The model is `apps/observatory/`: its `CLAUDE.md` (about 1,200 words) holds the rules, a map of the folders, the rules whose cause is outside any folder, and a line per command; each folder's detail is in that folder's own `CLAUDE.md` (`web/`, `contenders/`, `contenders/tall-table/gpui/`, `…/tanstack/`, `metrics/`, `perf/`, `data/`, `worker/`). Read it before starting. The rule behind it is the root `CLAUDE.md`'s "Docs: one home per fact".

## How Claude Code loads each kind of file

From Claude Code's docs (`code.claude.com/docs/en/memory`, `…/skills`):

| Where | Loads |
|---|---|
| `CLAUDE.md` in the working directory or above it | at launch, every session |
| `CLAUDE.md` in a folder below the working directory | when Claude reads, writes, or edits a file in that folder (a `cat` or `head` of one file counts) |
| `.claude/rules/<topic>.md` with `paths:` (a YAML list of globs from the repo root, braces allowed: `"apps/*/worker/**"`, `"**/*.{ts,tsx}"`) | when Claude reads, writes, or edits a matching file |
| `.claude/rules/<topic>.md` without `paths:` | at launch, like a `CLAUDE.md`: saves nothing |
| `@path` imports | with the file that imports them: saves nothing |
| a skill's `SKILL.md` | its name and description at launch; its body when it's used |

Running a `just` recipe or a grep loads nothing, so a rule needed before any file is opened stays in a file that loads at launch. The docs aim for under 200 lines a `CLAUDE.md`; this repo writes a paragraph a line, so count words.

**Nested file or rule, by fit:** a concern of one folder goes in that folder's `CLAUDE.md`. A concern that spans folders or apps (the GPUI Kit gotchas, every Worker's Cloudflare gotchas, the comparison protocol) goes in a path-scoped rule whose `paths:` name every place it applies. Mixing the two is fine; a fact still lives in one of them.

One target a session, in two passes the user reviews apart: **the split** moves text verbatim, which the audit can prove lossless; **the condensing** is judgment, after the split is committed.

## Pass 1: the split

### 1. Measure

```sh
f=<dir>/CLAUDE.md
wc -w $f
awk '/^##+ /{if(n)printf "%-40s %6d\n",n,w; n=$0; w=0; next} {w+=NF} END{printf "%-40s %6d\n",n,w}' $f
awk '{printf "%3d %5d  %s\n", NR, NF, substr($0,1,90)}' $f   # every line: its number and words
```

Show the user a table: each section (and each long bullet: an architecture section is often one bullet per folder), its words, and where it would go; and what a typical session loads before and after. Agree on the homes before moving anything.

### 2. Map each piece to one home

- **Architecture and gotchas:** to the folder whose files the work reads, or a rule if they span folders. A section about two folders splits at a sentence boundary (the observatory's "Metrics" bullet: `metrics.ts` to `metrics/`, "The scripts:" on to `perf/`).
- **Commands:** to where the recipe's script lives (a check in `perf/` goes to `perf/`, even when it checks another folder's build); recipes that cross every folder (`check`, `lint`, `report`, `builds`) keep their full line at the top.
- **A small folder still gets its own file** if only its work needs the text (the observatory's `worker/` is 430 words).
- **Every nested file** starts with the same header, then its sections, a `## Files` block (its folder's line from the old Layout), and `## Commands`:

```markdown
# <What it is> (`<folder>/`)

<One sentence.> Claude Code loads this file when a file under `<folder>/` is read. The <app>'s rules and the map of its folders are in `<dir>/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `<dir>/`.
```

- **A rule file** has only `paths:` in its frontmatter, then a heading and the text, and the top file's map names it.

Do the move with a script that reads the old file by line number and writes each piece out, so no text is retyped. Keep a copy of the old file in the scratchpad.

### 3. Find the rules whose cause is outside their home

A rule moved into folder X is seen only when a file in X is read. Read every imperative in the moved text (the audit lists them) and ask: what change triggers it, and is that change made in X? The observatory's four that weren't:

- a gpui-kit bump (made in the root `Cargo.toml`) regenerates the TanStack contender's theme;
- a change to the UI font (`shared-web/`) or the component's cell text regenerates a fixture;
- a new path outside the app's prefix needs the zone's WAF rule before it deploys;
- a number on a page or in a doc is never typed.

Each goes into the top file's "When something outside a folder changes it", once, as the trigger and the command, pointing down for the detail; remove it from the nested text. Check first whether another `CLAUDE.md` or rule already carries it (the component's own often does for the component's side): then it needs no copy. A trigger that a path-scoped rule can catch (its cause is a file it can match) can be a rule instead.

### 4. Write the top file

Keep its intro and its rules, then: "Where the detail is" (a table: folder or rule, what it is, its file; and how a new component or folder joins it), "When something outside a folder changes it", a short Layout (one line a folder, naming its file), and Commands (one line each, recipes grouped, the home in brackets; the cross-cutting recipes' full lines). Aim for about 1,000–1,500 words; the root, about 2,000–2,500.

### 5. Audit

```sh
node .claude/skills/split-claude-md/audit.ts <dir> --base <commit with the unsplit file>   # HEAD until the split is committed
```

It reads the `CLAUDE.md` files under `<dir>`; add the rule files it should count to the check by hand (grep the old sentences in `.claude/rules/`).

1. **Sentences in no file:** each must be one you moved up, rewrote, or folded away on purpose; name them to the user. **In two files:** pick one home.
2. **Passages two files share** (headers and command lines apart): the run fails on any. Point instead of repeating, including where the top file restates a nested rule: say the trigger above, the mechanism below.
3. **Imperatives:** read every one against step 3.

Then:

- **References:** grep the repo (history files apart: `milestones.md`, `LESSONS.md`, `DECISIONS.md`, `perf/results/`) for citations of the old file's sections ("Stack", "Perf script gotchas", "`CLAUDE.md`'s …") and repoint them. A citation of the top file's rules still holds if the rules stayed.
- **Builds:** check that no build or deploy copies a whole folder that now holds a `CLAUDE.md` (Vite's `publicDir`, a stage script's walk, a Worker's assets directory, a crate's packaged files if it's ever published).
- **The repo's checks:** `node shared-web/scripts/check-terms.ts` (it covers every `CLAUDE.md`; no milestone IDs) and `node shared-web/scripts/report.ts <dir> --check` where the target has a report.

Report the before and after words and the audit's findings; give a one-line commit message (the user commits).

## Pass 2: condense by sorting

Go through each file a section at a time and put every piece in one bucket:

| Bucket | What it looks like | Where it goes |
|---|---|---|
| **Rule** | what must or mustn't be done, an invariant, a trap ("byte-identical", "never `toFixed`", "must not touch browser globals at import") | stays, short: the folder's file or a rule. One that a test, lint, or check could enforce is noted for a check (below) |
| **Procedure** | steps run the same way each time across several places (adding a scenario or level, a dependency bump, closing a milestone) | a skill, which loads only when used; the file keeps a one-line pointer |
| **Reference** | how something works that the code doesn't show at a glance: the why, a contract between two sides, what a metric means | if the work in the folder needs it every time, stays in its file, tightened; if rarely, a doc (`docs/<topic>.md`, its "Reference" home) with a one-line pointer |
| **Code narration** | a walk through modules and functions that restates what the code says (`foo.ts` (does X with Y, then Z)…) | deleted. Keep a map of a line per module, at most, where the names don't say it |
| **Stale** | history, what used to be, a goal that's gone, a "yet" that has happened | deleted (history has its own files) |

- **What a check covers** (long per-recipe lists in Commands) is reference whose home is the script's header and the justfile's comment above the recipe: confirm they hold it, then the `CLAUDE.md` line keeps one clause.
- **A rule that can be a check should be one:** a failing check is more reliable than a sentence weighed against others. Don't build it in this pass (it's code, and goes through `/code-review`); add it to the target's `PLAN.md`, with the rule's file and the check's shape.
- Rewrite in the repo's voice (its root `CLAUDE.md` and the user's memory: American English, current state only, no milestone IDs). Never drop a rule to save words: when unsure whether a sentence is a rule or narration, keep it.
- Show the user, per file, the before and after words and what went to each bucket, with the deleted narration's file and line range in the last commit so it can be checked.
