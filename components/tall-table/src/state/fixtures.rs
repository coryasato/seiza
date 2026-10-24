//! The table's fixtures (`fixtures/`; its README says what each holds), run
//! against the table itself. Paging scenarios drive a [`TallTableState`] in
//! GPUI's test app, on its clock, so the settle times are the table's own
//! timers; the delegate answers a page only when the scenario says. Cell text
//! goes through the cells' own formatting ([`shown_text`]). Each fixture has
//! negative controls, which must fail it.

use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use futures::channel::oneshot;
use gpui_kit::component::scroll::Scrollbar;
use gpui_kit::{App, AppContext as _, Bounds, Context, Entity, TestAppContext, point, px, size};
use serde_json::Value;

use super::{Drag, Paging, TallTableState, row_height, shown_text};
use crate::column::{CellKind, ColumnKind, LaidOutColumn, TallTableColumn};
use crate::delegate::{CellValue, PageError, PageLoad, TallTableDelegate, TallTablePage};

/// `paint.json`, with the feature.
#[cfg(feature = "custom-cells")]
mod paint;

const PAGING: &str = include_str!("../../fixtures/paging.json");
const CELLS: &str = include_str!("../../fixtures/cells.json");

// --- paging ---

/// A page with no values: the scenarios watch which pages are read, and
/// its bytes are what the cache's budget counts.
struct Blank(usize);

impl TallTablePage for Blank {
    fn value(&self, _: usize, _: usize) -> Option<CellValue<'_>> {
        None
    }

    fn heap_bytes(&self) -> usize {
        self.0
    }
}

/// A read the scenario hasn't answered yet.
struct Read {
    page: u64,
    request: u32,
    cancelled: bool,
    answer: oneshot::Sender<Result<Blank, PageError>>,
}

/// What the delegate was asked, in order (`load <page>`, `cancel <page>`),
/// and the reads still open.
#[derive(Default)]
struct Reads {
    log: Vec<String>,
    open: Vec<Read>,
    next: u32,
}

/// A delegate whose reads answer only when the scenario says.
struct Script {
    reads: Rc<RefCell<Reads>>,
    page_rows: u64,
    rows: u64,
}

impl TallTableDelegate for Script {
    type Page = Blank;
    type Request = u32;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u32, PageLoad<Blank>) {
        let page = rows.start / self.page_rows;
        let start = page * self.page_rows;
        assert_eq!(
            rows,
            start..(start + self.page_rows).min(self.rows),
            "page {page}'s rows"
        );
        let (answer, answered) = oneshot::channel();
        let mut reads = self.reads.borrow_mut();
        let request = reads.next;
        reads.next += 1;
        reads.log.push(format!("load {page}"));
        reads.open.push(Read {
            page,
            request,
            cancelled: false,
            answer,
        });
        (
            request,
            Box::pin(async move { answered.await.unwrap_or(Err(PageError::Cancelled)) }),
        )
    }

    fn cancel(&mut self, request: u32, _: &mut App) {
        let mut reads = self.reads.borrow_mut();
        let read = reads
            .open
            .iter_mut()
            .find(|read| read.request == request)
            .expect("a cancel names an open read");
        read.cancelled = true;
        let page = read.page;
        reads.log.push(format!("cancel {page}"));
    }
}

/// `Paging`'s fields, as the fixture names them.
const PAGING_FIELDS: [&str; 6] = [
    "page_rows",
    "prefetch",
    "budget_bytes",
    "max_in_flight",
    "scroll_settle_ms",
    "drag_settle_ms",
];

/// `paging` with a fixture's or a control's fields over it. A key it
/// doesn't know is an error: a misspelt control would change nothing.
fn paging_with(mut paging: Paging, fields: &Value) -> Paging {
    for key in fields.as_object().expect("paging fields").keys() {
        assert!(
            PAGING_FIELDS.contains(&key.as_str()),
            "unknown paging field {key}"
        );
    }
    let number = |key: &str| fields.get(key).and_then(Value::as_u64);
    if let Some(value) = number("page_rows") {
        paging.page_rows = value;
    }
    if let Some(value) = number("prefetch") {
        paging.prefetch = value;
    }
    if let Some(value) = number("budget_bytes") {
        paging.budget_bytes = value as usize;
    }
    if let Some(value) = number("max_in_flight") {
        paging.max_in_flight = value as usize;
    }
    if let Some(value) = number("scroll_settle_ms") {
        paging.scroll_settle = Duration::from_millis(value);
    }
    if let Some(value) = number("drag_settle_ms") {
        paging.drag_settle = Duration::from_millis(value);
    }
    paging
}

