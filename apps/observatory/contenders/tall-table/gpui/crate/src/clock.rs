//! Live tail's replay on the web (`contenders/tail/`): the JS host hands
//! over how to fetch the file whole, how to make the frame's clock worker,
//! and its start message (`tail`, before `start`). Once the open has shown
//! the table (by range, at 0 rows, following), the file is fetched whole
//! and registered in the engine as `WHOLE_FILE`, which every page reads
//! (`docs/DECISIONS.md`, "Scenarios"); only then is the worker made and
//! started (`watch`). Each count it posts is set on the table in its
//! message's task (`Host::rows_due`), as market watch's batches are folded
//! in theirs. A replay `open()` starts the replay over: the worker ended
//! (`stop`), and the new table's `watch` starts another at 0 rows, the
//! file registered once. With `?readout` the page's follow toggle reaches
//! the table here (`followTail`), and the frame tells the page whether it
//! follows and its rows (`report`, `contenders/contract.ts`'s
//! `followToggle`).

use std::cell::{Cell, RefCell};

use gpui_kit::*;
use js_sys::{Array, Function, Promise, Reflect};
use seiza_duckdb::{Engine, FileSource};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::*;

use crate::host::Host;
use crate::tail::WHOLE_FILE;

struct Clock {
    /// Fetches the file whole (`() => Promise<File>`).
    fetch: Function,
    /// Makes the worker (`() => Worker`).
    make: Function,
    /// The worker's start message (`TailStart`: its rate).
    start: JsValue,
    /// The worker, while it runs.
    worker: Option<JsValue>,
    /// Paused (`clockPause`): held by a worker started later too.
    paused: bool,
    /// The worker's `onmessage`, `onerror`, and `onmessageerror`, kept
    /// while it runs.
    listeners: Vec<Closure<dyn FnMut(JsValue)>>,
    /// With `?readout`, the page's follow toggle's reporter (`(on, rows)
    /// => void`), which throttles what it posts.
    report: Option<Function>,
}

/// Where the file fetched whole is.
#[derive(Clone, Copy, PartialEq)]
enum Whole {
    Missing,
    Fetching,
    Registered,
}

thread_local! {
    static CLOCK: RefCell<Option<Clock>> = const { RefCell::new(None) };
    /// `__contender.batches`, with `?measure` only (`record`): made, and
    /// published, at its first use.
    static BATCHES: Array = {
        let batches = Array::new();
        crate::contract::set_on_contender("batches", &batches);
        batches
    };
    static WHOLE: Cell<Whole> = const { Cell::new(Whole::Missing) };
    /// A table is open and waits for the file to start its clock.
    static WAITING: Cell<bool> = const { Cell::new(false) };
    /// Whether the shown table follows, and the clock's last count: what
    /// the page's follow toggle is told.
    static FOLLOWING: Cell<(bool, u64)> = const { Cell::new((true, 0)) };
}

/// How the JS host fetches the file whole, makes the frame's worker, and
/// its start message (`contenders/tail/worker.ts`'s `TailStart`), and with
/// `?readout` the follow toggle's reporter. Called before `start`.
#[wasm_bindgen]
pub fn tail(fetch: Function, make: Function, start: JsValue, report: Option<Function>) {
    CLOCK.set(Some(Clock {
        fetch,
        make,
        start,
        worker: None,
        paused: false,
        listeners: Vec::new(),
        report,
    }));
}

/// Tells the page's follow toggle, if there is one, `on` and `rows`.
fn report(on: bool, rows: u64) {
    CLOCK.with_borrow(|clock| {
        if let Some(report) = clock.as_ref().and_then(|clock| clock.report.as_ref()) {
            let _ = report.call2(
                &JsValue::UNDEFINED,
                &JsValue::from_bool(on),
                &JsValue::from_f64(rows as f64),
            );
        }
    });
}

/// The shown table started or stopped following (its `Following`, or a
/// new table, which follows from the start): the page's toggle hears it.
pub fn following(on: bool) {
    let (_, rows) = FOLLOWING.get();
    FOLLOWING.set((on, rows));
    report(on, rows);
}

