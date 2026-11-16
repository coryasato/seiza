//! `clicks`: a press, a double press, and a context press on the table,
//! reported with what it's on and where ([`TallTableEvent::Clicked`]). The
//! table draws no menu: a host hangs its own on gpui-kit's `ContextMenuExt`
//! round the table, or opens one at the position (`docs/DECISIONS.md`,
//! "Features"). The press's kind and its count are decided here; the hit
//! test and what a press does to the rest are the state's (`state/click.rs`).
//!
//! [`TallTableEvent::Clicked`]: crate::TallTableEvent::Clicked

use gpui_kit::{Modifiers, Pixels, Point};

/// A press's kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClickKind {
    /// A left press the table counts first.
    Press,
    /// A left press the table counts second; the first was a `Press`.
    Double,
    /// The right button's press, a touch's long press, or (when the host
    /// says Ctrl+press is one,
    /// [`set_ctrl_press_is_context`](crate::TallTableState::set_ctrl_press_is_context))
    /// a left press with Ctrl.
    Context,
}

/// What a press is on. A column is its place (where it's drawn); with
/// `reorder`, `order()[place]` is its index. Non-exhaustive: a feature may
/// add a target (`group-headers`' `Group`), so a match on it builds with
/// the variant compiled in or not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ClickTarget {
    Cell {
        row: u64,
        column: usize,
    },
    /// A row's number, in the gutter.
    Row(u64),
    /// A header cell.
    Column(usize),
    /// The header over the gutter.
    Corner,
    /// The header row or the body (gutter included) where none of the
    /// above is: below the last row, past the last column.
    Blank,
    /// A group's cell (`group-headers`): its level (0 at the top) and its
    /// run's places, `start..end`, the whole run even when `pin`'s edge
    /// splits its cell. A blank in a group row is its column's header.
    #[cfg(feature = "group-headers")]
    Group {
        level: usize,
        start: usize,
        end: usize,
    },
}

/// A press on the table: its kind, what it's on, and where.
#[derive(Debug, Clone, PartialEq)]
pub struct TallTableClick {
    pub kind: ClickKind,
    pub target: ClickTarget,
    /// The pointer, in window coordinates (a long press's start).
    pub position: Point<Pixels>,
    pub modifiers: Modifiers,
}

/// The table's count of left presses: gpui-pre-web's `click_count` counts
/// every button's presses (a right press then a left one within 400 ms and
/// 5 px is 2), so a left press's count is the last left press's plus one
/// only when `click_count` says it's a repeat and the last press the table
/// saw was a left press it counted.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Count {
    /// The last press's count, if it was a left press the table counted.
    last: Option<usize>,
}

impl Count {
    /// A press the table doesn't count (a context press, another button,
    /// a press a band, an arrow, or a scrollbar stopped): the next left
    /// press is a first.
    pub(crate) fn other(&mut self) {
        self.last = None;
    }

    /// A left press the table counts, at gpui's `click_count`: its count.
    pub(crate) fn left(&mut self, click_count: usize) -> usize {
        let count = match self.last {
            Some(last) if click_count >= 2 => last + 1,
            _ => 1,
        };
        self.last = Some(count);
        count
    }
}

impl ClickKind {
    /// A counted left press's kind: none from the third on.
    pub(crate) fn counted(count: usize) -> Option<Self> {
        match count {
            1 => Some(Self::Press),
            2 => Some(Self::Double),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ClickKind, Count};

    #[test]
    fn left_presses_count_from_the_last_counted_one() {
        let mut count = Count::default();
        assert_eq!(count.left(1), 1);
        assert_eq!(count.left(2), 2);
        assert_eq!(count.left(3), 3);
        // gpui's count restarts: so does the table's.
        assert_eq!(count.left(1), 1);
    }

    #[test]
    fn a_left_press_after_another_press_is_a_first() {
        let mut count = Count::default();
        // A right press, then a left one gpui counts 2.
        count.other();
        assert_eq!(count.left(2), 1);
        assert_eq!(count.left(3), 2);
        // A first press gpui counts 2 (after a press the table never saw).
        let mut fresh = Count::default();
        assert_eq!(fresh.left(2), 1);
    }

    #[test]
    fn kinds() {
        assert_eq!(ClickKind::counted(1), Some(ClickKind::Press));
        assert_eq!(ClickKind::counted(2), Some(ClickKind::Double));
        assert_eq!(ClickKind::counted(3), None);
    }
}
