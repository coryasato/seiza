

## M10: `trim-paths`, no home paths in the shipped wasm (closed 2026-11-01)

Tycho's release wasm embeds the builder's home-directory paths, its dependencies' and the toolchain's panic locations: 1,013 in `web/dist` on 2026-10-30, deployed at tycho.seiza.io. The repo-wide change is [`docs/research/build-paths.md`](../../docs/research/build-paths.md)'s; this milestone adopts it. One session builds the change, this, and the observatory's M7, but each records its own evidence: this one's goes in Tycho's `perf/results/` and `docs/milestones.md`.

**Done when:**
- [x] The app wasm before and after the change (raw, after wasm-opt, brotli 11) in a results note; `perf/baseline.json`'s wasm rewritten, and TTFP's only if `check` shows it moved. *2026-11-01: 10,238.0 → 10,195.1 KiB after wasm-opt, 2,855.2 → 2,854.8 KiB brotli; the wasm baseline 2,854.8; TTFP kept (`check` 204.8 ms against 195.3, passing) ([`perf/results/2026-11-01-m10.md`](perf/results/2026-11-01-m10.md)).*
- [x] `check` fails on a home path in the shipped wasm (the builder's `$HOME`, `/Users/`, `/home/`), with a control (a build without the setting fails it). *2026-11-01: 1,015 home paths before, 0 after; the control 1,023 (`just tycho home-paths`).*
- [x] Redeployed: the deploy's checks pass, and the wasm fetched from production holds no home path. *2026-11-01: `just tycho deploy` (Worker version `8435b48e`), its check PASS (assets, /data range handling); the app wasm fetched from tycho.seiza.io as br, decompressed, byte-identical to the build, and no home path in it.*
- [x] `just tycho report`; "Waiting on"'s row removed (adopted). *2026-11-01.*

Results: `perf/results/2026-11-01-m10.md`. The repo-wide change and the observatory's adoption (its M7), built in the same session: root `docs/DECISIONS.md`, "Toolchain and build".
