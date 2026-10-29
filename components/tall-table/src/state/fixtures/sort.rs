//! `sort`: `sort.json`'s cycle, clicked through the arrows with its
//! control, and the rest of the feature in a window of GPUI's test app: the
//! arrows drawn in each state (glyphs and the host's icons), their target
//! beside `select`'s header press and `resize`'s band, the widths, the
//! refusals, and what an accepted sort does to the table.

use std::borrow::Cow;
use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;
use std::sync::Arc;

use futures::channel::oneshot;
use gpui_kit::{
    App, AssetSource, Entity, Modifiers, MouseButton, MouseDownEvent, Pixels, Point, SharedString,
    TestAppContext, VisualTestContext, point, px, size,
};
use serde_json::Value;

use super::super::sort::{Arrow, Control, DrawnArrow};
use super::super::{TallTableEvent, TallTableState};
use super::{direction_name, direction_of};
use crate::column::{ColumnKind, TallTableColumn, layout_columns};
use crate::delegate::{CellValue, PageError, PageLoad, TallTableDelegate, TallTablePage};
use crate::pages::RowState;
use crate::sort::{Sort, SortDirection, SortIcons, SortRefused};

const SORT: &str = include_str!("../../../fixtures/sort.json");

// --- the source ---

/// A page whose every value is the read that answered it.
struct Answer {
    request: u64,
}

impl TallTablePage for Answer {
    fn value(&self, _: usize, _: usize) -> Option<CellValue<'_>> {
        Some(CellValue::Float(self.request as f64))
    }

    fn heap_bytes(&self) -> usize {
        1024
    }
}

/// A read held open: its request, its page, and its answer.
type Held = (u64, u64, oneshot::Sender<Result<Answer, PageError>>);

/// What the source was asked, in order, and its reads held open.
#[derive(Default)]
struct Books {
    log: Vec<String>,
    /// Reads not answered: their page and answer.
    open: Vec<Held>,
    next: u64,
    /// Reads wait for [`Sheet::answer`]; otherwise they answer when sent.
    hold: bool,
    /// Every sort refused.
    refuse: bool,
}

/// Rows the test answers, and sorts it accepts or refuses (`refuse`).
struct Source {
    books: Rc<RefCell<Books>>,
}

impl TallTableDelegate for Source {
    type Page = Answer;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Answer>) {
        let mut books = self.books.borrow_mut();
        let request = books.next;
        books.next += 1;
        let page = rows.start / 1024;
        books.log.push(format!("load {page}"));
        if !books.hold {
            return (
                request,
                Box::pin(std::future::ready(Ok(Answer { request }))),
            );
        }
        let (sender, receiver) = oneshot::channel();
        books.open.push((request, page, sender));
        (
            request,
            Box::pin(async move { receiver.await.unwrap_or(Err(PageError::Cancelled)) }),
        )
    }

    fn cancel(&mut self, request: u64, _: &mut App) {
        let mut books = self.books.borrow_mut();
        let page = books
            .open
            .iter()
            .find(|(open, _, _)| *open == request)
            .map(|(_, page, _)| *page);
        books
            .log
            .push(format!("cancel {}", page.expect("an open read")));
    }

    fn sort(&mut self, sort: Option<Sort>, _: &mut App) -> Result<(), SortRefused> {
        let mut books = self.books.borrow_mut();
        books.log.push(match sort {
            Some(sort) => format!("sort {} {}", sort.column, direction_name(sort.direction)),
            None => "sort none".into(),
        });
        if books.refuse && sort.is_some() {
            return Err(SortRefused::new("refused"));
        }
        Ok(())
    }
}

/// A source written before the feature: its `sort` is the default.
struct Plain {
    books: Rc<RefCell<Books>>,
}

impl TallTableDelegate for Plain {
    type Page = Answer;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, cx: &mut App) -> (u64, PageLoad<Answer>) {
        Source {
            books: self.books.clone(),
        }
        .load_page(rows, cx)
    }

    fn cancel(&mut self, request: u64, cx: &mut App) {
        Source {
            books: self.books.clone(),
        }
        .cancel(request, cx);
    }
}

/// Loads the three icons the tests name, and nothing else.
struct Icons;

impl AssetSource for Icons {
    fn load(&self, path: &str) -> gpui_kit::Result<Option<Cow<'static, [u8]>>> {
        Ok(["up.svg", "down.svg", "both.svg"]
            .contains(&path)
            .then_some(Cow::Borrowed(b"<svg/>".as_slice())))
    }

    fn list(&self, _: &str) -> gpui_kit::Result<Vec<SharedString>> {
        Ok(Vec::new())
    }
}

