//! The `tall-table` feature's view of a source: its rows chosen by a filter
//! and ordered by a sort, read a page at a time, and (with `find`) searched
//! in the order shown. [`ViewRows`] is the table's delegate; what it builds
//! lives in an in-memory database the host attaches, compressed, before
//! any lockdown ([`ViewSettings::database`]).
//!
//! How each pages was chosen by its timings in DuckDB-Wasm
//! (`docs/DECISIONS.md`, "Table source", 2026-11-26):
//! - **A filter** is an index: one query writes the row numbers it keeps,
//!   in the source's order, and a page is its slice of them joined to the
//!   source's rows between the slice's first and last row number, written
//!   into the SQL so a Parquet file reads only those row groups.
//! - **A sort** is a sorted copy of the rows in view, paged by `rowid`. A
//!   sorted index joined to a Parquet file reads every row group a page; a
//!   copy reads the file once. The host refuses the sort a source is too
//!   large for ([`RowSource::refuse_sort`]).
//!
//! Every index or copy is checked against the count it was built from: past
//! about 2.1 GiB of in-memory tables, DuckDB-Wasm's `CREATE TABLE … AS`
//! stores nothing and says nothing, so a short one fails, never "no rows".

use std::cell::{Cell, RefCell};
use std::future::Future;
use std::ops::Range;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Poll, Waker};

use gpui_kit::App;
use seiza_tall_table::{PageError, PageLoad, TallTableDelegate};

use crate::EngineError;
use crate::arrow::{QueryResult, Value};
use crate::sql::{column, quote_identifier, string_literal};
use crate::tall_table::{PageQuery, ParquetFile};

/// The row number's column in [`RowSource::numbered_sql`]'s relation, and
/// in every index and copy.
pub const ROW: &str = "__seiza_row";
/// A row's position in the view, where a query needs it.
const AT: &str = "__seiza_at";

/// A source whose rows can be read as one relation, numbered.
pub trait RowSource: PageQuery {
    /// Its rows numbered `rows` (0-based, end-exclusive, in its own order;
    /// all of them for `None`): the number as [`ROW`], then the table's
    /// columns in the table's order. A range must read only those rows'
    /// storage (a Parquet file's `file_row_number` filter).
    fn numbered_sql(&self, rows: Option<Range<u64>>) -> String;

    /// How many rows it has.
    fn rows(&self) -> u64;

    /// Why it can't be filtered or sorted now, if so (its rows still
    /// loading).
    fn busy(&self) -> Option<String> {
        None
    }

    /// Why a sort of `rows` of its rows can't be made, if so (a copy too
    /// large for the host's memory or its patience). Asked before
    /// [`RowSource::busy`]'s answer is.
    fn refuse_sort(&self, rows: u64) -> Option<String> {
        let _ = rows;
        None
    }
}

impl RowSource for ParquetFile {
    fn numbered_sql(&self, rows: Option<Range<u64>>) -> String {
        let mut sql = format!(
            "SELECT file_row_number AS {ROW}, * EXCLUDE (file_row_number) \
             FROM read_parquet({}, file_row_number = true)",
            string_literal(self.name())
        );
        if let Some(rows) = rows {
            sql.push_str(&format!(
                " WHERE file_row_number >= {} AND file_row_number < {}",
                rows.start, rows.end
            ));
        }
        sql
    }

    /// Unknown to the file's name alone: a host wraps it to say.
    fn rows(&self) -> u64 {
        0
    }
}

/// A query's answer, as [`Runner::query`] hands it back.
pub type QueryLoad = Pin<Box<dyn Future<Output = Result<QueryResult, EngineError>>>>;

/// What runs the view's queries: the engine, or a test's stand-in.
pub trait Runner: Clone + 'static {
    /// Names a query sent, so it can be cancelled.
    type Id: Copy + 'static;

    /// Sends `sql` now.
    fn query(&self, sql: &str) -> (Self::Id, QueryLoad);

    /// Stops a query; its answer resolves as cancelled unless it's in.
    fn cancel(&self, id: Self::Id);
}

#[cfg(target_family = "wasm")]
impl Runner for crate::Engine {
    type Id = crate::RequestId;

    fn query(&self, sql: &str) -> (Self::Id, QueryLoad) {
        let (id, result) = crate::Engine::query(self, sql);
        (id, Box::pin(result))
    }

    fn cancel(&self, id: Self::Id) {
        crate::Engine::cancel(self, id);
    }
}

/// Outside the browser there's no engine: every query fails.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoEngine;

impl Runner for NoEngine {
    type Id = ();

    fn query(&self, _: &str) -> (Self::Id, QueryLoad) {
        let error = EngineError::Engine("there's no engine outside the browser".into());
        ((), Box::pin(async move { Err(error) }))
    }

    fn cancel(&self, _: Self::Id) {}
}

/// The engine where there is one: a host names its view's runner by it.
#[cfg(target_family = "wasm")]
pub type EngineRunner = crate::Engine;
/// The engine where there is one: a host names its view's runner by it.
#[cfg(not(target_family = "wasm"))]
pub type EngineRunner = NoEngine;

/// What only the host knows.
#[derive(Debug, Clone, PartialEq)]
pub struct ViewSettings {
    /// The in-memory database, attached `(COMPRESS)` before any lockdown,
    /// that indexes and copies are written to (each
    /// `<database>.<prefix>v<n>`).
    pub database: String,
    /// What this view's tables' names start with: its own, so two views
    /// over one database never name the same table (a file opened after
    /// another).
    pub prefix: String,
    /// DuckDB's memory past which nothing more is built.
    pub memory_budget: u64,
}

/// DuckDB's memory, in bytes.
pub const MEMORY_SQL: &str = "SELECT sum(memory_usage_bytes)::BIGINT AS bytes FROM duckdb_memory()";

/// A filter's index, built ([`ViewRows::filter_job`]) and not yet given to
/// the view ([`ViewRows::set_filter`]).
#[derive(Debug, Clone, PartialEq)]
pub struct Filtered {
    where_sql: String,
    table: String,
    rows: u64,
}

impl Filtered {
    /// The rows it keeps.
    pub fn rows(&self) -> u64 {
        self.rows
    }
}

/// A sort's state: its copy, built or being built.
#[cfg_attr(
    not(feature = "sort"),
    expect(dead_code, reason = "only a sort builds an order")
)]
struct Ordered<Id> {
    table: String,
    gate: Gate,
    /// The `CREATE` running, until it answers.
    building: Rc<Cell<Option<Id>>>,
    /// Cleared once another order replaces it: its copy is dropped as soon
    /// as it's built, and nothing is told.
    current: Rc<Cell<bool>>,
}

/// What a sort's preparation came to, for the host to show.
#[derive(Debug, Clone, PartialEq)]
pub enum OrderEvent {
    /// The copy is built: the rows are read in this order from now on.
    Ready { rows: u64 },
    /// It couldn't be built: every page of the order fails with this.
    Failed { message: String },
}

/// What the view's rows are read from, as one query or a page's two.
#[derive(Clone)]
enum Kind {
    /// The source in its own order.
    Source,
    /// A filter's index: a slice's bounds, then its rows.
    Index(String),
    /// A sort's copy, paged by `rowid`.
    Copy(String),
}

