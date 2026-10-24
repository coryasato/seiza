//! What the table shows, for a host's scripts to read: on a canvas there's
//! no DOM to inspect. Reported as [`TallTableEvent`](crate::TallTableEvent)s while
//! the host turns them on (`TallTableState::probe_frames`, `probe_cells`).

/// What a frame shows. Reported when it changes.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct TallTableProbe {
    pub rows: u64,
    /// The scroll position, in rows.
    pub top: f64,
    /// The visible rows, `first..end`.
    pub first: u64,
    pub end: u64,
    /// Of the visible rows, how many are loaded, still loading, and failed.
    pub loaded: u64,
    pub pending: u64,
    pub failed: u64,
    /// The last visible row's first cell, if loaded.
    pub last_cell: Option<String>,
    /// The row the last jump landed on (0-based), highlighted.
    pub marked: Option<u64>,
    /// The cells' sideways scroll, in pixels.
    pub scroll_x: f32,
    /// The shown tooltip's text.
    pub tooltip: Option<String>,
}

/// Where the cells are, in window pixels. Reported when it changes (the
/// scroll position is in [`TallTableProbe`]).
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct TallTableLayout {
    /// The cells area's left edge (right of the row numbers) and top edge.
    pub left: f32,
    pub top: f32,
    /// Row `r`'s top is `top + (r - probe.top) * row_height`, and column
    /// `c`'s left edge is `left + columns[c].x - probe.scroll_x`.
    pub row_height: f32,
    pub cells_width: f32,
    pub columns: Vec<ColumnProbe>,
}

#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct ColumnProbe {
    pub name: String,
    pub x: f32,
    pub width: f32,
    /// `text`, `integer`, `float`, or `decimal`.
    pub kind: &'static str,
    /// The characters a float may take.
    pub budget: usize,
}

/// A drawn cell's value and the text handed to GPUI for it (which GPUI may
/// still cut to the column's width).
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct CellProbe {
    pub row: u64,
    pub column: usize,
    /// The value's exact text (a float's shortest round-trip text).
    pub exact: String,
    pub shown: String,
    /// Its paint as drawn (`custom-cells`).
    #[cfg(feature = "custom-cells")]
    pub paint: PaintProbe,
}

/// A drawn cell's paint: each `None` where it drew none.
#[cfg(feature = "custom-cells")]
#[derive(Debug, Clone, Default, PartialEq)]
#[non_exhaustive]
pub struct PaintProbe {
    /// The fill's color, 8-bit RGBA.
    pub fill: Option<[u8; 4]>,
    /// The bar's left edge and width, in CSS px from the cell's left.
    pub bar: Option<(f32, f32)>,
    /// The value's color, 8-bit RGBA, where a text ramp set it.
    pub text: Option<[u8; 4]>,
}
