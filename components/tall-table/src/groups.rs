//! `group-headers`: the runs of the columns' label paths, and the cells
//! a frame draws for them. Pure (tested natively, `fixtures/group-headers.json`'s
//! subject). A run is a group's columns: at level *i*, neighboring places
//! whose paths are both deeper than *i* and agree through *i*. The runs are
//! worked out where the columns are laid out, never in a frame; a frame
//! cuts their cells to each region's visible part, `pin`'s edge splitting
//! a run's cell, never the run. Every x here is in the cells area's pixels
//! (right of the row numbers), the scroll in pixels of content
//! (`docs/DECISIONS.md`, "Features").

use std::ops::Range;

use gpui_kit::SharedString;

/// A group's columns: its level (0 at the top), its places `start..end`,
/// and its label.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Run {
    pub(crate) level: usize,
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) label: SharedString,
}

/// Every run of the drawn order, level by level, each level's left to
/// right; `depth` the deepest path's length (the header's group rows).
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Groups {
    pub(crate) depth: usize,
    pub(crate) runs: Vec<Run>,
}

/// `fixtures/group-headers.json`'s negative controls (the drawing half).
#[cfg(test)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Control {
    #[default]
    None,
    /// The runs found over the paths in index order, laid onto the places
    /// (`DataTable`'s spans): a move leaves the groups where they were.
    GroupsByPlace,
    /// A run across `pin`'s edge drawn whole in the region where it
    /// starts, the other region drawing none of it.
    NoSplitAtEdge,
    /// The label at the run's middle, not kept at its visible part's left.
    LabelCentered,
}

/// The runs of `paths`, given in drawn order (`paths[place]`, outermost
/// first).
pub(crate) fn runs<'a>(paths: impl ExactSizeIterator<Item = &'a [SharedString]> + Clone) -> Groups {
    let depth = paths.clone().map(<[SharedString]>::len).max().unwrap_or(0);
    let paths: Vec<&[SharedString]> = paths.collect();
    let mut runs = Vec::new();
    for level in 0..depth {
        let mut place = 0;
        while place < paths.len() {
            let path = paths[place];
            if path.len() <= level {
                place += 1;
                continue;
            }
            let through = &path[..=level];
            let start = place;
            place += 1;
            while place < paths.len()
                && paths[place].len() > level
                && &paths[place][..=level] == through
            {
                place += 1;
            }
            runs.push(Run {
                level,
                start,
                end: place,
                label: path[level].clone(),
            });
        }
    }
    Groups { depth, runs }
}

/// Where a frame draws the columns: `pinned` columns in effect, the run's
/// edge, the sideways scroll, the cells' width, and a cell's padding on
/// one side (the label's inset).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct View {
    pub(crate) pinned: usize,
    pub(crate) edge: f32,
    pub(crate) scroll_x: f32,
    pub(crate) cells_width: f32,
    pub(crate) pad: f32,
}

/// A run's cell as drawn in one region: cut to the region's visible part.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Cell {
    pub(crate) level: usize,
    pub(crate) label: SharedString,
    /// The whole run's places, in both halves of a split cell.
    pub(crate) start: usize,
    pub(crate) end: usize,
    /// In the pinned region.
    pub(crate) pinned: bool,
    /// The visible part's left and width, from the cells area's left.
    pub(crate) left: f32,
    pub(crate) width: f32,
    /// The label's left, from the same edge.
    pub(crate) label_x: f32,
    /// The run ends at this cell's right: its border is drawn there.
    pub(crate) closed: bool,
}

#[cfg(test)]
impl Cell {
    /// The places it stands for.
    pub(crate) fn places(&self) -> Range<usize> {
        self.start..self.end
    }
}

/// The cells `groups`' runs draw in `view`, level by level: each run's
/// pinned part and scrolled part, each cut to its region's visible part
/// (the pinned region `0..edge`, the scrolled one `edge..cells_width`),
/// none where nothing of it shows. `column(place)` is a place's laid-out
/// left and width.
pub(crate) fn cells(
    groups: &Groups,
    column: impl Fn(usize) -> (f32, f32),
    view: View,
    #[cfg(test)] control: Control,
) -> Vec<Cell> {
    let right = |place: usize| {
        let (x, width) = column(place);
        x + width
    };
    let mut cells = Vec::new();
    for run in &groups.runs {
        #[cfg(test)]
        let split = control != Control::NoSplitAtEdge;
        #[cfg(not(test))]
        let split = true;
        // The run's full span on screen, for the centered control.
        #[cfg(test)]
        let full = {
            let shift = |place: usize| {
                if place < view.pinned {
                    0.0
                } else {
                    view.scroll_x
                }
            };
            (
                column(run.start).0 - shift(run.start),
                right(run.end - 1) - shift(run.end - 1),
            )
        };
        let mut part = |pinned: bool, places: Range<usize>, closes: bool| {
            let shift = if pinned { 0.0 } else { view.scroll_x };
            let (from, to) = if pinned {
                (0.0, view.edge)
            } else {
                (view.edge, view.cells_width)
            };
            let left = column(places.start).0 - shift;
            let end = right(places.end - 1) - shift;
            let (visible_left, visible_right) = (left.max(from), end.min(to));
            if visible_right <= visible_left {
                return;
            }
            #[cfg_attr(not(test), expect(unused_mut))]
            let mut label_x = visible_left + view.pad;
            #[cfg(test)]
            if control == Control::LabelCentered {
                label_x = (full.0 + full.1) / 2.0;
            }
            cells.push(Cell {
                level: run.level,
                label: run.label.clone(),
                start: run.start,
                end: run.end,
                pinned,
                left: visible_left,
                width: visible_right - visible_left,
                label_x,
                closed: closes && end <= to,
            });
        };
        if run.start < view.pinned {
            let end = if split {
                run.end.min(view.pinned)
            } else {
                run.end
            };
            part(true, run.start..end, end == run.end);
        }
        let start = run.start.max(view.pinned);
        if run.end > view.pinned && (split || run.start >= view.pinned) {
            part(false, start..run.end, true);
        }
    }
    cells
}

