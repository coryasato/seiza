//! The table's page cache: which fixed-size pages of rows are loaded, which
//! are in flight, and which to fetch, cancel, or evict next.
//!
//! Pure bookkeeping, so it's tested natively: the view sends the queries and
//! reports back. `T` is a loaded page, `R` identifies an in-flight request.
//!
//! With `live`, a loaded page can be stale (its rows were invalidated): it
//! keeps drawing while its page is read again, one read per page in flight,
//! and the read that lands replaces it (`docs/DECISIONS.md`, "Features").

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
    Loading {
        request: R,
        /// Rows were invalidated during the read: read again once it lands.
        #[cfg(feature = "live")]
        stale: bool,
    },
    Loaded {
        page: T,
        bytes: usize,
        used: u64,
        #[cfg(feature = "live")]
        live: Live<R>,
    },
    Failed(String),
}

/// A loaded page's re-reads (`live`).
#[cfg(feature = "live")]
#[derive(Debug)]
struct Live<R> {
    /// Rows were invalidated since the last read of the page started: it
    /// needs another.
    stale: bool,
    /// The re-read in flight, and the generation it started at.
    reading: Option<(R, u64)>,
    /// The last re-read failed: not read again until the next invalidation
    /// or [`PageCache::forget_failed`].
    failed: bool,
    /// A re-read landed and hasn't been drawn yet: its generation.
    landed: Option<u64>,
}

#[cfg(feature = "live")]
impl<R> Live<R> {
    fn new(stale: bool) -> Self {
        Self {
            stale,
            reading: None,
            failed: false,
            landed: None,
        }
    }

    /// What's drawn is older than the source: invalidated, or being read again.
    fn outdated(&self) -> bool {
        self.stale || self.reading.is_some()
    }

    /// Wants a re-read started now.
    fn wants_read(&self) -> bool {
        self.stale && self.reading.is_none() && !self.failed
    }
}

/// A paging fixture's negative controls (`fixtures/paging.json`), each a
/// way to get re-reads wrong that the fixture must catch.
#[cfg(all(test, feature = "live"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Control {
    #[default]
    None,
    /// Stale pages outside `wanted` are kept and read again.
    RereadUnwanted,
    /// A page invalidated during its re-read cancels it and reads anew.
    RestartStale,
}

/// Outside the tests, no control.
#[cfg(all(not(test), feature = "live"))]
#[derive(Debug, Clone, Copy)]
struct Control;

#[cfg(feature = "live")]
impl Control {
    fn reread_unwanted(self) -> bool {
        #[cfg(test)]
        return self == Self::RereadUnwanted;
        #[cfg(not(test))]
        false
    }
}

