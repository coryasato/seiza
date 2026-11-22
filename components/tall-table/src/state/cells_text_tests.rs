//! The cells' text element (`cells_text.rs`), drawn in a window of GPUI's
//! test app (scale 2) over rows answered from memory, read back through
//! what it recorded painting each cell (`DrawnText`): every loaded cell in
//! view drawn once, its text cut at the end (text) or in the middle (an
//! integer) only where it doesn't fit, its box snapped to device pixels at
//! a fractional scroll and row top, its text at the padding (right-aligned
//! for numbers), on one baseline a row, in its color (NULL's muted); with
//! `pin`, the pinned column held under a sideways scroll; with `density`,
//! at a smaller text and padding. The test app gives every character
//! 0.6 em.

use std::ops::Range;

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{
    App, AppContext as _, Bounds, Hsla, Pixels, TestAppContext, VisualTestContext, px, size,
};

use super::{Paging, TallTableState};
use crate::cells_text::DrawnText;
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};

/// A long text (cut at the end), an integer wider than its column (cut in
/// the middle), a float, and a NULL.
fn columns() -> Vec<TallTableColumn> {
    vec![
        TallTableColumn::new("t", ColumnKind::Text),
        TallTableColumn::new("n", ColumnKind::Integer { max_chars: 6 }),
        TallTableColumn::new("f", ColumnKind::Float),
        TallTableColumn::new("u", ColumnKind::Text),
    ]
}

fn value(row: u64, column: usize) -> CellValue<'static> {
    if row >= LONG_ROWS {
        return long_value(row - LONG_ROWS, column);
    }
    match column {
        // Short on even rows, cut on odd ones.
        0 if row.is_multiple_of(2) => CellValue::Text(format!("r{row}").into()),
        0 => CellValue::Text(format!("{row} {}", "long text ".repeat(8)).into()),
        1 => CellValue::Text((20_000_000 + row).to_string().into()),
        2 => CellValue::Float(row as f64 + 0.5),
        _ => CellValue::Null,
    }
}

/// The first of the rows with long texts (`long_value`), far from the
/// rows the other tests draw.
const LONG_ROWS: u64 = 9_000;

thread_local! {
    /// The characters a long text is bounded to in the first column, set by
    /// the test once the table is laid out.
    static BOUND: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// `pattern` repeated to `chars` characters.
fn repeated(pattern: &str, chars: usize) -> CellValue<'static> {
    CellValue::Text(
        pattern
            .chars()
            .cycle()
            .take(chars)
            .collect::<String>()
            .into(),
    )
}

/// Row `LONG_ROWS + row`'s values: in the first column, texts around the
/// bound (a character under it, at it, and over it), far past it (with
/// spaces and punctuation at the cut, with line breaks, and in characters
/// of more than a byte), and one of more bytes than the bound but no more
/// characters; in the second (cut in the middle), a number far past it.
fn long_value(row: u64, column: usize) -> CellValue<'static> {
    let bound = BOUND.get();
    match (column, row) {
        (0, 0) => repeated("ab, cd. ", bound.saturating_sub(1)),
        (0, 1) => repeated("ab, cd. ", bound),
        (0, 2) => repeated("ab, cd. ", bound + 1),
        (0, 3) => repeated("ab, cd. ", 10_000),
        (0, 4) => repeated("ab\r\ncd\nef\r", 10_000),
        (0, 5) => repeated("é¶ü… ", 10_000),
        (0, 6) => repeated("é", bound),
        (0, _) => CellValue::Text(format!("r{row}").into()),
        (1, 3) => repeated("1234567890", 10_000),
        (1, _) => CellValue::Text((20_000_000 + row).to_string().into()),
        (2, _) => CellValue::Float(row as f64 + 0.5),
        _ => CellValue::Null,
    }
}

struct Rows(Range<u64>);

impl TallTablePage for Rows {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        Some(value(self.0.start + row as u64, column))
    }

    fn heap_bytes(&self) -> usize {
        1024
    }

    #[cfg(feature = "custom-cells")]
    fn paint(&self, _: usize, _: usize) -> crate::CellPaint {
        crate::CellPaint::default()
    }
}

