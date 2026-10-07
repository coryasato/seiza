//! The workbench: Tycho's one window. Empty until a file or sample is
//! opened; then a header strip describes the file, above its rows.
//!
//! A file comes from a drop anywhere on the page, the file dialog, or the
//! sample button. A Parquet file goes through one pipeline (register, read
//! the footer's metadata, page rows: M3/M4); a CSV through another (cut into
//! chunks, each copied into a table, the rows growing as they come: M6,
//! `crate::csv`). A new file replaces the current one, whether it's still
//! opening or already showing rows: its queries are cancelled, its answers
//! ignored, and a CSV's tables dropped.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::empty::{Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle};
use gpui_kit::component::tag::Tag;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Sizable as _, StyledExt as _, h_flex, v_flex,
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::dataset::{FileSummary, format_bytes, format_count};
use crate::engine::EngineStatus;
#[cfg(target_family = "wasm")]
use crate::table::RowSource;
use crate::table::RowTable;
#[cfg(target_family = "wasm")]
use crate::table::TableEvent;

/// What's being opened or shown: the sample, or a file from this device.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Origin {
    Sample,
    Device,
}

impl Origin {
    /// The `performance.mark`s and panel steps an open reports under.
    #[cfg(target_family = "wasm")]
    fn marks(self) -> Marks {
        match self {
            Self::Sample => Marks {
                start: "tycho:sample-click",
                shown: "tycho:sample-shown",
                schema_step: "Sample → schema",
                first_rows_step: "Sample → first rows",
            },
            Self::Device => Marks {
                start: "tycho:file-open",
                shown: "tycho:file-shown",
                schema_step: "File → schema",
                first_rows_step: "File → first rows",
            },
        }
    }
}

#[cfg(target_family = "wasm")]
#[derive(Clone, Copy)]
struct Marks {
    /// The click, drop, or dialog choice.
    start: &'static str,
    /// Right after the first frame showing the summary.
    shown: &'static str,
    /// The panel's steps, in [`OPEN_STEPS`]. The perf scripts read them by
    /// name; don't rename them.
    schema_step: &'static str,
    first_rows_step: &'static str,
}

/// The panel's waterfall section for the current open, timed from the
/// click, drop, or choice.
#[cfg(target_family = "wasm")]
const OPEN_STEPS: &str = "Open";

/// The panel's rows for the open file, refreshed while it's open.
#[cfg(target_family = "wasm")]
const READ_METRIC: &str = "Read";
#[cfg(target_family = "wasm")]
const ROWS_PER_S_METRIC: &str = "Rows/s (2 s)";
#[cfg(target_family = "wasm")]
const CACHE_HITS_METRIC: &str = "Cache hits (2 s)";
#[cfg(target_family = "wasm")]
const PAGES_METRIC: &str = "Pages";

#[cfg(target_family = "wasm")]
impl Marks {
    /// A new open: its steps start, and the last open's go.
    fn start(self, started_at: f64, cx: &mut App) {
        use seiza::LoadStep;
        seiza::perf::clear_load_section(cx, OPEN_STEPS);
        seiza::perf::set_load_step(
            cx,
            OPEN_STEPS,
            self.schema_step,
            LoadStep::running(started_at),
        );
        seiza::perf::set_load_step(
            cx,
            OPEN_STEPS,
            self.first_rows_step,
            LoadStep::running(started_at),
        );
    }

    /// The open failed before its schema showed.
    fn fail(self, started_at: f64, cx: &mut App) {
        use seiza::LoadStep;
        let now = crate::engine::now();
        seiza::perf::set_load_step(
            cx,
            OPEN_STEPS,
            self.schema_step,
            LoadStep::failed(started_at, now),
        );
        seiza::perf::set_load_step(
            cx,
            OPEN_STEPS,
            self.first_rows_step,
            LoadStep::skipped(started_at),
        );
    }
}

#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens files")
)]
enum Load {
    Idle,
    /// Registering the file and reading its metadata. If the engine is still
    /// loading, the bridge holds the calls until it's ready.
    Opening {
        origin: Origin,
        name: SharedString,
        /// Dropping it stops the open at its next await. None for a CSV,
        /// whose task runs on to drop its tables (`csv`).
        #[cfg(target_family = "wasm")]
        _task: Option<Task<()>>,
        /// The metadata queries sent so far, to cancel if a new file comes.
        #[cfg(target_family = "wasm")]
        sent: std::rc::Rc<std::cell::RefCell<Vec<crate::engine::RequestId>>>,
        #[cfg(target_family = "wasm")]
        csv: Option<crate::csv::Stop>,
    },
    Open {
        summary: FileSummary,
        table: Entity<RowTable>,
        /// A CSV's load, which runs on after its first rows show.
        csv: Option<CsvLoad>,
    },
    Failed {
        origin: Origin,
        name: SharedString,
        message: SharedString,
    },
}

impl Load {
    fn opening(&self, which: Origin) -> bool {
        matches!(self, Self::Opening { origin, .. } if *origin == which)
    }
}

