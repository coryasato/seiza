# Kirkwood's Worker (`worker/`)

The Cloudflare Worker that serves Kirkwood under `/kirkwood/` on Tycho's hostname, and its bucket. Claude Code loads this file when a file under `worker/` is read. Kirkwood's rules and the map of its folders are in `apps/kirkwood/CLAUDE.md`, the repo's in the root `CLAUDE.md`, the gotchas every Worker meets in `.claude/rules/cloudflare.md`; all apply here. Paths are relative to `apps/kirkwood/`.

## Architecture

Why each: `docs/DECISIONS.md`, "Hosting".

- **A Worker of its own (`kirkwood`) on one route,** `tycho.seiza.io/kirkwood*`, which runs before Tycho's Worker; a path that only starts with those letters is the WAF's to block and the Worker's 404. Neither app's deploy touches the other. The hostname's WAF rules and rate limit are shared and run first: a new path goes into Tycho's host's rule before it deploys (the gitignored root `docs/private/zone.md`).
- **The Worker runs first for every request and takes the base off** (`web/src/base.ts`): web/dist's files have no base in their paths. A browser that takes br gets a build file's quality-11 `.br`; `/kirkwood` is a 301 to the base; anything else, a path with an empty segment among them, is a 404, never the page.
- **The three files are in R2** (`kirkwood-data`, bound as `KIRKWOOD_DATA`), each as it is and as `<name>.br`, served whole under `data/`, `no-cache` with R2's ETag (a held copy is a 304, on `If-None-Match` alone: never hand R2 the request's headers, or any failed condition reads as a held copy). Only the names in `src/names.ts` are served.
- **Paused** (the secret `DATA_PAUSED` at `1`), a file is a 503 with `X-Kirkwood-Paused: 1` and nothing reads R2; the page still loads.

## Gotchas

- **`wrangler dev` re-encodes what the Worker sends,** so the bytes on the wire locally aren't production's: the slow-link check runs through `vite preview` (`see --worker` refuses `slow`).
- **The note of what the local bucket holds is in Miniflare's own state** (`.wrangler/state/kirkwood-put.json`), and `scripts/dev.ts` asks the Worker for each file once it's up: a note kept elsewhere outlives a cleared bucket. Each file is read against the manifest's SHA-256 before anything is put.
- **What a script in Node shares with the Worker is in `src/names.ts`:** `src/index.ts` needs the Worker's types, which a Node script's and the checks' TypeScript projects don't have.
- **Never the account's default Workers hostname:** `workers_dev` and `preview_urls` stay off, and wrangler's output is never pasted with an account ID in it (root `CLAUDE.md`, "Stack and pins").

## Files

```
  worker/
    wrangler.toml        # the routes, the static assets (web/dist), the bucket
    src/index.ts         #   the Worker
    src/names.ts         #   the files' names, the precompressed extensions, the pause's header
    scripts/stage.ts     #   the build's .br copies, and the bucket's objects from data/
    scripts/dev.ts       #   stages, fills Miniflare's R2, starts `wrangler dev` through shared-web/perf/wrangler.ts (the checks' --worker starts it too)
    test/index.test.ts   #   the Worker against a fake bucket and fake static assets
```

## Commands

From the repo root.

```
just kirkwood worker          # the release build behind the Worker, at http://127.0.0.1:8788/kirkwood/; run `build` first
just kirkwood see --worker    # the checks against that, not `vite preview` (checks/CLAUDE.md)
just kirkwood test            # the Worker's unit tests run after the crate's (alone: node --test apps/kirkwood/worker/test/index.test.ts)
```
