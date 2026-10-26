//! The host's one view: the table filling the window, with the padding the
//! observatory's GPUI contender gives it.

use std::time::Duration;

use gpui_kit::*;
use seiza_tall_table::{Paging, TallTable, TallTableState};
use tall_table_bridge::Publish;

#[cfg(feature = "custom-cells")]
use crate::rows::Cells;
use crate::rows::{MemoryRows, Shape};

/// The window's title.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens a window")
)]
pub const TITLE: &str = "Tall table: bare host";

/// Set right after each frame in which the viewport became filled.
pub const FILLED_MARK: &str = "tall-table:filled";

/// Set right after each frame that first draws a re-read page (`live`),
/// with the highest generation drawn so far in [`REFRESHED_GLOBAL`].
pub const REFRESHED_MARK: &str = "tall-table:refreshed";
pub const REFRESHED_GLOBAL: &str = "__tallTableRefreshed";

/// Set once each batch of the feed's updates is invalidated (`live`), at
/// the time its rows were picked, so the mark's time covers the source's
/// bumps, the invalidation, and any read it landed at once, but not the
/// feed's own picking; its last generation in [`INVALIDATED_GLOBAL`],
/// set first.
#[cfg(all(feature = "live", target_family = "wasm"))]
pub const INVALIDATED_MARK: &str = "tall-table:invalidated";
#[cfg(all(feature = "live", target_family = "wasm"))]
pub const INVALIDATED_GLOBAL: &str = "__tallTableInvalidated";

/// Set right after each frame whose drawn tail grew while following
/// (`follow`), the end of the tail it drew in [`TAIL_GLOBAL`]; and
/// whether the table follows in [`FOLLOWING_GLOBAL`].
#[cfg(feature = "follow")]
pub const TAIL_MARK: &str = "tall-table:tail";
#[cfg(feature = "follow")]
pub const TAIL_GLOBAL: &str = "__tallTableTail";
#[cfg(feature = "follow")]
pub const FOLLOWING_GLOBAL: &str = "__tallTableFollowing";

/// Each column's set width, CSS px or `null` for a kind's, replaced at each
/// release or fit that changed one (`resize`'s `ColumnWidthsChanged`).
#[cfg(feature = "resize")]
pub const WIDTHS_GLOBAL: &str = "__tallTableWidths";

/// Set as each batch of the tail feed's rows is appended (`follow`), at
/// the time it's sent, the rows the source holds then in
/// [`APPENDED_GLOBAL`], set first: the first tail mark whose
/// [`TAIL_GLOBAL`] is at or past it draws them.
#[cfg(all(feature = "follow", target_family = "wasm"))]
pub const APPENDED_MARK: &str = "tall-table:appended";
#[cfg(all(feature = "follow", target_family = "wasm"))]
pub const APPENDED_GLOBAL: &str = "__tallTableAppended";

/// How often the feed sends a batch: about a frame.
#[cfg(feature = "live")]
const FEED_EVERY: Duration = Duration::from_millis(16);

/// The most time one batch catches up on.
#[cfg(feature = "live")]
const FEED_CATCH_UP: Duration = Duration::from_millis(100);

/// The feed's seed, so every run updates the same rows.
#[cfg(feature = "live")]
const FEED_SEED: u64 = 0x5EED_7A11_5EED_7A11;

pub type Table = TallTableState<MemoryRows>;

pub struct Host {
    table: Entity<Table>,
    _events: Subscription,
    /// The feed's timer (`live`, `?live=`).
    #[cfg(feature = "live")]
    _feed: Option<Task<()>>,
    /// The tail feed's timer (`follow`, `?append=`).
    #[cfg(feature = "follow")]
    _appends: Option<Task<()>>,
}

