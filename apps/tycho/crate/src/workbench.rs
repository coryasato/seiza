//! The workbench: what the canvas shows (the open file's rows, nothing
//! before one opens) and the state the page's frame shows around it
//! (`crate::frame`): the file, its facts, what's opening, and what failed.
//!
//! A file comes from a drop anywhere on the page or the file dialog, both
//! the page's (`crate::frame::open_file`). A Parquet file goes through one pipeline (register, read
//! the footer's metadata, page rows); a CSV through another (cut into
//! chunks, each copied into a table, the rows growing as they come;
//! `crate::csv`). A new file replaces the current one, whether it's still
//! opening or already showing rows: its queries are cancelled, its answers
//! ignored, and a CSV's tables dropped.
//!
//! The command bar's actions run here too (`crate::frame::command`):
//! parsed and checked by `crate::command`, run on the controller and then
//! the table, and each kept in the open file's log (`crate::log`), as each
//! drag in the table is.
//!
//! The table's presses that the page answers (a header's icon, a context
//! press, a double press, Enter on a cell with no popover, the popover's
//! button) go to the page as one event each (`crate::frame::Press`), its
//! selection's anchor is the frame's active cell, a copy goes to the
//! clipboard through the bridge's writer, and a row's values are read for
//! the Row tab (`Workbench::row_values`).

use std::rc::Rc;

use gpui_kit::*;

use crate::command::Catalog;
use crate::dataset::{FileSummary, format_count};
#[cfg(target_family = "wasm")]
use crate::dataset::{format_bytes, sample};
use crate::frame::{ActiveCell, Answer, ColumnFacts, EngineView, FileView, FrameView, Line};
use crate::log::{Log, Origin};
use crate::table::RowTable;
use crate::view::{Controller, ViewState};
#[cfg(target_family = "wasm")]
use crate::view::{SourceKind, SourceView};
use seiza_duckdb::EngineStatus;
use seiza_tall_table::TallTable;
#[cfg(target_family = "wasm")]
use seiza_tall_table::TallTableEvent;

actions!(
    tycho,
    [
        /// Enter on a cell the table's popover doesn't open on: its row.
        OpenRow
    ]
);

/// The workbench's key context, on its root: the table's is inside it, so
/// a key the table goes on with (`cx.propagate()`) reaches its bindings.
const CONTEXT: &str = "Workbench";

/// The workbench's keys: Enter on a cell with no popover opens its row.
#[cfg(target_family = "wasm")]
pub fn init(cx: &mut App) {
    cx.bind_keys([KeyBinding::new("enter", OpenRow, Some(CONTEXT))]);
}

/// The `performance.mark`s and panel steps an open reports under.
#[cfg(target_family = "wasm")]
const FILE_MARKS: Marks = Marks {
    start: "tycho:file-open",
    shown: "tycho:file-shown",
    schema_step: "File → schema",
    first_rows_step: "File → first rows",
};

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
        let now = seiza::marks::now();
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
    /// Registering the file and reading its metadata; or, before the engine
    /// is locked down, held unregistered in [`Workbench::held`] until it is
    /// ([`Workbench::hold`]): nothing reaches the engine before the lock.
    Opening {
        name: SharedString,
        /// The sample, downloading or opening (its button spins, not the
        /// file button).
        sample: bool,
        /// The sample's download, before it's registered.
        downloading: bool,
        /// Dropping it stops the open at its next await. None for a CSV,
        /// whose task runs on to drop its tables (`csv`).
        #[cfg(target_family = "wasm")]
        _task: Option<Task<()>>,
        /// The metadata queries sent so far, to cancel if a new file comes.
        #[cfg(target_family = "wasm")]
        sent: std::rc::Rc<std::cell::RefCell<Vec<seiza_duckdb::RequestId>>>,
        #[cfg(target_family = "wasm")]
        csv: Option<crate::csv::Stop>,
    },
    Open {
        summary: Box<FileSummary>,
        /// The sample, not a file from this device.
        sample: bool,
        table: Entity<RowTable>,
        /// What the table shows of the file: the controller, which the
        /// table's events and a CSV's growth keep up to date.
        view: Box<Controller>,
        /// A CSV's load, which runs on after its first rows show.
        csv: Option<CsvLoad>,
    },
    Failed {
        name: SharedString,
        message: SharedString,
        /// The engine stopped under it, rather than the file failing.
        engine_stopped: bool,
    },
}

impl Load {
    #[cfg_attr(
        not(target_family = "wasm"),
        expect(dead_code, reason = "only the web build opens files")
    )]
    /// Whether the sample (`true`) or a file from this device is opening.
    fn opening(&self, which_sample: bool) -> bool {
        matches!(self, Self::Opening { sample, .. } if *sample == which_sample)
    }
}

/// An open held until the engine is locked down ([`Workbench::held`]).
#[cfg(target_family = "wasm")]
enum Held {
    Parquet {
        name: SharedString,
        sql_name: String,
        source: seiza_duckdb::FileSource,
        started_at: f64,
    },
    Csv {
        name: SharedString,
        file: web_sys::File,
        open: u64,
        started_at: f64,
    },
}

#[cfg(target_family = "wasm")]
impl Held {
    fn name(&self) -> SharedString {
        match self {
            Self::Parquet { name, .. } | Self::Csv { name, .. } => name.clone(),
        }
    }

    /// Starts the open it held: the sample's still shows as the sample.
    fn open(self, workbench: &mut Workbench, window: &mut Window, cx: &mut Context<Workbench>) {
        let sample = workbench.load.opening(true);
        match self {
            Self::Parquet {
                name,
                sql_name,
                source,
                started_at,
            } => workbench.open(name, sql_name, source, started_at, window, cx),
            Self::Csv {
                name,
                file,
                open,
                started_at,
            } => workbench.open_csv(name, file, open, started_at, window, cx),
        }
        if let Load::Opening { sample: shown, .. } = &mut workbench.load {
            *shown = sample;
        }
    }
}

/// Whether the engine takes files: with Tycho's lockdown, `Ready` only once
/// it's on (`seiza_duckdb::start_locked`).
#[cfg(target_family = "wasm")]
fn engine_ready(cx: &App) -> bool {
    matches!(
        cx.try_global::<EngineStatus>(),
        Some(EngineStatus::Ready { .. })
    )
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

/// How long after the `done`th registration of the open file (after
/// failed reads) the next may start: 5 s, doubling to a minute, so a file
/// whose reads keep failing isn't registered in a loop.
#[cfg(target_family = "wasm")]
fn reregister_window_ms(done: u32) -> f64 {
    (5_000.0 * 2f64.powi(done.saturating_sub(1).min(4) as i32)).min(60_000.0)
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

/// A line about something that didn't replace what's shown: a file Tycho
/// can't open, extra files in one drop, a way back refused, or a copy that
/// didn't run.
#[derive(Clone)]
struct Notice {
    text: SharedString,
    error: bool,
    /// What it's about, so the next of its kind that works clears it.
    #[cfg_attr(
        not(target_family = "wasm"),
        expect(dead_code, reason = "only the web build sets one")
    )]
    about: About,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build sets one")
)]
enum About {
    File,
    /// A way back refused: cleared by the next that works.
    Back,
    /// A copy refused: cleared by the next that starts.
    Copy,
    /// A menu's or the column list's command refused (a click's, which no
    /// bar is open to answer): cleared by the next click's command.
    Click,
}

