//! A GPUI table for row counts past what f32 pixels can scroll: every row of
//! a source, read a page at a time from a [`TableDelegate`] and drawn only
//! where the viewport is.
//!
//! Not gpui-kit's `DataTable`: its `uniform_list` positions rows in f32
//! pixels, which loses precision past ~16 M px (see `scroll.rs`). This one
//! keeps the scroll position in rows, draws the visible rows and columns
//! itself, and owns its scrollbars. Rows whose page isn't loaded yet draw as
//! placeholders; a frame never waits on data.
//!
//! [`TableState`] is the entity (scroll position, page cache, hover), and
//! [`Table`] the element that draws it with its keys and focus. It knows no
//! app: what it shows to a host (first rows, failed reads, probes for
//! scripts) goes out as [`TableEvent`]s.

mod activity;
mod column;
mod delegate;
mod format;
mod pages;
mod probe;
mod scroll;
mod state;
mod table;

pub use activity::ActivityStats;
pub use column::{Column, ColumnKind};
pub use delegate::{CellValue, PageError, PageLoad, TableDelegate, TablePage};
pub use probe::{CellProbe, ColumnProbe, TableLayout, TableProbe};
pub use state::{ActivityOptions, Paging, TableEvent, TableState, TableStats, init};
pub use table::Table;
