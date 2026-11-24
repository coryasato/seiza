//! The controller and its view state: what the table shows of the open
//! file, as one value every driver produces (the research, "The
//! controller"; `docs/DECISIONS.md`, "Scope", 2026-11-17).
//!
//! [`ViewState`] is the serializable form: the source (its kind, name, and
//! rows; never a URL or the data), the columns in the order drawn, each
//! with its type, its width where it differs from its kind's, and its
//! format where it has one, and how many are pinned. A [`Controller`] holds
//! it by the table's column indices, so a move or a name the file repeats
//! stays exact: [`Controller::calls`] compiles it to calls on the table,
//! and [`Controller::take`] takes what the table owns and reports (widths,
//! order, pins) from its events. A state naming a column the file doesn't
//! have is refused whole ([`Controller::new`]), never applied in part
//! (`docs/DECISIONS.md`, "Scope", 2026-11-21, "A link to a view of a
//! dropped file").
//!
//! Until the command bar, the table's events are its one driver, and
//! `globalThis.__tychoView` publishes it read-only (`docs/DECISIONS.md`,
//! "Scope", 2026-11-23).

use std::fmt;

use gpui_kit::{Context, px};
use seiza_duckdb::sql::ColumnInfo;
use seiza_tall_table::{
    ColumnKind, NumberFormat, Sign, TallTableColumn, TallTableDelegate, TallTableEvent,
    TallTableState,
};
use serde::{Deserialize, Serialize};

/// A view of a file, as it's written down: what a probe publishes, and what
/// a link or a kept view will hold.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewState {
    pub source: SourceView,
    /// Every column, in the order drawn.
    pub columns: Vec<ColumnView>,
    /// The first `pinned` columns drawn are pinned: the count asked for,
    /// which the table pins fewer of while they'd take more than half its
    /// width.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub pinned: usize,
}

/// Where the rows come from: never a URL or the data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceView {
    pub kind: SourceKind,
    /// The file's name, as the visitor's device or the sample named it.
    pub name: String,
    pub rows: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    /// Tycho's own sample, a Parquet file.
    Sample,
    /// A Parquet file from the visitor's device.
    Parquet,
    /// A CSV file from the visitor's device.
    Csv,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColumnView {
    pub name: String,
    /// DuckDB's type name (`BIGINT`, `VARCHAR`, `DECIMAL(18,3)`).
    #[serde(rename = "type")]
    pub data_type: String,
    /// CSS px; none while it's its kind's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f32>,
    /// How its numbers are written; none for the automatic. A number
    /// column's only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<Format>,
}

/// A number column's format (the table's `NumberFormat`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Format {
    /// A float's fixed decimals; none for its exact text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decimals: Option<u8>,
    /// A `+` on a positive, as well as a `-` on a negative.
    #[serde(default, skip_serializing_if = "is_false")]
    pub always_sign: bool,
    /// A `,` every three whole digits.
    #[serde(default, skip_serializing_if = "is_false")]
    pub grouping: bool,
    /// Text after the number (`%`), which scales nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
}

fn is_zero(count: &usize) -> bool {
    *count == 0
}

fn is_false(on: &bool) -> bool {
    !on
}

impl Format {
    fn number_format(&self) -> NumberFormat {
        let mut format = NumberFormat::new()
            .grouping(self.grouping)
            .sign(if self.always_sign {
                Sign::Always
            } else {
                Sign::Negative
            });
        if let Some(decimals) = self.decimals {
            format = format.decimals(decimals);
        }
        if let Some(suffix) = &self.suffix {
            format = format.suffix(suffix.clone());
        }
        format
    }
}

/// Why a view wasn't applied: nothing of it was.
#[derive(Debug, Clone, PartialEq)]
pub enum Refused {
    /// Columns the view names that the file doesn't have.
    Missing(Vec<String>),
    /// A column the view names more times than the file has it.
    Repeated(String),
    /// More pinned than the file has columns.
    Pinned { pinned: usize, columns: usize },
    /// A width that isn't a positive length.
    Width { column: String },
    /// A format on a column that holds no numbers.
    Format { column: String, data_type: String },
}

