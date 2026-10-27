//! `copy`: the selection as a spreadsheet's TSV of exact values, sent to
//! the host in pieces. Cmd+C and Ctrl+C (in the selection's context) and a
//! host's `copy` start it: `Started` in the task that asked, so a host on
//! the web opens its clipboard write while the gesture counts. Each page
//! comes, at its turn, from the cache if it holds the rows then, else from
//! a read of the copy's own beside the cache (never cached), at most the
//! cache's [`background_limit`](crate::pages::PageCache::background_limit)
//! with `live`'s re-reads, none while a visible page loads, ahead of
//! prefetch. Formatting runs off render, a turn of at most
//! [`TURN_CELLS`] cells at a time, each turn's text sent as one `Text` and
//! dropped (`docs/DECISIONS.md`, "Features").

use std::ops::RangeInclusive;

use gpui_kit::*;

use super::{TallTableEvent, TallTableState};
use crate::copy::{
    self as text, CopyFailure, CopyId, CopyOptions, CopyProgress, TURN_CELLS, TallTableCopy,
};
use crate::delegate::{PageError, TallTableDelegate, TallTablePage as _};

actions!(seiza_tall_table, [CopySelection]);

/// Binds Cmd+C and Ctrl+C in the selection's context (both, as Cmd+A is:
/// the table can't tell the platform without the browser). Called by
/// [`crate::init`] with the selection's.
pub(crate) fn init(cx: &mut App) {
    let context = Some(super::select::SELECT_CONTEXT);
    cx.bind_keys([
        KeyBinding::new("cmd-c", CopySelection, context),
        KeyBinding::new("ctrl-c", CopySelection, context),
    ]);
}

/// The table's copy, with the feature.
pub(super) struct CopyState<P, R> {
    pub(super) options: CopyOptions,
    /// The last copy's id: each new one is the next.
    last_id: u64,
    pub(super) running: Option<Running<P, R>>,
}

impl<P, R> Default for CopyState<P, R> {
    fn default() -> Self {
        Self {
            options: CopyOptions::default(),
            last_id: 0,
            running: None,
        }
    }
}

fn row_count(rows: &RangeInclusive<u64>) -> u64 {
    rows.end() - rows.start() + 1
}

/// A copy running.
pub(super) struct Running<P, R> {
    id: CopyId,
    pub(super) rows: RangeInclusive<u64>,
    columns: RangeInclusive<usize>,
    /// The next row to format.
    next_row: u64,
    /// Its reads in flight: the page and the request.
    reads: Vec<(u64, R)>,
    /// Pages read for it that landed, waiting for their turn.
    landed: Vec<(u64, P)>,
    /// The text sent so far, in bytes, and the header line's part of it.
    bytes: usize,
    header_bytes: usize,
    /// With headers: the line, until the first piece carries it.
    header: Option<String>,
    headers: bool,
    /// The cap when it started: options set since are the next copy's.
    max_bytes: usize,
    /// A page's worth of rows has been projected over the copy's.
    projected: bool,
    /// A turn is spawned and hasn't run.
    turn_pending: bool,
}

impl<P, R> Running<P, R> {
    fn row_count(&self) -> u64 {
        row_count(&self.rows)
    }

    fn rows_done(&self) -> u64 {
        self.next_row - self.rows.start()
    }

    fn holds(&self, page: u64) -> bool {
        self.landed.iter().any(|(landed, _)| *landed == page)
    }

    fn reading(&self, page: u64) -> bool {
        self.reads.iter().any(|(read, _)| *read == page)
    }

    /// The end of the rows the copy wants from `page`: the page's, or the
    /// copy's last row's.
    fn page_end(&self, page: u64, page_rows: u64) -> u64 {
        ((page + 1) * page_rows).min(self.rows.end() + 1)
    }
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// How copies are made from now on: the limits and the header line.
    pub fn set_copy_options(&mut self, options: CopyOptions) {
        self.copy_state.options = options;
    }