impl Host {
    /// A table over `shape`'s rows, each page read held `delay`, its float
    /// columns painted `cells`' way (`custom-cells`). With
    /// `probing`, the table reports its probes and the host publishes them
    /// (`__tallTable`, `__tallTableLayout`, and with `custom-cells` and
    /// `?probe-cells` the drawn cells, `__tallTableCells`). With `live`,
    /// `live`'s feed and flash, and with `follow` the tail feed ([`Live`]).
    pub fn new(
        shape: Shape,
        delay: Option<Duration>,
        #[cfg(feature = "custom-cells")] cells: Cells,
        #[cfg(feature = "live")] live: Live,
        probing: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let rows = MemoryRows::new(shape, delay);
        // The drawn cells and their paint, for the smoke check
        // (`?probe-cells`), never in a perf run: building them costs every
        // frame. Only with the feature, so the base host is unchanged.
        #[cfg(not(all(feature = "custom-cells", target_family = "wasm")))]
        let probe_cells = false;
        #[cfg(all(feature = "custom-cells", target_family = "wasm"))]
        let probe_cells = probing && seiza::url::has_param("probe-cells");
        #[cfg(not(feature = "custom-cells"))]
        let columns = shape.columns();
        #[cfg(feature = "custom-cells")]
        let (rows, columns) = (rows.with_cells(cells), cells.columns(shape));
        #[cfg(all(feature = "live", feature = "custom-cells"))]
        let columns = if live.flash {
            crate::rows::with_flash(columns, shape)
        } else {
            columns
        };
        #[cfg(not(feature = "follow"))]
        let count = shape.rows();
        #[cfg(feature = "follow")]
        let count = live.tail.rows.unwrap_or(shape.rows());
        let table = cx.new(|cx| {
            Table::new(rows, columns, count, Paging::default(), cx)
                .probe_frames(probing)
                .probe_cells(probe_cells)
        });
        let publish = Publish {
            filled_mark: Some(FILLED_MARK),
            scrollbar: true,
            probe: probing.then_some("__tallTable"),
            layout: probing.then_some("__tallTableLayout"),
            cells: probe_cells.then_some("__tallTableCells"),
            refreshed_mark: cfg!(feature = "live").then_some(REFRESHED_MARK),
            refreshed: cfg!(feature = "live").then_some(REFRESHED_GLOBAL),
            #[cfg(feature = "follow")]
            following: Some(FOLLOWING_GLOBAL),
            #[cfg(feature = "follow")]
            tail_mark: Some(TAIL_MARK),
            #[cfg(feature = "follow")]
            tail: Some(TAIL_GLOBAL),
            #[cfg(feature = "resize")]
            widths: Some(WIDTHS_GLOBAL),
        };
        // The table emits while its frame renders, so GPUI runs this in the
        // task that presents it, and the mark lands right after the frame.
        let events = cx.subscribe(&table, move |_, _, event, _| publish.event(event));
        // A jump's highlight over painted cells, for its screenshot.
        #[cfg(all(feature = "custom-cells", target_family = "wasm"))]
        if let Some(row) = seiza::url::param("jump").and_then(|row| row.parse().ok()) {
            table.update(cx, |table, cx| table.jump_to(row, cx));
        }
        // Following from the start, before the first frame (a log view).
        #[cfg(feature = "follow")]
        if live.tail.follow {
            table.update(cx, |table, cx| table.follow(cx));
        }
        let focus = table.read(cx).focus_handle().clone();
        window.focus(&focus, cx);
        Self {
            #[cfg(feature = "follow")]
            _appends: live
                .tail
                .append
                .map(|rate| Appends::new(rate).start(table.clone(), cx)),
            #[cfg(feature = "live")]
            _feed: live
                .feed
                .map(|rate| Feed::new(rate).start(table.clone(), cx)),
            table,
            _events: events,
        }
    }
}

/// What the host does with `live`, and with `follow`, which turns it on.
#[cfg(feature = "live")]
#[derive(Debug, Clone, Copy, Default)]
pub struct Live {
    /// The tail feed (`follow`).
    #[cfg(feature = "follow")]
    pub tail: Tail,
    /// `?live=<updates/s>`: that many visible rows a second change ([`Feed`]).
    pub feed: Option<f64>,
    /// `?flash` (with `custom-cells`): every float column flashes a change
    /// (`rows::with_flash`).
    #[cfg(feature = "custom-cells")]
    pub flash: bool,
}

