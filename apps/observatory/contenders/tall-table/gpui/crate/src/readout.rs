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

impl Ring {
    /// A sample drawn at `at`, sent at `sent` (epoch ms), into the next
    /// slot, `contenders/contract.ts`'s layout.
    #[inline(always)]
    fn push(&mut self, at: f64, sent: f64) {
        let slot = 1 + 2 * (self.written % SHOWN_RING);
        self.samples.set_index(slot, at);
        self.samples.set_index(slot + 1, at - sent);
        self.written = self.written.wrapping_add(1);
        self.samples.set_index(0, f64::from(self.written));
    }
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
#[cfg(any(feature = "market", feature = "tail"))]
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
#[cfg(any(feature = "market", feature = "tail"))]
pub fn drawn(key: u64) {
    with_ring(|ring| {
        let at = ring.origin + seiza::marks::now();
        while let Some(&(sent, pending)) = ring.pending.front() {
            if pending > key {
                break;
            }
            ring.pending.pop_front();
            ring.push(at, sent);
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
    #[cfg(feature = "wall")]
    WALL.with_borrow_mut(VecDeque::clear);
}

// The monitoring wall's: a batch is drawn once every table in its mask has
// drawn the generation it names there (`docs/contender-contract.md`, "The
// readout's ring"), one sample a batch, pooled across the tables.

#[cfg(feature = "wall")]
use crate::scene::wall::MOST_TABLES;

/// A wall's sample: its send time, its generation per table, and the
/// tables it waits on (a bit a table).
#[cfg(feature = "wall")]
type WallSample = (f64, [u64; MOST_TABLES], u32);

#[cfg(feature = "wall")]
thread_local! {
    static WALL: RefCell<VecDeque<WallSample>> =
        RefCell::new(VecDeque::with_capacity(PENDING));
}

/// A wall's batch sent at `sent` waits until each table in `visible` has
/// drawn its entry of `generations`.
#[cfg(feature = "wall")]
pub fn waiting_wall(sent: f64, generations: &[u64], visible: u32) {
    with_ring(|_| {
        let mut keys = [0; MOST_TABLES];
        for (key, &generation) in keys.iter_mut().zip(generations) {
            *key = generation;
        }
        WALL.with_borrow_mut(|pending| {
            if pending.len() == PENDING {
                pending.pop_front();
            }
            pending.push_back((sent, keys, visible));
        });
    });
}

/// A frame drew each table up to its entry of `drawn` (an event emitted
/// while it renders): every wall sample whose tables have all drawn it is
/// drawn now.
#[cfg(feature = "wall")]
pub fn drawn_wall(drawn: &[u64]) {
    with_ring(|ring| {
        let at = ring.origin + seiza::marks::now();
        WALL.with_borrow_mut(|pending| {
            pending.retain(|&(sent, keys, visible)| {
                let shown = keys
                    .iter()
                    .zip(drawn)
                    .enumerate()
                    .all(|(table, (&key, &drawn))| visible & (1 << table) == 0 || drawn >= key);
                if shown {
                    ring.push(at, sent);
                }
                !shown
            });
        });
    });
}
