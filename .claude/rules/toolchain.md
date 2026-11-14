---
paths:
  - "Cargo.toml"
  - "Cargo.lock"
  - "rust-toolchain.toml"
  - "**/justfile"
---

# Toolchain, pins, and the release profile

These add to the root `CLAUDE.md`'s "Stack and pins".

- **The pin covers the whole gpui family through `Cargo.lock`.** `=0.9.1` on `gpui-kit` alone lets its caret deps float (`gpui-component`, `gpui-base`, `gpui-pre-*`). `Cargo.lock` is committed and was seeded from gpui-kit 0.9.1's published lock. To bump, copy the new release's `Cargo.lock` from the registry source, then `cargo fetch`, and pin back any of the workspace's own dependencies that resolved to a newer version than before (`cargo update -p <crate> --precise <old>`). `--precise` applies to the first `-p` only, so pin a family (`arrow`'s crates) one call per crate, the dependents first (`arrow-cast` before `atoi`, which it requires at the newer version). Don't run a bare `cargo update`.
- **Toolchain:** dated nightly in `rust-toolchain.toml`, because `gpui-pre-web` pulls in `wasm_thread`, which needs `#![feature]`. `wasm-bindgen-cli` must match the locked `wasm-bindgen` exactly (`cargo install wasm-bindgen-cli --version <locked> --locked`). Also needed: `just`, `wasm-opt` (binaryen), Node.js.
- **Release profile:** Cargo reads `[profile.release]` only from the workspace root `Cargo.toml`, so its settings apply to every app. If an app needs different settings, use `[profile.release.package.<crate>]` and note why in that app's `docs/DECISIONS.md`. Per-package overrides can't set `lto`, `panic`, or `rpath`; those stay workspace-wide. It sets `trim-paths = "object"` (unstable, so `cargo-features = ["trim-paths"]` heads the manifest): the repo is public, and without it every wasm's panic locations name the builder's home directory. Each app's check fails on a home path in its shipped wasm (`shared-web/perf/home-paths.ts`, its control a build with `CARGO_PROFILE_RELEASE_TRIM_PATHS=none`). Why: `docs/DECISIONS.md`, "Toolchain and build".
- **`wasm-opt` needs `--enable-threads`.** `wasm_thread`'s atomics land in the binary even on the single-threaded platform, and wasm-opt refuses to validate without the flag.
