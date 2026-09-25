//! The table's scroll position, in rows rather than pixels.
//!
//! GPUI's `uniform_list` (and so gpui-kit's `DataTable`) places rows at
//! `item_height * index + scroll_offset` in f32 pixels. At 1.5 M rows of 30 px
//! that's 47 M px, where f32 steps by 4 px, and at 25 M rows by 64 px: rows
//! jitter and small wheel deltas vanish. Here the position is an f64 row
//! index, exact to 2^53 rows, and only offsets within the viewport (a few
//! hundred pixels) become f32.

use std::ops::Range;

/// Where the viewport's top edge is, in rows, and how many rows it shows.
#[derive(Debug, Clone, PartialEq)]
pub struct RowScroll {
    rows: u64,
    /// The row at the viewport's top edge; the fraction is how much of that
    /// row is scrolled out of view.
    top: f64,
    /// Rows the viewport holds, possibly fractional.
    viewport_rows: f64,
}

impl RowScroll {
    pub fn new(rows: u64) -> Self {
        Self {
            rows,
            top: 0.0,
            viewport_rows: 0.0,
        }
    }

    pub fn rows(&self) -> u64 {
        self.rows
    }

    pub fn top(&self) -> f64 {
        self.top
    }

    pub fn viewport_rows(&self) -> f64 {
        self.viewport_rows
    }

    /// The largest `top`: the last row's bottom at the viewport's bottom.
    pub fn max_top(&self) -> f64 {
        (self.rows as f64 - self.viewport_rows).max(0.0)
    }

    /// Resizes the viewport, keeping the top row where it is when possible.
    /// Returns whether anything changed.
    pub fn set_viewport_rows(&mut self, viewport_rows: f64) -> bool {
        let viewport_rows = viewport_rows.max(0.0);
        if viewport_rows == self.viewport_rows {
            return false;
        }
        self.viewport_rows = viewport_rows;
        self.top = self.top.clamp(0.0, self.max_top());
        true
    }

    /// Moves the top to `top`, clamped. Returns whether it moved.
    pub fn set_top(&mut self, top: f64) -> bool {
        let top = if top.is_finite() {
            top.clamp(0.0, self.max_top())
        } else {
            self.top
        };
        let moved = top != self.top;
        self.top = top;
        moved
    }

    /// Scrolls by `delta` rows (positive is down).
    pub fn scroll_by(&mut self, delta: f64) -> bool {
        self.set_top(self.top + delta)
    }

    /// How far down the table is, from 0 (top) to 1 (bottom).
    pub fn fraction(&self) -> f64 {
        let max = self.max_top();
        if max > 0.0 { self.top / max } else { 0.0 }
    }

    pub fn set_fraction(&mut self, fraction: f64) -> bool {
        self.set_top(fraction.clamp(0.0, 1.0) * self.max_top())
    }

    /// The rows at least partly in view.
    pub fn visible(&self) -> Range<u64> {
        let start = (self.top.floor() as u64).min(self.rows);
        let end = ((self.top + self.viewport_rows).ceil() as u64).min(self.rows);
        start..end.max(start)
    }

    /// Where `row`'s top edge is, in rows from the viewport's top edge. Small
    /// for every visible row, so it converts to f32 pixels exactly enough.
    pub fn offset_of(&self, row: u64) -> f64 {
        row as f64 - self.top
    }
}

/// A scrollbar thumb's position and length along its track, in pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Thumb {
    pub offset: f32,
    pub length: f32,
}

/// The thumb for a track of `track` pixels showing `visible` of `total`
/// (any unit), scrolled to `fraction`. Never shorter than `min_length`, so it
/// stays grabbable over 25 M rows.
pub fn thumb(track: f32, visible: f64, total: f64, fraction: f64, min_length: f32) -> Thumb {
    let ratio = if total > 0.0 {
        (visible / total).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let length = (track * ratio as f32).max(min_length).min(track);
    let offset = (track - length) * fraction.clamp(0.0, 1.0) as f32;
    Thumb { offset, length }
}

/// The scroll fraction that puts the thumb's start at `offset` pixels along
/// the track. Its inverse is [`thumb`].
pub fn fraction_at(track: f32, length: f32, offset: f32) -> f64 {
    let travel = track - length;
    if travel > 0.0 {
        (f64::from(offset) / f64::from(travel)).clamp(0.0, 1.0)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_to_the_ends() {
        let mut scroll = RowScroll::new(100);
        scroll.set_viewport_rows(10.0);
        assert!(!scroll.scroll_by(-5.0));
        assert!(scroll.scroll_by(1_000.0));
        assert_eq!(scroll.top(), 90.0);
        assert_eq!(scroll.visible(), 90..100);
        assert_eq!(scroll.fraction(), 1.0);
    }

    #[test]
    fn fractional_rows_show_a_partial_row() {
        let mut scroll = RowScroll::new(100);
        scroll.set_viewport_rows(10.5);
        scroll.set_top(3.25);
        assert_eq!(scroll.visible(), 3..14);
        assert_eq!(scroll.offset_of(3), -0.25);
    }

    #[test]
    fn fewer_rows_than_the_viewport() {
        let mut scroll = RowScroll::new(3);
        scroll.set_viewport_rows(20.0);
        assert_eq!(scroll.max_top(), 0.0);
        assert!(!scroll.scroll_by(5.0));
        assert_eq!(scroll.visible(), 0..3);
        assert_eq!(scroll.fraction(), 0.0);
        assert_eq!(RowScroll::new(0).visible(), 0..0);
    }

    #[test]
    fn exact_far_down_a_huge_table() {
        // 25 M rows: f32 pixels would step by 64 px here; rows stay exact.
        let rows = 25_000_000;
        let mut scroll = RowScroll::new(rows);
        scroll.set_viewport_rows(28.0);
        scroll.set_fraction(1.0);
        assert_eq!(scroll.visible(), rows - 28..rows);
        // A 1 px wheel delta at 30 px rows still moves the table.
        assert!(scroll.scroll_by(-1.0 / 30.0));
        assert!((scroll.offset_of(rows - 29) - (-1.0 + 1.0 / 30.0)).abs() < 1e-6);
    }

    #[test]
    fn resizing_keeps_the_top_in_range() {
        let mut scroll = RowScroll::new(100);
        scroll.set_viewport_rows(10.0);
        scroll.set_fraction(1.0);
        scroll.set_viewport_rows(40.0);
        assert_eq!(scroll.top(), 60.0);
        assert!(!scroll.set_viewport_rows(40.0));
    }

    #[test]
    fn non_finite_positions_are_ignored() {
        let mut scroll = RowScroll::new(100);
        scroll.set_viewport_rows(10.0);
        assert!(!scroll.set_top(f64::NAN));
        assert_eq!(scroll.top(), 0.0);
    }

    #[test]
    fn thumb_geometry_round_trips() {
        let t = thumb(500.0, 30.0, 1_567_523.0, 0.9, 24.0);
        assert_eq!(t.length, 24.0);
        assert!((t.offset - 428.4).abs() < 1e-3);
        assert!((fraction_at(500.0, t.length, t.offset) - 0.9).abs() < 1e-6);
        // Everything fits: the thumb fills the track and can't travel.
        let full = thumb(500.0, 30.0, 10.0, 0.0, 24.0);
        assert_eq!((full.offset, full.length), (0.0, 500.0));
        assert_eq!(fraction_at(500.0, 500.0, 10.0), 0.0);
        assert_eq!(fraction_at(500.0, 24.0, 9_999.0), 1.0);
    }
}
