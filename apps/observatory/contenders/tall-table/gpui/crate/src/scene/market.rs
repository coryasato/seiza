//! Market watch's level (`contenders/scenarios.ts`'s `MARKET_WATCH`): the
//! instruments' file opened through the engine, then every re-read
//! answered from the feed's store in hand (`crate::market::Quotes`), drawn
//! as the design canvas draws it: the prices at each instrument's
//! decimals, Change and Change % in the rise or the fall by sign, and
//! Last, Bid, and Ask flashing as they change. Every color, the flash's
//! settings, and the decimals come in from the JS host (the scenario's and
//! `feed.ts`'s), so nothing here is a copy of them.

use std::borrow::Cow;
use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;
use std::sync::OnceLock;
use std::time::Duration;

use gpui_kit::component::Theme;
use gpui_kit::{App, Hsla};
use seiza_tall_table::{
    CellPaint, CellValue, Domain, NumberFormat, PageError, PageLoad, Ramp, Sign, TallTableColumn,
    TallTableDelegate, TallTablePage,
};

use crate::market::{Batch, BatchError, Quote, Quotes};

/// The table's columns, in the file's order (`data/prep-market.sql`, the
/// file's one home): the open fails on any other.
pub const COLUMNS: [&str; 12] = [
    "Symbol", "Name", "Last", "Change", "Change %", "Bid", "Ask", "Bid size", "Ask size", "Volume",
    "High", "Low",
];
const LAST: usize = 2;
const CHANGE: usize = 3;
const CHANGE_PCT: usize = 4;
const BID: usize = 5;
const ASK: usize = 6;
const BID_SIZE: usize = 7;
const ASK_SIZE: usize = 8;
const VOLUME: usize = 9;
const HIGH: usize = 10;
const LOW: usize = 11;

/// The columns written at an instrument's decimals.
const PRICED: [usize; 6] = [LAST, CHANGE, BID, ASK, HIGH, LOW];

/// Change and Change % by sign: a fall at 0, a zero at 0.5, a rise at 1.
/// The width only keeps a zero exact: every change is a whole tick.
const SIGN_DOMAIN: f64 = 1e-9;

/// Change %'s decimals (the canvas's "+1.23%").
const PCT_DECIMALS: u8 = 2;

/// The numbers the JS host hands in before the instruments' decimals:
/// the flash's ms and mix, then the rise and the fall in Oklch, light then
/// dark (`web/src/market.ts` writes them).
const HEAD: usize = 2 + 4 * 3;

/// The scene's settings at the market level.
#[derive(Debug, Clone, PartialEq)]
pub struct Market {
    /// How long a flash fades.
    pub flash: Duration,
    /// The flash's share of the rise or the fall over the cell.
    pub mix: f32,
    /// In Oklch, `[l, c, h]`: the light theme's rise and fall, the dark's.
    pub signs: [[f32; 3]; 4],
    /// Each instrument's decimals, in the feed's order: a row per
    /// instrument.
    pub decimals: Rc<[u8]>,
    /// The columns that flash, by index into [`COLUMNS`].
    pub flashing: Vec<usize>,
}

impl Market {
    /// From the JS host's numbers (`[flash ms, mix, rise and fall light,
    /// rise and fall dark (each l, c, h), …each instrument's decimals]`)
    /// and the flashing columns' names. Anything else is an error the host
    /// shows.
    pub fn new(level: &[f64], flash: &[String]) -> Result<Self, String> {
        if level.len() <= HEAD {
            return Err(format!(
                "the market level takes {HEAD} numbers and the instruments' decimals, not {}",
                level.len()
            ));
        }
        let (head, decimals) = level.split_at(HEAD);
        let (ms, mix) = (head[0], head[1]);
        if !(ms > 0.0 && ms.is_finite() && mix > 0.0 && mix <= 1.0) {
            return Err(format!(
                "the flash's ms and mix are out of range: {ms}, {mix}"
            ));
        }
        let mut signs = [[0.0; 3]; 4];
        for (sign, lch) in signs.iter_mut().zip(head[2..].as_chunks::<3>().0) {
            let &[l, c, h] = lch;
            if !((0.0..=1.0).contains(&l) && c >= 0.0 && h.is_finite()) {
                return Err(format!("a sign's color is out of range: {lch:?}"));
            }
            *sign = [l as f32, c as f32, h as f32];
        }
        let decimals = decimals
            .iter()
            .map(|&d| {
                (d.fract() == 0.0 && (0.0..=6.0).contains(&d))
                    .then_some(d as u8)
                    .ok_or_else(|| format!("an instrument's decimals are out of range: {d}"))
            })
            .collect::<Result<Rc<[u8]>, _>>()?;
        let flashing = flash
            .iter()
            .map(|name| {
                COLUMNS
                    .iter()
                    .position(|column| column == name)
                    .ok_or_else(|| format!("no column {name:?} to flash"))
            })
            .collect::<Result<_, _>>()?;
        Ok(Self {
            flash: Duration::from_secs_f64(ms / 1000.0),
            mix: mix as f32,
            signs,
            decimals,
            flashing,
        })
    }

