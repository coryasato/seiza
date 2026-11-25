//! The page's frame and the app between them: the top bar, the first
//! screen, and the status bar are DOM (`web/src/frame/`), and the canvas
//! holds the table alone (`docs/DECISIONS.md`, "Scope", 2026-11-20, "Only
//! the table is canvas"). The logic stays here: the workbench describes
//! what the frame shows as one [`FrameView`], published to the page each
//! time it changes, and the page's presses come back through the
//! `#[wasm_bindgen]` calls below.
//!
//! The command bar and the log are the page's to draw and the app's to
//! run: the page sends the bar's text (`command`, `complete`) and the log's
//! way back (`back_to`), and the frame's state carries the log and the
//! bar's last answer (`docs/DECISIONS.md`, "Scope", 2026-11-24, "The
//! thread's two proposed items are taken").
//!
//! The table's presses that open the page's menus and its Row tab reach the
//! page as one event each ([`Press`], through the sink's `press`), and the
//! Row tab reads its row's values with [`web::row`].

use serde::Serialize;

use crate::dataset::{FileSummary, format_bytes, format_count};
use crate::log::LogView;

/// What the frame shows, as the page reads it (`web/src/frame/state.ts`,
/// `FrameState`, spells the same fields).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct FrameView {
    pub engine: EngineView,
    /// The file whose rows are shown; none on the first screen.
    pub file: Option<FileView>,
    /// What's opening: `file` (a drop or a pick) or `sample`.
    pub busy: Option<&'static str>,
    /// The workbench's one line: what's loading, a file refused, or why an
    /// open failed. None when there's nothing to say beyond the engine.
    pub message: Option<Line>,
    /// The perf panel is open: it draws on the canvas, under the first
    /// screen's ghost of a table, which steps aside for it.
    pub panel: bool,
    /// The open file's log (`crate::log`); empty with none open.
    pub log: LogView,
    /// The command bar's last answer.
    pub answer: Option<Answer>,
    /// The table's active cell (its selection's anchor), which the Row
    /// tab shows the row of; none with nothing selected.
    pub active: Option<ActiveCell>,
}

/// The table's active cell (`web/src/frame/state.ts`, `ActiveCell`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ActiveCell {
    /// 0-based.
    pub row: u64,
    /// The column's index in the file.
    pub column: usize,
}

/// A press in the table that the page answers (`web/src/frame/state.ts`,
/// `TablePress`): a column's menu, a cell's menu, or the Row tab.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Press {
    /// `icon` (a header's icon, its menu under `at`), `header` (a
    /// right-click or a long press on a header), `cell` (one on a cell),
    /// `double` (a double press on a cell), `enter` (Enter on a cell with
    /// no popover), or `open` (the popover's "Open row").
    pub kind: &'static str,
    pub column: ColumnFacts,
    /// A cell's row, 0-based; none on a header.
    pub row: Option<u64>,
    /// A cell's value, its exact text cut at `crate::row::PRESS_CHARS`
    /// characters; none for NULL, a header, or a row not loaded.
    pub value: Option<String>,
    /// The icon's badge (`icon`), or the pointer (`header`, `cell`: no
    /// size), in CSS px from the canvas's top left; none for a key's.
    pub at: Option<Rect>,
}

/// What a column's menu shows of it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnFacts {
    /// Its index in the file.
    pub index: usize,
    pub name: String,
    /// `number`, `text`, `time`, or `boolean`: its badge.
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// DuckDB's type name.
    pub data_type: String,
    pub pinned: bool,
    pub hidden: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl ColumnFacts {
    /// Column `index` of `view`.
    pub fn of(view: &crate::view::Controller, index: usize) -> Self {
        let info = &view.columns()[index];
        Self {
            index,
            name: info.name.clone(),
            kind: crate::table::type_name(info),
            data_type: info.data_type.clone(),
            pinned: view.is_pinned(index),
            hidden: view.is_hidden(index),
        }
    }
}