/// A request the table holds: cancelled before or after its query is sent.
#[derive(Default)]
struct Request<Id> {
    cancelled: Cell<bool>,
    sent: Cell<Option<Id>>,
}

/// Names a read or a find in flight.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewRequest(u64);

/// A source's rows as the view shows them: filtered and sorted in DuckDB,
/// read a page at a time.
pub struct ViewRows<Q, R: Runner> {
    query: Q,
    runner: R,
    settings: ViewSettings,
    /// The table's columns by index: what a sort and a find name.
    columns: Vec<String>,
    filter: Option<Filtered>,
    order: Option<Ordered<R::Id>>,
    tables: Rc<Cell<u32>>,
    next_request: u64,
    requests: Requests<R::Id>,
    listener: Option<Listener>,
}

/// The reads and finds in flight, by their id.
type Requests<Id> = Rc<RefCell<Vec<(u64, Rc<Request<Id>>)>>>;

/// Hears how each sort's preparation ends.
type Listener = Rc<dyn Fn(&OrderEvent, &mut App)>;

impl<Q: RowSource + Clone, R: Runner> ViewRows<Q, R> {
    /// `query`'s rows in its own order, through `runner`; `columns` names
    /// the table's columns by index.
    pub fn new(runner: R, query: Q, columns: Vec<String>, settings: ViewSettings) -> Self {
        Self {
            query,
            runner,
            settings,
            columns,
            filter: None,
            order: None,
            tables: Rc::new(Cell::new(0)),
            next_request: 0,
            requests: Rc::default(),
            listener: None,
        }
    }

    pub fn query(&self) -> &Q {
        &self.query
    }

    /// For a source that changes (a CSV growing, a file registered again).
    pub fn query_mut(&mut self) -> &mut Q {
        &mut self.query
    }

    /// Hears how each sort's preparation ends.
    pub fn on_order(&mut self, listener: impl Fn(&OrderEvent, &mut App) + 'static) {
        self.listener = Some(Rc::new(listener));
    }

    /// The filter in effect's rows; the source's with none.
    pub fn rows_in_view(&self) -> u64 {
        self.filter
            .as_ref()
            .map_or_else(|| self.query.rows(), |filter| filter.rows)
    }

    /// Whether a filter is in effect.
    pub fn filtered(&self) -> bool {
        self.filter.is_some()
    }

    /// Whether a sort's copy is still being built.
    pub fn sorting(&self) -> bool {
        self.order
            .as_ref()
            .is_some_and(|order| order.gate.is_pending())
    }

    /// Builds the index of `where_sql`'s rows, or says why not: the job to
    /// run (its handle cancels it), whose answer goes to
    /// [`ViewRows::set_filter`] in the update that calls the table's
    /// `replace_rows` with its rows.
    pub fn filter_job(&self, where_sql: String) -> Result<FilterJob<R>, String> {
        if let Some(busy) = self.query.busy() {
            return Err(busy);
        }
        Ok(FilterJob {
            runner: self.runner.clone(),
            numbered: self.query.numbered_sql(None),
            where_sql,
            table: self.table_name(),
            budget: self.settings.memory_budget,
            building: Rc::new(Cell::new(None)),
            cancelled: Rc::new(Cell::new(false)),
        })
    }

    /// The filter in effect from now on (none: every row). The index it
    /// replaces is dropped.
    pub fn set_filter(&mut self, filter: Option<Filtered>) {
        if let Some(old) = std::mem::replace(&mut self.filter, filter) {
            drop_table(&self.runner, &old.table);
        }
    }

    /// Drops what the view built, its filter's index and its sort's copy
    /// (one still building is dropped once it answers): the file it shows
    /// is closing. Its reads go on, answering with the source's own rows.
    pub fn close(&mut self) {
        self.set_order(None);
        self.set_filter(None);
    }

    /// Reads the view's rows `rows` as a page does, outside the table (a
    /// row it doesn't hold): after the sort's copy is built, a filter's
    /// slice of the source.
    pub fn read(&self, rows: Range<u64>) -> PageLoad<QueryResult> {
        let request = Rc::new(Request {
            cancelled: Cell::new(false),
            sent: Cell::new(None),
        });
        self.read_with(rows, request)
    }

    fn read_with(&self, rows: Range<u64>, request: Rc<Request<R::Id>>) -> PageLoad<QueryResult> {
        let kind = self.kind();
        let gate = self.order.as_ref().map(|order| order.gate.clone());
        let reader = Reader {
            runner: self.runner.clone(),
            request,
        };
        // Written now: the source may change before the read is sent.
        let sql = match &kind {
            Kind::Source => Some(self.query.page_sql(rows.clone())),
            Kind::Copy(table) => Some(copy_page_sql(table, rows.clone())),
            Kind::Index(_) => None,
        };
        let numbered = numbered_for(&self.query);
        Box::pin(async move {
            if let Some(gate) = gate {
                gate.wait().await.map_err(|message| PageError::Failed {
                    message,
                    read_failure: false,
                })?;
            }
            match sql {
                Some(sql) => reader.send(&sql).await,
                None => {
                    let rows = rows_relation(&reader, &kind, &*numbered, rows).await?;
                    let sql = format!("SELECT * EXCLUDE ({AT}, {ROW}) FROM ({rows}) ORDER BY {AT}");
                    reader.send(&sql).await
                }
            }
        })
    }

    fn table_name(&self) -> String {
        let n = self.tables.get();
        self.tables.set(n + 1);
        format!("{}.{}v{n}", self.settings.database, self.settings.prefix)
    }

    fn kind(&self) -> Kind {
        match (&self.order, &self.filter) {
            (Some(order), _) => Kind::Copy(order.table.clone()),
            (None, Some(filter)) => Kind::Index(filter.table.clone()),
            (None, None) => Kind::Source,
        }
    }

    fn request(&mut self) -> (ViewRequest, Rc<Request<R::Id>>) {
        let id = self.next_request;
        self.next_request += 1;
        let request = Rc::new(Request {
            cancelled: Cell::new(false),
            sent: Cell::new(None),
        });
        self.requests.borrow_mut().push((id, request.clone()));
        (ViewRequest(id), request)
    }

    fn set_order(&mut self, order: Option<Ordered<R::Id>>) {
        if let Some(old) = std::mem::replace(&mut self.order, order) {
            old.current.set(false);
            match old.building.take() {
                // Its preparation drops the copy once it answers.
                Some(id) => self.runner.cancel(id),
                None => drop_table(&self.runner, &old.table),
            }
        }
    }

    /// The SQL counting the cells whose text contains `term` (as `find`'s
    /// match rule: `lower(CAST(… AS VARCHAR))` against `lower(term)`) in
    /// the view's rows and columns `columns` (by index): its answer's
    /// `matches`.
    pub fn find_count_sql(&self, term: &str, columns: &[usize]) -> Option<String> {
        let sum = match_sum(&self.columns, term, columns)?;
        Some(format!(
            "SELECT coalesce(sum({sum}), 0)::BIGINT AS matches FROM ({})",
            self.view_sql()
        ))
    }

