//! The monitoring wall's level (`contenders/scenarios.ts`'s
//! `MONITORING_WALL`): the stop's N desks of 50 instruments, one table
//! each, over one store (`crate::market::Quotes`) that the open's read of
//! the wall's file seeds and the feed then moves. Each table draws four of
//! the file's columns as the design canvas does (Symbol, Last at the
//! instrument's decimals and flashing, Chg % signed at 2 with `%` in the
//! rise or the fall by sign, Volume grouped) at the grid's widths, rows,
//! and text. The grid, the stop's tables, the colors, the flash, and the
//! decimals all come in from the JS host (`web/src/wall.ts`: the
//! scenario's and `feed.ts`'s), market watch's through its own
//! [`Market`], so nothing here is a copy of them.

use std::borrow::Cow;
use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

use gpui_kit::{App, SharedString, px};
use seiza_tall_table::{
    CellPaint, CellValue, Domain, NumberFormat, PageLoad, Sign, TallTableColumn, TallTableDelegate,
    TallTablePage,
};

use super::market::{self, Market};
use crate::market::{Batch, BatchError, Quote, Quotes};

/// The file's columns, in its order (`data/prep-wall.sql`, the file's one
/// home): the open fails on any other.
pub const COLUMNS: [&str; 5] = ["Desk", "Symbol", "Last", "Change %", "Volume"];
/// The file's columns a table draws, in order, each with its header as the
/// design canvas writes it.
const DRAWN: [(usize, &str); 4] = [(1, "Symbol"), (2, "Last"), (3, "Chg %"), (4, "Volume")];
const FILE_SYMBOL: usize = 1;
const FILE_LAST: usize = 2;
/// A table's columns.
const SYMBOL: usize = 0;
const LAST: usize = 1;
const CHANGE_PCT: usize = 2;
const VOLUME: usize = 3;

/// A desk's rows: one table, one page of the table's
/// (`contenders/wall/desks.ts`'s `DESK_ROWS`).
pub const DESK_ROWS: usize = 50;
/// The most desks a stop shows: a batch's visible mask is a bit a table.
pub const MOST_TABLES: usize = 8;

/// The numbers the JS host hands in before market watch's ([`Market::new`]'s):
/// the tables, the file's rows, then the grid (`web/src/wall.ts` writes them).
const HEAD: usize = 12;

/// The grid, px (the scenario's `grid`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Grid {
    /// Between the tables, and from the frame's edge.
    pub gap: f32,
    /// A table's title row.
    pub title: f32,
    pub row_height: f32,
    pub text_size: f32,
    /// Symbol, Last, Chg %, Volume.
    pub widths: [f32; 4],
    /// A frame narrower than this shows one column of tables (a phone's),
    /// scrolled.
    pub one_column_below: f32,
    /// In one column, the rows a table shows under its header.
    pub phone_rows: usize,
}

/// The scene's settings at the wall level.
#[derive(Debug, Clone, PartialEq)]
pub struct Wall {
    /// The stop's tables: the first N desks.
    pub tables: usize,
    /// The file's rows: every desk's.
    pub rows: u64,
    pub grid: Grid,
    /// Market watch's colors and flash, and the shown desks' decimals.
    pub market: Market,
    /// The table's columns that flash, by index.
    pub flashing: Vec<usize>,
}

impl Wall {
    /// From the JS host's numbers (`[tables, the file's rows, gap, title,
    /// row height, text size, the four widths, one column below, phone
    /// rows, …market watch's (Market::new's, its decimals the shown
    /// desks')]`) and the flashing columns' names (market watch's: those the
    /// wall draws flash). Anything else is an error the host shows.
    pub fn new(level: &[f64], flash: &[String]) -> Result<Self, String> {
        if level.len() <= HEAD {
            return Err(format!(
                "the wall level takes {HEAD} numbers and market watch's, not {}",
                level.len()
            ));
        }
        let (head, rest) = level.split_at(HEAD);
        let &[
            tables,
            rows,
            gap,
            title,
            row_height,
            text_size,
            symbol,
            last,
            change_pct,
            volume,
            below,
            phone_rows,
        ] = head
        else {
            unreachable!("HEAD numbers");
        };
        let whole = |n: f64| n.fract() == 0.0 && n >= 1.0;
        if !(whole(tables) && tables as usize <= MOST_TABLES && whole(rows) && whole(phone_rows)) {
            return Err(format!(
                "the wall's tables, rows, or phone rows are out of range: {tables}, {rows}, {phone_rows}"
            ));
        }
        let lengths = [
            title, row_height, text_size, symbol, last, change_pct, volume, below,
        ];
        if !(gap >= 0.0
            && lengths
                .iter()
                .all(|&length| length > 0.0 && length.is_finite()))
        {
            return Err(format!("the wall's grid is out of range: {head:?}"));
        }
        let tables = tables as usize;
        let shown = tables * DESK_ROWS;
        if shown as f64 > rows {
            return Err(format!(
                "{tables} desks of {DESK_ROWS} past the file's {rows} rows"
            ));
        }
        let market = Market::new(rest, flash)?;
        if market.decimals.len() != shown {
            return Err(format!(
                "{} instruments' decimals for {tables} desks of {DESK_ROWS}",
                market.decimals.len()
            ));
        }
        let flashing = DRAWN
            .iter()
            .enumerate()
            .filter(|(_, (file, _))| flash.iter().any(|name| name == COLUMNS[*file]))
            .map(|(index, _)| index)
            .collect();
        Ok(Self {
            tables,
            rows: rows as u64,
            grid: Grid {
                gap: gap as f32,
                title: title as f32,
                row_height: row_height as f32,
                text_size: text_size as f32,
                widths: [symbol, last, change_pct, volume].map(|width| width as f32),
                one_column_below: below as f32,
                phone_rows: phone_rows as usize,
            },
            market,
            flashing,
        })
    }

