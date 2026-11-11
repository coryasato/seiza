//! The table's source: every page answered at once from the catalog, a view
//! over the files' bytes. Nothing is fetched and nothing is copied.

use std::ops::Range;
use std::rc::Rc;

use gpui_kit::App;
use seiza_tall_table::{CellValue, PageLoad, TallTableDelegate, TallTablePage, TallTableState};

use crate::catalog::Catalog;

pub type Table = TallTableState<Source>;

pub struct Source {
    catalog: Rc<Catalog>,
    /// Each read's id: never reused.
    next: u64,
}

impl Source {
    pub fn new(catalog: Rc<Catalog>) -> Self {
        Self { catalog, next: 0 }
    }
}

/// Rows `first..first + rows` of the catalog.
pub struct Page {
    catalog: Rc<Catalog>,
    first: usize,
    rows: usize,
}

impl TallTableDelegate for Source {
    type Page = Page;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Page>) {
        let page = Page {
            catalog: self.catalog.clone(),
            first: rows.start as usize,
            rows: (rows.end - rows.start) as usize,
        };
        self.next += 1;
        (self.next, Box::pin(std::future::ready(Ok(page))))
    }

    /// Every read has answered by the time it could be cancelled.
    fn cancel(&mut self, _: u64, _: &mut App) {}
}

impl TallTablePage for Page {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        (row < self.rows && self.first + row < self.catalog.rows())
            .then(|| self.catalog.value(self.first + row, column))
    }

    fn heap_bytes(&self) -> usize {
        // A view over the files' bytes: nothing of its own.
        0
    }
}
