# Who Tycho is for

The people Tycho is built for, what each comes to do, and what each needs from it. A reference to come back to while the app is built: when a feature is weighed, ask which of these people it serves; when one of them can't do their job, the gap is a need to add here.

This file holds **needs**, in the person's terms ("read a long cell in full"). What gets built, in what order, and its state are `PLAN.md`'s; a need becomes a feature only there, and this file doesn't track which are done.

**Adding a person:** ask how they'd use Tycho and why, why they wouldn't use their normal tools, and what's missing for them. The answers are the entry.

---

## The quick checker

Has a file and a question, and ten minutes: an analyst with a CRM export, an operations person with a log dump. "Is the March data in here?", "are there duplicates?", "what's in this column?"

- **Why Tycho:** it's a link. Nothing to install, nothing uploaded, which matters most on a work laptop where neither is allowed. A spreadsheet stops near a million rows and rewrites types; a notebook needs an environment and code for every look; DuckDB's command line needs an install and fluent SQL.
- **Needs:**
  - open the file and see rows at once, whatever its size
  - a profile of each column before asking anything: type, nulls, distinct values, range, top values
  - find a value, filter, sort
  - totals of what's selected
  - group by a column and count or total another (a pivot)
  - a chart of the answer
  - come back to their work: a link to the view, or the view saved in their own browser if they ask for it
  - take the answer away: a piece of the file, or the view as SQL to continue in their own tool
- **Where Tycho stops:** after the first look. Repeatable analysis, modeling, and a report to share belong to their normal tools; Tycho hands off to them.

## The ML engineer

Looks at data before trusting it: a training set before a run, eval or prediction logs after one.

- **Why Tycho:** these files are large and rarely opened, because opening them means a notebook and a wait. The private ones (eval runs, proprietary data) can't go to a hosted viewer. A dataset on a hub can be looked at from its URL without downloading it.
- **Needs:**
  - JSONL, the everyday format of the field
  - open one row and read it in full: prompts and completions are long, and a row of fixed height cuts them off
  - nested values shown readably: lists, structs, embeddings
  - label balance, nulls, duplicates, text length spread, outliers
  - filter to the failures, sort by loss or confidence, read the worst rows
  - group the failures by category, to see where a model fails
  - a random sample of rows: a sorted file scrolled from the top is a biased slice
  - two files at once: two eval runs compared by id, train checked against test for leaked duplicates, two versions of a dataset compared for a changed schema or a shifted spread of values
  - a dataset split across many files, opened as one
- **Where Tycho stops:** images and audio in cells; anything that trains or scores.

## The investigator

Starts from a large file (a leak, a records request, a public registry) and looks for connections in it.

- **Why Tycho:** the file can't be uploaded anywhere, and it's too big for a spreadsheet. The log of every step is a record of how a finding was reached.
- **Needs:**
  - filter by a cell: click a value, see every row that shares it, in every open file; exclude it
  - search across every column for a name
  - spot patterns in text: emails, addresses, phone numbers, IP addresses
  - counts over time, to see bursts
  - several files, and joins between them: connections usually run between datasets
  - fuzzy matching: one person spelled three ways (DuckDB has the string-similarity functions; the work is the catalog's)
  - mark rows: bookmarks, tags, notes
  - messy inputs: bad encodings, spreadsheets, JSON
  - export the rows that make the case
- **Care owed:** a leak is where hostile text hides. If this person drives Tycho with an agent, cell text written to steer a model matters most here.
- **Neighbors:** OCCRP's Aleph and Datasette serve parts of this work; Tycho's edge is no install, no upload, and large files.
- **Where Tycho stops:** a graph of who is linked to whom is the natural end of this road, and a long way off.

## Why anyone exports

Every person above ends by taking something away; without that the answer stays on the screen and Tycho is a dead end, not a step in their work.

- a piece small enough for someone else's tool: the 2,000 rows that matter, as a CSV a spreadsheet opens
- evidence: the rows that fail a check, sent to whoever owns the data
- conversion: CSV to Parquet (several times smaller), Parquet to CSV for tools that read only that
- a cleaned copy: sensitive columns dropped, duplicates removed, before sharing
- a sample: a thousand rows as a test fixture, or one percent to prototype on
- a split: train and test, or a file per category
- a small answer for a report or an assistant: an aggregate as a short table

Not every export is a file: the selection copied, the view as SQL, a link to the view.
