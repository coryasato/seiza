//! The feed's store on the GPUI side, market watch's and the monitoring
//! wall's: every tick of the feed's batches
//! (`apps/observatory/contenders/market/feed.ts`, which says what a batch
//! holds and what a store does with a tick) folded into plain buffers in
//! place, nothing allocated after the open. Both scenarios' feed fixtures pin
//! it (`contenders/market/fixtures/feed.json`, and
//! `contenders/wall/fixtures/feed.json` over the wall's 400 instruments), as
//! they pin the TanStack contender's (`tests` below).

/// A batch's header: u32 sequence, u32 tick count, f64 send time (epoch
/// ms), f64 the generation's ms.
pub const HEADER: usize = 24;
/// A tick: u16 instrument, u16 kind, u32 bid size, u32 ask size, u32 size
/// traded, f64 last, f64 bid, f64 ask.
pub const TICK: usize = 40;

/// An instrument's quote.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quote {
    /// The reference price.
    pub open: f64,
    pub last: f64,
    pub change: f64,
    pub change_pct: f64,
    pub bid: f64,
    pub ask: f64,
    pub bid_size: u32,
    pub ask_size: u32,
    pub volume: u64,
    pub high: f64,
    pub low: f64,
}

impl Quote {
    /// At the open: each price its reference, no change, sizes and volume 0.
    pub fn open(price: f64) -> Self {
        Self {
            open: price,
            last: price,
            change: 0.0,
            change_pct: 0.0,
            bid: price,
            ask: price,
            bid_size: 0,
            ask_size: 0,
            volume: 0,
            high: price,
            low: price,
        }
    }
}

/// A batch's header, as the store read it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Batch {
    pub seq: u32,
    pub count: u32,
    /// Its send time, epoch ms.
    pub sent: f64,
}

/// A batch the store refused, whole: nothing of it is folded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BatchError {
    /// The store isn't open yet: its prices haven't come in.
    NotOpen,
    /// Shorter than a header.
    NoHeader { len: usize },
    /// Its length isn't its header and its count's ticks.
    Length { count: u32, len: usize },
    /// A tick names an instrument the store doesn't have.
    Instrument {
        tick: u32,
        instrument: u16,
        of: usize,
    },
}

impl std::fmt::Display for BatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotOpen => f.write_str("a batch before the store opened"),
            Self::NoHeader { len } => write!(f, "a batch of {len} bytes has no header"),
            Self::Length { count, len } => write!(f, "a batch of {count} ticks is {len} bytes"),
            Self::Instrument {
                tick,
                instrument,
                of,
            } => write!(f, "tick {tick}: instrument {instrument} of {of}"),
        }
    }
}

fn u16_at(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}
fn u32_at(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}
fn f64_at(b: &[u8], o: usize) -> f64 {
    let mut bytes = [0; 8];
    bytes.copy_from_slice(&b[o..o + 8]);
    f64::from_le_bytes(bytes)
}

/// Which of `of` instruments a batch the store folded ticked.
pub fn ticked(batch: &[u8], of: usize) -> Vec<bool> {
    let mut ticked = vec![false; of];
    for tick in batch[HEADER..].as_chunks::<TICK>().0 {
        if let Some(instrument) = ticked.get_mut(usize::from(u16_at(tick, 0))) {
            *instrument = true;
        }
    }
    ticked
}

/// The instruments' quotes, in the feed's order.
pub struct Quotes {
    rows: Vec<Quote>,
    folded: u64,
}

impl Quotes {
    /// The quotes at the open, from each instrument's reference price.
    pub fn new(prices: impl IntoIterator<Item = f64>) -> Self {
        Self {
            rows: prices.into_iter().map(Quote::open).collect(),
            folded: 0,
        }
    }

    pub fn rows(&self) -> &[Quote] {
        &self.rows
    }

    /// Every tick folded so far.
    pub fn folded(&self) -> u64 {
        self.folded
    }

    /// Folds every tick of `batch`, or none if it isn't one.
    pub fn fold(&mut self, batch: &[u8]) -> Result<Batch, BatchError> {
        if batch.len() < HEADER {
            return Err(BatchError::NoHeader { len: batch.len() });
        }
        let count = u32_at(batch, 4);
        // Checked: a corrupt count would wrap on wasm32's 32-bit `usize`.
        let expected = (count as usize)
            .checked_mul(TICK)
            .and_then(|ticks| ticks.checked_add(HEADER));
        if expected != Some(batch.len()) {
            return Err(BatchError::Length {
                count,
                len: batch.len(),
            });
        }
        let of = self.rows.len();
        for tick in 0..count {
            let instrument = u16_at(batch, HEADER + tick as usize * TICK);
            if usize::from(instrument) >= of {
                return Err(BatchError::Instrument {
                    tick,
                    instrument,
                    of,
                });
            }
        }
        for tick in 0..count as usize {
            let o = HEADER + tick * TICK;
            let q = &mut self.rows[usize::from(u16_at(batch, o))];
            let last = f64_at(batch, o + 16);
            q.last = last;
            q.change = last - q.open;
            q.change_pct = q.change / q.open * 100.0;
            q.bid = f64_at(batch, o + 24);
            q.ask = f64_at(batch, o + 32);
            q.bid_size = u32_at(batch, o + 4);
            q.ask_size = u32_at(batch, o + 8);
            q.volume += u64::from(u32_at(batch, o + 12));
            if last > q.high {
                q.high = last;
            }
            if last < q.low {
                q.low = last;
            }
        }
        self.folded += u64::from(count);
        Ok(Batch {
            seq: u32_at(batch, 0),
            count,
            sent: f64_at(batch, 8),
        })
    }
}

