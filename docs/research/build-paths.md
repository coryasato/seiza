# Build paths in the shipped wasm

Found 2026-10-24, measuring the tall table's bare host: every release wasm the repo builds embeds the builder's absolute paths. Planned here as a repo-wide change of its own; not built yet.

## What's there

The bare host's release wasm (after wasm-opt, as shipped) holds 974 absolute paths under the builder's home directory: `~/.cargo/registry/src/index.crates.io-…/<crate>-<version>/src/…` and `~/.rustup/toolchains/<toolchain>/lib/rustlib/src/…`. They're panic locations (`file!()` in `Location`), which `panic = "abort"` doesn't remove: the panic hook still formats them. Every app's wasm is built with the same profile, so Tycho's and the observatory's deployed wasm likely carry the same.

- **Privacy:** the paths name the builder's username, against the repo's rule never to publish usernames or home-directory paths (root `CLAUDE.md`, "Measurement protocol").
- **Reproducibility:** where a build sits changes its bytes. The bare host's base built in the repo and in a git worktree differed by 1.4 KiB before brotli, and the same commit in two worktrees by 0.5 KiB brotli (the table's `docs/DECISIONS.md`, "Features", 2026-10-24).

## Best practice

Remapping build paths in release artifacts is standard: Rust's own release builds do it (`--remap-path-prefix`), as do Debian's reproducible builds and Firefox. Cargo's answer is the `trim-paths` profile setting (RFC 3127): `"object"` (the default it proposes for release once stable) remaps paths in the compiled output only, keeping full paths in diagnostics; registry crates become `<crate>-<version>/src/…`, the standard library `/rustc/<commit-hash>/…`, and workspace members paths relative to the workspace.

- **Here:** the pinned nightly (`rust-toolchain.toml`) has it behind `-Z trim-paths`. Unstable, so it's opted into with `cargo-features = ["trim-paths"]` at the top of the root `Cargo.toml` and `trim-paths = "object"` (or `"all"`) under `[profile.release]`, read only from the workspace root, so every app gets it.
- **On stable, if the nightly is ever dropped:** `RUSTFLAGS="--remap-path-prefix=$CARGO_HOME/registry/src/= --remap-path-prefix=$(rustc --print sysroot)=/rustc"` in each build recipe, which is what `trim-paths` generates. Setting `RUSTFLAGS` invalidates the build cache for anything built without it, which is why the profile setting is preferred.
- **Further, to research:** `-Z build-std` with `panic_immediate_abort` drops the panic messages and locations altogether, likely the largest saving available, but a panic in a release build then says nothing (debug builds keep `console_error_panic_hook`). Whether that's best practice for a deployed app is an open question, researched on its own; it isn't part of this change.

## The plan

One change to the root `Cargo.toml`, in a session of its own, after the tall table's `custom-cells` milestone closes. It changes every app's bytes (root rule 1), but each app records its own size effect and redeploys in a milestone of its own, when it gets to it: each app's `PLAN.md` carries the note ("Waiting on"), flipped to *Ready* when this lands. No rush to redeploy.

**Done when:**
- [ ] `cargo-features = ["trim-paths"]` and `[profile.release] trim-paths = "object"` in the root `Cargo.toml`, with a comment linking here; a decision under root `docs/DECISIONS.md`, "Toolchain and build".
- [ ] **No home path in a release wasm:** a check that fails on `$HOME` (and `/Users/`, `/home/`) in the built wasm, in the tall table's `size` (the bare host), with a control (a build without the setting must fail it). Each app adds the same check to its own `check` when it adopts the change.
- [ ] **Reproducible across checkouts:** the bare host's base built in the repo and in a worktree is byte-identical (or, if not, the remaining difference is explained). If it is, the table's `size --against` can gate on brotli again (its `docs/DECISIONS.md`, "Features", 2026-10-24).
- [ ] **The apps told:** Tycho's and the observatory's "Waiting on" rows flip to *Ready*, with the date.