struct Memory;

impl TallTableDelegate for Memory {
    type Page = Rows;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Rows>) {
        (rows.start, Box::pin(std::future::ready(Ok(Rows(rows)))))
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}
}

type Table = TallTableState<Memory>;

struct Shell(gpui_kit::Entity<Table>);

impl gpui_kit::Render for Shell {
    fn render(
        &mut self,
        _: &mut gpui_kit::Window,
        _: &mut gpui_kit::Context<Self>,
    ) -> impl gpui_kit::IntoElement {
        use gpui_kit::{ParentElement as _, Styled as _};
        // The cells' text size, as the `TallTable` element sets it.
        gpui_kit::div()
            .size_full()
            .text_size(gpui_kit::rems(crate::state::TEXT_REMS))
            .child(self.0.clone())
    }
}

/// The table in a 500×400 window (its columns wider than the view, so it
/// scrolls sideways).
struct Sheet<'a> {
    cx: &'a mut VisualTestContext,
    table: gpui_kit::Entity<Table>,
}

impl<'a> Sheet<'a> {
    fn open(cx: &'a mut TestAppContext) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let (shell, cx) = cx.add_window_view(|_, cx| {
            Shell(
                cx.new(|cx| TallTableState::new(Memory, columns(), 10_000, Paging::default(), cx)),
            )
        });
        let table = shell.read_with(cx, |shell, _| shell.0.clone());
        cx.simulate_resize(size(px(500.), px(400.)));
        let mut sheet = Self { cx, table };
        sheet.draw();
        sheet
    }

    fn draw(&mut self) {
        for _ in 0..2 {
            self.cx.run_until_parked();
            self.cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    }

    fn update(&mut self, update: impl FnOnce(&mut Table, &mut gpui_kit::Context<Table>)) {
        self.table.update(self.cx, update);
        self.draw();
    }

    fn drawn(&mut self) -> Vec<DrawnText> {
        self.table
            .read_with(self.cx, |table, _| table.drawn_text.borrow().clone())
    }

    /// What every check reads: the scale, the cells' left on screen, the
    /// row height, the padding, and the theme's two text colors.
    fn frame(&mut self) -> Frame {
        let table = self.table.clone();
        self.cx.update(|window, cx| {
            let table = table.read(cx);
            let sizes = table.sizes();
            #[cfg(feature = "density")]
            let pad = sizes.pad();
            #[cfg(not(feature = "density"))]
            let pad = f32::from(gpui_kit::rems(0.5).to_pixels(window.rem_size()));
            Frame {
                scale: window.scale_factor(),
                cells_left: f32::from(table.body.origin.x) + table.gutter_width(),
                row: f32::from(sizes.row()),
                pad,
                scroll_x: table.scroll_x,
                foreground: cx.theme().foreground,
                muted: cx.theme().muted_foreground,
            }
        })
    }

    /// `text`'s width as the cells' font shapes it.
    fn width(&mut self, text: &str) -> f32 {
        let (table, text) = (self.table.clone(), text.to_string());
        self.cx
            .update(|window, cx| table.read(cx).text_width(text.into(), window))
    }
}

struct Frame {
    scale: f32,
    cells_left: f32,
    row: f32,
    pad: f32,
    scroll_x: f32,
    foreground: Hsla,
    muted: Hsla,
}

impl Frame {
    /// A length as taffy takes it: rounded to device pixels, midpoints
    /// toward zero.
    fn snap(&self, value: f32) -> f32 {
        ((value * self.scale).abs() - 0.5).ceil().copysign(value) / self.scale
    }

    fn on_pixel(&self, value: f32) -> bool {
        let device = value * self.scale;
        (device - device.round()).abs() < 1e-3
    }
}

