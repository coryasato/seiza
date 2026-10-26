//! `follow`: the view kept at the tail as `set_rows` grows the rows. A flag
//! the reader's actions set and clear, never the position alone; while it's
//! on, the view's bottom is pinned to the loaded tail, the last row the
//! cache draws with every row above it in view loaded, and moves on only
//! down, as reads land (`docs/DECISIONS.md`, "Features").

use gpui_kit::Context;

use super::{Drag, TallTableEvent, TallTableState};
use crate::delegate::TallTableDelegate;

/// What a reader's vertical move does to following.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Reach {
    /// Down (a wheel or a key): keeps following on, or turns it on at the end.
    Down,
    /// Somewhere chosen (End, a jump, a drag released): following is
    /// whether it landed at the end.
    Land,
    /// Up (a wheel or a key by any amount, Home): following stops.
    Up,
}

/// The paging fixture's `follow` negative controls (`fixtures/paging.json`),
/// each a way to get following wrong that the fixture must catch.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Control {
    #[default]
    None,
    /// Following is being at the end: a small table follows at open.
    FollowAtEnd,
    /// The reader never lets go: only `follow()` and the end turn it on.
    IgnoresReader,
    /// The view kept at `rows()`, loaded or not.
    PinToRows,
    /// The visible pages planned top to bottom while following.
    TopFirst,
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Scrolls to the end and follows it: as `set_rows` grows the rows, the
    /// view stays at the last rows read, until the reader scrolls up. Before
    /// a read at the end has landed, the view is at `rows()`, as a jump
    /// there is; from then on, at the loaded tail. A host following from
    /// the start (a log view) calls it before the first frame.
    pub fn follow(&mut self, cx: &mut Context<Self>) {
        // On first, so the move's reads are planned bottom first.
        self.set_following(true, cx);
        self.move_top_to(self.scroll.max_top(), cx);
    }

    /// Whether the view is following the end.
    pub fn is_following(&self) -> bool {
        #[cfg(test)]
        if self.follow_control == Control::FollowAtEnd {
            return self.scroll.top() == self.scroll.max_top();
        }
        self.following
    }

    /// Starting to follow forgets the tail drawn, so the first filled frame
    /// at the end emits `TailDrawn` again, grown or not: a host's "back to
    /// the tail" sees it land on a source that stopped growing.
    fn set_following(&mut self, following: bool, cx: &mut Context<Self>) {
        if std::mem::replace(&mut self.following, following) != following {
            if following {
                self.tail_drawn = 0;
            }
            cx.emit(TallTableEvent::Following(following));
        }
    }

    /// The reader is moving the view vertically, `reach`'s way, its top to
    /// `top` (clamped as the move clamps it). Decided before the move, so
    /// the move's reads are planned bottom first if it follows. A vertical
    /// drag holds following as it was until its release decides.
    pub(super) fn reader_moved(&mut self, reach: Reach, top: f64, cx: &mut Context<Self>) {
        if matches!(self.drag, Some(Drag::Vertical { .. })) {
            return;
        }
        // Every move clamps to `max_top` (`RowScroll::set_top`), and one to
        // a top that isn't finite stays where it is.
        let max_top = self.scroll.max_top();
        let at_end = if top.is_finite() {
            top >= max_top
        } else {
            self.scroll.top() == max_top
        };
        let following = match reach {
            Reach::Down => self.following || at_end,
            Reach::Land => at_end,
            Reach::Up => false,
        };
        #[cfg(test)]
        if self.follow_control == Control::IgnoresReader && !following {
            return;
        }
        self.set_following(following, cx);
    }

    /// While following, moves the view down to the loaded tail: its bottom
    /// at the end of the rows drawn with their values from its top row on,
    /// if that's past where it is and every row in view is loaded. Never
    /// up, never during a vertical drag, and not a scroll: the direction
    /// stays and no settle timer starts. Returns whether it moved, for the
    /// caller to plan the new view's reads.
    pub(super) fn pin_to_tail(&mut self, cx: &mut Context<Self>) -> bool {
        if !self.is_following() || matches!(self.drag, Some(Drag::Vertical { .. })) {
            return false;
        }
        #[cfg(test)]
        let to_rows = self.follow_control == Control::PinToRows;
        #[cfg(not(test))]
        let to_rows = false;
        let top = if to_rows {
            self.scroll.max_top()
        } else {
            let visible = self.scroll.visible();
            let end = self.cache.loaded_through(visible.start);
            if end < visible.end {
                return false;
            }
            end as f64 - self.scroll.viewport_rows()
        };
        if top <= self.scroll.top() || !self.scroll.set_top(top) {
            return false;
        }
        // The cells moved under the pointer.
        self.hover = None;
        cx.notify();
        true
    }

    /// A page landed: the pin moves on to its rows and, if it moved, returns
    /// the new view's wanted pages for the caller's plan.
    pub(super) fn pin_and_want(&mut self, cx: &mut Context<Self>) -> Option<Vec<u64>> {
        self.pin_to_tail(cx).then(|| self.wanted())
    }

    /// The visible pages bottom first while following: the newest rows are
    /// the ones being watched. `wanted` begins with the `visible` pages.
    pub(super) fn tail_first(&self, wanted: &mut [u64], visible: usize) {
        #[cfg(test)]
        if self.follow_control == Control::TopFirst {
            return;
        }
        if self.is_following() {
            wanted[..visible].sort_unstable_by(|a, b| b.cmp(a));
        }
    }

    /// In render, for a frame with every visible row loaded: while
    /// following, a drawn tail that grew emits [`TallTableEvent::TailDrawn`]
    /// at its new end.
    pub(super) fn note_tail_drawn(&mut self, end: u64, cx: &mut Context<Self>) {
        if self.is_following() && end > self.tail_drawn {
            self.tail_drawn = end;
            cx.emit(TallTableEvent::TailDrawn { rows: end });
        }
    }
}
