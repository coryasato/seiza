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
pub(crate) const ELLIPSIS: &str = "…";

/// One loaded cell's text, in its region's coordinates.
pub(crate) struct CellText {
    /// The cell's left edge in its region, and its top: unsnapped, as the
    /// `div`'s `left` and `top` were.
    pub(crate) left: f32,
    pub(crate) top: f32,
    pub(crate) width: f32,
    /// Right-aligned (the numeric kinds).
    pub(crate) right: bool,
    /// Cut in the middle (integers and decimals), else at the end.
    pub(crate) middle: bool,
    pub(crate) text: SharedString,
    pub(crate) color: Hsla,
    /// Drawn uncut (`format`: a formatted text that fits by its advances).
    #[cfg(feature = "format")]
    pub(crate) whole: bool,
    /// A match of the find's term, or its current match (`find`).
    #[cfg(feature = "find")]
    pub(crate) mark: crate::find::Mark,
    /// The cue on this cell (`popover`): its mark in place of the text's
    /// "…", or the text cut short of it ([`crate::popover::CueInCell`]).
    #[cfg(feature = "popover")]
    pub(crate) cue: Option<crate::popover::CueInCell>,
    #[cfg(test)]
    pub(crate) row: u64,
    /// Its column's index (with `reorder`, not its place).
    #[cfg(test)]
    pub(crate) column: usize,
}

/// What the element drew for a cell (tests only): its text after the cut,
/// the first glyph's origin and the baseline, its color, and its clip.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DrawnText {
    pub(crate) row: u64,
    /// Its column's index (with `reorder`, not its place).
    pub(crate) column: usize,
    pub(crate) text: String,
    pub(crate) x: f32,
    pub(crate) baseline: f32,
    pub(crate) color: Hsla,
    pub(crate) cell: Bounds<Pixels>,
    /// The part of `cell` its region shows: the cell cut by the clip it
    /// was painted under (with `pin`, the run's edge).
    pub(crate) visible: Bounds<Pixels>,
    /// The cue's mark it painted (`popover`), in window pixels.
    #[cfg(feature = "popover")]
    pub(crate) mark: Option<Bounds<Pixels>>,
    /// What the find tinted (`find`): each tint's bounds and color, in
    /// window pixels, and the current match's edge.
    #[cfg(feature = "find")]
    pub(crate) tints: Vec<(Bounds<Pixels>, Hsla)>,
    #[cfg(feature = "find")]
    pub(crate) edge: Option<Hsla>,
}

/// The find's colors and term, for the cells it marks (`find`): every
/// match's ranges in the theme's `selection` at saturation 0.1 (gpui-kit's
/// editor search's), the current match's in `selection` and edged in
/// `ring`.
#[cfg(feature = "find")]
#[derive(Clone)]
pub(crate) struct FindPaint {
    /// The term, folded a character at a time (`find::folded_term`).
    pub(crate) folded: std::rc::Rc<str>,
    pub(crate) matched: Hsla,
    pub(crate) current: Hsla,
    pub(crate) ring: Hsla,
}

