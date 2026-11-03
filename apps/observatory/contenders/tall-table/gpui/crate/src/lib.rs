//! The observatory's GPUI contender: the tall table (`seiza-tall-table`) over
//! DuckDB (`seiza-duckdb`'s `tall-table` source) in a bare host, with nothing
//! on screen but the table. It publishes the contender contract
//! (`apps/observatory/docs/contender-contract.md`) from the table's events.

#[cfg(target_family = "wasm")]
mod contract;
mod host;
mod scene;

pub use host::Host;

#[cfg(target_family = "wasm")]
use wasm_bindgen::prelude::*;

/// Entry point called by the JS host once the wasm and the UI font are in.
/// `bridge` is `@seiza/duckdb`'s bridge, which loads nothing until the
/// post-paint callback starts the engine; `data_url` is the data file's
/// same-origin URL and `file` its SQL name; `level` is what the build's
/// feature level sets for the scenario's stop (`scene::Scene::new`); a
/// non-empty `failure` is a scenario or stop the build doesn't have, shown
/// in place of the table; `theme` is the page's (`"light"`, `"dark"`, or
/// empty to follow the system), applied before the first frame.
#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub fn start(
    ui_font: Vec<u8>,
    bridge: seiza_duckdb::Bridge,
    data_url: String,
    file: String,
    level: Vec<f64>,
    failure: String,
    theme: String,
) {
    use gpui_kit::{AppContext as _, SharedString};

    seiza::Bootstrap::new(host::TITLE, ui_font)
        // The host opens the file once the engine is ready (`Host::new`).
        .after_first_paint(|_, cx| seiza_duckdb::start(cx, |_, _| {}))
        .run(move |window, cx| {
            contract::apply_theme(&theme, cx);
            seiza_tall_table::init(cx);
            seiza_duckdb::init(cx, bridge);
            let scene = if failure.is_empty() {
                scene::Scene::new(file, &level).map_err(SharedString::from)
            } else {
                Err(failure.into())
            };
            cx.new(|cx| Host::new(data_url, scene, window, cx)).into()
        });
}
