//! `popover`'s public types and its pure half: the cell it's open on, the
//! button and the cue a host may style, the text a value shows in it, and
//! its size limits (`docs/DECISIONS.md`, "Features", 2026-11-19 and
//! 2026-11-20, `popover`); and its three settings, each off by default:
//! which cells the table's own openers work on ([`PopoverCells`]), the
//! cue's fade and its open mark, and the button laid out the popover's
//! width (2026-11-21).

use std::rc::Rc;

use gpui_kit::*;

use crate::delegate::CellValue;

/// A cell, by row and column index (`popover`): the column's index in
/// `TallTableState::columns`, not the place it's drawn at, so it names the
/// same column after a move.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PopoverCell {
    /// Its row, 0-based.
    pub row: u64,
    /// Its column's index.
    pub column: usize,
}

impl PopoverCell {
    /// The cell at `row` and column index `column`.
    pub fn new(row: u64, column: usize) -> Self {
        Self { row, column }
    }
}

/// Which cells the table's own openers, the cue and Enter, work on
/// (`popover`). `TallTableState::open_popover` opens any cell under either.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[non_exhaustive]
pub enum PopoverCells {
    /// Enter on any active cell; the cue where the popover shows more than
    /// the cell, or on every loaded cell with a button set.
    #[default]
    Every,
    /// A `ColumnKind::Text` column's cell, not NULL, cut at its end or
    /// holding a line break, a button set or not: no cue on any other, and
    /// Enter there goes on to the host.
    CutText,
}

/// A host's element, built each frame it's drawn.
pub(crate) type Build = Rc<dyn Fn(&mut Window, &mut App) -> AnyElement>;

/// The popover's button (`popover`): the table's look with the host's
/// label, or the host's own element. Either way the table makes it the
/// press target: a press on it, or Enter on the open popover, emits
/// `TallTableEvent::PopoverButton` and closes the popover.
#[derive(Clone)]
pub struct PopoverButton {
    pub(crate) look: ButtonLook,
    /// Laid out the popover's whole width ([`PopoverButton::fill`]).
    pub(crate) fill: bool,
}

#[derive(Clone)]
pub(crate) enum ButtonLook {
    Label(SharedString),
    Custom(Build),
}

impl PopoverButton {
    /// The table's look: gpui-kit's small ghost `Button`, labeled `label`
    /// (the host's words: the table holds no app string).
    pub fn label(label: impl Into<SharedString>) -> Self {
        Self {
            look: ButtonLook::Label(label.into()),
            fill: false,
        }
    }

    /// The host's own element, built each frame the popover draws, at the
    /// popover's foot. The table wraps it in its press target, so the
    /// element needs no handler of its own (one that stops a press keeps
    /// the table from seeing it), and gives it no size: it's laid out as
    /// it asks.
    pub fn custom(build: impl Fn(&mut Window, &mut App) -> AnyElement + 'static) -> Self {
        Self {
            look: ButtonLook::Custom(Rc::new(build)),
            fill: false,
        }
    }

    /// Laid out the popover's whole width, with no padding around it: the
    /// label's button stretched, or the host's element in a block that
    /// wide (a foot the host draws edge to edge). Without it the button is
    /// laid out at its own size, from the left, inside the foot's padding.
    pub fn fill(self) -> Self {
        Self { fill: true, ..self }
    }
}

impl std::fmt::Debug for PopoverButton {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.look {
            ButtonLook::Label(label) => f
                .debug_tuple("PopoverButton::label")
                .field(label)
                .finish()?,
            ButtonLook::Custom(_) => f.write_str("PopoverButton::custom(..)")?,
        }
        if self.fill {
            f.write_str(".fill()")?;
        }
        Ok(())
    }
}