#[cfg(test)]
mod tests {
    //! The feed fixtures (`contenders/market/fixtures/feed.json`, market
    //! watch's, and `contenders/wall/fixtures/feed.json`, the monitoring
    //! wall's 400 instruments; their writer, `write.ts`, says what each
    //! holds) and their controls, which must fail each.

    use super::*;
    use serde_json::Value;

    /// Each fixture: its name, its JSON, and its batches' bytes.
    const FIXTURES: [(&str, &str, &[u8]); 2] = [
        (
            "market watch",
            include_str!("../../../../market/fixtures/feed.json"),
            include_bytes!("../../../../market/fixtures/feed.bin"),
        ),
        (
            "monitoring wall",
            include_str!("../../../../wall/fixtures/feed.json"),
            include_bytes!("../../../../wall/fixtures/feed.bin"),
        ),
    ];

    struct Fixture {
        name: &'static str,
        open: Vec<f64>,
        batches: Vec<Vec<u8>>,
        folded: u64,
        drop: usize,
        expect: Vec<Value>,
    }

    fn fixtures() -> impl Iterator<Item = Fixture> {
        FIXTURES
            .into_iter()
            .map(|(name, json, bytes)| fixture(name, json, bytes))
    }

    fn fixture(name: &'static str, json: &str, bytes: &[u8]) -> Fixture {
        let json: Value = serde_json::from_str(json).unwrap();
        let mut at = 0;
        let batches = json["batches"]
            .as_array()
            .unwrap()
            .iter()
            .map(|count| {
                let len = HEADER + count.as_u64().unwrap() as usize * TICK;
                at += len;
                bytes[at - len..at].to_vec()
            })
            .collect();
        assert_eq!(at, bytes.len(), "{name}: the batches cover the bytes");
        Fixture {
            name,
            open: json["open"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p.as_str().unwrap().parse().unwrap())
                .collect(),
            batches,
            folded: json["folded"].as_u64().unwrap(),
            drop: json["drop"].as_u64().unwrap() as usize,
            expect: json["expect"].as_array().unwrap().clone(),
        }
    }

