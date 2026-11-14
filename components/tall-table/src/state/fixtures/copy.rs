//! `copy`: `fixtures/copy.json`'s cases and their controls, run through the
//! element (Cmd+C through its keys' contexts) and the host's `copy` in a
//! window of GPUI's test app, over the fixture's sources answered at once.
//! Only the first page is loaded when a case copies (no prefetch, a short
//! view), so a copy past it reads the rest itself.

use std::borrow::Cow;
use std::cell::RefCell;
use std::ops::{Range, RangeInclusive};
use std::rc::Rc;

use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::{
    App, AppContext as _, Context, Entity, IntoElement, ParentElement as _, Render, Styled as _,
    TestAppContext, VisualTestContext, Window, div, px, size,
};
use serde_json::{Value, json};

use super::super::copy::Control;
use super::super::{Paging, TallTableEvent, TallTableState, row_height};
use crate::column::{ColumnKind, TallTableColumn};
use crate::copy::{CopyFailure, CopyOptions, TallTableCopy};
use crate::delegate::{CellValue, PageLoad, TallTableDelegate, TallTablePage};
use crate::pages::Sent;
use crate::selection::{Kind, TallTableSelection};
use crate::tall_table::TallTable;

const COPY: &str = include_str!("../../../fixtures/copy.json");

/// A source's value, typed by its column's kind.
enum Field {
    Null,
    Float(f64),
    Float32(f32),
    Text(String),
}

/// A source's columns and its rows of values.
struct Source {
    columns: Vec<TallTableColumn>,
    rows: Vec<Vec<Field>>,
}

impl Source {
    fn of(fixture: &Value) -> Self {
        let kinds: Vec<&str> = fixture["columns"]
            .as_array()
            .expect("columns")
            .iter()
            .map(|column| column["kind"].as_str().expect("a kind"))
            .collect();
        let columns = fixture["columns"]
            .as_array()
            .expect("columns")
            .iter()
            .zip(&kinds)
            .map(|(column, kind)| {
                let kind = match *kind {
                    "float" | "float32" => ColumnKind::Float,
                    "integer" => ColumnKind::Integer { max_chars: 20 },
                    "decimal" => ColumnKind::Decimal,
                    "text" => ColumnKind::Text,
                    other => panic!("no column kind {other}"),
                };
                TallTableColumn::new(column["name"].as_str().expect("a name").to_owned(), kind)
            })
            .collect();
        let rows = fixture["rows"]
            .as_array()
            .expect("rows")
            .iter()
            .map(|row| {
                row.as_array()
                    .expect("a row")
                    .iter()
                    .zip(&kinds)
                    .map(|(value, kind)| match (value.as_str(), *kind) {
                        (None, _) => Field::Null,
                        (Some(text), "float") => {
                            Field::Float(text.parse().expect("a float's text"))
                        }
                        // Through f64 and rounded to f32, as a DOM side
                        // parses it (`Number`, then `Math.fround`).
                        (Some(text), "float32") => {
                            Field::Float32(text.parse::<f64>().expect("a float32's text") as f32)
                        }
                        (Some(text), _) => Field::Text(text.to_owned()),
                    })
                    .collect()
            })
            .collect();
        Self { columns, rows }
    }
}

struct Rows {
    source: Rc<Source>,
    rows: Range<u64>,
}

impl TallTablePage for Rows {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        let row = self.rows.start + row as u64;
        if row >= self.rows.end {
            return None;
        }
        Some(match &self.source.rows[row as usize][column] {
            Field::Null => CellValue::Null,
            Field::Float(value) => CellValue::Float(*value),
            Field::Float32(value) => CellValue::Float32(*value),
            Field::Text(text) => CellValue::Text(Cow::Borrowed(text)),
        })
    }

    fn heap_bytes(&self) -> usize {
        1024
    }
}

/// The source's rows, each read answered at once and its request kept
/// (the cache says which were the copy's).
struct Memory {
    source: Rc<Source>,
    requests: Rc<RefCell<Vec<u64>>>,
    next: u64,
}

impl TallTableDelegate for Memory {
    type Page = Rows;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Rows>) {
        self.next += 1;
        self.requests.borrow_mut().push(self.next);
        let page = Rows {
            source: self.source.clone(),
            rows,
        };
        (self.next, Box::pin(std::future::ready(Ok(page))))
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}
}

struct Shell {
    table: Entity<TallTableState<Memory>>,
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(TallTable::new(&self.table))
    }
}

