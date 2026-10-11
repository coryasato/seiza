# M<n>: <title> (YYYY-MM-DD)

<!-- Save as perf/results/<date>-m<n>[-<topic>].md. One note per milestone or experiment; the JSON files beside it are what the scripts wrote. Never record hostnames, usernames, or home-directory paths. -->

Measured on <CPU>, <OS>, machine `<SEIZA_MACHINE label>`, Chromium headless=new, 1440×900 at DPR 2, median of 10, reference and throttled (root CLAUDE.md, "Measurement protocol"). Load average <before> → <after>.

Raw: `<date>-<label>.json` (<what it is>), …

## What changed

- <The change being measured, with the wasm (brotli) size effect for each app it touches.>

## Against the budgets

| Check | Budget | Reference | Throttled | Pass |
|---|---|---|---|---|
| <metric> | <limit> | <median> | <median> | yes |

## Against HEAD

<Interleaved A/B, n runs each: this change vs HEAD, reference and throttled. A single protocol run on a busy machine isn't a comparison.>

## Experiments and controls

<Anything tried and dropped, each with its numbers; every negative control and what it showed.>

## Reproducing it

```sh
just <app> <recipe> --label <label>
```
