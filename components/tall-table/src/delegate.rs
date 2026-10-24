//! Where a table's rows come from: the delegate reads pages of rows when the
//! table asks, and a page hands back the table's own values.

use std::borrow::Cow;
use std::fmt;
use std::future::Future;
use std::ops::Range;
use std::pin::Pin;

use gpui_kit::App;

/// A page read the table waits on: the page, or why not.
pub type PageLoad<P> = Pin<Box<dyn Future<Output = Result<P, PageError>>>>;

/// The table's rows. The table decides which rows to read and when (the
/// visible pages first, then prefetch, at most `Paging::max_in_flight` at
/// once); the delegate reads them.
pub trait TallTableDelegate: 'static {
    type Page: TallTablePage;
    /// Names a read in flight, so the table can cancel it.
    type Request: Copy + PartialEq + 'static;

    /// Starts reading `rows` (0-based, end-exclusive), in order.
    fn load_page(
        &mut self,
        rows: Range<u64>,
        cx: &mut App,
    ) -> (Self::Request, PageLoad<Self::Page>);

    /// The table no longer wants `request`'s rows. Its load must still
    /// resolve (with [`PageError::Cancelled`], or with the page if it won
    /// the race): until it does, the table counts it as in flight, since a
    /// source may not be able to stop a read it has started.
    fn cancel(&mut self, request: Self::Request, cx: &mut App);
}

/// A loaded page of rows.
pub trait TallTablePage: 'static {
    /// The value at `row` (the page's own, from 0) and `column`, or `None`
    /// past its end.
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>>;

    /// The paint at `row` and `column` (`custom-cells`): a fill, a bar, and
    /// a text color, each 0..=1 through the column's ramps and bar. Asked
    /// only of a loaded row's drawn cells, each frame: compute it from the
    /// value the page already holds. Nothing by default.
    #[cfg(feature = "custom-cells")]
    fn paint(&self, row: usize, column: usize) -> crate::CellPaint {
        let _ = (row, column);
        crate::CellPaint::default()
    }

    /// The heap bytes it holds, counted against `Paging::budget_bytes`.
    fn heap_bytes(&self) -> usize;
}

/// A value as the table shows it.
#[derive(Debug, Clone, PartialEq)]
pub enum CellValue<'a> {
    /// Shown as a muted `NULL`.
    Null,
    /// A float: rounded to the digits its column fits, exact in its tooltip.
    Float(f64),
    Float32(f32),
    /// Anything else, as the source writes it: one line (line breaks show as
    /// `¶`), cut to its column, exact in its tooltip.
    Text(Cow<'a, str>),
}

impl fmt::Display for CellValue<'_> {
    /// The value's exact text. A float's is its shortest round-trip text
    /// (Debug, with an exponent for very large or small values: Display
    /// writes 1e300 as 301 digits).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Null => f.write_str("NULL"),
            Self::Float(value) => write!(f, "{value:?}"),
            Self::Float32(value) => write!(f, "{value:?}"),
            Self::Text(text) => f.write_str(text),
        }
    }
}

/// Why a page didn't load.
#[derive(Debug, Clone, PartialEq)]
pub enum PageError {
    /// The table cancelled it ([`TallTableDelegate::cancel`]).
    Cancelled,
    /// It failed: `message` shows in its rows. `read_failure` says the source
    /// itself is broken (a file it can no longer read): the table emits
    /// [`TallTableEvent::ReadFailed`](crate::TallTableEvent::ReadFailed) so the host
    /// can repair it and call
    /// [`TallTableState::retry_failed`](crate::TallTableState::retry_failed).
    Failed { message: String, read_failure: bool },
}
