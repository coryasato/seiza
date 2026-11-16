//! The tall table's bare host: `seiza-tall-table` over rows answered from
//! memory ([`rows`]), with nothing on screen but the table, where each
//! feature's own cost is measured against the base (the table's `PLAN.md`,
//! "Measuring a feature"). Never deployed.
//!
//! The page's URL picks the rows: `?shape=narrow` (the default, the
//! observatory's 11 columns) or `?shape=wide` (500 float columns), and
//! `?delay=<ms>` holds each page read that long. `?perf` turns on the probes
//! the scripts read (`__tallTable`, `__tallTableLayout`) and each feature's
//! script hooks (`host::script_hooks`); `?perf&probe-cells` publishes the
//! drawn cells too (`__tallTableCells`, for the smoke check: never in a perf
//! run, whose frames it would slow). Each global and hook is a named
//! constant in `host.rs` (`*_GLOBAL`, `*_HOOK`) and `rows.rs` (the reads'
//! counts). With `custom-cells`, `?cells=text|heat|bars|color` paints every
//! float column (`rows::Cells`; `text` the control) and `?jump=<row>` jumps
//! there before the first frame. With `live`, `?live=<updates/s>` changes
//! that many visible rows a second (`host::Feed`), marking each batch
//! (`tall-table:invalidated`) and each frame that draws a re-read page
//! (`tall-table:refreshed`). With both, `?flash` gives every float column a
//! flash (`rows::with_flash`). With `follow`, `?rows=<n>` opens with that
//! many rows, `?append=<rows/s>` appends that many a second (`host::Appends`,
//! marking each batch, `tall-table:appended`), and `?follow` follows from
//! the start; each frame whose drawn tail grew marks `tall-table:tail`; the
//! source publishes the reads sent and drained; and with `?perf` the
//! scripts get the table's `let_go`. With `resize`, every column is
//! resizable, and each release or fit that changed a width publishes each
//! column's set width. With `select`, every kind of selection is on, and
//! each change publishes it. With `copy`, Cmd+C and Ctrl+C copy it (the
//! table's keys) and Cmd+Shift+C and Ctrl+Shift+C copy it past the key's
//! limit (the host's `copy`, as a confirming click would), the bridge's
//! writer puts it on the clipboard, and what became of it is published;
//! `?copy-max-bytes=` and `?copy-key-cells=` set the cap and the key's
//! limit, the source publishes its reads, and with `?perf` the scripts get
//! a value's exact text, the wasm heap's bytes, the table's `select`, and
//! its `close`. With `sort`, every column is sortable, the source sorting a
//! column from memory (its order computed at its first sort,
//! `rows::column_order`); `?sort=<column>,<asc|desc>` opens sorted (the
//! order computed before the first frame), `?sort-icons` draws gpui-kit's
//! sort icons, which the host bundles, in place of the glyphs, each order
//! is published and marked (`tall-table:sorted`), and with `?perf` the
//! scripts get a value's exact text, the table's `set_sort`, the source's
//! own row at a row of the order (for ties), and the reads drained so far
//! (the source's counts are never published with `sort` alone). With `pin`,
//! `?pin=<n>` pins the first `n` columns (by default 2 in the narrow shape,
//! its `spkid` and `full_name`, and 1 in the wide; `?pin=0` builds the
//! feature with nothing pinned), the run in effect is published, and with
//! `?perf` the scripts get the table's `set_pinned`. With `density`,
//! `?density=<row>,<text>[,<width>]` (px) sets the row height, the text
//! size, and every float column's width (by default 18,11,56, the dense
//! setting; `?density=30,14` the base's numbers, the kind widths kept), and
//! with `?perf` the scripts get the table's `set_density`. With `format`,
//! every float column is formatted (2 decimals, `Sign::Always`, grouping)
//! and the narrow shape's `spkid` grouped (`rows::with_format`), a page
//! answering 3 decimals on every fourth row of the source; `?format=off`
//! builds the feature with no column formatted. With `reorder`, every
//! column is movable, `?order=reverse` draws them reversed from the first
//! frame, each order is published, and with `?perf` the scripts get a
//! value's exact text and the table's `move_columns` and `set_order`. With
//! `clicks`, every press is reported; with `?perf` each is published
//! (`__tallTableClick`) and the scripts get the table's
//! `set_ctrl_press_is_context` (off at open).
//!
//! The script hooks enter GPUI through its foreground executor; one that
//! sends a column, a count, a density, or an order answers `false`, sending
//! nothing, for one the table would refuse (its refusals are debug
//! assertions), as `?sort=` sends only a column in range.

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
    let bootstrap = seiza::Bootstrap::new(host::TITLE, ui_font);
    // gpui-kit's sort icons, for `?sort-icons` (`sort`).
    #[cfg(feature = "sort")]
    let bootstrap = bootstrap.assets(host::SortIconAssets);
    bootstrap.run(move |window, cx| {
        seiza_tall_table::init(cx);
        #[cfg(feature = "copy")]
        host::init(cx);
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
