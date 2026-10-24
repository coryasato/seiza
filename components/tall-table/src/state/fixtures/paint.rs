//! `paint.json` (`custom-cells`): a page's paint as the table draws it,
//! read from its cell probe in a window of GPUI's test app, in the light
//! theme and then the dark one with no page read again. The fixture's
//! colors come from Chromium's `color-mix(in oklab, …)`
//! (`just tall-table paint-fixture`), so the table's mixing is checked
//! against the browser's, not against itself.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ops::Range;
use std::rc::Rc;

use gpui_kit::component::{ActiveTheme as _, Theme, ThemeMode};
use gpui_kit::{App, Rgba, TestAppContext, size};
use serde_json::Value;

use super::super::{Paging, TallTableEvent, TallTableState};
use crate::column::{ColumnKind, TallTableColumn};
use crate::delegate::{CellValue, PageError, PageLoad, TallTableDelegate, TallTablePage};
use crate::paint::{Bar, CellPaint, Ramp, Stop};
use crate::probe::{CellProbe, PaintProbe};

const PAINT: &str = include_str!("../../../fixtures/paint.json");

/// The tolerances a drawing must meet, as the fixture's README says: one
/// 8-bit step a channel, and one device pixel at the protocol's DPR 2.
const CHANNEL_STEPS: i16 = 1;
const BAR_PX: f32 = 0.5;

/// The theme tokens the fixture's ramps name.
fn token(name: &str) -> Stop {
    match name {
        "background" => |theme| theme.background,
        "foreground" => |theme| theme.foreground,
        "chart_1" => |theme| theme.chart_1,
        "chart_bullish" => |theme| theme.chart_bullish,
        "chart_bearish" => |theme| theme.chart_bearish,
        other => panic!("paint.json names a token the test doesn't know: {other}"),
    }
}

/// `#rrggbbaa`.
fn hex(text: &str) -> [u8; 4] {
    let digits = text.strip_prefix('#').expect("a #rrggbbaa color");
    assert_eq!(digits.len(), 8, "{text}: #rrggbbaa");
    std::array::from_fn(|index| {
        u8::from_str_radix(&digits[index * 2..index * 2 + 2], 16).expect("hex digits")
    })
}

fn rgba(value: &Value) -> [u8; 4] {
    let channels = value.as_array().expect("[r, g, b, a]");
    std::array::from_fn(|index| channels[index].as_u64().expect("a channel") as u8)
}

fn fixture() -> Value {
    serde_json::from_str(PAINT).expect("paint.json")
}

/// One drawn cell the fixture expects something of.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Expect {
    /// The fill's or the text's color, in light and dark.
    Fill {
        light: [u8; 4],
        dark: [u8; 4],
    },
    Text {
        light: [u8; 4],
        dark: [u8; 4],
    },
    /// The bar's left edge and width (CSS px from the cell's left), or none.
    Bar(Option<(f32, f32)>),
    /// Nothing drawn.
    Nothing,
}

/// The table the fixture draws: a column per ramp and use (fill or text)
/// and per bar zero, each case in its column's next row.
struct Layout {
    columns: Vec<TallTableColumn>,
    paints: HashMap<(usize, usize), CellPaint>,
    cases: Vec<(usize, usize, Expect, String)>,
    rows: u64,
}

