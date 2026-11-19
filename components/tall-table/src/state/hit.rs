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
    /// A group's cell (`group-headers`): its level and its run's places.
    #[cfg(feature = "group-headers")]
    Group {
        level: usize,
        start: usize,
        end: usize,
    },
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
            #[cfg(feature = "group-headers")]
            Target::Group { .. } => None,
        }
    }
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// The cell nearest `position` (window pixels): the pointer's clamped
    /// to the visible cells, and past the last column to the last (with
    /// `hide`, the last shown; none with every column hidden).
    #[cfg(any(feature = "select", feature = "clicks"))]
    pub(super) fn cell_clamped(&self, position: Point<Pixels>) -> Option<Cell> {
        let last_row = self.scroll.rows().checked_sub(1)?;
        #[cfg(not(feature = "hide"))]
        let last_column = self.columns.len().checked_sub(1)?;
        #[cfg(feature = "hide")]
        let last_column = (0..self.columns.len())
            .rev()
            .find(|&place| self.place_shown(place))?;
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
    /// gutter, or its header (the header is the row above the body; with
    /// `group-headers`, the corner is the header's full height). Past the
    /// last row or column, nothing.
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
            // A group's cell; a blank is its column's header.
            #[cfg(feature = "group-headers")]
            if let Some(Some((level, start, end))) = self.group_row_at(position) {
                return Some(Target::Group { level, start, end });
            }
            let past = !self.columns.last().is_some_and(|column| {
                self.place().content_x(x, self.scroll_x) < column.x + column.width
            });
            if y < -self.header_height() || x >= self.cells_width() || past {
                return None;
            }
            return self.cell_clamped(position).map(Target::Header);
        }
        if y < 0.0 {
            // The corner is the header's full height (`group-headers`).
            return (y >= -self.header_height()).then_some(Target::Corner);
        }
        let row = (self.scroll.top() + f64::from(y / row_h)).floor();
        if y >= f32::from(self.viewport().height) || row as u64 >= self.scroll.rows() {
            return None;
        }
        self.cell_clamped(position).map(Target::Gutter)
    }

    /// The header's height: the names' row, and with `group-headers` the
    /// group rows over it.
    #[inline(always)]
    fn header_height(&self) -> f32 {
        let row_h = f32::from(self.sizes().row());
        #[cfg(feature = "group-headers")]
        return row_h * (self.group_rows() + 1) as f32;
        #[cfg(not(feature = "group-headers"))]
        row_h
    }

    /// The place whose header is under `position` (window pixels), if any:
    /// the header's rows, over the cells area, on a column (a group's cell
    /// is found first by its callers: `press_move`, and `target_at`, which
    /// finds a group with no rows too). With no rows, where
    /// [`Self::target_at`] finds no header.
    #[cfg(any(feature = "reorder", feature = "clicks"))]
    pub(super) fn header_place_at(&self, position: Point<Pixels>) -> Option<usize> {
        let x = f32::from(position.x - self.body.origin.x) - self.gutter_width();
        let y = f32::from(position.y - self.body.origin.y);
        if !(-self.header_height()..0.0).contains(&y) || !(0.0..self.cells_width()).contains(&x) {
            return None;
        }
        let x = self.place().content_x(x, self.scroll_x);
        self.columns
            .iter()
            .position(|column| (column.x..column.x + column.width).contains(&x))
    }

    /// In a group row (`group-headers`): the group's cell under `position`
    /// (window pixels), its level and its run's places, or `Some(None)` over
    /// a blank. `None` outside the group rows. The cells are worked out from
    /// the runs and the layout in effect, as the other hit tests read them,
    /// not the last frame's: a setter between frames would leave those stale.
    #[cfg(all(
        feature = "group-headers",
        any(feature = "select", feature = "reorder", feature = "clicks")
    ))]
    pub(super) fn group_row_at(
        &self,
        position: Point<Pixels>,
    ) -> Option<Option<(usize, usize, usize)>> {
        let depth = self.group_rows();
        let x = f32::from(position.x - self.body.origin.x) - self.gutter_width();
        let y = f32::from(position.y - self.body.origin.y);
        let row_h = f32::from(self.sizes().row());
        let top = -row_h * (depth + 1) as f32;
        if depth == 0 || !(top..-row_h).contains(&y) || !(0.0..self.cells_width()).contains(&x) {
            return None;
        }
        let level = (((y - top) / row_h).floor() as usize).min(depth - 1);
        let columns = &self.columns;
        let cells = crate::groups::cells(
            &self.group_state.runs,
            |place| (columns[place].x, columns[place].width),
            self.group_view(),
            #[cfg(test)]
            self.group_state.control,
        );
        Some(
            cells
                .iter()
                .find(|cell| {
                    cell.level == level && (cell.left..cell.left + cell.width).contains(&x)
                })
                .map(|cell| (level, cell.start, cell.end)),
        )
    }
}
