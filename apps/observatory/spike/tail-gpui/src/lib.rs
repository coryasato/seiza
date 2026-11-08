//! Throwaway: live tail's GPUI spike. The tall table built `follow`, over
//! the NASA logs' file (fetched whole by the JS host and registered as a
//! `File`) read a page at a time through DuckDB-Wasm, looping past its end
//! (row i is the file's row i mod n, its time moved on by ⌊i / n⌋ spans);
//! the rows grow by the clock worker's counts (`rowsDue`), each applied with
//! `set_rows` in the message's task, following from the open. `?hold` holds
//! each count 17 ms first (Row shown in's control: a frame late).
//!
//! It logs, for `tail-run.ts`: each `TailDrawn { rows }` with the page's
//! clock in the task that drew it (`tailDrawn()`), each `Following(bool)`
//! (`tailFollowing()`), and the view's top row and the rows (`tailView()`).

#![cfg(target_family = "wasm")]

use std::cell::{Cell, RefCell};
use std::ops::Range;
use std::time::Duration;

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::*;
use seiza_duckdb::tall_table::{PageQuery, QueryRows};
use seiza_duckdb::{Engine, EngineStatus, FileSource};
use seiza_tall_table::{
    ColumnKind, Paging, TallTable, TallTableColumn, TallTableEvent, TallTableState,
};
use wasm_bindgen::JsCast as _;
use wasm_bindgen::prelude::*;

const FILE: &str = "nasa.parquet";

/// The file's rows and span (s), its first row to its last
/// (`perf/results/2026-11-06-m11-a1.md`); a lap moves the time on by it.
const SPAN_S: u64 = 2_381_544;

/// Live tail's page SQL over the looping rows: one SELECT per lap the page
/// crosses, the time drawn as the canvas writes it.
pub fn tail_sql(file_rows: u64, rows: Range<u64>) -> String {
    let mut parts = Vec::new();
    let (first, last) = (rows.start / file_rows, (rows.end - 1) / file_rows);
    for lap in first..=last {
        let base = lap * file_rows;
        let lo = rows.start.max(base) - base;
        let hi = rows.end.min(base + file_rows) - base;
        parts.push(format!(
            "SELECT strftime(\"time\" + to_seconds({shift}), '%d/%b/%Y %H:%M:%S') AS \"time\", \
             request, status, bytes, file_row_number + {base} AS r \
             FROM read_parquet('{FILE}', file_row_number = true) \
             WHERE file_row_number >= {lo} AND file_row_number < {hi}",
            shift = lap * SPAN_S,
        ));
    }
    format!(
        "SELECT \"time\", request, status, bytes FROM ({}) ORDER BY r",
        parts.join(" UNION ALL ")
    )
}

struct Tail {
    file_rows: u64,
}

impl PageQuery for Tail {
    fn page_sql(&self, rows: Range<u64>) -> String {
        tail_sql(self.file_rows, rows)
    }
}

type Table = TallTableState<QueryRows<Tail>>;

thread_local! {
    static HOST: RefCell<Option<(Entity<Host>, AsyncApp)>> = const { RefCell::new(None) };
    static DRAWN: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static FOLLOWING: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    /// `[top, at, …]`: each frame whose scroll top moved while not following.
    static MOVED: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static STATE: Cell<(bool, f64)> = const { Cell::new((true, 0.0)) };
    static VIEW: Cell<(f64, f64)> = const { Cell::new((0.0, 0.0)) };
}

struct Host {
    file: Option<web_sys::File>,
    table: Option<Entity<Table>>,
    status: SharedString,
    hold: bool,
    _subscriptions: Vec<Subscription>,
}

impl Host {
    fn new(file: js_sys::Promise, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let engine = cx.observe_global_in::<EngineStatus>(window, |this, window, cx| {
            this.try_open(window, cx);
            cx.notify();
        });
        cx.spawn_in(window, async move |this, cx| {
            let file = wasm_bindgen_futures::JsFuture::from(file).await;
            let _ = this.update_in(cx, |this, window, cx| {
                match file {
                    Ok(file) => this.file = Some(file.unchecked_into()),
                    Err(error) => this.status = format!("The file didn't load: {error:?}").into(),
                }
                this.try_open(window, cx);
                cx.notify();
            });
        })
        .detach();
        Self {
            file: None,
            table: None,
            status: "Engine loading…".into(),
            hold: seiza::url::param("hold").is_some(),
            _subscriptions: vec![engine],
        }
    }