    /// The colors each theme draws, once: the stops are `fn` pointers and
    /// capture nothing, so they read them from here.
    fn install(&self) {
        COLORS.get_or_init(|| {
            let [light_up, light_down, dark_up, dark_down] = self.signs.map(crate::scene::oklch);
            let flash = |color: Hsla| Hsla {
                a: self.mix,
                ..color
            };
            Colors {
                signs: [[light_down, light_up], [dark_down, dark_up]],
                flash: [
                    [flash(light_down), flash(light_up)],
                    [flash(dark_down), flash(dark_up)],
                ],
            }
        });
    }
}

/// The file's columns, as the open read them, are the table's
/// ([`COLUMNS`]), a row per instrument.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens the file")
)]
pub fn check(
    columns: &[seiza_duckdb::sql::ColumnInfo],
    rows: u64,
    market: &Market,
) -> Result<(), String> {
    let names: Vec<&str> = columns.iter().map(|info| info.name.as_str()).collect();
    if names != COLUMNS {
        return Err(format!("its columns are {names:?}, not market watch's"));
    }
    if rows != market.decimals.len() as u64 {
        return Err(format!(
            "it has {rows} rows, but the feed has {} instruments",
            market.decimals.len()
        ));
    }
    Ok(())
}

/// The rise and the fall, as drawn: `[theme][fall, rise]`, light then dark.
struct Colors {
    signs: [[Hsla; 2]; 2],
    flash: [[Hsla; 2]; 2],
}

static COLORS: OnceLock<Colors> = OnceLock::new();

fn colors() -> &'static Colors {
    COLORS
        .get()
        .expect("the market's colors are installed with its columns")
}

fn sign(theme: &Theme, rise: bool) -> Hsla {
    colors().signs[usize::from(theme.is_dark())][usize::from(rise)]
}

fn flash(theme: &Theme, rise: bool) -> Hsla {
    colors().flash[usize::from(theme.is_dark())][usize::from(rise)]
}

/// The text by sign: the fall, the foreground, the rise.
fn sign_ramp() -> Ramp {
    Ramp::new(&[
        |theme| sign(theme, false),
        |theme| theme.foreground,
        |theme| sign(theme, true),
    ])
}

/// The flash: a fall at 0, a rise at 1 (any other change between them),
/// each at the scenario's mix.
fn flash_ramp() -> Ramp {
    Ramp::new(&[|theme| flash(theme, false), |theme| flash(theme, true)])
}

/// The table's columns, from the summary's, as the canvas writes them.
pub fn columns(columns: Vec<TallTableColumn>, market: &Market) -> Vec<TallTableColumn> {
    market.install();
    columns
        .into_iter()
        .enumerate()
        .map(|(index, column)| {
            let column = match index {
                LAST | BID | ASK | HIGH | LOW => column.format(NumberFormat::new().decimals(2)),
                CHANGE => column
                    .format(NumberFormat::new().decimals(2).sign(Sign::Always))
                    .text_ramp(sign_ramp()),
                CHANGE_PCT => column
                    .format(
                        NumberFormat::new()
                            .decimals(PCT_DECIMALS)
                            .sign(Sign::Always)
                            .suffix("%"),
                    )
                    .text_ramp(sign_ramp()),
                BID_SIZE | ASK_SIZE | VOLUME => column.format(NumberFormat::new().grouping(true)),
                _ => column,
            };
            if market.flashing.contains(&index) {
                column.flash(flash_ramp(), market.flash)
            } else {
                column
            }
        })
        .collect()
}

/// The store and the page the open read, shared by the source (inside the
/// table) and the host (which folds the feed into it).
pub struct Store<P> {
    quotes: RefCell<Option<Quotes>>,
    /// The first page the open read: its symbols and names are every
    /// re-read's.
    opened: RefCell<Option<Rc<P>>>,
}

