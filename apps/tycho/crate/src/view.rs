//! The controller and its view state: what the table shows of the open
//! file, as one value every driver produces (the research, "The
//! controller"; `docs/DECISIONS.md`, "Scope", 2026-11-17).
//!
//! [`ViewState`] is the serializable form: the source (its kind, name, and
//! rows; never a URL or the data), the columns in the order drawn, each
//! with its type, its width where it differs from its kind's, its format
//! where it has one, and whether it's hidden, and how many are pinned. A [`Controller`] holds
//! it by the table's column indices, so a move or a name the file repeats
//! stays exact: [`Controller::calls`] compiles it to calls on the table,
//! and [`Controller::take`] takes what the table owns and reports (widths,
//! order, pins, hidden flags) from its events. A state naming a column the file doesn't
//! have is refused whole ([`Controller::new`]), never applied in part
//! (`docs/DECISIONS.md`, "Scope", 2026-11-21, "A link to a view of a
//! dropped file").
//!
//! Two drivers write it: the table's events (a drag, a pin made in the
//! table) and the command bar's actions (`crate::command`), which change
//! the controller first and then give the table its calls
//! ([`TableCalls::arrange`]). `globalThis.__tychoView` publishes it
//! read-only (`docs/DECISIONS.md`, "Scope", 2026-11-23).
//!
//! It also chooses and orders the rows: its filters (`crate::filter`,
//! combined with `AND`) compile to the source's `WHERE`
//! ([`Controller::where_sql`]), and its sort, one column at most, to the
//! table's `set_sort` ([`Controller::sort_keys`]); the workbench gives the
//! table both (`docs/DECISIONS.md`, "Table and paging", 2026-11-26).

use std::fmt;

use gpui_kit::{Context, px};
use seiza_duckdb::sql::ColumnInfo;
use seiza_tall_table::{
    ColumnKind, NumberFormat, Sign, TallTableColumn, TallTableDelegate, TallTableEvent,
    TallTableState,
};
use serde::{Deserialize, Serialize};

use crate::filter::{Direction, Filter, SortView};

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
    /// The rows kept: each filter's, combined with `AND`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filters: Vec<Filter>,
    /// The order the rows are read in; none for the file's own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<SortView>,
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
    /// Hidden in the table: it keeps its place, drawn at no width.
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden: bool,
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
    /// Every column hidden: the table would show none.
    AllHidden,
    /// A filter that can't apply to its column.
    Filter { column: String, why: String },
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
            Self::AllHidden => f.write_str("the view hides every column"),
            Self::Filter { column, why } => {
                write!(f, "the view's filter on {column} can't apply: {why}")
            }
        }
    }
}

/// The calls that give a table the view: its columns (in the file's order,
/// each with its width, format, icon, and hidden flag), then the order
/// drawn, then the count pinned.
#[derive(Debug, Clone, PartialEq)]
pub struct TableCalls {
    pub columns: Vec<TallTableColumn>,
    /// `order[place]` is the index drawn there.
    pub order: Vec<usize>,
    pub pinned: usize,
    /// By the file's column: the flags `columns` carry, for a table whose
    /// columns aren't set again ([`TableCalls::arrange`]).
    pub hidden: Vec<bool>,
}

impl TableCalls {
    /// Gives `table` the view: after `set_columns`, which resets the order
    /// and keeps the count as places, the order and the count again. The
    /// columns carry their hidden flags.
    pub fn apply<D: TallTableDelegate>(
        self,
        table: &mut TallTableState<D>,
        cx: &mut Context<TallTableState<D>>,
    ) {
        table.set_columns(self.columns, cx);
        table.set_order(self.order, cx);
        table.set_pinned(self.pinned, cx);
    }

    /// Gives `table` the view with the least it needs: its columns only
    /// when `columns` says their widths or formats changed
    /// ([`Controller::same_columns`]; `set_columns` resets the order and
    /// the table's other per-column state), then the hidden flags, the
    /// order, and the count. A flag the table has already changes nothing.
    pub fn arrange<D: TallTableDelegate>(
        self,
        columns: bool,
        table: &mut TallTableState<D>,
        cx: &mut Context<TallTableState<D>>,
    ) {
        if columns {
            table.set_columns(self.columns, cx);
        }
        table.set_hidden(self.hidden, cx);
        table.set_order(self.order, cx);
        table.set_pinned(self.pinned, cx);
    }
}