    /// Each quote's fields as the fixture writes them: `{:?}` of a double, an integer's digits.
    fn texts(q: &Quote) -> [(&'static str, String); 10] {
        [
            ("last", format!("{:?}", q.last)),
            ("change", format!("{:?}", q.change)),
            ("change_pct", format!("{:?}", q.change_pct)),
            ("bid", format!("{:?}", q.bid)),
            ("ask", format!("{:?}", q.ask)),
            ("bid_size", q.bid_size.to_string()),
            ("ask_size", q.ask_size.to_string()),
            ("volume", q.volume.to_string()),
            ("high", format!("{:?}", q.high)),
            ("low", format!("{:?}", q.low)),
        ]
    }

    /// Where the fixture and the quotes part, or none.
    fn differences(f: &Fixture, rows: &[Quote], folded: u64) -> Vec<String> {
        let mut out: Vec<String> = f
            .expect
            .iter()
            .zip(rows)
            .flat_map(|(want, q)| {
                texts(q).into_iter().filter_map(move |(key, text)| {
                    let wanted = want[key].as_str().unwrap();
                    (text != wanted)
                        .then(|| format!("{} {key}: {text}, want {wanted}", want["symbol"]))
                })
            })
            .collect();
        if rows.len() != f.expect.len() {
            out.push(format!(
                "{} instruments, want {}",
                rows.len(),
                f.expect.len()
            ));
        }
        if folded != f.folded {
            out.push(format!("folded {folded}, want {}", f.folded));
        }
        out
    }

    /// The fixture's batches folded into a fresh store, each through `alter` (given its first tick's index).
    fn run(f: &Fixture, alter: impl Fn(&[u8], usize) -> Vec<u8>) -> Quotes {
        let mut quotes = Quotes::new(f.open.iter().copied());
        let mut first = 0;
        for batch in &f.batches {
            quotes.fold(&alter(batch, first)).unwrap();
            first += u32_at(batch, 4) as usize;
        }
        quotes
    }

    fn with_count(mut batch: Vec<u8>, count: usize) -> Vec<u8> {
        batch[4..8].copy_from_slice(&(count as u32).to_le_bytes());
        batch
    }

    #[test]
    fn feed_fixture() {
        for f in fixtures() {
            let quotes = run(&f, |batch, _| batch.to_vec());
            assert_eq!(
                differences(&f, quotes.rows(), quotes.folded()),
                Vec::<String>::new(),
                "{}",
                f.name
            );
        }
    }

    #[test]
    fn feed_fixture_skipped_trade_fails() {
        for f in fixtures() {
            skipped_trade_fails(&f);
        }
    }

    fn skipped_trade_fails(f: &Fixture) {
        let quotes = run(f, |batch, first| {
            let count = u32_at(batch, 4) as usize;
            if !(first..first + count).contains(&f.drop) {
                return batch.to_vec();
            }
            let at = HEADER + (f.drop - first) * TICK;
            with_count([&batch[..at], &batch[at + TICK..]].concat(), count - 1)
        });
        assert_ne!(
            differences(f, quotes.rows(), quotes.folded()),
            Vec::<String>::new(),
            "{}",
            f.name
        );
        // Its fields differ too, not only the count.
        assert_ne!(
            differences(f, quotes.rows(), f.folded),
            Vec::<String>::new(),
            "{}",
            f.name
        );
    }

    #[test]
    fn feed_fixture_conflated_fails() {
        for f in fixtures() {
            conflated_fails(&f);
        }
    }

    fn conflated_fails(f: &Fixture) {
        let quotes = run(f, |batch, _| {
            let count = u32_at(batch, 4) as usize;
            let mut last_of = std::collections::BTreeMap::new();
            for k in 0..count {
                last_of.insert(u16_at(batch, HEADER + k * TICK), k);
            }
            let mut keep: Vec<usize> = last_of.into_values().collect();
            keep.sort_unstable();
            let mut out = batch[..HEADER].to_vec();
            for k in &keep {
                out.extend_from_slice(&batch[HEADER + k * TICK..HEADER + (k + 1) * TICK]);
            }
            with_count(out, keep.len())
        });
        assert_ne!(
            differences(f, quotes.rows(), f.folded),
            Vec::<String>::new(),
            "{}",
            f.name
        );
    }

    #[test]
    fn feed_fixture_other_change_pct_fails() {
        for f in fixtures() {
            other_change_pct_fails(&f);
        }
    }

    fn other_change_pct_fails(f: &Fixture) {
        let quotes = run(f, |batch, _| batch.to_vec());
        let other: Vec<Quote> = quotes
            .rows()
            .iter()
            .map(|q| Quote {
                change_pct: (q.last / q.open - 1.0) * 100.0,
                ..*q
            })
            .collect();
        assert_ne!(
            differences(f, &other, quotes.folded()),
            Vec::<String>::new(),
            "{}",
            f.name
        );
    }

    #[test]
    fn the_walls_ticks_are_refused_by_market_watchs_store() {
        // The wall's batches name instruments up to 399: a store of market
        // watch's 50 refuses them rather than fold them into the wrong rows.
        let [(_, market, market_bytes), (name, wall, wall_bytes)] = FIXTURES;
        let market = fixture("market watch", market, market_bytes);
        let wall = fixture(name, wall, wall_bytes);
        let mut quotes = Quotes::new(market.open.iter().copied());
        let refused = wall
            .batches
            .iter()
            .find_map(|batch| quotes.fold(batch).err());
        assert!(
            matches!(refused, Some(BatchError::Instrument { of: 50, .. })),
            "{refused:?}"
        );
    }

    #[test]
    fn a_batch_that_isnt_one_is_refused_whole() {
        let (name, json, bytes) = FIXTURES[0];
        let f = fixture(name, json, bytes);
        let mut quotes = Quotes::new(f.open.iter().copied());
        let second = &f.batches[1];
        assert_eq!(
            quotes.fold(&second[..second.len() - 1]),
            Err(BatchError::Length {
                count: 3,
                len: second.len() - 1
            })
        );
        assert_eq!(
            quotes.fold(&second[..HEADER - 1]),
            Err(BatchError::NoHeader { len: HEADER - 1 })
        );
        // A count past what any length holds is refused, not wrapped.
        let mut huge = second.clone();
        huge[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(
            quotes.fold(&huge),
            Err(BatchError::Length {
                count: u32::MAX,
                len: huge.len()
            })
        );
        // The last tick out of range: the ticks before it aren't folded either.
        let mut bad = second.clone();
        bad[HEADER + 2 * TICK..HEADER + 2 * TICK + 2]
            .copy_from_slice(&(f.open.len() as u16).to_le_bytes());
        assert_eq!(
            quotes.fold(&bad),
            Err(BatchError::Instrument {
                tick: 2,
                instrument: 50,
                of: 50
            })
        );
        assert_eq!(quotes.folded(), 0);
        assert!(
            quotes
                .rows()
                .iter()
                .zip(&f.open)
                .all(|(q, &p)| *q == Quote::open(p))
        );
    }
}