    /// The shown desks' rows: the open reads them, one page.
    pub fn shown(&self) -> u64 {
        (self.tables * DESK_ROWS) as u64
    }
}

/// The file's columns, as the open read them, are the wall's ([`COLUMNS`]),
/// and its rows every desk's.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens the file")
)]
pub fn check(
    columns: &[seiza_duckdb::sql::ColumnInfo],
    rows: u64,
    wall: &Wall,
) -> Result<(), String> {
    let names: Vec<&str> = columns.iter().map(|info| info.name.as_str()).collect();
    if names != COLUMNS {
        return Err(format!("its columns are {names:?}, not the wall's"));
    }
    if rows != wall.rows {
        return Err(format!(
            "it has {rows} rows, but the wall has {} instruments",
            wall.rows
        ));
    }
    Ok(())
}

/// A table's columns, from the file's (the summary's kinds), as the canvas
/// writes them.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens the file")
)]
pub fn columns(file: &[TallTableColumn], wall: &Wall) -> Vec<TallTableColumn> {
    wall.market.install();
    DRAWN
        .iter()
        .enumerate()
        .map(|(index, &(at, header))| {
            let column = TallTableColumn::new(header, file[at].kind());
            let column = match index {
                LAST => column.format(NumberFormat::new().decimals(2)),
                CHANGE_PCT => column
                    .format(
                        NumberFormat::new()
                            .decimals(market::PCT_DECIMALS)
                            .sign(Sign::Always)
                            .suffix("%"),
                    )
                    .text_ramp(market::sign_ramp()),
                VOLUME => column.format(NumberFormat::new().grouping(true)),
                _ => column,
            }
            .width(px(wall.grid.widths[index]));
            if wall.flashing.contains(&index) {
                column.flash(market::flash_ramp(), wall.market.flash)
            } else {
                column
            }
        })
        .collect()
}

/// The shown desks' quotes and symbols, which every table's source answers
/// from and the host folds the feed into.
pub struct WallStore {
    quotes: RefCell<Quotes>,
    symbols: Rc<[SharedString]>,
    decimals: Rc<[u8]>,
}

#[cfg_attr(
    not(any(target_family = "wasm", test)),
    expect(dead_code, reason = "only the web build opens the file")
)]
impl WallStore {
    /// From the open's read of the shown desks' rows (`rows` of them): each
    /// row's Symbol and Last. A row without both fails the open.
    pub fn seed<P: TallTablePage>(page: &P, rows: usize, wall: &Wall) -> Result<Self, String> {
        let mut symbols = Vec::with_capacity(rows);
        let mut prices = Vec::with_capacity(rows);
        for row in 0..rows {
            let (Some(CellValue::Text(symbol)), Some(CellValue::Float(price))) =
                (page.value(row, FILE_SYMBOL), page.value(row, FILE_LAST))
            else {
                return Err(format!("row {row} has no Symbol or no Last price"));
            };
            symbols.push(SharedString::from(symbol.into_owned()));
            prices.push(price);
        }
        Ok(Self {
            quotes: RefCell::new(Quotes::new(prices)),
            symbols: symbols.into(),
            decimals: wall.market.decimals.clone(),
        })
    }

