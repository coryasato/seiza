//! The host's one view: the table filling the window, with the padding the
//! observatory's GPUI contender gives it.

use std::time::Duration;

use gpui_kit::*;
use seiza_tall_table::{Paging, TallTable, TallTableState};
use tall_table_bridge::Publish;

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
    /// A table over `shape`'s rows, each page read held `delay`. With
    /// `probing`, the table reports its probes and the host publishes them
    /// (`__tallTable`, `__tallTableLayout`).
    pub fn new(
        shape: Shape,
        delay: Option<Duration>,
        probing: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let table = cx.new(|cx| {
            Table::new(
                MemoryRows::new(shape, delay),
                shape.columns(),
                shape.rows(),
                Paging::default(),
                cx,
            )
            .probe_frames(probing)
        });
        let publish = Publish {
            filled_mark: Some(FILLED_MARK),
            scrollbar: true,
            probe: probing.then_some("__tallTable"),
            layout: probing.then_some("__tallTableLayout"),
            cells: None,
        };
        // The table emits while its frame renders, so GPUI runs this in the
        // task that presents it, and the mark lands right after the frame.
        let events = cx.subscribe(&table, move |_, _, event, _| publish.event(event));
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
