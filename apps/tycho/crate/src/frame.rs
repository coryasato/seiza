//! The page's frame and the app between them: the top bar, the first
//! screen, and the status bar are DOM (`web/src/frame/`), and the canvas
//! holds the table alone (`docs/DECISIONS.md`, "Scope", 2026-11-20, "Only
//! the table is canvas"). The logic stays here: the workbench describes
//! what the frame shows as one [`FrameView`], published to the page each
//! time it changes, and the page's presses come back through the
//! `#[wasm_bindgen]` calls below.

use crate::dataset::{FileSummary, format_bytes, format_count};

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
pub use web::{Frame, connect, publish};

#[cfg(target_family = "wasm")]
mod web {
    use std::cell::RefCell;

    use gpui_kit::{AnyWindowHandle, App, AsyncApp, WeakEntity, Window};
    use js_sys::{Array, Object, Reflect};
    use wasm_bindgen::prelude::*;

    use super::{FrameView, Line};
    use crate::Workbench;

    #[wasm_bindgen]
    extern "C" {
        /// The page's side (`web/src/frame/state.ts`, `frameSink`).
        pub type Frame;
        /// Takes the frame's state each time it changes.
        #[wasm_bindgen(method)]
        fn update(this: &Frame, state: &JsValue);
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

    /// Sends `view` to the page.
    pub fn publish(view: &FrameView) {
        SINK.with_borrow(|sink| {
            if let Some(sink) = sink {
                sink.update(&to_js(view));
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
        ])
    }

    /// The first theme, before the first frame: from `start`.
    pub fn first_theme(dark: bool, cx: &mut App) {
        // The page decides from here on: it follows the system until the
        // visitor picks, and says so through `set_theme`.
        seiza::stop_following_system_appearance(cx);
        crate::theme::apply(dark, cx);
    }

    /// A file dropped on the page or chosen in its dialog, at `at` (ms from
    /// `timeOrigin`); `more` counts the other files of the same drop.
    #[wasm_bindgen]
    pub fn open_file(file: web_sys::File, at: f64, more: u32) {
        send(on_workbench(move |workbench, window, cx| {
            workbench.file_chosen(file, at, more, window, cx)
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
pub use web::{first_theme, set_sink};

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