    /// Folds `batch` into the store, every tick or none; the instruments it
    /// ticked come back marked.
    pub fn fold(&self, batch: &[u8]) -> Result<(Batch, Vec<bool>), BatchError> {
        let mut quotes = self.quotes.borrow_mut();
        let folded = quotes.fold(batch)?;
        let ticked = crate::market::ticked(batch, quotes.rows().len());
        Ok((folded, ticked))
    }
}

/// A table's source: its desk's rows of the store, every read in hand
/// (ready as it's returned, so a re-read lands in the table's own turn).
pub struct DeskRows {
    desk: usize,
    store: Rc<WallStore>,
    next: u64,
}

#[cfg_attr(
    not(any(target_family = "wasm", test)),
    expect(dead_code, reason = "only the web build opens the file")
)]
impl DeskRows {
    pub fn new(desk: usize, store: Rc<WallStore>) -> Self {
        Self {
            desk,
            store,
            next: 0,
        }
    }
}

impl TallTableDelegate for DeskRows {
    type Page = DeskPage;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<DeskPage>) {
        let quotes = self.store.quotes.borrow();
        let first = self.desk * DESK_ROWS + (rows.start as usize).min(DESK_ROWS);
        let end = self.desk * DESK_ROWS + (rows.end as usize).min(DESK_ROWS);
        let end = end.min(quotes.rows().len());
        let page = DeskPage {
            first,
            quotes: quotes.rows()[first.min(end)..end].to_vec(),
            symbols: self.store.symbols.clone(),
            decimals: self.store.decimals.clone(),
        };
        self.next += 1;
        (self.next, Box::pin(std::future::ready(Ok(page))))
    }

    /// A read in hand resolved as it was returned: nothing to cancel.
    fn cancel(&mut self, _: u64, _: &mut App) {}
}

/// A page of a desk: the store's quotes for its rows.
pub struct DeskPage {
    /// Its first row's instrument.
    first: usize,
    quotes: Vec<Quote>,
    symbols: Rc<[SharedString]>,
    decimals: Rc<[u8]>,
}

impl TallTablePage for DeskPage {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        let quote = self.quotes.get(row)?;
        Some(match column {
            SYMBOL => CellValue::Text(Cow::Borrowed(self.symbols.get(self.first + row)?.as_ref())),
            LAST => CellValue::Float(quote.last),
            CHANGE_PCT => CellValue::Float(quote.change_pct),
            VOLUME => CellValue::Text(Cow::Owned(quote.volume.to_string())),
            _ => return None,
        })
    }

    fn paint(&self, row: usize, column: usize) -> CellPaint {
        let mut paint = CellPaint::default();
        if column == CHANGE_PCT
            && let Some(quote) = self.quotes.get(row)
        {
            paint.text = Some(
                Domain::new(-market::SIGN_DOMAIN, market::SIGN_DOMAIN)
                    .mid(0.0)
                    .unit(quote.change_pct),
            );
        }
        paint
    }

    fn decimals(&self, row: usize, column: usize) -> Option<u8> {
        (column == LAST)
            .then(|| self.decimals.get(self.first + row).copied())
            .flatten()
    }

    fn heap_bytes(&self) -> usize {
        self.quotes.len() * size_of::<Quote>()
    }
}

#[cfg(test)]
mod tests {
    //! The wall's numbers, the file's read seeding the store, and each
    //! desk's rows answered from it.

    use std::borrow::Cow;
    use std::task::{Context, Poll, Waker};

    use gpui_kit::TestAppContext;
    use seiza_tall_table::{CellValue, TallTableDelegate, TallTablePage};

    use super::{DESK_ROWS, DeskRows, Wall, WallStore};
    use crate::market::{HEADER, TICK};

    /// The wall at `tables`, every instrument at 2 decimals.
    fn level(tables: usize) -> Vec<f64> {
        let mut level = vec![
            tables as f64,
            400.0,
            8.0,
            26.0,
            24.0,
            12.0,
            64.0,
            76.0,
            72.0,
            80.0,
            768.0,
            6.0,
        ];
        level.extend([400.0, 0.3]);
        level.extend([0.6, 0.15, 149.0].repeat(4));
        level.extend(std::iter::repeat_n(2.0, tables * DESK_ROWS));
        level
    }

    fn flash() -> Vec<String> {
        ["Last", "Bid", "Ask"].map(String::from).to_vec()
    }

    /// The file's rows: instrument `i` is `S<i>` at `10 + i`.
    struct File;

    impl TallTablePage for File {
        fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
            match column {
                1 => Some(CellValue::Text(Cow::Owned(format!("S{row}")))),
                2 => Some(CellValue::Float(10.0 + row as f64)),
                _ => None,
            }
        }