    pub fn copy_options(&self) -> CopyOptions {
        self.copy_state.options
    }

    /// Copies the selection, as Cmd+C does but past `key_max_cells` too:
    /// [`TallTableCopy::Started`] before this returns, then its text in
    /// pieces and its end. A copy running is cancelled first (its
    /// `Failed(Cancelled)` before the new `Started`). `None` with nothing
    /// selected, or once the table is closed.
    pub fn copy(&mut self, cx: &mut Context<Self>) -> Option<CopyId> {
        let (rows, columns) = self.copy_ranges()?;
        Some(self.start_copy(rows, columns, cx))
    }

    /// What a copy now would copy: the selection's rows and columns, given
    /// the table's. `None` with nothing selected, or once closed (no read
    /// could be sent: the copy would never end).
    fn copy_ranges(&self) -> Option<(RangeInclusive<u64>, RangeInclusive<usize>)> {
        if self.closed {
            return None;
        }
        let selection = self.selection_state.current?;
        Some((
            selection.rows(self.scroll.rows())?,
            selection.columns(self.columns.len())?,
        ))
    }

    /// Starts a copy of `rows` × `columns`: [`TallTableCopy::Started`],
    /// then its first turn.
    fn start_copy(
        &mut self,
        rows: RangeInclusive<u64>,
        columns: RangeInclusive<usize>,
        cx: &mut Context<Self>,
    ) -> CopyId {
        self.cancel_copy(cx);
        self.copy_state.last_id += 1;
        let id = CopyId(self.copy_state.last_id);
        cx.emit(TallTableEvent::Copy(TallTableCopy::Started {
            id,
            rows: rows.clone(),
            columns: columns.clone(),
        }));
        let options = self.copy_state.options;
        let header = options.headers.then(|| {
            text::header_line(
                self.column_info[columns.clone()]
                    .iter()
                    .map(|column| column.name().as_ref()),
            )
        });
        // Any value may be NULL: past the cap with every one empty, it's
        // refused before a read.
        let least = text::least_bytes(
            row_count(&rows),
            columns.clone().count(),
            header.as_ref().map(String::len),
        );
        if least > options.max_bytes as u64 {
            cx.emit(TallTableEvent::Copy(TallTableCopy::Failed {
                id,
                reason: CopyFailure::TooLarge {
                    bytes: usize::try_from(least).unwrap_or(usize::MAX),
                    max_bytes: options.max_bytes,
                },
            }));
            return id;
        }
        self.copy_state.running = Some(Running {
            id,
            next_row: *rows.start(),
            rows,
            columns,
            reads: Vec::new(),
            landed: Vec::new(),
            bytes: 0,
            header_bytes: 0,
            header,
            headers: options.headers,
            max_bytes: options.max_bytes,
            projected: false,
            turn_pending: false,
        });
        // Rows in hand are formatted now: a small copy of loaded rows ends
        // in this task.
        self.copy_turn(cx);
        id
    }

    /// The copy running, if any: its id, rows done, and rows.
    pub fn copying(&self) -> Option<CopyProgress> {
        self.copy_state
            .running
            .as_ref()
            .map(|running| CopyProgress {
                id: running.id,
                rows_done: running.rows_done(),
                rows: running.row_count(),
            })
    }

    /// Ends the copy running, if any, with `Failed(Cancelled)`.
    pub fn cancel_copy(&mut self, cx: &mut Context<Self>) {
        self.end_copy(CopyFailure::Cancelled, cx);
    }

    /// Ends the copy running, if any, with `reason`.
    fn end_copy(&mut self, reason: CopyFailure, cx: &mut Context<Self>) {
        if let Some(id) = self.drop_copy(cx) {
            cx.emit(TallTableEvent::Copy(TallTableCopy::Failed { id, reason }));
        }
    }

