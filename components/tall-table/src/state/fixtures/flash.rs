//! The flash (`live` with `custom-cells`) in a window of GPUI's test app:
//! a re-read's changed cells drawn in their column's flash ramp and faded
//! on GPUI's test clock, read from the cell probe; and `paint.json`'s
//! `flash` section, whose colors and opacities a DOM contender must match.
//! Over a source whose values each test sets, read when a page is asked for.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use futures::channel::oneshot;
use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::{App, Entity, TestAppContext, VisualTestContext, size};
use serde_json::Value;

use super::super::{Paging, TallTableEvent, TallTableState};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageError, PageLoad, TallTableDelegate, TallTablePage};
use crate::flash::Control;
use crate::paint::{Ramp, Stop};
use crate::probe::CellProbe;

const PAINT: &str = include_str!("../../../fixtures/paint.json");
const CHANNEL_STEPS: i16 = 1;

/// A cell's value, owned.
#[derive(Debug, Clone, PartialEq)]
enum Owned {
    Null,
    Float(f64),
    Text(String),
}

impl Owned {
    fn as_value(&self) -> CellValue<'_> {
        match self {
            Self::Null => CellValue::Null,
            Self::Float(value) => CellValue::Float(*value),
            Self::Text(text) => CellValue::Text(text.as_str().into()),
        }
    }
}

type Values = Rc<RefCell<HashMap<(u64, usize), Owned>>>;

/// A page: the source's values for its rows when it was asked for.
struct Page {
    first: u64,
    rows: usize,
    values: HashMap<(u64, usize), Owned>,
}

impl TallTablePage for Page {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        (row < self.rows).then(|| {
            self.values
                .get(&(self.first + row as u64, column))
                .map_or(CellValue::Float(0.0), Owned::as_value)
        })
    }

    fn paint(&self, _: usize, _: usize) -> crate::CellPaint {
        crate::CellPaint::default()
    }

    fn heap_bytes(&self) -> usize {
        1024
    }
}

/// Answers each read at once, or, while `hold` is on, when a test says:
/// with the values as they were when the read was asked for, or, while
/// `read_late` is on, as they are when it answers (as a source that runs
/// its query later does: the bare host with `?delay`, DuckDB's worker).
struct Source {
    values: Values,
    hold: Rc<Cell<bool>>,
    read_late: Rc<Cell<bool>>,
    held: Rc<RefCell<Vec<oneshot::Sender<()>>>>,
    loads: Rc<Cell<usize>>,
}

impl TallTableDelegate for Source {
    type Page = Page;
    type Request = usize;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (usize, PageLoad<Page>) {
        let request = self.loads.get();
        self.loads.set(request + 1);
        let read = move |values: &Values| Page {
            first: rows.start,
            rows: (rows.end - rows.start) as usize,
            values: values
                .borrow()
                .iter()
                .filter(|((row, _), _)| rows.contains(row))
                .map(|(key, value)| (*key, value.clone()))
                .collect(),
        };
        if self.hold.get() {
            let (send, receive) = oneshot::channel();
            self.held.borrow_mut().push(send);
            let values = self.values.clone();
            let asked = (!self.read_late.get()).then(|| read(&values));
            return (
                request,
                Box::pin(async move {
                    receive.await.map_err(|_| PageError::Cancelled)?;
                    Ok(asked.unwrap_or_else(|| read(&values)))
                }),
            );
        }
        (
            request,
            Box::pin(std::future::ready(Ok(read(&self.values)))),
        )
    }

    fn cancel(&mut self, _: usize, _: &mut App) {}
}

/// `ramp`'s stops, by theme token name.
fn token(name: &str) -> Stop {
    match name {
        "chart_bearish" => |theme| theme.chart_bearish,
        "chart_bullish" => |theme| theme.chart_bullish,
        "warning" => |theme| theme.warning,
        other => panic!("the flash names a token the test doesn't know: {other}"),
    }
}

fn fixture() -> Value {
    serde_json::from_str(PAINT).expect("paint.json")
}