/// Where a CSV's load is.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens files")
)]
#[derive(Debug, Clone, PartialEq)]
enum IngestState {
    Loading,
    Done,
    /// A chunk failed; the rows before it stay.
    Stopped(SharedString),
}

/// A CSV's load, for the header strip and the overlay's load stats.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens files")
)]
struct CsvLoad {
    state: IngestState,
    bytes: u64,
    read: u64,
    chunks: u64,
    /// The slowest chunk: the longest the row count went without updating.
    slowest_ms: f64,
    /// ms from `timeOrigin`: when the file was dropped or picked, and when
    /// its last chunk was in.
    started_at: f64,
    finished_at: Option<f64>,
    /// Columns a later chunk turned into text, with the type they had and
    /// the rows before the chunk that did.
    widened: Vec<(String, String, u64)>,
    /// Which open it is: its tables are `tycho_csv.f<open>.*`.
    #[cfg(target_family = "wasm")]
    open: u64,
    #[cfg(target_family = "wasm")]
    stop: crate::csv::Stop,
}

impl CsvLoad {
    fn state_name(&self) -> &'static str {
        match self.state {
            IngestState::Loading => "loading",
            IngestState::Done => "done",
            IngestState::Stopped(_) => "stopped",
        }
    }

    /// Megabytes (10^6) per second, from the drop to `until`.
    fn throughput(&self, until: f64) -> f64 {
        self.read as f64 / 1e6 / ((until - self.started_at) / 1000.0).max(0.001)
    }

    /// The header strip's words for it.
    fn describe(&self, now: f64) -> String {
        match (&self.state, self.finished_at) {
            (IngestState::Done, Some(finished)) => format!(
                "loaded in {:.1} s · {:.1} MB/s",
                (finished - self.started_at) / 1000.0,
                self.throughput(finished)
            ),
            (IngestState::Stopped(_), _) => format!(
                "stopped at {:.0}%",
                self.read as f64 * 100.0 / self.bytes.max(1) as f64
            ),
            _ => format!(
                "loading {:.0}% · {:.1} MB/s",
                self.read as f64 * 100.0 / self.bytes.max(1) as f64,
                self.throughput(now)
            ),
        }
    }
}

/// The overlay's CSV load stats.
#[cfg(target_family = "wasm")]
const CSV_LOAD_METRIC: &str = "CSV load";
#[cfg(target_family = "wasm")]
const CSV_CHUNKS_METRIC: &str = "CSV chunks";
/// Set right after each frame that shows a CSV's row count grow, and after
/// the one that shows its load done (with `?perf` or `?bench`).
#[cfg(target_family = "wasm")]
const CSV_ROWS_MARK: &str = "tycho:csv-rows";
#[cfg(target_family = "wasm")]
const CSV_DONE_MARK: &str = "tycho:csv-done";

/// A line about the last file choice that didn't replace what's shown: a
/// file Tycho can't open, or extra files in one drop.
#[derive(Clone)]
struct Notice {
    text: SharedString,
    error: bool,
}

#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens files")
)]
pub struct Workbench {
    load: Load,
    notice: Option<Notice>,
    /// Files are being dragged over the page.
    dragging: bool,
    /// Counts opens; each file registers under its own SQL name (see
    /// [`Workbench::open_file`]), and a sniff whose count is stale is dropped.
    opens: u64,
    /// Reading a chosen file's first and last bytes (`files::sniff`). A newer
    /// choice replaces it.
    #[cfg(target_family = "wasm")]
    sniffing: Option<Task<()>>,
    /// When the current open started (ms from `timeOrigin`), and, until the
    /// first render showing its summary, the marks to set then.
    #[cfg(target_family = "wasm")]
    opened_at: f64,
    #[cfg(target_family = "wasm")]
    mark_shown: Option<Marks>,
    /// A CSV's rows and load state as last rendered, to mark each frame
    /// that shows them change.
    #[cfg(target_family = "wasm")]
    shown_csv: Option<(u64, &'static str)>,
    /// What DuckDB has read of the open Parquet file (a CSV counts its own).
    #[cfg(target_family = "wasm")]
    read_counter: Option<crate::engine::ReadCounter>,
    _engine_status: Subscription,
}

impl Workbench {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        #[cfg(target_family = "wasm")]
        crate::files::listen(cx.entity().downgrade(), window.window_handle(), cx);
        #[cfg(not(target_family = "wasm"))]
        let _ = window;
        #[cfg(target_family = "wasm")]
        {
            // Rows in this order, before any file adds its own.
            for metric in [
                READ_METRIC,
                ROWS_PER_S_METRIC,
                CACHE_HITS_METRIC,
                PAGES_METRIC,
            ] {
                seiza::perf::set_metric(cx, metric, "—");
            }
            let this = cx.entity().downgrade();
            seiza::perf::on_refresh(cx, move |cx| {
                if let Some(this) = this.upgrade() {
                    this.update(cx, |this, cx| this.refresh_panel(cx));
                }
            });
        }
        Self {
            load: Load::Idle,
            notice: None,
            dragging: false,
            opens: 0,
            #[cfg(target_family = "wasm")]
            sniffing: None,
            #[cfg(target_family = "wasm")]
            opened_at: 0.0,
            #[cfg(target_family = "wasm")]
            mark_shown: None,
            #[cfg(target_family = "wasm")]
            shown_csv: None,
            #[cfg(target_family = "wasm")]
            read_counter: None,
            _engine_status: cx.observe_global::<EngineStatus>(|_, cx| cx.notify()),
        }
    }

