//! The tall table's bare host: `seiza-tall-table` over rows answered from
//! memory ([`rows`]), with nothing on screen but the table, where each
//! feature's own cost is measured against the base (the table's `PLAN.md`,
//! "Measuring a feature"). Never deployed.
//!
//! The page's URL picks the rows: `?shape=narrow` (the default, the
//! observatory's 11 columns) or `?shape=wide` (500 float columns), and
//! `?delay=<ms>` holds each page read that long. `?perf` turns on the probes
//! the scripts read (`__tallTable`, `__tallTableLayout`). With `custom-cells`,
//! `?cells=text|heat|bars|color` paints every float column (`rows::Cells`).
//! With `live`, `?live=<updates/s>` changes that many visible rows a second
//! (`host::Feed`), marking each batch (`tall-table:invalidated`) and each
//! frame that draws a re-read page (`tall-table:refreshed`). With both,
//! `?flash` gives every float column a flash (`rows::with_flash`). With
//! `follow`, `?rows=<n>` opens with that many rows, `?append=<rows/s>`
//! appends that many a second (`host::Appends`, marking each batch,
//! `tall-table:appended`), and `?follow` follows from the start; each frame
//! whose drawn tail grew marks `tall-table:tail`. With `resize`, every column
//! is resizable, and each release or fit that changed a width publishes
//! each column's set width (`__tallTableWidths`).

mod host;
pub mod rows;

pub use host::Host;

#[cfg(target_family = "wasm")]
use wasm_bindgen::prelude::*;

/// Entry point called by the JS host once the wasm and the UI font are in.
#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub fn start(ui_font: Vec<u8>) {
    use gpui_kit::AppContext as _;

    let shape = seiza::url::param("shape")
        .and_then(|name| rows::Shape::from_name(&name))
        .unwrap_or(rows::Shape::Narrow);
    let delay = seiza::url::param("delay")
        .and_then(|ms| ms.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .map(std::time::Duration::from_millis);
    let probing = seiza::url::has_param("perf");
    #[cfg(feature = "live")]
    let live = host::Live {
        #[cfg(feature = "follow")]
        tail: host::Tail {
            rows: seiza::url::param("rows").and_then(|rows| rows.parse().ok()),
            append: seiza::url::param("append")
                .and_then(|rate| rate.parse::<f64>().ok())
                .filter(|rate| *rate > 0.0),
            follow: seiza::url::has_param("follow"),
        },
        feed: seiza::url::param("live")
            .and_then(|rate| rate.parse::<f64>().ok())
            .filter(|rate| *rate > 0.0),
        #[cfg(feature = "custom-cells")]
        flash: seiza::url::has_param("flash"),
    };
    #[cfg(feature = "custom-cells")]
    let cells = seiza::url::param("cells")
        .and_then(|name| rows::Cells::from_name(&name))
        .unwrap_or(rows::Cells::Text);
    seiza::Bootstrap::new(host::TITLE, ui_font).run(move |window, cx| {
        seiza_tall_table::init(cx);
        cx.new(|cx| {
            Host::new(
                shape,
                delay,
                #[cfg(feature = "custom-cells")]
                cells,
                #[cfg(feature = "live")]
                live,
                probing,
                window,
                cx,
            )
        })
        .into()
    });
}