/// The checks every frame passes: each cell's box on device pixels, its
/// text's place and cut, its color, and one baseline a row.
fn check_cells(sheet: &mut Sheet, drawn: &[DrawnText], frame: &Frame) {
    let shown = |row: u64, column: usize| match value(row, column) {
        CellValue::Null => "NULL".to_string(),
        CellValue::Float(value) => format!("{value:?}"),
        value => value.to_string(),
    };
    let pad = frame.snap(frame.pad);
    let baseline = drawn[0].baseline - f32::from(drawn[0].cell.origin.y);
    assert!(
        baseline > 0.0 && baseline < frame.row,
        "baseline {baseline} in a {} px row",
        frame.row
    );
    for cell in drawn {
        let clip: Bounds<Pixels> = cell.cell;
        let (left, top) = (f32::from(clip.origin.x), f32::from(clip.origin.y));
        let (width, height) = (f32::from(clip.size.width), f32::from(clip.size.height));
        let at = format!("row {}, column {}", cell.row, cell.column);
        for edge in [left, top, width, height] {
            assert!(
                frame.on_pixel(edge),
                "{at}: its box {clip:?} off the device pixel"
            );
        }
        assert_eq!(height, frame.snap(frame.row), "{at}: its height");
        assert!(
            (cell.baseline - top - baseline).abs() < 1e-3,
            "{at}: baseline {} below its top, not {baseline}",
            cell.baseline - top
        );
        let text_width = sheet.width(&cell.text);
        let content = width - 2.0 * pad;
        let full = shown(cell.row, cell.column);
        if cell.text == full {
            assert!(
                text_width <= content + 1e-3,
                "{at}: {full:?} drawn whole, {text_width} px in {content}"
            );
        } else {
            assert!(
                sheet.width(&full) > content,
                "{at}: {full:?} cut to {:?} though it fits",
                cell.text
            );
            assert!(
                text_width <= content + 1e-3,
                "{at}: cut to {:?}, {text_width} px in {content}",
                cell.text
            );
            let (front, back) = cell
                .text
                .split_once('…')
                .unwrap_or_else(|| panic!("{at}: cut with no …: {:?}", cell.text));
            if cell.column == 1 {
                assert!(
                    !front.is_empty() && !back.is_empty(),
                    "{at}: an integer cut at an end: {:?}",
                    cell.text
                );
                assert!(
                    full.starts_with(front) && full.ends_with(back),
                    "{at}: {:?} isn't {full:?} cut in the middle",
                    cell.text
                );
            } else {
                assert!(
                    back.is_empty() && full.starts_with(front.trim_end()),
                    "{at}: {:?} isn't {full:?} cut at its end",
                    cell.text
                );
            }
        }
        // The text columns left, the numbers right.
        if matches!(cell.column, 0 | 3) {
            assert!(
                (cell.x - (left + pad)).abs() < 1e-3,
                "{at}: text at {}, not the padding's {}",
                cell.x,
                left + pad
            );
        } else {
            let end = cell.x + text_width;
            assert!(
                (end - (left + width - pad)).abs() < 1e-3,
                "{at}: text ends at {end}, not the padding's {}",
                left + width - pad
            );
        }
        let color = if cell.column == 3 {
            frame.muted
        } else {
            frame.foreground
        };
        assert_eq!(cell.color, color, "{at}: its color");
    }
    // Both cuts on screen, and an uncut text.
    assert!(
        drawn
            .iter()
            .any(|cell| cell.column == 0 && cell.text.ends_with('…'))
    );
    assert!(
        drawn
            .iter()
            .any(|cell| cell.column == 0 && !cell.text.contains('…'))
    );
    assert!(
        drawn
            .iter()
            .any(|cell| cell.column == 1 && cell.text.contains('…'))
    );
}

/// Every loaded cell in view drawn once.
fn check_all_drawn(sheet: &mut Sheet, drawn: &[DrawnText], columns: &[usize]) {
    let (first, end, loaded) = sheet.table.read_with(sheet.cx, |table, _| {
        let visible = table.scroll.visible();
        (
            visible.start,
            visible.end,
            (visible.start..visible.end)
                .all(|row| matches!(table.cache.row(row), crate::pages::RowState::Loaded(..))),
        )
    });
    assert!(loaded, "rows {first}..{end} not all loaded");
    let mut want: Vec<(u64, usize)> = (first..end)
        .flat_map(|row| columns.iter().map(move |&column| (row, column)))
        .collect();
    let mut seen: Vec<(u64, usize)> = drawn.iter().map(|cell| (cell.row, cell.column)).collect();
    want.sort_unstable();
    seen.sort_unstable();
    assert_eq!(seen, want, "the cells drawn");
}