#[cfg_attr(
    not(any(target_family = "wasm", test)),
    expect(dead_code, reason = "only the web build opens the file")
)]
impl<P: TallTablePage> Store<P> {
    fn new() -> Self {
        Self {
            quotes: RefCell::new(None),
            opened: RefCell::new(None),
        }
    }

    /// The open's first page landed: the store starts from its Last.
    fn opened(&self, page: &Rc<P>, rows: usize) {
        if self.opened.borrow().is_some() {
            return;
        }
        let prices: Option<Vec<f64>> = (0..rows)
            .map(|row| match page.value(row, LAST) {
                Some(CellValue::Float(price)) => Some(price),
                _ => None,
            })
            .collect();
        // A file whose Last isn't every row's float leaves the store empty:
        // the host fails the feed's start.
        if let Some(prices) = prices {
            *self.quotes.borrow_mut() = Some(Quotes::new(prices));
            *self.opened.borrow_mut() = Some(page.clone());
        }
    }

    /// Whether the open's page has seeded the store.
    pub fn seeded(&self) -> bool {
        self.quotes.borrow().is_some()
    }

    /// Folds `batch` into the store, every tick or none; the instruments it
    /// ticked come back marked (a store not yet seeded refuses it whole).
    pub fn fold(&self, batch: &[u8]) -> Result<(Batch, Vec<bool>), BatchError> {
        let mut quotes = self.quotes.borrow_mut();
        let quotes = quotes.as_mut().ok_or(BatchError::NotOpen)?;
        let folded = quotes.fold(batch)?;
        let ticked = crate::market::ticked(batch, quotes.rows().len());
        Ok((folded, ticked))
    }
}

/// A read: the engine's (the open), or one answered from the store.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MarketRequest<R> {
    Read(R),
    InHand(u64),
}

/// The table's source: the engine's rows until the open's page lands,
/// then the store's.
pub struct MarketRows<D: TallTableDelegate> {
    rows: D,
    store: Rc<Store<D::Page>>,
    decimals: Rc<[u8]>,
    /// The next in-hand read's id.
    next: u64,
}

#[cfg_attr(
    not(any(target_family = "wasm", test)),
    expect(dead_code, reason = "only the web build opens the file")
)]
impl<D: TallTableDelegate> MarketRows<D> {
    pub fn new(rows: D, market: &Market) -> Self {
        Self {
            rows,
            store: Rc::new(Store::new()),
            decimals: market.decimals.clone(),
            next: 0,
        }
    }

    pub fn store(&self) -> &Rc<Store<D::Page>> {
        &self.store
    }
}

impl<D: TallTableDelegate> TallTableDelegate for MarketRows<D> {
    type Page = MarketPage<D::Page>;
    type Request = MarketRequest<D::Request>;

    fn load_page(
        &mut self,
        rows: Range<u64>,
        cx: &mut App,
    ) -> (Self::Request, PageLoad<Self::Page>) {
        let decimals = self.decimals.clone();
        let first = rows.start as usize;
        // Once seeded, every read is the store's, in hand: ready as it's
        // returned, so it lands in the table's turn (`live`).
        let in_hand = {
            let quotes = self.store.quotes.borrow();
            let opened = self.store.opened.borrow();
            quotes
                .as_ref()
                .zip(opened.as_ref())
                .map(|(quotes, opened)| {
                    let all = quotes.rows();
                    let end = (rows.end as usize).min(all.len());
                    MarketPage {
                        opened: opened.clone(),
                        start: first,
                        first,
                        quotes: Some(all[first.min(end)..end].to_vec()),
                        decimals: decimals.clone(),
                    }
                })
        };
        if let Some(page) = in_hand {
            let id = self.next;
            self.next += 1;
            return (
                MarketRequest::InHand(id),
                Box::pin(std::future::ready(Ok(page))),
            );
        }
        let (request, load) = self.rows.load_page(rows.clone(), cx);
        let store = self.store.clone();
        (
            MarketRequest::Read(request),
            Box::pin(async move {
                let page = Rc::new(load.await?);
                if first == 0 {
                    store.opened(&page, (rows.end - rows.start) as usize);
                }
                Ok::<_, PageError>(MarketPage {
                    opened: page,
                    start: 0,
                    first,
                    quotes: None,
                    decimals,
                })
            }),
        )
    }

