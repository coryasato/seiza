//! `reorder`: a move of a block of columns, pure (tested natively,
//! `fixtures/reorder.json`'s subject): the order after it, each column's
//! place after it, `pin`'s count after it, and `select`'s range after it;
//! and a drag's gap, where its release moves the block (`gap`).
//! A column's place is where it's drawn (0 at the left); its index is its
//! place in `set_columns`' list, which a page reads it by
//! (`docs/DECISIONS.md`, "Features").

use std::ops::Range;

use crate::column::LaidOutColumn;
#[cfg(feature = "select")]
use crate::selection::{Kind, TallTableSelection};

/// `fixtures/reorder.json`'s negative controls, and the random test's.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Control {
    #[default]
    None,
    /// The fixture's `count-kept`: a move across `pin`'s edge leaves the
    /// count as it was.
    CountKept,
    /// The fixture's `recount`: the count recounted from the columns (the
    /// clamped count, changed by what crossed) even when nothing crossed,
    /// so a host's count past the columns is lost.
    Recount,
    /// The fixture's `selection-unmoved`: the selection left at its places.
    SelectionUnmoved,
    /// The random test's `ReadByPlace`: a drawn cell read from its page by
    /// its place, not its column's index.
    ReadByPlace,
    /// The fixture's `gap-by-left-edge`: the gap after the last column
    /// whose left edge, not its center, is left of the pointer.
    GapByLeftEdge,
    /// The fixture's `beside-the-block`: a gap beside the block is a gap
    /// (a move to the block's own place).
    BesideTheBlock,
    /// The fixture's `no-edge-gap`: the run's end beside the block refused
    /// too, so a column can't be pinned or unpinned where it is.
    NoEdgeGap,
}

/// A move: the columns at `places` (a block of places) to land with the
/// first at place `to`, in the order after the move.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Move {
    pub(crate) places: Range<usize>,
    pub(crate) to: usize,
}

impl Move {
    /// Whether it's a move among `columns` columns: a block of at least
    /// one, within them, and `to` at most `columns` less the block's length.
    pub(crate) fn fits(&self, columns: usize) -> bool {
        !self.places.is_empty()
            && self.places.end <= columns
            && self.to <= columns - self.places.len()
    }

    /// Where the column at `place` is drawn after the move: a block's
    /// column at `to` on, any other where it was among the rest.
    pub(crate) fn place_after(&self, place: usize) -> usize {
        let (start, length) = (self.places.start, self.places.len());
        if self.places.contains(&place) {
            return self.to + (place - start);
        }
        let rest = if place < start { place } else { place - length };
        if rest < self.to { rest } else { rest + length }
    }

    /// `order` (`order[place]`, the index drawn there) after the move.
    pub(crate) fn order_after(&self, order: &[usize]) -> Vec<usize> {
        let mut after = vec![0; order.len()];
        for (place, &index) in order.iter().enumerate() {
            after[self.place_after(place)] = index;
        }
        after
    }

    /// `pin`'s count after the move, from the host's `count`, among
    /// `columns` columns. With *r* the run's columns outside the block (the
    /// count clamped to the columns, less the block's pinned ones), a `to`
    /// below *r* lands the block pinned, above it scrolled, and at *r*, the
    /// run's end, on the side `pinned` says (`None`: its first column's).
    /// If a column changes side, the clamped count plus those that joined
    /// the run less those that left it; otherwise the host's count, past
    /// the columns or not. `None` where `pinned` names the side `to` isn't
    /// on: no move.
    #[cfg(any(feature = "pin", test))]
    pub(crate) fn count_after(
        &self,
        count: usize,
        columns: usize,
        pinned: Option<bool>,
        #[cfg(test)] control: Control,
    ) -> Option<usize> {
        let clamped = count.min(columns);
        let block_pinned = self
            .places
            .end
            .min(clamped)
            .saturating_sub(self.places.start.min(clamped));
        let rest = clamped - block_pinned;
        let lands_pinned = match self.to.cmp(&rest) {
            std::cmp::Ordering::Less => true,
            std::cmp::Ordering::Greater => false,
            std::cmp::Ordering::Equal => pinned.unwrap_or(self.places.start < clamped),
        };
        if pinned.is_some_and(|pinned| pinned != lands_pinned) {
            return None;
        }
        let (joined, left) = if lands_pinned {
            (self.places.len() - block_pinned, 0)
        } else {
            (0, block_pinned)
        };
        #[cfg(test)]
        match control {
            Control::CountKept => return Some(count),
            Control::Recount => return Some(clamped + joined - left),
            _ => {}
        }
        if joined == 0 && left == 0 {
            return Some(count);
        }
        Some(clamped + joined - left)
    }

