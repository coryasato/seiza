//! Market watch's feed on the web (`contenders/market/worker.ts`): the JS
//! host hands over how to make the frame's worker and its start message
//! (`market`, before `start`); the worker is made and started once the
//! open's page has seeded the store and the table first fills (`watch`:
//! after first paint, root rule 2), and each batch
//! the worker posts is folded in its message's task, every tick, the
//! ticked rows invalidated there (`Host::feed`): a batch waits on nothing
//! before it reaches the store, as on the DOM side.

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;

use gpui_kit::*;
use js_sys::{Array, Float64Array, Function, Reflect, Uint8Array};
use seiza_tall_table::TallTableEvent;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::*;

use crate::host::{Host, Table};

struct Feed {
    /// Makes the worker (`() => Worker`).
    make: Function,
    /// The worker, once made.
    worker: Option<JsValue>,
    /// The worker's start message (`FeedStart`: its rate, seed, and limit).
    start: JsValue,
    flash: Vec<String>,
    /// The worker's `onmessage`, `onerror`, and `onmessageerror`, kept
    /// while it runs.
    listeners: Vec<Closure<dyn FnMut(JsValue)>>,
}

thread_local! {
    static FEED: RefCell<Option<Feed>> = const { RefCell::new(None) };
    /// The feed was started (once a page: a reopen ends it).
    static STARTED: Cell<bool> = const { Cell::new(false) };
}

/// How the JS host makes the frame's worker, its start message, and the
/// columns that flash, by name (`contenders/scenarios.ts`'s market watch).
/// Called before `start`.
#[wasm_bindgen]
pub fn market(make: Function, start: JsValue, flash: Vec<String>) {
    FEED.set(Some(Feed {
        make,
        worker: None,
        start,
        flash,
        listeners: Vec::new(),
    }));
}

/// The columns that flash, as the JS host named them.
pub fn flash() -> Vec<String> {
    FEED.with_borrow(|feed| feed.as_ref().map(|feed| feed.flash.clone()))
        .unwrap_or_default()
}

/// Starts the feed when `table` first fills, if its store is seeded (else
/// the host fails). Once a page: a table opened again (the replay's `open`,
/// which ends the feed, `Host::open`) gets none, since its store starts
/// over and would miss the ticks sent meanwhile.
pub fn watch(table: &Entity<Table>, cx: &mut Context<Host>) {
    if STARTED.get() {
        return;
    }
    cx.subscribe(table, |host, table, event, cx| {
        if !matches!(event, TallTableEvent::Filled { .. }) || STARTED.replace(true) {
            return;
        }
        let started = if table.read(cx).delegate().store().seeded() {
            start()
        } else {
            Err("the file's Last isn't every instrument's price".into())
        };
        if let Err(message) = started {
            host.fail_feed(format!("The feed didn't start: {message}").into(), cx);
        }
    })
    .detach();
}

/// Makes the worker, listens to it, then sends it its start message; any
/// of that failing, or the worker failing later, fails the host.
fn start() -> Result<(), String> {
    FEED.with_borrow_mut(|feed| {
        let feed = feed.as_mut().ok_or("the host didn't hand over the feed")?;
        let worker = feed
            .make
            .call0(&JsValue::UNDEFINED)
            .map_err(|error| format!("its worker wasn't made: {error:?}"))?;
        // Kept before anything else can fail, so `stop` can end it.
        feed.worker = Some(worker.clone());
        let on = |name: &str, listener: Closure<dyn FnMut(JsValue)>| {
            let _ = Reflect::set(&worker, &JsValue::from_str(name), listener.as_ref());
            listener
        };
        let message = Closure::<dyn FnMut(JsValue)>::new(move |event: JsValue| {
            let Ok(data) = Reflect::get(&event, &JsValue::from_str("data")) else {
                return;
            };
            // Copied into wasm's memory: the fold reads it there.
            let batch = Uint8Array::new(&data).to_vec();
            crate::contract::with_host_now(|host, cx| host.feed(&batch, cx));
        });
        // A worker that fails to load or throws, or a message that can't be
        // read: the feed stopped, so the view says so.
        let failed = |what: &'static str| {
            Closure::<dyn FnMut(JsValue)>::new(move |event: JsValue| {
                let detail = Reflect::get(&event, &JsValue::from_str("message"))
                    .ok()
                    .and_then(|message| message.as_string())
                    .unwrap_or_default();
                crate::contract::with_host_now(|host, cx| {
                    host.fail_feed(format!("The feed's {what}: {detail}").into(), cx)
                });
            })
        };
        feed.listeners = vec![
            on("onmessage", message),
            on("onerror", failed("worker failed")),
            on("onmessageerror", failed("batch couldn't be read")),
        ];
        let post = Reflect::get(&worker, &JsValue::from_str("postMessage"))
            .and_then(|post| post.dyn_into::<Function>())
            .map_err(|_| "its worker has no postMessage".to_string())?;
        post.call1(&worker, &feed.start)
            .map_err(|error| format!("its start message wasn't sent: {error:?}"))?;
        Ok(())
    })
}