#[cfg(feature = "find")]
impl FindPaint {
    pub(crate) fn new(folded: std::rc::Rc<str>, selection: Hsla, ring: Hsla) -> Self {
        Self {
            folded,
            matched: Hsla {
                s: 0.1,
                ..selection
            },
            current: selection,
            ring,
        }
    }
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
    #[cfg(feature = "find")] find: Option<FindPaint>,
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
                    #[cfg(feature = "find")]
                    find.as_ref(),
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

// With `find`'s paint and the tests' record, eight.
#[cfg_attr(all(test, feature = "find"), expect(clippy::too_many_arguments))]
fn paint(
    cells: &[CellText],
    bounds: Bounds<Pixels>,
    row: Pixels,
    pad: AbsoluteLength,
    #[cfg(feature = "find")] find: Option<&FindPaint>,
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
            // The cue on the cell (`popover`): a text cut at its end keeps
            // its cut, its "…" given to the mark; any other is cut and
            // aligned short of the cue's room.
            #[cfg(feature = "popover")]
            let (text_width, prefix) = match &cell.cue {
                Some(cue) => {
                    #[cfg(feature = "format")]
                    let whole = cell.whole;
                    #[cfg(not(feature = "format"))]
                    let whole = false;
                    cue_cut(
                        cell,
                        cue,
                        whole,
                        &mut line,
                        &run,
                        content,
                        text_width,
                        scale,
                        &mut wrapper,
                        font_size,
                        window,
                    )
                }
                None => (text_width, None),
            };
            let origin_x = if cell.right {
                text_x + text_width - line.width
            } else {
                text_x
            };
            let origin = point(origin_x, clip.origin.y);
            // The mark: where the "…" was, else at the cell's right end; the
            // text drawn the cut's, less its "…" (`popover`).
            #[cfg(feature = "popover")]
            let mark = cell.cue.as_ref().and_then(|cue| {
                let look = cue.mark.clone()?;
                let bounds = match &prefix {
                    Some(prefix) => {
                        let room = f32::from(line.width - prefix.width);
                        let center = point(
                            origin.x + prefix.width + px(room / 2.0),
                            clip.origin.y + clip.size.height / 2.0,
                        );
                        crate::popover::square(center, room.round().max(6.0))
                    }
                    None => crate::popover::square(
                        point(
                            clip.origin.x + clip.size.width
                                - px(cue.offset + crate::popover::CUE_INSET + cue.side / 2.0),
                            clip.origin.y + clip.size.height / 2.0,
                        ),
                        crate::popover::cue_mark(cue.side),
                    ),
                };
                Some((look, bounds))
            });
            #[cfg(feature = "popover")]
            let line = prefix.unwrap_or(line);
            let padding_top = (line_height - line.ascent - line.descent) / 2.;
            let baseline_offset = point(px(0.), padding_top + line.ascent);
            // The find's tints, from the shaped line's offsets in the text
            // drawn (after the cut), and its current match's edge (`find`).
            #[cfg(feature = "find")]
            let (tints, edge) = find_quads(cell, &line, origin.x, clip, find);
            #[cfg(test)]
            drawn.borrow_mut().push(DrawnText {
                row: cell.row,
                column: cell.column,
                text: line.text.to_string(),
                x: f32::from(origin.x),
                baseline: f32::from(origin.y + baseline_offset.y),
                color: cell.color,
                cell: clip,
                visible: clip.intersect(&window.content_mask().bounds),
                #[cfg(feature = "popover")]
                mark: mark.as_ref().map(|(_, bounds)| *bounds),
                #[cfg(feature = "find")]
                tints: tints
                    .iter()
                    .map(|(bounds, color)| (*bounds, *color))
                    .collect(),
                #[cfg(feature = "find")]
                edge: edge
                    .as_ref()
                    .map(|_| find.map_or(gpui_kit::transparent_black(), |find| find.ring)),
            });
            window.with_content_mask(Some(ContentMask { bounds: clip }), |window| {
                let mask = window.content_mask().bounds;
                // Over the cell's paint and the selection, under its text.
                #[cfg(feature = "find")]
                for (bounds, color) in tints {
                    window.paint_quad(fill(bounds, color));
                }
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
                // The cue's mark, over the text's end (`popover`).
                #[cfg(feature = "popover")]
                if let Some((look, bounds)) = &mark {
                    crate::popover::paint_mark(look, *bounds, window, cx);
                }
                // Over the text (`find`).
                #[cfg(feature = "find")]
                if let Some(edge) = edge {
                    window.paint_quad(edge);
                }
            });
        }
    });
}

/// A marked cell's tints and edge (`find`), in window pixels: its drawn
/// text's ranges of the term (or its box, where the text doesn't show it)
/// in the match's color or the current match's, and the current match's
/// edge; none for a cell not marked.
#[cfg(feature = "find")]
fn find_quads(
    cell: &CellText,
    line: &ShapedLine,
    origin_x: Pixels,
    clip: Bounds<Pixels>,
    find: Option<&FindPaint>,
) -> (Vec<(Bounds<Pixels>, Hsla)>, Option<PaintQuad>) {
    use crate::find::{Found, Mark, found};
    let Some(find) = find else {
        return (Vec::new(), None);
    };
    let current = cell.mark == Mark::Current;
    let color = if current { find.current } else { find.matched };
    let tints = match found(cell.mark, &line.text, &find.folded) {
        None => Vec::new(),
        Some(Found::Cell) => vec![(clip, color)],
        Some(Found::Ranges(ranges)) => ranges
            .into_iter()
            .map(|range| {
                let left = origin_x + line.x_for_index(range.start);
                let right = origin_x + line.x_for_index(range.end);
                (
                    Bounds::new(
                        point(left, clip.origin.y),
                        size(right - left, clip.size.height),
                    ),
                    color,
                )
            })
            .collect(),
    };
    let edge = current.then(|| {
        fill(clip, gpui_kit::transparent_black())
            .border_widths(px(2.))
            .border_color(find.ring)
    });
    (tints, edge)
}