    /// Opens the asteroid sample by URL.
    #[cfg(target_family = "wasm")]
    fn open_sample(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        use crate::dataset::ASTEROIDS;
        use crate::engine::FileSource;

        if self.load.opening(Origin::Sample) {
            return;
        }
        self.sniffing = None;
        self.notice = None;
        self.open(
            Origin::Sample,
            ASTEROIDS.name.into(),
            ASTEROIDS.name.into(),
            FileSource::Url(ASTEROIDS.url.into()),
            crate::engine::now(),
            window,
            cx,
        );
    }

    #[cfg(not(target_family = "wasm"))]
    fn open_sample(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {}

    #[cfg(target_family = "wasm")]
    fn pick_file(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {
        crate::files::pick();
    }

    #[cfg(not(target_family = "wasm"))]
    fn pick_file(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {}

    /// A file was dropped or picked at `at`. Its first and last bytes decide
    /// first: a file Tycho can't open gets a message and leaves the current
    /// file where it is.
    #[cfg(target_family = "wasm")]
    fn file_chosen(
        &mut self,
        file: web_sys::File,
        at: f64,
        more: u32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::files::{Kind, sniff};

        let format_hint = "Tycho opens Parquet and CSV (.csv, .tsv) files.";

        self.opens += 1;
        let open = self.opens;
        self.sniffing = Some(cx.spawn_in(window, async move |this, cx| {
            let kind = sniff(&file).await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.opens != open {
                    return;
                }
                this.sniffing = None;
                let name = SharedString::from(file.name());
                let refused = match &kind {
                    Ok(Kind::Parquet | Kind::Csv) => None,
                    Ok(Kind::EncryptedParquet) => Some(format!(
                        "{name} is an encrypted Parquet file. Tycho can't read those."
                    )),
                    Ok(Kind::CompressedCsv) => Some(format!(
                        "{name} is compressed. Unzip it, then open the CSV inside."
                    )),
                    Ok(Kind::Empty) => Some(format!("{name} is empty.")),
                    Ok(Kind::Other) => Some(format!(
                        "{name} isn't a Parquet or CSV file (no PAR1 marker at its ends, not named .csv or .tsv). {format_hint}"
                    )),
                    Err(error) => Some(format!("Couldn't read {name}: {error}")),
                };
                if let Some(text) = refused {
                    this.notice = Some(Notice {
                        text: text.into(),
                        error: true,
                    });
                    cx.notify();
                    return;
                }
                this.notice = (more > 0).then(|| Notice {
                    text: format!(
                        "Opened {name}, the first of {} files. Tycho shows one file at a time.",
                        more + 1
                    )
                    .into(),
                    error: false,
                });
                if kind == Ok(Kind::Csv) {
                    this.open_csv(name, file, open, at, window, cx);
                    return;
                }
                let sql_name = format!("file-{open}.parquet");
                this.open(
                    Origin::Device,
                    name,
                    sql_name,
                    crate::engine::FileSource::File(file),
                    at,
                    window,
                    cx,
                );
            });
        }));
    }

    /// Stops whatever is loading or showing, so a new file can take over.
    #[cfg(target_family = "wasm")]
    fn close_current(&mut self, cx: &mut Context<Self>) {
        let engine = cx.global::<crate::engine::Engine>().clone();
        match std::mem::replace(&mut self.load, Load::Idle) {
            Load::Opening { sent, csv, .. } => {
                // The task is dropped with the state; its sent queries go on
                // in DuckDB unless cancelled.
                for request in sent.borrow().iter() {
                    engine.cancel(*request);
                }
                if let Some(csv) = csv {
                    csv.stop(&engine);
                }
            }
            Load::Open { table, csv, .. } => {
                table.update(cx, |table, _| table.close());
                match csv {
                    // Still loading: the load task drops the tables once its
                    // query answers.
                    Some(load) if load.state == IngestState::Loading => load.stop.stop(&engine),
                    // Done or stopped: the task has ended, so drop them here.
                    // A page read DuckDB already started on them answers
                    // first (the drop waits its turn behind it).
                    Some(load) => drop(engine.query(&crate::csv::drop_sql(load.open)).1),
                    None => {}
                }
            }
            Load::Idle | Load::Failed { .. } => {}
        }
        seiza::perf::set_metric(cx, CSV_LOAD_METRIC, "—");
        seiza::perf::set_metric(cx, CSV_CHUNKS_METRIC, "—");
        self.shown_csv = None;
        self.mark_shown = None;
        self.read_counter = None;
    }

    /// Registers `source` as `sql_name` and reads its summary, then shows its
    /// rows. `name` is what the header shows. The SQL name is ours, never the
    /// file's: `read_parquet` would expand a name like `data[1].parquet` as a
    /// glob. `started_at` is the click, drop, or choice.
    #[cfg(target_family = "wasm")]
    #[expect(
        clippy::too_many_arguments,
        reason = "the one place every open goes through"
    )]
    fn open(
        &mut self,
        origin: Origin,
        name: SharedString,
        sql_name: String,
        source: crate::engine::FileSource,
        started_at: f64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use std::cell::RefCell;
        use std::rc::Rc;

        use crate::engine::Engine;

        self.close_current(cx);
        let marks = origin.marks();
        self.opened_at = started_at;
        mark_at(marks.start, started_at);
        marks.start(started_at, cx);

        let engine = cx.global::<Engine>().clone();
        let sent = Rc::new(RefCell::new(Vec::new()));
        let task = {
            let (sent, name) = (sent.clone(), name.clone());
            cx.spawn_in(window, async move |this, cx| {
                let result = crate::dataset::open(&engine, &sql_name, &name, source, |id| {
                    sent.borrow_mut().push(id)
                })
                .await;
                let _ = this.update_in(cx, |this, window, cx| {
                    this.load = match result {
                        Ok((summary, read_counter)) => {
                            this.mark_shown = Some(marks);
                            this.read_counter = read_counter;
                            crate::engine::show_parquet_ready(cx, &engine);
                            let table = cx.new(|cx| {
                                RowTable::new(
                                    RowSource::Parquet(sql_name),
                                    summary.rows,
                                    &summary.columns,
                                    engine,
                                    cx,
                                )
                            });
                            this.watch_table(&table, marks, started_at, cx);
                            let focus = table.read(cx).focus_handle().clone();
                            window.focus(&focus, cx);
                            Load::Open {
                                summary,
                                table,
                                csv: None,
                            }
                        }
                        Err(error) => {
                            // Queries still running (a failed DESCRIBE leaves
                            // the other two) would hold up the next open.
                            let engine = cx.global::<Engine>();
                            for request in sent.borrow().iter() {
                                engine.cancel(*request);
                            }
                            // The failure says it all; an "Opened …, the first
                            // of N files" line would bury it.
                            this.notice = None;
                            marks.fail(started_at, cx);
                            Load::Failed {
                                origin,
                                name,
                                message: error.to_string().into(),
                            }
                        }
                    };
                    cx.notify();
                });
            })
        };
        self.load = Load::Opening {
            origin,
            name,
            _task: Some(task),
            sent,
            csv: None,
        };
        cx.notify();
    }

    /// Opens a CSV file: its first chunk becomes a table (schema and first
    /// rows), then the rest follows a chunk at a time while the table
    /// scrolls. One task does it all, detached, so a stop still drops the
    /// tables (see [`CsvStop`]).
    #[cfg(target_family = "wasm")]
    fn open_csv(
        &mut self,
        name: SharedString,
        file: web_sys::File,
        open: u64,
        started_at: f64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::csv::Ingest;
        use crate::engine::{Engine, EngineError};

        self.close_current(cx);
        let marks = Origin::Device.marks();
        self.opened_at = started_at;
        mark_at(marks.start, started_at);
        marks.start(started_at, cx);
        seiza::perf::set_metric(cx, CSV_LOAD_METRIC, "…");

        let engine = cx.global::<Engine>().clone();
        let stop = crate::csv::Stop::default();
        {
            let (stop, name) = (stop.clone(), name.clone());
            cx.spawn_in(window, async move |this, cx| {
                let first = async {
                    let mut ingest =
                        Ingest::start(engine.clone(), file, open, stop.clone()).await?;
                    if stop.stopped() {
                        return Err(EngineError::Cancelled);
                    }
                    match ingest.next().await {
                        Some(Ok(chunk)) => Ok((ingest, chunk)),
                        Some(Err(error)) => Err(error),
                        None => Err(EngineError::Engine("it has no rows".into())),
                    }
                }
                .await;
                let keep = match first {
                    _ if stop.stopped() => false,
                    Err(error) => {
                        let _ = this.update(cx, |this, cx| {
                            this.notice = None;
                            marks.fail(started_at, cx);
                            seiza::perf::set_metric(cx, CSV_LOAD_METRIC, "failed");
                            this.load = Load::Failed {
                                origin: Origin::Device,
                                name,
                                message: error.to_string().into(),
                            };
                            cx.notify();
                        });
                        false
                    }
                    Ok((mut ingest, chunk)) => {
                        let shown = this.update_in(cx, |this, window, cx| {
                            this.csv_opened(
                                name,
                                &ingest,
                                chunk,
                                open,
                                stop.clone(),
                                started_at,
                                window,
                                cx,
                            )
                        });
                        let mut keep = shown.is_ok();
                        while keep {
                            let next = ingest.next().await;
                            if stop.stopped() {
                                keep = false;
                                break;
                            }
                            let last = !matches!(next, Some(Ok(_)));
                            keep = this
                                .update(cx, |this, cx| this.csv_progress(next, cx))
                                .is_ok();
                            if last {
                                break;
                            }
                        }
                        keep
                    }
                };
                if !keep {
                    // Whatever DuckDB was doing for this file has answered
                    // (the loop waits on it), so its tables can go.
                    let _ = engine.query(&crate::csv::drop_sql(open)).1.await;
                }
            })
            .detach();
        }
        self.load = Load::Opening {
            origin: Origin::Device,
            name,
            _task: None,
            sent: Default::default(),
            csv: Some(stop),
        };
        cx.notify();
    }

    /// A CSV's first chunk is a table: show it.
    #[cfg(target_family = "wasm")]
    #[expect(
        clippy::too_many_arguments,
        reason = "the hand-off from the load task to the view"
    )]
    fn csv_opened(
        &mut self,
        name: SharedString,
        ingest: &crate::csv::Ingest,
        chunk: crate::csv::Chunk,
        open: u64,
        stop: crate::csv::Stop,
        started_at: f64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let marks = Origin::Device.marks();
        let summary = FileSummary {
            name: name.to_string(),
            bytes: Some(ingest.size() as u64),
            rows: chunk.rows,
            row_groups: None,
            columns: ingest.columns().to_vec(),
            credit: None,
        };
        let mut chunks = crate::csv::Chunks::new(ingest.row_column());
        chunks.push(chunk.table, chunk.rows);
        let engine = cx.global::<crate::engine::Engine>().clone();
        let table = cx.new(|cx| {
            RowTable::new(
                RowSource::Csv(chunks),
                summary.rows,
                &summary.columns,
                engine,
                cx,
            )
        });
        self.watch_table(&table, marks, started_at, cx);
        let focus = table.read(cx).focus_handle().clone();
        window.focus(&focus, cx);
        let mut load = CsvLoad {
            state: IngestState::Loading,
            bytes: ingest.size() as u64,
            read: chunk.bytes_read as u64,
            chunks: 1,
            slowest_ms: chunk.ms,
            started_at,
            finished_at: None,
            widened: Vec::new(),
            open,
            stop,
        };
        if load.read >= load.bytes {
            load.state = IngestState::Done;
            load.finished_at = Some(crate::engine::now());
        }
        self.mark_shown = Some(marks);
        self.load = Load::Open {
            summary,
            table,
            csv: Some(load),
        };
        self.show_csv_stats(cx);
        cx.notify();
    }

    /// The load task's next step: another chunk, the end, or a failure.
    #[cfg(target_family = "wasm")]
    fn csv_progress(
        &mut self,
        next: Option<Result<crate::csv::Chunk, crate::engine::EngineError>>,
        cx: &mut Context<Self>,
    ) {
        let Load::Open {
            summary,
            table,
            csv: Some(load),
        } = &mut self.load
        else {
            return;
        };
        match next {
            Some(Ok(chunk)) => {
                for column in &chunk.widened {
                    if let Some(info) = summary.columns.iter_mut().find(|info| info.name == *column)
                    {
                        load.widened.push((
                            column.clone(),
                            std::mem::replace(&mut info.data_type, "VARCHAR".into()),
                            summary.rows,
                        ));
                    }
                    table.update(cx, |table, cx| table.widen(column, cx));
                }
                summary.rows += chunk.rows;
                load.read = chunk.bytes_read as u64;
                load.chunks += 1;
                load.slowest_ms = load.slowest_ms.max(chunk.ms);
                table.update(cx, |table, cx| table.grow(chunk.table, chunk.rows, cx));
            }
            None => {
                load.state = IngestState::Done;
                // A file of one chunk is done when it opens.
                load.finished_at.get_or_insert_with(crate::engine::now);
            }
            Some(Err(error)) => load.state = IngestState::Stopped(error.to_string().into()),
        }
        self.show_csv_stats(cx);
        cx.notify();
    }

    /// The overlay's CSV load stats: progress and throughput while loading,
    /// then the total time; chunks made and the slowest one.
    #[cfg(target_family = "wasm")]
    fn show_csv_stats(&self, cx: &mut App) {
        let Load::Open {
            csv: Some(load), ..
        } = &self.load
        else {
            return;
        };
        let now = crate::engine::now();
        let progress = match (&load.state, load.finished_at) {
            (IngestState::Done, Some(finished)) => format!(
                "{} in {:.1} s · {:.1} MB/s",
                format_bytes(load.bytes),
                (finished - load.started_at) / 1000.0,
                load.throughput(finished)
            ),
            _ => load.describe(now),
        };
        seiza::perf::set_metric(cx, CSV_LOAD_METRIC, progress);
        seiza::perf::set_metric(
            cx,
            CSV_CHUNKS_METRIC,
            format!("{} · slowest {:.0} ms", load.chunks, load.slowest_ms),
        );
    }

    /// Marks each frame that shows a CSV's row count change, and the one
    /// that shows its load done: the M6 checks time the updates by them.
    #[cfg(target_family = "wasm")]
    fn mark_csv_shown(&mut self) {
        let shown = match &self.load {
            Load::Open {
                summary,
                csv: Some(load),
                ..
            } => Some((summary.rows, load.state_name())),
            _ => None,
        };
        if shown == self.shown_csv {
            return;
        }
        let before = std::mem::replace(&mut self.shown_csv, shown);
        let Some((rows, state)) = shown else {
            return;
        };
        if !crate::targets::measuring() {
            return;
        }
        if before.is_none_or(|(before, _)| before != rows) {
            drop(seiza::mark_after_current_task(CSV_ROWS_MARK));
        }
        if state == "done" && before.is_none_or(|(_, before)| before != "done") {
            drop(seiza::mark_after_current_task(CSV_DONE_MARK));
        }
    }

    /// On the first render showing the summary: marks it right after this
    /// frame is presented, and records start → shown.
    #[cfg(target_family = "wasm")]
    fn mark_summary_shown(&mut self, cx: &mut Context<Self>) {
        let Some(marks) = self.mark_shown.take() else {
            return;
        };
        // Queued now, inside the render; resolves after the present.
        let shown = seiza::mark_after_current_task(marks.shown);
        let started_at = self.opened_at;
        cx.spawn(async move |_, cx| {
            // No mark, no time: "—" rather than a guess.
            let step = match shown.await {
                Some(shown) => seiza::LoadStep::done(started_at, shown),
                None => seiza::LoadStep::skipped(started_at),
            };
            cx.update(|cx| seiza::perf::set_load_step(cx, OPEN_STEPS, marks.schema_step, step));
        })
        .detach();
    }

    /// Shows `table`'s first rows in the panel, as long as it's still the
    /// table shown.
    #[cfg(target_family = "wasm")]
    fn watch_table(
        &mut self,
        table: &Entity<RowTable>,
        marks: Marks,
        started_at: f64,
        cx: &mut Context<Self>,
    ) {
        cx.subscribe(table, move |this, table, event, cx| {
            let current = matches!(&this.load, Load::Open { table: shown, .. } if *shown == table);
            match event {
                TableEvent::FirstRows { shown_ms } if current => seiza::perf::set_load_step(
                    cx,
                    OPEN_STEPS,
                    marks.first_rows_step,
                    match shown_ms {
                        Some(shown) => seiza::LoadStep::done(started_at, *shown),
                        None => seiza::LoadStep::skipped(started_at),
                    },
                ),
                TableEvent::FirstRows { .. } => {}
            }
        })
        .detach();
    }

    /// The panel's rows for the open file: what DuckDB has read of it, and
    /// the table's scrolling and paging. Runs at the panel's refresh.
    #[cfg(target_family = "wasm")]
    fn refresh_panel(&mut self, cx: &mut Context<Self>) {
        let now = crate::engine::now();
        let (read, size, table) = match &self.load {
            Load::Open {
                summary,
                table,
                csv,
            } => (
                match csv {
                    Some(load) => Some(load.read),
                    None => self
                        .read_counter
                        .as_ref()
                        .map(crate::engine::ReadCounter::get),
                },
                summary.bytes,
                Some(table.clone()),
            ),
            _ => (None, None, None),
        };
        // Bytes transferred, not distinct bytes: DuckDB reads a range again
        // once its readahead buffer has moved on, so past the file's size
        // a share would be meaningless.
        let read = match (read, size) {
            (Some(read), Some(size)) if read > size => {
                format!(
                    "{} transferred · file {}",
                    format_bytes(read),
                    format_bytes(size)
                )
            }
            (Some(read), Some(size)) if size > 0 => format!(
                "{} of {} ({:.1}%)",
                format_bytes(read),
                format_bytes(size),
                read as f64 * 100.0 / size as f64
            ),
            (Some(read), _) => format_bytes(read),
            (None, _) => "—".into(),
        };
        seiza::perf::set_metric(cx, READ_METRIC, read);
        let Some(table) = table else {
            for metric in [ROWS_PER_S_METRIC, CACHE_HITS_METRIC, PAGES_METRIC] {
                seiza::perf::set_metric(cx, metric, "—");
            }
            return;
        };
        let stats = table.update(cx, |table, _| table.stats(now));
        let activity = stats.activity;
        seiza::perf::set_metric(
            cx,
            ROWS_PER_S_METRIC,
            format_count(activity.rows_per_s.round() as u64),
        );
        seiza::perf::set_metric(
            cx,
            CACHE_HITS_METRIC,
            if activity.frames == 0 {
                "—".to_string()
            } else {
                format!(
                    "{:.0}% of {} frames",
                    activity.filled_frames as f64 * 100.0 / activity.frames as f64,
                    activity.frames
                )
            },
        );
        seiza::perf::set_metric(
            cx,
            PAGES_METRIC,
            format!(
                "{} loaded · {} in flight · {} cancelled · {}",
                stats.loaded_pages,
                stats.in_flight,
                stats.draining,
                format_bytes(stats.cache_bytes as u64)
            ),
        );
    }

    /// Publishes what the workbench shows to `globalThis.__tychoWorkbench`,
    /// for the Playwright checks (the canvas has no DOM text to read).
    fn publish(&self) {
        if !crate::targets::measuring() {
            return;
        }
        let (state, name, rows) = match &self.load {
            Load::Idle => ("idle", None, None),
            Load::Opening { name, .. } => ("opening", Some(name.as_ref()), None),
            Load::Open { summary, .. } => ("open", Some(summary.name.as_str()), Some(summary.rows)),
            Load::Failed { name, .. } => ("failed", Some(name.as_ref()), None),
        };
        let csv = match &self.load {
            Load::Open {
                csv: Some(load), ..
            } => Some(load),
            _ => None,
        };
        let message = match &self.load {
            Load::Failed { message, .. } => Some(message.as_ref()),
            _ => None,
        };
        crate::targets::publish_workbench(&crate::targets::WorkbenchProbe {
            state,
            name,
            rows,
            message,
            notice: self.notice.as_ref().map(|notice| notice.text.as_ref()),
            dragging: self.dragging,
            ingest: csv.map(CsvLoad::state_name),
            read_bytes: csv.map(|load| load.read),
            chunks: csv.map(|load| load.chunks),
        });
    }

    /// One quiet line under the buttons: what's loading, or what failed.
    /// The engine loads after first paint, so the shell says so until it's
    /// ready (Tycho rule 1).
    fn render_status(&self, cx: &App) -> impl IntoElement {
        let theme = cx.theme();
        let engine = cx.try_global::<EngineStatus>().cloned().unwrap_or_default();
        let (text, color): (SharedString, _) = match (&engine, &self.load, &self.notice) {
            (EngineStatus::Failed(message), _, _) => (
                format!("Engine failed to load: {message}. Reload the page to try again.").into(),
                theme.danger,
            ),
            (EngineStatus::Loading, Load::Opening { .. }, _) => (
                "Waiting for the engine to load…".into(),
                theme.muted_foreground,
            ),
            (
                _,
                Load::Opening {
                    origin: Origin::Sample,
                    ..
                },
                _,
            ) => (
                "Reading the file's metadata…".into(),
                theme.muted_foreground,
            ),
            (_, Load::Opening { name, .. }, _) => {
                (format!("Reading {name}…").into(), theme.muted_foreground)
            }
            (_, _, Some(notice)) => (
                notice.text.clone(),
                if notice.error {
                    theme.danger
                } else {
                    theme.muted_foreground
                },
            ),
            (
                _,
                Load::Failed {
                    origin: Origin::Sample,
                    message,
                    ..
                },
                _,
            ) => (
                format!("Couldn't open the sample: {message}").into(),
                theme.danger,
            ),
            (_, Load::Failed { name, message, .. }, _) => (
                format!("Couldn't open {name}: {message}").into(),
                theme.danger,
            ),
            (EngineStatus::Loading, _, _) => ("Engine loading…".into(), theme.muted_foreground),
            (EngineStatus::Ready { .. }, _, _) => ("Engine ready".into(), theme.muted_foreground),
        };
        div().text_xs().text_color(color).child(text)
    }

    /// A button the Playwright checks can find: they click through its
    /// published bounds (the canvas has no DOM to query).
    fn target(id: &'static str, button: Button) -> impl IntoElement {
        div()
            .on_children_prepainted(move |bounds, _, _| {
                if let Some(bounds) = bounds.first() {
                    crate::targets::publish(id, *bounds);
                }
            })
            .child(button)
    }

    fn render_empty(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let engine_failed = matches!(
            cx.try_global::<EngineStatus>(),
            Some(EngineStatus::Failed(_))
        );
        Empty::new()
            .border_0()
            .header(
                EmptyHeader::new()
                    .title(EmptyTitle::new().child("Drop a Parquet or CSV file"))
                    .description(EmptyDescription::new().child("Files stay on this device.")),
            )
            .content(
                EmptyContent::new()
                    .child(
                        h_flex()
                            .gap_2()
                            .child(Self::target(
                                "open-file",
                                Button::new("open-file")
                                    .primary()
                                    .label("Open a file…")
                                    .loading(self.load.opening(Origin::Device))
                                    .disabled(engine_failed)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.pick_file(window, cx)
                                    })),
                            ))
                            .child(Self::target(
                                "try-sample-asteroids",
                                Button::new("try-sample-asteroids")
                                    .outline()
                                    .label("Try sample: every known asteroid")
                                    .loading(self.load.opening(Origin::Sample))
                                    .disabled(engine_failed)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.open_sample(window, cx)
                                    })),
                            )),
                    )
                    .child(self.render_status(cx)),
            )
    }

    /// The header strip: the file, its size and shape, its columns, and the
    /// data credit.
    fn render_summary(
        &self,
        summary: &FileSummary,
        csv: Option<&CsvLoad>,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        let mut stats = vec![
            format!("{} rows", format_count(summary.rows)),
            format!("{} columns", summary.columns.len()),
        ];
        if let Some(bytes) = summary.bytes {
            stats.push(format_bytes(bytes));
        }
        if let Some(row_groups) = summary.row_groups {
            stats.push(format!(
                "{} row group{}",
                format_count(row_groups),
                if row_groups == 1 { "" } else { "s" }
            ));
        }
        if let Some(load) = csv {
            #[cfg(target_family = "wasm")]
            let now = crate::engine::now();
            #[cfg(not(target_family = "wasm"))]
            let now = load.started_at;
            stats.push(load.describe(now));
        }
        let muted_line = |text: String| {
            div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child(text)
        };
        let widened = csv
            .into_iter()
            .flat_map(|load| &load.widened)
            .map(|(column, was, rows)| {
                muted_line(format!(
                    "{column} is shown as text: a value after row {} isn't a {was}.",
                    format_count(*rows)
                ))
            });
        let stopped = csv.and_then(|load| match &load.state {
            IngestState::Stopped(message) => {
                Some(div().text_xs().text_color(theme.danger).child(format!(
                    "Stopped reading after row {}: {message}. The rows before it are shown.",
                    format_count(summary.rows)
                )))
            }
            _ => None,
        });

        v_flex()
            .gap_2()
            .child(
                h_flex()
                    .gap_3()
                    .child(div().text_sm().font_semibold().child(summary.name.clone()))
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child(stats.join(" · ")),
                    )
                    .child(div().flex_1())
                    .child(Self::target(
                        "open-file",
                        Button::new("open-file")
                            .ghost()
                            .small()
                            .label("Open file…")
                            .on_click(
                                cx.listener(|this, _, window, cx| this.pick_file(window, cx)),
                            ),
                    )),
            )
            .child(
                h_flex()
                    .flex_wrap()
                    .gap_1()
                    .children(summary.columns.iter().map(|column| {
                        Tag::secondary().small().child(
                            h_flex().gap_1().child(column.name.clone()).child(
                                div()
                                    .text_color(theme.muted_foreground)
                                    .child(column.data_type.clone()),
                            ),
                        )
                    })),
            )
            .children(summary.credit.clone().map(|credit| {
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(credit)
            }))
            .children(widened)
            .children(stopped)
            .children(self.notice.as_ref().map(|notice| {
                div()
                    .text_xs()
                    .text_color(if notice.error {
                        theme.danger
                    } else {
                        theme.muted_foreground
                    })
                    .child(notice.text.clone())
            }))
    }

    /// Covers the window while files are dragged over it.
    fn render_drop_target(cx: &App) -> impl IntoElement {
        let theme = cx.theme();
        div().absolute().top_0().left_0().size_full().p_3().child(
            v_flex()
                .size_full()
                .items_center()
                .justify_center()
                .gap_1()
                .rounded_lg()
                .border_2()
                .border_dashed()
                .border_color(theme.primary)
                .bg(theme.background.opacity(0.9))
                .child(div().text_lg().font_semibold().child("Drop to open"))
                .child(
                    div()
                        .text_sm()
                        .text_color(theme.muted_foreground)
                        .child("Parquet is read in place; CSV is copied into memory as it loads. Nothing is uploaded."),
                ),
        )
    }
}

