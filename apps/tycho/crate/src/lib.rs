//! Tycho: a local-first data workbench. DuckDB-Wasm queries, GPUI draws.

pub mod command;
pub mod csv;
pub mod dataset;
pub mod engine;
#[cfg(target_family = "wasm")]
mod files;
pub mod filter;
pub mod find;
pub mod frame;
pub mod jump;
pub mod limits;
pub mod log;
pub mod row;
#[cfg(target_family = "wasm")]
mod selftest;
pub mod table;
mod targets;
pub mod theme;
pub mod view;
mod workbench;

pub use workbench::Workbench;

#[cfg(target_family = "wasm")]
use wasm_bindgen::prelude::*;

/// The window's and the perf panel's title.
pub const TITLE: &str = "Tycho";

/// Entry point called by the JS host once the wasm and the UI font are in.
/// `bridge` is `@seiza/duckdb`'s bridge; it loads nothing until the first
/// call, which the post-paint callback makes. `sample_url` is the sample's
/// hashed asset ([`dataset::sample`]), fetched only when its row is pressed.
/// `frame` is the page's frame, which [`frame::publish`] keeps up to date;
/// `dark`, the theme the page shows.
#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub fn start(
    ui_font: Vec<u8>,
    bridge: seiza_duckdb::Bridge,
    sample_url: String,
    frame: frame::Frame,
    dark: bool,
) {
    use gpui_kit::AppContext as _;

    frame::set_sink(frame);
    seiza::Bootstrap::new(TITLE, ui_font)
        .assets(table::icons::Icons)
        .after_first_paint(|_, cx| engine::start(cx))
        .run(move |window, cx| {
            frame::first_theme(dark, cx);
            table::init(cx);
            workbench::init(cx);
            seiza_duckdb::init(cx, bridge);
            cx.set_global(dataset::sample::Url(sample_url.into()));
            cx.new(|cx| Workbench::new(window, cx)).into()
        });
}