    fn cancel(&mut self, request: Self::Request, cx: &mut App) {
        // A read in hand resolved as it was returned: nothing to cancel.
        if let MarketRequest::Read(request) = request {
            self.rows.cancel(request, cx);
        }
    }
}

/// A page: the open's rows, or the store's quotes over them.
pub struct MarketPage<P> {
    /// The page the open read, whose symbols and names are every page's.
    opened: Rc<P>,
    /// This page's first row in `opened`.
    start: usize,
    /// This page's first row: its instrument's index.
    first: usize,
    /// The store's quotes for its rows, or `None` for the open's own.
    quotes: Option<Vec<Quote>>,
    decimals: Rc<[u8]>,
}

impl<P: TallTablePage> MarketPage<P> {
    fn float(&self, row: usize, column: usize) -> Option<f64> {
        match self.value(row, column)? {
            CellValue::Float(value) => Some(value),
            _ => None,
        }
    }
}

impl<P: TallTablePage> TallTablePage for MarketPage<P> {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        let Some(quotes) = &self.quotes else {
            return self.opened.value(self.start + row, column);
        };
        let quote = quotes.get(row)?;
        let int = |value: u64| Some(CellValue::Text(Cow::Owned(value.to_string())));
        match column {
            LAST => Some(CellValue::Float(quote.last)),
            CHANGE => Some(CellValue::Float(quote.change)),
            CHANGE_PCT => Some(CellValue::Float(quote.change_pct)),
            BID => Some(CellValue::Float(quote.bid)),
            ASK => Some(CellValue::Float(quote.ask)),
            BID_SIZE => int(quote.bid_size.into()),
            ASK_SIZE => int(quote.ask_size.into()),
            VOLUME => int(quote.volume),
            HIGH => Some(CellValue::Float(quote.high)),
            LOW => Some(CellValue::Float(quote.low)),
            _ => self.opened.value(self.start + row, column),
        }
    }

    fn paint(&self, row: usize, column: usize) -> CellPaint {
        let mut paint = CellPaint::default();
        if matches!(column, CHANGE | CHANGE_PCT)
            && let Some(change) = self.float(row, column)
        {
            paint.text = Some(Domain::new(-SIGN_DOMAIN, SIGN_DOMAIN).mid(0.0).unit(change));
        }
        paint
    }

    fn decimals(&self, row: usize, column: usize) -> Option<u8> {
        PRICED
            .contains(&column)
            .then(|| self.decimals.get(self.first + row).copied())
            .flatten()
    }

    /// The open's page counts its Arrow bytes; a page from the store its
    /// quotes alone (the open's page it reads names from is counted once,
    /// as the open's, not again with each re-read).
    fn heap_bytes(&self) -> usize {
        match &self.quotes {
            None => self.opened.heap_bytes(),
            Some(quotes) => quotes.len() * size_of::<Quote>(),
        }
    }
}

#[cfg(test)]
mod tests {
    //! The source: the open's read is the engine's, every read after the
    //! store's, in hand; and what the level's numbers take.

    use std::borrow::Cow;
    use std::ops::Range;
    use std::task::{Context, Poll, Waker};

    use gpui_kit::{App, TestAppContext};
    use seiza_tall_table::{CellValue, PageLoad, TallTableDelegate, TallTablePage};

    use super::{COLUMNS, Market, MarketRequest, MarketRows};
    use crate::market::{HEADER, TICK};

    /// The file's three instruments at the open, as the engine reads them.
    struct File {
        reads: Vec<Range<u64>>,
    }

    struct FilePage(Range<u64>);

    const PRICES: [f64; 3] = [84.2, 9.42, 112.4];

    impl TallTablePage for FilePage {
        fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
            let at = self.0.start as usize + row;
            let price = *PRICES.get(at)?;
            Some(match column {
                0 => CellValue::Text(Cow::Owned(format!("S{at}"))),
                1 => CellValue::Text(Cow::Owned(format!("Name {at}"))),
                2 | 5 | 6 | 10 | 11 => CellValue::Float(price),
                3 | 4 => CellValue::Float(0.0),
                _ => CellValue::Text(Cow::Borrowed("0")),
            })
        }