    /// The count after the move if it moves anything (`move_columns`'
    /// decision): it fits, `pinned` names `to`'s side or none, and the
    /// order or the count changes. `None`: no move.
    #[cfg(any(feature = "pin", test))]
    pub(crate) fn moves(
        &self,
        columns: usize,
        count: usize,
        pinned: Option<bool>,
        #[cfg(test)] control: Control,
    ) -> Option<usize> {
        if !self.fits(columns) {
            return None;
        }
        let after = self.count_after(
            count,
            columns,
            pinned,
            #[cfg(test)]
            control,
        )?;
        (self.to != self.places.start || after != count).then_some(after)
    }

    /// `select`'s range after the move: `Rows` as it was; a `Columns` or
    /// `Cells` range's columns each moved, kept if they're still a
    /// contiguous run of places (that run, its rows kept, its direction
    /// kept: the anchor at the run's end on its side), else `None`.
    #[cfg(feature = "select")]
    pub(crate) fn selection_after(
        &self,
        selection: TallTableSelection,
        #[cfg(test)] control: Control,
    ) -> Option<TallTableSelection> {
        #[cfg(test)]
        if control == Control::SelectionUnmoved {
            return Some(selection);
        }
        // Kept as it was, its anchor's and head's columns too: they're
        // places, so after a move the active cell (where the arrow keys and
        // `jump_to` start) is whichever column now sits there. Decided, not
        // missed (`docs/DECISIONS.md`, "Features"): to make it follow its
        // column, map both columns through `place_after` here and update
        // `reorder.json`'s `rows-kept`.
        if selection.kind() == Kind::Rows {
            return Some(selection);
        }
        let (anchor, head) = (selection.anchor(), selection.head());
        let (low, high) = (anchor.1.min(head.1), anchor.1.max(head.1));
        let (first, last) = (low..=high)
            .map(|place| self.place_after(place))
            .fold((usize::MAX, 0), |(first, last), place| {
                (first.min(place), last.max(place))
            });
        if last - first != high - low {
            return None;
        }
        let (anchor_column, head_column) = if anchor.1 <= head.1 {
            (first, last)
        } else {
            (last, first)
        };
        Some(selection.with((anchor.0, anchor_column), (head.0, head_column)))
    }
}

/// A drag's gap: where its release moves the block.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Gap {
    /// The place the gap is before, `0..=columns`: the line is at its
    /// column's left, or past the last column at its right.
    pub(crate) at: usize,
    /// The move's `to`: the block's first place after it.
    pub(crate) to: usize,
    /// The side the block lands on (`move_columns_pinned`'s `pinned`): at
    /// the run's end, where both sides meet, the pointer's side of the
    /// run's edge; elsewhere the side `to` is on, so the release never
    /// refuses a gap the line showed (`pin`).
    #[cfg(any(feature = "pin", test))]
    pub(crate) pinned: bool,
    /// The 2 px line's left, in the cells area's pixels, inside the
    /// pointer's region.
    pub(crate) line: f32,
}

/// The line's width.
pub(crate) const LINE: f32 = 2.0;

/// What a drag's gap is found over: the columns laid out in drawn order,
/// the cells area's width, the sideways scroll, and the run pinned in
/// effect (`run` columns to `edge`, the cells area's pixels; 0 and 0
/// without `pin`).
#[derive(Debug, Clone, Copy)]
pub(crate) struct View<'a> {
    pub(crate) columns: &'a [LaidOutColumn],
    pub(crate) cells_width: f32,
    pub(crate) scroll_x: f32,
    pub(crate) run: usize,
    pub(crate) edge: f32,
}

