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
mod delegate;
mod format;
mod pages;
mod probe;
mod scroll;
mod state;
mod tall_table;

pub use activity::ActivityStats;
pub use column::{ColumnKind, TallTableColumn};
pub use delegate::{CellValue, PageError, PageLoad, TallTableDelegate, TallTablePage};
pub use probe::{CellProbe, ColumnProbe, TallTableLayout, TallTableProbe};
pub use state::{ActivityOptions, Paging, TallTableEvent, TallTableState, TallTableStats, init};
pub use tall_table::TallTable;
