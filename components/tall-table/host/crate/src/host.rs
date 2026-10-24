//! The host's one view: the table filling the window, with the padding the
//! observatory's GPUI contender gives it.

use std::time::Duration;

use gpui_kit::*;
use seiza_tall_table::{Paging, TallTable, TallTableState};
use tall_table_bridge::Publish;

#[cfg(feature = "custom-cells")]
use crate::rows::Cells;
use crate::rows::{MemoryRows, Shape};

/// The window's title.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens a window")
)]
pub const TITLE: &str = "Tall table: bare host";

/// Set right after each frame in which the viewport became filled.
pub const FILLED_MARK: &str = "tall-table:filled";

pub type Table = TallTableState<MemoryRows>;

pub struct Host {
    table: Entity<Table>,
    _events: Subscription,
}

impl Host {
    /// A table over `shape`'s rows, each page read held `delay`, its float
    /// columns painted `cells`' way (`custom-cells`). With
    /// `probing`, the table reports its probes and the host publishes them
    /// (`__tallTable`, `__tallTableLayout`, and with `custom-cells` and
    /// `?probe-cells` the drawn cells, `__tallTableCells`).
    pub fn new(
        shape: Shape,
        delay: Option<Duration>,
        #[cfg(feature = "custom-cells")] cells: Cells,
        probing: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let rows = MemoryRows::new(shape, delay);
        // The drawn cells and their paint, for the smoke check
        // (`?probe-cells`), never in a perf run: building them costs every
        // frame. Only with the feature, so the base host is unchanged.
        #[cfg(not(all(feature = "custom-cells", target_family = "wasm")))]
        let probe_cells = false;
        #[cfg(all(feature = "custom-cells", target_family = "wasm"))]
        let probe_cells = probing && seiza::url::has_param("probe-cells");
        #[cfg(not(feature = "custom-cells"))]
        let columns = shape.columns();
        #[cfg(feature = "custom-cells")]
        let (rows, columns) = (rows.with_cells(cells), cells.columns(shape));
        let table = cx.new(|cx| {
            Table::new(rows, columns, shape.rows(), Paging::default(), cx)
                .probe_frames(probing)
                .probe_cells(probe_cells)
        });
        let publish = Publish {
            filled_mark: Some(FILLED_MARK),
            scrollbar: true,
            probe: probing.then_some("__tallTable"),
            layout: probing.then_some("__tallTableLayout"),
            cells: probe_cells.then_some("__tallTableCells"),
        };
        // The table emits while its frame renders, so GPUI runs this in the
        // task that presents it, and the mark lands right after the frame.
        let events = cx.subscribe(&table, move |_, _, event, _| publish.event(event));
        // A jump's highlight over painted cells, for its screenshot.
        #[cfg(all(feature = "custom-cells", target_family = "wasm"))]
        if let Some(row) = seiza::url::param("jump").and_then(|row| row.parse().ok()) {
            table.update(cx, |table, cx| table.jump_to(row, cx));
        }
        let focus = table.read(cx).focus_handle().clone();
        window.focus(&focus, cx);
        Self {
            table,
            _events: events,
        }
    }
}

impl Render for Host {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().p_4().child(TallTable::new(&self.table))
    }
}