/// What the host does with `follow`: the tail feed.
#[cfg(feature = "follow")]
#[derive(Debug, Clone, Copy, Default)]
pub struct Tail {
    /// `?rows=<n>`: the rows at open (the shape's without it).
    pub rows: Option<u64>,
    /// `?append=<rows/s>`: that many rows appended a second ([`Appends`]).
    pub append: Option<f64>,
    /// `?follow`: `follow()` at open.
    pub follow: bool,
}

/// Events at `rate` a second, counted out over the time that passes: a
/// fraction of one carried over (both feeds').
#[cfg(feature = "live")]
struct Rate {
    rate: f64,
    /// Due but not sent: a fraction of one.
    owed: f64,
}

#[cfg(feature = "live")]
impl Rate {
    fn new(rate: f64) -> Self {
        Self { rate, owed: 0.0 }
    }

    /// How many are due after `elapsed`. A gap past `FEED_CATCH_UP` (a
    /// hidden tab's throttled timers) sends that much, not a backlog.
    fn due(&mut self, elapsed: Duration) -> u64 {
        self.owed += self.rate * elapsed.min(FEED_CATCH_UP).as_secs_f64();
        let count = self.owed.floor();
        self.owed -= count;
        count as u64
    }
}

/// Runs `tick` with the time since the last tick about every frame
/// ([`FEED_EVERY`]), until the task drops (both feeds').
#[cfg(feature = "live")]
fn every_frame(
    cx: &mut Context<Host>,
    mut tick: impl FnMut(Duration, &mut AsyncApp) + 'static,
) -> Task<()> {
    cx.spawn(async move |_, cx| {
        let mut last = cx.background_executor().now();
        loop {
            cx.background_executor().timer(FEED_EVERY).await;
            let now = cx.background_executor().now();
            tick(now - last, cx);
            last = now;
        }
    })
}

/// The bare host's tail feed (`follow`): `rate` rows a second appended to
/// the source, a batch about every frame, one `set_rows` each. The rows are
/// a function of their index already, so the source needs only its count.
#[cfg(feature = "follow")]
pub struct Appends {
    rate: Rate,
}

#[cfg(feature = "follow")]
impl Appends {
    pub fn new(rate: f64) -> Self {
        Self {
            rate: Rate::new(rate),
        }
    }

    /// How many rows `elapsed` appends.
    pub fn batch(&mut self, elapsed: Duration) -> u64 {
        self.rate.due(elapsed)
    }

    /// Appends a batch to `table` about every frame, until the task drops.
    fn start(mut self, table: Entity<Table>, cx: &mut Context<Host>) -> Task<()> {
        every_frame(cx, move |elapsed, cx| {
            let count = self.batch(elapsed);
            if count == 0 {
                return;
            }
            #[cfg(target_family = "wasm")]
            let start = seiza::marks::now();
            let rows = table.update(cx, |table, cx| {
                let rows = table.rows() + count;
                table.set_rows(rows, cx);
                rows
            });
            #[cfg(target_family = "wasm")]
            {
                tall_table_bridge::js::set_global(APPENDED_GLOBAL, &(rows as f64).into());
                seiza::marks::mark_at(APPENDED_MARK, start);
            }
            #[cfg(not(target_family = "wasm"))]
            let _ = rows;
        })
    }
}

/// The bare host's feed (`live`): `rate` updates a second to random visible
/// rows, seeded, sent in a batch about every frame. Each update bumps its
/// row's version in the source and invalidates the row (each row once a
/// batch), so a re-read answers new floats.
#[cfg(feature = "live")]
pub struct Feed {
    rate: Rate,
    rng: u64,
}

#[cfg(feature = "live")]
impl Feed {
    pub fn new(rate: f64) -> Self {
        Self {
            rate: Rate::new(rate),
            rng: FEED_SEED,
        }
    }