fn layout(fixture: &Value) -> Layout {
    let mut columns: Vec<(String, TallTableColumn)> = Vec::new();
    let mut next_row: HashMap<usize, usize> = HashMap::new();
    let mut paints = HashMap::new();
    let mut cases = Vec::new();
    let ramp = |name: &str| {
        let stops: Vec<Stop> = fixture["ramps"][name]["stops"]
            .as_array()
            .unwrap_or_else(|| panic!("paint.json has no ramp {name}"))
            .iter()
            .map(|stop| token(stop.as_str().expect("a token")))
            .collect();
        Ramp::new(&stops)
    };
    let mut column_for = |key: String, make: &dyn Fn() -> TallTableColumn| {
        let index = match columns.iter().position(|(name, _)| *name == key) {
            Some(index) => index,
            None => {
                columns.push((key, make()));
                columns.len() - 1
            }
        };
        let row = next_row.entry(index).or_default();
        *row += 1;
        (index, *row - 1)
    };
    for case in fixture["colors"].as_array().expect("colors") {
        let name = case["ramp"].as_str().expect("ramp");
        let used_as = case["as"].as_str().expect("as");
        let value = case["value"].as_f64().expect("value") as f32;
        let column = TallTableColumn::new(format!("{used_as} {name}"), ColumnKind::Float);
        let (index, row) = column_for(format!("{used_as} {name}"), &|| match used_as {
            "fill" => column.clone().fill(ramp(name)),
            "text" => column.clone().text_ramp(ramp(name)),
            other => panic!("as: {other}"),
        });
        let expect = &case["expect"];
        let (light, dark) = (rgba(&expect["light"]), rgba(&expect["dark"]));
        let (paint, expect) = match used_as {
            "fill" => (
                CellPaint {
                    fill: Some(value),
                    ..CellPaint::default()
                },
                Expect::Fill { light, dark },
            ),
            _ => (
                CellPaint {
                    text: Some(value),
                    ..CellPaint::default()
                },
                Expect::Text { light, dark },
            ),
        };
        paints.insert((row, index), paint);
        cases.push((row, index, expect, format!("{used_as} {name} at {value}")));
    }
    for case in fixture["bars"].as_array().expect("bars") {
        let zero = case["zero"].as_f64().expect("zero") as f32;
        let value = case["value"].as_f64().expect("value") as f32;
        let (index, row) = column_for(format!("bar {zero}"), &|| {
            TallTableColumn::new(format!("bar {zero}"), ColumnKind::Float)
                .bar(Bar::new(|theme| theme.chart_1).zero(zero))
        });
        let expect = match &case["expect"] {
            Value::Null => None,
            expect => Some((
                expect["left"].as_f64().expect("left") as f32,
                expect["width"].as_f64().expect("width") as f32,
            )),
        };
        paints.insert(
            (row, index),
            CellPaint {
                bar: Some(value),
                ..CellPaint::default()
            },
        );
        cases.push((
            row,
            index,
            Expect::Bar(expect),
            format!("bar from {zero} to {value}"),
        ));
    }
    // NaN draws nothing: in the first fill column and the first bar column.
    for case in fixture["none"].as_array().expect("none") {
        let paint = case["paint"].as_str().expect("paint");
        let prefix = if paint == "fill" { "fill " } else { "bar " };
        let index = columns
            .iter()
            .position(|(name, _)| name.starts_with(prefix))
            .expect("a column to draw it in");
        let row = next_row.entry(index).or_default();
        *row += 1;
        let paint_value = match paint {
            "fill" => CellPaint {
                fill: Some(f32::NAN),
                ..CellPaint::default()
            },
            _ => CellPaint {
                bar: Some(f32::NAN),
                ..CellPaint::default()
            },
        };
        paints.insert((*row - 1, index), paint_value);
        cases.push((*row - 1, index, Expect::Nothing, format!("{paint} at NaN")));
    }
    let rows = next_row.values().copied().max().unwrap_or(0) as u64;
    Layout {
        columns: columns.into_iter().map(|(_, column)| column).collect(),
        paints,
        cases,
        rows,
    }
}

/// A page answering the fixture's paint; every value 0.
struct PaintPage(Rc<HashMap<(usize, usize), CellPaint>>);

impl TallTablePage for PaintPage {
    fn value(&self, _: usize, _: usize) -> Option<CellValue<'_>> {
        Some(CellValue::Float(0.0))
    }

    fn paint(&self, row: usize, column: usize) -> CellPaint {
        self.0.get(&(row, column)).copied().unwrap_or_default()
    }

    fn heap_bytes(&self) -> usize {
        0
    }
}

struct PaintRows {
    paints: Rc<HashMap<(usize, usize), CellPaint>>,
    loads: Rc<Cell<usize>>,
}

impl TallTableDelegate for PaintRows {
    type Page = PaintPage;
    type Request = ();

    fn load_page(&mut self, _: Range<u64>, _: &mut App) -> ((), PageLoad<PaintPage>) {
        self.loads.set(self.loads.get() + 1);
        let page = PaintPage(self.paints.clone());
        ((), Box::pin(async move { Ok::<_, PageError>(page) }))
    }

    fn cancel(&mut self, _: (), _: &mut App) {}
}