/// The fixture's flash ramp.
fn flash_ramp(fixture: &Value) -> Ramp {
    let name = fixture["flash"]["ramp"].as_str().expect("the flash's ramp");
    let stops: Vec<Stop> = fixture["ramps"][name]["stops"]
        .as_array()
        .expect("its stops")
        .iter()
        .map(|stop| token(stop.as_str().expect("a token")))
        .collect();
    Ramp::new(&stops)
}

/// A table over `rows` rows: column 0 a float that flashes, 1 a text that
/// flashes, 2 a float that doesn't. Row 0..~28 visible.
struct Table<'a> {
    cx: &'a mut VisualTestContext,
    table: Entity<TallTableState<Source>>,
    values: Values,
    hold: Rc<Cell<bool>>,
    read_late: Rc<Cell<bool>>,
    held: Rc<RefCell<Vec<oneshot::Sender<()>>>>,
    cells: Rc<RefCell<Vec<CellProbe>>>,
    notified: Rc<Cell<usize>>,
    _subscriptions: (gpui_kit::Subscription, gpui_kit::Subscription),
}

const DURATION: Duration = Duration::from_secs(1);

impl<'a> Table<'a> {
    fn open(
        cx: &'a mut TestAppContext,
        rows: u64,
        ramp: Ramp,
        values: HashMap<(u64, usize), Owned>,
    ) -> Self {
        cx.update(gpui_kit::component::init);
        cx.update(|cx| Theme::change(ThemeMode::Light, None, cx));
        let values: Values = Rc::new(RefCell::new(values));
        let hold = Rc::new(Cell::new(false));
        let read_late = Rc::new(Cell::new(false));
        let held = Rc::default();
        let source = Source {
            values: values.clone(),
            hold: hold.clone(),
            read_late: read_late.clone(),
            held: Rc::clone(&held),
            loads: Rc::default(),
        };
        let (table, cx) = cx.add_window_view(move |_, cx| {
            TallTableState::new(
                source,
                vec![
                    TallTableColumn::new("float", ColumnKind::Float).flash(ramp.clone(), DURATION),
                    TallTableColumn::new("text", ColumnKind::Text).flash(ramp, DURATION),
                    TallTableColumn::new("plain", ColumnKind::Float),
                ],
                rows,
                Paging::default(),
                cx,
            )
            .probe_cells(true)
        });
        cx.simulate_resize(size(gpui_kit::px(1440.), gpui_kit::px(900.)));
        let cells: Rc<RefCell<Vec<CellProbe>>> = Rc::default();
        let seen = cells.clone();
        let notified = Rc::new(Cell::new(0));
        let count = notified.clone();
        let subscriptions = cx.update(|_, cx| {
            (
                cx.subscribe(&table, move |_, event: &TallTableEvent, _| {
                    if let TallTableEvent::Cells(drawn) = event {
                        *seen.borrow_mut() = drawn.clone();
                    }
                }),
                cx.observe(&table, move |_, _| count.set(count.get() + 1)),
            )
        });
        let mut table = Self {
            cx,
            table,
            values,
            hold,
            read_late,
            held,
            cells,
            notified,
            _subscriptions: subscriptions,
        };
        for _ in 0..3 {
            table.draw();
        }
        table
    }

    fn draw(&mut self) {
        self.cx.run_until_parked();
        self.cx.update(|window, cx| window.draw(cx).clear(cx));
    }

    /// Sets the source's values, then says their rows changed, in one update.
    fn change(&mut self, values: &[((u64, usize), Owned)]) {
        let rows: Vec<u64> = values.iter().map(|((row, _), _)| *row).collect();
        self.values.borrow_mut().extend(values.iter().cloned());
        self.table.update(self.cx, |table, cx| {
            for row in rows {
                table.invalidate_rows(row..row + 1, cx);
            }
        });
        self.draw();
    }

    /// Answers the oldest held read.
    fn answer(&mut self) {
        let send = self.held.borrow_mut().remove(0);
        send.send(()).expect("the read is still awaited");
        self.draw();
    }

