//! Tycho: a local-first data workbench. DuckDB-Wasm queries, GPUI draws.

mod workbench;

pub use workbench::Workbench;

#[cfg(target_family = "wasm")]
use wasm_bindgen::prelude::*;

/// Entry point called by the JS host once the wasm and the UI font are in.
#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub fn start(ui_font: Vec<u8>) {
    use gpui_kit::AppContext as _;

    seiza::Bootstrap::new("Tycho", ui_font)
        .run(|window, cx| cx.new(|cx| Workbench::new(window, cx)).into());
}
