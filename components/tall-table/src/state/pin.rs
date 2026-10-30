//! `pin`: the first columns fixed at the cells' left. The host's count and
//! the run in effect ([`crate::pin`] is the geometry), computed wherever the
//! columns or the view's width change and held through a `resize` drag; the
//! two regions the header and body split into at the run's edge, and the
//! edge's line (`docs/DECISIONS.md`, "Features").

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::*;

use super::{TallTableEvent, TallTableState};
use crate::delegate::TallTableDelegate;
use crate::pin::{self, Pin};

/// Each quad `custom-cells` painted, by region (tests only).
#[cfg(all(test, feature = "custom-cells"))]
pub(crate) type Painted = std::rc::Rc<std::cell::RefCell<Vec<(bool, Bounds<Pixels>)>>>;

/// `custom-cells`' canvases: the pinned region's, the scrolled one's, and
/// the unclipped control's.
#[cfg(feature = "custom-cells")]
type Canvases = (Option<Canvas<()>>, Option<Canvas<()>>, Option<Canvas<()>>);

/// The host's count and the run in effect.
#[derive(Debug, Default)]
pub(crate) struct PinState {
    /// As [`TallTableState::set_pinned`] set it.
    count: usize,
    /// The run in effect: the count, clamped and cut at half the view.
    pub(super) in_effect: usize,
    /// The fixture's and the window tests' negative controls.
    #[cfg(test)]
    pub(crate) control: Option<pin::Control>,
    /// Each quad `custom-cells` painted last frame, by region (`true` for
    /// the scrolled one), as the window clipped it.
    #[cfg(all(test, feature = "custom-cells"))]
    pub(crate) painted: Painted,
    /// Each column the body drew last frame, with its left edge on screen
    /// (in the cells area's pixels).
    #[cfg(test)]
    pub(crate) drawn: Vec<(usize, f32)>,
    /// The body's edge line last frame: its left, in the body's pixels.
    #[cfg(test)]
    pub(crate) line: std::cell::Cell<Option<f32>>,
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Pins the first `columns` columns at the left (0: none), kept across
    /// `set_columns` and clamped to the columns there are. Moves no scroll.
    ///
    /// While they'd take more than half the cells' width, fewer pin
    /// ([`TallTableState::pinned_in_effect`]); a wider view pins them again.
    /// [`TallTableEvent::Pinned`] reports the run in effect when it changes.
    pub fn set_pinned(&mut self, columns: usize, cx: &mut Context<Self>) {
        self.pin_state.count = columns;
        self.repin(cx);
        cx.notify();
    }

    /// The count the host set.
    pub fn pinned(&self) -> usize {
        self.pin_state.count
    }

    /// The columns pinned now: the count, clamped to the columns, and cut
    /// to the leading ones whose right edge is within half the cells' width.
    /// None before the first frame gives the view a width.
    pub fn pinned_in_effect(&self) -> usize {
        self.pin_state.in_effect
    }

    /// The columns or the view's width changed: the run in effect computed
    /// again, and reported if it changed. Held through a `resize` drag,
    /// whose release computes it.
    pub(super) fn repin(&mut self, cx: &mut Context<Self>) {
        #[cfg(feature = "resize")]
        if self.resizing.is_some() {
            return;
        }
        let in_effect = pin::in_effect(&self.columns, self.pin_state.count, self.cells_width());
        if in_effect == self.pin_state.in_effect {
            return;
        }
        self.pin_state.in_effect = in_effect;
        // The cells moved under a still pointer, and the layout probe
        // reports the run.
        self.hover = None;
        self.layout_generation += 1;
        cx.emit(TallTableEvent::Pinned(in_effect));
    }

    /// The run in effect as drawn now: its edge from the columns' widths
    /// (a drag's too), clamped to the cells' width.
    pub(super) fn place(&self) -> Pin {
        #[cfg_attr(not(test), expect(unused_mut))]
        let mut pin = Pin::new(&self.columns, self.pin_state.in_effect, self.cells_width());
        #[cfg(test)]
        if let Some(control) = self.pin_state.control {
            pin.control = control;
        }
        pin
    }

    /// A layer over the columns, from the gutter's edge to the vertical
    /// scrollbar, split at the run's edge into two regions, each clipped:
    /// the pinned columns' `pinned` and the scrolled ones' `scrolled`, each
    /// child placed in its region ([`Pin::layer_left`]). With nothing
    /// pinned, the scrolled region alone, as without the feature.
    pub(super) fn split_layer<P: IntoElement, S: IntoElement>(
        &self,
        place: Pin,
        pinned: impl IntoIterator<Item = P>,
        scrolled: impl IntoIterator<Item = S>,
    ) -> Div {
        div()
            .absolute()
            .top_0()
            .bottom_0()
            .left(px(self.gutter_width()))
            .right(Scrollbar::width())
            .overflow_hidden()
            .children(self.regions(place, pinned, scrolled).into_iter().flatten())
    }

    /// The two regions of a layer over the columns, in the layer's
    /// coordinates: the pinned one (to the run's edge) only while a column
    /// is pinned in effect.
    pub(super) fn regions<P: IntoElement, S: IntoElement>(
        &self,
        place: Pin,
        pinned: impl IntoIterator<Item = P>,
        scrolled: impl IntoIterator<Item = S>,
    ) -> [Option<Div>; 2] {
        let region = || div().absolute().top_0().bottom_0().overflow_hidden();
        [
            (place.columns > 0).then(|| region().left_0().w(px(place.edge)).children(pinned)),
            Some(region().left(px(place.edge)).right_0().children(scrolled)),
        ]
    }

    /// `custom-cells`' canvases: the pinned region's `pinned` quads and the
    /// scrolled region's `scrolled`, each in its region's coordinates; the
    /// third, over both regions unclipped at the edge, only for the window
    /// test's control, which draws every quad there.
    #[cfg(feature = "custom-cells")]
    pub(super) fn pinned_quads(
        &self,
        place: Pin,
        pinned: Vec<PaintQuad>,
        #[cfg_attr(not(test), expect(unused_mut))] mut scrolled: Vec<PaintQuad>,
    ) -> Canvases {
        #[cfg(test)]
        if self.pin_state.control == Some(pin::Control::Unclipped) {
            let from = pinned.len();
            let mut quads = pinned;
            for quad in &mut scrolled {
                quad.bounds.origin.x += px(place.edge);
            }
            quads.append(&mut scrolled);
            return (None, None, self.quads_canvas(quads, from));
        }
        #[cfg(not(test))]
        let _ = place;
        (
            self.quads_canvas(pinned, usize::MAX),
            self.quads_canvas(scrolled, 0),
            None,
        )
    }

    /// The run's edge: a 1 px line in `border` at it, through the header
    /// or the body (to the horizontal scrollbar), over both regions, while
    /// a column is pinned in effect.
    pub(super) fn edge_line(&self, place: Pin, body: bool, cx: &App) -> Option<Div> {
        #[cfg(test)]
        if body {
            self.pin_state
                .line
                .set((place.columns > 0).then(|| self.gutter_width() + place.edge - 1.0));
        }
        (place.columns > 0).then(|| {
            let line = div()
                .absolute()
                .top_0()
                .left(px(self.gutter_width() + place.edge - 1.0))
                .w(px(1.))
                .bg(cx.theme().border);
            if body {
                line.bottom(Scrollbar::width())
            } else {
                line.bottom_0()
            }
        })
    }
}
