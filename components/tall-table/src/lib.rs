//! A GPUI table that reads every row of a source a page at a time from a
//! [`TallTableDelegate`] and draws only where the viewport is, smooth from a
//! hundred rows to tens of millions.
//!
//! Not gpui-kit's `DataTable`: its `uniform_list` positions rows in f32
//! pixels, which loses precision past ~16 M px (see `scroll.rs`). This one
//! keeps the scroll position in rows, draws the visible rows and columns
//! itself, and owns its scrollbars. Rows whose page isn't loaded yet draw as
//! placeholders; a frame never waits on data.
//!
//! [`TallTableState`] is the entity (scroll position, page cache, hover), and
//! [`TallTable`] the element that draws it with its keys and focus. It knows
//! no app: what it shows to a host (first rows, failed reads, probes for
//! scripts) goes out as [`TallTableEvent`]s.

mod activity;
mod column;
#[cfg(feature = "copy")]
mod copy;
mod delegate;
#[cfg(all(feature = "live", feature = "custom-cells"))]
mod flash;
mod format;
mod pages;
#[cfg(feature = "custom-cells")]
mod paint;
#[cfg(feature = "pin")]
mod pin;
mod probe;
mod scroll;
#[cfg(feature = "select")]
mod selection;
#[cfg(feature = "sort")]
mod sort;
mod state;
mod tall_table;

pub use activity::ActivityStats;
pub use column::{ColumnKind, TallTableColumn};
#[cfg(feature = "copy")]
pub use copy::{CopyFailure, CopyId, CopyOptions, CopyProgress, TallTableCopy};
pub use delegate::{CellValue, PageError, PageLoad, TallTableDelegate, TallTablePage};
#[cfg(feature = "custom-cells")]
pub use paint::{Bar, CellPaint, Domain, Ramp, Stop};
#[cfg(feature = "custom-cells")]
pub use probe::PaintProbe;
pub use probe::{CellProbe, ColumnProbe, TallTableLayout, TallTableProbe};
#[cfg(feature = "select")]
pub use selection::{Cell, Selectable, TallTableSelection};
#[cfg(feature = "sort")]
pub use sort::{Sort, SortDirection, SortIcons, SortRefused};
pub use state::{ActivityOptions, Paging, TallTableEvent, TallTableState, TallTableStats, init};
pub use tall_table::TallTable;