    /// splitmix64.
    fn next(&mut self) -> u64 {
        self.rng = self.rng.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.rng;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// The rows `elapsed`'s updates change, among `visible`, each once, in
    /// the order first picked.
    pub fn batch(&mut self, elapsed: Duration, visible: std::ops::Range<u64>) -> Vec<u64> {
        let count = self.rate.due(elapsed);
        let span = visible.end.saturating_sub(visible.start);
        let mut rows: Vec<u64> = Vec::new();
        if span == 0 {
            return rows;
        }
        for _ in 0..count {
            let row = visible.start + self.next() % span;
            if !rows.contains(&row) {
                rows.push(row);
            }
        }
        rows
    }

    /// Sends a batch to `table` about every frame, until the task drops.
    fn start(mut self, table: Entity<Table>, cx: &mut Context<Host>) -> Task<()> {
        every_frame(cx, move |elapsed, cx| {
            let sent = table.update(cx, |table, cx| {
                let rows = self.batch(elapsed, table.visible_rows());
                // After the feed's own picking: from here on, the
                // source's and the table's work.
                #[cfg(target_family = "wasm")]
                let start = seiza::marks::now();
                #[cfg(not(target_family = "wasm"))]
                let start = 0.0;
                let mut generation = None;
                for row in rows {
                    table.delegate_mut().bump(row);
                    generation = Some(table.invalidate_rows(row..row + 1, cx));
                }
                generation.map(|generation| (generation, start))
            });
            #[cfg(target_family = "wasm")]
            if let Some((generation, start)) = sent {
                tall_table_bridge::js::set_global(INVALIDATED_GLOBAL, &(generation as f64).into());
                seiza::marks::mark_at(INVALIDATED_MARK, start);
            }
            #[cfg(not(target_family = "wasm"))]
            let _ = sent;
        })
    }
}

impl Render for Host {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().p_4().child(TallTable::new(&self.table))
    }
}

#[cfg(all(test, feature = "live"))]
mod tests {
    use std::time::Duration;

    use super::Feed;

    #[cfg(feature = "follow")]
    #[test]
    fn the_tail_feed_appends_its_rate() {
        use super::Appends;
        let mut feed = Appends::new(10_000.0);
        let sent: u64 = (0..100)
            .map(|_| feed.batch(Duration::from_millis(16)))
            .sum();
        // 16 ms of 10k rows a second is 160 rows, every batch.
        assert_eq!(sent, 16_000);
        // A fraction is carried, not lost.
        let mut slow = Appends::new(10.0);
        assert_eq!(slow.batch(Duration::from_millis(50)), 0);
        assert_eq!(slow.batch(Duration::from_millis(50)), 1);
        // A long gap catches up on 100 ms.
        assert_eq!(Appends::new(1000.0).batch(Duration::from_secs(600)), 100);
    }

    #[test]
    fn the_feed_sends_its_rate_over_the_visible_rows() {
        let mut feed = Feed::new(1000.0);
        let mut sent = 0;
        for _ in 0..100 {
            let rows = feed.batch(Duration::from_millis(16), 200..228);
            assert!(rows.iter().all(|row| (200..228).contains(row)));
            let mut distinct = rows.clone();
            distinct.sort_unstable();
            distinct.dedup();
            assert_eq!(distinct.len(), rows.len(), "each row once a batch");
            sent += rows.len();
        }
        // 1,600 updates over 28 rows: about 15 distinct rows a batch.
        assert!((1200..=1600).contains(&sent), "{sent} rows");
        // Seeded: the same rows every run.
        let (mut a, mut b) = (Feed::new(50.0), Feed::new(50.0));
        assert_eq!(
            a.batch(Duration::from_millis(100), 0..28),
            b.batch(Duration::from_millis(100), 0..28)
        );
        // A fraction of an update is carried, not lost.
        let mut slow = Feed::new(10.0);
        assert!(slow.batch(Duration::from_millis(50), 0..28).is_empty());
        assert_eq!(slow.batch(Duration::from_millis(50), 0..28).len(), 1);
        assert!(
            Feed::new(1000.0)
                .batch(Duration::from_secs(1), 5..5)
                .is_empty()
        );
        // A long gap catches up on 100 ms, not on all of it.
        let rows = Feed::new(1000.0).batch(Duration::from_secs(600), 0..1_000_000);
        assert!((90..=100).contains(&rows.len()), "{} rows", rows.len());
    }
}