/// The fixture's `options`, with a case's fields in place of its own.
fn options_of(defaults: &Value, case: &Value) -> CopyOptions {
    let field = |name: &str| case.get(name).unwrap_or(&defaults[name]);
    CopyOptions::default()
        .max_bytes(field("max_bytes").as_u64().expect("max_bytes") as usize)
        .key_max_cells(field("key_max_cells").as_u64().expect("key_max_cells"))
        .headers(field("headers").as_bool().expect("headers"))
}

fn selection_of(selection: &Value) -> TallTableSelection {
    let name = selection["kind"].as_str().expect("a kind");
    let kind = Kind::parse(name).unwrap_or_else(|| panic!("no selection kind {name}"));
    let cell = |name: &str| {
        let cell = selection[name].as_array().expect("a cell");
        (
            cell[0].as_u64().expect("a row"),
            cell[1].as_u64().expect("a column") as usize,
        )
    };
    TallTableSelection::new(kind, cell("anchor"), cell("head"))
}

fn range<T: Copy + Into<Value>>(range: &RangeInclusive<T>) -> Value {
    json!([(*range.start()).into(), (*range.end()).into()])
}

/// What a case's copy gave, in the shape of its `expect`: every field, so
/// a caller compares those the case names.
fn run_case(
    cx: &mut TestAppContext,
    fixture: &Value,
    case: &Value,
    control: Control,
) -> serde_json::Map<String, Value> {
    let source = Rc::new(Source::of(
        &fixture["sources"][case["source"].as_str().expect("a source")],
    ));
    let paging = Paging {
        page_rows: fixture["paging"]["page_rows"].as_u64().expect("page_rows"),
        prefetch: fixture["paging"]["prefetch"].as_u64().expect("prefetch"),
        ..Paging::default()
    };
    let options = options_of(&fixture["options"], &case["options"]);
    let requests: Rc<RefCell<Vec<u64>>> = Rc::default();
    let (rows, columns) = (source.rows.len() as u64, source.columns.clone());
    let delegate = Memory {
        source: source.clone(),
        requests: requests.clone(),
        next: 0,
    };
    let (shell, cx): (_, &mut VisualTestContext) = cx.add_window_view(move |_, cx| {
        let table = cx.new(|cx| {
            // No rows until the window has its size: its first draw, at the
            // default size, would read every page.
            let mut table = TallTableState::new(delegate, columns, 0, paging, cx);
            table.set_copy_options(options);
            table.copy_state.control = control;
            table
        });
        Shell { table }
    });
    let table = shell.read_with(cx, |shell, _| shell.table.clone());
    let (gutter, bar) = table.read_with(cx, |table, _| {
        (table.gutter_width(), f32::from(Scrollbar::width()))
    });
    let row_h = f32::from(row_height());
    let viewport_rows = fixture["viewport_rows"].as_f64().expect("viewport_rows") as f32;
    cx.simulate_resize(size(
        px(1200.0 + gutter + bar + 2.0),
        px(viewport_rows * row_h + row_h + bar + 2.0),
    ));
    let events: Rc<RefCell<Vec<TallTableCopy>>> = Rc::default();
    let _subscription = cx.update(|_, cx| {
        let events = events.clone();
        cx.subscribe(&table, move |_, event: &TallTableEvent, _| {
            if let TallTableEvent::Copy(copy) = event {
                events.borrow_mut().push(copy.clone());
            }
        })
    });
    let draw = |cx: &mut VisualTestContext| {
        for _ in 0..2 {
            cx.run_until_parked();
            cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    };
    draw(cx);
    table.update(cx, |table, cx| table.set_rows(rows, cx));
    draw(cx);
    let handle = table.read_with(cx, |table, _| table.focus_handle.clone());
    cx.update(|window, cx| window.focus(&handle, cx));
    let selection = selection_of(&case["selection"]);
    table.update(cx, |table, cx| table.select(Some(selection), cx));
    draw(cx);
    assert_eq!(
        requests.borrow().len(),
        1,
        "only the first page is read at open"
    );
    requests.borrow_mut().clear();
    match case["by"].as_str().expect("by") {
        "key" => cx.simulate_keystrokes("cmd-c"),
        "copy" => {
            table.update(cx, |table, cx| table.copy(cx));
        }
        other => panic!("no way to copy {other}"),
    }
    draw(cx);
    assert!(
        table.read_with(cx, |table, _| table.copying().is_none()),
        "the copy ended"
    );

    let mut got = serde_json::Map::new();
    let mut text = String::new();
    let events = events.borrow();
    for (index, event) in events.iter().enumerate() {
        let last = index + 1 == events.len();
        match event {
            TallTableCopy::Started { rows, columns, .. } => {
                assert_eq!(index, 0, "Started comes first");
                got.insert(
                    "started".into(),
                    json!({"rows": range(rows), "columns": range(columns)}),
                );
            }
            TallTableCopy::Text { text: piece, .. } => text.push_str(piece),
            TallTableCopy::Declined { rows, columns } => {
                assert!(last && index == 0, "Declined is the only event");
                got.insert(
                    "outcome".into(),
                    json!({"declined": {"rows": rows, "columns": columns}}),
                );
            }
            TallTableCopy::Copied { rows, bytes, .. } => {
                assert!(last, "Copied is the last event");
                got.insert(
                    "outcome".into(),
                    json!({"copied": {"rows": rows, "bytes": bytes}}),
                );
                got.insert("text".into(), json!(text));
            }
            TallTableCopy::Failed { reason, .. } => {
                assert!(last, "Failed is the last event");
                let CopyFailure::TooLarge { bytes, max_bytes } = reason else {
                    panic!("a fixture's copy fails only for its size: {reason:?}");
                };
                got.insert(
                    "outcome".into(),
                    json!({"too_large": {"bytes": bytes, "max_bytes": max_bytes}}),
                );
            }
        }
    }
    drop(events);
    // A read sent for the copy; the cache sends none of its own here (no
    // prefetch, and the view holds still), and a copy mustn't make it.
    let sent: Vec<Option<Sent>> = table.read_with(cx, |table, _| {
        requests
            .borrow()
            .iter()
            .map(|&request| table.cache.sent_as(request))
            .collect()
    });
    assert!(
        sent.iter().all(|sent| *sent == Some(Sent::Copy)),
        "every read during the copy is the copy's: {sent:?}"
    );
    let copy_read = !sent.is_empty();
    got.insert("reads".into(), json!(copy_read));
    cx.update(|window, _| window.remove_window());
    cx.run_until_parked();
    got
}

/// The test app's components and the table's keys, once a test.
fn init(cx: &mut TestAppContext) {
    cx.update(|cx| {
        gpui_kit::component::init(cx);
        crate::init(cx);
    });
}

/// Each case whose copy gave other than its `expect`, with what it gave.
fn copy_mismatches(cx: &mut TestAppContext, control: Control) -> Vec<String> {
    let fixture: Value = serde_json::from_str(COPY).expect("copy.json");
    let mut mismatches = Vec::new();
    for case in fixture["cases"].as_array().expect("cases") {
        let name = case["name"].as_str().expect("a name");
        let expect = case["expect"].as_object().expect("expect");
        let got = run_case(cx, &fixture, case, control);
        for (field, expected) in expect {
            let got = got.get(field).unwrap_or(&Value::Null);
            if got != expected {
                mismatches.push(format!("{name}: {field} {got} (expected {expected})"));
            }
        }
        if !expect.contains_key("started") && got.contains_key("started") {
            mismatches.push(format!("{name}: started, where it declines"));
        }
    }
    mismatches
}

fn control_of(name: &str) -> Control {
    match name {
        "null-as-text" => Control::NullAsText,
        "no-quoting" => Control::NoQuoting,
        "key-limit-off-by-one" => Control::KeyLimitOffByOne,
        "whole-floats-bare" => Control::WholeFloatsBare,
        "trailing-break" => Control::TrailingBreak,
        "utf16-bytes" => Control::Utf16Bytes,
        other => panic!("no copy control {other}"),
    }
}

#[gpui_kit::test]
fn copy_fixture(cx: &mut TestAppContext) {
    init(cx);
    let mismatches = copy_mismatches(cx, Control::None);
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

#[gpui_kit::test]
fn copy_controls_fail(cx: &mut TestAppContext) {
    init(cx);
    let fixture: Value = serde_json::from_str(COPY).expect("copy.json");
    for control in fixture["controls"].as_array().expect("controls") {
        let name = control["name"].as_str().expect("a control's name");
        let mismatches = copy_mismatches(cx, control_of(name));
        assert!(
            !mismatches.is_empty(),
            "the control {name} passed the copy fixture"
        );
        // The cases it's there to catch: each must be among them.
        for case in control["fails"].as_array().expect("fails") {
            let case = case.as_str().expect("a case");
            assert!(
                mismatches
                    .iter()
                    .any(|mismatch| mismatch.starts_with(&format!("{case}: "))),
                "the control {name} passed {case}: {mismatches:#?}"
            );
        }
    }
}

#[test]
fn copy_fixture_options_are_the_defaults() {
    let fixture: Value = serde_json::from_str(COPY).expect("copy.json");
    assert_eq!(
        options_of(&fixture["options"], &Value::Null),
        CopyOptions::default(),
        "copy.json's options are CopyOptions::default()"
    );
}