    /// Drops the copy running, its reads cancelled through the delegate
    /// (they drain as the cache's do), and returns its id: an end's, and
    /// `close`'s, which can't emit.
    pub(super) fn drop_copy(&mut self, cx: &mut App) -> Option<CopyId> {
        let running = self.copy_state.running.take()?;
        self.cancel_copy_reads(running.reads.into_iter().map(|(_, request)| request), cx);
        Some(running.id)
    }

    /// Cancels the copy's reads `requests` through the delegate: they drain
    /// as the cache's do.
    fn cancel_copy_reads(&mut self, requests: impl IntoIterator<Item = D::Request>, cx: &mut App) {
        for request in requests {
            self.delegate.cancel(request, cx);
            self.cache.copy_cancelled(request);
        }
    }

    /// `set_rows` shrank the rows to `rows`: a copy whose last row went is
    /// cancelled.
    pub(super) fn cut_copy(&mut self, rows: u64, cx: &mut Context<Self>) {
        if self
            .copy_state
            .running
            .as_ref()
            .is_some_and(|running| *running.rows.end() >= rows)
        {
            self.cancel_copy(cx);
        }
    }

    /// Escape: a copy running is cancelled, the selection kept.
    pub(super) fn escape_copy(&mut self, cx: &mut Context<Self>) -> bool {
        let running = self.copy_state.running.is_some();
        self.cancel_copy(cx);
        running
    }

    /// The pages the copy would read now, in order: those of its next
    /// [`background_limit`](crate::pages::PageCache::background_limit)
    /// from its turn's that it hasn't in hand, isn't reading, and the cache
    /// neither holds nor is reading for `wanted` (the copy waits for that
    /// read, and takes the page from the cache; a read the plan is about to
    /// cancel, of a page no longer wanted, it doesn't wait for). A page
    /// evicted since it was passed over is read at its turn.
    pub(super) fn copy_wants(&self, wanted: &[u64]) -> Vec<u64> {
        let Some(running) = &self.copy_state.running else {
            return Vec::new();
        };
        let end = *running.rows.end();
        if running.next_row > end {
            return Vec::new();
        }
        let page_rows = self.cache.page_rows();
        let turn = running.next_row / page_rows;
        let last = (end / page_rows).min(turn + self.cache.background_limit() as u64 - 1);
        (turn..=last)
            .filter(|&page| {
                let page_end = running.page_end(page, page_rows);
                !running.holds(page)
                    && !running.reading(page)
                    && self.cache.holding(page, page_end).is_none()
                    && !(self.cache.loading(page, page_end) && wanted.contains(&page))
            })
            .collect()
    }

    /// Sends the copy's reads of `pages`, each answered on a task of its
    /// own.
    pub(super) fn start_copy_reads(&mut self, pages: &[u64], cx: &mut Context<Self>) {
        let Some(id) = self.copy_state.running.as_ref().map(|running| running.id) else {
            return;
        };
        for &page in pages {
            let (request, load) = self.delegate.load_page(self.cache.rows_of(page), cx);
            self.cache.copy_started(page, request);
            if let Some(running) = self.copy_state.running.as_mut() {
                running.reads.push((page, request));
            }
            cx.spawn(async move |this, cx| {
                let result = load.await;
                let _ = this.update(cx, |this, cx| {
                    this.copy_read_done(id, page, request, result, cx);
                });
            })
            .detach();
        }
    }