impl fmt::Display for Refused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(names) => {
                let s = if names.len() == 1 { "" } else { "s" };
                write!(
                    f,
                    "the view needs the column{s} {}, which this file doesn't have",
                    names.join(", ")
                )
            }
            Self::Repeated(name) => {
                write!(f, "the view names {name} more times than the file has it")
            }
            Self::Pinned { pinned, columns } => {
                write!(
                    f,
                    "the view pins {pinned} columns, and the file has {columns}"
                )
            }
            Self::Width { column } => write!(f, "the view's width for {column} isn't a length"),
            Self::Format { column, data_type } => write!(
                f,
                "the view formats {column} as a number, and it's a {data_type}"
            ),
        }
    }
}

/// The calls that give a table the view: its columns (in the file's order,
/// each with its width and format), then the order drawn, then the count
/// pinned.
#[derive(Debug, Clone, PartialEq)]
pub struct TableCalls {
    pub columns: Vec<TallTableColumn>,
    /// `order[place]` is the index drawn there.
    pub order: Vec<usize>,
    pub pinned: usize,
}

impl TableCalls {
    /// Gives `table` the view: after `set_columns`, which resets the order
    /// and keeps the count as places, the order and the count again.
    pub fn apply<D: TallTableDelegate>(
        self,
        table: &mut TallTableState<D>,
        cx: &mut Context<TallTableState<D>>,
    ) {
        table.set_columns(self.columns, cx);
        table.set_order(self.order, cx);
        table.set_pinned(self.pinned, cx);
    }
}

/// The view of the open file, held by the table's column indices: the
/// file's columns are the table's, in the same order.
#[derive(Debug, Clone, PartialEq)]
pub struct Controller {
    source: SourceView,
    file: Vec<ColumnInfo>,
    /// `order[place]` is the file's column drawn there.
    order: Vec<usize>,
    /// By the file's column.
    widths: Vec<Option<f32>>,
    formats: Vec<Option<Format>>,
    pinned: usize,
}

impl Controller {
    /// The file's own view: its columns in its order, at their kinds'
    /// widths, the automatic formats, nothing pinned.
    pub fn of_file(source: SourceView, file: &[ColumnInfo]) -> Self {
        Self {
            source,
            file: file.to_vec(),
            order: (0..file.len()).collect(),
            widths: vec![None; file.len()],
            formats: vec![None; file.len()],
            pinned: 0,
        }
    }

    /// `view` over `file`'s columns, or why not. Its columns are found by
    /// name, whatever the file's order; the file's columns it doesn't name
    /// are drawn after them, in the file's order. The file's types are
    /// taken over the view's (a CSV widened since, a file exported again),
    /// and its source is the view's. Every column the file doesn't have is
    /// named before anything else is checked.
    pub fn new(view: &ViewState, file: &[ColumnInfo]) -> Result<Self, Refused> {
        let mut used = vec![false; file.len()];
        let mut order = Vec::with_capacity(file.len());
        let mut missing: Vec<String> = Vec::new();
        let mut repeated = None;
        for column in &view.columns {
            match (0..file.len()).find(|&index| !used[index] && file[index].name == column.name) {
                Some(index) => {
                    used[index] = true;
                    order.push(index);
                }
                None if file.iter().any(|info| info.name == column.name) => {
                    repeated.get_or_insert_with(|| column.name.clone());
                }
                None if !missing.contains(&column.name) => missing.push(column.name.clone()),
                None => {}
            }
        }
        if !missing.is_empty() {
            return Err(Refused::Missing(missing));
        }
        if let Some(name) = repeated {
            return Err(Refused::Repeated(name));
        }
        let mut widths = vec![None; file.len()];
        let mut formats = vec![None; file.len()];
        for (column, &index) in view.columns.iter().zip(&order) {
            if let Some(width) = column.width {
                if !(width.is_finite() && width > 0.0) {
                    return Err(Refused::Width {
                        column: column.name.clone(),
                    });
                }
                widths[index] = Some(width);
            }
            if let Some(format) = &column.format {
                if !holds_numbers(&file[index]) {
                    return Err(Refused::Format {
                        column: column.name.clone(),
                        data_type: file[index].data_type.clone(),
                    });
                }
                formats[index] = Some(format.clone());
            }
        }
        if view.pinned > file.len() {
            return Err(Refused::Pinned {
                pinned: view.pinned,
                columns: file.len(),
            });
        }
        order.extend((0..file.len()).filter(|&index| !used[index]));
        Ok(Self {
            source: view.source.clone(),
            file: file.to_vec(),
            order,
            widths,
            formats,
            pinned: view.pinned,
        })
    }

