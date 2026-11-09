//! This tab's Shown in, with `?readout` (the observatory's page, never a
//! bare cold run): each sample a send → the frame that first drew it,
//! epoch ms, on `__contender.shownIn` (`docs/contender-contract.md`, "The
//! readout's ring"). Market watch's: a visible batch's send → the frame
//! that drew its re-reads' generation. Live tail's: a count's post → the
//! frame whose drawn tail reached it. Either way a sample waits under a
//! key that only grows, and a frame drawing a key takes every sample at or
//! under it. Preallocated: the readout makes no garbage.

use std::cell::RefCell;
use std::collections::VecDeque;

use js_sys::{Float64Array, Reflect};
use wasm_bindgen::JsValue;

/// The ring's samples, as `contenders/contract.ts`'s `SHOWN_RING` lays
/// them out: `[written, then (drawn at, ms) pairs]`, sample `n` at
/// `1 + 2 * (n % SHOWN_RING)`.
const SHOWN_RING: u32 = 512;
/// The samples not yet drawn, at most: past it, the oldest is dropped.
const PENDING: usize = 256;

struct Ring {
    samples: Float64Array,
    written: u32,
    /// Each sample not yet drawn: its send time and its key.
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

/// A sample sent at `sent` (epoch ms) waits for the frame that draws `key`.
pub fn waiting(sent: f64, key: u64) {
    with_ring(|ring| {
        if ring.pending.len() == PENDING {
            ring.pending.pop_front();
        }
        ring.pending.push_back((sent, key));
    });
}

/// A frame drew up to `key` (an event emitted while it renders): every
/// sample waiting at or under it is drawn now.
pub fn drawn(key: u64) {
    with_ring(|ring| {
        let at = ring.origin + seiza::marks::now();
        while let Some(&(sent, pending)) = ring.pending.front() {
            if pending > key {
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

/// The samples waiting are dropped: a reopened table counts its keys from
/// the start again.
pub fn forget() {
    RING.with_borrow_mut(|ring| {
        if let Some(ring) = ring {
            ring.pending.clear();
        }
    });
}