    /// A copy's read answered: its place frees, whatever became of the
    /// copy; its page waits for its turn (or goes, if the turn passed it,
    /// copied from the cache's), or the copy fails.
    fn copy_read_done(
        &mut self,
        id: CopyId,
        page: u64,
        request: D::Request,
        result: Result<D::Page, PageError>,
        cx: &mut Context<Self>,
    ) {
        self.cache.copy_answered(request);
        let page_rows = self.cache.page_rows();
        let read = self
            .copy_state
            .running
            .as_mut()
            .filter(|running| running.id == id)
            .and_then(|running| {
                let index = running
                    .reads
                    .iter()
                    .position(|read| *read == (page, request))?;
                Some((running, index))
            });
        let Some((running, index)) = read else {
            // Cancelled, or its copy ended: its place is free.
            self.copy_load(cx);
            return;
        };
        running.reads.remove(index);
        match result {
            Ok(rows) => {
                if page >= running.next_row / page_rows {
                    running.landed.push((page, rows));
                }
                if running.turn_pending {
                    self.copy_load(cx);
                } else {
                    self.copy_turn(cx);
                }
            }
            Err(PageError::Failed {
                message,
                read_failure,
            }) => {
                self.end_copy(CopyFailure::Read(message), cx);
                if read_failure {
                    cx.emit(TallTableEvent::ReadFailed);
                }
                self.copy_load(cx);
            }
            // The source refused a read the table didn't cancel.
            Err(PageError::Cancelled) => {
                self.end_copy(CopyFailure::Read("the source cancelled a read".into()), cx);
                self.copy_load(cx);
            }
        }
    }

    /// Plans the reads, as a page landing does: with `live`, not while a
    /// scrollbar drag moves (its settle or release plans them, and would
    /// otherwise read the pages it passes), but once it rests.
    fn copy_load(&mut self, cx: &mut Context<Self>) {
        #[cfg(feature = "live")]
        if self.drag.is_some() && !self.drag_resting {
            return;
        }
        self.load_pages(cx);
    }