    fn advance(&mut self, by: Duration) {
        self.cx.executor().advance_clock(by);
        self.draw();
    }

    /// The flash drawn in row `row`, column `column`, as the probe says.
    fn flash(&self, row: u64, column: usize) -> Option<[u8; 4]> {
        self.cells
            .borrow()
            .iter()
            .find(|cell| cell.row == row && cell.column == column)
            .unwrap_or_else(|| panic!("row {row}, column {column} wasn't drawn"))
            .paint
            .flash
    }

    fn live_flashes(&mut self) -> usize {
        self.table.update(self.cx, |table, _| table.flashes.len())
    }

    /// Whether the table keeps asking for frames: the frame it asked for,
    /// if any, is delivered (it redraws), and that frame asks for another.
    fn asks_for_frames(&mut self) -> bool {
        self.cx.update(|window, cx| window.simulate_next_frame(cx));
        self.cx.run_until_parked();
        self.cx.update(|window, cx| window.simulate_next_frame(cx)) > 0
    }

    fn set_control(&mut self, control: Control) {
        self.table
            .update(self.cx, |table, _| table.flashes.control = control);
    }
}

/// The ramp's color at `at` in the light theme, at `alpha`.
fn ramp_color(ramp: &Ramp, at: f32, alpha: u8, cx: &mut VisualTestContext) -> [u8; 4] {
    let ramp = ramp.clone();
    cx.update(|_, cx| {
        let resolved = ramp.resolve(gpui_kit::component::ActiveTheme::theme(cx));
        let mut color = crate::paint::rgba8(resolved.at(at).expect("a color"));
        color[3] = alpha;
        color
    })
}

#[gpui_kit::test]
fn a_reread_flashes_what_changed_and_fades(cx: &mut TestAppContext) {
    let ramp = flash_ramp(&fixture());
    let float = |value: f64| Owned::Float(value);
    let mut t = Table::open(
        cx,
        100,
        ramp.clone(),
        HashMap::from([
            ((0, 0), float(1.0)),
            ((1, 0), float(2.0)),
            ((2, 0), float(1.0)),
            ((3, 0), float(f64::NAN)),
            ((4, 1), Owned::Text("a".into())),
            ((5, 2), float(1.0)),
        ]),
    );
    assert_eq!(t.flash(0, 0), None, "a first read flashes nothing");
    assert!(!t.asks_for_frames());
    t.change(&[
        ((0, 0), float(2.0)),
        ((1, 0), float(1.0)),
        ((2, 0), float(1.0)),
        ((3, 0), float(f64::NAN)),
        ((4, 1), Owned::Text("b".into())),
        ((5, 2), float(2.0)),
    ]);
    let full = |at, cx: &mut VisualTestContext| Some(ramp_color(&ramp, at, 255, cx));
    assert_eq!(t.flash(0, 0), full(1.0, t.cx), "a rise at the ramp's 1");
    assert_eq!(t.flash(1, 0), full(0.0, t.cx), "a fall at 0");
    assert_eq!(t.flash(4, 1), full(0.5, t.cx), "a text change at 0.5");
    assert_eq!(t.flash(2, 0), None, "unchanged");
    assert_eq!(t.flash(3, 0), None, "NaN stayed NaN");
    assert_eq!(t.flash(5, 2), None, "a column without a flash");
    assert_eq!(t.flash(0, 1), None, "an unchanged cell of a changed row");
    assert_eq!(t.live_flashes(), 3, "nothing recorded for the rest");
    assert!(t.asks_for_frames(), "a fading flash asks for frames");

    t.advance(Duration::from_millis(250));
    assert_eq!(
        t.flash(0, 0),
        Some(ramp_color(&ramp, 1.0, 191, t.cx)),
        "faded by opacity"
    );
    assert_eq!(t.flash(1, 0), Some(ramp_color(&ramp, 0.0, 191, t.cx)));
    assert!(t.asks_for_frames());
    t.advance(Duration::from_millis(750));
    assert_eq!(
        (t.flash(0, 0), t.flash(1, 0), t.flash(4, 1)),
        (None, None, None)
    );
    assert_eq!(t.live_flashes(), 0, "each removed as it ends");
    assert!(!t.asks_for_frames(), "no flash, no frames");
}

