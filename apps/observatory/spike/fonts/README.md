# The fonts spike (throwaway)

The admin table's fonts spike: the GPUI contender's base build on the countries file, Noto faces added after first paint, each script's names drawn beside Chromium's drawing of them in the same faces. Its findings are in `perf/results/2026-11-09-m12-a2.md`. Deleted with the rest of `spike/`, or once the fonts path and `perf/admin.ts` replace it.

From the repo root, with `just observatory data` and `just tycho data` done:

```sh
apps/observatory/spike/fonts/fetch-faces.sh                 # the 13 faces into faces/
node apps/observatory/spike/fonts/build-countries.ts        # data/countries.parquet, from the draft prep
git apply apps/observatory/spike/fonts/spike.patch          # the spike's hooks (?file=, ?cjk, __spikeAddFonts)
just observatory gpui-build
node apps/observatory/spike/fonts/fonts-spike.ts --state fonts            # crops into out-fonts/, the sheet, results.json
node apps/observatory/spike/fonts/fonts-spike.ts --state fonts --route2   # the same with FontFallbacks on the host
ROWS=0,37,149,170 node apps/observatory/spike/fonts/fonts-spike.ts --state fonts   # those rows only
TIMING=1 node apps/observatory/spike/fonts/fonts-spike.ts --state fonts   # fonts in → drawn, once a run
node apps/observatory/spike/fonts/zoom.mjs <out-dir> <script>-<row> …     # crops zoomed, GPUI over the DOM
node apps/observatory/spike/fonts/offsets.ts                # every text's GPOS offsets by hb-shape (HarfBuzz's CLI)
git apply -R apps/observatory/spike/fonts/spike.patch && just observatory gpui-build
```

`toggle.patch` is the minimal runtime toggle whose bytes the note records (apply it alone, in place of `spike.patch`). The crops assume the base build's layout: the columns start 63 CSS px from the page's left, the body's rows 47 px from its top, 30 px apart.
