//! `group-headers`: the runs of the columns' label paths, worked out where
//! the columns are laid out (`lay_out`), and the header's group rows drawn
//! over the names' row, each run's cell cut to its region's visible part
//! ([`crate::groups`] is the geometry; `docs/DECISIONS.md`, "Features").

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use super::{TallTableState, padded};
use crate::delegate::TallTableDelegate;
use crate::groups::{self, Groups, View};

/// The runs, and the cells the last frame drew of them.
#[derive(Debug, Default)]
pub(crate) struct GroupState {
    /// The drawn order's runs, from the last `lay_out`.
    pub(crate) runs: Groups,
    /// The cells the last frame drew, level by level: the layout probe's.
    pub(crate) drawn: Vec<groups::Cell>,
    /// The cells the layout probe last reported.
    pub(super) published: Vec<groups::Cell>,
    /// The fixture's and the window tests' negative controls.
    #[cfg(test)]
    pub(crate) control: groups::Control,
    /// The cells drawn in the selection's tint last frame, `(level,
    /// start, pinned)` (`select`).
    #[cfg(all(test, feature = "select"))]
    pub(crate) tinted: Vec<(usize, usize, bool)>,
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// The runs worked out again over the columns in drawn order: at each
    /// layout (the columns, the order, or the widths changed).
    pub(super) fn regroup(&mut self) {
        #[cfg(test)]
        if self.group_state.control == groups::Control::GroupsByPlace {
            // `DataTable`'s spans: the paths in index order, laid on the
            // places whatever the order.
            self.group_state.runs = groups::runs(
                self.column_info
                    .iter()
                    .map(|column| column.group.as_slice()),
            );
            return;
        }
        let (columns, info) = (&self.columns, &self.column_info);
        self.group_state.runs = groups::runs(
            columns
                .iter()
                .enumerate()
                .map(|(place, column)| info[column.index(place)].group.as_slice()),
        );
    }

    /// The header's group rows: one a level of the deepest path.
    #[inline(always)]
    pub(super) fn group_rows(&self) -> usize {
        self.group_state.runs.depth
    }

    /// Where the frame draws the columns, for the groups' cells.
    pub(super) fn group_view(&self) -> View {
        let place = self.place();
        #[cfg(feature = "pin")]
        let pinned = place.columns;
        #[cfg(not(feature = "pin"))]
        let pinned = 0;
        View {
            pinned,
            edge: place.edge(),
            scroll_x: self.scroll_x,
            cells_width: self.cells_width(),
            pad: self.sizes().padding() / 2.0,
        }
    }

    /// The group rows, over the names' row: each run's cell at its level's
    /// row, cut to its region's visible part, its label at that part's
    /// left, a 1 px `border` line at its bottom and, where the run ends in
    /// view, its right. With `select`, a cell whose columns are all among
    /// `selected` in the selection's tint. None with no groups.
    pub(super) fn render_groups(
        &mut self,
        #[cfg(feature = "select")] selected: Option<&std::ops::RangeInclusive<usize>>,
        cx: &App,
    ) -> Option<Div> {
        let depth = self.group_rows();
        if depth == 0 {
            self.group_state.drawn.clear();
            return None;
        }
        let view = self.group_view();
        let columns = &self.columns;
        let drawn = groups::cells(
            &self.group_state.runs,
            |place| (columns[place].x, columns[place].width),
            view,
            #[cfg(test)]
            self.group_state.control,
        );
        #[cfg(feature = "select")]
        let theme = cx.theme();
        let sizes = self.sizes();
        let row = sizes.row();
        #[cfg(feature = "select")]
        let tinted = |cell: &groups::Cell| {
            selected.is_some_and(|columns| {
                columns.contains(&cell.start) && columns.contains(&(cell.end - 1))
            })
        };
        #[cfg(all(test, feature = "select"))]
        {
            self.group_state.tinted = drawn
                .iter()
                .filter(|cell| tinted(cell))
                .map(|cell| (cell.level, cell.start, cell.pinned))
                .collect();
        }
        let cells = drawn.iter().map(|cell| {
            let left = if cell.pinned {
                cell.left
            } else {
                cell.left - view.edge
            };
            let element = self.group_cell(
                cell.level,
                left,
                cell.width,
                cell.closed,
                cell.label.clone(),
                cx,
            );
            #[cfg(feature = "select")]
            let element = element.when(tinted(cell), |element| element.bg(theme.table_active));
            (cell.pinned, element)
        });
        #[cfg(not(feature = "pin"))]
        let layer = self.columns_layer(cells.map(|(_, cell)| cell));
        #[cfg(feature = "pin")]
        let layer = {
            let (pinned, scrolled): (Vec<_>, Vec<_>) = cells.partition(|(pinned, _)| *pinned);
            self.split_layer(
                self.place(),
                pinned.into_iter().map(|(_, cell)| cell),
                scrolled.into_iter().map(|(_, cell)| cell),
            )
        };
        self.group_state.drawn = drawn;
        Some(
            div()
                .absolute()
                .top_0()
                .left_0()
                .right_0()
                .h(row * depth as f32)
                .child(layer),
        )
    }