/// A plan's re-reads: in flight, at most `limit`.
#[cfg(feature = "live")]
struct Rereads {
    in_flight: usize,
    limit: usize,
    /// The visible pages' re-reads were planned.
    visible_done: bool,
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
    /// Bumped by each [`PageCache::invalidate`] (`live`).
    #[cfg(feature = "live")]
    generation: u64,
    /// Some loaded page has a re-read [`PageCache::take_refreshed`] hasn't
    /// taken yet.
    #[cfg(feature = "live")]
    landed: bool,
    #[cfg(all(test, feature = "live"))]
    pub(crate) control: Control,
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
            #[cfg(feature = "live")]
            generation: 0,
            #[cfg(feature = "live")]
            landed: false,
            #[cfg(all(test, feature = "live"))]
            control: Control::None,
        }
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
            Some(Slot::Loaded {
                bytes,
                #[cfg(feature = "live")]
                live,
                ..
            }) => {
                self.used_bytes -= bytes;
                // Its re-read, if one is out, goes with it.
                #[cfg(feature = "live")]
                if let Some((request, _)) = live.reading {
                    self.draining.push(request);
                    return Some(request);
                }
                None
            }
            Some(Slot::Loading { request, .. }) => {
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

    /// Requests for pages still wanted (with `live`, re-reads too).
    pub fn in_flight(&self) -> usize {
        self.slots
            .values()
            .filter(|slot| match slot {
                Slot::Loading { .. } => true,
                #[cfg(feature = "live")]
                Slot::Loaded { live, .. } => live.reading.is_some(),
                _ => false,
            })
            .count()
    }

    /// Every request still wanted, to cancel when the table goes away.
    pub fn requests(&self) -> impl Iterator<Item = R> + '_ {
        self.slots.values().filter_map(|slot| match slot {
            Slot::Loading { request, .. } => Some(*request),
            #[cfg(feature = "live")]
            Slot::Loaded { live, .. } => live.reading.map(|(request, _)| request),
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
    /// visible page makes it finish as late as both. At 50 ms a page (the
    /// asteroids' sample) that never showed; at ~540 ms (a 1 GB file with
    /// 1,378 row groups) first rows took 2.7 s instead of one page's time.
    ///
    /// With `live`, a stale page that isn't wanted is dropped (its re-read
    /// cancelled), and stale pages are read again: the visible ones after
    /// the visible pages with nothing to show, the rest as prefetch, in
    /// `wanted`'s order, never more than `max_in_flight − 1` re-reads at
    /// once (so re-reads alone never fill every place).
    pub fn plan(&mut self, wanted: &[u64], visible: usize) -> Plan<R> {
        let mut cancel = Vec::new();
        #[cfg(feature = "live")]
        let control = self.control();
        #[cfg(feature = "live")]
        let used_bytes = &mut self.used_bytes;
        self.slots.retain(|page, slot| match slot {
            Slot::Loading { request, .. } if !wanted.contains(page) => {
                cancel.push(*request);
                false
            }
            Slot::Failed(_) => wanted.contains(page),
            // Rows known to be old aren't kept for later: scrolled back
            // to, the page loads as any other does.
            #[cfg(feature = "live")]
            Slot::Loaded { bytes, live, .. }
                if live.outdated() && !wanted.contains(page) && !control.reread_unwanted() =>
            {
                cancel.extend(live.reading.map(|(request, _)| request));
                *used_bytes -= *bytes;
                false
            }
            #[cfg(all(test, feature = "live"))]
            Slot::Loaded { live, .. } if control == Control::RestartStale && live.stale => {
                cancel.extend(live.reading.take().map(|(request, _)| request));
                true
            }
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
            .any(|page| matches!(self.slots.get(page), None | Some(Slot::Loading { .. })));
        let reach = if visible_missing {
            visible
        } else {
            wanted.len()
        };
        #[cfg(feature = "live")]
        let mut rereads = Rereads {
            in_flight: self.rereading(),
            limit: (self.max_in_flight - 1).max(1),
            visible_done: false,
        };
        for (index, page) in wanted.iter().enumerate() {
            // Past the visible pages: their re-reads go before prefetch.
            #[cfg(feature = "live")]
            if index == visible {
                self.reread_visible(&wanted[..visible], &mut rereads, &mut in_flight, &mut fetch);
            }
            if index >= reach {
                // Still mark loaded prefetch pages as used, so they aren't
                // evicted while the visible ones load.
                if let Some(Slot::Loaded { used, .. }) = self.slots.get_mut(page) {
                    *used = tick;
                }
                continue;
            }
            match self.slots.get_mut(page) {
                Some(Slot::Loaded { used, .. }) => {
                    *used = tick;
                    #[cfg(feature = "live")]
                    if index >= visible {
                        self.reread(&[*page], &mut rereads, &mut in_flight, &mut fetch);
                    }
                }
                Some(_) => {}
                None if in_flight < self.max_in_flight => {
                    fetch.push(*page);
                    in_flight += 1;
                }
                None => {}
            }
        }
        #[cfg(feature = "live")]
        self.reread_visible(&wanted[..visible], &mut rereads, &mut in_flight, &mut fetch);
        #[cfg(all(test, feature = "live"))]
        if self.control.reread_unwanted() {
            let unwanted: Vec<u64> = self
                .slots
                .keys()
                .copied()
                .filter(|page| !wanted.contains(page))
                .collect();
            self.reread(&unwanted, &mut rereads, &mut in_flight, &mut fetch);
        }
        Plan { fetch, cancel }
    }

    /// Adds the visible pages' re-reads to `fetch`, once a plan: after the
    /// visible pages with nothing to show, before prefetch.
    #[cfg(feature = "live")]
    fn reread_visible(
        &self,
        visible: &[u64],
        rereads: &mut Rereads,
        in_flight: &mut usize,
        fetch: &mut Vec<u64>,
    ) {
        if !std::mem::replace(&mut rereads.visible_done, true) {
            self.reread(visible, rereads, in_flight, fetch);
        }
    }

    /// Adds `pages`' wanted re-reads to `fetch`, under the in-flight limit
    /// and the re-reads' own.
    #[cfg(feature = "live")]
    fn reread(
        &self,
        pages: &[u64],
        rereads: &mut Rereads,
        in_flight: &mut usize,
        fetch: &mut Vec<u64>,
    ) {
        for page in pages {
            let wants = matches!(self.slots.get(page), Some(Slot::Loaded { live, .. }) if live.wants_read());
            if wants
                && *in_flight < self.max_in_flight
                && rereads.in_flight < rereads.limit
                && !fetch.contains(page)
            {
                fetch.push(*page);
                *in_flight += 1;
                rereads.in_flight += 1;
            }
        }
    }

    /// `page`'s query was sent as `request`. With `live`, a loaded page's
    /// is a re-read: it keeps drawing until the read lands.
    pub fn started(&mut self, page: u64, request: R) {
        #[cfg(feature = "live")]
        if let Some(Slot::Loaded { live, .. }) = self.slots.get_mut(&page) {
            live.reading = Some((request, self.generation));
            live.stale = false;
            return;
        }
        self.slots.insert(
            page,
            Slot::Loading {
                request,
                #[cfg(feature = "live")]
                stale: false,
            },
        );
    }

    /// `request` for `page` returned. Kept only if that request is still the
    /// page's (not cancelled or superseded); then pages outside `wanted` are
    /// evicted, least recently used first, until the cache fits its budget.
    /// Returns whether the page was kept.
    ///
    /// With `live`, a re-read's page replaces the one drawn (its bytes
    /// swapped for the old page's), and waits for
    /// [`PageCache::take_refreshed`]; a page invalidated during its read is
    /// kept, and read again.
    pub fn loaded(&mut self, page: u64, request: R, data: T, bytes: usize, wanted: &[u64]) -> bool {
        self.finished(request);
        #[cfg(feature = "live")]
        if let Some(Slot::Loaded {
            page: drawn,
            bytes: held,
            used,
            live,
        }) = self.slots.get_mut(&page)
        {
            let Some((_, generation)) = live.reading.filter(|(read, _)| *read == request) else {
                return false;
            };
            self.tick += 1;
            *drawn = data;
            self.used_bytes = self.used_bytes - *held + bytes;
            *held = bytes;
            *used = self.tick;
            live.reading = None;
            live.landed = Some(generation);
            self.landed = true;
            self.evict(wanted);
            return true;
        }
        if !matches!(self.slots.get(&page), Some(Slot::Loading { request: r, .. }) if *r == request)
        {
            return false;
        }
        #[cfg(feature = "live")]
        let stale = matches!(
            self.slots.get(&page),
            Some(Slot::Loading { stale: true, .. })
        );
        self.tick += 1;
        self.slots.insert(
            page,
            Slot::Loaded {
                page: data,
                bytes,
                used: self.tick,
                #[cfg(feature = "live")]
                live: Live::new(stale),
            },
        );
        self.used_bytes += bytes;
        self.evict(wanted);
        true
    }

    /// `request` for `page` failed. The rows show the error while they're
    /// in view; once they aren't, [`PageCache::plan`] forgets the failure, so
    /// coming back retries the page.
    ///
    /// With `live`, a failed re-read keeps the old page drawn, still stale,
    /// and isn't read again until its rows are invalidated again or
    /// [`PageCache::forget_failed`].
    pub fn failed(&mut self, page: u64, request: R, message: String) {
        self.finished(request);
        #[cfg(feature = "live")]
        if let Some(Slot::Loaded { live, .. }) = self.slots.get_mut(&page) {
            if live.reading.is_some_and(|(read, _)| read == request) {
                live.reading = None;
                live.stale = true;
                live.failed = true;
            }
            return;
        }
        if matches!(self.slots.get(&page), Some(Slot::Loading { request: r, .. }) if *r == request)
        {
            self.slots.insert(page, Slot::Failed(message));
        }
    }

    /// Whether any page's read failed (and the failure isn't forgotten).
    pub fn has_failed(&self) -> bool {
        self.slots.values().any(|slot| match slot {
            Slot::Failed(_) => true,
            #[cfg(feature = "live")]
            Slot::Loaded { live, .. } => live.failed,
            _ => false,
        })
    }

    /// Forgets every failure, so the next [`PageCache::plan`] fetches those
    /// pages again if they're wanted. Returns whether there were any.
    pub fn forget_failed(&mut self) -> bool {
        let before = self.slots.len();
        #[cfg(feature = "live")]
        let mut rereads = false;
        #[cfg(feature = "live")]
        for slot in self.slots.values_mut() {
            if let Slot::Loaded { live, .. } = slot {
                rereads |= std::mem::take(&mut live.failed);
            }
        }
        self.slots
            .retain(|_, slot| !matches!(slot, Slot::Failed(_)));
        #[cfg(feature = "live")]
        if rereads {
            return true;
        }
        self.slots.len() != before
    }

    /// `rows` changed in the source (`live`): their pages that are loaded
    /// or loading go stale, and [`PageCache::plan`] reads the wanted ones
    /// again. Returns this invalidation's generation, which grows with each.
    #[cfg(feature = "live")]
    pub fn invalidate(&mut self, rows: Range<u64>) -> u64 {
        self.generation += 1;
        if rows.start < rows.end {
            let pages = rows.start / self.page_rows..=(rows.end - 1) / self.page_rows;
            for (page, slot) in &mut self.slots {
                if !pages.contains(page) {
                    continue;
                }
                match slot {
                    Slot::Loading { stale, .. } => *stale = true,
                    Slot::Loaded { live, .. } => {
                        live.stale = true;
                        live.failed = false;
                    }
                    Slot::Failed(_) => {}
                }
            }
        }
        self.generation
    }

    /// The re-reads that landed since the last call, each once: those whose
    /// pages touch the `visible` rows, as (the page's rows, the generation
    /// its read started at), in page order. The others are dropped: a page
    /// re-read off screen reports nothing, then or later.
    #[cfg(feature = "live")]
    pub fn take_refreshed(&mut self, visible: Range<u64>) -> Vec<(Range<u64>, u64)> {
        if !std::mem::take(&mut self.landed) {
            return Vec::new();
        }
        let mut refreshed: Vec<(u64, u64)> = Vec::new();
        for (page, slot) in &mut self.slots {
            if let Slot::Loaded { live, .. } = slot
                && let Some(generation) = live.landed.take()
            {
                refreshed.push((*page, generation));
            }
        }
        refreshed.sort_unstable();
        refreshed
            .into_iter()
            .map(|(page, generation)| (self.rows_of(page), generation))
            .filter(|(rows, _)| rows.start < visible.end && visible.start < rows.end)
            .collect()
    }

    /// Re-reads in flight (`live`).
    #[cfg(feature = "live")]
    fn rereading(&self) -> usize {
        self.slots
            .values()
            .filter(|slot| matches!(slot, Slot::Loaded { live, .. } if live.reading.is_some()))
            .count()
    }

    #[cfg(feature = "live")]
    fn control(&self) -> Control {
        #[cfg(test)]
        return self.control;
        #[cfg(not(test))]
        Control
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
                    // A page being read again stays until its read lands or
                    // `plan` cancels it: its read counts in flight.
                    #[cfg(feature = "live")]
                    Slot::Loaded { live, .. } if live.reading.is_some() => None,
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
    fn forgotten_failures_load_again_in_view() {
        let mut cache: Cache = PageCache::new(10_000, 1000, 1 << 20, 3);
        let plan = cache.plan(&[0], 1);
        assert_eq!(plan.fetch, vec![0]);
        cache.started(0, 1);
        cache.failed(0, 1, "network".into());
        assert!(cache.plan(&[0], 1).fetch.is_empty());
        assert!(cache.has_failed());
        assert!(cache.forget_failed());
        assert!(!cache.has_failed());
        assert!(!cache.forget_failed());
        assert_eq!(cache.plan(&[0], 1).fetch, vec![0]);
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

    /// A cache with pages 0..`pages` loaded, nothing in flight.
    #[cfg(feature = "live")]
    fn loaded_cache(pages: u64, max_in_flight: usize) -> Cache {
        let mut cache = Cache::new(100_000, 100, 1 << 20, max_in_flight);
        for page in 0..pages {
            cache.started(page, 1000 + page as u32);
            assert!(cache.loaded(page, 1000 + page as u32, "old", 10, &[]));
        }
        cache
    }

    #[cfg(feature = "live")]
    #[test]
    fn a_stale_page_draws_until_its_read_lands() {
        let mut cache = loaded_cache(1, 3);
        let generation = cache.invalidate(10..11);
        assert_eq!(generation, 1);
        assert_eq!(cache.invalidate(10..11), 2, "each call a new generation");
        // Still drawn, stale: re-read now.
        assert_eq!(cache.row(10), RowState::Loaded(&"old", 10));
        assert_eq!(cache.plan(&[0], 1).fetch, vec![0]);
        cache.started(0, 1);
        assert_eq!(cache.row(10), RowState::Loaded(&"old", 10));
        assert_eq!((cache.in_flight(), cache.used_bytes()), (1, 10));
        assert!(cache.plan(&[0], 1).fetch.is_empty(), "one read per page");
        assert!(cache.loaded(0, 1, "new", 12, &[0]));
        assert_eq!(cache.row(10), RowState::Loaded(&"new", 10));
        // The bytes swapped, not added.
        assert_eq!((cache.in_flight(), cache.used_bytes()), (0, 12));
        assert_eq!(cache.take_refreshed(0..30), vec![(0..100, 2)]);
        assert!(cache.take_refreshed(0..30).is_empty(), "taken once");
    }

    #[cfg(feature = "live")]
    #[test]
    fn invalidated_during_a_read_reads_once_more() {
        // During a re-read: ten invalidations, one more read, none cancelled.
        let mut cache = loaded_cache(1, 3);
        cache.invalidate(0..1);
        assert_eq!(cache.plan(&[0], 1).fetch, vec![0]);
        cache.started(0, 1);
        for _ in 0..10 {
            cache.invalidate(0..100);
            let plan = cache.plan(&[0], 1);
            assert_eq!(
                plan,
                Plan {
                    fetch: vec![],
                    cancel: vec![]
                }
            );
        }
        assert!(cache.loaded(0, 1, "newer", 10, &[0]));
        assert_eq!(
            cache.row(0),
            RowState::Loaded(&"newer", 0),
            "drawn meanwhile"
        );
        assert_eq!(cache.plan(&[0], 1).fetch, vec![0]);
        cache.started(0, 2);
        assert!(cache.loaded(0, 2, "newest", 10, &[0]));
        assert!(cache.plan(&[0], 1).fetch.is_empty());
        // Its two reads started at generations 1 and 11; only the last is
        // left to report.
        assert_eq!(cache.take_refreshed(0..30), vec![(0..100, 11)]);

        // During a first read: stale when it lands, so read again.
        let mut cache = Cache::new(100_000, 100, 1 << 20, 3);
        assert_eq!(cache.plan(&[0], 1).fetch, vec![0]);
        cache.started(0, 1);
        cache.invalidate(50..60);
        assert!(cache.plan(&[0], 1).fetch.is_empty(), "not cancelled");
        assert!(cache.loaded(0, 1, "first", 10, &[0]));
        assert_eq!(cache.row(50), RowState::Loaded(&"first", 50));
        assert_eq!(cache.plan(&[0], 1).fetch, vec![0]);
        // A first read reports no refresh.
        assert!(cache.take_refreshed(0..30).is_empty());
    }

    #[cfg(feature = "live")]
    #[test]
    fn rereads_leave_a_place_for_a_page_with_nothing_to_show() {
        let mut cache = loaded_cache(3, 3);
        cache.invalidate(0..300);
        // Three visible pages changed: two re-reads, the third waits.
        let plan = cache.plan(&[0, 1, 2], 3);
        assert_eq!(plan.fetch, vec![0, 1]);
        cache.started(0, 10);
        cache.started(1, 11);
        assert_eq!(cache.in_flight(), 2);
        assert!(cache.plan(&[0, 1, 2], 3).fetch.is_empty());
        // Scrolled: page 3 comes into view and starts at once.
        assert_eq!(cache.plan(&[1, 2, 3, 0], 3).fetch, vec![3]);
        cache.started(3, 13);
        assert_eq!(cache.in_flight(), 3, "never past max_in_flight");
        assert!(cache.plan(&[1, 2, 3, 0], 3).fetch.is_empty());
        // One limit even at a single read in flight: one re-read.
        let mut cache = loaded_cache(1, 1);
        cache.invalidate(0..1);
        assert_eq!(cache.plan(&[0], 1).fetch, vec![0]);
    }

    #[cfg(feature = "live")]
    #[test]
    fn a_missing_visible_page_goes_first_then_rereads_then_prefetch() {
        let mut cache = loaded_cache(3, 3);
        cache.invalidate(0..100);
        cache.invalidate(200..300);
        // Visible 5 (missing) and 0 (stale); prefetch 1, 2 (stale), 6.
        let plan = cache.plan(&[0, 5, 1, 2, 6], 2);
        assert_eq!(
            plan.fetch,
            vec![5, 0],
            "nothing to show first, then the stale visible page"
        );
        cache.started(5, 15);
        cache.started(0, 10);
        // While page 5 loads, no prefetch: page 2's re-read waits too.
        assert!(cache.plan(&[0, 5, 1, 2, 6], 2).fetch.is_empty());
        assert!(cache.loaded(5, 15, "p", 10, &[0, 5, 1, 2, 6]));
        // A stale page doesn't hold prefetch back, and is read in `wanted`'s
        // order with it: page 2 before page 6.
        assert_eq!(cache.plan(&[0, 5, 1, 2, 6], 2).fetch, vec![2, 6]);
        // Visible stale before a prefetch page.
        let mut cache = loaded_cache(2, 3);
        cache.invalidate(100..200);
        assert_eq!(cache.plan(&[1, 0, 2], 1).fetch, vec![1, 2]);
    }

    #[cfg(feature = "live")]
    #[test]
    fn a_failed_reread_keeps_the_old_rows() {
        let mut cache = loaded_cache(1, 3);
        cache.invalidate(0..1);
        cache.plan(&[0], 1);
        cache.started(0, 1);
        cache.failed(0, 1, "network".into());
        assert_eq!(cache.row(0), RowState::Loaded(&"old", 0));
        assert!(cache.has_failed());
        assert!(cache.plan(&[0], 1).fetch.is_empty(), "not hammered");
        assert_eq!(cache.in_flight(), 0);
        // The next invalidation reads it again.
        cache.invalidate(0..1);
        assert!(!cache.has_failed());
        assert_eq!(cache.plan(&[0], 1).fetch, vec![0]);
        cache.started(0, 2);
        cache.failed(0, 2, "network".into());
        // And so does `retry_failed`'s forgetting.
        assert!(cache.forget_failed());
        assert!(!cache.forget_failed());
        assert_eq!(cache.plan(&[0], 1).fetch, vec![0]);
        assert_eq!(cache.used_bytes(), 10);
    }

    #[cfg(feature = "live")]
    #[test]
    fn a_stale_page_nobody_wants_is_dropped() {
        let mut cache = loaded_cache(3, 3);
        cache.invalidate(0..300);
        // Page 0 is wanted, so it's read again; 1 and 2 aren't: dropped.
        assert_eq!(cache.plan(&[0], 1).fetch, vec![0]);
        assert_eq!((cache.loaded_pages(), cache.used_bytes()), (1, 10));
        assert_eq!(cache.row(150), RowState::Pending);
        // A re-read in flight for a page that leaves `wanted` is cancelled,
        // and its page dropped; it drains until it answers.
        cache.started(0, 1);
        let plan = cache.plan(&[9], 1);
        assert_eq!(
            plan,
            Plan {
                fetch: vec![9],
                cancel: vec![1]
            }
        );
        assert_eq!(
            (cache.loaded_pages(), cache.used_bytes(), cache.draining()),
            (0, 0, 1)
        );
        assert!(!cache.loaded(0, 1, "late", 10, &[9]));
        assert_eq!(cache.draining(), 0);
        // Back to page 0: a first read, placeholders until it lands.
        cache.started(9, 9);
        assert_eq!(
            cache.plan(&[0], 1),
            Plan {
                fetch: vec![0],
                cancel: vec![9]
            }
        );
        // A page that isn't stale stays cached for later, as without `live`.
        let mut cache = loaded_cache(2, 3);
        cache.plan(&[5], 1);
        assert_eq!(cache.loaded_pages(), 2);
    }

    #[cfg(feature = "live")]
    #[test]
    fn rereads_count_in_flight_and_close_cancels_them() {
        let mut cache = loaded_cache(2, 3);
        cache.invalidate(0..200);
        assert_eq!(cache.plan(&[0, 1], 2).fetch, vec![0, 1]);
        cache.started(0, 10);
        cache.started(1, 11);
        let mut requests: Vec<u32> = cache.requests().collect();
        requests.sort();
        assert_eq!(requests, vec![10, 11]);
        assert_eq!(
            (cache.in_flight(), cache.loaded_pages(), cache.used_bytes()),
            (2, 2, 20)
        );
        // Not evicted while read again, over budget or not.
        let mut cache = Cache::new(100_000, 100, 15, 3);
        cache.started(0, 0);
        cache.loaded(0, 0, "a", 10, &[]);
        cache.invalidate(0..1);
        cache.plan(&[0], 1);
        cache.started(0, 1);
        cache.started(5, 5);
        assert!(cache.loaded(5, 5, "b", 10, &[]));
        assert_eq!(cache.row(0), RowState::Loaded(&"a", 0));
        // A short last page being read again goes with `set_rows`.
        let mut cache = Cache::new(150, 100, 1 << 20, 3);
        cache.started(1, 1);
        cache.loaded(1, 1, "short", 10, &[]);
        cache.invalidate(100..150);
        cache.plan(&[1], 1);
        cache.started(1, 2);
        assert_eq!(cache.set_rows(250), Some(2));
        assert_eq!(
            (cache.in_flight(), cache.draining(), cache.used_bytes()),
            (0, 1, 0)
        );
    }

    #[cfg(feature = "live")]
    #[test]
    fn refreshes_are_reported_only_on_screen() {
        let mut cache = loaded_cache(3, 3);
        cache.invalidate(0..300);
        cache.plan(&[0, 1, 2], 1);
        cache.started(0, 10);
        cache.started(1, 11);
        assert!(cache.loaded(0, 10, "p", 10, &[0, 1, 2]));
        assert!(cache.loaded(1, 11, "p", 10, &[0, 1, 2]));
        // Rows 50..80 show page 0 only: page 1's refresh is dropped.
        assert_eq!(cache.take_refreshed(50..80), vec![(0..100, 1)]);
        assert!(
            cache.take_refreshed(100..130).is_empty(),
            "nor reported later"
        );
        // Invalidating rows nobody has loaded changes nothing.
        let mut cache = Cache::new(1000, 100, 1 << 20, 3);
        cache.invalidate(0..1000);
        assert_eq!(cache.plan(&[0], 1).fetch, vec![0]);
        cache.invalidate(5..5);
        assert_eq!(cache.invalidate(5..5), 3, "an empty range still counts");
    }
}