/// The cue (`popover`): a small button inside the right end of the hovered
/// cell, and of `select`'s active cell, whose press opens the popover
/// there, drawn when the popover shows more than the cell or a button is
/// set (or, under [`PopoverCells::CutText`], on a cut text alone); its mark
/// takes the place of the cell's "…" (or, with none to give, the cell's
/// text ends short of it), unless the text fades to it
/// ([`PopoverCue::fade`]). On by default ([`PopoverCue::expand`]); a host
/// opts out with `TallTableState::set_popover_cue(None)`.
#[derive(Clone)]
pub struct PopoverCue {
    pub(crate) look: CueLook,
    /// The cued cell's text fades toward the mark ([`PopoverCue::fade`]).
    pub(crate) fade: bool,
    /// The mark on the open popover's cell ([`PopoverCue::open_icon`]).
    pub(crate) open: Option<OpenIcon>,
}

/// The open popover's cell's mark: its path, and whether it loaded when the
/// cue was set (one that didn't is no open mark).
#[derive(Clone)]
pub(crate) struct OpenIcon {
    pub(crate) path: SharedString,
    pub(crate) loaded: bool,
}

#[derive(Clone)]
pub(crate) enum CueLook {
    Expand,
    Icon(SharedString),
    Custom(Build),
}

impl PopoverCue {
    /// The table's look: an expand mark (four corners pointing out), in the
    /// theme's `muted_foreground`, with no box behind it, drawn by the table
    /// (no font glyph or asset).
    pub fn expand() -> Self {
        Self {
            look: CueLook::Expand,
            fade: false,
            open: None,
        }
    }

    /// An SVG from the host's assets in place of the expand mark, by its
    /// path, as `SortIcons`' are (gpui-kit's `IconName::Maximize`, say),
    /// drawn as the mark is.
    pub fn icon(path: impl Into<SharedString>) -> Self {
        Self {
            look: CueLook::Icon(path.into()),
            fade: false,
            open: None,
        }
    }

    /// The host's own element, built each frame the cue draws, filling the
    /// cue's box (a square the row's height, less an inset, at the cell's
    /// right end), over the cell's text, which ends short of the whole box.
    /// The table
    /// wraps it in its press target; the element needs no handler.
    pub fn custom(build: impl Fn(&mut Window, &mut App) -> AnyElement + 'static) -> Self {
        Self {
            look: CueLook::Custom(Rc::new(build)),
            fade: false,
            open: None,
        }
    }
}

impl PopoverCue {
    /// The cued cell's text drawn without its "…", from its start, washing
    /// out short of the mark at the cell's far right: each glyph's alpha by
    /// its place, whole up to 64 px short of the cell's content box's right
    /// end and clear from 16 px short of it (at the default text size), so
    /// no text moves when the cue shows. On left-aligned text only: a
    /// number, right-aligned, keeps its cut short of the cue. At rest every
    /// cell is drawn as without it.
    pub fn fade(self) -> Self {
        Self { fade: true, ..self }
    }

    /// The mark on the open popover's cell: an SVG from the host's assets,
    /// by its path, drawn in place of the mark in the theme's `foreground`.
    /// The cue then stays on that cell while the popover is open, hovered
    /// or active or not, where the rule in effect gives that cell a cue,
    /// and its press closes the popover. A path that doesn't load is no
    /// open mark: the cue's cells and its mark are as without one. Nothing
    /// on [`PopoverCue::custom`], which draws itself.
    pub fn open_icon(self, path: impl Into<SharedString>) -> Self {
        Self {
            open: Some(OpenIcon {
                path: path.into(),
                loaded: false,
            }),
            ..self
        }
    }
}

/// The table's look.
impl Default for PopoverCue {
    fn default() -> Self {
        Self::expand()
    }
}

impl std::fmt::Debug for PopoverCue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.look {
            CueLook::Expand => f.write_str("PopoverCue::expand()")?,
            CueLook::Icon(path) => f.debug_tuple("PopoverCue::icon").field(path).finish()?,
            CueLook::Custom(_) => f.write_str("PopoverCue::custom(..)")?,
        }
        if self.fade {
            f.write_str(".fade()")?;
        }
        if let Some(open) = &self.open {
            write!(f, ".open_icon({:?})", open.path)?;
        }
        Ok(())
    }
}