    /// The view as it's written down.
    pub fn view(&self) -> ViewState {
        ViewState {
            source: self.source.clone(),
            columns: self
                .order
                .iter()
                .map(|&index| ColumnView {
                    name: self.file[index].name.clone(),
                    data_type: self.file[index].data_type.clone(),
                    width: self.widths[index],
                    format: self.formats[index].clone(),
                })
                .collect(),
            pinned: self.pinned,
        }
    }

    /// The calls that give a table the view.
    pub fn calls(&self) -> TableCalls {
        TableCalls {
            columns: self
                .file
                .iter()
                .enumerate()
                .map(|(index, info)| {
                    let mut column = info.tall_table_column();
                    if let Some(width) = self.widths[index] {
                        column = column.width(px(width));
                    }
                    if let Some(format) = &self.formats[index] {
                        column = column.format(format.number_format());
                    }
                    column
                })
                .collect(),
            order: self.order.clone(),
            pinned: self.pinned,
        }
    }

    /// What the table reported, taken into the view: a width (`resize`),
    /// the order and the count after a move (`reorder`), or the count after
    /// a pin (`pin`: the event carries the run in effect, so the count is
    /// the table's, `pinned`). Whether the view changed.
    pub fn take(&mut self, event: &TallTableEvent, pinned: usize) -> bool {
        match event {
            TallTableEvent::ColumnWidthsChanged(widths) if widths.len() == self.file.len() => {
                let widths: Vec<_> = widths.iter().map(|width| width.map(f32::from)).collect();
                let changed = widths != self.widths;
                self.widths = widths;
                changed
            }
            TallTableEvent::ColumnsMoved {
                order,
                pinned: count,
                ..
            } if order.len() == self.file.len() => {
                let changed = *order != self.order || *count != self.pinned;
                self.order.clone_from(order);
                self.pinned = *count;
                changed
            }
            TallTableEvent::Pinned(_) => self.set_pinned(pinned),
            _ => false,
        }
    }

    /// The table's pinned count is `pinned`: read from the table after
    /// anything sets it, since its `Pinned` event comes only when the run
    /// in effect changes, and a count too wide to pin changes none. Whether
    /// the view changed.
    pub fn set_pinned(&mut self, pinned: usize) -> bool {
        let changed = pinned != self.pinned;
        self.pinned = pinned;
        changed
    }

    /// The source holds `rows` rows now (a CSV loading).
    pub fn set_rows(&mut self, rows: u64) {
        self.source.rows = rows;
    }

    /// The file's columns' types changed (a CSV's columns widened to text):
    /// a format a column can no longer hold is dropped. Its calls then give
    /// the table the new types with the rest of the view kept.
    /// Columns added or gone aren't a retype: the view starts again from
    /// the file's own.
    pub fn retype(&mut self, file: &[ColumnInfo]) {
        if file.len() != self.file.len() {
            *self = Self::of_file(self.source.clone(), file);
            return;
        }
        for (index, info) in file.iter().enumerate() {
            if !holds_numbers(info) {
                self.formats[index] = None;
            }
        }
        self.file = file.to_vec();
    }
}

