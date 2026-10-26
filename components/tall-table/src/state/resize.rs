//! `resize`: a column's width dragged at its header edge, and fitted to
//! what's drawn by a double-click there. The drag is the table's own,
//! followed by the move and release handlers the body's `canvas` registers
//! every frame, as the scrollbars' are; it holds the sideways scroll still
//! until the release (`docs/DECISIONS.md`, "Features").

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::*;

use super::{TallTableEvent, TallTableState, shown_text};
use crate::column::{CELL_PADDING, digits_width, layout_columns};
use crate::delegate::{CellValue, TallTableDelegate, TallTablePage as _};
use crate::pages::RowState;

/// The band's reach on each side of its 1 px hairline.
const BAND_PADDING: f32 = 4.0;

/// The bands' hover group: each hairline lights up with its own band.
const BAND_GROUP: &str = "tall-table-band";

/// A column drag in progress.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Resizing {
    pub(super) column: usize,
    /// The pointer's x at the press, in window pixels.
    press_x: f32,
    /// The column's width at the press, as drawn.
    width: f32,
    /// Its set width at the press, as the host or a drag left it.
    was: Option<f32>,
}

impl<D: TallTableDelegate> TallTableState<D> {
    /// The width column `column` is drawn at now, or `None` past the last.
    pub fn column_width(&self, column: usize) -> Option<Pixels> {
        self.columns.get(column).map(|column| px(column.width))
    }

    /// Each column's set width, as [`TallTableEvent::ColumnWidthsChanged`]
    /// reports them.
    fn set_widths(&self) -> Vec<Option<Pixels>> {
        self.column_info
            .iter()
            .map(|column| column.set_width())
            .collect()
    }

    /// A press on column `column`'s band at `x` (window pixels): a single
    /// press starts a drag; a double-click's second press fits the column
    /// and starts none, so it can't move the fitted edge back.
    pub(super) fn press_band(
        &mut self,
        column: usize,
        x: Pixels,
        clicks: usize,
        window: &Window,
        cx: &mut Context<Self>,
    ) {
        if clicks >= 2 {
            self.resizing = None;
            self.fit_column(column, window, cx);
            return;
        }
        let (Some(info), Some(laid_out)) = (self.column_info.get(column), self.columns.get(column))
        else {
            return;
        };
        self.resizing = Some(Resizing {
            column,
            press_x: f32::from(x),
            width: laid_out.width,
            was: info.width,
        });
        // No tooltip until the release.
        self.hide_tooltip(cx);
        cx.notify();
    }

    /// The pointer moved to `x` during a column drag: the width at the
    /// press plus the move since, clamped. Back at the press's x, the
    /// column's set width is what it was. A column drawn outside its min or
    /// max (a kind's width, never clamped) holds until the pointer brings
    /// it inside, so it never jumps to the bound it's past.
    pub(super) fn resize_to(&mut self, x: Pixels, cx: &mut Context<Self>) {
        let Some(resizing) = self.resizing else {
            return;
        };
        let Some(info) = self.column_info.get_mut(resizing.column) else {
            return;
        };
        let start = resizing.width;
        let raw = start + f32::from(x) - resizing.press_x;
        let outside = (start < info.min_width && raw < info.min_width)
            || (start > info.max_width && raw > info.max_width);
        let set = if f32::from(x) == resizing.press_x || outside {
            resizing.was
        } else {
            Some(info.clamp_width(raw))
        };
        if set == info.width {
            return;
        }
        info.width = set;
        // Laid out without `lay_out`'s generation bump: the release
        // reports the layout. The scroll holds (`content_width`).
        (self.columns, self.content_width) =
            layout_columns(&self.column_info, self.glyphs.number_px);
        cx.notify();
    }

    /// The button came up: if the column's width changed, the scroll is
    /// clamped to the new content, the layout probe reported once, and the
    /// widths emitted; otherwise nothing moved, and nothing is redone.
    pub(super) fn end_resize(&mut self, cx: &mut Context<Self>) {
        let Some(resizing) = self.resizing.take() else {
            return;
        };
        if self
            .column_info
            .get(resizing.column)
            .is_some_and(|column| column.width != resizing.was)
        {
            self.lay_out();
            cx.emit(TallTableEvent::ColumnWidthsChanged(self.set_widths()));
        }
        cx.notify();
    }