fn icons(unsorted: &str) -> SortIcons {
    SortIcons::new("up.svg", "down.svg", unsorted.to_string())
}

// --- the window ---

/// A table in a 1440×900 window, its events, and the source's books.
struct Sheet<'a, D: TallTableDelegate> {
    cx: &'a mut VisualTestContext,
    table: Entity<TallTableState<D>>,
    books: Rc<RefCell<Books>>,
    events: Rc<RefCell<Vec<TallTableEvent>>>,
    _subscription: gpui_kit::Subscription,
}

impl<'a> Sheet<'a, Source> {
    fn open(cx: &'a mut TestAppContext, columns: Vec<TallTableColumn>, hold: bool) -> Self {
        let books = Rc::new(RefCell::new(Books {
            hold,
            ..Books::default()
        }));
        let source = Source {
            books: books.clone(),
        };
        Sheet::with(cx, source, books, columns)
    }
}

impl<'a, D: TallTableDelegate> Sheet<'a, D> {
    fn with(
        cx: &'a mut TestAppContext,
        delegate: D,
        books: Rc<RefCell<Books>>,
        columns: Vec<TallTableColumn>,
    ) -> Self {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            crate::init(cx);
        });
        let (table, cx) = cx.add_window_view(move |_, cx| {
            TallTableState::new(delegate, columns, 100_000, Default::default(), cx)
                .probe_frames(true)
        });
        cx.simulate_resize(size(px(1440.), px(900.)));
        let events: Rc<RefCell<Vec<TallTableEvent>>> = Rc::default();
        let subscription = cx.update(|_, cx| {
            let events = events.clone();
            cx.subscribe(&table, move |_, event: &TallTableEvent, _| match event {
                TallTableEvent::Probe(_)
                | TallTableEvent::Layout(_)
                | TallTableEvent::Scrollbar { .. }
                | TallTableEvent::Filled { .. } => {}
                event => events.borrow_mut().push(event.clone()),
            })
        });
        let mut sheet = Self {
            cx,
            table,
            books,
            events,
            _subscription: subscription,
        };
        sheet.draw();
        sheet.take_log();
        sheet
    }

    /// Runs what can run, then draws a frame (twice: the body is measured
    /// in the first).
    fn draw(&mut self) {
        for _ in 0..2 {
            self.cx.run_until_parked();
            self.cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    }

    fn read<T>(&mut self, read: impl FnOnce(&TallTableState<D>) -> T) -> T {
        self.table.read_with(self.cx, |table, _| read(table))
    }

    fn update<T>(
        &mut self,
        update: impl FnOnce(&mut TallTableState<D>, &mut gpui_kit::Context<TallTableState<D>>) -> T,
    ) -> T {
        let result = self.table.update(self.cx, update);
        self.draw();
        result
    }

    fn take_log(&mut self) -> Vec<String> {
        std::mem::take(&mut self.books.borrow_mut().log)
    }

    fn take_events(&mut self) -> Vec<TallTableEvent> {
        std::mem::take(&mut *self.events.borrow_mut())
    }

    /// Answers the oldest open read of `page` with its page.
    fn answer(&mut self, page: u64) -> u64 {
        let (request, _, sender) = {
            let mut books = self.books.borrow_mut();
            let index = books
                .open
                .iter()
                .position(|(_, open, _)| *open == page)
                .expect("an open read of the page");
            books.open.remove(index)
        };
        let _ = sender.send(Ok(Answer { request }));
        self.draw();
        request
    }

    fn drawn(&mut self) -> Vec<DrawnArrow> {
        self.read(|table| table.sort_state.drawn.clone())
    }

    fn arrow(&mut self, column: usize) -> Option<DrawnArrow> {
        self.drawn()
            .into_iter()
            .find(|arrow| arrow.column == column)
    }

    /// The middle of column `column`'s arrow's target.
    fn arrow_at(&mut self, column: usize) -> Point<Pixels> {
        let target = self.arrow(column).expect("an arrow").target;
        target.center()
    }

    fn press(&mut self, at: Point<Pixels>) {
        self.cx.simulate_event(MouseDownEvent {
            position: at,
            modifiers: Modifiers::default(),
            button: MouseButton::Left,
            click_count: 1,
            first_mouse: false,
        });
        self.draw();
    }

    fn release(&mut self, at: Point<Pixels>) {
        self.cx
            .simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
        self.draw();
    }

    fn click(&mut self, at: Point<Pixels>) {
        self.press(at);
        self.release(at);
    }

    fn hover(&mut self, at: Point<Pixels>) {
        self.cx.simulate_mouse_move(at, None, Modifiers::default());
        self.draw();
    }

    fn sort(&mut self) -> Option<Sort> {
        self.read(|table| table.sort())
    }

    /// The header's text color, full and at half.
    fn colors(&mut self) -> (gpui_kit::Hsla, gpui_kit::Hsla) {
        use gpui_kit::component::ActiveTheme as _;
        let full = self.cx.update(|_, cx| cx.theme().table_head_foreground);
        (full, full.opacity(0.5))
    }
}