#[gpui_kit::test]
fn the_cells_text_at_a_fractional_scroll(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx);
    let frame = sheet.frame();
    let drawn = sheet.drawn();
    let columns_in_view = visible(&mut sheet);
    check_all_drawn(&mut sheet, &drawn, &columns_in_view);
    check_cells(&mut sheet, &drawn, &frame);
    // At the top and no sideways scroll, each box is its column's.
    let columns = sheet
        .table
        .read_with(sheet.cx, |table, _| table.columns.clone());
    for cell in &drawn {
        let x = frame.cells_left + frame.snap(columns[cell.column].x);
        assert_eq!(
            f32::from(cell.cell.origin.x),
            x,
            "column {}'s left",
            cell.column
        );
    }

    // A row top and a sideways scroll off the device pixel.
    sheet.update(|table, cx| table.scroll_by(3.2433, 33.3, cx));
    let frame = sheet.frame();
    assert!(frame.scroll_x > 0.0, "no sideways room");
    let top = sheet
        .table
        .read_with(sheet.cx, |table, _| table.scroll.top());
    assert!(!frame.on_pixel(frame.scroll_x) && !frame.on_pixel((top.fract() as f32) * frame.row));
    let drawn = sheet.drawn();
    let columns_in_view = visible(&mut sheet);
    check_all_drawn(&mut sheet, &drawn, &columns_in_view);
    check_cells(&mut sheet, &drawn, &frame);
    for cell in &drawn {
        // The `div`'s left, `column.x - scroll_x`, snapped on its own.
        let x = frame.cells_left + frame.snap(columns[cell.column].x - frame.scroll_x);
        assert_eq!(
            f32::from(cell.cell.origin.x),
            x,
            "column {}'s left at the scroll",
            cell.column
        );
    }
}

/// A text longer than its cell could show at the narrowest advance is
/// drawn from its start alone, and draws what the whole value does (the
/// control: every cell from its whole value): the same text after the cut,
/// at the same place, a character under the bound, at it, over it, and far
/// past it, with line breaks and with characters of more than a byte. A
/// text cut in the middle is drawn from its whole value.
#[gpui_kit::test]
fn a_long_text_is_drawn_from_its_start(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx);
    // The bound, worked out here: the content box and an em, at an eighth
    // of the text size a character.
    let bound = sheet.table.read_with(sheet.cx, |table, _| {
        let font_size = f32::from(table.glyphs.font_size);
        assert_eq!(font_size, 14.0);
        let room = table.columns[0].width - table.sizes().padding() + font_size;
        (room / 1.75) as usize + 1
    });
    BOUND.set(bound);
    sheet.update(|table, cx| table.jump_to(LONG_ROWS, cx));
    let long = |sheet: &mut Sheet| -> Vec<DrawnText> {
        let mut cells: Vec<DrawnText> = sheet
            .drawn()
            .into_iter()
            .filter(|cell| (LONG_ROWS..LONG_ROWS + 8).contains(&cell.row) && cell.column < 2)
            .collect();
        cells.sort_by_key(|cell| (cell.row, cell.column));
        cells
    };
    let bounded = |sheet: &mut Sheet| {
        sheet
            .table
            .read_with(sheet.cx, |table, _| table.bounded.get())
    };
    let drawn = long(&mut sheet);
    assert_eq!(drawn.len(), 16, "the long rows' cells drawn");
    // Over the bound, far past it, with breaks, and in wider characters;
    // not the two at and under it, the one of fewer characters than bytes,
    // or the number cut in the middle.
    assert_eq!(bounded(&mut sheet), 4, "the cells drawn from their start");

    sheet.update(|table, cx| {
        table.unbounded_text = true;
        cx.notify();
    });
    assert_eq!(bounded(&mut sheet), 0, "the control bounds none");
    let control = long(&mut sheet);
    assert_eq!(drawn, control, "a bounded text drawn as its whole value is");

    // A start that doesn't prove its cut: at an em a character the bound's
    // characters fit the box (0.6 em each here), as glyphs with no advance
    // would, so every cell is drawn from its whole value, and the same.
    sheet.update(|table, cx| {
        table.unbounded_text = false;
        table.bound_advance_ems = 1.0;
        cx.notify();
    });
    assert_eq!(bounded(&mut sheet), 0, "a start that fits bounds none");
    assert_eq!(long(&mut sheet), control, "drawn from its whole value");

    for cell in &drawn {
        let at = format!("row {}, column {}", cell.row, cell.column);
        let full = match value(cell.row, cell.column) {
            CellValue::Text(text) => text.replace("\r\n", "¶").replace(['\n', '\r'], "¶"),
            value => value.to_string(),
        };
        if cell.column == 1 || cell.row == LONG_ROWS + 7 {
            continue;
        }
        // Every long text is cut at its end, to its value's start.
        let front = cell
            .text
            .strip_suffix('…')
            .unwrap_or_else(|| panic!("{at}: not cut at its end: {:?}", cell.text));
        assert!(
            !front.is_empty() && full.starts_with(front),
            "{at}: {:?} isn't its value's start",
            cell.text
        );
        assert!(
            !cell.text.contains(['\n', '\r']),
            "{at}: a line break drawn"
        );
    }
    // The number far past the bound, cut in the middle: its end drawn too.
    let number = &drawn[7].text;
    let (front, back) = number.split_once('…').expect("the number cut");
    assert!(
        (drawn[7].row, drawn[7].column) == (LONG_ROWS + 3, 1)
            && !front.is_empty()
            && back.ends_with('0'),
        "{number:?}"
    );
}

