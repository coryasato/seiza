//! Tycho: a local-first data workbench. DuckDB-Wasm queries, GPUI draws.

pub mod csv;
pub mod dataset;
#[cfg(target_family = "wasm")]
mod engine;
#[cfg(target_family = "wasm")]
mod files;
pub mod jump;
pub mod limits;
#[cfg(target_family = "wasm")]
mod selftest;
pub mod shell;
pub mod table;
mod targets;
mod workbench;

pub use workbench::Workbench;

#[cfg(target_family = "wasm")]
use wasm_bindgen::prelude::*;

/// Entry point called by the JS host once the wasm and the UI font are in.
/// `bridge` is `@seiza/duckdb`'s bridge; it loads nothing until the first
/// call, which the post-paint callback makes. `sample_url` is the sample's
/// hashed asset ([`dataset::sample`]), fetched only when its button is pressed.
#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub fn start(ui_font: Vec<u8>, bridge: seiza_duckdb::Bridge, sample_url: String) {
    use gpui_kit::AppContext as _;

    seiza::Bootstrap::new(shell::TITLE, ui_font)
        .assets(shell::Icons)
        // The jump-to-row input's Mac editing keys.
        .mac_input_bindings()
        .after_first_paint(|_, cx| engine::start(cx))
        .run(move |window, cx| {
            shell::init(cx);
            table::init(cx);
            workbench::init(cx);
            seiza_duckdb::init(cx, bridge);
            cx.set_global(dataset::sample::Url(sample_url.into()));
            let workbench = cx.new(|cx| Workbench::new(window, cx));
            cx.new(|cx| shell::Shell::new(workbench, cx)).into()
        });
}