    /// The SQL counting the matching cells up to `cell` (row `row`, its
    /// column `column`) in the order a find steps: every matching cell in
    /// the rows before it, then those of its row in `columns` up to its
    /// own. Its answer's `matches` is the cell's place among them, from 1.
    pub fn find_place_sql(
        &self,
        term: &str,
        columns: &[usize],
        row: u64,
        column: usize,
    ) -> Option<String> {
        let place = columns.iter().position(|&index| index == column)?;
        let before = match_sum(&self.columns, term, columns)?;
        let within = match_sum(&self.columns, term, &columns[..=place])?;
        let at = match self.kind() {
            Kind::Source | Kind::Copy(_) => format!("{row}"),
            // The filter keeps the source's order: the cell's row number.
            Kind::Index(table) => format!("(SELECT {ROW} FROM {table} WHERE rowid = {row})"),
        };
        Some(format!(
            "SELECT (coalesce(sum(CASE WHEN {AT} < {at} THEN {before} ELSE 0 END), 0) \
             + coalesce(sum(CASE WHEN {AT} = {at} THEN {within} ELSE 0 END), 0))::BIGINT AS matches \
             FROM ({}) WHERE {AT} <= {at}",
            self.view_sql()
        ))
    }

    /// Every row in view with its place in the order as [`AT`] (for a
    /// filter, its row number, which runs in the same order): a whole scan,
    /// for a count.
    fn view_sql(&self) -> String {
        match self.kind() {
            Kind::Source => format!(
                "SELECT {ROW} AS {AT}, * FROM ({})",
                self.query.numbered_sql(None)
            ),
            Kind::Copy(table) => format!("SELECT rowid AS {AT}, * FROM {table}"),
            Kind::Index(_) => {
                let filter = self.filter.as_ref().map_or("", |f| f.where_sql.as_str());
                format!(
                    "SELECT {ROW} AS {AT}, * FROM ({}) WHERE {filter}",
                    self.query.numbered_sql(None)
                )
            }
        }
    }
}

/// A sorted copy's page.
fn copy_page_sql(table: &str, rows: Range<u64>) -> String {
    format!(
        "SELECT * EXCLUDE ({ROW}) FROM {table} WHERE rowid >= {} AND rowid < {} ORDER BY rowid",
        rows.start, rows.end
    )
}

/// An index's slice of `rows`: their first and last row numbers.
fn slice_bounds_sql(table: &str, rows: &Range<u64>) -> String {
    format!(
        "SELECT min({ROW}) AS lo, max({ROW}) AS hi FROM {table} WHERE rowid >= {} AND rowid < {}",
        rows.start, rows.end
    )
}

/// An index's slice of `rows` joined to `numbered` (the source's rows
/// between the slice's bounds), each with its place as [`AT`].
fn slice_rows_sql(table: &str, rows: &Range<u64>, numbered: &str) -> String {
    format!(
        "SELECT i.{AT}, s.* FROM (SELECT {ROW}, rowid AS {AT} FROM {table} \
         WHERE rowid >= {} AND rowid < {}) i JOIN ({numbered}) s ON s.{ROW} = i.{ROW}",
        rows.start, rows.end
    )
}

/// The sum, a cell at a time, of the cells of `columns` (by index into
/// `names`) whose text contains `term`, ignoring case; `None` if a column
/// isn't there or none is asked.
fn match_sum(names: &[String], term: &str, columns: &[usize]) -> Option<String> {
    let flags = match_flags(names, term, columns)?;
    Some(
        flags
            .iter()
            .map(|flag| format!("({flag})::INT"))
            .collect::<Vec<_>>()
            .join(" + "),
    )
}

/// Each of `columns`' match, in their order, as a boolean (never NULL).
fn match_flags(names: &[String], term: &str, columns: &[usize]) -> Option<Vec<String>> {
    if columns.is_empty() {
        return None;
    }
    let term = string_literal(term);
    columns
        .iter()
        .map(|&index| {
            let name = quote_identifier(names.get(index)?);
            Some(format!(
                "coalesce(contains(lower(CAST({name} AS VARCHAR)), lower({term})), false)"
            ))
        })
        .collect()
}

/// Drops `table` once nothing waits on it, its answer unheard.
fn drop_table<R: Runner>(runner: &R, table: &str) {
    let (_, done) = runner.query(&format!("DROP TABLE IF EXISTS {table}"));
    // Polled by whoever drives futures here: on the web, the promise runs
    // whether or not its future is awaited.
    drop(done);
}

/// A filter's index being built ([`ViewRows::filter_job`]).
pub struct FilterJob<R: Runner> {
    runner: R,
    numbered: String,
    where_sql: String,
    table: String,
    budget: u64,
    building: Rc<Cell<Option<R::Id>>>,
    cancelled: Rc<Cell<bool>>,
}

/// Cancels a [`FilterJob`] from outside it.
#[derive(Clone)]
pub struct FilterHandle<R: Runner> {
    runner: R,
    building: Rc<Cell<Option<R::Id>>>,
    cancelled: Rc<Cell<bool>>,
}

impl<R: Runner> FilterHandle<R> {
    /// Stops the job: it answers `Ok(None)`, its index dropped.
    pub fn cancel(&self) {
        self.cancelled.set(true);
        if let Some(id) = self.building.take() {
            self.runner.cancel(id);
        }
    }
}

impl<R: Runner> FilterJob<R> {
    /// The SQL that writes the index: the row numbers the filter keeps, in
    /// the source's order.
    pub fn create_sql(&self) -> String {
        format!(
            "CREATE TABLE {} AS SELECT {ROW} FROM ({}) WHERE {} ORDER BY {ROW}",
            self.table, self.numbered, self.where_sql
        )
    }

    pub fn handle(&self) -> FilterHandle<R> {
        FilterHandle {
            runner: self.runner.clone(),
            building: self.building.clone(),
            cancelled: self.cancelled.clone(),
        }
    }

    /// Builds it: the index, or `None` if cancelled, or why not.
    pub async fn run(self) -> Result<Option<Filtered>, String> {
        let memory = read_memory(&self.runner).await;
        if self.cancelled.get() {
            return Ok(None);
        }
        let memory = memory?;
        if memory >= self.budget {
            return Err(full(memory));
        }
        let (id, created) = self.runner.query(&self.create_sql());
        self.building.set(Some(id));
        let created = created.await;
        self.building.set(None);
        if self.cancelled.get() {
            drop_table(&self.runner, &self.table);
            return Ok(None);
        }
        let rows = created_count(&created.map_err(|error| error.to_string())?)?;
        // No rows with DuckDB this full may be rows it didn't store: the
        // stored count against the filter's own.
        if rows == 0 && memory >= self.budget / 2 {
            let (_, counted) = self.runner.query(&format!(
                "SELECT count(*) AS Count FROM ({}) WHERE {}",
                self.numbered, self.where_sql
            ));
            let counted = created_count(&counted.await.map_err(|error| error.to_string())?)?;
            if counted > 0 {
                drop_table(&self.runner, &self.table);
                return Err(short(0, counted));
            }
        }
        Ok(Some(Filtered {
            where_sql: self.where_sql,
            table: self.table,
            rows,
        }))
    }
}