fn column(name: &str, kind: ColumnKind) -> TallTableColumn {
    TallTableColumn::new(name, kind).sortable(true)
}

fn floats(count: usize) -> Vec<TallTableColumn> {
    (0..count)
        .map(|index| column(&format!("f{index}"), ColumnKind::Float))
        .collect()
}

fn kind_named(name: &str) -> ColumnKind {
    match name {
        "text" => ColumnKind::Text,
        "integer" => ColumnKind::Integer { max_chars: 8 },
        "float" => ColumnKind::Float,
        "decimal" => ColumnKind::Decimal,
        "date" => ColumnKind::Date,
        "timestamp" => ColumnKind::Timestamp,
        "boolean" => ColumnKind::Boolean,
        other => panic!("unknown kind {other:?}"),
    }
}

// --- sort.json's cycle ---

/// The fixture's cycles, clicked through each kind's arrow, that the table
/// doesn't follow under `control`.
fn cycle_mismatches(cx: &mut TestAppContext, control: Control) -> Vec<String> {
    let fixture: Value = serde_json::from_str(SORT).expect("sort.json");
    let cycles = fixture["cycle"].as_array().expect("cycle");
    let columns: Vec<TallTableColumn> = cycles
        .iter()
        .map(|cycle| {
            let kind = cycle["kind"].as_str().expect("kind");
            column(kind, kind_named(kind))
        })
        .collect();
    let mut sheet = Sheet::open(cx, columns, false);
    sheet.update(|table, _| table.sort_state.control = control);
    let mut mismatches = Vec::new();
    for (index, cycle) in cycles.iter().enumerate() {
        for (click, expected) in cycle["clicks"]
            .as_array()
            .expect("clicks")
            .iter()
            .enumerate()
        {
            let at = sheet.arrow_at(index);
            sheet.click(at);
            let expected = (!expected.is_null()).then(|| Sort::new(index, direction_of(expected)));
            let sorted = sheet.sort();
            if sorted != expected {
                mismatches.push(format!(
                    "{}, click {}: {sorted:?}, not {expected:?}",
                    cycle["kind"],
                    click + 1
                ));
            }
        }
    }
    mismatches
}