/// One scenario under `paging`: `Err` names the first step whose requests
/// weren't the expected ones.
fn run_scenario(cx: &mut TestAppContext, paging: Paging, scenario: &Value) -> Result<(), String> {
    let name = scenario["name"].as_str().unwrap_or("?");
    let rows = scenario["rows"].as_u64().expect("rows");
    let viewport_rows = scenario["viewport_rows"].as_f64().expect("viewport_rows");
    let page_bytes = scenario["page_bytes"].as_u64().expect("page_bytes") as usize;
    let reads = Rc::new(RefCell::new(Reads::default()));
    let mut table: Option<Entity<TallTableState<Script>>> = None;

    for (index, step) in scenario["steps"]
        .as_array()
        .expect("steps")
        .iter()
        .enumerate()
    {
        let action = step
            .as_object()
            .and_then(|step| {
                step.keys()
                    .find(|key| !matches!(key.as_str(), "expect" | "why"))
            })
            .cloned()
            .expect("a step has an action");
        let argument = &step[action.as_str()];
        match action.as_str() {
            "open" => {
                let delegate = Script {
                    reads: reads.clone(),
                    page_rows: paging.page_rows,
                    rows,
                };
                let opened = cx.new(|cx| {
                    TallTableState::new(
                        delegate,
                        vec![TallTableColumn::new("value", ColumnKind::Float)],
                        rows,
                        paging,
                        cx,
                    )
                });
                // The body the first frame measures: `viewport_rows` rows
                // above the horizontal scrollbar.
                let bar = f32::from(Scrollbar::width());
                let height = viewport_rows as f32 * f32::from(row_height()) + bar;
                opened.update(cx, |table, cx| {
                    table.set_body(
                        Bounds::new(point(px(0.), px(0.)), size(px(1200.), px(height))),
                        cx,
                    );
                    assert_eq!(
                        table.scroll.viewport_rows(),
                        viewport_rows,
                        "{name}: the viewport"
                    );
                });
                table = Some(opened);
            }
            "scroll" => {
                let delta = argument.as_f64().expect("scroll: rows");
                on_table(cx, &table, |table, cx| table.scroll_by(delta, 0.0, cx));
            }
            "jump" => {
                let row = argument.as_u64().expect("jump: a row");
                on_table(cx, &table, |table, cx| table.jump_to(row, cx));
            }
            "fraction" => {
                let fraction = argument.as_f64().expect("fraction");
                on_table(cx, &table, |table, cx| {
                    table.scroll_to_fraction(fraction, cx)
                });
            }
            // The thumb dragged (or a track pressed) to `fraction`: the
            // drag's own path from there (`drag_to` maps the pointer to a
            // fraction first).
            "drag" => {
                let fraction = argument.as_f64().expect("drag: a fraction");
                on_table(cx, &table, |table, cx| {
                    table.drag.get_or_insert(Drag::Vertical { grab: 0.0 });
                    table.scroll_to_fraction(fraction, cx);
                });
            }
            "release" => on_table(cx, &table, |table, cx| table.end_drag(cx)),
            "wait" => {
                let ms = argument.as_u64().expect("wait: ms");
                cx.executor().advance_clock(Duration::from_millis(ms));
            }
            "answer" | "fail" => {
                let pages: Option<Vec<u64>> = argument.as_array().map(|pages| {
                    pages
                        .iter()
                        .map(|page| page.as_u64().expect("a page"))
                        .collect()
                });
                let fail = action == "fail";
                match pages {
                    Some(pages) => {
                        for page in pages {
                            if !answer(&reads, Some(page), fail, page_bytes) {
                                return Err(format!(
                                    "{name}, step {index}: no read of page {page} is open"
                                ));
                            }
                            cx.run_until_parked();
                        }
                    }
                    // "all": until no read is open, the reads it starts too.
                    None => {
                        while answer(&reads, None, fail, page_bytes) {
                            cx.run_until_parked();
                        }
                    }
                }
            }
            other => panic!("{name}: unknown step {other:?}"),
        }
        cx.run_until_parked();

        let expected: Vec<String> = step["expect"]
            .as_array()
            .expect("a step's expect")
            .iter()
            .map(|event| event.as_str().expect("an event").to_string())
            .collect();
        let actual = normalized(std::mem::take(&mut reads.borrow_mut().log));
        if actual != expected {
            return Err(format!(
                "{name}, step {index} ({action} {argument}): expected {expected:?}, got {actual:?}"
            ));
        }
    }
    Ok(())
}

/// Runs `update` on the open table.
fn on_table(
    cx: &mut TestAppContext,
    table: &Option<Entity<TallTableState<Script>>>,
    update: impl FnOnce(&mut TallTableState<Script>, &mut Context<TallTableState<Script>>),
) {
    let table = table.as_ref().expect("the table is open");
    table.update(cx, update);
}

/// Answers the oldest open read (of `page`, if given): a cancelled read
/// answers `Cancelled`, the rest with a page or a failure. Returns whether
/// there was one.
fn answer(reads: &Rc<RefCell<Reads>>, page: Option<u64>, fail: bool, bytes: usize) -> bool {
    let mut reads = reads.borrow_mut();
    let Some(index) = reads
        .open
        .iter()
        .position(|read| page.is_none_or(|page| read.page == page))
    else {
        return false;
    };
    let read = reads.open.remove(index);
    let result = if read.cancelled {
        Err(PageError::Cancelled)
    } else if fail {
        Err(PageError::Failed {
            message: "the fixture failed it".into(),
            read_failure: false,
        })
    } else {
        Ok(Blank(bytes))
    };
    let _ = read.answer.send(result);
    true
}