/// The gap a drag of `block` (places) shows over `view` with the pointer
/// at `x` (the cells area's pixels, at any height), the host's pin count
/// `count`. `None`: the release moves nothing.
///
/// The pointer's region is the run (left of its edge) or the scrolled
/// columns; among its visible columns the gap is after the last whose
/// center is left of `x`, else before its first. A gap inside the block or
/// beside it is none, except the run's end with the pointer on the other
/// side of the edge from a block wholly on one side: that pins or unpins
/// it where it is. And a gap is one only where its move changes something
/// (`Move::moves`).
pub(crate) fn gap(
    view: View<'_>,
    count: usize,
    block: Range<usize>,
    x: f32,
    #[cfg(test)] control: Control,
) -> Option<Gap> {
    let View {
        columns,
        cells_width,
        scroll_x,
        run,
        edge,
    } = view;
    if block.is_empty() || block.end > columns.len() {
        return None;
    }
    let run = run.min(columns.len());
    let pointer_pinned = run > 0 && x < edge;
    let left = |place: usize| {
        let column = &columns[place];
        if place < run {
            column.x
        } else {
            column.x - scroll_x
        }
    };
    // The region's visible places, contiguous: the run's that start in the
    // view, or the scrolled ones overlapping it right of the edge.
    let mut region = if pointer_pinned {
        0..run
    } else {
        run..columns.len()
    }
    .filter(|&place| {
        let column = &columns[place];
        if place < run {
            column.x < cells_width
        } else {
            column.x + column.width > scroll_x + edge && column.x < scroll_x + cells_width
        }
    });
    let first = region.next()?;
    let last = region.next_back().unwrap_or(first);
    let middle = |place: usize| {
        #[cfg(test)]
        if control == Control::GapByLeftEdge {
            return left(place);
        }
        left(place) + columns[place].width / 2.0
    };
    let at = (first..=last)
        .rev()
        .find(|&place| middle(place) < x)
        .map_or(first, |place| place + 1);
    let line = if at <= last {
        left(at)
    } else {
        left(last) + columns[last].width - LINE
    };
    let (low, high) = if pointer_pinned {
        (0.0, edge - LINE)
    } else {
        (edge, cells_width - LINE)
    };
    let line = line.min(high).max(low);
    let (start, end) = (block.start, block.end);
    if start < at && at < end {
        return None;
    }
    let to = if at <= start { at } else { at - block.len() };
    // Beside the block: no gap but at the run's end, across it.
    if at == start || at == end {
        #[cfg(test)]
        match control {
            Control::BesideTheBlock => {
                return Some(Gap {
                    at,
                    to,
                    pinned: pointer_pinned,
                    line,
                });
            }
            Control::NoEdgeGap => return None,
            _ => {}
        }
        let across = (end <= run && !pointer_pinned) || (start >= run && pointer_pinned);
        if run == 0 || at != run || !across {
            return None;
        }
    }
    #[cfg(any(feature = "pin", test))]
    let pinned = {
        let clamped = count.min(columns.len());
        let block_pinned = end.min(clamped).saturating_sub(start.min(clamped));
        let rest = clamped - block_pinned;
        if to == rest {
            pointer_pinned
        } else {
            to < rest
        }
    };
    #[cfg(any(feature = "pin", test))]
    let moves = Move { places: block, to }
        .moves(
            columns.len(),
            count,
            Some(pinned),
            #[cfg(test)]
            Control::None,
        )
        .is_some();
    #[cfg(not(any(feature = "pin", test)))]
    let moves = {
        let _ = count;
        to != start
    };
    moves.then_some(Gap {
        at,
        to,
        #[cfg(any(feature = "pin", test))]
        pinned,
        line,
    })
}

/// Whether `order` is a permutation of `0..columns`.
pub(crate) fn is_order(order: &[usize], columns: usize) -> bool {
    let mut seen = vec![false; columns];
    order.len() == columns
        && order
            .iter()
            .all(|&index| index < columns && !std::mem::replace(&mut seen[index], true))
}

#[cfg(test)]
mod tests {
    use super::{Move, is_order};

    /// Every move's order is the block lifted out and put back at `to`, and
    /// `place_after` agrees with it.
    #[test]
    fn a_move_lifts_the_block_out_and_puts_it_back() {
        for columns in 1..=7usize {
            let order: Vec<usize> = (0..columns).collect();
            for start in 0..columns {
                for end in start + 1..=columns {
                    for to in 0..=columns - (end - start) {
                        let mv = Move {
                            places: start..end,
                            to,
                        };
                        assert!(mv.fits(columns));
                        let mut rest: Vec<usize> = order.clone();
                        let block: Vec<usize> = rest.drain(start..end).collect();
                        rest.splice(to..to, block);
                        assert_eq!(mv.order_after(&order), rest, "{mv:?} of {columns}");
                        assert!(is_order(&rest, columns));
                    }
                }
            }
        }
    }

    #[test]
    fn a_move_past_the_columns_doesnt_fit() {
        let mv = |places, to| Move { places, to };
        assert!(!mv(0..0, 0).fits(4));
        assert!(!mv(3..5, 0).fits(4));
        assert!(!mv(0..2, 3).fits(4));
        assert!(mv(0..2, 2).fits(4));
    }

    #[test]
    fn an_order_is_a_permutation() {
        assert!(is_order(&[2, 0, 1], 3));
        assert!(!is_order(&[0, 0, 1], 3));
        assert!(!is_order(&[0, 1], 3));
        assert!(!is_order(&[0, 1, 3], 3));
    }
}