#[gpui_kit::test]
fn sort_fixture_cycle(cx: &mut TestAppContext) {
    let mismatches = cycle_mismatches(cx, Control::None);
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

#[gpui_kit::test]
fn sort_cycle_controls_fail(cx: &mut TestAppContext) {
    let fixture: Value = serde_json::from_str(SORT).expect("sort.json");
    for control in fixture["cycle_controls"]
        .as_array()
        .expect("cycle_controls")
    {
        let control = match control.as_str() {
            Some("descending-first") => Control::DescendingFirst,
            other => panic!("unknown cycle control {other:?}"),
        };
        assert!(
            !cycle_mismatches(cx, control).is_empty(),
            "{control:?} passed the sort fixture's cycle"
        );
    }
}

// --- the arrows ---

#[gpui_kit::test]
fn another_columns_arrow_starts_its_own_cycle(cx: &mut TestAppContext) {
    let columns = vec![
        column("name", ColumnKind::Text),
        column("f", ColumnKind::Float),
    ];
    let mut sheet = Sheet::open(cx, columns, false);
    let (name, float) = (sheet.arrow_at(0), sheet.arrow_at(1));
    sheet.click(name);
    sheet.click(name);
    assert_eq!(sheet.sort(), Some(Sort::new(0, SortDirection::Descending)));
    sheet.click(float);
    assert_eq!(sheet.sort(), Some(Sort::new(1, SortDirection::Descending)));
    let arrows = sheet.drawn();
    assert_eq!(arrows[0].arrow, Arrow::Glyph('↕'), "the old column's arrow");
    assert_eq!(arrows[1].arrow, Arrow::Glyph('↓'));
}

#[gpui_kit::test]
fn the_arrows_in_each_state(cx: &mut TestAppContext) {
    let columns = vec![
        column("f", ColumnKind::Float),
        TallTableColumn::new("plain", ColumnKind::Float),
    ];
    let mut sheet = Sheet::open(cx, columns, false);
    let (full, dim) = sheet.colors();
    // Only the sortable column draws one.
    let arrows = sheet.drawn();
    assert_eq!(arrows.len(), 1);
    assert_eq!(
        (arrows[0].arrow.clone(), arrows[0].color),
        (Arrow::Glyph('↕'), dim)
    );
    let at = sheet.arrow_at(0);
    sheet.hover(at);
    assert_eq!(
        sheet.arrow(0).map(|arrow| arrow.color),
        Some(full),
        "hovered"
    );
    sheet.hover(point(px(700.), px(400.)));
    assert_eq!(sheet.arrow(0).map(|arrow| arrow.color), Some(dim), "left");
    for (glyph, sort) in [
        ('↓', Some(SortDirection::Descending)),
        ('↑', Some(SortDirection::Ascending)),
        ('↕', None),
    ] {
        sheet.click(at);
        sheet.hover(point(px(700.), px(400.)));
        assert_eq!(sheet.sort().map(|sort| sort.direction), sort);
        let arrow = sheet.arrow(0).expect("an arrow");
        let color = if sort.is_some() { full } else { dim };
        assert_eq!((arrow.arrow, arrow.color), (Arrow::Glyph(glyph), color));
    }
    // A column not made sortable is laid out as without the feature.
    let plain = sheet.read(|table| table.columns[1].width);
    let (without, _) = layout_columns(
        &[TallTableColumn::new("plain", ColumnKind::Float)],
        8.4,
        0.0,
    );
    assert_eq!(plain, without[0].width);
}

#[gpui_kit::test]
fn the_hosts_icons_or_the_glyphs(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(1), false);
    let width = sheet.read(|table| table.columns[0].width);
    sheet.update(|table, cx| {
        table.sort_state.assets = Some(Arc::new(Icons));
        table.set_sort_icons(Some(icons("both.svg")), cx);
    });
    let (full, dim) = sheet.colors();
    let icon = |path: &str| Arrow::Icon(path.to_string().into());
    let arrow = sheet.arrow(0).expect("an arrow");
    assert_eq!((arrow.arrow, arrow.color), (icon("both.svg"), dim));
    let at = sheet.arrow_at(0);
    sheet.click(at);
    sheet.hover(point(px(700.), px(400.)));
    let arrow = sheet.arrow(0).expect("an arrow");
    assert_eq!((arrow.arrow, arrow.color), (icon("down.svg"), full));
    sheet.click(at);
    assert_eq!(
        sheet.arrow(0).map(|arrow| arrow.arrow),
        Some(icon("up.svg"))
    );
    // The same width with icons as with glyphs, and unchanged by a sort.
    assert_eq!(sheet.read(|table| table.columns[0].width), width);
    // A path that doesn't load: the glyphs, for all three.
    sheet.update(|table, cx| table.set_sort_icons(Some(icons("missing.svg")), cx));
    assert_eq!(
        sheet.arrow(0).map(|arrow| arrow.arrow),
        Some(Arrow::Glyph('↑'))
    );
    sheet.update(|table, cx| table.set_sort_icons(None, cx));
    assert_eq!(
        sheet.arrow(0).map(|arrow| arrow.arrow),
        Some(Arrow::Glyph('↑'))
    );
}

#[gpui_kit::test]
fn a_release_off_the_arrow_sorts_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(2), false);
    let (first, second) = (sheet.arrow_at(0), sheet.arrow_at(1));
    sheet.press(first);
    sheet.release(point(px(700.), px(400.)));
    assert_eq!(sheet.sort(), None);
    sheet.press(first);
    sheet.release(second);
    assert_eq!(sheet.sort(), None, "a release on another arrow");
    // A later release on the first, after a press elsewhere.
    sheet.press(point(px(700.), px(400.)));
    sheet.release(first);
    assert_eq!(sheet.sort(), None);
    assert!(
        sheet
            .take_log()
            .iter()
            .all(|event| !event.starts_with("sort"))
    );
}

/// A sortable column's width counts the gap and the box; a long name is
/// widened by them, a short one's kind width holds them already.
#[gpui_kit::test]
fn a_sortable_width_counts_the_arrow(cx: &mut TestAppContext) {
    let name = "a long column name";
    let columns = vec![
        column(name, ColumnKind::Float),
        TallTableColumn::new(name, ColumnKind::Float),
    ];
    let mut sheet = Sheet::open(cx, columns, false);
    let (sortable, plain) = sheet.read(|table| (table.columns[0].width, table.columns[1].width));
    // The test font's arrows are 8.4 px: the box is the icon size, 14 px.
    assert_eq!(sortable, plain + 4.0 + 14.0);
    let at = sheet.arrow_at(0);
    sheet.click(at);
    assert_eq!(
        sheet.read(|table| table.columns[0].width),
        sortable,
        "a sort"
    );
}