#[gpui_kit::test]
fn a_row_changed_during_a_read_flashes_when_the_next_lands(cx: &mut TestAppContext) {
    let ramp = flash_ramp(&fixture());
    let float = |value: f64| Owned::Float(value);
    let mut t = Table::open(
        cx,
        100,
        ramp.clone(),
        HashMap::from([((0, 0), float(1.0)), ((1, 0), float(2.0))]),
    );
    t.hold.set(true);
    t.change(&[((0, 0), float(2.0))]);
    // While that read is out: row 1 falls.
    t.change(&[((1, 0), float(1.0))]);
    assert_eq!(t.flash(0, 0), None, "not landed yet");
    t.answer();
    assert_eq!(t.flash(0, 0), Some(ramp_color(&ramp, 1.0, 255, t.cx)));
    assert_eq!(t.flash(1, 0), None, "its read started before row 1 changed");
    // Read once more for row 1, which lands now.
    t.answer();
    assert_eq!(t.flash(1, 0), Some(ramp_color(&ramp, 0.0, 255, t.cx)));
    assert!(t.held.borrow().is_empty());
}

#[gpui_kit::test]
fn a_change_the_landing_read_already_holds_flashes_then(cx: &mut TestAppContext) {
    let ramp = flash_ramp(&fixture());
    let float = |value: f64| Owned::Float(value);
    let mut t = Table::open(
        cx,
        100,
        ramp.clone(),
        HashMap::from([((0, 0), float(1.0)), ((1, 0), float(2.0))]),
    );
    t.hold.set(true);
    t.read_late.set(true);
    t.change(&[((0, 0), float(2.0))]);
    // While that read is out: row 1 falls, and the read, answered later,
    // holds it.
    t.change(&[((1, 0), float(1.0))]);
    t.answer();
    assert_eq!(t.flash(0, 0), Some(ramp_color(&ramp, 1.0, 255, t.cx)));
    assert_eq!(
        t.flash(1, 0),
        Some(ramp_color(&ramp, 0.0, 255, t.cx)),
        "the read already held row 1's change"
    );
    // Read once more for row 1: the same value, so its flash goes on
    // fading, not started again.
    t.advance(Duration::from_millis(500));
    t.answer();
    assert_eq!(t.flash(1, 0), Some(ramp_color(&ramp, 0.0, 128, t.cx)));
    assert!(t.held.borrow().is_empty());
}

#[gpui_kit::test]
fn reduced_motion_holds_the_flash_then_a_timer_clears_it(cx: &mut TestAppContext) {
    let ramp = flash_ramp(&fixture());
    cx.update(|cx| cx.set_reduce_motion(true));
    let mut t = Table::open(
        cx,
        100,
        ramp.clone(),
        HashMap::from([((0, 0), Owned::Float(1.0))]),
    );
    t.change(&[((0, 0), Owned::Float(2.0))]);
    let held = Some(ramp_color(&ramp, 1.0, 255, t.cx));
    assert_eq!(t.flash(0, 0), held);
    assert!(!t.asks_for_frames(), "no frames under reduced motion");
    let notified = t.notified.get();
    t.advance(Duration::from_millis(500));
    assert_eq!(t.flash(0, 0), held, "held, no fade");
    assert!(!t.asks_for_frames());
    assert_eq!(t.notified.get(), notified, "nothing redraws while it holds");
    t.cx.executor().advance_clock(Duration::from_millis(500));
    t.cx.run_until_parked();
    assert!(
        t.notified.get() > notified,
        "the timer redraws when it ends"
    );
    t.draw();
    assert_eq!(t.flash(0, 0), None);
    assert_eq!(t.live_flashes(), 0);
}

