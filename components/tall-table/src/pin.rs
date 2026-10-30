//! `pin`: where the first columns, fixed at the cells' left, put every
//! column. Pure geometry (tested natively, `fixtures/pin.json`'s subject):
//! the run in effect, each column's left edge, a screen x's content x, which
//! columns are drawn, and the sideways scroll that brings a column into view.
//! Every x here is in the cells area's pixels (right of the row numbers),
//! the scroll in pixels of content (`docs/DECISIONS.md`, "Features").

use crate::column::LaidOutColumn;

/// How far past half the cells' width a run's right edge may land and
/// still pin, in px: float rounding's, never a visible amount.
const SLACK: f32 = 0.001;

/// The columns pinned in effect: the first `count`, clamped to the columns,
/// and cut to the leading ones whose right edge is within half
/// `cells_width`, so the scrolled columns keep at least half the view.
/// Before the view has a width, none.
pub(crate) fn in_effect(columns: &[LaidOutColumn], count: usize, cells_width: f32) -> usize {
    // A hair over the half: a `resize` drag clamped at the half re-sums the
    // run's widths at the release, and an ulp over must not unpin it.
    let half = cells_width / 2.0 + SLACK;
    columns
        .iter()
        .take(count)
        .take_while(|column| column.x + column.width <= half)
        .count()
}

/// The run in effect, as drawn: how many columns it holds, and its right
/// edge, *P*.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Pin {
    pub(crate) columns: usize,
    /// The run's right edge, at most the cells' width: a run held through a
    /// `resize` drag while the view narrows never leaves the scrolled
    /// region a negative width.
    pub(crate) edge: f32,
    /// The fixture's negative controls.
    #[cfg(test)]
    pub(crate) control: Control,
}

/// `fixtures/pin.json`'s negative controls, and the window test's
/// unclipped paint.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Control {
    None,
    /// The pinned columns scroll with the rest.
    PinnedScroll,
    /// A scrolled column wholly under the run is still drawn.
    UnderRun,
    /// A column is brought into view at the gutter's edge, not *P*.
    IntoViewAtGutter,
    /// `custom-cells`' fills drawn in one canvas over both regions,
    /// unclipped at *P* (the window test's).
    #[cfg(feature = "custom-cells")]
    Unclipped,
}

impl Pin {
    /// The first `pinned` of `columns` (a run in effect), its edge clamped
    /// to `cells_width`.
    pub(crate) fn new(columns: &[LaidOutColumn], pinned: usize, cells_width: f32) -> Self {
        let pinned = pinned.min(columns.len());
        let edge = columns[..pinned].last().map_or(0.0, |column| {
            (column.x + column.width).min(cells_width.max(0.0))
        });
        Self {
            columns: pinned,
            edge,
            #[cfg(test)]
            control: Control::None,
        }
    }

    /// The run's right edge, *P*.
    #[inline(always)]
    pub(crate) fn edge(self) -> f32 {
        self.edge
    }

    /// The columns it holds.
    #[cfg(feature = "select")]
    #[inline(always)]
    pub(crate) fn pinned(self) -> usize {
        self.columns
    }

    /// Whether column `index` is pinned.
    #[inline(always)]
    pub(crate) fn holds(self, index: usize) -> bool {
        #[cfg(test)]
        if self.control == Control::PinnedScroll {
            return false;
        }
        index < self.columns
    }

    /// Column `index`'s left edge on screen: its laid-out `x`, less
    /// `scroll_x` unless it's pinned.
    #[inline(always)]
    pub(crate) fn left(self, index: usize, x: f32, scroll_x: f32) -> f32 {
        if self.holds(index) { x } else { x - scroll_x }
    }

    /// Column `index`'s left edge in its region: the pinned region starts at
    /// the cells' left, the scrolled one at *P*.
    #[inline(always)]
    pub(crate) fn layer_left(self, index: usize, x: f32, scroll_x: f32) -> f32 {
        if self.holds(index) {
            x
        } else {
            x - scroll_x - self.edge
        }
    }

    /// The content x under screen x `x`: left of *P*, the pinned columns'
    /// own; right of it, the scrolled content's.
    #[inline(always)]
    pub(crate) fn content_x(self, x: f32, scroll_x: f32) -> f32 {
        if x < self.edge { x } else { x + scroll_x }
    }

    /// Whether column `index`, laid out at `x` and `width` wide, is drawn: a
    /// pinned one where it starts in the view, a scrolled one where it
    /// overlaps the view right of *P*.
    #[inline(always)]
    pub(crate) fn visible(
        self,
        index: usize,
        x: f32,
        width: f32,
        scroll_x: f32,
        cells_width: f32,
    ) -> bool {
        if self.holds(index) {
            return x < cells_width;
        }
        #[cfg(test)]
        let edge = if self.control == Control::UnderRun {
            0.0
        } else {
            self.edge
        };
        #[cfg(not(test))]
        let edge = self.edge;
        x + width > scroll_x + edge && x < scroll_x + cells_width
    }

