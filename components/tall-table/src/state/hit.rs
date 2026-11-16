//! The presses' hit tests, for the features that read them (`select`,
//! `reorder`, `clicks`): what a press is on, the cell nearest the pointer,
//! and the header under it. Built only with one of them, so the base has
//! none (the hover's own is `cell_at`). Everything here is by place
//! (`src/CLAUDE.md`, "Places and indices").

use gpui_kit::*;

use super::TallTableState;
use crate::delegate::TallTableDelegate;

/// A cell: its row and its column's place.
#[cfg(any(feature = "select", feature = "clicks"))]
pub(super) type Cell = (u64, usize);

/// What a press is on.
#[cfg(any(feature = "select", feature = "clicks"))]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum Target {
    Cell(Cell),
    /// The row-number gutter: its row, at the first visible column.
    Gutter(Cell),
    /// A header cell: its column, at the top visible row.
    Header(Cell),
    /// The header over the gutter.
    Corner,
}

#[cfg(feature = "select")]
impl Target {
    /// The cell, and which of its coordinates the press picked.
    pub(super) fn cell(self) -> Option<(Cell, bool, bool)> {
        match self {
            Target::Cell(cell) => Some((cell, true, true)),
            Target::Gutter(cell) => Some((cell, true, false)),
            Target::Header(cell) => Some((cell, false, true)),
            Target::Corner => None,
        }
    }
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// The cell nearest `position` (window pixels): the pointer's clamped
    /// to the visible cells, and past the last column to the last.
    #[cfg(any(feature = "select", feature = "clicks"))]
    pub(super) fn cell_clamped(&self, position: Point<Pixels>) -> Option<Cell> {
        let last_row = self.scroll.rows().checked_sub(1)?;
        let last_column = self.columns.len().checked_sub(1)?;
        let x = f32::from(position.x - self.body.origin.x) - self.gutter_width();
        let y = f32::from(position.y - self.body.origin.y);
        // A hair inside the far edges, so the clamp lands on a cell there.
        let x = self.place().content_x(
            x.clamp(0.0, (self.cells_width() - 0.5).max(0.0)),
            self.scroll_x,
        );
        let y = y.clamp(0.0, (f32::from(self.viewport().height) - 0.5).max(0.0));
        let row = (self.scroll.top() + f64::from(y / f32::from(self.sizes().row()))).floor() as u64;
        let column = self
            .columns
            .iter()
            .position(|column| x < column.x + column.width)
            .unwrap_or(last_column);
        Some((row.min(last_row), column))
    }

    /// What a press at `position` is on, if it's on the table's cells, its
    /// gutter, or its header (the header is the row above the body). Past
    /// the last row or column, nothing.
    #[cfg(any(feature = "select", feature = "clicks"))]
    pub(super) fn target_at(&self, position: Point<Pixels>) -> Option<Target> {
        let x = f32::from(position.x - self.body.origin.x) - self.gutter_width();
        let y = f32::from(position.y - self.body.origin.y);
        let row_h = f32::from(self.sizes().row());
        if x >= 0.0 {
            if y >= 0.0 {
                // The hover's hit test.
                return self.cell_at(position).map(Target::Cell);
            }
            let past = !self.columns.last().is_some_and(|column| {
                self.place().content_x(x, self.scroll_x) < column.x + column.width
            });
            if y < -row_h || x >= self.cells_width() || past {
                return None;
            }
            return self.cell_clamped(position).map(Target::Header);
        }
        if y < 0.0 {
            return (y >= -row_h).then_some(Target::Corner);
        }
        let row = (self.scroll.top() + f64::from(y / row_h)).floor();
        if y >= f32::from(self.viewport().height) || row as u64 >= self.scroll.rows() {
            return None;
        }
        self.cell_clamped(position).map(Target::Gutter)
    }

    /// The place whose header is under `position` (window pixels), if any:
    /// the header's row, over the cells area, on a column. With no rows,
    /// where [`Self::target_at`] finds no header.
    #[cfg(any(feature = "reorder", feature = "clicks"))]
    pub(super) fn header_place_at(&self, position: Point<Pixels>) -> Option<usize> {
        let x = f32::from(position.x - self.body.origin.x) - self.gutter_width();
        let y = f32::from(position.y - self.body.origin.y);
        let row_h = f32::from(self.sizes().row());
        if !(-row_h..0.0).contains(&y) || !(0.0..self.cells_width()).contains(&x) {
            return None;
        }
        let x = self.place().content_x(x, self.scroll_x);
        self.columns
            .iter()
            .position(|column| (column.x..column.x + column.width).contains(&x))
    }
}