    /// A turn: formats up to [`TURN_CELLS`] cells from the rows in hand,
    /// sends them as one piece, and ends the copy at its last row or past
    /// its cap, checked a row at a time. The next turn is spawned if its
    /// page is in hand, else runs when it lands. Every way out plans the
    /// reads, so a place the copy freed is used.
    fn copy_turn(&mut self, cx: &mut Context<Self>) {
        let page_rows = self.cache.page_rows();
        let Some(running) = self.copy_state.running.as_mut() else {
            return;
        };
        running.turn_pending = false;
        let max_bytes = running.max_bytes;
        let columns = running.columns.clone();
        let mut budget = (TURN_CELLS / columns.clone().count() as u64).max(1);
        let mut piece = running.header.take().unwrap_or_default();
        running.header_bytes += piece.len();
        let (first_row, end) = (*running.rows.start(), *running.rows.end());
        let row_count = end - first_row + 1;
        // The size it's refused at: past the cap, or projected past twice it.
        let mut refused = None;
        'turn: while budget > 0 && running.next_row <= end {
            let page = running.next_row / page_rows;
            let first = page * page_rows;
            let page_end = running.page_end(page, page_rows);
            let landed = running.landed.iter().find(|(landed, _)| *landed == page);
            let Some(rows) = landed
                .map(|(_, rows)| rows)
                .or_else(|| self.cache.holding(page, page_end))
            else {
                break;
            };
            let stop = page_end.min(running.next_row + budget);
            budget -= stop - running.next_row;
            for row in running.next_row..stop {
                if row != first_row || running.headers {
                    piece.push('\n');
                }
                for (index, column) in columns.clone().enumerate() {
                    if index > 0 {
                        piece.push('\t');
                    }
                    text::push_value(&mut piece, rows.value((row - first) as usize, column));
                }
                running.next_row = row + 1;
                // A row at a time, so a turn of wide values never builds
                // much past the cap.
                let bytes = running.bytes + piece.len();
                if bytes > max_bytes {
                    refused = Some(bytes);
                    break 'turn;
                }
                // A page's worth of rows in and the copy going on: refused
                // early if their bytes a row, over the copy's rows, pass
                // twice the cap. Never fewer rows: a selection starting on a
                // page's last row would project from that row alone.
                let done = running.next_row - first_row;
                if !running.projected && done == page_rows && running.next_row <= end {
                    running.projected = true;
                    let per_row = (bytes - running.header_bytes) as f64 / done as f64;
                    let projected = running.header_bytes as f64 + per_row * row_count as f64;
                    if projected > 2.0 * max_bytes as f64 {
                        refused = Some(projected.min(usize::MAX as f64) as usize);
                        break 'turn;
                    }
                }
            }
            if stop == page_end {
                running.landed.retain(|(landed, _)| *landed != page);
            }
        }
        let (id, done) = (running.id, running.next_row > end);
        if let Some(bytes) = refused {
            self.end_copy(CopyFailure::TooLarge { bytes, max_bytes }, cx);
            self.copy_load(cx);
            return;
        }
        let bytes = running.bytes + piece.len();
        running.bytes = bytes;
        let rows_done = running.rows_done();
        if !piece.is_empty() {
            cx.emit(TallTableEvent::Copy(TallTableCopy::Text {
                id,
                text: piece,
                rows_done,
            }));
        }
        if done {
            // Its reads still out (pages it took from the cache instead)
            // are cancelled.
            self.drop_copy(cx);
            cx.emit(TallTableEvent::Copy(TallTableCopy::Copied {
                id,
                rows: rows_done,
                bytes,
            }));
            self.copy_load(cx);
            return;
        }
        self.drop_passed(cx);
        self.copy_wake(cx);
        self.copy_load(cx);
    }

    /// The pages behind the copy's turn, copied from the cache while its
    /// own reads of them were out: those reads are cancelled, and a page
    /// that landed for one goes, so the copy holds only pages to come.
    fn drop_passed(&mut self, cx: &mut Context<Self>) {
        let page_rows = self.cache.page_rows();
        let Some(running) = self.copy_state.running.as_mut() else {
            return;
        };
        let turn = running.next_row / page_rows;
        running.landed.retain(|(page, _)| *page >= turn);
        let passed: Vec<D::Request> = running
            .reads
            .iter()
            .filter(|(page, _)| *page < turn)
            .map(|(_, request)| *request)
            .collect();
        running.reads.retain(|(page, _)| *page >= turn);
        self.cancel_copy_reads(passed, cx);
    }

    /// Spawns the copy's next turn if its page is in hand (landed, or in
    /// the cache) and none is pending: a turn of its own, so a frame can
    /// come between. Each plan calls it too (and a page landing during a
    /// drag, which plans nothing), so a page the cache loads for the reader
    /// is copied as soon as it lands.
    pub(super) fn copy_wake(&mut self, cx: &mut Context<Self>) {
        let page_rows = self.cache.page_rows();
        let Some(running) = self.copy_state.running.as_mut() else {
            return;
        };
        if running.turn_pending || running.next_row > *running.rows.end() {
            return;
        }
        let page = running.next_row / page_rows;
        let page_end = running.page_end(page, page_rows);
        if !running.holds(page) && self.cache.holding(page, page_end).is_none() {
            return;
        }
        running.turn_pending = true;
        let id = running.id;
        cx.spawn(async move |this, cx| {
            let _ = this.update(cx, |this, cx| {
                if this
                    .copy_state
                    .running
                    .as_ref()
                    .is_some_and(|running| running.id == id && running.turn_pending)
                {
                    this.copy_turn(cx);
                }
            });
        })
        .detach();
    }

    /// Cmd+C and Ctrl+C: copies the selection of at most `key_max_cells`
    /// cells; past it, `Declined` and nothing read. With nothing selected
    /// (or the table closed), the key goes on.
    pub(crate) fn copy_selection(
        &mut self,
        _: &CopySelection,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some((rows, columns)) = self.copy_ranges() else {
            cx.propagate();
            return;
        };
        let (row_count, column_count) = (row_count(&rows), columns.clone().count());
        if row_count.saturating_mul(column_count as u64) > self.copy_state.options.key_max_cells {
            cx.emit(TallTableEvent::Copy(TallTableCopy::Declined {
                rows: row_count,
                columns: column_count,
            }));
            return;
        }
        self.start_copy(rows, columns, cx);
    }
}

#[cfg(test)]
mod tests;