/// What the bar answered on Enter (`web/src/frame/state.ts`, `Answer`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Answer {
    /// Counts answers, so the same words twice are two.
    pub seq: u32,
    /// The command it answers, as [`command`] numbered it; 0 for an answer
    /// to no command (the way back refused). The bar shows and acts on its
    /// own command's answer alone: one to an earlier command can arrive
    /// after the next is sent.
    pub ask: u32,
    /// `done` (the steps that ran, `text` the reply), `refused`,
    /// `sentence`, `later`, `open`, `nofile`, `undone`, or `nothing` (no
    /// step to undo).
    pub kind: &'static str,
    pub text: String,
    /// The steps that ran, in plain words.
    pub steps: Vec<String>,
    /// A fault, in the error color.
    pub error: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct EngineView {
    /// `loading`, `ready`, `failed`, or `stopped`.
    pub state: &'static str,
    /// Its words in the status bar.
    pub text: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FileView {
    pub name: String,
    pub sample: bool,
    /// `Parquet · 71,413 rows · 46 columns · 33.8 MiB`.
    pub facts: String,
    /// A CSV's load while it reads, or how it ended.
    pub load: Option<String>,
    /// From the file's metadata (a sample's build writes it).
    pub credit: Option<String>,
    /// What the file's menu adds: a column shown as text, a load stopped.
    pub notes: Vec<Line>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub text: String,
    pub error: bool,
}

impl EngineView {
    pub fn of(status: &seiza_duckdb::EngineStatus) -> Self {
        use seiza_duckdb::EngineStatus;
        let (state, text) = match status {
            EngineStatus::Loading => ("loading", "Loading DuckDB"),
            EngineStatus::Ready { .. } => ("ready", "DuckDB ready"),
            EngineStatus::Failed(_) => ("failed", "DuckDB didn't load"),
            EngineStatus::Stopped(_) => ("stopped", "DuckDB stopped"),
        };
        Self { state, text }
    }
}

/// The status bar's facts: the format, rows, columns, and size.
pub fn facts(summary: &FileSummary) -> String {
    let mut facts = vec![
        if summary.row_groups.is_some() {
            "Parquet"
        } else {
            "CSV"
        }
        .to_owned(),
        format!("{} rows", format_count(summary.rows)),
        format!(
            "{} column{}",
            format_count(summary.columns.len() as u64),
            if summary.columns.len() == 1 { "" } else { "s" }
        ),
    ];
    if let Some(bytes) = summary.bytes {
        facts.push(format_bytes(bytes));
    }
    facts.join(" · ")
}

#[cfg(target_family = "wasm")]
pub use web::{Frame, connect, copy_outcome, press, publish};

#[cfg(target_family = "wasm")]
mod web {
    use std::cell::{Cell, RefCell};

    use gpui_kit::{AnyWindowHandle, App, AsyncApp, WeakEntity, Window};
    use js_sys::{Array, Object, Reflect};
    use wasm_bindgen::prelude::*;

    use super::{FrameView, Line};
    use crate::Workbench;
    use crate::command::Catalog;
    use crate::log::Origin;

    #[wasm_bindgen]
    extern "C" {
        /// The page's side (`web/src/frame/state.ts`, `frameSink`).
        pub type Frame;
        /// Takes the frame's state each time it changes.
        #[wasm_bindgen(method)]
        fn update(this: &Frame, state: &JsValue);
        /// Takes a press in the table the page answers.
        #[wasm_bindgen(method)]
        fn press(this: &Frame, press: &JsValue);
    }

    /// One of the page's calls, run with the window and the app: never
    /// inside the workbench's own update, since a call that sets a global
    /// the workbench observes (the engine's status, the panel's) would
    /// update it again from within ([`on_workbench`] leases it for the
    /// calls that are its).
    type Call = Box<dyn FnOnce(&WeakEntity<Workbench>, &mut Window, &mut App)>;

    /// A call on the workbench itself.
    fn on_workbench(
        call: impl FnOnce(&mut Workbench, &mut Window, &mut gpui_kit::Context<Workbench>) + 'static,
    ) -> Call {
        Box::new(move |workbench, window, cx| {
            let _ = workbench.update(cx, |workbench, cx| call(workbench, window, cx));
        })
    }

    struct Link {
        workbench: WeakEntity<Workbench>,
        window: AnyWindowHandle,
        cx: AsyncApp,
    }

    thread_local! {
        static SINK: RefCell<Option<Frame>> = const { RefCell::new(None) };
        static LINK: RefCell<Option<Link>> = const { RefCell::new(None) };
        /// The page's calls made before the workbench existed.
        static PENDING: RefCell<Vec<Call>> = const { RefCell::new(Vec::new()) };
        /// The open file's view, which [`complete`] reads: it answers at
        /// once, outside GPUI's turn, so the workbench leaves it here
        /// ([`set_catalog`]) each time it changes.
        static CATALOG: RefCell<Option<Catalog>> = const { RefCell::new(None) };
        /// The commands sent, numbering each for its answer.
        static ASKS: Cell<u32> = const { Cell::new(0) };
    }

    /// Where [`publish`] sends the frame's state: from `start`.
    pub fn set_sink(frame: Frame) {
        SINK.set(Some(frame));
    }

    /// The workbench the page's calls go to, once it exists; the calls made
    /// before it did run now.
    pub fn connect(workbench: WeakEntity<Workbench>, window: AnyWindowHandle, cx: &App) {
        LINK.set(Some(Link {
            workbench,
            window,
            cx: cx.to_async(),
        }));
        for call in PENDING.take() {
            send(call);
        }
        if seiza::url::has_param("bench") {
            install_pin_hook();
        }
    }

    /// `?bench` only: `globalThis.__tychoPin(columns)` pins the shown
    /// table's first `columns` through the table itself, so a check can pin
    /// one before the column's menu exists (a drag pins only across a run
    /// already pinned). The view takes it from the table's event, as it
    /// takes a drag's; nothing writes the view from the page
    /// (`docs/DECISIONS.md`, "Scope", 2026-11-23).
    fn install_pin_hook() {
        let hook = Closure::<dyn Fn(u32)>::new(|columns: u32| {
            send(on_workbench(move |workbench, _, cx| {
                workbench.pin_for_bench(columns as usize, cx);
            }));
        });
        let _ = Reflect::set(
            &js_sys::global(),
            &JsValue::from_str("__tychoPin"),
            hook.as_ref(),
        );
        hook.forget();
    }

    /// Runs `call` on GPUI's next turn: the page calls in outside GPUI's
    /// update cycle, so the app is never borrowed twice. The window redraws
    /// after it, as after an event of its own.
    fn send(call: Call) {
        LINK.with_borrow(|link| match link {
            None => PENDING.with_borrow_mut(|pending| pending.push(call)),
            Some(Link {
                workbench,
                window,
                cx,
            }) => {
                let (workbench, window, mut app) = (workbench.clone(), *window, cx.clone());
                cx.foreground_executor()
                    .spawn(async move {
                        let _ = window.update(&mut app, |_, window, cx| {
                            call(&workbench, window, cx);
                            window.refresh();
                        });
                    })
                    .detach();
            }
        });
    }

    /// What [`complete`] completes against: the open file's view, or none.
    pub fn set_catalog(catalog: Option<Catalog>) {
        CATALOG.set(catalog);
    }

    /// `value` as the page reads it: through JSON, as `globalThis.__tychoView`.
    fn json(value: &impl serde::Serialize) -> JsValue {
        serde_json::to_string(value)
            .ok()
            .and_then(|json| js_sys::JSON::parse(&json).ok())
            .unwrap_or(JsValue::NULL)
    }

    /// Sends `view` to the page.
    pub fn publish(view: &FrameView) {
        SINK.with_borrow(|sink| {
            if let Some(sink) = sink {
                sink.update(&to_js(view));
            }
        });
    }

    /// What became of a copy (the clipboard's writer's callback, which
    /// runs outside GPUI): to the workbench on GPUI's next turn.
    pub fn copy_outcome(outcome: tall_table_bridge::clipboard::Outcome) {
        send(on_workbench(move |workbench, _, cx| {
            workbench.copy_outcome(outcome, cx)
        }));
    }

    /// Sends a press in the table to the page.
    pub fn press(press: &super::Press) {
        SINK.with_borrow(|sink| {
            if let Some(sink) = sink {
                sink.press(&json(press));
            }
        });
    }

    fn to_js(view: &FrameView) -> JsValue {
        let object = |entries: &[(&str, JsValue)]| {
            let object = Object::new();
            for (key, value) in entries {
                let _ = Reflect::set(&object, &JsValue::from_str(key), value);
            }
            JsValue::from(object)
        };
        let text = |value: Option<&str>| value.map_or(JsValue::NULL, JsValue::from_str);
        let line = |line: &Line| {
            object(&[
                ("text", JsValue::from_str(&line.text)),
                ("error", JsValue::from_bool(line.error)),
            ])
        };
        let file = view.file.as_ref().map_or(JsValue::NULL, |file| {
            object(&[
                ("name", JsValue::from_str(&file.name)),
                ("sample", JsValue::from_bool(file.sample)),
                ("facts", JsValue::from_str(&file.facts)),
                ("load", text(file.load.as_deref())),
                ("credit", text(file.credit.as_deref())),
                (
                    "notes",
                    file.notes.iter().map(line).collect::<Array>().into(),
                ),
            ])
        });
        object(&[
            (
                "engine",
                object(&[
                    ("state", JsValue::from_str(view.engine.state)),
                    ("text", JsValue::from_str(view.engine.text)),
                ]),
            ),
            ("file", file),
            ("busy", text(view.busy)),
            ("message", view.message.as_ref().map_or(JsValue::NULL, line)),
            ("panel", JsValue::from_bool(view.panel)),
            (
                "log",
                object(&[
                    ("entries", json(&*view.log.entries)),
                    (
                        "current",
                        view.log.current.map_or(JsValue::NULL, JsValue::from),
                    ),
                ]),
            ),
            ("answer", view.answer.as_ref().map_or(JsValue::NULL, json)),
            ("active", view.active.as_ref().map_or(JsValue::NULL, json)),
        ])
    }

    /// The first theme, before the first frame: from `start`.
    pub fn first_theme(dark: bool, cx: &mut App) {
        // The page decides from here on: it follows the system until the
        // visitor picks, and says so through `set_theme`.
        seiza::stop_following_system_appearance(cx);
        crate::theme::apply(dark, cx);
    }

    /// A file dropped on the page or chosen in its dialog (`from`: `drop`
    /// or `pick`), at `at` (ms from `timeOrigin`); `more` counts the other
    /// files of the same drop.
    #[wasm_bindgen]
    pub fn open_file(file: web_sys::File, at: f64, more: u32, from: String) {
        let from = match from.as_str() {
            "drop" => Origin::Drop,
            _ => Origin::Pick,
        };
        send(on_workbench(move |workbench, window, cx| {
            workbench.file_chosen(file, at, more, from, window, cx)
        }));
    }

    /// The command bar's Enter: `text` typed or pasted (`source`: `typed`,
    /// `pasted`, or `click`, an item of the bar's list). Its answer comes
    /// in the frame's state, carrying the number this returns
    /// (`Answer::ask`), and its entry in the log.
    #[wasm_bindgen]
    pub fn command(text: String, source: String) -> u32 {
        let origin = Origin::named(&source);
        let ask = ASKS.get() + 1;
        ASKS.set(ask);
        send(on_workbench(move |workbench, window, cx| {
            workbench.command(&text, origin, ask, window, cx)
        }));
        ask
    }

    /// The bar's completion for `text` with its caret at `caret` (UTF-16
    /// units), at once: the part being typed, what matches, and what Enter
    /// would do (`crate::command::Completion`).
    #[wasm_bindgen]
    pub fn complete(text: String, caret: u32) -> JsValue {
        CATALOG.with_borrow(|catalog| {
            json(&crate::command::complete(
                &text,
                caret as usize,
                catalog.as_ref(),
            ))
        })
    }

    /// Row `row`'s values (0-based), for the Row tab: a promise of
    /// `crate::row::RowValues`, or null with no file open, no such row, or
    /// its read failed. From the page the table holds when it's loaded, else
    /// read alone.
    #[wasm_bindgen]
    pub fn row(row: f64) -> js_sys::Promise {
        let (answer, answered) = futures::channel::oneshot::channel();
        // A row's number is whole and not negative; anything else is no row.
        if row.is_finite() && row >= 0.0 && row.fract() == 0.0 {
            send(on_workbench(move |workbench, _, cx| {
                workbench.row_values(row as u64, answer, cx)
            }));
        } else {
            let _ = answer.send(None);
        }
        wasm_bindgen_futures::future_to_promise(async move {
            Ok(match answered.await {
                Ok(Some(values)) => json(&values),
                _ => JsValue::NULL,
            })
        })
    }

    /// The log's way back on entry `entry`.
    #[wasm_bindgen]
    pub fn back_to(entry: u32) {
        send(on_workbench(move |workbench, window, cx| {
            workbench.back_to(entry, window, cx)
        }));
    }

    /// The first screen's sample row, pressed at `at`.
    #[wasm_bindgen]
    pub fn open_sample(at: f64) {
        send(on_workbench(move |workbench, window, cx| {
            workbench.open_sample(at, window, cx)
        }));
    }

    /// The status bar's Retry, after the engine failed to load or stopped.
    #[wasm_bindgen]
    pub fn retry_engine() {
        send(Box::new(|_, _, cx| seiza_duckdb::retry(cx)));
    }

    /// The page's theme changed (its toggle, or the system while it
    /// follows it).
    #[wasm_bindgen]
    pub fn set_theme(dark: bool) {
        send(Box::new(move |_, _, cx| crate::theme::apply(dark, cx)));
    }

    /// The perf panel's key: the page takes it wherever focus is
    /// (`web/src/frame/core.ts`), so the panel's own binding never runs too.
    #[wasm_bindgen]
    pub fn toggle_perf() {
        send(Box::new(|_, _, cx| seiza::perf::toggle(cx)));
    }
}

#[cfg(target_family = "wasm")]
pub use web::{first_theme, set_catalog, set_sink};

#[cfg(test)]
mod tests {
    use super::*;
    use seiza_duckdb::sql::ColumnInfo;

    fn summary(row_groups: Option<u64>, columns: usize) -> FileSummary {
        FileSummary {
            name: "gcat.parquet".into(),
            bytes: Some(35_456_966),
            rows: 71_413,
            row_groups,
            columns: (0..columns)
                .map(|i| ColumnInfo::new(format!("c{i}"), "VARCHAR"))
                .collect(),
            credit: None,
        }
    }

    #[test]
    fn facts_line() {
        assert_eq!(
            facts(&summary(Some(1), 46)),
            "Parquet · 71,413 rows · 46 columns · 33.8 MiB"
        );
        assert_eq!(
            facts(&summary(None, 1)),
            "CSV · 71,413 rows · 1 column · 33.8 MiB"
        );
    }

    #[test]
    fn engine_words() {
        use seiza_duckdb::EngineStatus;
        assert_eq!(
            EngineView::of(&EngineStatus::Loading).text,
            "Loading DuckDB"
        );
        assert_eq!(
            EngineView::of(&EngineStatus::Ready { ready_ms: 1.0 }).state,
            "ready"
        );
        assert_eq!(
            EngineView::of(&EngineStatus::Failed("x".into())).state,
            "failed"
        );
    }
}
