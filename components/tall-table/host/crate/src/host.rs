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

/// Set as each batch of the feed's updates is invalidated (`live`), with
/// its last generation in [`INVALIDATED_GLOBAL`], set first.
#[cfg(all(feature = "live", target_family = "wasm"))]
pub const INVALIDATED_MARK: &str = "tall-table:invalidated";
#[cfg(all(feature = "live", target_family = "wasm"))]
pub const INVALIDATED_GLOBAL: &str = "__tallTableInvalidated";

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
}

impl Host {
    /// A table over `shape`'s rows, each page read held `delay`, its float
    /// columns painted `cells`' way (`custom-cells`). With
    /// `probing`, the table reports its probes and the host publishes them
    /// (`__tallTable`, `__tallTableLayout`, and with `custom-cells` and
    /// `?probe-cells` the drawn cells, `__tallTableCells`). With `live` and
    /// a `feed` rate, that many visible rows a second change ([`Feed`]).
    pub fn new(
        shape: Shape,
        delay: Option<Duration>,
        #[cfg(feature = "custom-cells")] cells: Cells,
        #[cfg(feature = "live")] feed: Option<f64>,
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
        let table = cx.new(|cx| {
            Table::new(rows, columns, shape.rows(), Paging::default(), cx)
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
        };
        // The table emits while its frame renders, so GPUI runs this in the
        // task that presents it, and the mark lands right after the frame.
        let events = cx.subscribe(&table, move |_, _, event, _| publish.event(event));
        // A jump's highlight over painted cells, for its screenshot.
        #[cfg(all(feature = "custom-cells", target_family = "wasm"))]
        if let Some(row) = seiza::url::param("jump").and_then(|row| row.parse().ok()) {
            table.update(cx, |table, cx| table.jump_to(row, cx));
        }
        let focus = table.read(cx).focus_handle().clone();
        window.focus(&focus, cx);
        Self {
            #[cfg(feature = "live")]
            _feed: feed.map(|rate| Feed::new(rate).start(table.clone(), cx)),
            table,
            _events: events,
        }
    }
}

/// The bare host's feed (`live`): `rate` updates a second to random visible
/// rows, seeded, sent in a batch about every frame. Each update bumps its
/// row's version in the source and invalidates the row (each row once a
/// batch), so a re-read answers new floats.
#[cfg(feature = "live")]
pub struct Feed {
    rate: f64,
    rng: u64,
    /// Updates due but not sent: a fraction of one, carried over.
    owed: f64,
}

#[cfg(feature = "live")]
impl Feed {
    pub fn new(rate: f64) -> Self {
        Self {
            rate,
            rng: FEED_SEED,
            owed: 0.0,
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
        // A gap past `FEED_CATCH_UP` (a hidden tab's throttled timers)
        // sends that much, not a backlog.
        self.owed += self.rate * elapsed.min(FEED_CATCH_UP).as_secs_f64();
        let count = self.owed.floor();
        self.owed -= count;
        let span = visible.end.saturating_sub(visible.start);
        let mut rows: Vec<u64> = Vec::new();
        if span == 0 {
            return rows;
        }
        for _ in 0..count as u64 {
            let row = visible.start + self.next() % span;
            if !rows.contains(&row) {
                rows.push(row);
            }
        }
        rows
    }

    /// Sends a batch to `table` about every frame, until the task drops.
    fn start(mut self, table: Entity<Table>, cx: &mut Context<Host>) -> Task<()> {
        cx.spawn(async move |_, cx| {
            let mut last = cx.background_executor().now();
            loop {
                cx.background_executor().timer(FEED_EVERY).await;
                let now = cx.background_executor().now();
                let elapsed = now - last;
                last = now;
                let sent = table.update(cx, |table, cx| {
                    let rows = self.batch(elapsed, table.visible_rows());
                    let mut generation = None;
                    for row in rows {
                        table.delegate_mut().bump(row);
                        generation = Some(table.invalidate_rows(row..row + 1, cx));
                    }
                    generation
                });
                #[cfg(target_family = "wasm")]
                if let Some(generation) = sent {
                    tall_table_bridge::js::set_global(
                        INVALIDATED_GLOBAL,
                        &(generation as f64).into(),
                    );
                    seiza::marks::mark(INVALIDATED_MARK);
                }
                #[cfg(not(target_family = "wasm"))]
                let _ = sent;
            }
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