#[cfg(feature = "resize")]
#[gpui_kit::test]
fn a_narrow_column_cuts_its_name_or_draws_no_arrow(cx: &mut TestAppContext) {
    let columns = vec![
        column("a long column name", ColumnKind::Float).width(px(60.)),
        column("f", ColumnKind::Float)
            .min_width(px(20.))
            .width(px(30.)),
    ];
    let mut sheet = Sheet::open(cx, columns, false);
    // 60 px holds the padding, the gap, and the box (34 px): the arrow, and
    // the name's box ends at its gap.
    let arrows = sheet.drawn();
    assert_eq!(
        arrows.iter().map(|arrow| arrow.column).collect::<Vec<_>>(),
        [0]
    );
    let room = sheet.read(|table| table.arrow_room(0, &table.columns[0]));
    assert_eq!(room, Some(18.0));
    // 30 px doesn't: no arrow, no target, and the name keeps its padding.
    assert_eq!(
        sheet.read(|table| table.arrow_room(1, &table.columns[1])),
        None
    );
    let at = point(
        px(sheet.read(|table| table.gutter_width()) + 60.0 + 20.0),
        super::super::row_height() / 2.,
    );
    sheet.click(at);
    assert_eq!(sheet.sort(), None);
}

#[cfg(feature = "resize")]
#[gpui_kit::test]
fn the_fit_counts_the_arrow(cx: &mut TestAppContext) {
    let name = "a long column name";
    let columns = vec![
        column(name, ColumnKind::Text).width(px(40.)),
        TallTableColumn::new(name, ColumnKind::Text).width(px(40.)),
    ];
    let mut sheet = Sheet::open(cx, columns, false);
    // The fit is a double-click on the band.
    for column in [0, 1] {
        let edge = sheet.read(|table| {
            let laid_out = &table.columns[column];
            table.gutter_width() + laid_out.x + laid_out.width - table.scroll_x - 0.5
        });
        let at = point(px(edge), super::super::row_height() / 2.);
        sheet.click(at);
        sheet.cx.simulate_event(MouseDownEvent {
            position: at,
            modifiers: Modifiers::default(),
            button: MouseButton::Left,
            click_count: 2,
            first_mouse: false,
        });
        sheet.release(at);
    }
    let (sortable, plain) = sheet.read(|table| (table.columns[0].width, table.columns[1].width));
    assert_eq!(sortable, plain + 18.0);
    assert_eq!(sheet.sort(), None, "the band's double-click sorts nothing");
}

#[cfg(feature = "select")]
#[gpui_kit::test]
fn the_arrow_sorts_and_beside_it_selects(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(2), false);
    let at = sheet.arrow_at(0);
    sheet.click(at);
    assert_eq!(sheet.sort(), Some(Sort::new(0, SortDirection::Descending)));
    assert_eq!(
        sheet.read(|table| table.selection()),
        None,
        "the arrow selects nothing"
    );
    // Beside it, the header selects its column.
    let beside = point(at.x - px(40.), at.y);
    sheet.click(beside);
    let selected = sheet.read(|table| table.selection()).expect("a selection");
    assert_eq!(selected.kind(), crate::selection::Kind::Columns);
    assert_eq!(selected.anchor().1, 0);
    assert_eq!(sheet.sort(), Some(Sort::new(0, SortDirection::Descending)));
}

#[cfg(feature = "resize")]
#[gpui_kit::test]
fn the_band_still_drags(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(2), false);
    let target = sheet.arrow(0).expect("an arrow").target;
    let edge = sheet.read(|table| {
        let laid_out = &table.columns[0];
        table.gutter_width() + laid_out.x + laid_out.width - 0.5
    });
    // The target ends where the band begins.
    assert_eq!(f32::from(target.right()), edge + 0.5 - 5.0);
    sheet.press(point(px(edge), super::super::row_height() / 2.));
    assert!(sheet.read(|table| table.resizing.is_some()));
    sheet.release(point(px(edge + 30.), super::super::row_height() / 2.));
    assert_eq!(sheet.sort(), None);
}

// --- refusals ---