    /// The group cells of a lifted `block` (`reorder`'s preview), each
    /// run's cut to the block, from `first`, the block's left: a lifted
    /// group carries its label, a column under a group the group's row.
    #[cfg(feature = "reorder")]
    pub(super) fn preview_groups(
        &self,
        block: std::ops::Range<usize>,
        first: f32,
        cx: &App,
    ) -> Vec<Div> {
        #[cfg(test)]
        let row = self.sizes().row();
        self.group_state
            .runs
            .runs
            .iter()
            .filter(|run| run.start < block.end && block.start < run.end)
            .map(|run| {
                let (start, end) = (run.start.max(block.start), run.end.min(block.end));
                let left = self.columns[start].x - first;
                let right = self.columns[end - 1].x + self.columns[end - 1].width - first;
                #[cfg(test)]
                self.move_drawn.borrow_mut().groups.push((
                    run.level,
                    f32::from(row) * run.level as f32,
                    left,
                    right - left,
                ));
                self.group_cell(
                    run.level,
                    left,
                    right - left,
                    end == run.end,
                    run.label.clone(),
                    cx,
                )
            })
            .collect()
    }

    /// A group's cell: at its `level`'s row, `left` in its layer, `width`
    /// wide, a 1 px `border` line at its bottom and, where its run ends
    /// (`closed`), its right; its label at its left plus the padding, cut
    /// to it. The header's and `reorder`'s preview's.
    fn group_cell(
        &self,
        level: usize,
        left: f32,
        width: f32,
        closed: bool,
        label: SharedString,
        cx: &App,
    ) -> Div {
        let sizes = self.sizes();
        let row = sizes.row();
        padded(
            div()
                .absolute()
                .top(row * level as f32)
                .h(row)
                .left(px(left))
                .w(px(width))
                .border_b_1()
                .when(closed, |cell| cell.border_r_1())
                .border_color(cx.theme().border),
            sizes,
        )
        .line_height(row)
        .truncate()
        .child(label)
    }

    /// `layer` (over the columns, the header's height) put in the names'
    /// row, the bottom one, while there are group rows.
    pub(super) fn in_names_row(&self, layer: Div) -> Div {
        if self.group_rows() == 0 {
            return layer;
        }
        div()
            .absolute()
            .left_0()
            .right_0()
            .bottom_0()
            .h(self.sizes().row())
            .child(layer)
    }

    /// Whether the groups drawn differ from those the layout probe last
    /// reported; marks them reported.
    pub(super) fn groups_moved(&mut self) -> bool {
        if self.group_state.drawn == self.group_state.published {
            return false;
        }
        self.group_state.published = self.group_state.drawn.clone();
        true
    }

    /// The groups drawn, for the layout probe.
    pub(super) fn group_probes(&self) -> Vec<crate::GroupProbe> {
        self.group_state
            .drawn
            .iter()
            .map(|cell| crate::GroupProbe {
                level: cell.level,
                label: cell.label.to_string(),
                start: cell.start,
                end: cell.end,
                pinned: cell.pinned,
                left: cell.left,
                width: cell.width,
                label_x: cell.label_x,
            })
            .collect()
    }
}