/// Cancels from one decision are a set (the table finds them in a hash
/// map): each run of them is put in page order, as the fixture writes it.
fn normalized(mut log: Vec<String>) -> Vec<String> {
    let page = |event: &String| event[7..].parse::<u64>().unwrap_or(u64::MAX);
    let mut start = 0;
    while start < log.len() {
        let end = (start..log.len())
            .find(|&index| !log[index].starts_with("cancel "))
            .unwrap_or(log.len());
        log[start..end].sort_by_key(page);
        start = end + 1;
    }
    log
}

fn paging_fixture() -> (Paging, Value) {
    let fixture: Value = serde_json::from_str(PAGING).expect("paging.json");
    // Every field, so a TS side reading it misses none.
    for key in PAGING_FIELDS {
        assert!(
            fixture["paging"][key].is_u64(),
            "paging.json's paging has no {key}"
        );
    }
    let paging = paging_with(Paging::default(), &fixture["paging"]);
    (paging, fixture)
}

#[gpui_kit::test]
fn paging_scenarios(cx: &mut TestAppContext) {
    let (paging, fixture) = paging_fixture();
    // The fixture pins the defaults: a change to them must change it too.
    assert_eq!(
        paging,
        Paging::default(),
        "paging.json's paging is the table's default"
    );
    let failures: Vec<String> = fixture["scenarios"]
        .as_array()
        .expect("scenarios")
        .iter()
        .filter_map(|scenario| run_scenario(cx, paging, scenario).err())
        .collect();
    assert!(failures.is_empty(), "{failures:#?}");
}

#[gpui_kit::test]
fn paging_controls_fail(cx: &mut TestAppContext) {
    let (paging, fixture) = paging_fixture();
    let scenarios = fixture["scenarios"].as_array().expect("scenarios");
    for control in fixture["controls"].as_array().expect("controls") {
        let changed = paging_with(paging, &control["paging"]);
        assert_ne!(changed, paging, "a control changes the paging: {control}");
        let failed = scenarios
            .iter()
            .filter(|scenario| run_scenario(cx, changed, scenario).is_err())
            .count();
        assert!(
            failed > 0,
            "control {} passed every scenario",
            control["name"]
        );
    }
}

// --- cells ---

/// The fixture's cells whose text `shown` (the column, the value) or `exact`
/// (the value) doesn't give, at each column's pinned budget plus `skew`.
fn cell_mismatches(skew: isize, exact: fn(f64) -> String) -> Vec<String> {
    let fixture: Value = serde_json::from_str(CELLS).expect("cells.json");
    let budgets: Vec<(String, usize)> = fixture["columns"]
        .as_array()
        .expect("columns")
        .iter()
        .map(|column| {
            assert_eq!(column["kind"], "float", "the fixture's columns are floats");
            let budget = column["budget"].as_u64().expect("budget") as isize + skew;
            (
                column["name"].as_str().expect("name").to_string(),
                budget.max(1) as usize,
            )
        })
        .collect();
    let mut mismatches = Vec::new();
    let drawn = fixture["cells"].as_array().expect("cells");
    let rounding = fixture["rounding"].as_array().expect("rounding");
    for cell in drawn.iter().chain(rounding) {
        let name = cell["column"].as_str().expect("column");
        let budget = budgets
            .iter()
            .find(|(column, _)| column == name)
            .map(|(_, budget)| *budget)
            .expect("the cell's column is listed");
        let column = LaidOutColumn {
            name: name.to_string().into(),
            x: 0.0,
            width: 0.0,
            kind: CellKind::Float,
            budget,
        };
        let (value, exact_text) = match cell["value"].as_str() {
            Some(text) => {
                let value: f64 = text.parse().expect("a value");
                (CellValue::Float(value), exact(value))
            }
            None => (CellValue::Null, CellValue::Null.to_string()),
        };
        let shown = shown_text(&column, value);
        if exact_text != cell["exact"] || shown != cell["shown"] {
            mismatches.push(format!(
                "{name} {}: exact {exact_text:?}, shown {shown:?}; the fixture's {} {}",
                cell["value"], cell["exact"], cell["shown"]
            ));
        }
    }
    mismatches
}

/// The table's exact text: a float's shortest round-trip text, as `Debug`
/// writes it ([`CellValue`]'s `Display`).
fn table_exact(value: f64) -> String {
    CellValue::Float(value).to_string()
}

#[test]
fn cell_text() {
    let mismatches = cell_mismatches(0, table_exact);
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}

#[test]
fn cell_controls_fail() {
    // A float's `Display` writes what JS's `toString` writes for these
    // (`15` for 15.0), not the table's text.
    let display = cell_mismatches(0, |value| format!("{value}"));
    assert!(!display.is_empty(), "Display text passed the cell fixture");
    // A character more or less of room rounds differently.
    for skew in [-1, 1] {
        assert!(
            !cell_mismatches(skew, table_exact).is_empty(),
            "a budget {skew:+} passed the cell fixture"
        );
    }
}