#[gpui_kit::test]
fn a_source_without_sort_refuses(cx: &mut TestAppContext) {
    let books: Rc<RefCell<Books>> = Rc::default();
    let plain = Plain {
        books: books.clone(),
    };
    let mut sheet = Sheet::with(cx, plain, books, floats(2));
    let at = sheet.arrow_at(0);
    sheet.click(at);
    assert_eq!(sheet.sort(), None);
    let refused = Sort::new(0, SortDirection::Descending);
    assert_eq!(
        sheet.take_events(),
        [TallTableEvent::SortRefused(
            refused,
            SortRefused::new("This source can't sort")
        )]
    );
    assert_eq!(
        sheet.take_log(),
        Vec::<String>::new(),
        "nothing read or cancelled"
    );
    assert_eq!(
        sheet.arrow(0).map(|arrow| arrow.arrow),
        Some(Arrow::Glyph('↕'))
    );
    let result = sheet.update(|table, cx| table.set_sort(Some(refused), cx));
    assert_eq!(result, Err(SortRefused::new("This source can't sort")));
    assert!(sheet.take_events().is_empty(), "set_sort emits nothing");
    // Going back to none is accepted.
    assert_eq!(sheet.update(|table, cx| table.set_sort(None, cx)), Ok(()));
}

#[gpui_kit::test]
fn the_tables_own_refusals(cx: &mut TestAppContext) {
    let columns = vec![
        column("f", ColumnKind::Float),
        TallTableColumn::new("plain", ColumnKind::Float),
    ];
    let mut sheet = Sheet::open(cx, columns, false);
    for (sort, message) in [
        (
            Sort::new(1, SortDirection::Ascending),
            "Column plain isn't sortable",
        ),
        (
            Sort::new(2, SortDirection::Ascending),
            "There's no column 2",
        ),
    ] {
        let result = sheet.update(|table, cx| table.set_sort(Some(sort), cx));
        assert_eq!(result, Err(SortRefused::new(message)));
    }
    assert!(sheet.take_events().is_empty());
    assert!(sheet.take_log().is_empty(), "the source wasn't told");
    // The source's refusal: the click's event, the order as it was.
    sheet.books.borrow_mut().refuse = true;
    let at = sheet.arrow_at(0);
    sheet.click(at);
    assert_eq!(sheet.sort(), None);
    assert_eq!(sheet.take_log(), ["sort 0 descending"]);
    assert!(matches!(
        sheet.take_events()[..],
        [TallTableEvent::SortRefused(_, _)]
    ));
}

// --- what a sort does ---

/// The sort events emitted.
fn sorted(events: &[TallTableEvent]) -> Vec<Option<Sort>> {
    events
        .iter()
        .filter_map(|event| match event {
            TallTableEvent::Sorted(sort) => Some(*sort),
            _ => None,
        })
        .collect()
}

#[gpui_kit::test]
fn a_sort_forgets_every_page_and_reads_from_the_top(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(20), true);
    // The top page and its prefetch, then a jump: its page held out.
    sheet.answer(0);
    sheet.answer(1);
    sheet.answer(2);
    sheet.update(|table, cx| table.jump_to(50_000, cx));
    sheet.update(|table, cx| table.scroll_by(0.0, 60.0, cx));
    sheet.take_log();
    let scroll_x = sheet.read(|table| table.scroll_x);
    let sort = Some(Sort::new(1, SortDirection::Descending));
    // The plan waits for the update to end: nothing read inside it.
    let sent = sheet.books.borrow().next;
    let in_update = sheet.table.update(sheet.cx, |table, cx| {
        let result = table.set_sort(sort, cx);
        (result, table.books_reads())
    });
    assert_eq!(in_update, (Ok(()), sent));
    sheet.draw();
    let log = sheet.take_log();
    assert_eq!(
        log[0], "sort 1 descending",
        "the source told first: {log:?}"
    );
    assert_eq!(
        log[1..],
        ["cancel 48".to_string(), "load 0".to_string()],
        "the jump's read cancelled, then the new order's top page"
    );
    let (top, marked, x, loaded, draining) = sheet.read(|table| {
        (
            table.scroll.top(),
            table.marked,
            table.scroll_x,
            table.cache.loaded_pages(),
            table.cache.draining(),
        )
    });
    assert_eq!(
        (top, marked, x),
        (0.0, None, scroll_x),
        "the top, the sideways scroll kept"
    );
    assert_eq!(
        (loaded, draining),
        (0, 1),
        "every page forgotten, the read draining"
    );
    assert_eq!(sorted(&sheet.take_events()), [sort]);
    // The old read answers with a page: dropped, and its place freed.
    sheet.answer(48);
    assert_eq!(sheet.read(|table| table.cache.draining()), 0);
    // The new order's top page, read once the update ended (beside the
    // jump's draining read).
    let top_read = sheet
        .books
        .borrow()
        .open
        .iter()
        .find(|(_, page, _)| *page == 0)
        .map(|(request, _, _)| *request);
    assert!(
        top_read.is_some(),
        "the top page read: {:?}",
        sheet.take_log()
    );
    let request = sheet.answer(0);
    assert!(matches!(
        sheet.read(|table| match table.cache.row(0) {
            RowState::Loaded(page, _) => Some(page.request),
            _ => None,
        }),
        Some(r) if r == request
    ));
    // The same sort again re-reads every row.
    sheet.take_log();
    sheet
        .update(|table, cx| table.set_sort(sort, cx))
        .expect("sorted");
    assert_eq!(sheet.take_log()[0], "sort 1 descending");
    assert_eq!(sheet.read(|table| table.cache.loaded_pages()), 0);
    assert_eq!(sorted(&sheet.take_events()), [sort]);
}

