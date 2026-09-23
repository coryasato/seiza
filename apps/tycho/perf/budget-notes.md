# Budget notes

`just tycho check` fails when the app wasm (brotli) grows more than 15% over `baseline.json` (`wasmBrotliKiB`), unless a row below accepts the new size. Add one row per accepted increase. The check reads the first two columns: the date (YYYY-MM-DD) and the accepted wasm brotli size in KiB. It takes the largest size among rows dated on or after `baseline.json`'s `date`, so recording a new baseline retires older acceptances.

| Date | Accepted wasm brotli (KiB) | Change | Why it's worth it |
|---|---|---|---|