#[cfg(test)]
mod tests {
    use gpui_kit::SharedString;

    use super::{Control, Run, View, cells, runs};

    fn paths(paths: &[&[&str]]) -> Vec<Vec<SharedString>> {
        paths
            .iter()
            .map(|path| {
                path.iter()
                    .map(|label| SharedString::from(*label))
                    .collect()
            })
            .collect()
    }

    fn found(paths: &[Vec<SharedString>]) -> Vec<(usize, usize, usize, String)> {
        runs(paths.iter().map(Vec::as_slice))
            .runs
            .into_iter()
            .map(
                |Run {
                     level,
                     start,
                     end,
                     label,
                 }| (level, start, end, label.to_string()),
            )
            .collect()
    }

    /// A run needs its neighbors to agree through its level, and a path
    /// shorter than the level leaves a blank; equal labels under other
    /// parents are other runs.
    #[test]
    fn runs_agree_through_their_level() {
        let paths = paths(&[
            &["A", "x"],
            &["A", "x"],
            &["A", "y"],
            &[],
            &["B", "x"],
            &["A", "x"],
            &["A"],
        ]);
        let groups = runs(paths.iter().map(Vec::as_slice));
        assert_eq!(groups.depth, 2);
        assert_eq!(
            found(&paths),
            [
                (0, 0, 3, "A".into()),
                (0, 4, 5, "B".into()),
                (0, 5, 7, "A".into()),
                (1, 0, 2, "x".into()),
                (1, 2, 3, "y".into()),
                (1, 4, 5, "x".into()),
                (1, 5, 6, "x".into()),
            ]
        );
    }

    #[test]
    fn no_paths_no_runs() {
        let paths = paths(&[&[], &[]]);
        let groups = runs(paths.iter().map(Vec::as_slice));
        assert_eq!((groups.depth, groups.runs.len()), (0, 0));
    }

    /// A run across `pin`'s edge draws two cells, each with the whole
    /// run's places; a cell cut at the view's right isn't closed.
    #[test]
    fn the_edge_splits_a_cell_not_the_run() {
        let paths = paths(&[&["A"], &["A"], &["A"], &["A"]]);
        let groups = runs(paths.iter().map(Vec::as_slice));
        let view = View {
            pinned: 1,
            edge: 100.0,
            scroll_x: 50.0,
            cells_width: 250.0,
            pad: 8.0,
        };
        let drawn = cells(
            &groups,
            |place| (place as f32 * 100.0, 100.0),
            view,
            Control::None,
        );
        let got: Vec<_> = drawn
            .iter()
            .map(|cell| {
                (
                    cell.pinned,
                    cell.places(),
                    cell.left,
                    cell.width,
                    cell.label_x,
                    cell.closed,
                )
            })
            .collect();
        assert_eq!(
            got,
            [
                (true, 0..4, 0.0, 100.0, 8.0, false),
                (false, 0..4, 100.0, 150.0, 108.0, false),
            ]
        );
    }

    /// A run held through a `resize` drag while the view narrows: the
    /// edge is clamped to the cells, and the pinned cell to the edge.
    #[test]
    fn a_clamped_edge_cuts_the_pinned_cell() {
        let paths = paths(&[&["A"], &["A"], &["A"]]);
        let groups = runs(paths.iter().map(Vec::as_slice));
        let view = View {
            pinned: 2,
            edge: 150.0,
            scroll_x: 0.0,
            cells_width: 150.0,
            pad: 8.0,
        };
        let drawn = cells(
            &groups,
            |place| (place as f32 * 100.0, 100.0),
            view,
            Control::None,
        );
        let got: Vec<_> = drawn
            .iter()
            .map(|cell| (cell.pinned, cell.left, cell.width))
            .collect();
        assert_eq!(
            got,
            [(true, 0.0, 150.0)],
            "the scrolled part is out of view"
        );
    }
}
