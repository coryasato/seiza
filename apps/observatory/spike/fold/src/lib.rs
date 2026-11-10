//! The feed spike's Rust fold: each tick of a batch (feed-worker.ts's
//! layout) folded into the store's columns in place, as the GPUI contender's
//! store would hold them. The store is sized by `size` (market watch's 50, or
//! the wall's desks of 50) before the first `init`; no allocation after it.

const HEADER: usize = 24;
const TICK: usize = 40;
/// Twice the largest batch the feed sends (5,000 ticks: 100 ms at 50k/s).
const BATCH_CAPACITY: usize = HEADER + 10_000 * TICK;

struct Store {
    open: Vec<f64>,
    last: Vec<f64>,
    change: Vec<f64>,
    change_pct: Vec<f64>,
    bid: Vec<f64>,
    ask: Vec<f64>,
    bid_size: Vec<f64>,
    ask_size: Vec<f64>,
    volume: Vec<f64>,
    high: Vec<f64>,
    low: Vec<f64>,
    changed: Vec<u8>,
}

static mut STORE: Store = Store {
    open: Vec::new(),
    last: Vec::new(),
    change: Vec::new(),
    change_pct: Vec::new(),
    bid: Vec::new(),
    ask: Vec::new(),
    bid_size: Vec::new(),
    ask_size: Vec::new(),
    volume: Vec::new(),
    high: Vec::new(),
    low: Vec::new(),
    changed: Vec::new(),
};
static mut BATCH: [u8; BATCH_CAPACITY] = [0; BATCH_CAPACITY];

fn u16_at(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}
fn u32_at(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}
fn f64_at(b: &[u8], o: usize) -> f64 {
    f64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}

/// Where JS copies a batch, and how many bytes fit.
#[unsafe(no_mangle)]
pub extern "C" fn batch_ptr() -> *mut u8 {
    &raw mut BATCH as *mut u8
}
#[unsafe(no_mangle)]
pub extern "C" fn batch_capacity() -> usize {
    BATCH_CAPACITY
}

/// The store's instruments: `n` rows in every column, all zero.
#[unsafe(no_mangle)]
pub extern "C" fn size(n: usize) {
    let s = unsafe { &mut *(&raw mut STORE) };
    let zeros = || vec![0.0; n];
    *s = Store {
        open: zeros(),
        last: zeros(),
        change: zeros(),
        change_pct: zeros(),
        bid: zeros(),
        ask: zeros(),
        bid_size: zeros(),
        ask_size: zeros(),
        volume: zeros(),
        high: zeros(),
        low: zeros(),
        changed: vec![0; n],
    };
}

/// The opening prices, one at a time.
#[unsafe(no_mangle)]
pub extern "C" fn init(i: usize, price: f64) {
    let s = unsafe { &mut *(&raw mut STORE) };
    s.open[i] = price;
    s.last[i] = price;
    s.bid[i] = price;
    s.ask[i] = price;
    s.high[i] = price;
    s.low[i] = price;
}

/// Folds the batch copied to `batch_ptr()`.
#[unsafe(no_mangle)]
pub extern "C" fn fold(len: usize) -> u32 {
    let s = unsafe { &mut *(&raw mut STORE) };
    let b = unsafe { &(&*(&raw const BATCH))[..len] };
    let count = u32_at(b, 4) as usize;
    for k in 0..count {
        let o = HEADER + k * TICK;
        let i = u16_at(b, o) as usize;
        let last = f64_at(b, o + 16);
        let change = last - s.open[i];
        s.last[i] = last;
        s.change[i] = change;
        s.change_pct[i] = change / s.open[i] * 100.0;
        s.bid[i] = f64_at(b, o + 24);
        s.ask[i] = f64_at(b, o + 32);
        s.bid_size[i] = u32_at(b, o + 4) as f64;
        s.ask_size[i] = u32_at(b, o + 8) as f64;
        s.volume[i] += u32_at(b, o + 12) as f64;
        if last > s.high[i] {
            s.high[i] = last;
        }
        if last < s.low[i] {
            s.low[i] = last;
        }
        s.changed[i] = 1;
    }
    count as u32
}

/// One field of the store (0 last … 9 low), for the check that the folds agree.
#[unsafe(no_mangle)]
pub extern "C" fn field(f: usize, i: usize) -> f64 {
    let s = unsafe { &*(&raw const STORE) };
    match f {
        0 => s.last[i],
        1 => s.change[i],
        2 => s.change_pct[i],
        3 => s.bid[i],
        4 => s.ask[i],
        5 => s.bid_size[i],
        6 => s.ask_size[i],
        7 => s.volume[i],
        8 => s.high[i],
        _ => s.low[i],
    }
}