#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens files")
)]
pub struct Workbench {
    load: Load,
    notice: Option<Notice>,
    /// Counts opens; each file registers under its own SQL name (see
    /// [`Workbench::open_file`]), and a sniff whose count is stale is dropped.
    opens: u64,
    /// Reading a chosen file's first and last bytes (`files::sniff`). A newer
    /// choice replaces it.
    #[cfg(target_family = "wasm")]
    sniffing: Option<Task<()>>,
    /// An open chosen before the engine was locked down: nothing reaches
    /// the engine until it is (`engine::lockdown`), so it waits here, shown
    /// as opening, and starts when the engine is ready.
    #[cfg(target_family = "wasm")]
    held: Option<Held>,
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
    read_counter: Option<seiza_duckdb::ReadCounter>,
    /// The open Parquet file's SQL name and source, to register it again
    /// after a failed read (`TallTableEvent::ReadFailed`), and when that last
    /// started (ms from `timeOrigin`). The next waits
    /// [`reregister_window_ms`], so a file that keeps failing can't loop.
    #[cfg(target_family = "wasm")]
    parquet_source: Option<(String, seiza_duckdb::FileSource)>,
    #[cfg(target_family = "wasm")]
    reregistered_at: Option<f64>,
    /// Registrations since the open: each one's SQL name is new.
    #[cfg(target_family = "wasm")]
    reregistrations: u32,
    /// A registration waiting for its window ([`reregister_window_ms`]).
    #[cfg(target_family = "wasm")]
    reregister_later: Option<Task<()>>,
    /// The workbench's root, where focus goes back to when the focused
    /// input or table stops rendering (see [`Workbench::new`]).
    focus_handle: FocusHandle,
    /// What the page's frame was last sent (`crate::frame::publish`).
    shown_frame: Option<FrameView>,
    /// The frame's column list, built only when the view it was built
    /// from changes ([`Workbench::refresh_columns`]): the frame is compared
    /// every render, and a shared list compares by pointer first.
    columns: Rc<[ColumnFacts]>,
    /// The view `columns` was built from; none with no file open.
    columns_of: Option<Controller>,
    /// The view last published to `globalThis.__tychoView` (while
    /// measuring), and whether one has been.
    shown_view: Option<Option<ViewState>>,
    /// The open file's log: opened, each command, each drag.
    log: Log,
    /// The bar's last answer, and how many it has given (the page tells a
    /// new answer from the same words again by its count).
    answer: Option<Answer>,
    answers: u32,
    /// The command being run (`crate::frame::command`'s number), which
    /// its answer carries; 0 between commands.
    asking: u32,
    /// The table that has been laid out at a width (its scrollbar's track
    /// reported with a height): until then its pinned run in effect reads
    /// 0, which says nothing of what it will draw.
    laid_out: Option<EntityId>,
    /// Where the file opening now came from, for its log entry.
    origin: Origin,
    /// Each column's width as drawn, by index, after the table's last
    /// change: a resize's entry says which way it went.
    drawn: Vec<f32>,
    /// What completion last read (`crate::frame::set_catalog`), and
    /// whether it has.
    shown_catalog: Option<Option<Catalog>>,
    /// The table's active cell, by the column's index: its selection's
    /// anchor, which the Row tab follows.
    active: Option<ActiveCell>,
    /// Writes the table's copies to the clipboard (`copy`).
    clipboard: tall_table_bridge::clipboard::Clipboard,
    _engine_status: Subscription,
    /// The panel's visibility is part of the frame's state.
    _panel: Subscription,
    _focus_lost: Subscription,
}