/// Ends the worker: a refused batch, or the table opened again.
pub fn stop() {
    // A reopened table counts its generations from the start again.
    RING.with_borrow_mut(|ring| {
        if let Some(ring) = ring {
            ring.pending.clear();
        }
    });
    FEED.with_borrow_mut(|feed| {
        let Some(worker) = feed.as_mut().and_then(|feed| feed.worker.take()) else {
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
        if let Some(feed) = feed {
            feed.listeners.clear();
        }
    });
}

/// The ring's samples, as `contenders/contract.ts`'s `SHOWN_RING` lays
/// them out: `[written, then (drawn at, ms) pairs]`, sample `n` at
/// `1 + 2 * (n % SHOWN_RING)`.
const SHOWN_RING: u32 = 512;
/// The visible batches not yet drawn, at most: past it, the oldest is dropped.
const PENDING: usize = 256;

/// With `?readout` (the observatory's page, never a bare cold run): each
/// visible batch's send → the frame that first drew it, epoch ms, on
/// `__contender.shownIn` for the page's Shown in (`docs/contender-contract.md`,
/// "The readout's ring"). Preallocated: the readout makes no garbage.
struct Ring {
    samples: Float64Array,
    written: u32,
    /// Each visible batch not yet drawn: its send time and generation.
    pending: VecDeque<(f64, u64)>,
    /// `performance.timeOrigin`: the frame's clock as epoch ms.
    origin: f64,
}

thread_local! {
    static RING: RefCell<Option<Ring>> = const { RefCell::new(None) };
}

fn reading_out() -> bool {
    thread_local! {
        static READOUT: bool = seiza::url::has_param("readout");
    }
    READOUT.with(|readout| *readout)
}

/// Runs `f` on the ring, made at its first use, with `?readout` only.
fn with_ring(f: impl FnOnce(&mut Ring)) {
    if !reading_out() {
        return;
    }
    RING.with_borrow_mut(|ring| {
        let ring = ring.get_or_insert_with(|| {
            let samples = Float64Array::new_with_length(1 + 2 * SHOWN_RING);
            crate::contract::set_on_contender("shownIn", &samples);
            let origin = Reflect::get(&js_sys::global(), &JsValue::from_str("performance"))
                .and_then(|performance| {
                    Reflect::get(&performance, &JsValue::from_str("timeOrigin"))
                })
                .ok()
                .and_then(|origin| origin.as_f64())
                .unwrap_or_default();
            Ring {
                samples,
                written: 0,
                pending: VecDeque::with_capacity(PENDING),
                origin,
            }
        });
        f(ring);
    });
}

/// A frame drew the re-reads up to `generation` (`TallTableEvent::Refreshed`,
/// emitted while it renders): every visible batch it shows is a sample.
pub fn shown_drawn(generation: u64) {
    with_ring(|ring| {
        let at = ring.origin + seiza::marks::now();
        while let Some(&(sent, pending)) = ring.pending.front() {
            if pending > generation {
                break;
            }
            ring.pending.pop_front();
            let slot = 1 + 2 * (ring.written % SHOWN_RING);
            ring.samples.set_index(slot, at);
            ring.samples.set_index(slot + 1, at - sent);
            ring.written = ring.written.wrapping_add(1);
            ring.samples.set_index(0, f64::from(ring.written));
        }
    });
}

/// A batch folded: with `?readout`, a visible one waits in the ring for
/// the frame that draws it; with `?measure`, on `__contender.batches` as `[seq,
/// ticks, sent (epoch ms), generation (the last of its invalidations, 0 for
/// none), visible (1 if a tick reached a row on screen)]`, for Shown in
/// (`docs/contender-contract.md`, "Reading the metrics").
pub fn record(batch: crate::market::Batch, generation: u64, visible: bool) {
    if visible {
        with_ring(|ring| {
            if ring.pending.len() == PENDING {
                ring.pending.pop_front();
            }
            ring.pending.push_back((batch.sent, generation));
        });
    }
    if !crate::contract::measuring() {
        return;
    }
    thread_local! {
        static BATCHES: Array = {
            let batches = Array::new();
            crate::contract::set_on_contender("batches", &batches);
            batches
        };
    }
    let entry = Array::of5(
        &batch.seq.into(),
        &batch.count.into(),
        &batch.sent.into(),
        &(generation as f64).into(),
        &f64::from(u8::from(visible)).into(),
    );
    BATCHES.with(|batches| batches.push(&entry));
}