impl TallTableState<Source> {
    /// The reads sent so far (inside an update, for the test above).
    fn books_reads(&self) -> u64 {
        self.delegate.books.borrow().next
    }
}

#[cfg(feature = "select")]
#[gpui_kit::test]
fn a_sort_clears_rows_and_cells_and_keeps_columns(cx: &mut TestAppContext) {
    use crate::selection::{Kind, TallTableSelection};
    let mut sheet = Sheet::open(cx, floats(3), false);
    let sort = |direction| Some(Sort::new(0, direction));
    for (kind, kept) in [
        (Kind::Rows, None),
        (Kind::Cells, None),
        (
            Kind::Columns,
            Some(TallTableSelection::new(Kind::Columns, (0, 1), (0, 2))),
        ),
    ] {
        let selection = TallTableSelection::new(kind, (40, 1), (60, 2));
        sheet.update(|table, cx| table.select(Some(selection), cx));
        sheet.take_events();
        sheet
            .update(|table, cx| table.set_sort(sort(SortDirection::Descending), cx))
            .expect("sorted");
        assert_eq!(sheet.read(|table| table.selection()), kept, "{kind:?}");
        let events = sheet.take_events();
        assert!(
            events.contains(&TallTableEvent::Selected(kept)),
            "{events:?}"
        );
    }
    // A jump that selected: its highlight goes with it.
    sheet.update(|table, cx| table.jump_to(500, cx));
    sheet
        .update(|table, cx| table.set_sort(sort(SortDirection::Ascending), cx))
        .expect("sorted");
    assert_eq!(
        sheet.read(|table| (table.marked, table.drawn_mark())),
        (None, None)
    );
}

#[cfg(feature = "copy")]
#[gpui_kit::test]
fn a_sort_cancels_a_copy(cx: &mut TestAppContext) {
    use crate::copy::{CopyFailure, TallTableCopy};
    use crate::selection::{Kind, TallTableSelection};
    let mut sheet = Sheet::open(cx, floats(3), true);
    let selection = TallTableSelection::new(Kind::Rows, (0, 0), (5000, 0));
    sheet.update(|table, cx| table.select(Some(selection), cx));
    let id = sheet.update(|table, cx| table.copy(cx)).expect("a copy");
    assert!(sheet.read(|table| table.copying().is_some()));
    sheet.take_events();
    sheet
        .update(|table, cx| table.set_sort(Some(Sort::new(0, SortDirection::Ascending)), cx))
        .expect("sorted");
    assert_eq!(sheet.read(|table| table.copying()), None);
    let events = sheet.take_events();
    assert!(
        events.contains(&TallTableEvent::Copy(TallTableCopy::Failed {
            id,
            reason: CopyFailure::Cancelled
        })),
        "{events:?}"
    );
}

#[cfg(feature = "follow")]
#[gpui_kit::test]
fn a_sort_lets_following_go(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(2), false);
    sheet.update(|table, cx| table.follow(cx));
    assert!(sheet.read(|table| table.is_following()));
    sheet.take_events();
    sheet
        .update(|table, cx| table.set_sort(Some(Sort::new(0, SortDirection::Ascending)), cx))
        .expect("sorted");
    assert!(!sheet.read(|table| table.is_following()));
    assert!(
        sheet
            .take_events()
            .contains(&TallTableEvent::Following(false))
    );
}

