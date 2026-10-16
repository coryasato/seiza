//! The observatory's GPUI contender: the tall table (`seiza-tall-table`) over
//! DuckDB (`seiza-duckdb`'s `tall-table` source) in a bare host, with nothing
//! on screen but the table. It publishes the contender contract
//! (`apps/observatory/docs/contender-contract.md`) from the table's events.

#[cfg(target_family = "wasm")]
mod contract;
mod host;

pub use host::Host;

#[cfg(target_family = "wasm")]
use wasm_bindgen::prelude::*;

/// Entry point called by the JS host once the wasm and the UI font are in.
/// `bridge` is `@seiza/duckdb`'s bridge, which loads nothing until the
/// post-paint callback starts the engine; `data_url` is the data file's
/// same-origin URL.
#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub fn start(ui_font: Vec<u8>, bridge: seiza_duckdb::Bridge, data_url: String) {
    use gpui_kit::AppContext as _;

    seiza::Bootstrap::new(host::TITLE, ui_font)
        // The host opens the file once the engine is ready (`Host::new`).
        .after_first_paint(|_, cx| seiza_duckdb::start(cx, |_, _| {}))
        .run(move |window, cx| {
            seiza_tall_table::init(cx);
            seiza_duckdb::init(cx, bridge);
            cx.new(|cx| Host::new(data_url, window, cx)).into()
        });
}