impl Workbench {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        #[cfg(target_family = "wasm")]
        crate::frame::connect(cx.entity().downgrade(), window.window_handle(), cx);
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
            // The open panel stays clear of the table's scrollbars (the
            // table's border, the bar, and a gap): a thumb at the bottom
            // after End or a fling stays grabbable.
            let clearance = px(1. + 8.) + gpui_kit::component::scroll::Scrollbar::width();
            seiza::perf::set_clearance(cx, clearance, clearance);
            let this = cx.entity().downgrade();
            seiza::perf::on_refresh(cx, move |cx| {
                if let Some(this) = this.upgrade() {
                    this.update(cx, |this, cx| this.refresh_panel(cx));
                }
            });
        }
        // When the focused element stops rendering (the table of a file that
        // another replaced, or of an open that failed), nothing has
        // focus, key dispatch starts at the window's root, and the
        // workbench's bindings stop firing. Put focus back on the nearest
        // focusable ancestor that's still there: the workbench.
        let focus_lost = cx.on_focus_lost(window, |this, window, cx| {
            let target = window
                .focus_lost_restore_target(cx)
                .unwrap_or_else(|| this.focus_handle.clone());
            window.focus(&target, cx);
            // This runs after the frame that lost focus was drawn; draw the
            // one that has it (and publishes it, for the checks).
            cx.notify();
        });
        Self {
            load: Load::Idle,
            notice: None,
            opens: 0,
            #[cfg(target_family = "wasm")]
            sniffing: None,
            #[cfg(target_family = "wasm")]
            held: None,
            #[cfg(target_family = "wasm")]
            opened_at: 0.0,
            #[cfg(target_family = "wasm")]
            mark_shown: None,
            #[cfg(target_family = "wasm")]
            shown_csv: None,
            #[cfg(target_family = "wasm")]
            read_counter: None,
            #[cfg(target_family = "wasm")]
            parquet_source: None,
            #[cfg(target_family = "wasm")]
            reregistered_at: None,
            #[cfg(target_family = "wasm")]
            reregistrations: 0,
            #[cfg(target_family = "wasm")]
            reregister_later: None,
            focus_handle: cx.focus_handle(),
            shown_frame: None,
            columns: Rc::from([]),
            columns_of: None,
            shown_view: None,
            log: Log::default(),
            answer: None,
            answers: 0,
            asking: 0,
            laid_out: None,
            origin: Origin::Pick,
            drawn: Vec::new(),
            shown_catalog: None,
            active: None,
            // The outcome on a global while measuring, for the checks.
            clipboard: tall_table_bridge::clipboard::Clipboard::new(
                crate::targets::measuring().then_some("__tychoCopy"),
                // Called outside GPUI when the browser settles a write: it
                // comes back in through the page's calls' queue.
                #[cfg(target_family = "wasm")]
                Some(Box::new(|outcome| {
                    crate::frame::copy_outcome(outcome.clone())
                })),
                #[cfg(not(target_family = "wasm"))]
                None,
            ),
            _engine_status: cx.observe_global_in::<EngineStatus>(window, Self::engine_changed),
            _panel: cx.observe_global::<seiza::PerfOverlay>(|this, cx| {
                if this.shown_frame.as_ref().map(|shown| shown.panel)
                    != Some(seiza::perf::is_visible(cx))
                {
                    cx.notify();
                }
            }),
            _focus_lost: focus_lost,
        }
    }

    /// The engine's status changed. If its worker stopped, what's open or
    /// opening went with it (its registration and tables are gone): the
    /// frame says so, with Retry. A held file never reached the
    /// engine, so it stays held, and opens once Retry's engine is ready.
    fn engine_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        #[cfg(target_family = "wasm")]
        if engine_ready(cx)
            && let Some(held) = self.held.take()
        {
            held.open(self, window, cx);
        }
        #[cfg(target_family = "wasm")]
        if let Some(EngineStatus::Stopped(message)) = cx.try_global::<EngineStatus>().cloned()
            && self.held.is_none()
        {
            let name = match &self.load {
                Load::Open { summary, .. } => Some(SharedString::from(summary.name.clone())),
                Load::Opening { name, .. } => Some(name.clone()),
                Load::Idle | Load::Failed { .. } => None,
            };
            if let Some(name) = name {
                self.close_current(window, cx);
                self.load = Load::Failed {
                    name,
                    message: format!("the engine stopped ({message})").into(),
                    engine_stopped: true,
                };
            }
        }
        #[cfg(not(target_family = "wasm"))]
        let _ = window;
        cx.notify();
    }

    /// Downloads the sample whole, then opens it from memory as a dropped
    /// file opens. A file opened meanwhile replaces it (dropping the
    /// download's task with the state); a dropped file Tycho refuses leaves
    /// it running, as it leaves an open file.
    #[cfg(target_family = "wasm")]
    pub(crate) fn open_sample(&mut self, at: f64, window: &mut Window, cx: &mut Context<Self>) {
        if self.load.opening(true) {
            return;
        }
        self.close_current(window, cx);
        self.sniffing = None;
        self.notice = None;
        self.origin = Origin::Sample;
        self.opens += 1;
        let open = self.opens;
        let url = cx.global::<sample::Url>().0.clone();
        let task = cx.spawn_in(window, async move |this, cx| {
            let file = crate::files::download(&url, sample::NAME).await;
            // Still this download's state: anything that replaced it dropped
            // this task.
            let _ = this.update_in(cx, |this, window, cx| {
                match file {
                    Ok(file) => {
                        this.open(
                            sample::NAME.into(),
                            crate::engine::path(&format!("sample-{open}.parquet")),
                            seiza_duckdb::FileSource::File(file),
                            at,
                            window,
                            cx,
                        );
                        if let Load::Opening { sample, .. } = &mut this.load {
                            *sample = true;
                        }
                    }
                    Err(message) => {
                        this.load = Load::Failed {
                            name: "the sample".into(),
                            message: message.into(),
                            engine_stopped: false,
                        };
                    }
                }
                cx.notify();
            });
        });
        self.load = Load::Opening {
            name: "the sample".into(),
            sample: true,
            downloading: true,
            _task: Some(task),
            sent: Default::default(),
            csv: None,
        };
        cx.notify();
    }

    /// A file was dropped or picked (`from`) at `at`. Its first and last
    /// bytes decide first: a file Tycho can't open gets a message and
    /// leaves the current file where it is.
    #[cfg(target_family = "wasm")]
    pub(crate) fn file_chosen(
        &mut self,
        file: web_sys::File,
        at: f64,
        more: u32,
        from: Origin,
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
                let refused = refused.or_else(|| {
                    crate::limits::too_large(&name, file.size() as u64, kind == Ok(Kind::Csv))
                });
                if let Some(text) = refused {
                    this.notice = Some(Notice {
                        text: text.into(),
                        error: true,
                        about: About::File,
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
                    about: About::File,
                });
                this.origin = from;
                if kind == Ok(Kind::Csv) {
                    this.open_csv(name, file, open, at, window, cx);
                    return;
                }
                let sql_name = crate::engine::path(&format!("file-{open}.parquet"));
                this.open(
                    name,
                    sql_name,
                    seiza_duckdb::FileSource::File(file),
                    at,
                    window,
                    cx,
                );
            });
        }));
    }

    /// Holds `held` until the engine is ready, in place of what was open
    /// or opening: the file shows as opening, "waiting for the engine".
    #[cfg(target_family = "wasm")]
    /// A drop or a pick is never the sample, whatever it replaced: the
    /// sample's download marks its own hold as the sample once `open` returns
    /// (`open_sample`), as it marks a real open.
    fn hold(&mut self, held: Held, window: &mut Window, cx: &mut Context<Self>) {
        let name = held.name();
        self.close_current(window, cx);
        self.held = Some(held);
        self.load = Load::Opening {
            name,
            sample: false,
            downloading: false,
            _task: None,
            sent: Default::default(),
            csv: None,
        };
        cx.notify();
    }

    /// Stops whatever is loading or showing, so a new file can take over.
    #[cfg(target_family = "wasm")]
    fn close_current(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let engine = cx.global::<seiza_duckdb::Engine>().clone();
        self.held = None;
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
                table.update(cx, |table, cx| table.close(cx));
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
        self.parquet_source = None;
        self.reregistered_at = None;
        self.reregistrations = 0;
        self.reregister_later = None;
        self.log.clear();
        self.answer = None;
        self.drawn.clear();
        self.active = None;
        self.clipboard.closed();
    }

    /// Registers `source` as `sql_name` and reads its summary, then shows its
    /// rows. `name` is what the header shows. The SQL name is ours, never the
    /// file's: `read_parquet` would expand a name like `data[1].parquet` as a
    /// glob. `started_at` is the click, drop, or choice.
    #[cfg(target_family = "wasm")]
    fn open(
        &mut self,
        name: SharedString,
        sql_name: String,
        source: seiza_duckdb::FileSource,
        started_at: f64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use std::cell::RefCell;
        use std::rc::Rc;

        use seiza_duckdb::Engine;

        if !engine_ready(cx) {
            let held = Held::Parquet {
                name,
                sql_name,
                source,
                started_at,
            };
            self.hold(held, window, cx);
            return;
        }
        self.close_current(window, cx);
        let marks = FILE_MARKS;
        self.opened_at = started_at;
        seiza::marks::mark_at(marks.start, started_at);
        marks.start(started_at, cx);

        let engine = cx.global::<Engine>().clone();
        let sent = Rc::new(RefCell::new(Vec::new()));
        let task = {
            let (sent, name) = (sent.clone(), name.clone());
            let kept = source.clone();
            cx.spawn_in(window, async move |this, cx| {
                let result = crate::dataset::open(&engine, &sql_name, &name, source, |id| {
                    sent.borrow_mut().push(id)
                })
                .await;
                let _ = this.update_in(cx, |this, window, cx| {
                    let sample = this.load.opening(true);
                    this.load = match result {
                        Ok((summary, read_counter)) => {
                            let view = Controller::of_file(
                                SourceView {
                                    kind: if sample {
                                        SourceKind::Sample
                                    } else {
                                        SourceKind::Parquet
                                    },
                                    name: summary.name.clone(),
                                    rows: summary.rows,
                                },
                                &summary.columns,
                            );
                            this.mark_shown = Some(marks);
                            this.read_counter = read_counter;
                            this.parquet_source = Some((sql_name.clone(), kept));
                            let table = cx.new(|cx| {
                                crate::table::new(
                                    crate::table::Source::Parquet(
                                        seiza_duckdb::tall_table::ParquetFile::new(sql_name),
                                    ),
                                    summary.rows,
                                    view.calls(),
                                    engine,
                                    cx,
                                )
                            });
                            this.watch_table(&table, marks, started_at, cx);
                            let focus = table.read(cx).focus_handle().clone();
                            window.focus(&focus, cx);
                            Load::Open {
                                summary: Box::new(summary),
                                sample,
                                table,
                                view: Box::new(view),
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
                                name,
                                engine_stopped: matches!(
                                    error,
                                    seiza_duckdb::EngineError::Stopped(_)
                                ),
                                message: error.to_string().into(),
                            }
                        }
                    };
                    this.start_log();
                    cx.notify();
                });
            })
        };
        self.load = Load::Opening {
            name,
            sample: false,
            downloading: false,
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
        use seiza_duckdb::{Engine, EngineError};

        if !engine_ready(cx) {
            let held = Held::Csv {
                name,
                file,
                open,
                started_at,
            };
            self.hold(held, window, cx);
            return;
        }
        self.close_current(window, cx);
        let marks = FILE_MARKS;
        self.opened_at = started_at;
        seiza::marks::mark_at(marks.start, started_at);
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
                                name,
                                engine_stopped: matches!(error, EngineError::Stopped(_)),
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
            name,
            sample: false,
            downloading: false,
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
        let marks = FILE_MARKS;
        let summary = FileSummary {
            name: name.to_string(),
            bytes: Some(ingest.size() as u64),
            rows: chunk.rows,
            row_groups: None,
            columns: ingest.columns().to_vec(),
            credit: None,
        };
        let view = Controller::of_file(
            SourceView {
                kind: SourceKind::Csv,
                name: summary.name.clone(),
                rows: summary.rows,
            },
            &summary.columns,
        );
        let mut chunks = crate::csv::Chunks::new(ingest.row_column());
        chunks.push(chunk.table, chunk.rows);
        let engine = cx.global::<seiza_duckdb::Engine>().clone();
        let table = cx.new(|cx| {
            crate::table::new(
                crate::table::Source::Csv(chunks),
                summary.rows,
                view.calls(),
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
            load.finished_at = Some(seiza::marks::now());
        }
        self.mark_shown = Some(marks);
        self.load = Load::Open {
            summary: Box::new(summary),
            sample: false,
            table,
            view: Box::new(view),
            csv: Some(load),
        };
        self.start_log();
        self.show_csv_stats(cx);
        cx.notify();
    }

    /// The load task's next step: another chunk, the end, or a failure.
    #[cfg(target_family = "wasm")]
    fn csv_progress(
        &mut self,
        next: Option<Result<crate::csv::Chunk, seiza_duckdb::EngineError>>,
        cx: &mut Context<Self>,
    ) {
        let Load::Open {
            summary,
            table,
            view,
            csv: Some(load),
            ..
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
                }
                if !chunk.widened.is_empty() {
                    // The table's columns change, which resets its order:
                    // the controller gives it the view back.
                    view.retype(&summary.columns);
                    let calls = view.calls();
                    table.update(cx, |table, cx| {
                        crate::table::widen(table, &chunk.widened, calls, cx)
                    });
                }
                summary.rows += chunk.rows;
                view.set_rows(summary.rows);
                self.log.set_rows(summary.rows);
                load.read = chunk.bytes_read as u64;
                load.chunks += 1;
                load.slowest_ms = load.slowest_ms.max(chunk.ms);
                table.update(cx, |table, cx| {
                    crate::table::grow(table, chunk.table, chunk.rows, cx)
                });
            }
            None => {
                load.state = IngestState::Done;
                // A file of one chunk is done when it opens.
                load.finished_at.get_or_insert_with(seiza::marks::now);
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
        let now = seiza::marks::now();
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
    /// that shows its load done: the CSV checks time the updates by them.
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
            // Only the table on screen: a replaced one's late report would
            // overwrite the probes, and the shown one sends them only when
            // they change.
            if current {
                crate::table::publish(event);
                if let TallTableEvent::Scrollbar { track, .. } = event
                    && track.size.height > px(0.)
                {
                    this.laid_out = Some(table.entity_id());
                }
                if matches!(
                    event,
                    TallTableEvent::ColumnWidthsChanged(_)
                        | TallTableEvent::ColumnsMoved { .. }
                        | TallTableEvent::Pinned(_)
                        | TallTableEvent::ColumnsHidden(_)
                ) {
                    this.table_changed(&table, event, cx);
                }
                this.table_pressed(&table, event, cx);
            }
            match event {
                // Delivered in the task that presents the frame (the table
                // emits it while rendering), so the mark lands right after it.
                TallTableEvent::Filled { first: true } => {
                    if current {
                        this.drawn = drawn_widths(&table, cx);
                    }
                    let first_rows = seiza::mark_after_current_task(crate::table::FIRST_ROWS_MARK);
                    cx.spawn(async move |this, cx| {
                        let shown_ms = first_rows.await;
                        let _ = this.update(cx, |this, cx| {
                            let current = matches!(&this.load, Load::Open { table: shown, .. } if *shown == table);
                            if current {
                                seiza::perf::set_load_step(
                                    cx,
                                    OPEN_STEPS,
                                    marks.first_rows_step,
                                    match shown_ms {
                                        Some(shown) => seiza::LoadStep::done(started_at, shown),
                                        None => seiza::LoadStep::skipped(started_at),
                                    },
                                );
                            }
                        });
                    })
                    .detach();
                }
                TallTableEvent::ReadFailed if current => this.register_again(table, cx),
                _ => {}
            }
        })
        .detach();
    }

    /// What the shown table reports that the page answers: its selection
    /// (the active cell), its presses, and its copies.
    #[cfg(target_family = "wasm")]
    fn table_pressed(
        &mut self,
        table: &Entity<RowTable>,
        event: &TallTableEvent,
        cx: &mut Context<Self>,
    ) {
        use seiza_tall_table::{ClickKind, ClickTarget};

        use crate::frame::Rect;

        let index =
            |place: usize, cx: &App| table.read(cx).order().get(place).copied().unwrap_or(place);
        let pointer = |position: Point<Pixels>| Rect {
            x: position.x.into(),
            y: position.y.into(),
            width: 0.,
            height: 0.,
        };
        match event {
            TallTableEvent::Selected(selection) => {
                let active = selection.map(|selection| {
                    let (row, place) = selection.anchor();
                    ActiveCell {
                        row,
                        column: index(place, cx),
                    }
                });
                if active != self.active {
                    self.active = active;
                    cx.notify();
                }
            }
            TallTableEvent::Clicked(click) => match (click.kind, click.target) {
                // A header's press: at a phone, a finger's tap opens its
                // column's menu as a sheet (the page decides, by the
                // pointer and its width).
                (ClickKind::Press, ClickTarget::Column(place)) => {
                    let column = index(place, cx);
                    self.press("tap", column, None, Some(pointer(click.position)), cx);
                }
                (ClickKind::Context, ClickTarget::Column(place)) => {
                    let column = index(place, cx);
                    self.press("header", column, None, Some(pointer(click.position)), cx);
                }
                (ClickKind::Context, ClickTarget::Cell { row, column }) => {
                    let column = index(column, cx);
                    self.press("cell", column, Some(row), Some(pointer(click.position)), cx);
                }
                (ClickKind::Double, ClickTarget::Cell { row, column }) => {
                    let column = index(column, cx);
                    self.press("double", column, Some(row), None, cx);
                }
                _ => {}
            },
            TallTableEvent::HeaderIconPressed(press) => {
                let bounds = press.bounds;
                let at = Rect {
                    x: bounds.origin.x.into(),
                    y: bounds.origin.y.into(),
                    width: bounds.size.width.into(),
                    height: bounds.size.height.into(),
                };
                self.press("icon", press.column, None, Some(at), cx);
            }
            TallTableEvent::PopoverButton(cell) => {
                self.press("open", cell.column, Some(cell.row), None, cx);
            }
            TallTableEvent::Copy(copy) => self.copied(table, copy, cx),
            _ => {}
        }
    }

    /// Sends the page a press on column `column` (its index), on a cell of
    /// `row` or its header.
    #[cfg(target_family = "wasm")]
    fn press(
        &self,
        kind: &'static str,
        column: usize,
        row: Option<u64>,
        at: Option<crate::frame::Rect>,
        cx: &App,
    ) {
        let Load::Open { view, .. } = &self.load else {
            return;
        };
        if column >= view.columns().len() {
            return;
        }
        let value = row.and_then(|row| self.cell_text(row, column, crate::row::PRESS_CHARS, cx));
        crate::frame::press(&crate::frame::Press {
            kind,
            column: crate::frame::ColumnFacts::of(view, column),
            row,
            value,
            at,
        });
    }

    /// Cell `row`, `column` (its index)'s exact text, cut at `most`
    /// characters, if the table holds its page: none for NULL too.
    #[cfg(target_family = "wasm")]
    fn cell_text(&self, row: u64, column: usize, most: usize, cx: &App) -> Option<String> {
        let Load::Open { table, .. } = &self.load else {
            return None;
        };
        let (page, at) = table.read(cx).delegate().loaded(row)?;
        let value = seiza_tall_table::TallTablePage::value(&*page, at, column);
        crate::row::text(value, most).0
    }

    /// Enter on a cell the table's popover doesn't open on (a number, a
    /// value that fits): the page opens its row.
    /// Only while the table has focus: its selection outlives it (focus
    /// lost goes to the workbench's root), and a key the table never saw
    /// isn't a key on its cell.
    fn open_row(&mut self, _: &OpenRow, window: &mut Window, cx: &mut Context<Self>) {
        #[cfg(target_family = "wasm")]
        if let (Some(active), Load::Open { table, .. }) = (self.active, &self.load)
            && table.read(cx).focus_handle().is_focused(window)
        {
            self.press("enter", active.column, Some(active.row), None, cx);
            return;
        }
        #[cfg(not(target_family = "wasm"))]
        let _ = window;
        cx.propagate();
    }

    /// A copy's event, to the clipboard's writer; a copy it can't write is
    /// cancelled. What became of it is said by [`Workbench::copy_outcome`].
    #[cfg(target_family = "wasm")]
    fn copied(
        &mut self,
        table: &Entity<RowTable>,
        copy: &seiza_tall_table::TallTableCopy,
        cx: &mut Context<Self>,
    ) {
        if self.clipboard.event(copy).is_some() {
            table.update(cx, |table, cx| table.cancel_copy(cx));
        }
    }

    /// What became of the last copy started, from the clipboard's writer
    /// (`crate::frame::copy_outcome`, on GPUI's next turn): a copy that
    /// didn't reach the clipboard is said in the frame's line (Cmd/Ctrl+C
    /// past its cells, a text past the clipboard's size, a page that didn't
    /// read, the browser's refusal, or no clipboard here), and a copy that
    /// starts clears the line a last one left.
    #[cfg(target_family = "wasm")]
    pub(crate) fn copy_outcome(
        &mut self,
        outcome: tall_table_bridge::clipboard::Outcome,
        cx: &mut Context<Self>,
    ) {
        use tall_table_bridge::clipboard::{Failure, Outcome};

        let Load::Open { table, .. } = &self.load else {
            return;
        };
        let text = match outcome {
            Outcome::Declined { rows, columns } => Some((
                format!(
                    "Nothing was copied: {} cells are more than a key copies at once ({}). Select fewer to copy them.",
                    format_count(rows.saturating_mul(columns as u64)),
                    format_count(table.read(cx).copy_options().key_max_cells),
                ),
                false,
            )),
            Outcome::Failed {
                reason: Failure::TooLarge { max_bytes, .. },
                ..
            } => Some((
                format!(
                    "Nothing was copied: the text is past {}, the most a copy holds. Select fewer rows to copy them.",
                    format_bytes(max_bytes as u64)
                ),
                false,
            )),
            Outcome::Failed {
                reason: Failure::Read(error),
                ..
            } => Some((
                format!("Nothing was copied: rows of it didn't read ({error})."),
                true,
            )),
            Outcome::Refused { .. } => Some((
                "Nothing was copied: the browser didn't let Tycho write to the clipboard.".into(),
                true,
            )),
            Outcome::Unavailable { .. } => Some((
                "Nothing was copied: this page can't write to the clipboard.".into(),
                true,
            )),
            Outcome::Copying { .. } => {
                if self
                    .notice
                    .as_ref()
                    .is_some_and(|notice| notice.about == About::Copy)
                {
                    self.notice = None;
                    cx.notify();
                }
                None
            }
            // Written, writing, a cancel (Escape, another copy), or the table
            // closed: nothing to say.
            _ => None,
        };
        if let Some((text, error)) = text {
            self.notice = Some(Notice {
                text: text.into(),
                error,
                about: About::Copy,
            });
            cx.notify();
        }
    }

    /// Row `row`'s values, each cut at `most` characters, answered on
    /// `answer`: from the page the table holds, else read alone (Tycho's
    /// rule 3). None with no file open, past the rows, or when the read
    /// fails.
    #[cfg(target_family = "wasm")]
    pub(crate) fn row_values(
        &mut self,
        row: u64,
        most: usize,
        answer: futures::channel::oneshot::Sender<Option<crate::row::RowValues>>,
        cx: &mut Context<Self>,
    ) {
        let Load::Open { table, view, .. } = &self.load else {
            let _ = answer.send(None);
            return;
        };
        let rows = table.read(cx).delegate();
        if row >= table.read(cx).rows() {
            let _ = answer.send(None);
            return;
        }
        if let Some((page, at)) = rows.loaded(row) {
            let _ = answer.send(Some(crate::row::read(view, &*page, at, row, most)));
            return;
        }
        let sql = rows.page_sql(row..row + 1);
        let engine = cx.global::<seiza_duckdb::Engine>().clone();
        let table = table.clone();
        cx.spawn(async move |this, cx| {
            let page = engine.query(&sql).1.await;
            let values = this
                .update(cx, |this, _| match (&this.load, page) {
                    // Still the file it was asked of.
                    (
                        Load::Open {
                            table: shown, view, ..
                        },
                        Ok(page),
                    ) if *shown == table && page.num_rows() == 1 => {
                        Some(crate::row::read(view, &page, 0, row, most))
                    }
                    _ => None,
                })
                .ok()
                .flatten();
            let _ = answer.send(values);
        })
        .detach();
    }

    /// A page read of the open Parquet file failed: registers the file
    /// again under a new SQL name, then has the table read from it. After a
    /// failed HTTP range read, DuckDB-Wasm reads those bytes wrong under
    /// that name for good ("TProtocolException: Invalid data"), network or
    /// not, even registered again under it; a new name starts clean,
    /// at the cost of parsing the footer again. If registering fails too
    /// (still offline), the rows keep their error, and it tries again when
    /// its window ([`reregister_window_ms`]) passes.
    #[cfg(target_family = "wasm")]
    fn register_again(&mut self, table: Entity<RowTable>, cx: &mut Context<Self>) {
        let now = seiza::marks::now();
        // Only for the table shown, while it has failed reads, and while
        // the engine runs: a timer or a failed registration can come back
        // after another file opened, or after a success fixed it.
        let shown = matches!(&self.load, Load::Open { table: shown, .. } if *shown == table);
        let engine_up = !cx
            .try_global::<EngineStatus>()
            .is_some_and(EngineStatus::is_down);
        if !shown || !engine_up || !table.read(cx).has_failed_reads() {
            return;
        }
        let Some((name, source)) = self.parquet_source.clone() else {
            return;
        };
        if let Some(at) = self.reregistered_at {
            let wait = reregister_window_ms(self.reregistrations) - (now - at);
            if wait > 0.0 {
                // Rows in view don't retry on their own: come back then.
                if self.reregister_later.is_none() {
                    self.reregister_later = Some(cx.spawn(async move |this, cx| {
                        cx.background_executor()
                            .timer(std::time::Duration::from_millis(wait as u64))
                            .await;
                        let _ = this.update(cx, |this, cx| {
                            this.reregister_later = None;
                            this.register_again(table, cx);
                        });
                    }));
                }
                return;
            }
        }
        self.reregistered_at = Some(now);
        self.reregistrations += 1;
        let name = format!(
            "{}-r{}.parquet",
            name.trim_end_matches(".parquet"),
            self.reregistrations
        );
        let engine = cx.global::<seiza_duckdb::Engine>().clone();
        cx.spawn(async move |this, cx| {
            let Ok(info) = engine.register_file(&name, source).await else {
                // Still offline, say: try again once the window passes.
                let _ = this.update(cx, |this, cx| this.register_again(table, cx));
                return;
            };
            let _ = this.update(cx, |this, cx| {
                let shown =
                    matches!(&this.load, Load::Open { table: shown, .. } if *shown == table);
                if !shown {
                    return;
                }
                if let (Some(before), Some(counter)) = (&this.read_counter, info.bytes_read) {
                    this.read_counter = Some(counter.continuing(before));
                }
                // The failures that scheduled it are being retried now.
                this.reregister_later = None;
                table.update(cx, |table, cx| crate::table::read_from(table, name, cx));
            });
        })
        .detach();
    }

    /// The panel's rows for the open file: what DuckDB has read of it, and
    /// the table's scrolling and paging. Runs at the panel's refresh.
    #[cfg(target_family = "wasm")]
    fn refresh_panel(&mut self, cx: &mut Context<Self>) {
        let now = seiza::marks::now();
        let (read, size, table) = match &self.load {
            Load::Open {
                summary,
                table,
                csv,
                ..
            } => (
                match csv {
                    Some(load) => Some(load.read),
                    None => self
                        .read_counter
                        .as_ref()
                        .map(seiza_duckdb::ReadCounter::get),
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
    /// for the Playwright checks.
    fn publish(&self, window: &Window, cx: &App) {
        if !crate::targets::measuring() {
            return;
        }
        let focused = if let Load::Open { table, .. } = &self.load
            && table.read(cx).focus_handle().is_focused(window)
        {
            Some("table")
        } else if self.focus_handle.is_focused(window) {
            Some("workbench")
        } else {
            None
        };
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
        let status = self.message(cx);
        crate::targets::publish_workbench(&crate::targets::WorkbenchProbe {
            state,
            name,
            rows,
            message,
            notice: self.notice.as_ref().map(|notice| notice.text.as_ref()),
            ingest: csv.map(CsvLoad::state_name),
            read_bytes: csv.map(|load| load.read),
            chunks: csv.map(|load| load.chunks),
            focused,
            engine: EngineView::of(&cx.try_global::<EngineStatus>().cloned().unwrap_or_default())
                .state,
            status: status.as_ref().map(|line| line.text.as_str()),
        });
    }

    /// The workbench's one line in the frame: what's loading, or what
    /// failed. The engine's own state is the status bar's
    /// ([`EngineView`]); this adds what it means for the file.
    fn message(&self, cx: &App) -> Option<Line> {
        let engine = cx.try_global::<EngineStatus>().cloned().unwrap_or_default();
        let line = |text: String, error: bool| Some(Line { text, error });
        match (&engine, &self.load, &self.notice) {
            (EngineStatus::Failed(message), _, _) => line(
                // WebKit's import error ends in a period of its own.
                format!(
                    "The engine didn't load: {}. Retry loads it again.",
                    message.trim_end_matches('.')
                ),
                true,
            ),
            (
                EngineStatus::Stopped(_),
                Load::Failed {
                    name,
                    engine_stopped: true,
                    ..
                },
                _,
            ) => line(
                format!(
                    "The engine stopped while {name} was open, and the file closed with it. \
                     Retry starts a new engine; then open the file again."
                ),
                true,
            ),
            (EngineStatus::Stopped(message), _, _) => line(
                format!("The engine stopped ({message}). Retry starts a new one."),
                true,
            ),
            // A file refused while the sample downloads says why.
            (
                _,
                Load::Opening {
                    downloading: true, ..
                },
                Some(notice),
            ) if notice.error => line(notice.text.to_string(), true),
            (
                _,
                Load::Opening {
                    downloading: true, ..
                },
                _,
            ) => line("Downloading the sample…".into(), false),
            (EngineStatus::Loading, Load::Opening { .. }, _) => {
                line("Waiting for the engine to load…".into(), false)
            }
            (_, Load::Opening { name, .. }, _) => line(format!("Reading {name}…"), false),
            (_, _, Some(notice)) => line(notice.text.to_string(), notice.error),
            (_, Load::Failed { name, message, .. }, _) => {
                line(format!("Couldn't open {name}: {message}"), true)
            }
            (EngineStatus::Loading | EngineStatus::Ready { .. }, _, _) => None,
        }
    }

    /// What the page's frame shows ([`crate::frame`]).
    fn frame_view(&self, cx: &App) -> FrameView {
        let engine = cx.try_global::<EngineStatus>().cloned().unwrap_or_default();
        let file = match &self.load {
            Load::Open {
                summary,
                sample,
                csv,
                ..
            } => Some(FileView {
                name: summary.name.clone(),
                sample: *sample,
                facts: crate::frame::facts(summary),
                rows: summary.rows,
                load: csv.as_ref().map(|load| {
                    #[cfg(target_family = "wasm")]
                    let now = seiza::marks::now();
                    #[cfg(not(target_family = "wasm"))]
                    let now = load.started_at;
                    load.describe(now)
                }),
                credit: summary.credit.clone(),
                notes: csv
                    .iter()
                    .flat_map(|load| {
                        let widened = load.widened.iter().map(|(column, was, rows)| Line {
                            text: format!(
                                "{column} is shown as text: a value after row {} isn't a {was}.",
                                format_count(*rows)
                            ),
                            error: false,
                        });
                        let stopped = match &load.state {
                            IngestState::Stopped(message) => Some(Line {
                                text: format!(
                                    "Stopped reading after row {}: {message}. The rows before it are shown.",
                                    format_count(summary.rows)
                                ),
                                error: true,
                            }),
                            _ => None,
                        };
                        widened.chain(stopped)
                    })
                    .collect(),
            }),
            _ => None,
        };
        let busy = match &self.load {
            Load::Opening { sample: true, .. } => Some("sample"),
            Load::Opening { .. } => Some("file"),
            _ => None,
        };
        FrameView {
            engine: EngineView::of(&engine),
            file,
            busy,
            message: self.message(cx),
            panel: seiza::perf::is_visible(cx),
            log: self.log.view(),
            answer: self.answer.clone(),
            active: self.active,
            columns: self.columns.clone(),
        }
    }

    /// The Row tab's Previous row and Next row (`crate::frame`'s
    /// `select`): cell `row`, column `column` (its index) made the
    /// selection, a cell as an arrow key's move makes it (on the nearest
    /// shown column when that one is hidden), and scrolled into view the
    /// least distance. Focus stays where it is (the tab's button).
    #[cfg(target_family = "wasm")]
    pub(crate) fn select_cell(&mut self, row: u64, column: usize, cx: &mut Context<Self>) {
        use seiza_tall_table::TallTableSelection;

        let Load::Open { table, view, .. } = &self.load else {
            return;
        };
        let order = table.read(cx).order();
        let Some(place) = order.iter().position(|&index| index == column) else {
            return;
        };
        // The active cell can sit on a hidden column (a range keeps its
        // anchor through a hide, and select-all's is the first place): a
        // cell there alone isn't a selection, so the step lands on the
        // nearest shown column, right first, as the table's own keys do.
        let shown = |place: &usize| !view.is_hidden(order[*place]);
        let Some(place) = (place..order.len())
            .find(shown)
            .or_else(|| (0..place).rev().find(shown))
        else {
            return;
        };
        if row >= table.read(cx).rows() {
            return;
        }
        let cell = (row, place);
        table.update(cx, |table, cx| {
            table.select_in_view(
                Some(TallTableSelection::Cells {
                    anchor: cell,
                    head: cell,
                }),
                cx,
            )
        });
    }

    /// A cell's menu's Copy (`crate::frame`'s `copy`): the table's
    /// selection, as Cmd/Ctrl+C copies it, its events going to the
    /// clipboard as a key's do (`copied`); the table given focus.
    #[cfg(target_family = "wasm")]
    pub(crate) fn copy_selection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Load::Open { table, .. } = &self.load else {
            return;
        };
        let table = table.clone();
        table.update(cx, |table, cx| {
            table.copy(cx);
        });
        let focus = table.read(cx).focus_handle().clone();
        window.focus(&focus, cx);
    }

    /// The column's menu's Fit (`crate::frame`'s `fit`): column `index`
    /// fitted to its values by the table, as a double-click on its header's
    /// edge fits it, and the table given focus. The width comes back as the
    /// table's own change (`table_changed`), an entry in the log.
    #[cfg(target_family = "wasm")]
    pub(crate) fn fit_column(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Load::Open { table, .. } = &self.load else {
            return;
        };
        let table = table.clone();
        table.update(cx, |table, cx| table.fit_column(index, window, cx));
        let focus = table.read(cx).focus_handle().clone();
        window.focus(&focus, cx);
        cx.notify();
    }

    /// `?bench`'s pin hook (`crate::frame`'s `__tychoPin`): pins the shown
    /// table's first `columns`, as the column's menu will. It drives the
    /// table, never the view, which reads the count back from the table.
    /// Whether a table was shown.
    #[cfg(target_family = "wasm")]
    pub(crate) fn pin_for_bench(&mut self, columns: usize, cx: &mut Context<Self>) -> bool {
        let Load::Open { table, view, .. } = &mut self.load else {
            return false;
        };
        let pinned = table.update(cx, |table, cx| {
            table.set_pinned(columns, cx);
            table.pinned()
        });
        // `Pinned` comes only when the run in effect changes, and a count
        // too wide to pin changes none: the count is read from the table.
        if view.set_pinned(pinned) {
            self.publish_view();
        }
        true
    }

    /// The open file's view, for completion and for checking an action.
    fn catalog(&self) -> Option<Catalog> {
        let Load::Open { view, csv, .. } = &self.load else {
            return None;
        };
        Some(Catalog {
            view: (**view).clone(),
            loading: csv
                .as_ref()
                .is_some_and(|load| load.state == IngestState::Loading),
        })
    }

    /// Gives completion the open file's view when it changed: compared in
    /// place, since this runs every render.
    fn publish_catalog(&mut self) {
        let same = match (&self.shown_catalog, &self.load) {
            (Some(Some(shown)), Load::Open { view, csv, .. }) => {
                shown.view == **view
                    && shown.loading
                        == csv
                            .as_ref()
                            .is_some_and(|load| load.state == IngestState::Loading)
            }
            (Some(None), Load::Open { .. }) | (None, _) | (Some(Some(_)), _) => false,
            (Some(None), _) => true,
        };
        if same {
            return;
        }
        let catalog = self.catalog();
        #[cfg(target_family = "wasm")]
        crate::frame::set_catalog(catalog.clone());
        self.shown_catalog = Some(catalog);
    }

    /// The log starts again with the file just opened.
    #[cfg(target_family = "wasm")]
    fn start_log(&mut self) {
        if let Load::Open { summary, view, .. } = &self.load {
            self.log
                .open(&summary.name, view, self.origin, crate::log::now());
        }
    }

    /// The shown table changed its widths, order, or pins: the view takes
    /// it, from the table as it is now, and a change the table made by
    /// itself (a drag; a command's own calls come back as none) is an
    /// entry in the log.
    #[cfg(target_family = "wasm")]
    fn table_changed(
        &mut self,
        table: &Entity<RowTable>,
        event: &TallTableEvent,
        cx: &mut Context<Self>,
    ) {
        let (order, pinned) = {
            let table = table.read(cx);
            (table.order().to_vec(), table.pinned())
        };
        let Load::Open { view, .. } = &mut self.load else {
            return;
        };
        let before = (**view).clone();
        if view.take(event, &order, pinned) {
            self.log
                .table_changed(&before, view, &self.drawn, crate::log::now());
            self.publish_view();
            cx.notify();
        }
        self.drawn = drawn_widths(table, cx);
    }

    /// A command from the bar, typed or pasted (`crate::frame::command`):
    /// run all or none, answered in the bar, and kept in the log (but a
    /// sentence, `open`, and `undo`, which the bar answers alone). Only an
    /// action needs a file open: the rest are answered as completion's
    /// preview answers them.
    #[cfg(target_family = "wasm")]
    pub(crate) fn command(
        &mut self,
        text: &str,
        origin: Origin,
        ask: u32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        // Every answer the command gives is given before it returns.
        self.asking = ask;
        if origin == Origin::Click
            && self
                .notice
                .as_ref()
                .is_some_and(|notice| notice.about == About::Click)
        {
            self.notice = None;
        }
        self.run_command(text, origin, window, cx);
        // A click's command comes from a menu or the column list, where no
        // bar is open: a refusal is said in the frame's line instead.
        if origin == Origin::Click
            && let Some(answer) = &self.answer
            && answer.ask == ask
            && (answer.error || answer.kind == "refused")
        {
            self.notice = Some(Notice {
                text: answer.text.clone().into(),
                error: answer.error,
                about: About::Click,
            });
            cx.notify();
        }
        self.asking = 0;
    }

    #[cfg(target_family = "wasm")]
    fn run_command(
        &mut self,
        text: &str,
        origin: Origin,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::command::{Parsed, Step, plan};
        use crate::log::Reply;

        let parsed = crate::command::parse(text);
        if parsed == Parsed::Empty {
            return;
        }
        let catalog = self.catalog();
        let open = catalog.is_some();
        let at = crate::log::now();
        let written = shorten(text.trim());
        match parsed {
            Parsed::Empty => {}
            Parsed::Sentence => self.say("sentence", plan::SENTENCE.into(), Vec::new(), false, cx),
            Parsed::Open => self.say("open", plan::OPEN.into(), Vec::new(), false, cx),
            Parsed::Later { verb, goal, step } => {
                let answer = plan::later(verb, goal, step);
                if !open {
                    self.say("later", answer, Vec::new(), false, cx);
                    return;
                }
                self.log.note(
                    Some(written.clone()),
                    written,
                    Reply::Answer(answer.clone()),
                    origin,
                    at,
                );
                self.say("later", answer, Vec::new(), false, cx);
            }
            Parsed::Error(why) if !open => self.say("refused", why, Vec::new(), true, cx),
            Parsed::Error(why) => {
                self.log.note(
                    Some(written.clone()),
                    written,
                    Reply::Error(why.clone()),
                    origin,
                    at,
                );
                self.say("refused", why, Vec::new(), true, cx);
            }
            Parsed::Action { steps, .. } => match catalog {
                None => self.say("nofile", plan::NO_FILE.into(), Vec::new(), false, cx),
                Some(_) if steps == [Step::Undo] => self.undo(window, cx),
                Some(catalog) => match plan::plan(&steps, &catalog) {
                    Err(refusal) => {
                        let lines = steps.iter().map(Step::written).collect::<Vec<_>>();
                        let words = steps.iter().map(Step::words).collect::<Vec<_>>();
                        self.refused(
                            shorten(&lines.join("\n")),
                            shorten(&words.join("\n")),
                            &refusal,
                            origin,
                            at,
                            cx,
                        );
                    }
                    Ok(plan) => self.run(plan, origin, at, window, cx),
                },
            },
        }
    }

    /// Runs a checked action: the controller first, then the table, whose
    /// events come back as no change; then the row brought into view and
    /// focus on the table.
    #[cfg(target_family = "wasm")]
    fn run(
        &mut self,
        plan: crate::command::Plan,
        origin: Origin,
        at: f64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::log::Reply;

        let Load::Open { table, view, .. } = &mut self.load else {
            return;
        };
        let table = table.clone();
        let laid_out = self.laid_out == Some(table.entity_id());
        // Capped, as a typed line is: a pasted action can be any length.
        let lines = shorten(
            &plan
                .steps
                .iter()
                .map(|step| step.line.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        );
        let steps: Vec<String> = plan.steps.iter().map(|step| step.words.clone()).collect();
        let words = shorten(&steps.join("\n"));
        let reply = if plan.changed {
            let before = (**view).clone();
            let columns = !view.same_columns(&plan.view);
            **view = plan.view.clone();
            let calls = view.calls();
            // After any pin Tycho makes, the table's count into the view.
            let (pinned, drawn) = table.update(cx, |table, cx| {
                calls.arrange(columns, table, cx);
                (table.pinned(), table.pinned_in_effect())
            });
            view.set_pinned(pinned);
            // A pin the table can't draw (the run would pass half its
            // width) leaves its column scrolling: the action is refused,
            // all or none, and the view given back. The table's events
            // from both come back as no change.
            // Before the table's first layout its run in effect reads 0
            // whatever fits, so it's judged only once the table has a width.
            if laid_out && let Some(refusal) = plan.undrawn_pin(view, drawn) {
                **view = before;
                let calls = view.calls();
                let pinned = table.update(cx, |table, cx| {
                    calls.arrange(columns, table, cx);
                    table.pinned()
                });
                view.set_pinned(pinned);
                self.refused(lines, words, &refusal, origin, at, cx);
                return;
            }
            let reply = Reply::of(view);
            self.log
                .step(Some(lines), words, reply.clone(), origin, at, view.view());
            self.publish_view();
            reply
        } else {
            // A jump alone, or steps that undo each other (`pin x`, then
            // `unpin x`): no state to keep.
            let reply = Reply::Answer(match plan.jump {
                Some(row) => format!("Row {} is in view", format_count(row + 1)),
                None => "The view is as it was.".into(),
            });
            self.log.note(Some(lines), words, reply.clone(), origin, at);
            reply
        };
        if let Some(row) = plan.jump {
            table.update(cx, |table, cx| table.jump_to(row, cx));
        }
        let focus = table.read(cx).focus_handle().clone();
        window.focus(&focus, cx);
        self.say("done", reply.text(), steps, false, cx);
    }

    /// An action refused, nothing of it run: a log entry, and the bar's
    /// answer.
    #[cfg(target_family = "wasm")]
    fn refused(
        &mut self,
        lines: String,
        words: String,
        refusal: &crate::command::Refusal,
        origin: Origin,
        at: f64,
        cx: &mut Context<Self>,
    ) {
        use crate::log::Reply;

        let answer = refusal.to_string();
        let reply = if refusal.error {
            Reply::Error(answer.clone())
        } else {
            Reply::Answer(answer.clone())
        };
        self.log.note(Some(lines), words, reply, origin, at);
        self.say("refused", answer, Vec::new(), refusal.error, cx);
    }

    /// `undo`: the state of the log's entry the current one was taken
    /// from, current once it's given back. It adds no entry.
    #[cfg(target_family = "wasm")]
    fn undo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match self.log.undo_target() {
            Some(target) => match self.restore(&target.view, window, cx) {
                Ok(true) => {
                    self.log.go(&target);
                    let text = format!("Back to: {}", target.words);
                    self.say("undone", text, Vec::new(), false, cx);
                }
                Ok(false) => {}
                Err(text) => self.say("refused", text, Vec::new(), true, cx),
            },
            None => self.say("nothing", "Nothing to undo.".into(), Vec::new(), false, cx),
        }
    }

    /// The way back on log entry `id` (`crate::frame::back_to`): its state,
    /// current again. It adds no entry; an entry with no state, or of a
    /// file since replaced, does nothing.
    #[cfg(target_family = "wasm")]
    pub(crate) fn back_to(&mut self, id: u32, window: &mut Window, cx: &mut Context<Self>) {
        let Some(target) = self.log.back_target(id) else {
            return;
        };
        match self.restore(&target.view, window, cx) {
            Ok(true) => {
                self.log.go(&target);
                // A refused way back's line goes with the next that works.
                if self
                    .notice
                    .as_ref()
                    .is_some_and(|notice| notice.about == About::Back)
                {
                    self.notice = None;
                }
            }
            Ok(false) => return,
            // Pressed in the log, not the bar, so it's said in the frame's
            // line (the status bar's; a phone's under the top bar), as a
            // file refused is.
            Err(text) => {
                self.notice = Some(Notice {
                    text: text.into(),
                    error: true,
                    about: About::Back,
                });
            }
        }
        cx.notify();
    }

    /// Gives the controller, then the table, a log entry's state, and the
    /// table focus: whether it could (none with no file open), or why not,
    /// for the caller to say. An entry of this file's always should.
    #[cfg(target_family = "wasm")]
    fn restore(
        &mut self,
        state: &ViewState,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<bool, String> {
        let Load::Open { table, view, .. } = &mut self.load else {
            return Ok(false);
        };
        let before = (**view).clone();
        if let Err(refused) = view.restore(state) {
            return Err(format!("Couldn't go back: {refused}."));
        }
        let table = table.clone();
        let columns = !view.same_columns(&before);
        let calls = view.calls();
        let pinned = table.update(cx, |table, cx| {
            calls.arrange(columns, table, cx);
            table.pinned()
        });
        view.set_pinned(pinned);
        self.publish_view();
        let focus = table.read(cx).focus_handle().clone();
        window.focus(&focus, cx);
        Ok(true)
    }

    /// The bar's answer.
    #[cfg(target_family = "wasm")]
    fn say(
        &mut self,
        kind: &'static str,
        text: String,
        steps: Vec<String>,
        error: bool,
        cx: &mut Context<Self>,
    ) {
        self.answers += 1;
        self.answer = Some(Answer {
            seq: self.answers,
            ask: self.asking,
            kind,
            text,
            steps,
            error,
        });
        cx.notify();
    }

    /// Publishes the open file's view to `globalThis.__tychoView` when it
    /// changed, while measuring: read-only, for the checks.
    fn publish_view(&mut self) {
        if !crate::targets::measuring() {
            return;
        }
        let view = match &self.load {
            Load::Open { view, .. } => Some(view.view()),
            _ => None,
        };
        if self.shown_view.as_ref() == Some(&view) {
            return;
        }
        #[cfg(target_family = "wasm")]
        crate::view::publish(view.as_ref());
        self.shown_view = Some(view);
    }

    /// Builds the frame's column list again when the open file's view
    /// changed: compared in place, since this runs every render.
    fn refresh_columns(&mut self) {
        match &self.load {
            Load::Open { view, .. } => {
                if self.columns_of.as_ref() != Some(&**view) {
                    self.columns = view
                        .order()
                        .iter()
                        .map(|&index| ColumnFacts::of(view, index))
                        .collect();
                    self.columns_of = Some((**view).clone());
                }
            }
            _ => {
                if self.columns_of.take().is_some() {
                    self.columns = Rc::from([]);
                }
            }
        }
    }

    /// Sends the frame's state to the page when it changed.
    fn publish_frame(&mut self, cx: &App) {
        self.refresh_columns();
        let view = self.frame_view(cx);
        if self.shown_frame.as_ref() == Some(&view) {
            return;
        }
        #[cfg(target_family = "wasm")]
        crate::frame::publish(&view);
        self.shown_frame = Some(view);
    }
}

/// Each column's width as drawn, by index.
#[cfg(target_family = "wasm")]
fn drawn_widths(table: &Entity<RowTable>, cx: &App) -> Vec<f32> {
    let table = table.read(cx);
    (0..table.columns().len())
        .map(|index| table.column_width(index).map_or(0.0, f32::from))
        .collect()
}

/// A line kept in the log as written, cut at 200 characters (a pasted
/// text can be long).
#[cfg(target_family = "wasm")]
fn shorten(text: &str) -> String {
    const MOST: usize = 200;
    match text.char_indices().nth(MOST) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_owned(),
    }
}

impl Render for Workbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        #[cfg(target_family = "wasm")]
        {
            self.mark_summary_shown(cx);
            self.mark_csv_shown();
        }
        self.publish(window, cx);
        self.publish_view();
        self.publish_catalog();
        self.publish_frame(cx);

        div()
            // Focusable only so lost focus has somewhere to go back to (see
            // `new`): a press here must not take focus from the table. Bubble
            // listeners run in reverse, so this runs before the root's own
            // focus-on-press, after the table's.
            .track_focus(&self.focus_handle)
            .key_context(CONTEXT)
            .on_action(cx.listener(Self::open_row))
            .on_any_mouse_down(|_, window, _| window.prevent_default())
            .size_full()
            .children(match &self.load {
                Load::Open { table, .. } => Some(TallTable::new(table)),
                _ => None,
            })
    }
}
