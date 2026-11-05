//! The loaded cells' text, drawn by one element a region: every glyph
//! painted inside one layer, where a `div` a cell was laid out, prepainted,
//! and painted in a layer of its own each frame (`docs/DECISIONS.md`,
//! "Features", 2026-11-04). Pixel for pixel what the `div`s drew: each
//! cell's box snapped as GPUI's layout snapped theirs, its text cut by
//! GPUI's own `truncate_line`, aligned, centered in the row, and its glyphs
//! placed as `paint_line` places them.

use gpui_kit::*;

/// How a cell's text is cut when it doesn't fit: "…" at the end (text and
/// floats, the `div`s' `truncate`) or in the middle (integers and decimals,
/// their `text_ellipsis_middle`).
const ELLIPSIS: &str = "…";

/// One loaded cell's text, in its region's coordinates.
pub(crate) struct CellText {
    /// The cell's left edge in its region, and its top: unsnapped, as the
    /// `div`'s `left` and `top` were.
    pub left: f32,
    pub top: f32,
    pub width: f32,
    /// Right-aligned (the numeric kinds).
    pub right: bool,
    /// Cut in the middle (integers and decimals), else at the end.
    pub middle: bool,
    pub text: SharedString,
    pub color: Hsla,
    /// Drawn uncut (`format`: a formatted text that fits by its advances).
    #[cfg(feature = "format")]
    pub whole: bool,
    #[cfg(test)]
    pub row: u64,
    #[cfg(test)]
    pub column: usize,
}

/// What the element drew for a cell (tests only): its text after the cut,
/// the first glyph's origin and the baseline, its color, and its clip.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DrawnText {
    pub row: u64,
    pub column: usize,
    pub text: String,
    pub x: f32,
    pub baseline: f32,
    pub color: Hsla,
    pub cell: Bounds<Pixels>,
}

#[cfg(test)]
pub(crate) type DrawnTexts = std::rc::Rc<std::cell::RefCell<Vec<DrawnText>>>;

/// GPUI's device-pixel rounding (gpui-pre's `round_half_toward_zero`,
/// crate-private): midpoints toward zero.
#[inline(always)]
fn round_half_toward_zero(value: f32) -> f32 {
    (value.abs() - 0.5).ceil().copysign(value)
}

/// The element: one `canvas` over its region, painting `cells`' text at
/// `row` high rows with `pad` on each side, in the inherited text style
/// (the cells' font and size, as the `div`s inherited it); none for none.
pub(crate) fn cells_text(
    cells: Vec<CellText>,
    row: Pixels,
    pad: AbsoluteLength,
    #[cfg(test)] drawn: DrawnTexts,
) -> Option<Canvas<()>> {
    (!cells.is_empty()).then(|| {
        canvas(
            |_, _, _| {},
            move |bounds, _, window, cx| {
                paint(
                    &cells,
                    bounds,
                    row,
                    pad,
                    window,
                    cx,
                    #[cfg(test)]
                    &drawn,
                );
            },
        )
        .absolute()
        .size_full()
    })
}

