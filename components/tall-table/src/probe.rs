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
    /// What's selected (`select`).
    #[cfg(feature = "select")]
    pub selection: Option<crate::TallTableSelection>,
    /// The order the rows are read in (`sort`).
    #[cfg(feature = "sort")]
    pub sort: Option<crate::Sort>,
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
    /// `c`'s left edge is `left + columns[c].x - probe.scroll_x` (with
    /// `pin`, less `probe.scroll_x` only when `c >= pinned`).
    pub row_height: f32,
    pub cells_width: f32,
    /// The columns pinned in effect (`pin`): the first `pinned` don't
    /// scroll, and the rest are clipped right of their edge.
    #[cfg(feature = "pin")]
    pub pinned: usize,
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
    /// Its arrow's box (`sort`), its left from the column's left edge and
    /// its width; `None` for a column that draws none.
    #[cfg(feature = "sort")]
    pub arrow: Option<(f32, f32)>,
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
    /// The bar's left edge and width, in CSS px from the cell's left, and
    /// its color, 8-bit RGBA (its `color`, or `below` left of its zero).
    pub bar: Option<(f32, f32, [u8; 4])>,
    /// The value's color, 8-bit RGBA, where a text ramp or a fill's
    /// contrast set it.
    pub text: Option<[u8; 4]>,
    /// A change's flash, 8-bit RGBA, its opacity in the alpha (`live`).
    #[cfg(feature = "live")]
    pub flash: Option<[u8; 4]>,
}
