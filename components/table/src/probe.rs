//! What the table shows, for a host's scripts to read: on a canvas there's
//! no DOM to inspect. Reported as [`TableEvent`](crate::TableEvent)s while
//! the host turns them on (`TableState::probe_frames`, `probe_cells`).

/// What a frame shows. Reported when it changes.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct TableProbe {
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
/// scroll position is in [`TableProbe`]).
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct TableLayout {
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
}