/// The visible columns' indices.
fn visible(sheet: &mut Sheet) -> Vec<usize> {
    sheet.table.read_with(sheet.cx, |table, _| {
        table.visible_columns().map(|(index, _)| index).collect()
    })
}

/// A pending row draws no text; its rows' text arrives with its page.
#[gpui_kit::test]
fn a_loading_row_draws_no_text(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx);
    sheet
        .table
        .update(sheet.cx, |table, cx| table.jump_to(5_000, cx));
    // Drawn before the page's read resolves.
    sheet.cx.update(|window, cx| window.draw(cx).clear(cx));
    let (pending, loaded): (usize, Vec<u64>) = sheet.table.read_with(sheet.cx, |table, _| {
        let visible = table.scroll.visible();
        let loaded: Vec<u64> = visible
            .clone()
            .filter(|row| matches!(table.cache.row(*row), crate::pages::RowState::Loaded(..)))
            .collect();
        (
            (visible.end - visible.start) as usize - loaded.len(),
            loaded,
        )
    });
    assert!(
        pending > 0,
        "every row in view loaded before its read resolved"
    );
    let drawn = sheet.drawn();
    assert!(
        drawn.iter().all(|cell| loaded.contains(&cell.row)),
        "text drawn for a loading row"
    );
    sheet.draw();
    let drawn = sheet.drawn();
    let columns_in_view = visible(&mut sheet);
    check_all_drawn(&mut sheet, &drawn, &columns_in_view);
}