/// The cue's inset from its cell's right, top, and bottom edges: the
/// active cell's and `find`'s current match's edges show past it.
pub(crate) const CUE_INSET: f32 = 2.0;

/// The gap between a cued cell's text and its cue's mark.
pub(crate) const CUE_GAP: f32 = 2.0;

/// A faded text is clear from this far short of its content box's right
/// end, at the default text size ([`PopoverCue::fade`]).
pub(crate) const FADE_CLEAR: f32 = 16.0;
/// A faded text's ramp, whole to clear, at the default text size.
pub(crate) const FADE_RAMP: f32 = 48.0;

/// A cued cell's fade ([`PopoverCue::fade`]): where its text starts to
/// wash out and where it's clear, each in px short of the content box's
/// right end.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Fade {
    pub(crate) start: f32,
    pub(crate) clear: f32,
}

impl Fade {
    /// The alpha of a glyph whose middle is `middle` px from the left of a
    /// content box `width` wide: 1 up to the fade's start, 0 from where
    /// it's clear.
    pub(crate) fn alpha(self, middle: f32, width: f32) -> f32 {
        let (start, clear) = (width - self.start, width - self.clear);
        if middle >= clear {
            0.0
        } else if middle <= start {
            1.0
        } else {
            (clear - middle) / (clear - start)
        }
    }
}

/// A faded line: each glyph's alpha, in the line's order (0: not painted),
/// and where its drawn text ends, the byte after the characters of its
/// painted glyph furthest into the text. `line` is the cell's text, uncut,
/// drawn from the left of a content box `width` wide. An emoji has no color
/// to tint: it's whole at half or more, and not painted under it (one
/// skipped before a painted glyph stays inside the drawn text). Glyphs out
/// of byte order (right-to-left text) are painted by their place all the
/// same, and the drawn text then runs to the furthest byte painted, the
/// clear part before it included.
pub(crate) fn faded(line: &ShapedLine, width: Pixels, fade: Fade) -> (Vec<f32>, usize) {
    let glyphs: Vec<&ShapedGlyph> = line.runs.iter().flat_map(|run| &run.glyphs).collect();
    // Where each glyph's characters end: the next index up, in byte order.
    let mut starts: Vec<usize> = glyphs.iter().map(|glyph| glyph.index).collect();
    starts.sort_unstable();
    let cluster_end = |index: usize| {
        let after = starts.partition_point(|start| *start <= index);
        starts.get(after).copied().unwrap_or(line.text.len())
    };
    let width = f32::from(width);
    let mut alphas = Vec::with_capacity(glyphs.len());
    let mut end = 0;
    for (at, glyph) in glyphs.iter().enumerate() {
        let left = f32::from(glyph.position.x);
        let next = glyphs.get(at + 1);
        let right = next.map_or(f32::from(line.width), |next| f32::from(next.position.x));
        let alpha = fade.alpha((left + right) / 2.0, width);
        let alpha = match glyph.is_emoji {
            true if alpha >= 0.5 => 1.0,
            true => 0.0,
            false => alpha,
        };
        if alpha > 0.0 {
            end = end.max(cluster_end(glyph.index));
        }
        alphas.push(alpha);
    }
    (alphas, end.min(line.text.len()))
}

/// The mark's side in a cue `side` wide, at its cell's right end (where
/// the cell's text has no "…" to give it): the table's expand mark, or
/// the host's icon.
pub(crate) fn cue_mark(side: f32) -> f32 {
    (side * 0.55).round()
}