/// The clock set `rows`: while let go, the page's toggle hears the count
/// (the reporter keeps it to a few messages a second).
fn counted(rows: u64) {
    let (on, _) = FOLLOWING.get();
    FOLLOWING.set((on, rows));
    if !on {
        report(false, rows);
    }
}

/// The page's follow toggle (`{ seiza: 'follow', on }`, which the JS host
/// hears with `?readout` only): follows the newest (the table's `follow`,
/// as End does) or lets go with the view where it is (`let_go`).
#[wasm_bindgen(js_name = followTail)]
pub fn follow_tail(on: bool) {
    crate::contract::with_host_now(|host, cx| host.follow_tail(on, cx));
}

/// The table is open: starts its clock once the file is in hand, fetching
/// and registering it first if no table has. Any of that failing fails the
/// host.
pub fn watch(host: &mut Host, cx: &mut Context<Host>) {
    WAITING.set(true);
    match WHOLE.get() {
        Whole::Registered => start_or_fail(host, cx),
        Whole::Fetching => {}
        Whole::Missing => {
            let fetched = CLOCK.with_borrow(|clock| {
                let clock = clock
                    .as_ref()
                    .ok_or("the host didn't hand over the clock")?;
                clock
                    .fetch
                    .call0(&JsValue::UNDEFINED)
                    .map_err(|error| format!("the file wasn't fetched: {error:?}"))
                    .map(|promise| promise.unchecked_into::<Promise>())
            });
            let promise = match fetched {
                Ok(promise) => promise,
                Err(message) => return fail(host, message, cx),
            };
            WHOLE.set(Whole::Fetching);
            let engine = cx.global::<Engine>().clone();
            cx.spawn(async move |host, cx| {
                let registered = async {
                    let file = wasm_bindgen_futures::JsFuture::from(promise)
                        .await
                        .map_err(|error| format!("the file wasn't fetched whole: {error:?}"))?;
                    engine
                        .register_file(WHOLE_FILE, FileSource::File(file.unchecked_into()))
                        .await
                        .map_err(|error| format!("the file wasn't registered: {error}"))
                }
                .await;
                let _ = host.update(cx, |host, cx| match registered {
                    Ok(_) => {
                        WHOLE.set(Whole::Registered);
                        if WAITING.get() {
                            start_or_fail(host, cx);
                        }
                    }
                    Err(message) => {
                        WHOLE.set(Whole::Missing);
                        if WAITING.get() {
                            fail(host, message, cx);
                        }
                    }
                });
            })
            .detach();
        }
    }
}

fn fail(host: &mut Host, message: String, cx: &mut Context<Host>) {
    WAITING.set(false);
    host.fail_feed(format!("The clock didn't start: {message}").into(), cx);
}

fn start_or_fail(host: &mut Host, cx: &mut Context<Host>) {
    WAITING.set(false);
    if let Err(message) = start() {
        fail(host, message, cx);
    }
}