/// What the table drew in the light theme and then the dark one, and the
/// page reads it made in all.
struct Drawn {
    light: Vec<CellProbe>,
    dark: Vec<CellProbe>,
    loads_light: usize,
    loads_dark: usize,
}

fn draw(cx: &mut TestAppContext, layout: &Layout) -> Drawn {
    cx.update(gpui_kit::component::init);
    let loads = Rc::new(Cell::new(0));
    let paints = Rc::new(layout.paints.clone());
    let (columns, rows) = (layout.columns.clone(), layout.rows);
    let delegate_loads = loads.clone();
    let (table, cx) = cx.add_window_view(move |_, cx| {
        TallTableState::new(
            PaintRows {
                paints,
                loads: delegate_loads,
            },
            columns,
            rows,
            Paging::default(),
            cx,
        )
        .probe_cells(true)
    });
    cx.simulate_resize(size(gpui_kit::px(1440.), gpui_kit::px(900.)));
    let cells: Rc<RefCell<Vec<CellProbe>>> = Rc::default();
    let seen = cells.clone();
    let _subscription = cx.update(|_, cx| {
        cx.subscribe(&table, move |_, event: &TallTableEvent, _| {
            if let TallTableEvent::Cells(drawn) = event {
                *seen.borrow_mut() = drawn.clone();
            }
        })
    });
    let settle = |cx: &mut gpui_kit::VisualTestContext| {
        for _ in 0..4 {
            cx.run_until_parked();
            cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    };
    cx.update(|window, cx| Theme::change(ThemeMode::Light, Some(window), cx));
    settle(cx);
    let light = cells.borrow().clone();
    let loads_light = loads.get();
    cx.update(|window, cx| Theme::change(ThemeMode::Dark, Some(window), cx));
    settle(cx);
    let dark = cells.borrow().clone();
    Drawn {
        light,
        dark,
        loads_light,
        loads_dark: loads.get(),
    }
}

fn close_color(drawn: Option<[u8; 4]>, expected: [u8; 4], skew: i16) -> bool {
    drawn.is_some_and(|drawn| {
        drawn
            .iter()
            .zip(expected)
            .enumerate()
            .all(|(index, (a, b))| {
                let (a, b) = (i16::from(*a), i16::from(b));
                // The skew moves red away from what was drawn (so a drawing
                // already a step off can't land within reach of it), down
                // where up would leave the 8 bits.
                let b = b + if index == 0 {
                    let down = a > b || (a == b && b > 127);
                    if down { -skew } else { skew }
                } else {
                    0
                };
                (a - b).abs() <= CHANNEL_STEPS
            })
    })
}

/// The cases `drawn` misses, with each expected color moved `skew` steps
/// and each bar `bar_skew` px.
fn mismatches(layout: &Layout, drawn: &Drawn, skew: i16, bar_skew: f32) -> Vec<String> {
    let find = |cells: &[CellProbe], row: usize, column: usize| -> PaintProbe {
        cells
            .iter()
            .find(|cell| cell.row == row as u64 && cell.column == column)
            .unwrap_or_else(|| panic!("row {row}, column {column} wasn't drawn"))
            .paint
            .clone()
    };
    let mut out = Vec::new();
    for (row, column, expect, name) in &layout.cases {
        let (light, dark) = (
            find(&drawn.light, *row, *column),
            find(&drawn.dark, *row, *column),
        );
        let ok = match *expect {
            Expect::Fill {
                light: want_light,
                dark: want_dark,
            } => {
                close_color(light.fill, want_light, skew) && close_color(dark.fill, want_dark, skew)
            }
            Expect::Text {
                light: want_light,
                dark: want_dark,
            } => {
                close_color(light.text, want_light, skew) && close_color(dark.text, want_dark, skew)
            }
            Expect::Bar(want) => [light.bar, dark.bar].iter().all(|bar| match (bar, want) {
                (None, None) => true,
                (Some((left, width)), Some((want_left, want_width))) => {
                    (left - (want_left + bar_skew)).abs() <= BAR_PX
                        && (width - want_width).abs() <= BAR_PX
                }
                _ => false,
            }),
            Expect::Nothing => light == PaintProbe::default() && dark == PaintProbe::default(),
        };
        if !ok {
            out.push(format!(
                "{name}: drew {light:?} (light), {dark:?} (dark); expected {expect:?}"
            ));
        }
    }
    out
}

#[gpui_kit::test]
fn paint_fixture(cx: &mut TestAppContext) {
    let fixture = fixture();
    let layout = layout(&fixture);
    let drawn = draw(cx, &layout);
    assert!(drawn.loads_light > 0, "the table read its page");
    // A theme switch recolors every paint on its frame, with no page read.
    assert_eq!(
        drawn.loads_dark, drawn.loads_light,
        "the theme switch read a page"
    );
    assert_ne!(
        drawn
            .light
            .iter()
            .map(|cell| &cell.paint)
            .collect::<Vec<_>>(),
        drawn
            .dark
            .iter()
            .map(|cell| &cell.paint)
            .collect::<Vec<_>>(),
        "the theme switch changed no paint"
    );
    let missed = mismatches(&layout, &drawn, 0, 0.0);
    assert!(missed.is_empty(), "{missed:#?}");
}

#[gpui_kit::test]
fn paint_fixture_stops_are_the_theme(cx: &mut TestAppContext) {
    cx.update(gpui_kit::component::init);
    let fixture = fixture();
    for (mode, key) in [(ThemeMode::Light, "light"), (ThemeMode::Dark, "dark")] {
        cx.update(|cx| Theme::change(mode, None, cx));
        for (name, ramp) in fixture["ramps"].as_object().expect("ramps") {
            let stops = ramp["stops"].as_array().expect("stops");
            let pinned = ramp[key].as_array().expect("the mode's stops");
            assert_eq!(stops.len(), pinned.len(), "{name}'s {key} stops");
            for (stop, pinned) in stops.iter().zip(pinned) {
                let token_name = stop.as_str().expect("a token");
                let resolved =
                    cx.update(|cx| crate::paint::rgba8(Rgba::from(token(token_name)(cx.theme()))));
                assert_eq!(
                    resolved,
                    hex(pinned.as_str().expect("#rrggbbaa")),
                    "{name}'s {token_name} in {key}: the theme's is {resolved:02x?}"
                );
            }
        }
    }
}

/// A ramp mixed in sRGB, the control: its middle values differ from
/// Oklab's.
fn srgb_mismatches(fixture: &Value) -> usize {
    let mut missed = 0;
    for case in fixture["colors"].as_array().expect("colors") {
        let ramp = &fixture["ramps"][case["ramp"].as_str().expect("ramp")];
        let value = (case["value"].as_f64().expect("value") as f32).clamp(0.0, 1.0);
        for key in ["light", "dark"] {
            let stops: Vec<[u8; 4]> = ramp[key]
                .as_array()
                .expect("stops")
                .iter()
                .map(|stop| hex(stop.as_str().expect("#rrggbbaa")))
                .collect();
            let along = value * (stops.len() - 1) as f32;
            let index = (along.floor() as usize).min(stops.len() - 2);
            let t = along - index as f32;
            let mixed: [u8; 4] = std::array::from_fn(|channel| {
                let (from, to) = (
                    f32::from(stops[index][channel]),
                    f32::from(stops[index + 1][channel]),
                );
                (from + (to - from) * t).round() as u8
            });
            if !close_color(Some(mixed), rgba(&case["expect"][key]), 0) {
                missed += 1;
            }
        }
    }
    missed
}

#[gpui_kit::test]
fn paint_controls_fail(cx: &mut TestAppContext) {
    let fixture = fixture();
    let layout = layout(&fixture);
    let drawn = draw(cx, &layout);
    let colors = layout
        .cases
        .iter()
        .filter(|(_, _, expect, _)| matches!(expect, Expect::Fill { .. } | Expect::Text { .. }))
        .count();
    let bars = layout
        .cases
        .iter()
        .filter(|(_, _, expect, _)| matches!(expect, Expect::Bar(Some(_))))
        .count();
    // Every color two steps off fails, and every bar 2 device pixels off.
    assert_eq!(
        mismatches(&layout, &drawn, 2, 0.0).len(),
        colors,
        "a color two steps off passed"
    );
    assert_eq!(
        mismatches(&layout, &drawn, 0, 1.0).len(),
        bars,
        "a bar 2 device pixels off passed"
    );
    assert!(
        srgb_mismatches(&fixture) > 0,
        "the ramps mixed in sRGB passed the fixture"
    );
}
