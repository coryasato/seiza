//! `density`: the host's row height and text size, and the lengths in
//! effect, resolved where the rem size is known (render) and when the host
//! sets them. A new row height fits the viewport's rows again at once,
//! through `set_body`'s step, the top row kept (while following, the
//! tail); a new text reads the font again at the next frame
//! (`docs/DECISIONS.md`, "Features").

use gpui_kit::*;

use super::TallTableState;
use crate::delegate::TallTableDelegate;
use crate::density::{Density, Sizes};

/// The table's density, with the feature.
pub(crate) struct DensityState {
    /// What the host set.
    density: Density,
    /// What's in effect at `rem_size`.
    sizes: Sizes,
    /// The window's rem size at the last render (the web's 16 px before
    /// the first).
    rem_size: Pixels,
}

impl Default for DensityState {
    fn default() -> Self {
        Self {
            density: Density::default(),
            sizes: Sizes::base(),
            rem_size: px(16.),
        }
    }
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// Sets the row height and the text size; the font is read again at the
    /// size and the columns laid out at the next frame. The top row stays
    /// (while following, the tail), as on a resize. The text is at least
    /// 6 px and the row at least the text, where the rem size is known:
    /// [`density`](Self::density) returns what was set, the layout probe's
    /// `row_height` what's drawn.
    pub fn set_density(&mut self, density: Density, cx: &mut Context<Self>) {
        self.density_state.density = density;
        let sizes = Sizes::resolve(density, self.density_state.rem_size);
        self.apply_sizes(sizes, cx);
    }

    /// What the host set ([`set_density`](Self::set_density)).
    pub fn density(&self) -> Density {
        self.density_state.density
    }

    /// The lengths in effect.
    #[inline(always)]
    pub(super) fn sizes(&self) -> Sizes {
        self.density_state.sizes
    }

    /// The lengths at the window's rem size, before a frame is drawn: if it
    /// moved, resolved again and put in effect, so the frame is drawn by
    /// them.
    pub(super) fn density_at(&mut self, rem_size: Pixels, cx: &mut Context<Self>) {
        if rem_size == self.density_state.rem_size {
            return;
        }
        self.density_state.rem_size = rem_size;
        let sizes = Sizes::resolve(self.density_state.density, rem_size);
        self.apply_sizes(sizes, cx);
    }

    /// `sizes` in effect. A new text size leaves the glyphs to be read again
    /// at the next render, which lays the columns out once by the new font
    /// (laid out now, by the old font's advances, they'd be wrong for a
    /// frame, and with `pin` the run could move and move back); any other
    /// change lays them out now. A new row height fits the viewport's rows
    /// at once, the top row kept (while following, the tail).
    fn apply_sizes(&mut self, sizes: Sizes, cx: &mut Context<Self>) {
        let was = self.density_state.sizes;
        if sizes == was {
            return;
        }
        self.density_state.sizes = sizes;
        let rem_size = self.density_state.rem_size;
        if sizes.text(rem_size) != was.text(rem_size) {
            // No font is read at 0 px: render reads it and lays out.
            self.glyphs.font_size = px(0.);
        } else {
            self.lay_out(cx);
        }
        if sizes.row() != was.row() {
            self.fit_viewport(cx);
        }
        cx.notify();
    }
}