/// Whether `column`'s values are numbers a format writes.
fn holds_numbers(column: &ColumnInfo) -> bool {
    matches!(
        column.tall_table_column().kind(),
        ColumnKind::Integer { .. } | ColumnKind::Float | ColumnKind::Decimal
    )
}

/// Publishes `view` to `globalThis.__tychoView`, read-only, for the checks;
/// null with no file open. The caller checks `crate::targets::measuring`.
#[cfg(target_family = "wasm")]
pub fn publish(view: Option<&ViewState>) {
    use wasm_bindgen::JsValue;

    let value = view
        .and_then(|view| serde_json::to_string(view).ok())
        .and_then(|json| js_sys::JSON::parse(&json).ok())
        .map_or(JsValue::NULL, |value| {
            freeze(&value);
            value
        });
    let _ = js_sys::Reflect::set(&js_sys::global(), &JsValue::from_str("__tychoView"), &value);
}

/// Freezes `value` and every object and array in it: the probe is
/// read-only all the way down.
#[cfg(target_family = "wasm")]
fn freeze(value: &wasm_bindgen::JsValue) {
    use wasm_bindgen::JsCast as _;

    let Some(object) = value.dyn_ref::<js_sys::Object>() else {
        return;
    };
    for entry in js_sys::Object::values(object).iter() {
        freeze(&entry);
    }
    js_sys::Object::freeze(object);
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::ops::Range;
    use std::rc::Rc;

    use gpui_kit::{App, AppContext as _, Entity, TestAppContext, VisualTestContext, px, size};
    use seiza_duckdb::sql::ColumnInfo;
    use seiza_tall_table::{
        CellValue, PageLoad, Paging, TallTableDelegate, TallTableEvent, TallTablePage,
        TallTableState,
    };

    use super::{ColumnView, Controller, Format, Refused, SourceKind, SourceView, ViewState};

    fn file() -> Vec<ColumnInfo> {
        vec![
            ColumnInfo::new("id", "BIGINT"),
            ColumnInfo::new("name", "VARCHAR"),
            ColumnInfo::new("mass", "DOUBLE"),
            ColumnInfo::new("launched", "DATE"),
        ]
    }

    fn source() -> SourceView {
        SourceView {
            kind: SourceKind::Csv,
            name: "launches.csv".into(),
            rows: 71_413,
        }
    }

    fn column(name: &str, data_type: &str) -> ColumnView {
        ColumnView {
            name: name.into(),
            data_type: data_type.into(),
            width: None,
            format: None,
        }
    }

    /// `mass` moved first and pinned, `name` widened, `id` grouped.
    fn arranged() -> ViewState {
        ViewState {
            source: source(),
            columns: vec![
                ColumnView {
                    format: Some(Format {
                        decimals: Some(2),
                        suffix: Some(" t".into()),
                        ..Format::default()
                    }),
                    ..column("mass", "DOUBLE")
                },
                ColumnView {
                    format: Some(Format {
                        grouping: true,
                        ..Format::default()
                    }),
                    ..column("id", "BIGINT")
                },
                ColumnView {
                    width: Some(240.0),
                    ..column("name", "VARCHAR")
                },
                column("launched", "DATE"),
            ],
            pinned: 1,
        }
    }

    #[test]
    fn a_files_own_view_is_its_columns_in_order() {
        let view = Controller::of_file(source(), &file()).view();
        assert_eq!(
            serde_json::to_string(&view).unwrap(),
            r#"{"source":{"kind":"csv","name":"launches.csv","rows":71413},"columns":[{"name":"id","type":"BIGINT"},{"name":"name","type":"VARCHAR"},{"name":"mass","type":"DOUBLE"},{"name":"launched","type":"DATE"}]}"#
        );
    }

    #[test]
    fn a_view_round_trips() {
        let view = arranged();
        let json = serde_json::to_string(&view).unwrap();
        assert_eq!(serde_json::from_str::<ViewState>(&json).unwrap(), view);
        let controller = Controller::new(&view, &file()).unwrap();
        assert_eq!(controller.view(), view);
        assert_eq!(
            Controller::new(&controller.view(), &file()).unwrap(),
            controller
        );
        // Defaults are left out, and read back.
        assert!(!json.contains("alwaysSign") && !json.contains("always_sign"));
        assert!(
            serde_json::from_str::<ViewState>(
                r#"{"source":{"kind":"sample","name":"gcat.parquet","rows":1},"columns":[]}"#
            )
            .is_ok()
        );
        // A field nothing reads is refused, not dropped.
        assert!(
            serde_json::from_str::<ViewState>(
                r#"{"source":{"kind":"csv","name":"a","rows":1},"columns":[],"url":"https://x"}"#
            )
            .is_err()
        );
    }

    #[test]
    fn a_view_compiles_to_the_tables_calls() {
        let calls = Controller::new(&arranged(), &file()).unwrap().calls();
        // The file's order, which the pages read by.
        let names: Vec<_> = calls
            .columns
            .iter()
            .map(|column| column.name().to_string())
            .collect();
        assert_eq!(names, ["id", "name", "mass", "launched"]);
        assert_eq!(calls.order, [2, 0, 1, 3]);
        assert_eq!(calls.pinned, 1);
        let mut expected: Vec<_> = file().iter().map(ColumnInfo::tall_table_column).collect();
        expected[0] = expected[0]
            .clone()
            .format(seiza_tall_table::NumberFormat::new().grouping(true));
        expected[1] = expected[1].clone().width(px(240.));
        expected[2] = expected[2].clone().format(
            seiza_tall_table::NumberFormat::new()
                .decimals(2)
                .suffix(" t"),
        );
        assert_eq!(calls.columns, expected);
    }

    #[test]
    fn a_view_finds_its_columns_by_name() {
        // Another file with the same columns in another order, and one more.
        let other = vec![
            ColumnInfo::new("launched", "DATE"),
            ColumnInfo::new("mass", "DOUBLE"),
            ColumnInfo::new("site", "VARCHAR"),
            ColumnInfo::new("name", "VARCHAR"),
            ColumnInfo::new("id", "BIGINT"),
        ];
        let controller = Controller::new(&arranged(), &other).unwrap();
        assert_eq!(controller.calls().order, [1, 4, 3, 0, 2]);
        let names: Vec<_> = controller
            .view()
            .columns
            .into_iter()
            .map(|column| column.name)
            .collect();
        assert_eq!(names, ["mass", "id", "name", "launched", "site"]);
    }

    #[test]
    fn a_view_is_refused_whole() {
        let refused =
            |view: &ViewState, file: &[ColumnInfo]| Controller::new(view, file).unwrap_err();
        let without = |gone: &[&str]| -> Vec<ColumnInfo> {
            file()
                .into_iter()
                .filter(|info| !gone.contains(&info.name.as_str()))
                .collect()
        };
        assert_eq!(
            refused(&arranged(), &without(&["mass", "launched"])),
            Refused::Missing(vec!["mass".into(), "launched".into()])
        );
        assert_eq!(
            refused(&arranged(), &without(&["mass"])).to_string(),
            "the view needs the column mass, which this file doesn't have"
        );
        // Every missing column is named, once, ahead of the other faults.
        let mut faults = arranged();
        faults.columns[2].width = Some(f32::NAN);
        faults.columns.push(column("gone", "DATE"));
        faults.columns.push(column("gone", "DATE"));
        faults.columns.push(column("id", "BIGINT"));
        assert_eq!(
            refused(&faults, &file()),
            Refused::Missing(vec!["gone".into()])
        );
        let mut twice = arranged();
        twice.columns.push(column("id", "BIGINT"));
        assert_eq!(refused(&twice, &file()), Refused::Repeated("id".into()));
        let mut pinned = arranged();
        pinned.pinned = 5;
        assert_eq!(
            refused(&pinned, &file()),
            Refused::Pinned {
                pinned: 5,
                columns: 4
            }
        );
        let mut width = arranged();
        width.columns[2].width = Some(f32::NAN);
        assert_eq!(
            refused(&width, &file()),
            Refused::Width {
                column: "name".into()
            }
        );
        // `mass` is text in this file: its format can't apply.
        let mut text = file();
        text[2] = ColumnInfo::new("mass", "VARCHAR");
        assert!(
            matches!(refused(&arranged(), &text), Refused::Format { column, .. } if column == "mass")
        );
    }

    #[test]
    fn a_widened_column_keeps_its_place_width_and_pin() {
        let mut view = arranged();
        view.columns[0].width = Some(90.0);
        let mut controller = Controller::new(&view, &file()).unwrap();
        let mut widened = file();
        widened[2] = ColumnInfo::new("mass", "VARCHAR");
        widened[0] = ColumnInfo::new("id", "VARCHAR");
        controller.retype(&widened);
        let after = controller.view();
        assert_eq!(after.pinned, 1);
        assert_eq!(
            after.columns[0],
            ColumnView {
                width: Some(90.0),
                ..column("mass", "VARCHAR")
            }
        );
        // Its format is dropped with the numbers.
        assert_eq!(after.columns[1], column("id", "VARCHAR"));
        assert_eq!(controller.calls().order, [2, 0, 1, 3]);
        // A column more isn't a retype: the file's own view.
        let mut more = widened.clone();
        more.push(ColumnInfo::new("site", "VARCHAR"));
        controller.retype(&more);
        assert_eq!(controller, Controller::of_file(source(), &more));
    }

    // --- The table's events, from a table in a window ---

    struct Memory;

    struct Rows;

    impl TallTablePage for Rows {
        fn value(&self, _: usize, _: usize) -> Option<CellValue<'_>> {
            Some(CellValue::Float(1.0))
        }

        fn heap_bytes(&self) -> usize {
            0
        }
    }

    impl TallTableDelegate for Memory {
        type Page = Rows;
        type Request = u64;

        fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Rows>) {
            (rows.start, Box::pin(std::future::ready(Ok(Rows))))
        }

        fn cancel(&mut self, _: u64, _: &mut App) {}
    }

    type Table = TallTableState<Memory>;

    /// A table over the file's columns, the controller taking its events
    /// as the workbench does.
    struct Shell {
        table: Entity<Table>,
        controller: Rc<RefCell<Controller>>,
        _subscription: gpui_kit::Subscription,
    }

    impl gpui_kit::Render for Shell {
        fn render(
            &mut self,
            _: &mut gpui_kit::Window,
            _: &mut gpui_kit::Context<Self>,
        ) -> impl gpui_kit::IntoElement {
            use gpui_kit::{ParentElement as _, Styled as _};
            gpui_kit::div()
                .size_full()
                .child(seiza_tall_table::TallTable::new(&self.table))
        }
    }

    fn open(cx: &mut TestAppContext) -> (Entity<Shell>, &mut VisualTestContext) {
        cx.update(|cx| {
            gpui_kit::component::init(cx);
            seiza_tall_table::init(cx);
        });
        let (shell, cx) = cx.add_window_view(|_, cx| {
            let controller = Controller::of_file(source(), &file());
            let calls = controller.calls();
            let table = cx
                .new(|cx| TallTableState::new(Memory, calls.columns, 1000, Paging::default(), cx));
            let controller = Rc::new(RefCell::new(controller));
            let taking = controller.clone();
            let subscription = cx.subscribe(&table, move |_, table, event: &TallTableEvent, cx| {
                let pinned = table.read(cx).pinned();
                taking.borrow_mut().take(event, pinned);
            });
            Shell {
                table,
                controller,
                _subscription: subscription,
            }
        });
        cx.simulate_resize(size(px(1440.), px(900.)));
        draw(cx);
        (shell, cx)
    }

    fn draw(cx: &mut VisualTestContext) {
        for _ in 0..2 {
            cx.run_until_parked();
            cx.update(|window, cx| window.draw(cx).clear(cx));
        }
    }

    #[gpui_kit::test]
    fn the_tables_events_become_the_view(cx: &mut TestAppContext) {
        let (shell, cx) = open(cx);
        let (table, controller) = shell.read_with(cx, |shell, _| {
            (shell.table.clone(), shell.controller.clone())
        });
        // A drag's release reports the widths by index.
        table.update(cx, |_, cx| {
            cx.emit(TallTableEvent::ColumnWidthsChanged(vec![
                None,
                Some(px(240.)),
                None,
                None,
            ]));
        });
        // A move, then a pin, as a drag and the column's menu make them.
        table.update(cx, |table, cx| table.move_columns(2..3, 0, cx));
        table.update(cx, |table, cx| table.set_pinned(1, cx));
        draw(cx);
        let view = controller.borrow().view();
        let names: Vec<_> = view
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect();
        assert_eq!(names, ["mass", "id", "name", "launched"]);
        assert_eq!(view.columns[2].width, Some(240.0));
        assert_eq!(view.pinned, 1);
        // A column moved out of the run unpins it, the count with it.
        table.update(cx, |table, cx| table.move_columns(0..1, 2, cx));
        draw(cx);
        assert_eq!(controller.borrow().view().pinned, 0);
    }

    #[gpui_kit::test]
    fn a_pin_too_wide_to_draw_is_read_from_the_table(cx: &mut TestAppContext) {
        let (shell, cx) = open(cx);
        let (table, controller) = shell.read_with(cx, |shell, _| {
            (shell.table.clone(), shell.controller.clone())
        });
        // The first column wider than half the cells: a pin of it draws none.
        let mut wide = file()
            .iter()
            .map(ColumnInfo::tall_table_column)
            .collect::<Vec<_>>();
        wide[0] = wide[0].clone().width(px(1000.));
        table.update(cx, |table, cx| table.set_columns(wide, cx));
        draw(cx);
        table.update(cx, |table, cx| table.set_pinned(1, cx));
        draw(cx);
        table.read_with(cx, |table, _| {
            assert_eq!((table.pinned(), table.pinned_in_effect()), (1, 0));
        });
        // The run in effect didn't change, so no `Pinned` came.
        assert_eq!(controller.borrow().view().pinned, 0);
        // What the workbench does after a pin it makes.
        let pinned = table.read_with(cx, |table, _| table.pinned());
        assert!(controller.borrow_mut().set_pinned(pinned));
        assert_eq!(controller.borrow().view().pinned, 1);
    }

    #[gpui_kit::test]
    fn the_view_survives_set_columns(cx: &mut TestAppContext) {
        let (shell, cx) = open(cx);
        let (table, controller) = shell.read_with(cx, |shell, _| {
            (shell.table.clone(), shell.controller.clone())
        });
        table.update(cx, |table, cx| {
            cx.emit(TallTableEvent::ColumnWidthsChanged(vec![
                None,
                None,
                Some(px(120.)),
                None,
            ]));
            table.move_columns(2..3, 0, cx);
            table.set_pinned(1, cx);
        });
        draw(cx);
        let before = controller.borrow().view();
        // A CSV's chunk widened `mass` to text: the table's columns change,
        // which resets its order, and the view gives it back.
        let mut widened = file();
        widened[2] = ColumnInfo::new("mass", "VARCHAR");
        let calls = {
            let mut controller = controller.borrow_mut();
            controller.retype(&widened);
            controller.calls()
        };
        table.update(cx, |table, cx| calls.apply(table, cx));
        draw(cx);
        let after = controller.borrow().view();
        assert_eq!(
            after.columns[0],
            ColumnView {
                width: Some(120.0),
                ..column("mass", "VARCHAR")
            }
        );
        assert_eq!(after.columns[1..], before.columns[1..]);
        assert_eq!(after.pinned, 1);
        table.read_with(cx, |table, _| {
            assert_eq!(table.order(), [2, 0, 1, 3]);
            assert_eq!(table.pinned(), 1);
            assert_eq!(table.column_width(2), Some(px(120.)));
        });
    }
}
