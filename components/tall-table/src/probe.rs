//! What the table shows, for a host's scripts to read: on a canvas there's
//! no DOM to inspect. Reported as [`TallTableEvent`](crate::TallTableEvent)s while
//! the host turns them on (`TallTableState::probe_frames`, `probe_cells`).

/// What a frame shows. Reported when it changes.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct TallTableProbe {
    /// The table's rows.
    pub rows: u64,
    /// The scroll position, in rows.
    pub top: f64,
    /// The first visible row: the visible rows are `first..end`.
    pub first: u64,
    /// One past the last visible row.
    pub end: u64,
    /// Visible rows whose page is loaded.
    pub loaded: u64,
    /// Visible rows whose page is still loading.
    pub pending: u64,
    /// Visible rows whose page's read failed.
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
    /// The order the rows are read in (`sort`): its keys, none for the
    /// source's own.
    #[cfg(feature = "sort")]
    pub sort: Vec<crate::Sort>,
    /// The find (`find`): its term, its current match, and whether a step
    /// is out.
    #[cfg(feature = "find")]
    pub find: FindProbe,
}

/// The find in effect (`find`), on [`TallTableProbe`].
#[cfg(feature = "find")]
#[derive(Debug, Clone, Default, PartialEq)]
#[non_exhaustive]
pub struct FindProbe {
    /// The term set, none for no find.
    pub term: Option<String>,
    /// The current match.
    pub current: Option<crate::FoundCell>,
    /// A step's find is out.
    pub out: bool,
}

/// What a drawn cell shows of a find (`find`), on [`CellProbe`].
#[cfg(feature = "find")]
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum FoundProbe {
    /// Each occurrence of the term in its drawn text (after a format and
    /// the cut), as byte ranges of that text, tinted.
    Ranges(Vec<std::ops::Range<usize>>),
    /// The whole cell tinted: it matches, but its drawn text doesn't show
    /// the term (rounded, formatted, cut).
    Cell,
}

/// Where the cells are, in window pixels. Reported when it changes (the
/// scroll position is in [`TallTableProbe`]).
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct TallTableLayout {
    /// The cells area's left edge, right of the row numbers.
    pub left: f32,
    /// The cells area's top edge, under the header.
    pub top: f32,
    /// A row's height. Row `r`'s top is `top + (r - probe.top) * row_height`, and the
    /// column at place `c`'s left edge is `left + columns[c].x - probe.scroll_x` (with
    /// `pin`, less `probe.scroll_x` only when `c >= pinned`).
    pub row_height: f32,
    /// The cells area's width: the body's, less the row numbers and the
    /// vertical scrollbar.
    pub cells_width: f32,
    /// The columns pinned in effect (`pin`): the first `pinned` don't
    /// scroll, and the rest are clipped right of their edge.
    #[cfg(feature = "pin")]
    pub pinned: usize,
    /// Every column, in drawn order: each at its place.
    pub columns: Vec<ColumnProbe>,
    /// Each character a format writes and its advance in the cells' font
    /// at the size in effect (`format`): what a formatted text's fit sums.
    #[cfg(feature = "format")]
    pub advances: Vec<(char, f32)>,
    /// The header's rows (`group-headers`): the groups' levels plus the
    /// names' row, each `row_height` tall, the names' the bottom one. The
    /// group cells drawn come in their own event
    /// ([`TallTableEvent::Groups`](crate::TallTableEvent)).
    #[cfg(feature = "group-headers")]
    pub header_rows: usize,
}

/// A group's cell as drawn (`group-headers`): one a region where `pin`'s
/// edge splits its run. [`TallTableEvent::Groups`](crate::TallTableEvent)
/// reports a frame's, level by level.
#[cfg(feature = "group-headers")]
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct GroupProbe {
    /// Its header row, 0 at the top.
    pub level: usize,
    /// Its label, as the columns' paths spell it.
    pub label: String,
    /// The run's places, `start..end`: the whole run, so the two cells of
    /// a run split by `pin`'s edge share them.
    pub start: usize,
    /// One past the run's last place.
    pub end: usize,
    /// In the pinned region (`pin`).
    pub pinned: bool,
    /// The drawn cell's left, from the cells area's left, cut to its
    /// region's visible part.
    pub left: f32,
    /// The drawn cell's width, cut the same way.
    pub width: f32,
    /// The label's left, from the cells area's left.
    pub label_x: f32,
}

/// A column as laid out, at its place in [`TallTableLayout::columns`].
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct ColumnProbe {
    /// Its name: the header's text.
    pub name: String,
    /// Its left edge in the scrolled content, from the cells area's left.
    pub x: f32,
    /// Its width as drawn.
    pub width: f32,
    /// `text`, `integer`, `float`, or `decimal`.
    pub kind: &'static str,
    /// The characters a float may take.
    pub budget: usize,
    /// Its arrow's box (`sort`), its left from the column's left edge and
    /// its width; `None` for a column that draws none.
    #[cfg(feature = "sort")]
    pub arrow: Option<(f32, f32)>,
    /// Its index in [`TallTableState::columns`](crate::TallTableState::columns)
    /// (`reorder`): the layout's columns are in drawn order, each at its
    /// place.
    #[cfg(feature = "reorder")]
    pub index: usize,
    /// Hidden (`hide`): laid out at width 0 at its place, `x` the right
    /// edge of the column before it, and drawn nowhere.
    #[cfg(feature = "hide")]
    pub hidden: bool,
}

/// A drawn cell's value and the text handed to GPUI for it (which GPUI may
/// still cut to the column's width).
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct CellProbe {
    /// Its row, 0-based.
    pub row: u64,
    /// Its column's place, where it's drawn (with `reorder`, the layout's
    /// `ColumnProbe::index` at that place names the column).
    pub column: usize,
    /// The value's exact text (a float's shortest round-trip text).
    pub exact: String,
    /// The text handed to GPUI: rounded or formatted, before any cut to
    /// its column.
    pub shown: String,
    /// Its paint as drawn (`custom-cells`).
    #[cfg(feature = "custom-cells")]
    pub paint: PaintProbe,
    /// What's drawn of the find on it (`find`): none where it doesn't
    /// match (and isn't the current match).
    #[cfg(feature = "find")]
    pub found: Option<FoundProbe>,
    /// It's the current match (`find`), edged.
    #[cfg(feature = "find")]
    pub current: bool,
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