/// Why `pin` or `unpin` left a column where it was: it's on that side of
/// the pinned run already. An answer, not an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinRefused {
    AlreadyPinned,
    NotPinned,
}

/// Why `hide` or `show` left a column as it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HideRefused {
    /// Hidden already, or shown already: an answer, not an error.
    AlreadyHidden,
    NotHidden,
    /// It's the last column shown: the table would show none.
    LastShown,
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
    /// By the file's column.
    hidden: Vec<bool>,
    pinned: usize,
    /// Each names its column; checked against the file's types.
    filters: Vec<Filter>,
    /// The file's column, and which way.
    sort: Option<(usize, Direction)>,
    /// Why the table may not sort this file, if it may not: no header
    /// draws its arrow. Not the view's: a file's own
    /// (`crate::table::SORT_LIMIT`).
    unsortable: Option<String>,
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
            hidden: vec![false; file.len()],
            pinned: 0,
            filters: Vec::new(),
            sort: None,
            unsortable: None,
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
        for name in view
            .filters
            .iter()
            .map(|filter| &filter.column)
            .chain(view.sort.as_ref().map(|sort| &sort.column))
        {
            if !file.iter().any(|info| &info.name == name) && !missing.contains(name) {
                missing.push(name.clone());
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
        let mut hidden = vec![false; file.len()];
        for (column, &index) in view.columns.iter().zip(&order) {
            hidden[index] = column.hidden;
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
        // The file's columns the view doesn't name are shown, so only a view
        // naming them all can hide them all.
        if !file.is_empty() && used.iter().all(|used| *used) && hidden.iter().all(|h| *h) {
            return Err(Refused::AllHidden);
        }
        for filter in &view.filters {
            let column = file.iter().find(|info| info.name == filter.column);
            if let Some(Err(why)) = column.map(|column| filter.sql(column)) {
                return Err(Refused::Filter {
                    column: filter.column.clone(),
                    why: why.to_string(),
                });
            }
        }
        let sort = view.sort.as_ref().and_then(|sort| {
            let index = file.iter().position(|info| info.name == sort.column)?;
            Some((index, sort.direction))
        });
        order.extend((0..file.len()).filter(|&index| !used[index]));
        Ok(Self {
            source: view.source.clone(),
            file: file.to_vec(),
            order,
            widths,
            formats,
            hidden,
            pinned: view.pinned,
            filters: view.filters.clone(),
            sort,
            unsortable: None,
        })
    }

    /// The file's columns, in its own order: the table's indices.
    pub fn columns(&self) -> &[ColumnInfo] {
        &self.file
    }

    /// `order()[place]` is the file's column drawn there.
    pub fn order(&self) -> &[usize] {
        &self.order
    }

    /// The count of leading columns pinned, as asked for.
    pub fn pinned(&self) -> usize {
        self.pinned
    }

    /// Column `index`'s set width, none while it's its kind's.
    pub fn width(&self, index: usize) -> Option<f32> {
        self.widths.get(index).copied().flatten()
    }

    /// Whether column `index` is hidden.
    pub fn is_hidden(&self, index: usize) -> bool {
        self.hidden.get(index).copied().unwrap_or(false)
    }

    /// How many columns are shown.
    pub fn shown(&self) -> usize {
        self.hidden.iter().filter(|hidden| !**hidden).count()
    }

    /// Whether `other` gives the table the same columns: the file's, at the
    /// same widths and formats (the order, the pins, and the hidden flags
    /// aside: the table takes those without `set_columns`).
    pub fn same_columns(&self, other: &Self) -> bool {
        self.file == other.file && self.widths == other.widths && self.formats == other.formats
    }

    /// Where column `index` is drawn.
    pub fn place(&self, index: usize) -> usize {
        self.order
            .iter()
            .position(|&drawn| drawn == index)
            .unwrap_or(index)
    }

    /// Whether column `index` is in the pinned run.
    pub fn is_pinned(&self, index: usize) -> bool {
        self.place(index) < self.pinned
    }

    /// Pins column `index`: moves it to the end of the pinned run and pins
    /// one more (`docs/DECISIONS.md`, "Scope", 2026-11-24).
    pub fn pin(&mut self, index: usize) -> Result<(), PinRefused> {
        let place = self.place(index);
        if place < self.pinned {
            return Err(PinRefused::AlreadyPinned);
        }
        self.order.remove(place);
        self.order.insert(self.pinned, index);
        self.pinned += 1;
        Ok(())
    }

    /// Unpins column `index`: moves it to just past the pinned run and pins
    /// one fewer.
    pub fn unpin(&mut self, index: usize) -> Result<(), PinRefused> {
        let place = self.place(index);
        if place >= self.pinned {
            return Err(PinRefused::NotPinned);
        }
        self.order.remove(place);
        self.order.insert(self.pinned - 1, index);
        self.pinned -= 1;
        Ok(())
    }

    /// Hides column `index`. The last column shown stays.
    pub fn hide(&mut self, index: usize) -> Result<(), HideRefused> {
        if self.hidden[index] {
            return Err(HideRefused::AlreadyHidden);
        }
        if self.shown() == 1 {
            return Err(HideRefused::LastShown);
        }
        self.hidden[index] = true;
        Ok(())
    }

    /// Shows column `index` where it was.
    pub fn show(&mut self, index: usize) -> Result<(), HideRefused> {
        if !self.hidden[index] {
            return Err(HideRefused::NotHidden);
        }
        self.hidden[index] = false;
        Ok(())
    }

    /// Takes `view` (a log entry's) over this file, keeping the rows there
    /// are now: a CSV still loading has more than when it was written. The
    /// controller is left as it was if the view is refused.
    pub fn restore(&mut self, view: &ViewState) -> Result<(), Refused> {
        let mut restored = Self::new(view, &self.file)?;
        restored.source.rows = self.source.rows;
        restored.unsortable.clone_from(&self.unsortable);
        *self = restored;
        Ok(())
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
                    hidden: self.hidden[index],
                })
                .collect(),
            pinned: self.pinned,
            filters: self.filters.clone(),
            sort: self.sort.map(|(index, direction)| SortView {
                column: self.file[index].name.clone(),
                direction,
            }),
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
                        .icon(crate::table::type_icon(info))
                        .hidden(self.hidden[index])
                        .sortable(self.unsortable.is_none())
                })
                .collect(),
            order: self.order.clone(),
            pinned: self.pinned,
            hidden: self.hidden.clone(),
        }
    }

    /// What the table reported, taken into the view: a width (`resize`),
    /// the order and the count after a move (`reorder`), the count after a
    /// pin (`pin`), or the hidden flags (`hide`). The order and the count are the table's as it is
    /// when the event is heard (`order`, `pinned`), not the event's: events
    /// are heard after the update that sent them, so a command's
    /// `set_order` then `set_pinned` would report a count already stale,
    /// and `Pinned` carries the run in effect, not the count. A command
    /// changes the controller before the table, so what it sends the table
    /// comes back as no change, and only the table's own changes (a drag)
    /// do. Whether the view changed.
    pub fn take(&mut self, event: &TallTableEvent, order: &[usize], pinned: usize) -> bool {
        match event {
            TallTableEvent::ColumnWidthsChanged(widths) if widths.len() == self.file.len() => {
                let widths: Vec<_> = widths.iter().map(|width| width.map(f32::from)).collect();
                let changed = widths != self.widths;
                self.widths = widths;
                changed
            }
            TallTableEvent::ColumnsMoved { .. } if order.len() == self.file.len() => {
                let changed = order != self.order || pinned != self.pinned;
                self.order = order.to_vec();
                self.pinned = pinned;
                changed
            }
            TallTableEvent::Pinned(_) => self.set_pinned(pinned),
            // The table's sort: an arrow's click, or a sort the source
            // refused cleared.
            TallTableEvent::Sorted(keys) => self.set_sort(
                keys.first()
                    .filter(|key| key.column < self.file.len())
                    .map(|key| (key.column, Direction::of(key.direction))),
            ),
            // Never every column: the controller keeps one shown, and the
            // next arrange gives the table its flags back.
            TallTableEvent::ColumnsHidden(hidden)
                if hidden.len() == self.file.len() && hidden.iter().any(|hidden| !hidden) =>
            {
                let changed = *hidden != self.hidden;
                self.hidden.clone_from(hidden);
                changed
            }
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

    /// The filters, in the order they were added.
    pub fn filters(&self) -> &[Filter] {
        &self.filters
    }

    /// Adds `filter`, or says why it can't apply to its column. The same
    /// filter again is an answer, not an error (`Ok(false)`).
    pub fn add_filter(&mut self, filter: Filter) -> Result<bool, Refused> {
        let Some(column) = self.file.iter().find(|info| info.name == filter.column) else {
            return Err(Refused::Missing(vec![filter.column]));
        };
        filter.sql(column).map_err(|why| Refused::Filter {
            column: filter.column.clone(),
            why: why.to_string(),
        })?;
        if self.filters.contains(&filter) {
            return Ok(false);
        }
        self.filters.push(filter);
        Ok(true)
    }

    /// Removes the filters `keep` says no to: how many went.
    pub fn remove_filters(&mut self, keep: impl Fn(&Filter) -> bool) -> usize {
        let before = self.filters.len();
        self.filters.retain(keep);
        before - self.filters.len()
    }

    /// The source's `WHERE`: every filter, combined with `AND`; none with
    /// no filter. Every filter was checked against its column when it came
    /// in, so this fails only on a filter a change of type left behind:
    /// it's said, never built over every row.
    pub fn where_sql(&self) -> Result<Option<String>, Refused> {
        crate::filter::where_sql(&self.filters, &self.file).map_err(|(index, why)| {
            Refused::Filter {
                column: self.filters[index].column.clone(),
                why,
            }
        })
    }

    /// The sort: the file's column and which way.
    pub fn sort(&self) -> Option<(usize, Direction)> {
        self.sort
    }

    /// Sorts by column `index` (none: the file's order). Whether it
    /// changed.
    pub fn set_sort(&mut self, sort: Option<(usize, Direction)>) -> bool {
        let changed = sort != self.sort;
        self.sort = sort;
        changed
    }

    /// Whether the table may sort this file.
    pub fn is_sortable(&self) -> bool {
        self.unsortable.is_none()
    }

    /// Why the table may not sort this file, if it may not.
    pub fn sort_refusal(&self) -> Option<&str> {
        self.unsortable.as_deref()
    }

    /// The file can't be sorted, and `why`: no header draws an arrow.
    pub fn unsortable(mut self, why: String) -> Self {
        self.unsortable = Some(why);
        self
    }

    /// The sort as the table's keys.
    pub fn sort_keys(&self) -> Vec<seiza_tall_table::Sort> {
        self.sort
            .map(|(index, direction)| seiza_tall_table::Sort::new(index, direction.table()))
            .into_iter()
            .collect()
    }

    /// The filters, as they were before a filter that couldn't be built:
    /// each was checked when it came in.
    pub fn set_filters(&mut self, filters: Vec<Filter>) {
        self.filters = filters;
    }

    /// Whether `other` keeps the same rows (its filters).
    pub fn same_rows(&self, other: &Self) -> bool {
        self.filters == other.filters
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
        self.filters.retain(|filter| {
            file.iter()
                .find(|info| info.name == filter.column)
                .is_some_and(|info| filter.sql(info).is_ok())
        });
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
pub(crate) fn freeze(value: &wasm_bindgen::JsValue) {
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
    use crate::filter::Filter;

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
            hidden: false,
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
            filters: Vec::new(),
            sort: None,
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
        let mut expected: Vec<_> = file()
            .iter()
            .map(|info| {
                info.tall_table_column()
                    .icon(crate::table::type_icon(info))
                    .sortable(true)
            })
            .collect();
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
        let mut hidden = arranged();
        for column in &mut hidden.columns {
            column.hidden = true;
        }
        assert_eq!(refused(&hidden, &file()), Refused::AllHidden);
        // A column the view doesn't name is shown.
        hidden.columns.pop();
        assert!(Controller::new(&hidden, &file()).is_ok());
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

    fn filter(column: &str, op: crate::filter::Op, value: serde_json::Value) -> Filter {
        Filter {
            column: column.into(),
            op,
            value: serde_json::from_value(value).unwrap(),
        }
    }

    #[test]
    fn filters_and_a_sort_are_the_views() {
        use crate::filter::{Direction, Op, SortView};

        let mut controller = Controller::new(&arranged(), &file()).unwrap();
        assert!(
            controller
                .add_filter(filter("mass", Op::Ge, serde_json::json!(90)))
                .unwrap()
        );
        assert!(
            controller
                .add_filter(filter("name", Op::Contains, serde_json::json!("it's")))
                .unwrap()
        );
        // The same filter again is an answer.
        assert!(
            !controller
                .add_filter(filter("mass", Op::Ge, serde_json::json!(90)))
                .unwrap()
        );
        assert!(controller.set_sort(Some((3, Direction::Desc))));
        assert_eq!(
            controller.where_sql().unwrap().unwrap(),
            r#"("mass" >= 90) AND (contains(lower("name"), lower('it''s')))"#
        );
        assert_eq!(
            controller.sort_keys(),
            [seiza_tall_table::Sort::new(
                3,
                seiza_tall_table::SortDirection::Descending
            )]
        );
        let view = controller.view();
        let json = serde_json::to_string(&view).unwrap();
        assert!(
            json.ends_with(r#""filters":[{"column":"mass","op":">=","value":90},{"column":"name","op":"contains","value":"it's"}],"sort":{"column":"launched","direction":"desc"}}"#),
            "{json}"
        );
        assert_eq!(serde_json::from_str::<ViewState>(&json).unwrap(), view);
        assert_eq!(Controller::new(&view, &file()).unwrap(), controller);
        // Back to a state without them: none.
        let mut back = controller.clone();
        back.restore(&arranged()).unwrap();
        assert!(back.filters().is_empty() && back.sort().is_none());
        assert!(!back.same_rows(&controller));
        // A filter its column can't take, and a column the file doesn't
        // have, refuse the view whole.
        let mut wrong = view.clone();
        wrong.filters[0] = filter("mass", Op::Contains, serde_json::json!("x"));
        assert!(matches!(
            Controller::new(&wrong, &file()),
            Err(Refused::Filter { column, .. }) if column == "mass"
        ));
        assert!(
            controller
                .add_filter(filter("name", Op::Gt, serde_json::json!("a")))
                .is_err()
        );
        let mut gone = view.clone();
        gone.sort = Some(SortView {
            column: "gone".into(),
            direction: Direction::Asc,
        });
        assert_eq!(
            Controller::new(&gone, &file()),
            Err(Refused::Missing(vec!["gone".into()]))
        );
        // A widened column drops the filters it can't take, and keeps its sort.
        let mut widened = file();
        widened[2] = ColumnInfo::new("mass", "VARCHAR");
        controller.retype(&widened);
        assert_eq!(controller.filters().len(), 1);
        assert_eq!(controller.sort(), Some((3, Direction::Desc)));
        // Removing.
        assert_eq!(controller.remove_filters(|_| false), 1);
        assert_eq!(controller.where_sql(), Ok(None));
        // A filter a change of type left behind is said, not dropped.
        controller.set_filters(vec![filter("mass", Op::Ge, serde_json::json!(1))]);
        assert!(matches!(
            controller.where_sql(),
            Err(Refused::Filter { column, .. }) if column == "mass"
        ));
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

        fn sort(
            &mut self,
            _: &[seiza_tall_table::Sort],
            _: &mut App,
        ) -> Result<(), seiza_tall_table::SortRefused> {
            Ok(())
        }
    }

    type Table = TallTableState<Memory>;

    /// A table over the file's columns, the controller taking its events
    /// as the workbench does.
    struct Shell {
        table: Entity<Table>,
        controller: Rc<RefCell<Controller>>,
        /// The events that changed the view: the workbench logs each as a
        /// drag.
        changes: Rc<std::cell::Cell<usize>>,
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
            let changes = Rc::new(std::cell::Cell::new(0));
            let counting = changes.clone();
            let subscription = cx.subscribe(&table, move |_, table, event: &TallTableEvent, cx| {
                let table = table.read(cx);
                if taking
                    .borrow_mut()
                    .take(event, table.order(), table.pinned())
                {
                    counting.set(counting.get() + 1);
                }
            });
            Shell {
                table,
                controller,
                changes,
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

    /// Runs `text` as the workbench does: planned on the controller, which
    /// takes it, then given to the table, the count read back.
    fn command(text: &str, shell: &Entity<Shell>, cx: &mut VisualTestContext) {
        use crate::command::{Catalog, Parsed, parse, plan};

        let (table, controller) = shell.read_with(cx, |shell, _| {
            (shell.table.clone(), shell.controller.clone())
        });
        let Parsed::Action { steps, .. } = parse(text) else {
            panic!("{text:?} isn't an action");
        };
        let catalog = Catalog {
            view: controller.borrow().clone(),
            loading: false,
            lines: Default::default(),
        };
        let plan = plan(&steps, &catalog).unwrap();
        let columns = !catalog.view.same_columns(&plan.view);
        *controller.borrow_mut() = plan.view;
        let calls = controller.borrow().calls();
        let pinned = table.update(cx, |table, cx| {
            calls.arrange(columns, table, cx);
            table.pinned()
        });
        controller.borrow_mut().set_pinned(pinned);
        draw(cx);
    }

    #[gpui_kit::test]
    fn pin_and_unpin_move_the_tables_columns(cx: &mut TestAppContext) {
        let (shell, cx) = open(cx);
        let (table, controller, changes) = shell.read_with(cx, |shell, _| {
            (
                shell.table.clone(),
                shell.controller.clone(),
                shell.changes.clone(),
            )
        });
        command("pin mass", &shell, cx);
        command("pin LAUNCHED", &shell, cx);
        table.read_with(cx, |table, _| {
            assert_eq!(table.order(), [2, 3, 0, 1]);
            assert_eq!((table.pinned(), table.pinned_in_effect()), (2, 2));
        });
        command("unpin mass", &shell, cx);
        table.read_with(cx, |table, _| {
            assert_eq!(table.order(), [3, 2, 0, 1]);
            assert_eq!(table.pinned(), 1);
        });
        let view = controller.borrow().view();
        let names: Vec<_> = view
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect();
        assert_eq!(names, ["launched", "mass", "id", "name"]);
        assert_eq!(view.pinned, 1);
        // The table's events for the command's own calls came back as no
        // change: no drag in the log.
        assert_eq!(changes.get(), 0);
        // A drag still is one.
        table.update(cx, |table, cx| table.move_columns(3..4, 1, cx));
        draw(cx);
        assert_eq!(changes.get(), 1);
        assert_eq!(controller.borrow().order(), [3, 1, 2, 0]);
    }

    #[gpui_kit::test]
    fn hidden_flags_go_both_ways(cx: &mut TestAppContext) {
        let (shell, cx) = open(cx);
        let (table, controller, changes) = shell.read_with(cx, |shell, _| {
            (
                shell.table.clone(),
                shell.controller.clone(),
                shell.changes.clone(),
            )
        });
        // A command hides through the table, and its event comes back as
        // no change.
        command("hide mass, name", &shell, cx);
        table.read_with(cx, |table, _| {
            let hidden: Vec<_> = table.columns().iter().map(|c| c.is_hidden()).collect();
            assert_eq!(hidden, [false, true, true, false]);
        });
        assert_eq!(changes.get(), 0);
        let view = controller.borrow().view();
        assert!(view.columns[1].hidden && view.columns[2].hidden);
        assert!(
            serde_json::to_string(&view)
                .unwrap()
                .contains(r#""name":"mass","type":"DOUBLE","hidden":true"#)
        );
        // The table's own flags are taken from its event.
        table.update(cx, |table, cx| table.set_column_hidden(0, true, cx));
        draw(cx);
        assert!(controller.borrow().is_hidden(0));
        // The way back gives a hide back, without `set_columns`.
        let mut opened = controller.borrow().clone();
        opened
            .restore(&super::Controller::of_file(source(), &file()).view())
            .unwrap();
        let columns = !controller.borrow().same_columns(&opened);
        assert!(!columns);
        *controller.borrow_mut() = opened;
        let calls = controller.borrow().calls();
        table.update(cx, |table, cx| calls.arrange(columns, table, cx));
        draw(cx);
        table.read_with(cx, |table, _| {
            assert!(table.columns().iter().all(|column| !column.is_hidden()));
        });
        assert_eq!(controller.borrow().shown(), 4);
        // `show all` after: nothing hidden.
        command("hide id", &shell, cx);
        command("show all", &shell, cx);
        table.read_with(cx, |table, _| {
            assert!(table.columns().iter().all(|column| !column.is_hidden()));
        });
    }

    #[gpui_kit::test]
    fn the_tables_sort_becomes_the_view_and_goes_back(cx: &mut TestAppContext) {
        use crate::filter::Direction;
        use seiza_tall_table::{Sort, SortDirection};

        let (shell, cx) = open(cx);
        let (table, controller, changes) = shell.read_with(cx, |shell, _| {
            (
                shell.table.clone(),
                shell.controller.clone(),
                shell.changes.clone(),
            )
        });
        // The columns sortable, as the controller's calls make them.
        let calls = controller.borrow().calls();
        table.update(cx, |table, cx| calls.apply(table, cx));
        draw(cx);
        let opened = controller.borrow().view();
        // The table's own sort (an arrow's click) is taken, and is a change.
        table
            .update(cx, |table, cx| {
                table.set_sort(vec![Sort::new(2, SortDirection::Descending)], cx)
            })
            .unwrap();
        draw(cx);
        assert_eq!(controller.borrow().sort(), Some((2, Direction::Desc)));
        assert_eq!(changes.get(), 1);
        let sorted = controller.borrow().view();
        assert_eq!(sorted.sort.as_ref().unwrap().column, "mass");
        // A filter, then the way back to the opening and on to the sort,
        // as the workbench gives the table a log entry's state: the sort's
        // keys through `set_sort`, which comes back as no change.
        controller
            .borrow_mut()
            .add_filter(filter("mass", crate::filter::Op::Gt, serde_json::json!(1)))
            .unwrap();
        for state in [&opened, &sorted] {
            controller.borrow_mut().restore(state).unwrap();
            let keys = controller.borrow().sort_keys();
            table.update(cx, |table, cx| {
                if table.sort() != keys.as_slice() {
                    table.set_sort(keys, cx).unwrap();
                }
            });
            draw(cx);
            assert_eq!(controller.borrow().view(), *state);
            assert!(controller.borrow().filters().is_empty());
        }
        table.read_with(cx, |table, _| {
            assert_eq!(table.sort(), [Sort::new(2, SortDirection::Descending)]);
        });
        assert_eq!(changes.get(), 1);
    }

    #[gpui_kit::test]
    fn a_log_entrys_state_is_given_back(cx: &mut TestAppContext) {
        let (shell, cx) = open(cx);
        let (table, controller, changes) = shell.read_with(cx, |shell, _| {
            (
                shell.table.clone(),
                shell.controller.clone(),
                shell.changes.clone(),
            )
        });
        let opened = controller.borrow().view();
        // A width from a drag, then a pin.
        table.update(cx, |_, cx| {
            cx.emit(TallTableEvent::ColumnWidthsChanged(vec![
                None,
                Some(px(240.)),
                None,
                None,
            ]));
        });
        draw(cx);
        command("pin name", &shell, cx);
        assert_eq!(changes.get(), 1);
        // The way back to the opening: the widths too, so its columns.
        let before = controller.borrow().clone();
        controller.borrow_mut().restore(&opened).unwrap();
        let columns = !controller.borrow().same_columns(&before);
        assert!(columns);
        let calls = controller.borrow().calls();
        table.update(cx, |table, cx| calls.arrange(columns, table, cx));
        draw(cx);
        assert_eq!(controller.borrow().view(), opened);
        table.read_with(cx, |table, _| {
            assert_eq!(table.order(), [0, 1, 2, 3]);
            assert_eq!(table.pinned(), 0);
        });
        // Nothing of it was read as a drag.
        assert_eq!(changes.get(), 1);
    }
}