    fn try_open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.table.is_some()
            || !matches!(
                cx.try_global::<EngineStatus>(),
                Some(EngineStatus::Ready { .. })
            )
        {
            return;
        }
        let Some(file) = self.file.take() else {
            return;
        };
        self.status = "Opening the file…".into();
        let engine = cx.global::<Engine>().clone();
        cx.spawn_in(window, async move |this, cx| {
            let opened = seiza_duckdb::tall_table::open_parquet(
                &engine,
                FILE,
                FileSource::File(file),
                &[],
                |_| {},
            )
            .await;
            let _ = this.update_in(cx, |this, window, cx| {
                match opened {
                    Ok((summary, _)) => {
                        let columns = vec![
                            TallTableColumn::new("time", ColumnKind::Text),
                            TallTableColumn::new("request", ColumnKind::Text),
                            TallTableColumn::new("status", ColumnKind::Integer { max_chars: 5 }),
                            TallTableColumn::new("bytes", ColumnKind::Integer { max_chars: 10 }),
                        ];
                        let rows = QueryRows::new(
                            engine,
                            Tail {
                                file_rows: summary.rows,
                            },
                        );
                        let table = cx.new(|cx| {
                            // The contender's: the probes on, always.
                            let mut table = Table::new(rows, columns, 0, Paging::default(), cx)
                                .probe_frames(true);
                            table.follow(cx);
                            table
                        });
                        this._subscriptions
                            .push(cx.subscribe(&table, |_, table, event, cx| {
                                match event {
                                    TallTableEvent::TailDrawn { rows } => {
                                        let now = seiza::marks::now();
                                        DRAWN
                                            .with_borrow_mut(|log| log.extend([*rows as f64, now]));
                                    }
                                    TallTableEvent::Probe(probe) => {
                                        let (following, top) = STATE.get();
                                        if !following && probe.top != top {
                                            let now = seiza::marks::now();
                                            MOVED.with_borrow_mut(|log| {
                                                log.extend([probe.top, now])
                                            });
                                        }
                                        STATE.set((following, probe.top));
                                    }
                                    TallTableEvent::Following(on) => {
                                        STATE.set((*on, STATE.get().1));
                                        let now = seiza::marks::now();
                                        FOLLOWING.with_borrow_mut(|log| {
                                            log.extend([f64::from(u8::from(*on)), now])
                                        });
                                    }
                                    _ => {}
                                }
                                let table = table.read(cx);
                                VIEW.set((table.visible_rows().start as f64, table.rows() as f64));
                            }));
                        let focus = table.read(cx).focus_handle().clone();
                        window.focus(&focus, cx);
                        this.table = Some(table);
                        let _ = js_sys::Reflect::set(
                            &js_sys::global(),
                            &"__tailOpen".into(),
                            &JsValue::from_f64(summary.rows as f64),
                        );
                    }
                    Err(error) => this.status = format!("Couldn't open the file: {error}").into(),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn rows_due(&mut self, rows: u64, cx: &mut Context<Self>) {
        let Some(table) = self.table.clone() else {
            return;
        };
        if self.hold {
            cx.spawn(async move |_, cx| {
                cx.background_executor()
                    .timer(Duration::from_millis(17))
                    .await;
                table.update(cx, |table, cx| table.set_rows(rows, cx));
            })
            .detach();
        } else {
            table.update(cx, |table, cx| table.set_rows(rows, cx));
        }
    }
}

impl Render for Host {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let body = div().size_full().p_4();
        if let Some(table) = &self.table {
            return body.child(TallTable::new(table));
        }
        let theme = cx.theme();
        body.child(
            div()
                .size_full()
                .px_3()
                .py_2()
                .bg(theme.tokens.table)
                .rounded(theme.radius)
                .border_1()
                .border_color(theme.border)
                .text_sm()
                .text_color(theme.muted_foreground)
                .child(self.status.clone()),
        )
    }
}

/// Called by the JS host once the wasm and the font are in; `file` resolves
/// to the logs' file, fetched whole after first paint.
#[wasm_bindgen]
pub fn start(ui_font: Vec<u8>, bridge: seiza_duckdb::Bridge, file: js_sys::Promise) {
    seiza::Bootstrap::new("Live tail spike: GPUI", ui_font)
        .after_first_paint(|_, cx| seiza_duckdb::start(cx, |_, _| {}))
        .run(move |window, cx| {
            seiza_tall_table::init(cx);
            seiza_duckdb::init(cx, bridge);
            let host = cx.new(|cx| Host::new(file, window, cx));
            HOST.set(Some((host.clone(), cx.to_async())));
            host.into()
        });
}

/// The clock's count, from its message's task.
#[wasm_bindgen(js_name = rowsDue)]
pub fn rows_due(rows: f64) {
    let Some((host, mut cx)) = HOST.with_borrow(Clone::clone) else {
        return;
    };
    host.update(&mut cx, |host, cx| host.rows_due(rows as u64, cx));
}

/// `[rows, at, …]`: each `TailDrawn` and the page clock in its task.
#[wasm_bindgen(js_name = tailDrawn)]
pub fn tail_drawn() -> Vec<f64> {
    DRAWN.with_borrow(Clone::clone)
}

/// `[on, at, …]`: each `Following` and the page clock.
#[wasm_bindgen(js_name = tailFollowing)]
pub fn tail_following() -> Vec<f64> {
    FOLLOWING.with_borrow(Clone::clone)
}

/// `[top, at, …]`: each frame whose scroll top moved while not following.
#[wasm_bindgen(js_name = tailMoved)]
pub fn tail_moved() -> Vec<f64> {
    MOVED.with_borrow(Clone::clone)
}

/// `[top, rows]`: the view's top row and the rows, at the last event.
#[wasm_bindgen(js_name = tailView)]
pub fn tail_view() -> Vec<f64> {
    let (top, rows) = VIEW.get();
    vec![top, rows]
}