#[cfg(all(feature = "live", feature = "custom-cells"))]
#[gpui_kit::test]
fn a_sort_clears_the_flashes(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(2), false);
    sheet.update(|table, cx| {
        let now = table.flashes.now(cx);
        table
            .flashes
            .start(3, 0, 1.0, now, std::time::Duration::from_secs(1));
    });
    sheet
        .update(|table, cx| table.set_sort(Some(Sort::new(0, SortDirection::Ascending)), cx))
        .expect("sorted");
    assert!(sheet.read(|table| table.flashes.is_empty()));
}

#[gpui_kit::test]
fn set_columns_keeps_the_sort_by_name(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(3), false);
    let sort = Some(Sort::new(1, SortDirection::Ascending));
    sheet
        .update(|table, cx| table.set_sort(sort, cx))
        .expect("sorted");
    sheet.take_log();
    sheet.take_events();
    // The same columns again: kept, the source not told.
    sheet.update(|table, cx| table.set_columns(floats(3), cx));
    assert_eq!(sheet.sort(), sort);
    assert!(
        sheet
            .take_log()
            .iter()
            .all(|event| !event.starts_with("sort"))
    );
    // Column 1 renamed: cleared, the source told.
    let mut renamed = floats(3);
    renamed[1] = column("other", ColumnKind::Float);
    sheet.update(|table, cx| table.set_columns(renamed, cx));
    assert_eq!(sheet.sort(), None);
    assert_eq!(sheet.take_log()[0], "sort none");
    assert_eq!(sorted(&sheet.take_events()), [None]);
    // Sorted again, then the column no longer sortable: cleared.
    sheet
        .update(|table, cx| table.set_sort(sort, cx))
        .expect("sorted");
    let mut plain = floats(3);
    plain[1] = TallTableColumn::new("f1", ColumnKind::Float);
    sheet.update(|table, cx| table.set_columns(plain, cx));
    assert_eq!(sheet.sort(), None);
}

/// A sortable name's cell ends at the arrow's gap: its right padding is the
/// cell's 8 px and the room, after the cell's own `px_2` (which sets both
/// sides); a column not sortable keeps its 8 px.
#[gpui_kit::test]
fn a_sortable_name_ends_at_the_gap(cx: &mut TestAppContext) {
    let columns = vec![
        column("f", ColumnKind::Float),
        TallTableColumn::new("plain", ColumnKind::Float),
    ];
    let mut sheet = Sheet::open(cx, columns, false);
    let padding = sheet.read(|table| table.sort_state.header_padding.clone());
    let sortable = Some(gpui_kit::DefiniteLength::from(px(8.0 + 18.0)));
    let plain = Some(gpui_kit::DefiniteLength::from(gpui_kit::rems(0.5)));
    assert_eq!(padding, [(0, sortable), (1, plain)]);
}

#[gpui_kit::test]
fn a_closed_table_tells_its_source_nothing(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(2), false);
    let sort = Some(Sort::new(0, SortDirection::Ascending));
    sheet
        .update(|table, cx| table.set_sort(sort, cx))
        .expect("sorted");
    sheet.update(|table, cx| table.close(cx));
    sheet.take_log();
    sheet.take_events();
    let result = sheet.update(|table, cx| table.set_sort(None, cx));
    assert_eq!(result, Err(SortRefused::new("The table is closed")));
    // `set_columns` without the sorted column clears it, untold.
    let mut renamed = floats(2);
    renamed[0] = column("other", ColumnKind::Float);
    sheet.update(|table, cx| table.set_columns(renamed, cx));
    assert_eq!(sheet.sort(), None);
    assert!(sheet.take_log().is_empty(), "the source wasn't told");
    assert!(sorted(&sheet.take_events()).is_empty());
}

/// A hovered arrow scrolled out of view never hears the pointer leave: it
/// isn't hovered when it comes back.
#[gpui_kit::test]
fn a_hover_goes_with_its_arrow(cx: &mut TestAppContext) {
    let mut sheet = Sheet::open(cx, floats(30), false);
    let (full, dim) = sheet.colors();
    let at = sheet.arrow_at(0);
    sheet.hover(at);
    assert_eq!(sheet.arrow(0).map(|arrow| arrow.color), Some(full));
    sheet.update(|table, cx| table.scroll_by(0.0, 600.0, cx));
    assert!(sheet.arrow(0).is_none());
    // The pointer leaves while the arrow isn't drawn.
    sheet.hover(point(px(700.), px(400.)));
    sheet.update(|table, cx| table.scroll_by(0.0, -600.0, cx));
    assert_eq!(sheet.arrow(0).map(|arrow| arrow.color), Some(dim));
}