/// A fixture value: a number is a float, `"NaN"` a float NaN, `null` NULL,
/// `{"text": …}` text.
fn owned(value: &Value) -> Owned {
    match value {
        Value::Null => Owned::Null,
        Value::String(nan) if nan == "NaN" => Owned::Float(f64::NAN),
        Value::Number(number) => Owned::Float(number.as_f64().expect("a float")),
        Value::Object(text) => Owned::Text(text["text"].as_str().expect("text").into()),
        other => panic!("a flash value: {other}"),
    }
}

fn rgba(value: &Value) -> [u8; 4] {
    let channels = value.as_array().expect("[r, g, b, a]");
    std::array::from_fn(|index| channels[index].as_u64().expect("a channel") as u8)
}

fn close(drawn: Option<[u8; 4]>, expected: Option<[u8; 4]>) -> bool {
    match (drawn, expected) {
        (None, None) => true,
        (Some(drawn), Some(expected)) => drawn
            .iter()
            .zip(expected)
            .all(|(a, b)| (i16::from(*a) - i16::from(b)).abs() <= CHANNEL_STEPS),
        _ => false,
    }
}

/// The fixture's flash cases the table misses under `control`: each case
/// in its own row of column 0, changed together, then drawn at each case's
/// elapsed time in light and dark.
fn flash_mismatches(cx: &mut TestAppContext, control: Control) -> Vec<String> {
    let fixture = fixture();
    let flash = &fixture["flash"];
    assert_eq!(
        flash["duration_ms"].as_u64(),
        Some(DURATION.as_millis() as u64),
        "the table's tests flash for the fixture's duration"
    );
    let cases = flash["cases"].as_array().expect("cases");
    let old = cases
        .iter()
        .enumerate()
        .map(|(row, case)| ((row as u64, 0), owned(&case["old"])))
        .collect();
    let mut t = Table::open(cx, cases.len() as u64, flash_ramp(&fixture), old);
    t.set_control(control);
    let new: Vec<_> = cases
        .iter()
        .enumerate()
        .map(|(row, case)| ((row as u64, 0), owned(&case["new"])))
        .collect();
    t.change(&new);
    let mut order: Vec<(u64, usize)> = cases
        .iter()
        .enumerate()
        .map(|(row, case)| (case["elapsed_ms"].as_u64().expect("elapsed_ms"), row))
        .collect();
    order.sort_unstable();
    let mut now = 0;
    let mut missed = Vec::new();
    for (elapsed, row) in order {
        if elapsed > now {
            t.advance(Duration::from_millis(elapsed - now));
            now = elapsed;
        }
        let case = &cases[row];
        let expected = |mode: &str| match &case["expect"] {
            Value::Null => None,
            expect => Some(rgba(&expect[mode])),
        };
        let light = t.flash(row as u64, 0);
        t.cx.update(|window, cx| Theme::change(ThemeMode::Dark, Some(window), cx));
        t.draw();
        let dark = t.flash(row as u64, 0);
        t.cx.update(|window, cx| Theme::change(ThemeMode::Light, Some(window), cx));
        t.draw();
        if !close(light, expected("light")) || !close(dark, expected("dark")) {
            missed.push(format!(
                "{} → {} at {elapsed} ms ({}): drew {light:?} (light), {dark:?} (dark); expected {:?}",
                case["old"],
                case["new"],
                case["why"].as_str().unwrap_or(""),
                case["expect"]
            ));
        }
    }
    missed
}

#[gpui_kit::test]
fn flash_fixture(cx: &mut TestAppContext) {
    let missed = flash_mismatches(cx, Control::None);
    assert!(missed.is_empty(), "{missed:#?}");
}

#[gpui_kit::test]
fn flash_fade_backwards_fails(cx: &mut TestAppContext) {
    assert!(
        !flash_mismatches(cx, Control::FadeBackwards).is_empty(),
        "a fade run the wrong way passed the fixture"
    );
}

#[gpui_kit::test]
fn flash_fall_as_rise_fails(cx: &mut TestAppContext) {
    assert!(
        !flash_mismatches(cx, Control::FallAsRise).is_empty(),
        "a fall flashed as a rise passed the fixture"
    );
}