/// DuckDB's memory, read with [`MEMORY_SQL`].
async fn read_memory<R: Runner>(runner: &R) -> Result<u64, String> {
    let (_, answer) = runner.query(MEMORY_SQL);
    let answer = answer.await.map_err(|error| error.to_string())?;
    let at = column(&answer, "bytes")?;
    match answer.value(0, at) {
        Some(Value::Int(bytes)) => Ok(bytes.max(0) as u64),
        // `sum` of nothing.
        Some(Value::Null) | None => Ok(0),
        other => Err(format!("expected DuckDB's memory, got {other:?}")),
    }
}

/// A `CREATE TABLE … AS`'s answer (or a count's): its `Count`.
fn created_count(result: &QueryResult) -> Result<u64, String> {
    crate::sql::count(result, column(result, "Count")?)
}

fn full(memory: u64) -> String {
    format!(
        "DuckDB holds {} MiB already, too full to build on",
        memory >> 20
    )
}

fn short(stored: u64, expected: u64) -> String {
    format!(
        "DuckDB stored {stored} of the {expected} rows: it's out of memory (past ~2 GiB, DuckDB-Wasm drops rows without an error)"
    )
}

/// A preparation pages wait on: open once its table is built, or failed.
#[derive(Clone)]
struct Gate(Rc<RefCell<GateState>>);

#[cfg_attr(
    not(feature = "sort"),
    expect(dead_code, reason = "only a sort builds an order")
)]
enum GateState {
    Pending(Vec<Waker>),
    Open(Result<(), String>),
}

impl Gate {
    #[cfg_attr(
        not(feature = "sort"),
        expect(dead_code, reason = "only a sort builds an order")
    )]
    fn new() -> Self {
        Self(Rc::new(RefCell::new(GateState::Pending(Vec::new()))))
    }

    fn is_pending(&self) -> bool {
        matches!(*self.0.borrow(), GateState::Pending(_))
    }

    #[cfg_attr(
        not(feature = "sort"),
        expect(dead_code, reason = "only a sort builds an order")
    )]
    fn open(&self, result: Result<(), String>) {
        let before = std::mem::replace(&mut *self.0.borrow_mut(), GateState::Open(result));
        if let GateState::Pending(wakers) = before {
            for waker in wakers {
                waker.wake();
            }
        }
    }

    async fn wait(&self) -> Result<(), String> {
        std::future::poll_fn(|cx| match &mut *self.0.borrow_mut() {
            GateState::Open(result) => Poll::Ready(result.clone()),
            GateState::Pending(wakers) => {
                if !wakers.iter().any(|waker| waker.will_wake(cx.waker())) {
                    wakers.push(cx.waker().clone());
                }
                Poll::Pending
            }
        })
        .await
    }
}

/// A read's queries, each sent unless the table cancelled it first.
struct Reader<R: Runner> {
    runner: R,
    request: Rc<Request<R::Id>>,
}

impl<R: Runner> Reader<R> {
    async fn send(&self, sql: &str) -> Result<QueryResult, PageError> {
        if self.request.cancelled.get() {
            return Err(PageError::Cancelled);
        }
        let (id, answer) = self.runner.query(sql);
        self.request.sent.set(Some(id));
        let answer = answer.await;
        self.request.sent.set(None);
        answer.map_err(page_error)
    }
}

fn page_error(error: EngineError) -> PageError {
    match error {
        EngineError::Cancelled => PageError::Cancelled,
        error => PageError::Failed {
            read_failure: error.is_read_failure(),
            message: error.to_string(),
        },
    }
}

/// The view's rows `rows` (0-based, in its order) as a relation, each
/// with its place in the view as [`AT`] and its row number as [`ROW`]: a
/// filter's after one query for its slice's bounds, written into the SQL
/// (a join alone to a Parquet file read every row group a page: 25 s at
/// 1 GB, against 0.5 s with the bounds).
async fn rows_relation<R: Runner>(
    reader: &Reader<R>,
    kind: &Kind,
    numbered: &dyn Fn(Option<Range<u64>>) -> String,
    rows: Range<u64>,
) -> Result<String, PageError> {
    Ok(match kind {
        Kind::Source => format!("SELECT {ROW} AS {AT}, * FROM ({})", numbered(Some(rows))),
        Kind::Copy(table) => format!(
            "SELECT rowid AS {AT}, * FROM {table} WHERE rowid >= {} AND rowid < {}",
            rows.start, rows.end
        ),
        Kind::Index(table) => {
            let bounds = reader.send(&slice_bounds_sql(table, &rows)).await?;
            let read = |name| {
                column(&bounds, name)
                    .ok()
                    .and_then(|at| match bounds.value(0, at) {
                        Some(Value::Int(value)) => u64::try_from(value).ok(),
                        Some(Value::UInt(value)) => Some(value),
                        _ => None,
                    })
            };
            // An empty slice reads no row of the source.
            let range = match (read("lo"), read("hi")) {
                (Some(lo), Some(hi)) => lo..hi + 1,
                _ => 0..0,
            };
            slice_rows_sql(table, &rows, &numbered(Some(range)))
        }
    })
}

impl<Q: RowSource + Clone, R: Runner> TallTableDelegate for ViewRows<Q, R> {
    type Page = QueryResult;
    type Request = ViewRequest;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (ViewRequest, PageLoad<QueryResult>) {
        let (id, request) = self.request();
        let read = self.read_with(rows, request);
        let requests = self.requests.clone();
        let load = async move {
            let result = read.await;
            requests.borrow_mut().retain(|(held, _)| *held != id.0);
            result
        };
        (id, Box::pin(load))
    }

    fn cancel(&mut self, request: ViewRequest, _: &mut App) {
        let held = self
            .requests
            .borrow()
            .iter()
            .find(|(id, _)| *id == request.0)
            .map(|(_, held)| held.clone());
        if let Some(held) = held {
            held.cancelled.set(true);
            if let Some(id) = held.sent.take() {
                self.runner.cancel(id);
            }
        }
    }