/// The tooltip says what its cell draws: it goes while its row has no page
/// (a short last page that grew is read anew), comes back when the page
/// lands, the pointer still resting, and the hover goes with a row that's
/// cut.
#[gpui_kit::test]
fn the_tooltip_follows_its_rows_page(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx);
    // Row 1's long text, cut in its column.
    let at = sheet.table.read_with(sheet.cx, |table, _| {
        let column = &table.columns[0];
        table.body.origin
            + gpui_kit::point(
                px(table.gutter_width() + column.x + column.width / 2.0),
                table.sizes().row() * 1.5,
            )
    });
    sheet
        .cx
        .simulate_mouse_move(at, None, gpui_kit::Modifiers::default());
    sheet.draw();
    sheet
        .cx
        .executor()
        .advance_clock(std::time::Duration::from_millis(600));
    sheet.draw();
    let tooltip = |sheet: &mut Sheet| {
        sheet.table.read_with(sheet.cx, |table, _| {
            let hover = table.hover.as_ref()?;
            Some(hover.tooltip.as_ref().map(|(text, _)| text.to_string()))
        })
    };
    let exact = value(1, 0).to_string();
    assert_eq!(
        tooltip(&mut sheet),
        Some(Some(exact.clone())),
        "the control"
    );
    // Cut to five rows: row 1 keeps its page and its tooltip.
    sheet.update(|table, cx| table.set_rows(5, cx));
    assert_eq!(tooltip(&mut sheet), Some(Some(exact.clone())));
    // Grown: the short page is read anew (with `live`, drawn meanwhile).
    // Drawn before the read resolves.
    sheet
        .table
        .update(sheet.cx, |table, cx| table.set_rows(10_000, cx));
    sheet.cx.update(|window, cx| window.draw(cx).clear(cx));
    let loaded = sheet.table.read_with(sheet.cx, |table, _| {
        matches!(table.cache.row(1), crate::pages::RowState::Loaded(..))
    });
    assert_eq!(loaded, cfg!(feature = "live"));
    assert_eq!(
        tooltip(&mut sheet),
        Some(loaded.then(|| exact.clone())),
        "none over a row with no page"
    );
    sheet.draw();
    assert_eq!(
        tooltip(&mut sheet),
        Some(Some(exact)),
        "back when its page lands"
    );
    sheet.update(|table, cx| table.set_rows(1, cx));
    assert_eq!(tooltip(&mut sheet), None, "the hover goes with its row");
}

/// With `pin`: the pinned column's text held under a sideways scroll, in
/// the pinned region; the scrolled ones moved with it.
#[cfg(feature = "pin")]
#[gpui_kit::test]
fn the_pinned_columns_text(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx);
    sheet.update(|table, cx| table.set_pinned(1, cx));
    let before = sheet.drawn();
    sheet.update(|table, cx| table.scroll_by(3.2433, 33.3, cx));
    let frame = sheet.frame();
    assert!(frame.scroll_x > 0.0);
    let drawn = sheet.drawn();
    let columns_in_view = visible(&mut sheet);
    check_all_drawn(&mut sheet, &drawn, &columns_in_view);
    check_cells(&mut sheet, &drawn, &frame);
    let left = |cells: &[DrawnText], column: usize| {
        cells
            .iter()
            .find(|cell| cell.column == column)
            .map(|cell| f32::from(cell.cell.origin.x))
    };
    assert_eq!(left(&drawn, 0), left(&before, 0), "the pinned column moved");
    let (was, now) = (left(&before, 1).unwrap(), left(&drawn, 1).unwrap());
    assert!(
        (was - frame.scroll_x - now).abs() <= 1.0 / frame.scale,
        "the scrolled column at {now}, from {was} less {}",
        frame.scroll_x
    );
}

/// With `density`: the text at its size and the padding scaled.
#[cfg(feature = "density")]
#[gpui_kit::test]
fn the_cells_text_at_a_density(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx);
    sheet.update(|table, cx| {
        table.set_density(
            crate::Density {
                row_height: px(18.),
                text_size: px(11.).into(),
            },
            cx,
        );
    });
    sheet.update(|table, cx| table.scroll_by(3.2433, 33.3, cx));
    let frame = sheet.frame();
    assert_eq!(frame.row, 18.0);
    assert!(frame.pad < 8.0, "the padding {} not scaled", frame.pad);
    let drawn = sheet.drawn();
    let columns_in_view = visible(&mut sheet);
    check_all_drawn(&mut sheet, &drawn, &columns_in_view);
    check_cells(&mut sheet, &drawn, &frame);
    // 0.6 em a character at 11 px.
    let width = sheet.width("0000");
    assert!(
        (width - 4.0 * 0.6 * 11.0).abs() < 1e-3,
        "four digits {width} px at 11 px"
    );
}