/// The table's expand mark, `side` square around `center`: four corners,
/// each two strokes pointing out (a "maximize" icon's), as quads, so it
/// needs no font glyph (IBM Plex Sans has none) and no asset.
pub(crate) fn expand_mark(center: Point<Pixels>, side: f32) -> [Bounds<Pixels>; 8] {
    let stroke = (side / 10.0).max(1.0);
    let arm = (side * 0.3).round().max(2.0);
    let (left, top) = (center.x - px(side / 2.0), center.y - px(side / 2.0));
    let (right, bottom) = (left + px(side), top + px(side));
    let rect = |x: Pixels, y: Pixels, w: f32, h: f32| Bounds::new(point(x, y), size(px(w), px(h)));
    [
        rect(left, top, arm, stroke),
        rect(left, top, stroke, arm),
        rect(right - px(arm), top, arm, stroke),
        rect(right - px(stroke), top, stroke, arm),
        rect(left, bottom - px(stroke), arm, stroke),
        rect(left, bottom - px(arm), stroke, arm),
        rect(right - px(arm), bottom - px(stroke), arm, stroke),
        rect(right - px(stroke), bottom - px(arm), stroke, arm),
    ]
}

/// A square `side` wide around `center`.
pub(crate) fn square(center: Point<Pixels>, side: f32) -> Bounds<Pixels> {
    Bounds::new(
        point(center.x - px(side / 2.0), center.y - px(side / 2.0)),
        size(px(side), px(side)),
    )
}

/// Paints `look` in `bounds`: the expand mark's quads, or the host's SVG.
pub(crate) fn paint_mark(look: &CueMark, bounds: Bounds<Pixels>, window: &mut Window, cx: &App) {
    match look {
        CueMark::Expand(color) => {
            for corner in expand_mark(bounds.center(), f32::from(bounds.size.width)) {
                window.paint_quad(fill(corner, *color));
            }
        }
        CueMark::Icon(path, color) => {
            let _ = window.paint_svg(
                bounds,
                path.clone(),
                None,
                TransformationMatrix::unit(),
                *color,
                cx,
            );
        }
    }
}

/// What a cell's text element draws of the cue on that cell (`popover`):
/// its mark where the text's "…" was, the text left as it was cut; or, the
/// text ending in no "…" (rounded, cut in the middle, fitting), the text
/// cut and aligned short of `room` and the mark at the cell's right end.
#[derive(Clone)]
pub(crate) struct CueInCell {
    /// Kept free past the padding where the text has no "…" to give, in px.
    pub(crate) room: f32,
    /// The cue's box: a square this wide at the cell's right end.
    pub(crate) side: f32,
    /// How far the box sits left of the cell's whole right end, in px: 0
    /// but on a cell cut by the view's right edge, whose cue is at its
    /// visible end (and whose "…", off view, isn't given to the mark).
    pub(crate) offset: f32,
    /// The mark the text element paints; `None` for the host's element,
    /// which draws itself (always `room`'s way).
    pub(crate) mark: Option<CueMark>,
    /// The cell's text fades toward the mark, uncut and unmoved
    /// ([`PopoverCue::fade`]): left-aligned text only.
    pub(crate) fade: Option<Fade>,
}

/// The mark a cell's text element paints (`popover`).
#[derive(Clone)]
pub(crate) enum CueMark {
    /// The table's expand mark, in this color.
    Expand(Hsla),
    /// The host's SVG, by its path, in this color.
    Icon(SharedString, Hsla),
}

/// The popover's text is at most this many characters, then "…": a frame
/// lays all of it out while it's open, and at 100,000 one took past a
/// 60 Hz frame (`docs/DECISIONS.md`, "Features", the popover's cap).
pub(crate) const POPOVER_CHARS: usize = 10_000;

/// The popover is at most this wide, or its cell's width if wider, and
/// [`MAX_WIDTH_SHARE`] of the window (EuiDataGrid's).
pub(crate) const MIN_MAX_WIDTH: f32 = 400.0;
/// The share of the window's width the popover may take.
pub(crate) const MAX_WIDTH_SHARE: f32 = 0.75;
/// The share of the window's height the popover may take, its text
/// scrolled inside past it.
pub(crate) const MAX_HEIGHT_SHARE: f32 = 0.5;
/// The space kept between the popover and the window's edges (gpui-base's
/// `Popup`'s).
pub(crate) const MARGIN: f32 = 8.0;