    #[cfg(feature = "sort")]
    fn sort(
        &mut self,
        keys: &[seiza_tall_table::Sort],
        cx: &mut App,
    ) -> Result<(), seiza_tall_table::SortRefused> {
        use seiza_tall_table::{SortDirection, SortRefused};

        let [key] = keys else {
            if keys.is_empty() {
                self.set_order(None);
                return Ok(());
            }
            return Err(SortRefused::new("One column at a time"));
        };
        let rows = self.rows_in_view();
        if let Some(refused) = self.query.refuse_sort(rows) {
            return Err(SortRefused::new(refused));
        }
        if let Some(busy) = self.query.busy() {
            return Err(SortRefused::new(busy));
        }
        let Some(name) = self.columns.get(key.column) else {
            return Err(SortRefused::new("There's no such column"));
        };
        let direction = match key.direction {
            SortDirection::Ascending => "ASC",
            _ => "DESC",
        };
        let table = self.table_name();
        let filter = self
            .filter
            .as_ref()
            .map(|filter| format!(" WHERE {}", filter.where_sql))
            .unwrap_or_default();
        let create = format!(
            "CREATE TABLE {table} AS SELECT * FROM ({}){filter} ORDER BY {} {direction} NULLS LAST, {ROW}",
            self.query.numbered_sql(None),
            quote_identifier(name)
        );
        let order = Ordered {
            table: table.clone(),
            gate: Gate::new(),
            building: Rc::new(Cell::new(None)),
            current: Rc::new(Cell::new(true)),
        };
        let (gate, building, current) = (
            order.gate.clone(),
            order.building.clone(),
            order.current.clone(),
        );
        self.set_order(Some(order));
        let (runner, budget, listener) = (
            self.runner.clone(),
            self.settings.memory_budget,
            self.listener.clone(),
        );
        cx.spawn(async move |cx| {
            let built = async {
                let memory = read_memory(&runner).await?;
                if !current.get() {
                    return Ok(());
                }
                if memory >= budget {
                    return Err(full(memory));
                }
                let (id, created) = runner.query(&create);
                building.set(Some(id));
                let created = created.await;
                building.set(None);
                if !current.get() {
                    drop_table(&runner, &table);
                    return Ok(());
                }
                let stored = created_count(&created.map_err(|error| error.to_string())?)?;
                if stored != rows {
                    drop_table(&runner, &table);
                    return Err(short(stored, rows));
                }
                Ok(())
            }
            .await;
            if !current.get() {
                gate.open(Err("Sorted again".into()));
                return;
            }
            let event = match &built {
                Ok(()) => OrderEvent::Ready { rows },
                Err(message) => OrderEvent::Failed {
                    message: message.clone(),
                },
            };
            gate.open(built);
            if let Some(listener) = listener {
                cx.update(|cx| listener(&event, cx));
            }
        })
        .detach();
        Ok(())
    }

    #[cfg(feature = "find")]
    fn find(
        &mut self,
        query: &seiza_tall_table::FindQuery,
        _: &mut App,
    ) -> Option<(ViewRequest, seiza_tall_table::FindLoad)> {
        let flags = match_flags(&self.columns, query.term(), &query.columns)?;
        let (id, request) = self.request();
        let reader = Reader {
            runner: self.runner.clone(),
            request,
        };
        let kind = self.kind();
        let gate = self.order.as_ref().map(|order| order.gate.clone());
        let numbered = numbered_for(&self.query);
        let rows = self.rows_in_view();
        let query = query.clone();
        let requests = self.requests.clone();
        let load = async move {
            let result = async {
                if let Some(gate) = gate {
                    gate.wait().await.map_err(|message| PageError::Failed {
                        message,
                        read_failure: false,
                    })?;
                }
                find_in_windows(&reader, &kind, &*numbered, rows, &query, &flags).await
            }
            .await;
            requests.borrow_mut().retain(|(held, _)| *held != id.0);
            result
        };
        Some((id, Box::pin(load)))
    }
}

/// The source as it is now, for a read sent later: its numbered SQL for
/// any range.
fn numbered_for<Q: RowSource + Clone>(query: &Q) -> Rc<dyn Fn(Option<Range<u64>>) -> String> {
    let query = query.clone();
    Rc::new(move |rows| query.numbered_sql(rows))
}

/// The first rows a find window reads: then twice as many, to this. A
/// window holds DuckDB's worker while it runs, a page read waiting its
/// turn: on the 1 GB asteroids file a 2 M-row window took ~4.1 s, a 1 M-row
/// one ~2.3 s (`docs/DECISIONS.md`, "Table source", 2026-11-26).
#[cfg(feature = "find")]
const FIRST_WINDOW: u64 = 16_384;
#[cfg(feature = "find")]
const LAST_WINDOW: u64 = 1 << 20;