    /// The sideways move that brings column `index` (`x`, `width`) into
    /// view the least distance, right of *P*: none for a pinned column,
    /// which is always in view.
    #[cfg(any(test, feature = "select"))]
    pub(crate) fn into_view(
        self,
        index: usize,
        x: f32,
        width: f32,
        scroll_x: f32,
        cells_width: f32,
    ) -> f32 {
        if index < self.columns {
            return 0.0;
        }
        #[cfg(test)]
        let edge = if self.control == Control::IntoViewAtGutter {
            0.0
        } else {
            self.edge
        };
        #[cfg(not(test))]
        let edge = self.edge;
        crate::scroll::into_view(x, x + width, scroll_x + edge, scroll_x + cells_width)
    }

    /// The horizontal scrollbar's track: from *P* to the cells' right
    /// edge, its length (`cells_width − P`), which is also the view the
    /// thumb stands for, over the content right of *P*.
    pub(crate) fn track(self, cells_width: f32, content_width: f32) -> (f32, f32) {
        (
            (cells_width - self.edge).max(0.0),
            (content_width - self.edge).max(0.0),
        )
    }
}

#[cfg(test)]
mod tests {
    use gpui_kit::proptest::collection::vec;
    use gpui_kit::proptest::prelude::{any, prop_assert};
    use gpui_kit::proptest::test_runner::{Config, TestRunner};

    use super::{Pin, in_effect};
    use crate::column::{CellKind, LaidOutColumn};

    fn laid_out(widths: &[f32]) -> Vec<LaidOutColumn> {
        let mut x = 0.0;
        widths
            .iter()
            .enumerate()
            .map(|(index, width)| {
                let column = LaidOutColumn {
                    name: format!("c{index}").into(),
                    x,
                    width: *width,
                    kind: CellKind::Float,
                    budget: 1,
                };
                x += width;
                column
            })
            .collect()
    }

    #[test]
    fn the_run_is_cut_at_half_the_view() {
        let columns = laid_out(&[100.0, 100.0, 100.0]);
        assert_eq!(in_effect(&columns, 2, 400.0), 2, "200 is the half");
        assert_eq!(in_effect(&columns, 2, 399.0), 1);
        assert_eq!(in_effect(&columns, 2, 199.0), 0);
        assert_eq!(in_effect(&columns, 9, 1000.0), 3, "clamped to the columns");
        assert_eq!(in_effect(&columns, 2, 0.0), 0, "no view, no run");
    }

    /// `resize`'s clamp at the half (`Resizing::pin_limit`): the run's
    /// other widths taken back out of its edge, then summed again at the
    /// release, land an ulp over the half here, which must still pin.
    #[test]
    fn a_run_clamped_at_the_half_still_pins() {
        let (cells_width, others) = (810.18f32, 148.2f32);
        let columns = laid_out(&[others, 105.61]);
        let edge = Pin::new(&columns, 2, cells_width).edge;
        let limit = cells_width / 2.0 - (edge - columns[1].width);
        let clamped = laid_out(&[others, limit]);
        assert!(
            clamped[1].x + clamped[1].width > cells_width / 2.0,
            "the case is an ulp over"
        );
        assert_eq!(in_effect(&clamped, 2, cells_width), 2);
    }

    #[test]
    fn a_held_edge_is_clamped_to_the_view() {
        let columns = laid_out(&[300.0, 100.0]);
        assert_eq!(Pin::new(&columns, 1, 600.0).edge, 300.0);
        assert_eq!(Pin::new(&columns, 1, 200.0).edge, 200.0);
        assert_eq!(Pin::new(&columns, 0, 200.0).edge, 0.0);
    }

    /// The two mappings agree, over random widths, counts, views, and
    /// scrolls: a screen x in the cells maps to a column whose screen span
    /// holds it, and never to a scrolled column wholly under the run, which
    /// isn't drawn.
    #[test]
    fn the_mappings_round_trip() {
        let cases = (
            vec(20.0f32..400.0, 1..12),
            0usize..14,
            50.0f32..2000.0,
            0.0f32..=1.0,
            any::<u16>(),
        );
        let mut runner = TestRunner::new(Config::with_cases(512));
        let result = runner.run(&cases, |(widths, count, cells_width, scroll, at)| {
            let columns = laid_out(&widths);
            let content = columns.last().map_or(0.0, |column| column.x + column.width);
            let pin = Pin::new(
                &columns,
                in_effect(&columns, count, cells_width),
                cells_width,
            );
            let scroll_x = scroll * (content - cells_width).max(0.0);
            let x = f32::from(at) / f32::from(u16::MAX) * cells_width;
            let content_x = pin.content_x(x, scroll_x);
            let hit = columns
                .iter()
                .position(|column| (column.x..column.x + column.width).contains(&content_x));
            if let Some(index) = hit {
                let column = &columns[index];
                let left = pin.left(index, column.x, scroll_x);
                prop_assert!(
                    (left..left + column.width).contains(&x),
                    "x {x} → column {index} at {left}..{}",
                    left + column.width
                );
                prop_assert!(pin.visible(index, column.x, column.width, scroll_x, cells_width));
                prop_assert!(
                    index < pin.columns || left + column.width > pin.edge,
                    "column {index} is under the run"
                );
            }
            for (index, column) in columns.iter().enumerate().skip(pin.columns) {
                let left = pin.left(index, column.x, scroll_x);
                if left + column.width <= pin.edge {
                    prop_assert!(
                        !pin.visible(index, column.x, column.width, scroll_x, cells_width),
                        "column {index}, under the run, is drawn"
                    );
                }
            }
            Ok(())
        });
        if let Err(error) = result {
            panic!("{error}");
        }
    }
}