/// Sets `performance.mark(name)` at `at` (ms from `timeOrigin`), when the
/// click, drop, or choice happened rather than when it was handled.
#[cfg(target_family = "wasm")]
fn mark_at(name: &str, at: f64) {
    use js_sys::{Function, Object, Reflect};
    use wasm_bindgen::{JsCast as _, JsValue};

    // `performance.mark(name, { startTime })`; web-sys has the options type
    // only behind its unstable-APIs flag.
    let Some(performance) = web_sys::window().and_then(|window| window.performance()) else {
        return;
    };
    let options = Object::new();
    let _ = Reflect::set(&options, &"startTime".into(), &JsValue::from_f64(at));
    if let Ok(mark) = Reflect::get(&performance, &"mark".into()) {
        let _ = mark.unchecked_into::<Function>().call2(
            &performance,
            &JsValue::from_str(name),
            &options,
        );
    }
}

#[cfg(target_family = "wasm")]
impl crate::files::FileTarget for Workbench {
    fn file_event(
        &mut self,
        event: crate::files::FileEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::files::FileEvent;

        match event {
            FileEvent::Dragging(dragging) => {
                self.dragging = dragging;
                cx.notify();
            }
            FileEvent::Chosen { file, at, more } => self.file_chosen(file, at, more, window, cx),
        }
    }
}

impl Render for Workbench {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(target_family = "wasm")]
        {
            self.mark_summary_shown(cx);
            self.mark_csv_shown();
        }
        self.publish();

        let content = match &self.load {
            Load::Open {
                summary,
                table,
                csv,
            } => v_flex()
                .size_full()
                .p_4()
                .gap_3()
                .child(self.render_summary(summary, csv.as_ref(), cx))
                .child(div().flex_1().min_h_0().child(table.clone())),
            _ => v_flex().size_full().p_4().child(self.render_empty(cx)),
        };
        div()
            .relative()
            .size_full()
            .child(content)
            .when(self.dragging, |this| {
                this.child(Self::render_drop_target(cx))
            })
    }
}