/// The text `paint` draws for `text` in a cell `width` wide (after the
/// cut), shaped in `font` at `font_size`: a probe's, where the drawn
/// ranges are read (`find`). Its cut is `paint`'s, its lengths snapped as
/// `paint` snaps them.
#[cfg(feature = "find")]
#[expect(clippy::too_many_arguments)]
pub(crate) fn drawn_text(
    text: &SharedString,
    width: f32,
    middle: bool,
    #[cfg(feature = "format")] whole: bool,
    pad: AbsoluteLength,
    #[cfg(feature = "popover")] cue: Option<&crate::popover::CueInCell>,
    font: &Font,
    font_size: Pixels,
    window: &Window,
    cx: &App,
) -> SharedString {
    let scale = window.scale_factor();
    let snap = |value: f32| round_half_toward_zero(value * scale);
    let pad = snap(f32::from(pad.to_pixels(window.rem_size())));
    let content = (snap(width) - 2.0 * pad).max(0.0);
    let text_width = px(content / scale);
    // As `paint` cuts for the cue (`popover`): its "…" given up, or the
    // text cut short of its room.
    #[cfg(feature = "popover")]
    let text_width = match cue {
        Some(cue) => {
            let cut = drawn_text(
                text,
                width,
                middle,
                #[cfg(feature = "format")]
                whole,
                // The padding as given: `pad` is snapped to device pixels
                // here, and snaps to the same again.
                AbsoluteLength::Pixels(px(pad / scale)),
                None,
                font,
                font_size,
                window,
                cx,
            );
            if cue.mark.is_some()
                && cue.offset < 0.5
                && !middle
                && cut != *text
                && cut.ends_with(ELLIPSIS)
            {
                return cut[..cut.len() - ELLIPSIS.len()].to_string().into();
            }
            px((content - snap(cue.room)).max(0.0) / scale)
        }
        None => text_width,
    };
    let run = TextRun {
        len: text.len(),
        font: font.clone(),
        color: gpui_kit::black(),
        background_color: None,
        underline: None,
        strikethrough: None,
    };
    let line =
        window
            .text_system()
            .shape_line(text.clone(), font_size, std::slice::from_ref(&run), None);
    #[cfg(feature = "format")]
    let fits = whole || line.width <= text_width;
    #[cfg(not(feature = "format"))]
    let fits = line.width <= text_width;
    if fits {
        return text.clone();
    }
    let from = if middle {
        TruncateFrom::Middle
    } else {
        TruncateFrom::End
    };
    cx.text_system()
        .line_wrapper(font.clone(), font_size)
        .truncate_line(
            text.clone(),
            text_width,
            ELLIPSIS,
            std::slice::from_ref(&run),
            from,
        )
        .0
}

/// The cue's cut on its cell (`popover`): a text `paint` cut at its end
/// keeps its cut, its "…" given to the mark (the text before it returned,
/// shaped); else the text cut and aligned short of the cue's room, the
/// width it was cut to returned.
#[cfg(feature = "popover")]
#[expect(clippy::too_many_arguments)]
fn cue_cut(
    cell: &CellText,
    cue: &crate::popover::CueInCell,
    whole: bool,
    line: &mut ShapedLine,
    run: &TextRun,
    content: f32,
    text_width: Pixels,
    scale: f32,
    wrapper: &mut LineWrapperHandle,
    font_size: Pixels,
    window: &mut Window,
) -> (Pixels, Option<ShapedLine>) {
    // Its "…" in view: not on a cell cut by the view's right edge.
    if cue.mark.is_some()
        && cue.offset < 0.5
        && !cell.middle
        && line.text != cell.text
        && line.text.ends_with(ELLIPSIS)
    {
        let prefix: SharedString = line.text[..line.text.len() - ELLIPSIS.len()]
            .to_string()
            .into();
        let runs = [TextRun {
            len: prefix.len(),
            ..run.clone()
        }];
        let prefix = window
            .text_system()
            .shape_line(prefix, font_size, &runs, None);
        return (text_width, Some(prefix));
    }
    let short = px((content - round_half_toward_zero(cue.room * scale)).max(0.0) / scale);
    *line = window.text_system().shape_line(
        cell.text.clone(),
        font_size,
        std::slice::from_ref(run),
        None,
    );
    if !whole && line.width > short {
        let from = if cell.middle {
            TruncateFrom::Middle
        } else {
            TruncateFrom::End
        };
        let (text, runs) = wrapper.truncate_line(
            cell.text.clone(),
            short,
            ELLIPSIS,
            std::slice::from_ref(run),
            from,
        );
        *line = window
            .text_system()
            .shape_line(text, font_size, &runs, None);
    }
    (short, None)
}
