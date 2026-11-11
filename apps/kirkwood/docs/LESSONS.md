# Lessons learned

One entry per milestone part (per milestone if it has one part), written before starting the next: what surprised us, and what it taught us. The decisions it made are in [`DECISIONS.md`](DECISIONS.md). A showcase has no results notes; a number worth keeping sits with the decision it settled.

<!-- Template:
## M<n>, part <X>: <title> (YYYY-MM-DD)

**Surprises:**
- What didn't go as expected, and what it taught us.
-->

## M0, part A: the two canvases standing (2026-11-10)

**Surprises:**
- **The canvas was one setting from transparent.** The plan carried a fallback layout because GPUI's web canvas is opaque. It is, but only in how the browser composites it: the pixels under it were already premultiplied with a true alpha. Reading the renderer's clear and blend before building anything saved the fallback. The fix isn't one flag upstream, though: wgpu's WebGPU backend lists opaque as its only alpha mode, so the setting has to be made on the page.
- **A control can fail for a good reason.** `?opaque` (the shim off) hides the scene in Chromium and WebKit and not in Firefox, where GPUI falls back to WebGL2 and there's nothing to turn off. It read as a failure until the backend explained it.
- **The GPU, not either canvas's CPU, set the frame rate.** With 1.57 M points animating, the main thread sat idle (under 1 ms a frame) while a third of the frames came late. Smaller dots and fewer solver steps, the two things expected to matter, changed nothing; fewer pixels or fewer points did. The table flinging over a still scene never dropped a frame.
- **The table's tooltip opens inside the panel,** above its cell, so it never tested "a tooltip over the scene". The time control's (gpui-kit's own) did.
- **Five rows have no ellipse** (e at or past 1): the shader skips them, so every dot is a row but not every row is a dot. The table shows them with NULL in the columns computed from the orbit, and their own a, e, and i as the file has them.
- **A release isn't heard where the press was.** GPUI delivers a mouse-up to the element under the pointer, so a shape released over the panel left the clock held until the review caught it; the surface listens for the release outside itself too.
- **A frame sample that throws stops the frame recorder for good:** the spike's sample called into the wasm before it was ready, and every interval read 0 with no error anywhere.

Numbers and decisions: [`DECISIONS.md`](DECISIONS.md), "Scene", "Table", "Input".