    /// During a drag, the content counts as reaching at least the view's
    /// right edge: every clamp of the sideways scroll holds it, and the
    /// horizontal thumb stays where the view is, until the release.
    pub(super) fn held_content(&self, width: f32) -> f32 {
        if self.resizing.is_some() {
            width.max(self.scroll_x + self.cells_width())
        } else {
            width
        }
    }

    /// Fits column `column` to its header's name and its visible, loaded
    /// rows, clamped: a numeric column to its widest exact text at the
    /// number advance (so a float's budget holds every digit), any other to
    /// its widest shown text, shaped. Emits the widths if they changed.
    fn fit_column(&mut self, column: usize, window: &Window, cx: &mut Context<Self>) {
        let (Some(info), Some(laid_out)) = (self.column_info.get(column), self.columns.get(column))
        else {
            return;
        };
        // No glyph of the cells' font is narrower than 2 px, so a text cut
        // to this many characters still reaches past `max_width`.
        let max_chars = (info.max_width / 2.0).max(1.0) as usize;
        // Cut before it's copied, then one line (`shape_line` asserts it),
        // `¶` for a break, as a cell shows it; a name too.
        let shaped = |value: CellValue<'_>| -> f32 {
            let value = match value {
                CellValue::Text(text) => {
                    CellValue::Text(text.chars().take(max_chars).collect::<String>().into())
                }
                value => value,
            };
            let text = shown_text(laid_out, value);
            (self.text_width(text.into(), window) + CELL_PADDING + 1.0).ceil()
        };
        let mut widest = shaped(CellValue::Text(laid_out.name.as_ref().into()));
        for row in self.scroll.visible() {
            let RowState::Loaded(page, index) = self.cache.row(row) else {
                continue;
            };
            let value = page.value(index, column).unwrap_or(CellValue::Null);
            let width = if laid_out.kind.numeric() && value != CellValue::Null {
                // Rounded up to a whole pixel, so the budget it gives is
                // never a hair short of the count.
                let chars = value.to_string().chars().count() as f32;
                digits_width(chars, self.glyphs.number_px).ceil()
            } else {
                shaped(value)
            };
            widest = widest.max(width);
        }
        let width = info.clamp_width(widest);
        // As drawn and reported: a host's width past the max is the max.
        if info.set_width() == Some(px(width)) {
            return;
        }
        self.column_info[column].width = Some(width);
        self.lay_out();
        cx.emit(TallTableEvent::ColumnWidthsChanged(self.set_widths()));
        cx.notify();
    }

    /// The bands at each visible resizable column's right edge, over the
    /// header's cells: a 1 px hairline with [`BAND_PADDING`] on each side.
    pub(super) fn render_bands(&self, cx: &mut Context<Self>) -> Div {
        let theme = cx.theme();
        let (line, lit) = (theme.table_row_border, theme.border);
        let dragged = self.resizing.map(|resizing| resizing.column);
        let bands: Vec<_> = self
            .visible_columns()
            .filter(|(index, _)| self.column_info[*index].resizable)
            .map(|(index, column)| {
                let edge = column.x + column.width - self.scroll_x;
                div()
                    .id(("tall-table-band", index))
                    .group(BAND_GROUP)
                    .absolute()
                    .top_0()
                    .h_full()
                    .left(px(edge - 1.0 - BAND_PADDING))
                    .w(px(2.0 * BAND_PADDING + 1.0))
                    .occlude()
                    .cursor_col_resize()
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                            cx.stop_propagation();
                            window.focus(&this.focus_handle, cx);
                            this.press_band(index, event.position.x, event.click_count, window, cx);
                        }),
                    )
                    .child(
                        div()
                            .absolute()
                            .top_0()
                            .h_full()
                            .left(px(BAND_PADDING))
                            .w(px(1.))
                            .bg(if dragged == Some(index) { lit } else { line })
                            .group_hover(BAND_GROUP, move |line| line.bg(lit)),
                    )
            })
            .collect();
        div()
            .absolute()
            .top_0()
            .bottom_0()
            .left(px(self.gutter_width()))
            .right(Scrollbar::width())
            .overflow_hidden()
            .children(bands)
    }
}