        fn heap_bytes(&self) -> usize {
            0
        }
    }

    impl TallTableDelegate for File {
        type Page = FilePage;
        type Request = usize;

        fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (usize, PageLoad<FilePage>) {
            self.reads.push(rows.clone());
            (
                self.reads.len(),
                Box::pin(std::future::ready(Ok(FilePage(rows)))),
            )
        }

        fn cancel(&mut self, _: usize, _: &mut App) {}
    }

    fn market() -> Market {
        let mut level = vec![400.0, 0.3];
        for _ in 0..4 {
            level.extend([0.6, 0.15, 149.0]);
        }
        level.extend([2.0, 3.0, 2.0]);
        Market::new(&level, &["Last".into(), "Bid".into(), "Ask".into()]).unwrap()
    }

    fn ready<T>(load: PageLoad<T>) -> T {
        let mut load = load;
        match load.as_mut().poll(&mut Context::from_waker(Waker::noop())) {
            Poll::Ready(page) => page.expect("a page"),
            Poll::Pending => panic!("not ready"),
        }
    }

    /// A batch of `ticks` (instrument, last), the rest of each tick 0.
    fn batch(ticks: &[(u16, f64)]) -> Vec<u8> {
        let mut bytes = vec![0; HEADER + ticks.len() * TICK];
        bytes[4..8].copy_from_slice(&(ticks.len() as u32).to_le_bytes());
        for (i, (instrument, last)) in ticks.iter().enumerate() {
            let o = HEADER + i * TICK;
            bytes[o..o + 2].copy_from_slice(&instrument.to_le_bytes());
            for at in [16, 24, 32] {
                bytes[o + at..o + at + 8].copy_from_slice(&last.to_le_bytes());
            }
        }
        bytes
    }

    #[gpui_kit::test]
    fn the_open_is_the_engines_and_every_read_after_it_the_stores(cx: &mut TestAppContext) {
        let mut rows = MarketRows::new(File { reads: vec![] }, &market());
        let store = rows.store().clone();
        assert!(!store.seeded());
        assert!(
            store.fold(&batch(&[(0, 84.21)])).is_err(),
            "a batch before the open"
        );

        let (request, load) = cx.update(|cx| rows.load_page(0..3, cx));
        assert_eq!(request, MarketRequest::Read(1));
        let opened = ready(load);
        assert!(store.seeded(), "seeded from the open's Last");
        assert_eq!(opened.value(0, 2), Some(CellValue::Float(84.2)));

        let (folded, ticked) = store.fold(&batch(&[(0, 84.21), (2, 112.3)])).unwrap();
        assert_eq!(folded.count, 2);
        assert_eq!(ticked, [true, false, true]);

        let (request, load) = cx.update(|cx| rows.load_page(0..3, cx));
        assert_eq!(request, MarketRequest::InHand(0), "answered from the store");
        assert_eq!(rows.rows.reads, vec![0..3], "the engine read once");
        let page = ready(load);
        assert_eq!(
            page.value(0, 0),
            Some(CellValue::Text(Cow::Owned("S0".into())))
        );
        assert_eq!(page.value(0, 2), Some(CellValue::Float(84.21)));
        assert_eq!(page.value(1, 2), Some(CellValue::Float(9.42)));
        assert_eq!(page.value(2, 2), Some(CellValue::Float(112.3)));
        assert_eq!(page.value(3, 2), None, "past the rows");
        assert_eq!(page.decimals(1, 2), Some(3), "the instrument's");
        assert_eq!(page.decimals(1, 4), None, "Change % keeps its column's");
        // A rise, a fall, and no change.
        let at = |row| page.paint(row, 3).text.unwrap();
        assert!(at(0) == 1.0 && at(2) == 0.0 && at(1) == 0.5);
        assert_eq!(
            page.value(0, 9),
            Some(CellValue::Text(Cow::Owned("0".into())))
        );
    }

    #[test]
    fn the_level_takes_its_numbers_or_fails() {
        let market = market();
        assert_eq!(market.flashing, [2, 5, 6]);
        assert_eq!(&*market.decimals, [2, 3, 2]);
        assert_eq!(market.flash.as_millis(), 400);
        assert!(Market::new(&[400.0, 0.3], &[]).is_err(), "no decimals");
        let mut level = vec![400.0, 0.3];
        level.extend([0.6, 0.15, 149.0].repeat(4));
        level.push(2.5);
        assert!(
            Market::new(&level, &[]).is_err(),
            "a decimals count that isn't whole"
        );
        level.pop();
        level.push(2.0);
        assert!(
            Market::new(&level, &["Volume?".into()]).is_err(),
            "no such column"
        );
        assert!(Market::new(&level, &[COLUMNS[2].into()]).is_ok());
        level[1] = 0.0;
        assert!(Market::new(&level, &[]).is_err(), "no mix");
    }
}