/// `query`'s first matching cell over `rows` rows of the view, a window at
/// a time (each its own query, so a cancel stops the scan between them and
/// page reads go between), the windows growing from 16,384 rows to
/// 1,048,576.
#[cfg(feature = "find")]
async fn find_in_windows<R: Runner>(
    reader: &Reader<R>,
    kind: &Kind,
    numbered: &dyn Fn(Option<Range<u64>>) -> String,
    rows: u64,
    query: &seiza_tall_table::FindQuery,
    flags: &[String],
) -> Result<Option<seiza_tall_table::FoundCell>, PageError> {
    use seiza_tall_table::FoundCell;

    let width = query.columns.len() as u64;
    if rows == 0 || width == 0 {
        return Ok(None);
    }
    let place = |cell: FoundCell| -> Option<u64> {
        let at = query
            .columns
            .iter()
            .position(|&index| index == cell.column)? as u64;
        Some(cell.row * width + at)
    };
    let total = rows * width;
    // Both ends inclusive, as positions in the order.
    let (first, last) = if query.backward {
        let first = match query.after {
            Some(cell) => place(cell).and_then(|p| p.checked_sub(1)),
            None => Some(total - 1),
        };
        (first, Some(query.until.and_then(place).unwrap_or(0)))
    } else {
        let first = match query.after {
            Some(cell) => place(cell).map(|p| p + 1),
            None => Some(0),
        };
        (
            first,
            Some(query.until.and_then(place).unwrap_or(total - 1)),
        )
    };
    let (Some(first), Some(last)) = (first, last) else {
        return Ok(None);
    };
    let (low, high) = if query.backward {
        (last, first.min(total - 1))
    } else {
        (first, last.min(total - 1))
    };
    if low > high {
        return Ok(None);
    }
    let (low_row, high_row) = (low / width, high / width);
    let any = flags.join(" OR ");
    let selected: Vec<String> = flags
        .iter()
        .enumerate()
        .map(|(at, flag)| format!("{flag} AS m{at}"))
        .collect();
    let direction = if query.backward { "DESC" } else { "ASC" };
    let tail = format!(" WHERE {any} ORDER BY {AT} {direction} LIMIT 3");
    let mut window = FIRST_WINDOW;
    let mut next = if query.backward { high_row } else { low_row };
    loop {
        let range = if query.backward {
            next.saturating_sub(window - 1).max(low_row)..next + 1
        } else {
            next..(next + window).min(high_row + 1)
        };
        let relation = rows_relation(reader, kind, numbered, range.clone()).await?;
        let sql = format!(
            "SELECT {AT}, {} FROM ({relation}){tail}",
            selected.join(", ")
        );
        let found = reader.send(&sql).await?;
        let at_column = column(&found, AT).map_err(|message| PageError::Failed {
            message,
            read_failure: false,
        })?;
        for row in 0..found.num_rows() {
            let Some(at) = (match found.value(row, at_column) {
                Some(Value::Int(at)) => u64::try_from(at).ok(),
                Some(Value::UInt(at)) => Some(at),
                _ => None,
            }) else {
                continue;
            };
            let places: Box<dyn Iterator<Item = usize>> = if query.backward {
                Box::new((0..query.columns.len()).rev())
            } else {
                Box::new(0..query.columns.len())
            };
            for place in places {
                let flag = column(&found, &format!("m{place}"))
                    .ok()
                    .and_then(|index| found.value(row, index));
                let position = at * width + place as u64;
                if matches!(flag, Some(Value::Bool(true))) && (low..=high).contains(&position) {
                    return Ok(Some(FoundCell::new(at, query.columns[place])));
                }
            }
        }
        if query.backward {
            if range.start <= low_row {
                return Ok(None);
            }
            next = range.start - 1;
        } else {
            if range.end > high_row {
                return Ok(None);
            }
            next = range.end;
        }
        window = (window * 2).min(LAST_WINDOW);
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;
    use std::ops::Range;
    use std::rc::Rc;
    use std::sync::Arc;

    use arrow::array::{ArrayRef, BooleanArray, Int64Array};
    use arrow::ipc::writer::StreamWriter;
    use arrow::record_batch::RecordBatch;
    use futures::channel::oneshot;
    use gpui_kit::{App, TestAppContext};
    use seiza_tall_table::{PageError, TallTableDelegate};

    use super::{Filtered, QueryLoad, ROW, RowSource, Runner, ViewRows, ViewSettings};
    use crate::EngineError;
    use crate::arrow::{QueryResult, decode};
    use crate::tall_table::PageQuery;

    fn result(columns: Vec<(&str, ArrayRef)>) -> QueryResult {
        let batch = RecordBatch::try_from_iter(columns).unwrap();
        let mut out = Vec::new();
        let mut writer = StreamWriter::try_new(&mut out, &batch.schema()).unwrap();
        writer.write(&batch).unwrap();
        writer.finish().unwrap();
        drop(writer);
        decode(out).unwrap()
    }

    fn ints(name: &str, values: Vec<Option<i64>>) -> QueryResult {
        result(vec![(name, Arc::new(Int64Array::from(values)) as ArrayRef)])
    }

    /// A source of `rows` rows, its SQL named so a test can read it.
    #[derive(Clone)]
    struct Source {
        rows: u64,
        busy: bool,
        refuse: Option<&'static str>,
    }

    impl PageQuery for Source {
        fn page_sql(&self, rows: Range<u64>) -> String {
            format!("PAGE {}..{}", rows.start, rows.end)
        }
    }

    impl RowSource for Source {
        fn numbered_sql(&self, rows: Option<Range<u64>>) -> String {
            match rows {
                Some(rows) => format!("NUMBERED {}..{}", rows.start, rows.end),
                None => "NUMBERED".into(),
            }
        }

        fn rows(&self) -> u64 {
            self.rows
        }

        fn busy(&self) -> Option<String> {
            self.busy.then(|| "still loading".into())
        }

        fn refuse_sort(&self, _: u64) -> Option<String> {
            self.refuse.map(Into::into)
        }
    }

    type Answer = Result<QueryResult, EngineError>;

    /// A query held back: its id, its SQL, and where its answer goes.
    type Held = (u32, String, oneshot::Sender<Answer>);

    /// Answers each query from a queue of answers by its SQL's start, or
    /// holds it until the test sends one; records what was sent and
    /// cancelled.
    #[derive(Clone, Default)]
    struct Fake {
        sent: Rc<RefCell<Vec<String>>>,
        cancelled: Rc<RefCell<Vec<u32>>>,
        next: Rc<Cell<u32>>,
        answers: Rc<RefCell<VecDeque<(&'static str, Answer)>>>,
        held: Rc<RefCell<Vec<Held>>>,
        /// SQL starting so is held, not answered.
        hold: Rc<RefCell<Vec<&'static str>>>,
    }

    impl Fake {
        fn answer(&self, start: &'static str, answer: Answer) {
            self.answers.borrow_mut().push_back((start, answer));
        }

        fn release(&self, start: &str, answer: Answer) {
            let mut held = self.held.borrow_mut();
            let at = held
                .iter()
                .position(|(_, sql, _)| sql.starts_with(start))
                .unwrap();
            let (_, _, sender) = held.remove(at);
            let _ = sender.send(answer);
        }

        fn sent(&self) -> Vec<String> {
            self.sent.borrow().clone()
        }
    }

    impl Runner for Fake {
        type Id = u32;

        fn query(&self, sql: &str) -> (u32, QueryLoad) {
            let id = self.next.get();
            self.next.set(id + 1);
            self.sent.borrow_mut().push(sql.to_owned());
            if self
                .hold
                .borrow()
                .iter()
                .any(|start| sql.starts_with(start))
            {
                let (sender, receiver) = oneshot::channel();
                self.held.borrow_mut().push((id, sql.to_owned(), sender));
                return (
                    id,
                    Box::pin(async move { receiver.await.unwrap_or(Err(EngineError::Cancelled)) }),
                );
            }
            let mut answers = self.answers.borrow_mut();
            let answer = match answers.iter().position(|(start, _)| sql.starts_with(start)) {
                Some(at) => answers.remove(at).unwrap().1,
                // Drops and anything unasked answer with nothing.
                None => Ok(ints("x", vec![])),
            };
            (id, Box::pin(async move { answer }))
        }

        fn cancel(&self, id: u32) {
            self.cancelled.borrow_mut().push(id);
            let mut held = self.held.borrow_mut();
            if let Some(at) = held.iter().position(|(held, ..)| *held == id) {
                let (_, _, sender) = held.remove(at);
                let _ = sender.send(Err(EngineError::Cancelled));
            }
        }
    }

    fn settings() -> ViewSettings {
        ViewSettings {
            database: "view".into(),
            prefix: String::new(),
            memory_budget: 1000,
        }
    }

    fn view(fake: &Fake) -> ViewRows<Source, Fake> {
        ViewRows::new(
            fake.clone(),
            Source {
                rows: 100,
                busy: false,
                refuse: None,
            },
            vec!["name".into(), "mass".into()],
            settings(),
        )
    }

    fn memory(bytes: i64) -> Answer {
        Ok(ints("bytes", vec![Some(bytes)]))
    }

    fn count(rows: i64) -> Answer {
        Ok(ints("Count", vec![Some(rows)]))
    }

    fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
        futures::executor::block_on(future)
    }

    /// Builds a filter's index of `rows` rows over `where_sql`.
    fn filtered(fake: &Fake, view: &ViewRows<Source, Fake>, rows: i64) -> Filtered {
        fake.answer("SELECT sum(memory_usage_bytes)", memory(10));
        fake.answer("CREATE TABLE", count(rows));
        block_on(view.filter_job("mass > 1".into()).unwrap().run())
            .unwrap()
            .unwrap()
    }

    #[test]
    fn a_filter_is_an_index_of_row_numbers_in_the_sources_order() {
        let fake = Fake::default();
        let view = view(&fake);
        let filtered = filtered(&fake, &view, 40);
        assert_eq!(filtered.rows(), 40);
        assert_eq!(
            fake.sent()[1],
            format!(
                "CREATE TABLE view.v0 AS SELECT {ROW} FROM (NUMBERED) WHERE mass > 1 ORDER BY {ROW}"
            )
        );
        // A busy source can't be filtered.
        let busy = ViewRows::new(
            fake.clone(),
            Source {
                rows: 1,
                busy: true,
                refuse: None,
            },
            vec![],
            settings(),
        );
        assert_eq!(
            busy.filter_job("TRUE".into()).err().as_deref(),
            Some("still loading")
        );
    }

    #[test]
    fn a_full_duckdb_builds_nothing_and_a_short_index_is_refused() {
        let fake = Fake::default();
        let view = view(&fake);
        fake.answer("SELECT sum(memory_usage_bytes)", memory(1000));
        let full = block_on(view.filter_job("TRUE".into()).unwrap().run()).unwrap_err();
        assert!(full.contains("too full"), "{full}");
        assert!(!fake.sent().iter().any(|sql| sql.starts_with("CREATE")));
        // No rows stored with DuckDB half full: the filter's own count
        // says there were some.
        fake.answer("SELECT sum(memory_usage_bytes)", memory(600));
        fake.answer("CREATE TABLE", count(0));
        fake.answer("SELECT count(*)", count(7));
        let short = block_on(view.filter_job("TRUE".into()).unwrap().run()).unwrap_err();
        assert!(short.contains("stored 0 of the 7 rows"), "{short}");
        assert!(
            fake.sent()
                .iter()
                .any(|sql| sql == "DROP TABLE IF EXISTS view.v1")
        );
        // With little memory, no rows is no rows.
        fake.answer("SELECT sum(memory_usage_bytes)", memory(10));
        fake.answer("CREATE TABLE", count(0));
        let none = block_on(view.filter_job("TRUE".into()).unwrap().run())
            .unwrap()
            .unwrap();
        assert_eq!(none.rows(), 0);
    }

    #[test]
    fn a_cancelled_filter_drops_its_index() {
        let fake = Fake::default();
        fake.hold.borrow_mut().push("CREATE TABLE");
        fake.answer("SELECT sum(memory_usage_bytes)", memory(10));
        let view = view(&fake);
        let job = view.filter_job("TRUE".into()).unwrap();
        let handle = job.handle();
        let mut run = Box::pin(job.run());
        // Runs to the CREATE, which waits.
        assert!(futures::FutureExt::now_or_never(&mut run).is_none());
        handle.cancel();
        assert_eq!(block_on(run), Ok(None));
        assert_eq!(fake.cancelled.borrow().len(), 1);
        assert!(
            fake.sent()
                .iter()
                .any(|sql| sql == "DROP TABLE IF EXISTS view.v0")
        );
    }

    #[gpui_kit::test]
    fn a_filters_page_reads_its_slice_between_its_bounds(cx: &mut TestAppContext) {
        let fake = Fake::default();
        let mut view = view(&fake);
        // No filter: the source's own page.
        fake.answer("PAGE", Ok(ints("name", vec![Some(1)])));
        let page = cx.update(|cx| view.load_page(0..10, cx).1);
        block_on(page).unwrap();
        assert_eq!(fake.sent().last().unwrap(), "PAGE 0..10");
        let filtered = filtered(&fake, &view, 40);
        view.set_filter(Some(filtered));
        assert_eq!(view.rows_in_view(), 40);
        fake.answer(
            "SELECT min(",
            Ok(result(vec![
                ("lo", Arc::new(Int64Array::from(vec![Some(17)])) as ArrayRef),
                ("hi", Arc::new(Int64Array::from(vec![Some(93)])) as ArrayRef),
            ])),
        );
        let page = cx.update(|cx| view.load_page(10..20, cx).1);
        block_on(page).unwrap();
        let sent = fake.sent();
        assert_eq!(
            sent[sent.len() - 2],
            format!(
                "SELECT min({ROW}) AS lo, max({ROW}) AS hi FROM view.v0 WHERE rowid >= 10 AND rowid < 20"
            )
        );
        assert_eq!(
            sent[sent.len() - 1],
            format!(
                "SELECT * EXCLUDE (__seiza_at, {ROW}) FROM (SELECT i.__seiza_at, s.* FROM (SELECT {ROW}, rowid AS __seiza_at \
                 FROM view.v0 WHERE rowid >= 10 AND rowid < 20) i JOIN (NUMBERED 17..94) s ON s.{ROW} = i.{ROW}) ORDER BY __seiza_at"
            )
        );
        // An empty slice reads no row of the source.
        fake.answer(
            "SELECT min(",
            Ok(result(vec![
                (
                    "lo",
                    Arc::new(Int64Array::from(vec![None::<i64>])) as ArrayRef,
                ),
                (
                    "hi",
                    Arc::new(Int64Array::from(vec![None::<i64>])) as ArrayRef,
                ),
            ])),
        );
        let page = cx.update(|cx| view.load_page(40..50, cx).1);
        block_on(page).unwrap();
        assert!(fake.sent().last().unwrap().contains("(NUMBERED 0..0)"));
        // Taking the filter off drops its index.
        view.set_filter(None);
        assert_eq!(fake.sent().last().unwrap(), "DROP TABLE IF EXISTS view.v0");
        assert_eq!(view.rows_in_view(), 100);
    }

    #[gpui_kit::test]
    fn a_page_cancelled_before_its_read_sends_nothing(cx: &mut TestAppContext) {
        let fake = Fake::default();
        fake.hold.borrow_mut().push("SELECT min(");
        let mut view = view(&fake);
        let filtered = filtered(&fake, &view, 40);
        view.set_filter(Some(filtered));
        let (id, page) = cx.update(|cx| view.load_page(0..10, cx));
        let mut page = Box::pin(page);
        assert!(futures::FutureExt::now_or_never(&mut page).is_none());
        cx.update(|cx| view.cancel(id, cx));
        assert_eq!(block_on(page).unwrap_err(), PageError::Cancelled);
        // Its bounds' query was cancelled, and its rows never asked.
        assert_eq!(fake.cancelled.borrow().len(), 1);
        assert!(!fake.sent().last().unwrap().contains("JOIN"));
    }

    #[gpui_kit::test]
    fn a_sort_is_a_copy_its_pages_wait_for(cx: &mut TestAppContext) {
        use seiza_tall_table::{Sort, SortDirection};

        let fake = Fake::default();
        let mut view = view(&fake);
        let filtered = filtered(&fake, &view, 40);
        fake.hold.borrow_mut().push("CREATE TABLE");
        view.set_filter(Some(filtered));
        let heard = Rc::new(RefCell::new(Vec::new()));
        let hearing = heard.clone();
        view.on_order(move |event, _: &mut App| hearing.borrow_mut().push(event.clone()));
        fake.answer("SELECT sum(memory_usage_bytes)", memory(10));
        cx.update(|cx| view.sort(&[Sort::new(1, SortDirection::Descending)], cx))
            .unwrap();
        cx.run_until_parked();
        assert!(view.sorting());
        let create = fake.held.borrow()[0].1.clone();
        assert_eq!(
            create,
            format!(
                "CREATE TABLE view.v1 AS SELECT * FROM (NUMBERED) WHERE mass > 1 ORDER BY \"mass\" DESC NULLS LAST, {ROW}"
            )
        );
        // A page waits for the copy.
        let page = cx.update(|cx| view.load_page(0..10, cx).1);
        let mut page = Box::pin(page);
        assert!(futures::FutureExt::now_or_never(&mut page).is_none());
        fake.release("CREATE TABLE", count(40));
        cx.run_until_parked();
        assert!(!view.sorting());
        assert_eq!(*heard.borrow(), [super::OrderEvent::Ready { rows: 40 }]);
        fake.answer("SELECT * EXCLUDE", Ok(ints("name", vec![Some(1)])));
        block_on(page).unwrap();
        assert_eq!(
            fake.sent().last().unwrap(),
            &format!(
                "SELECT * EXCLUDE ({ROW}) FROM view.v1 WHERE rowid >= 0 AND rowid < 10 ORDER BY rowid"
            )
        );
        // Another sort while one builds cancels it; its copy is dropped.
        fake.answer("SELECT sum(memory_usage_bytes)", memory(10));
        cx.update(|cx| view.sort(&[Sort::new(0, SortDirection::Ascending)], cx))
            .unwrap();
        cx.run_until_parked();
        assert!(
            fake.sent()
                .contains(&"DROP TABLE IF EXISTS view.v1".to_owned())
        );
        fake.answer("SELECT sum(memory_usage_bytes)", memory(10));
        cx.update(|cx| view.sort(&[Sort::new(1, SortDirection::Ascending)], cx))
            .unwrap();
        cx.run_until_parked();
        assert_eq!(fake.cancelled.borrow().len(), 1);
        assert!(
            fake.sent()
                .contains(&"DROP TABLE IF EXISTS view.v2".to_owned())
        );
        // A short copy fails its pages, and is said.
        fake.release("CREATE TABLE", count(39));
        cx.run_until_parked();
        assert!(
            matches!(heard.borrow().last(), Some(super::OrderEvent::Failed { message }) if message.contains("39 of the 40"))
        );
        let page = cx.update(|cx| view.load_page(0..10, cx).1);
        assert!(matches!(block_on(page), Err(PageError::Failed { .. })));
        // None goes back to the filter's index.
        cx.update(|cx| view.sort(&[], cx)).unwrap();
        assert!(!view.sorting());
        // Refused: two keys, a source that says so, a busy one.
        let two = [
            Sort::new(0, SortDirection::Ascending),
            Sort::new(1, SortDirection::Ascending),
        ];
        assert!(cx.update(|cx| view.sort(&two, cx)).is_err());
        let mut refusing = ViewRows::new(
            fake.clone(),
            Source {
                rows: 1,
                busy: false,
                refuse: Some("too large"),
            },
            vec!["a".into()],
            settings(),
        );
        let refused = cx
            .update(|cx| refusing.sort(&[Sort::new(0, SortDirection::Ascending)], cx))
            .unwrap_err();
        assert_eq!(refused.message, "too large");
    }

    #[gpui_kit::test]
    fn a_views_tables_are_its_own_and_go_with_it(cx: &mut TestAppContext) {
        use seiza_tall_table::{Sort, SortDirection};

        let fake = Fake::default();
        let mut view = ViewRows::new(
            fake.clone(),
            Source {
                rows: 100,
                busy: false,
                refuse: None,
            },
            vec!["name".into(), "mass".into()],
            ViewSettings {
                prefix: "f7_".into(),
                ..settings()
            },
        );
        let filtered = filtered(&fake, &view, 40);
        assert!(fake.sent()[1].starts_with("CREATE TABLE view.f7_v0 AS"));
        view.set_filter(Some(filtered));
        fake.hold.borrow_mut().push("CREATE TABLE");
        fake.answer("SELECT sum(memory_usage_bytes)", memory(10));
        cx.update(|cx| view.sort(&[Sort::new(0, SortDirection::Ascending)], cx))
            .unwrap();
        cx.run_until_parked();
        // Closed while its copy builds: the filter's index goes at once, the
        // copy once its CREATE answers.
        view.close();
        assert!(
            fake.sent()
                .contains(&"DROP TABLE IF EXISTS view.f7_v0".to_owned())
        );
        assert_eq!(fake.cancelled.borrow().len(), 1);
        cx.run_until_parked();
        assert!(
            fake.sent()
                .contains(&"DROP TABLE IF EXISTS view.f7_v1".to_owned())
        );
        assert!(!view.sorting() && !view.filtered());
    }

    #[gpui_kit::test]
    fn find_scans_windows_in_the_views_order(cx: &mut TestAppContext) {
        use seiza_tall_table::{FindQuery, FoundCell};

        let fake = Fake::default();
        let mut view = view(&fake);
        let window = |rows: Vec<(i64, bool, bool)>| -> Answer {
            Ok(result(vec![
                (
                    "__seiza_at",
                    Arc::new(Int64Array::from(
                        rows.iter().map(|r| r.0).collect::<Vec<_>>(),
                    )) as ArrayRef,
                ),
                (
                    "m0",
                    Arc::new(BooleanArray::from(
                        rows.iter().map(|r| r.1).collect::<Vec<_>>(),
                    )) as ArrayRef,
                ),
                (
                    "m1",
                    Arc::new(BooleanArray::from(
                        rows.iter().map(|r| r.2).collect::<Vec<_>>(),
                    )) as ArrayRef,
                ),
            ]))
        };
        // Forward from row 3's first cell (column 1, place 0): row 3
        // matches only there, row 7 in both.
        fake.answer(
            "SELECT __seiza_at",
            window(vec![(3, true, false), (7, true, true)]),
        );
        let query = FindQuery::new("Ce", vec![1, 0], Some(FoundCell::new(3, 1)), None, false);
        let found = cx.update(|cx| view.find(&query, cx)).unwrap().1;
        assert_eq!(block_on(found).unwrap(), Some(FoundCell::new(7, 1)));
        let sql = fake.sent().last().unwrap().clone();
        assert!(
            sql.contains(
                r#"coalesce(contains(lower(CAST("mass" AS VARCHAR)), lower('Ce')), false) AS m0"#
            ),
            "{sql}"
        );
        assert!(
            sql.contains("(NUMBERED 3..100)") && sql.ends_with("ORDER BY __seiza_at ASC LIMIT 3"),
            "{sql}"
        );
        // Backward, none in the window: none to the start.
        fake.answer("SELECT __seiza_at", window(vec![]));
        let back = FindQuery::new("x", vec![0, 1], None, None, true);
        let found = cx.update(|cx| view.find(&back, cx)).unwrap().1;
        assert_eq!(block_on(found).unwrap(), None);
        assert!(fake.sent().last().unwrap().contains("(NUMBERED 0..100)"));
        // A term with a quote is a literal.
        fake.answer("SELECT __seiza_at", window(vec![]));
        let quoted = FindQuery::new("it's", vec![0], None, None, false);
        block_on(cx.update(|cx| view.find(&quoted, cx)).unwrap().1).unwrap();
        assert!(fake.sent().last().unwrap().contains("lower('it''s')"));
        // The count and the place's SQL.
        let count = view.find_count_sql("Ce", &[1, 0]).unwrap();
        assert!(
            count.starts_with("SELECT coalesce(sum((coalesce(contains(lower(CAST(\"mass\""),
            "{count}"
        );
        let place = view.find_place_sql("Ce", &[1, 0], 7, 0).unwrap();
        assert!(
            place.contains("WHEN __seiza_at < 7") && place.contains("WHERE __seiza_at <= 7"),
            "{place}"
        );
        assert!(view.find_place_sql("Ce", &[1], 7, 0).is_none());
    }
}
