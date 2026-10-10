# M7 part G: static placeholder shell and theme toggle (2026-10-09, files dated UTC)

Release build, Chromium headless=new, 1440×900, DPR 2 unless noted. Apple M1, macOS 25.6, machine `local`, load average 2.7–3.9 during the runs. Raw: `2026-10-10-m7-placeholder.json` (`just tycho placeholder --controls --ab <HEAD's dist>`: every check, 15 negative controls, and the interleaved TTFP A/B against HEAD `ca92717`, built in its own worktree and `target/`), `2026-10-10-m7-placeholder-cold.json` (`perf.ts`, median of 10, reference + throttled). Screenshots of both, and their diff images, are written to `raw/placeholder/` (gitignored).

## What changed

- **Placeholder** (`shared-web/src/placeholder.ts`, opt-in through `seizaViteConfig`'s `placeholder`): an inert HTML/CSS copy of the empty shell, above the canvas until the first frame. Font: the inlined "Seiza Placeholder" subset (8,672 B WOFF2). Tycho's buttons are gpui-kit skeletons at GPUI's widths; the heading, description, and "Engine loading…" are text. `shared/` releases it in the `gpui:first-frame` microtask; it fades out over 120 ms and removes itself.
- **Theme toggle** (`shared/src/shell.rs`): a Sun/Moon icon button and Cmd/Ctrl+Shift+L. A press stops following the system appearance until a reload.
- **Pointer cursor** on every button while it can be pressed.
- **Panel:** a "Placeholder" row in the page-load waterfall.

## Numbers

| | HEAD | This change |
|---|---|---|
| TTFP, reference (interleaved A/B, median of 10) | 188.4 ms (180.3–1392.7) | 195.6 ms (188.2–229.5) |
| TTFP, throttled (interleaved A/B, median of 10) | 3680.0 ms (3669.7–3692.6) | 3715.5 ms (3709.2–3731.4) |
| Placeholder paint, reference / throttled (A/B) | — | **77.8 / 243.1 ms** |
| `perf.ts`, reference: TTFP / placeholder paint | — | 204.9 / 66.2 ms |
| `perf.ts`, throttled: TTFP / placeholder paint | — | 3752.5 / 262.9 ms |
| App wasm, brotli | 2810.7 KiB | 2822.6 KiB (+11.9); 2823.6 after the panel's late-mark fix (below) |
| `index.html`, brotli | 0.4 KiB | 11.1 KiB (raw 1.0 → 20.6 KiB) |

On Fast 4G a visitor sees the shell **3.47 s before** GPUI's first frame (243 vs 3716 ms).

**Where the TTFP cost comes from.** The throttled ranges don't overlap, so +35.5 ms is real. A second interleaved run (throttled, 10 each) split it: HEAD 3684.1 ms; this change's wasm with **no placeholder** 3726.9; with the placeholder but no skeleton pulse 3717.9; the full change 3725.7. The placeholder (its HTML, inlined font, layout, and pulse) costs nothing measurable; the ~40 ms is the wasm's +11.9 KiB brotli (+55 KiB raw) on Fast 4G at 4× CPU. The same toggle with a text label had cost +1.9 KiB, and the two SVGs are a few hundred bytes, so the rest is likely GPUI's SVG path linking in with the first icon (not profiled). Reference: +7.2 ms.

**`check`:** 202.7 ms against the 195.0 limit (FAIL), under load 3.3–5.1. The interleaved A/B puts this change at 195.6 and HEAD at 188.4: this change itself is over the limit by 0.6 ms on a quieter machine, and the September baseline is still pending a re-record.

## Checks (all pass)

- **Screenshot match**, light and dark, DPR 2 and DPR 1: surfaces 0.0000% differing (limit 0.04%); the three skeletons' edges match GPUI's buttons exactly at DPR 1 and within one device px at DPR 2; every text line and the icon within the ink limits.
- **Steadiness:** a screencast of the placeholder's life shows a blank frame, then the final picture, never a moved one, with the font inlined and with it served 300 ms late; the control (contents shown before the font) is caught in both schemes.
- **Negative controls, 15 of 15 caught:** a skeleton 1 px wider, the heading or the button row 1 px down, a 35 px title bar, a #888 muted color, a flat title bar (dark), a system-font heading, a 14 px icon.
- **The swap** (`perf.ts`, 20 cold loads): the placeholder painted before the first frame every time, the panel's "Placeholder" row within 5 ms of its mark, released inside the task that presented the first frame, gone afterwards.
- **Theme toggle**, starting light and starting dark: the button, Ctrl+Shift+L, and Cmd+Shift+L each switch; a system change after a press doesn't undo it; a reload follows the system; a system change before any press is followed.
- **Font:** every placeholder character is in the subset (the build fails otherwise).

## How it got here (review, 2026-10-09)

The first build matched GPUI within 1–3 device px in every DPR 2 check, but it jumped on a DPR 1 display. Four causes, fixed in turn:

1. **The font raced the first paint.** Chrome sometimes painted the placeholder laid out in the fallback font's metrics (text invisible under `font-display: block`), then re-laid it out. The contents now stay hidden until `document.fonts.load` resolves; a check serves the font late to make the race certain.
2. **Smoothing overrides:** `-webkit-font-smoothing: antialiased` drew the text thinner than GPUI on macOS. Removed; ink mass now within ~5% at DPR 2.
3. **Rasterization:** GPUI's text sits ~2 px lower at DPR 1 (1 device px at DPR 2) and is crisper. No CSS fixes that, so the swap became a 120 ms fade, and the buttons, whose labels visibly jumped, became gpui-kit skeletons.
4. **Rounding:** GPUI rounds line heights to whole device pixels and x.5 positions down, and measures text ~1 px narrower than Chrome. The placeholder copies the rounding and uses GPUI's button widths; box edges then match exactly at DPR 1.

## After: the panel's late paint mark (2026-10-09)

A baseline attempt (`perf.ts --write-baseline`, 10 + 10 runs) failed one run: "overlay never showed Placeholder". Element Timing entries reach their `PerformanceObserver` asynchronously, so the placeholder's paint mark (set from that callback) can arrive after the first frame, when the panel had already read the page-load marks once; the paint itself came first. The panel now fills the step at a later refresh (`frames.rs`, only while it's open). +1.0 KiB brotli (2823.6). The next 10 + 10 runs passed every check: TTFP 205.0 / 3755.3 ms, placeholder 54.2 / 257.9 ms (load 4.4). The baseline from the attempt (210.3 ms reference, load 2.0–2.7 from the user's idle apps) was discarded, not written.

## The re-recorded baseline

With every app but the editor and terminal closed, and the load average under 1.0 (0.97 after a 281 s wait), `perf.ts --write-baseline` (`2026-10-10-m7-baseline.json`) read **195.3 ms** reference (188.8–218.5) and **3727.7 ms** throttled (3724.5–3740.9), every check passing. That matches the interleaved A/B (195.6), so the September 177.3 was a different machine state, not a better build. `just tycho check` then read 194.2 ms against the new 214.8 limit: PASS. The wasm baseline moved with it (2823.6 KiB; limit 3247.1).