        fn heap_bytes(&self) -> usize {
            0
        }
    }

    fn batch(ticks: &[(u16, f64)]) -> Vec<u8> {
        let mut bytes = vec![0; HEADER + ticks.len() * TICK];
        bytes[4..8].copy_from_slice(&(ticks.len() as u32).to_le_bytes());
        for (i, (instrument, last)) in ticks.iter().enumerate() {
            let o = HEADER + i * TICK;
            bytes[o..o + 2].copy_from_slice(&instrument.to_le_bytes());
            bytes[o + 12..o + 16].copy_from_slice(&100u32.to_le_bytes());
            for at in [16, 24, 32] {
                bytes[o + at..o + at + 8].copy_from_slice(&last.to_le_bytes());
            }
        }
        bytes
    }

    #[test]
    fn the_level_takes_its_numbers_or_fails() {
        let wall = Wall::new(&level(6), &flash()).unwrap();
        assert_eq!((wall.tables, wall.rows, wall.shown()), (6, 400, 300));
        assert_eq!(wall.grid.widths, [64.0, 76.0, 72.0, 80.0]);
        assert_eq!(
            wall.flashing,
            [1],
            "Last alone: the wall draws no Bid or Ask"
        );
        assert_eq!(wall.market.decimals.len(), 300);

        let mut short = level(6);
        short.pop();
        assert!(
            Wall::new(&short, &flash()).is_err(),
            "a desk's decimals short"
        );
        let mut nine = level(8);
        nine[0] = 9.0;
        assert!(Wall::new(&nine, &flash()).is_err(), "past the most tables");
        let mut half = level(6);
        half[0] = 6.5;
        assert!(Wall::new(&half, &flash()).is_err(), "tables not whole");
        let mut past = level(8);
        past[1] = 350.0;
        assert!(
            Wall::new(&past, &flash()).is_err(),
            "desks past the file's rows"
        );
        let mut wide = level(4);
        wide[6] = 0.0;
        assert!(Wall::new(&wide, &flash()).is_err(), "a zero width");
        assert!(
            Wall::new(&level(4)[..12], &flash()).is_err(),
            "no market numbers"
        );
    }

    #[gpui_kit::test]
    fn each_desk_reads_its_rows_of_the_store(cx: &mut TestAppContext) {
        let wall = Wall::new(&level(4), &flash()).unwrap();
        let store = std::rc::Rc::new(WallStore::seed(&File, 200, &wall).unwrap());
        let mut desk = DeskRows::new(2, store.clone());
        let read = |desk: &mut DeskRows, cx: &mut TestAppContext| {
            let (_, mut load) = cx.update(|cx| desk.load_page(0..50, cx));
            match load.as_mut().poll(&mut Context::from_waker(Waker::noop())) {
                Poll::Ready(page) => page.expect("a page"),
                Poll::Pending => panic!("not in hand"),
            }
        };
        let page = read(&mut desk, cx);
        assert_eq!(
            page.value(0, 0),
            Some(CellValue::Text(Cow::Borrowed("S100")))
        );
        assert_eq!(page.value(0, 1), Some(CellValue::Float(110.0)));
        assert_eq!(
            page.value(49, 0),
            Some(CellValue::Text(Cow::Borrowed("S149")))
        );
        assert_eq!(page.value(50, 0), None, "past the desk");
        assert_eq!(page.decimals(0, 1), Some(2));
        assert_eq!(page.decimals(0, 2), None, "Chg % keeps its column's");

        // Desk 2's first row and desk 0's last ticked.
        let (folded, ticked) = store.fold(&batch(&[(100, 111.0), (49, 58.5)])).unwrap();
        assert_eq!(folded.count, 2);
        assert!(ticked[100] && ticked[49] && ticked.iter().filter(|&&t| t).count() == 2);
        let page = read(&mut desk, cx);
        assert_eq!(page.value(0, 1), Some(CellValue::Float(111.0)));
        assert_eq!(
            page.value(0, 3),
            Some(CellValue::Text(Cow::Owned("100".into())))
        );
        assert_eq!(page.paint(0, 2).text, Some(1.0), "a rise");
        assert!(
            store.fold(&batch(&[(200, 1.0)])).is_err(),
            "an instrument past the shown desks"
        );

        struct NoPrice;
        impl TallTablePage for NoPrice {
            fn value(&self, _: usize, column: usize) -> Option<CellValue<'_>> {
                (column == 1).then_some(CellValue::Text(Cow::Borrowed("X")))
            }
            fn heap_bytes(&self) -> usize {
                0
            }
        }
        assert!(
            WallStore::seed(&NoPrice, 1, &wall).is_err(),
            "a row without its Last"
        );
    }
}
