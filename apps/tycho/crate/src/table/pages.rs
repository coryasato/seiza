//! The table's page cache: which fixed-size pages of rows are loaded, which
//! are in flight, and which to fetch, cancel, or evict next.
//!
//! Pure bookkeeping, so it's tested natively: the view sends the queries and
//! reports back. `T` is a loaded page, `R` identifies an in-flight request.

use std::collections::HashMap;
use std::ops::Range;

/// Which way the viewport last moved. Prefetch reaches further that way.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Direction {
    #[default]
    Still,
    Down,
    Up,
}

#[derive(Debug)]
enum Slot<T, R> {
    Loading(R),
    Loaded { page: T, bytes: usize, used: u64 },
    Failed(String),
}

/// What a row looks like to the renderer.
#[derive(Debug, PartialEq)]
pub enum RowState<'a, T> {
    /// Loaded: the page and the row's index in it.
    Loaded(&'a T, usize),
    /// Not loaded yet (in flight, queued, or never asked for): a placeholder.
    Pending,
    Failed(&'a str),
}

/// What the view should do after [`PageCache::plan`].
#[derive(Debug, PartialEq)]
pub struct Plan<R> {
    /// Pages to query now, most urgent first. Report each with
    /// [`PageCache::started`].
    pub fetch: Vec<u64>,
    /// In-flight requests nobody needs any more. Report each one's answer
    /// with [`PageCache::finished`] (or `loaded`/`failed` if it wins the race).
    pub cancel: Vec<R>,
}

#[derive(Debug)]
pub struct PageCache<T, R> {
    page_rows: u64,
    rows: u64,
    /// Loaded pages beyond this many bytes are evicted, least recently used
    /// first, unless they're wanted right now.
    budget_bytes: usize,
    /// Queries in flight at once, cancelled ones included. DuckDB-Wasm runs
    /// one query slice at a time, so more in flight only makes each one
    /// slower, and a cancelled query still holds the worker: a page read it
    /// has started can't be stopped (sync XHRs; cancel lands between slices).
    max_in_flight: usize,
    slots: HashMap<u64, Slot<T, R>>,
    /// Cancelled requests that haven't answered yet. They count against
    /// `max_in_flight` until they do.
    draining: Vec<R>,
    used_bytes: usize,
    tick: u64,
}

impl<T, R: Copy + PartialEq> PageCache<T, R> {
    pub fn new(rows: u64, page_rows: u64, budget_bytes: usize, max_in_flight: usize) -> Self {
        Self {
            page_rows: page_rows.max(1),
            rows,
            budget_bytes,
            max_in_flight: max_in_flight.max(1),
            slots: HashMap::new(),
            draining: Vec::new(),
            used_bytes: 0,
            tick: 0,
        }
    }

    pub fn page_rows(&self) -> u64 {
        self.page_rows
    }

    pub fn pages(&self) -> u64 {
        self.rows.div_ceil(self.page_rows)
    }

    /// The rows page `page` holds.
    pub fn rows_of(&self, page: u64) -> Range<u64> {
        let start = page * self.page_rows;
        start.min(self.rows)..(start + self.page_rows).min(self.rows)
    }

    /// Changes the row count (a CSV grows while it loads). If the old last
    /// page was short, it no longer holds every row it covers: it's
    /// forgotten, and its request, if one is out, is returned for the caller
    /// to cancel (it counts as in flight until it answers).
    pub fn set_rows(&mut self, rows: u64) -> Option<R> {
        let old = std::mem::replace(&mut self.rows, rows);
        if old.is_multiple_of(self.page_rows) || rows == old {
            return None;
        }
        let page = old / self.page_rows;
        match self.slots.remove(&page) {
            Some(Slot::Loaded { bytes, .. }) => {
                self.used_bytes -= bytes;
                None
            }
            Some(Slot::Loading(request)) => {
                self.draining.push(request);
                Some(request)
            }
            _ => None,
        }
    }

    /// Bytes held by loaded pages.
    pub fn used_bytes(&self) -> usize {
        self.used_bytes
    }

    pub fn loaded_pages(&self) -> usize {
        self.slots
            .values()
            .filter(|slot| matches!(slot, Slot::Loaded { .. }))
            .count()
    }

    /// Requests for pages still wanted.
    pub fn in_flight(&self) -> usize {
        self.slots
            .values()
            .filter(|slot| matches!(slot, Slot::Loading(_)))
            .count()
    }

    /// Every request still wanted, to cancel when the table goes away.
    pub fn requests(&self) -> impl Iterator<Item = R> + '_ {
        self.slots.values().filter_map(|slot| match slot {
            Slot::Loading(request) => Some(*request),
            _ => None,
        })
    }

    /// Cancelled requests DuckDB hasn't answered yet.
    pub fn draining(&self) -> usize {
        self.draining.len()
    }

    pub fn row(&self, row: u64) -> RowState<'_, T> {
        let page = row / self.page_rows;
        match self.slots.get(&page) {
            Some(Slot::Loaded { page: data, .. }) => {
                RowState::Loaded(data, (row - page * self.page_rows) as usize)
            }
            Some(Slot::Failed(message)) => RowState::Failed(message),
            _ => RowState::Pending,
        }
    }

    /// The pages worth having for the `visible` rows, most urgent first: the
    /// visible pages (from the edge the viewport is moving toward), then
    /// `prefetch` pages behind and `prefetch` ahead, doubled ahead while
    /// moving, nearest first.
    pub fn wanted(&self, visible: Range<u64>, direction: Direction, prefetch: u64) -> Vec<u64> {
        let pages = self.pages();
        if pages == 0 {
            return Vec::new();
        }
        let (first, last) = self.visible_span(&visible);
        let mut wanted: Vec<u64> = (first..=last).collect();
        if direction == Direction::Up {
            wanted.reverse();
        }
        let (ahead, behind) = match direction {
            Direction::Still => (prefetch, prefetch),
            Direction::Down | Direction::Up => (prefetch * 2, prefetch),
        };
        // The page `step` pages beyond the visible ones, below or above.
        let beyond = |down: bool, step: u64| {
            if down {
                last.checked_add(step).filter(|page| *page < pages)
            } else {
                first.checked_sub(step)
            }
        };
        let forward_is_down = direction != Direction::Up;
        for step in 1..=ahead.max(behind) {
            if step <= ahead {
                wanted.extend(beyond(forward_is_down, step));
            }
            if step <= behind {
                wanted.extend(beyond(!forward_is_down, step));
            }
        }
        wanted
    }

    /// How many pages the `visible` rows touch: the head of
    /// [`PageCache::wanted`]'s list, for [`PageCache::plan`].
    pub fn visible_pages(&self, visible: Range<u64>) -> usize {
        if self.pages() == 0 {
            return 0;
        }
        let (first, last) = self.visible_span(&visible);
        (last - first + 1) as usize
    }

    /// The first and last page the `visible` rows touch. Needs a page.
    fn visible_span(&self, visible: &Range<u64>) -> (u64, u64) {
        let pages = self.pages();
        let first = (visible.start / self.page_rows).min(pages - 1);
        let last = (visible.end.saturating_sub(1).max(visible.start) / self.page_rows)
            .clamp(first, pages - 1);
        (first, last)
    }

    /// Reconciles the cache with `wanted` (from [`PageCache::wanted`]):
    /// cancels in-flight pages that aren't wanted, forgets failures that
    /// aren't (so coming back retries them), marks wanted loaded pages as
    /// used, and picks what to fetch, up to the in-flight limit.
    ///
    /// The first `visible` pages of `wanted` are on screen. While any of them
    /// isn't loaded, no prefetch page starts: DuckDB-Wasm runs one query
    /// slice at a time, round-robin, so a prefetch in flight next to a
    /// visible page makes it finish as late as both. At 50 ms a page (M4's
    /// sample) that never showed; at ~540 ms (a 1 GB file with 1,378 row
    /// groups, M5) first rows took 2.7 s instead of one page's time.
    pub fn plan(&mut self, wanted: &[u64], visible: usize) -> Plan<R> {
        let mut cancel = Vec::new();
        self.slots.retain(|page, slot| match slot {
            Slot::Loading(request) if !wanted.contains(page) => {
                cancel.push(*request);
                false
            }
            Slot::Failed(_) => wanted.contains(page),
            _ => true,
        });
        self.draining.extend(cancel.iter().copied());
        self.tick += 1;
        let tick = self.tick;
        let mut in_flight = self.in_flight() + self.draining.len();
        let mut fetch = Vec::new();
        let visible = visible.min(wanted.len());
        // Loading or not asked for yet. A failed page isn't retried while it
        // stays in view, so it mustn't hold prefetch back.
        let visible_missing = wanted[..visible]
            .iter()
            .any(|page| matches!(self.slots.get(page), None | Some(Slot::Loading(_))));
        let reach = if visible_missing {
            visible
        } else {
            wanted.len()
        };
        for (index, page) in wanted.iter().enumerate() {
            if index >= reach {
                // Still mark loaded prefetch pages as used, so they aren't
                // evicted while the visible ones load.
                if let Some(Slot::Loaded { used, .. }) = self.slots.get_mut(page) {
                    *used = tick;
                }
                continue;
            }
            match self.slots.get_mut(page) {
                Some(Slot::Loaded { used, .. }) => *used = tick,
                Some(_) => {}
                None if in_flight < self.max_in_flight => {
                    fetch.push(*page);
                    in_flight += 1;
                }
                None => {}
            }
        }
        Plan { fetch, cancel }
    }

    /// `page`'s query was sent as `request`.
    pub fn started(&mut self, page: u64, request: R) {
        self.slots.insert(page, Slot::Loading(request));
    }

    /// `request` for `page` returned. Kept only if that request is still the
    /// page's (not cancelled or superseded); then pages outside `wanted` are
    /// evicted, least recently used first, until the cache fits its budget.
    /// Returns whether the page was kept.
    pub fn loaded(&mut self, page: u64, request: R, data: T, bytes: usize, wanted: &[u64]) -> bool {
        self.finished(request);
        if !matches!(self.slots.get(&page), Some(Slot::Loading(r)) if *r == request) {
            return false;
        }
        self.tick += 1;
        self.slots.insert(
            page,
            Slot::Loaded {
                page: data,
                bytes,
                used: self.tick,
            },
        );
        self.used_bytes += bytes;
        self.evict(wanted);
        true
    }

    /// `request` for `page` failed. The rows show the error while they're
    /// in view; once they aren't, [`PageCache::plan`] forgets the failure, so
    /// coming back retries the page.
    pub fn failed(&mut self, page: u64, request: R, message: String) {
        self.finished(request);
        if matches!(self.slots.get(&page), Some(Slot::Loading(r)) if *r == request) {
            self.slots.insert(page, Slot::Failed(message));
        }
    }

    /// `request` answered (a cancelled request, or any other): it no longer
    /// holds a place in flight. `loaded` and `failed` call this themselves.
    pub fn finished(&mut self, request: R) {
        self.draining.retain(|draining| *draining != request);
    }

    fn evict(&mut self, wanted: &[u64]) {
        while self.used_bytes > self.budget_bytes {
            let oldest = self
                .slots
                .iter()
                .filter_map(|(page, slot)| match slot {
                    Slot::Loaded { used, bytes, .. } if !wanted.contains(page) => {
                        Some((*used, *page, *bytes))
                    }
                    _ => None,
                })
                .min();
            let Some((_, page, bytes)) = oldest else {
                return;
            };
            self.slots.remove(&page);
            self.used_bytes -= bytes;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type Cache = PageCache<&'static str, u32>;

    #[test]
    fn wanted_orders_visible_then_nearest_prefetch() {
        let cache = Cache::new(10_000, 100, 1 << 20, 4);
        assert_eq!(
            cache.wanted(250..380, Direction::Still, 2),
            vec![2, 3, 4, 1, 5, 0]
        );
        // Moving: twice as far ahead; moving up, the visible pages bottom-up.
        assert_eq!(
            cache.wanted(250..380, Direction::Down, 1),
            vec![2, 3, 4, 1, 5]
        );
        assert_eq!(
            cache.wanted(250..380, Direction::Up, 1),
            vec![3, 2, 1, 4, 0]
        );
    }

    #[test]
    fn wanted_stays_inside_the_table() {
        let cache = Cache::new(250, 100, 1 << 20, 4);
        assert_eq!(cache.wanted(0..30, Direction::Still, 3), vec![0, 1, 2]);
        assert_eq!(cache.wanted(230..250, Direction::Down, 3), vec![2, 1, 0]);
        assert_eq!(cache.rows_of(2), 200..250);
        assert!(
            Cache::new(0, 100, 0, 1)
                .wanted(0..0, Direction::Still, 2)
                .is_empty()
        );
    }

    #[test]
    fn plan_limits_in_flight_and_cancels_stale() {
        let mut cache = Cache::new(10_000, 100, 1 << 20, 2);
        let plan = cache.plan(&[5, 6, 7], 0);
        assert_eq!(
            plan,
            Plan {
                fetch: vec![5, 6],
                cancel: vec![]
            }
        );
        cache.started(5, 50);
        cache.started(6, 60);
        // The viewport jumped: both in-flight pages are stale. They're
        // cancelled, but DuckDB keeps reading them, so nothing new starts
        // until they answer.
        let plan = cache.plan(&[90, 91], 0);
        assert!(plan.fetch.is_empty());
        let mut cancelled = plan.cancel;
        cancelled.sort();
        assert_eq!(cancelled, vec![50, 60]);
        assert_eq!((cache.in_flight(), cache.draining()), (0, 2));
        cache.finished(50);
        assert_eq!(cache.plan(&[90, 91], 0).fetch, vec![90]);
        cache.started(90, 90);
        // A cancelled request that won the race still frees its place.
        assert!(!cache.loaded(6, 60, "late", 5, &[90, 91]));
        assert_eq!(cache.draining(), 0);
        assert_eq!(cache.plan(&[90, 91], 0).fetch, vec![91]);
    }

    #[test]
    fn a_cancelled_or_superseded_answer_is_dropped() {
        let mut cache = Cache::new(10_000, 100, 1 << 20, 4);
        cache.plan(&[1], 0);
        cache.started(1, 10);
        cache.plan(&[2], 0);
        assert!(!cache.loaded(1, 10, "late", 5, &[2]));
        assert_eq!(cache.row(150), RowState::Pending);
        cache.started(1, 11);
        assert!(!cache.loaded(1, 10, "stale", 5, &[1]));
        assert!(cache.loaded(1, 11, "fresh", 5, &[1]));
        assert_eq!(cache.row(150), RowState::Loaded(&"fresh", 50));
    }

    #[test]
    fn prefetch_waits_for_the_visible_pages() {
        let mut cache: PageCache<&str, u32> = PageCache::new(10_000, 100, 1_000, 3);
        let wanted = cache.wanted(250..380, Direction::Still, 1);
        let visible = cache.visible_pages(250..380);
        assert_eq!((wanted.clone(), visible), (vec![2, 3, 4, 1], 2));
        // Only the visible pages start, though the limit allows a third.
        let plan = cache.plan(&wanted, visible);
        assert_eq!(plan.fetch, vec![2, 3]);
        cache.started(2, 20);
        cache.started(3, 30);
        assert!(cache.loaded(2, 20, "p", 5, &wanted));
        assert_eq!(cache.plan(&wanted, visible).fetch, Vec::<u64>::new());
        // Every visible page in: prefetch goes out.
        assert!(cache.loaded(3, 30, "p", 5, &wanted));
        assert_eq!(cache.plan(&wanted, visible).fetch, vec![4, 1]);
    }

    #[test]
    fn a_failed_visible_page_doesnt_hold_prefetch() {
        let mut cache: PageCache<&str, u32> = PageCache::new(10_000, 100, 1_000, 3);
        let wanted = cache.wanted(250..380, Direction::Still, 1);
        let visible = cache.visible_pages(250..380);
        cache.plan(&wanted, visible);
        cache.started(2, 20);
        cache.started(3, 30);
        cache.failed(2, 20, "network".into());
        assert!(cache.loaded(3, 30, "p", 5, &wanted));
        assert_eq!(cache.plan(&wanted, visible).fetch, vec![4, 1]);
    }

    #[test]
    fn evicts_least_recently_used_but_never_wanted() {
        let mut cache = Cache::new(10_000, 100, 25, 8);
        for page in 0..3 {
            cache.started(page, page as u32);
            assert!(cache.loaded(page, page as u32, "p", 10, &[]));
        }
        // 30 bytes > 25: page 0, the oldest, went.
        assert_eq!(cache.loaded_pages(), 2);
        assert_eq!(cache.used_bytes(), 20);
        assert_eq!(cache.row(0), RowState::Pending);
        // Touch page 1, then load page 3: page 2 is now the oldest.
        cache.plan(&[1], 0);
        cache.started(3, 3);
        cache.loaded(3, 3, "p", 10, &[1, 3]);
        assert!(matches!(cache.row(100), RowState::Loaded(..)));
        assert_eq!(cache.row(200), RowState::Pending);
        // Everything wanted: over budget, but nothing visible is dropped.
        cache.started(4, 4);
        cache.loaded(4, 4, "p", 10, &[1, 3, 4]);
        assert_eq!(cache.loaded_pages(), 3);
        assert_eq!(cache.used_bytes(), 30);
    }

    #[test]
    fn growing_forgets_the_short_last_page() {
        let mut cache = Cache::new(250, 100, 1 << 20, 4);
        for page in 0..3 {
            cache.started(page, page as u32);
        }
        assert!(cache.loaded(0, 0, "full", 10, &[]));
        assert!(cache.loaded(2, 2, "short", 10, &[]));
        // Page 2 held rows 200..250 of 200..300: gone once there are more.
        assert_eq!(cache.set_rows(400), None);
        assert_eq!(cache.row(210), RowState::Pending);
        assert_eq!(cache.used_bytes(), 10);
        assert!(matches!(cache.row(10), RowState::Loaded(..)));
        assert_eq!(cache.pages(), 4);
        // A short page still loading: cancelled, and draining until it answers.
        cache.started(3, 3);
        assert_eq!(cache.set_rows(450), None);
        assert_eq!(cache.set_rows(450), None);
        let mut cache = Cache::new(250, 100, 1 << 20, 4);
        cache.started(2, 2);
        assert_eq!(cache.set_rows(300), Some(2));
        assert_eq!(cache.draining(), 1);
        assert!(!cache.loaded(2, 2, "late", 10, &[]));
        assert_eq!(cache.draining(), 0);
        // Whole pages stay.
        let mut cache = Cache::new(200, 100, 1 << 20, 4);
        cache.started(1, 1);
        assert!(cache.loaded(1, 1, "full", 10, &[]));
        assert_eq!(cache.set_rows(300), None);
        assert!(matches!(cache.row(150), RowState::Loaded(..)));
    }

    #[test]
    fn failures_stay_while_in_view_then_retry() {
        let mut cache = Cache::new(1_000, 100, 1 << 20, 4);
        cache.plan(&[0], 0);
        cache.started(0, 1);
        cache.failed(0, 1, "network".into());
        assert_eq!(cache.row(5), RowState::Failed("network"));
        // Still in view: shown, not hammered.
        assert!(cache.plan(&[0], 0).fetch.is_empty());
        // Scrolled away, then back: asked for again.
        cache.plan(&[5], 0);
        assert_eq!(cache.row(5), RowState::Pending);
        assert_eq!(cache.plan(&[0], 0).fetch, vec![0]);
    }
}