fn paint(
    cells: &[CellText],
    bounds: Bounds<Pixels>,
    row: Pixels,
    pad: AbsoluteLength,
    window: &mut Window,
    cx: &mut App,
    #[cfg(test)] drawn: &DrawnTexts,
) {
    let scale = window.scale_factor();
    let rem = window.rem_size();
    let style = window.text_style();
    let font = style.font();
    let font_size = style.font_size.to_pixels(rem);
    // The `div`s' `line_height(row)`, as the text element snaps it.
    let line_height = window.pixel_snap(row);
    // Lengths as taffy took them: each rounded to device pixels before
    // layout (`to_taffy`). The region's origin is on a device pixel (every
    // length above it is), so each cell's box, its origin plus those, needs
    // no rounding after layout.
    let snap = |value: f32| round_half_toward_zero(value * scale);
    let pad = snap(f32::from(pad.to_pixels(rem)));
    let height = snap(f32::from(row));
    let (origin_x, origin_y) = (
        f32::from(bounds.origin.x) * scale,
        f32::from(bounds.origin.y) * scale,
    );
    let text_system = cx.text_system().clone();
    let mut wrapper = text_system.line_wrapper(font.clone(), font_size);
    window.paint_layer(bounds, |window| {
        for cell in cells {
            let (left, top, width) = (snap(cell.left), snap(cell.top), snap(cell.width));
            let clip = Bounds::new(
                point(px((origin_x + left) / scale), px((origin_y + top) / scale)),
                size(px(width / scale), px(height / scale)),
            );
            // The text's box: the cell's content box (the padding is the
            // `div`'s, horizontal only).
            let content = (width - 2.0 * pad).max(0.0);
            let text_x = px((origin_x + left + pad) / scale);
            let text_width = px(content / scale);
            let run = TextRun {
                len: cell.text.len(),
                font: font.clone(),
                color: cell.color,
                background_color: None,
                underline: None,
                strikethrough: None,
            };
            // As the text element cuts: only when the shaped text is wider
            // than the content box. Its width here is taffy's to the bit:
            // the cell's width and padding are whole device pixels, exact
            // in an f32, so `width - 2 × pad` and taffy's border box less
            // each side's padding are the same number, divided by the same
            // scale.
            let mut line = window.text_system().shape_line(
                cell.text.clone(),
                font_size,
                std::slice::from_ref(&run),
                None,
            );
            // The cut, written once for both conditions below: a macro, so
            // the base compiles its own `if` as it was (a `let` between them
            // moved its wasm by bytes).
            macro_rules! cut {
                () => {{
                    let from = if cell.middle {
                        TruncateFrom::Middle
                    } else {
                        TruncateFrom::End
                    };
                    let (text, runs) = wrapper.truncate_line(
                        cell.text.clone(),
                        text_width,
                        ELLIPSIS,
                        std::slice::from_ref(&run),
                        from,
                    );
                    line = window
                        .text_system()
                        .shape_line(text, font_size, &runs, None);
                }};
            }
            #[cfg(not(feature = "format"))]
            if line.width > text_width {
                cut!();
            }
            // A formatted text that fits is drawn whole (`format`): its fit
            // is its advances' sum, which the shaping matches within the
            // rule's pixel.
            #[cfg(feature = "format")]
            if !cell.whole && line.width > text_width {
                cut!();
            }
            let origin_x = if cell.right {
                text_x + text_width - line.width
            } else {
                text_x
            };
            let origin = point(origin_x, clip.origin.y);
            let padding_top = (line_height - line.ascent - line.descent) / 2.;
            let baseline_offset = point(px(0.), padding_top + line.ascent);
            #[cfg(test)]
            drawn.borrow_mut().push(DrawnText {
                row: cell.row,
                column: cell.column,
                text: line.text.to_string(),
                x: f32::from(origin.x),
                baseline: f32::from(origin.y + baseline_offset.y),
                color: cell.color,
                cell: clip,
            });
            window.with_content_mask(Some(ContentMask { bounds: clip }), |window| {
                let mask = window.content_mask().bounds;
                // `paint_line`'s walk: the glyph's x summed from the gaps
                // between positions, so its floats are the same.
                let mut glyph_origin = origin;
                let mut previous = Point::<Pixels>::default();
                for glyph_run in &line.runs {
                    let glyph_size = text_system.bounding_box(glyph_run.font_id, font_size).size;
                    for glyph in &glyph_run.glyphs {
                        glyph_origin.x += glyph.position.x - previous.x;
                        previous = glyph.position;
                        if !(Bounds {
                            origin: glyph_origin,
                            size: glyph_size,
                        })
                        .intersects(&mask)
                        {
                            continue;
                        }
                        let at = glyph_origin + baseline_offset + point(px(0.), glyph.position.y);
                        let _ = if glyph.is_emoji {
                            window.paint_emoji(at, glyph_run.font_id, glyph.id, font_size)
                        } else {
                            window.paint_glyph(
                                at,
                                glyph_run.font_id,
                                glyph.id,
                                font_size,
                                cell.color,
                            )
                        };
                    }
                }
            });
        }
    });
}