/// Makes the worker, listens to it, then sends it its start message; any
/// of that failing, or the worker failing later, fails the host.
fn start() -> Result<(), String> {
    CLOCK.with_borrow_mut(|clock| {
        let clock = clock
            .as_mut()
            .ok_or("the host didn't hand over the clock")?;
        let worker = clock
            .make
            .call0(&JsValue::UNDEFINED)
            .map_err(|error| format!("its worker wasn't made: {error:?}"))?;
        // Kept before anything else can fail, so `stop` can end it.
        clock.worker = Some(worker.clone());
        let on = |name: &str, listener: Closure<dyn FnMut(JsValue)>| {
            let _ = Reflect::set(&worker, &JsValue::from_str(name), listener.as_ref());
            listener
        };
        let message = Closure::<dyn FnMut(JsValue)>::new(move |event: JsValue| {
            let Ok(data) = Reflect::get(&event, &JsValue::from_str("data")) else {
                return;
            };
            let (Some(rows), Some(at)) = (
                Reflect::get_u32(&data, 0)
                    .ok()
                    .and_then(|rows| rows.as_f64()),
                Reflect::get_u32(&data, 1).ok().and_then(|at| at.as_f64()),
            ) else {
                return crate::contract::with_host_now(|host, cx| {
                    host.fail_feed("The clock sent something other than [rows, at]".into(), cx)
                });
            };
            record(rows, at);
            // This tab's Shown in, with `?readout`: the count waits for the
            // frame whose drawn tail reaches it.
            crate::readout::waiting(at, rows as u64);
            crate::contract::with_host_now(|host, cx| host.rows_due(rows as u64, cx));
            counted(rows as u64);
        });
        let failed = |what: &'static str| {
            Closure::<dyn FnMut(JsValue)>::new(move |event: JsValue| {
                let detail = Reflect::get(&event, &JsValue::from_str("message"))
                    .ok()
                    .and_then(|message| message.as_string())
                    .unwrap_or_default();
                crate::contract::with_host_now(|host, cx| {
                    host.fail_feed(format!("The clock's {what}: {detail}").into(), cx)
                });
            })
        };
        clock.listeners = vec![
            on("onmessage", message),
            on("onerror", failed("worker failed")),
            on("onmessageerror", failed("count couldn't be read")),
        ];
        let post = Reflect::get(&worker, &JsValue::from_str("postMessage"))
            .and_then(|post| post.dyn_into::<Function>())
            .map_err(|_| "its worker has no postMessage".to_string())?;
        post.call1(&worker, &clock.start)
            .map_err(|error| format!("its start message wasn't sent: {error:?}"))?;
        // A pause asked before the worker existed holds from its start.
        if clock.paused {
            post_pause(&worker, true);
        }
        Ok(())
    })
}

/// Posts `{ pause: on }` to the worker.
fn post_pause(worker: &JsValue, on: bool) {
    let message = js_sys::Object::new();
    let _ = Reflect::set(
        &message,
        &JsValue::from_str("pause"),
        &JsValue::from_bool(on),
    );
    if let Ok(post) = Reflect::get(worker, &JsValue::from_str("postMessage"))
        .and_then(|post| post.dyn_into::<Function>())
    {
        let _ = post.call1(worker, &message);
    }
}

/// Pauses the clock's count (`true`) or resumes it (`false`): the scroll
/// back's control, the same gesture without the feed. The JS host puts it
/// on `__contender.pause` with `?measure` only. Asked before the worker
/// exists (the file still loading, or a replay's new clock not started
/// yet), it holds from the worker's start.
#[wasm_bindgen(js_name = clockPause)]
pub fn clock_pause(on: bool) {
    CLOCK.with_borrow_mut(|clock| {
        let Some(clock) = clock else {
            return;
        };
        clock.paused = on;
        if let Some(worker) = &clock.worker {
            post_pause(worker, on);
        }
    });
}

/// Ends the worker: the table opened again, or the host failed. A table
/// still waiting for the file stops waiting.
pub fn stop() {
    WAITING.set(false);
    // A replay's new clock counts from 0 again: its log starts over too,
    // and so do the counts waiting for this tab's Shown in.
    if crate::contract::measuring() {
        BATCHES.with(|batches| batches.set_length(0));
    }
    crate::readout::forget();
    FOLLOWING.set((FOLLOWING.get().0, 0));
    CLOCK.with_borrow_mut(|clock| {
        let Some(clock) = clock else {
            return;
        };
        let Some(worker) = clock.worker.take() else {
            return;
        };
        if let Ok(terminate) = Reflect::get(&worker, &JsValue::from_str("terminate"))
            .and_then(|terminate| terminate.dyn_into::<Function>())
        {
            let _ = terminate.call0(&worker);
        }
        for name in ["onmessage", "onerror", "onmessageerror"] {
            let _ = Reflect::set(&worker, &JsValue::from_str(name), &JsValue::NULL);
        }
        clock.listeners.clear();
    });
}

/// With `?measure` only, each count on `__contender.batches` as `[rows,
/// at]` (the worker's stamp, epoch ms), emptied when a replay's `open()`
/// starts the clock over, for Row shown in
/// (`docs/contender-contract.md`). Never otherwise: a log a message long
/// would grow with the feed (`docs/DECISIONS.md`, "Measurement").
fn record(rows: f64, at: f64) {
    if !crate::contract::measuring() {
        return;
    }
    BATCHES.with(|batches| batches.push(&Array::of2(&rows.into(), &at.into())));
}