/// What the popover shows of a value.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PopoverText {
    /// The value's exact text, its line breaks as lines, cut at the cap;
    /// `NULL` for a NULL.
    pub(crate) text: SharedString,
    /// Its characters, the "…" of a cut among them.
    pub(crate) chars: usize,
    /// Cut at the cap.
    pub(crate) cut: bool,
    /// A NULL: drawn muted, as the cell draws it.
    pub(crate) null: bool,
}

/// The popover's text for `value`: its exact text (`copy`'s and the
/// tooltip's, never a format's), each line break (`\r\n`, `\n`, `\r`) a
/// line, cut past `cap` characters with "…"; a NULL is `NULL`.
pub(crate) fn popover_text(value: &CellValue<'_>, cap: usize) -> PopoverText {
    if *value == CellValue::Null {
        return PopoverText {
            text: "NULL".into(),
            chars: 4,
            cut: false,
            null: true,
        };
    }
    let exact = value.to_string();
    let lines = if exact.contains('\r') {
        exact.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        exact
    };
    let (text, chars, cut) = match lines.char_indices().nth(cap) {
        Some((end, _)) => (format!("{}…", &lines[..end]), cap + 1, true),
        None => {
            let chars = lines.chars().count();
            (lines, chars, false)
        }
    };
    PopoverText {
        text: text.into(),
        chars,
        cut,
        null: false,
    }
}

/// The popover's widest: `max(cell, 400 px)`, at most 75% of the window.
pub(crate) fn max_width(cell: f32, window: f32) -> f32 {
    cell.max(MIN_MAX_WIDTH).min(window * MAX_WIDTH_SHARE)
}

/// The popover's tallest: half the window.
pub(crate) fn max_height(window: f32) -> f32 {
    window * MAX_HEIGHT_SHARE
}

#[cfg(test)]
mod tests {
    use super::{CellValue, Fade, max_width, popover_text};

    #[test]
    fn a_fade_is_whole_then_falls_to_clear() {
        let fade = Fade {
            start: 64.0,
            clear: 16.0,
        };
        assert_eq!(fade.alpha(0.0, 184.0), 1.0);
        assert_eq!(fade.alpha(120.0, 184.0), 1.0);
        assert_eq!(fade.alpha(144.0, 184.0), 0.5);
        assert_eq!(fade.alpha(168.0, 184.0), 0.0);
        assert_eq!(fade.alpha(180.0, 184.0), 0.0);
    }

    #[test]
    fn text_is_the_exact_text_with_its_lines() {
        let text = |value: CellValue<'_>| popover_text(&value, 100);
        assert_eq!(
            text(CellValue::Text("a\r\nb\rc\nd".into())).text,
            "a\nb\nc\nd"
        );
        assert_eq!(
            text(CellValue::Float(0.1 + 0.2)).text,
            "0.30000000000000004"
        );
        let null = text(CellValue::Null);
        assert!(null.null);
        assert_eq!(null.text, "NULL");
    }

    #[test]
    fn text_past_the_cap_is_cut() {
        let cut = popover_text(&CellValue::Text("ééééé".into()), 3);
        assert_eq!((cut.text.as_ref(), cut.chars, cut.cut), ("ééé…", 4, true));
        let whole = popover_text(&CellValue::Text("ééé".into()), 3);
        assert_eq!(
            (whole.text.as_ref(), whole.chars, whole.cut),
            ("ééé", 3, false)
        );
    }

    #[test]
    fn width_is_capped() {
        assert_eq!(max_width(120.0, 1440.0), 400.0);
        assert_eq!(max_width(600.0, 1440.0), 600.0);
        assert_eq!(max_width(600.0, 500.0), 375.0);
    }
}
