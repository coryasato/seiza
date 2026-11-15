# Kirkwood's Worker (`worker/`)

The Cloudflare Worker that serves Kirkwood under `/kirkwood/` on Tycho's hostname, and its bucket. Claude Code loads this file when a file under `worker/` is read. Kirkwood's rules and the map of its folders are in `apps/kirkwood/CLAUDE.md`, the repo's in the root `CLAUDE.md`, the gotchas every Worker meets in `.claude/rules/cloudflare.md`; all apply here. Paths are relative to `apps/kirkwood/`.

## Architecture

Why each: `docs/DECISIONS.md`, "Hosting".

- **A Worker of its own (`kirkwood`) on one route,** `tycho.seiza.io/kirkwood*`, which runs before Tycho's Worker; a path that only starts with those letters is the WAF's to block and the Worker's 404. Neither app's deploy touches the other. The hostname's WAF rules and rate limit are shared and run first: a new path goes into Tycho's host's rule before it deploys (the gitignored root `docs/private/zone.md`).
- **The Worker runs first for every request and takes the base off** (`web/src/base.ts`): web/dist's files have no base in their paths. A browser that takes br gets a build file's quality-11 `.br`; `/kirkwood` is a 301 to the base; anything else, a path with an empty segment among them, is a 404, never the page.
- **The three files are in R2** (`kirkwood-data`, bound as `KIRKWOOD_DATA`), each as it is and as `<key>.br`, under a key with the file's hash in it (`src/versions.ts`, from `data/MANIFEST.json`: never overwrite an object a live Worker reads, and never take the key from anywhere else), served whole under `data/`, `no-cache` with R2's ETag (a held copy is a 304, on `If-None-Match` alone: never hand R2 the request's headers, or any failed condition reads as a held copy). Only the names in `src/names.ts` are served.
- **Paused** (the secret `DATA_PAUSED` at `1`), a file is a 503 with `X-Kirkwood-Paused: 1` and nothing reads R2; the page still loads, and says the data is paused where it would count the dots. That answer is what `web/src/main.ts`'s `paused` reads: change both together. The switch is Tycho's recipe, which sets both Workers' secrets (`just tycho pause`, `resume`): one hostname, one switch.
- **A deploy puts an object only when its bytes' SHA-256 isn't the one it was put at,** by a note in the bucket itself (`put.json`, never served), then deploys the Worker and checks production (`scripts/deploy.ts`, `scripts/check.ts`). A note that's missing or unreadable means every object is put again. A file that changed is put beside the old one, whose objects stay until `deploy --prune` (only once the deploy is the one to keep: a rolled-back Worker reads the old keys). The page isn't the build's until the edge has the new version, so the check waits on the page first, then reads everything once. The bucket was made once (`wrangler r2 bucket create kirkwood-data`); no S3 keys are needed.

## Gotchas

- **`wrangler dev` re-encodes what the Worker sends,** so the bytes on the wire locally aren't production's: the slow-link check runs through `vite preview` (`see --worker` refuses `slow`).
- **The note of what the local bucket holds is in Miniflare's own state** (`.wrangler/state/kirkwood-put.json`), and `scripts/dev.ts` asks the Worker for each file once it's up: a note kept elsewhere outlives a cleared bucket. Each file is read against the manifest's SHA-256 before anything is put.
- **What a script in Node shares with the Worker is in `src/names.ts`:** `src/index.ts` needs the Worker's types, which a Node script's and the checks' TypeScript projects don't have.
- **The check of what's deployed is production's alone** (`scripts/check.ts`): it reads the bytes on the wire, which `wrangler dev` re-encodes. Against the local Worker (`--url http://127.0.0.1:8788 --no-waf`) only the build files' encodings fail.
- **Never the account's default Workers hostname:** `workers_dev` and `preview_urls` stay off, and wrangler's output is never pasted with an account ID in it (root `CLAUDE.md`, "Stack and pins").

## Files

```
  worker/
    wrangler.toml        # the routes, the static assets (web/dist), the bucket
    src/index.ts         #   the Worker
    src/names.ts         #   the files' names, the precompressed extensions, the content types, the pause's header
    src/versions.ts      #   each file's key in the bucket, from the manifest's hash
    scripts/stage.ts     #   the build's .br copies, and the bucket's objects from data/
    scripts/dev.ts       #   stages, fills Miniflare's R2, starts `wrangler dev` through shared-web/perf/wrangler.ts (the checks' --worker starts it too)
    scripts/deploy.ts    #   the bucket's changed objects, `wrangler deploy`, then check.ts
    scripts/check.ts     #   production against web/dist and data/
    test/index.test.ts   #   the Worker against a fake bucket and fake static assets
```

## Commands

From the repo root.

```
just kirkwood worker [--paused]   # the release build behind the Worker, at http://127.0.0.1:8788/kirkwood/ (--paused: with the pause on); run `build` first
just kirkwood deploy [--dry-run] [--skip-check] [--prune]   # release build, the bucket, `wrangler deploy`, the check; needs `wrangler login`
just kirkwood deployed [--whole]  # the check alone, against the build in web/dist (the one deployed)
just kirkwood see --only paused   # the page with the data paused, behind the local Worker (--url: production's, while paused)
just kirkwood see --worker    # the checks against that, not `vite preview` (checks/CLAUDE.md)
just kirkwood test            # the Worker's unit tests run after the crate's (alone: node --test apps/kirkwood/worker/test/index.test.ts)
```
