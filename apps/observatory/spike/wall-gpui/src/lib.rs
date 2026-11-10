//! Throwaway: the monitoring wall's GPUI spike. `?tables=<n>` (4, 6, or 8)
//! tall tables in one window, built at the wall's level (`custom-cells`,
//! `live`, `format`, `density`), each a desk of 50 rows over one store of
//! the desks' quotes, laid out in two rows of n / 2. The columns are the
//! canvas's: Symbol 64, Last 76, Chg % 72, Volume 80 px, 24 px rows and
//! 12 px text, a 26 px title above each table. Last flashes (400 ms, 30%)
//! and Chg % is drawn by its sign, as market watch's. No engine: a desk is
//! one page, which the contender reads once and then answers from the
//! store; here every read is the store's, in hand.
//!
//! The JS host feeds it the spike's worker's batches (`feed`, in each
//! message's task): every tick folded, then each table's ticked rows
//! invalidated. `?hold` holds each batch 17 ms first (Shown in's control).
//!
//! It logs, for `wall-run.ts`: each batch folded (`wallBatches`: seq,
//! ticks, sent, the mask of tables whose on-screen rows it ticked, then a
//! generation per table, 0 for none), each batch refused whole
//! (`wallFailures`), and each frame that drew any table's
//! re-read (`wallRefreshed`: the page clock, right after the frame's task,
//! then the highest generation drawn per table), marked `wall:refreshed`.
//! `wall:filled` marks the first frame with every table filled.

#![cfg(target_family = "wasm")]

use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::ops::Range;
use std::rc::Rc;
use std::sync::OnceLock;
use std::time::Duration;

use gpui_kit::component::{ActiveTheme as _, Theme};
use gpui_kit::*;
use seiza_tall_table::{
    CellPaint, CellValue, ColumnKind, Density, Domain, NumberFormat, PageLoad, Paging, Ramp, Sign,
    TallTable, TallTableColumn, TallTableDelegate, TallTableEvent, TallTablePage, TallTableState,
};
use wasm_bindgen::JsCast as _;
use wasm_bindgen::prelude::*;

const HEADER: usize = 24;
const TICK: usize = 40;
const DESK_ROWS: usize = 50;
const DESKS: [&str; 8] = [
    "Energy",
    "Rail and freight",
    "Banks",
    "Chips",
    "Health",
    "Retail",
    "Materials",
    "Utilities",
];
const LAST: usize = 1;
const CHANGE_PCT: usize = 2;
/// Market watch's rise and fall in Oklch (`contenders/scenarios.ts`), light then dark.
const SIGNS: [[f32; 3]; 4] = [
    [0.55, 0.15, 149.0],
    [0.45, 0.17, 27.0],
    [0.82, 0.17, 149.0],
    [0.68, 0.19, 27.0],
];
const FLASH_MS: u64 = 400;
const FLASH_MIX: f32 = 0.3;

#[derive(Clone, Copy)]
struct Quote {
    open: f64,
    last: f64,
    change_pct: f64,
    volume: u64,
}

struct Store {
    quotes: Vec<Quote>,
    symbols: Rc<[SharedString]>,
    decimals: Rc<[u8]>,
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

impl Store {
    /// Folds every tick, or none if the batch isn't one (checked whole
    /// first, as the contender's store does); the instruments it ticked,
    /// marked.
    fn fold(&mut self, batch: &[u8]) -> Result<(u32, u32, f64, Vec<bool>), String> {
        if batch.len() < HEADER {
            return Err(format!("a batch of {} bytes has no header", batch.len()));
        }
        let count = u32_at(batch, 4) as usize;
        if batch.len() != HEADER + count * TICK {
            return Err(format!("a batch of {count} ticks is {} bytes", batch.len()));
        }
        let of = self.quotes.len();
        if let Some(tick) =
            (0..count).find(|tick| usize::from(u16_at(batch, HEADER + tick * TICK)) >= of)
        {
            return Err(format!(
                "tick {tick} names an instrument past the {of} shown"
            ));
        }
        let mut ticked = vec![false; of];
        for tick in 0..count {
            let o = HEADER + tick * TICK;
            let i = usize::from(u16_at(batch, o));
            let q = &mut self.quotes[i];
            let last = f64_at(batch, o + 16);
            q.last = last;
            q.change_pct = (last - q.open) / q.open * 100.0;
            q.volume += u64::from(u32_at(batch, o + 12));
            ticked[i] = true;
        }
        Ok((u32_at(batch, 0), count as u32, f64_at(batch, 8), ticked))
    }
}

struct DeskRows {
    desk: usize,
    store: Rc<RefCell<Store>>,
    next: u64,
}

struct DeskPage {
    first: usize,
    quotes: Vec<Quote>,
    symbols: Rc<[SharedString]>,
    decimals: Rc<[u8]>,
}

impl TallTableDelegate for DeskRows {
    type Page = DeskPage;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<DeskPage>) {
        let store = self.store.borrow();
        let first = self.desk * DESK_ROWS + rows.start as usize;
        let end = self.desk * DESK_ROWS + (rows.end as usize).min(DESK_ROWS);
        let page = DeskPage {
            first,
            quotes: store.quotes[first..end].to_vec(),
            symbols: store.symbols.clone(),
            decimals: store.decimals.clone(),
        };
        self.next += 1;
        (self.next, Box::pin(std::future::ready(Ok(page))))
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}
}

impl TallTablePage for DeskPage {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        let quote = self.quotes.get(row)?;
        Some(match column {
            0 => CellValue::Text(Cow::Borrowed(self.symbols[self.first + row].as_ref())),
            LAST => CellValue::Float(quote.last),
            CHANGE_PCT => CellValue::Float(quote.change_pct),
            _ => CellValue::Text(Cow::Owned(quote.volume.to_string())),
        })
    }

    fn paint(&self, row: usize, column: usize) -> CellPaint {
        let mut paint = CellPaint::default();
        if column == CHANGE_PCT
            && let Some(quote) = self.quotes.get(row)
        {
            paint.text = Some(Domain::new(-1e-9, 1e-9).mid(0.0).unit(quote.change_pct));
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

// ---------------------------------------------------------------- colors

fn oklch([l, c, h]: [f32; 3]) -> Hsla {
    let (a, b) = (c * h.to_radians().cos(), c * h.to_radians().sin());
    let l_ = (l + 0.396_337_78 * a + 0.215_803_76 * b).powi(3);
    let m_ = (l - 0.105_561_346 * a - 0.063_854_17 * b).powi(3);
    let s_ = (l - 0.089_484_18 * a - 1.291_485_5 * b).powi(3);
    let encode = |linear: f32| {
        let linear = linear.clamp(0.0, 1.0);
        if linear <= 0.003_130_8 {
            linear * 12.92
        } else {
            1.055 * linear.powf(1.0 / 2.4) - 0.055
        }
    };
    Rgba {
        r: encode(4.076_741_7 * l_ - 3.307_711_6 * m_ + 0.230_969_94 * s_),
        g: encode(-1.268_438 * l_ + 2.609_757_4 * m_ - 0.341_319_38 * s_),
        b: encode(-0.004_196_086_3 * l_ - 0.703_418_6 * m_ + 1.707_614_7 * s_),
        a: 1.0,
    }
    .into()
}

/// `[theme][fall, rise]`: the signs, then the flashes.
static COLORS: OnceLock<[[[Hsla; 2]; 2]; 2]> = OnceLock::new();

fn colors() -> &'static [[[Hsla; 2]; 2]; 2] {
    COLORS.get_or_init(|| {
        let [lu, ld, du, dd] = SIGNS.map(oklch);
        let mix = |c: Hsla| Hsla { a: FLASH_MIX, ..c };
        [
            [[ld, lu], [dd, du]],
            [[mix(ld), mix(lu)], [mix(dd), mix(du)]],
        ]
    })
}

fn sign(theme: &Theme, rise: bool) -> Hsla {
    colors()[0][usize::from(theme.is_dark())][usize::from(rise)]
}

fn flash(theme: &Theme, rise: bool) -> Hsla {
    colors()[1][usize::from(theme.is_dark())][usize::from(rise)]
}

fn columns() -> Vec<TallTableColumn> {
    vec![
        TallTableColumn::new("Symbol", ColumnKind::Text).width(px(64.)),
        TallTableColumn::new("Last", ColumnKind::Float)
            .format(NumberFormat::new().decimals(2))
            .flash(
                Ramp::new(&[|t| flash(t, false), |t| flash(t, true)]),
                Duration::from_millis(FLASH_MS),
            )
            .width(px(76.)),
        TallTableColumn::new("Chg %", ColumnKind::Float)
            .format(
                NumberFormat::new()
                    .decimals(2)
                    .sign(Sign::Always)
                    .suffix("%"),
            )
            .text_ramp(Ramp::new(&[
                |t| sign(t, false),
                |t| t.foreground,
                |t| sign(t, true),
            ]))
            .width(px(72.)),
        TallTableColumn::new("Volume", ColumnKind::Integer { max_chars: 12 })
            .format(NumberFormat::new().grouping(true))
            .width(px(80.)),
    ]
}

// ---------------------------------------------------------------- the host

type Table = TallTableState<DeskRows>;

thread_local! {
    static HOST: RefCell<Option<(Entity<Host>, AsyncApp)>> = const { RefCell::new(None) };
    /// `[seq, ticks, sent, mask, …a generation per table]` per batch.
    static BATCHES: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    /// `[at, …the highest generation drawn per table]` per frame.
    static REFRESHED: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static DRAWN: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
    static QUEUED: Cell<bool> = const { Cell::new(false) };
    /// Each batch refused, and why.
    static FAILURES: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// Runs `f` right after the current task (a microtask): after the frame
/// its render is part of has been presented.
fn after_task(f: impl FnOnce() + 'static) {
    thread_local! {
        static QUEUE: js_sys::Function = js_sys::Reflect::get(&js_sys::global(), &"queueMicrotask".into())
            .expect("queueMicrotask")
            .unchecked_into();
    }
    let f = Closure::once_into_js(f);
    QUEUE.with(|queue| {
        let _ = queue.call1(&JsValue::UNDEFINED, &f);
    });
}

struct Host {
    tables: Vec<Entity<Table>>,
    store: Rc<RefCell<Store>>,
    hold: bool,
    filled: usize,
    _subscriptions: Vec<Subscription>,
}

impl Host {
    fn new(
        n: usize,
        symbols: Vec<String>,
        prices: Vec<f64>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let store = Rc::new(RefCell::new(Store {
            quotes: prices
                .iter()
                .map(|&p| Quote {
                    open: p,
                    last: p,
                    change_pct: 0.0,
                    volume: 0,
                })
                .collect(),
            symbols: symbols.into_iter().map(SharedString::from).collect(),
            decimals: prices
                .iter()
                .map(|&p| if p < 10.0 { 3 } else { 2 })
                .collect(),
        }));
        DRAWN.set(vec![0; n]);
        let mut subscriptions = Vec::new();
        let tables: Vec<_> = (0..n)
            .map(|desk| {
                let rows = DeskRows {
                    desk,
                    store: store.clone(),
                    next: 0,
                };
                let table = cx.new(|cx| {
                    // The contender's: the probes on, always.
                    let mut table =
                        Table::new(rows, columns(), DESK_ROWS as u64, Paging::default(), cx)
                            .probe_frames(true);
                    table.set_density(
                        Density {
                            row_height: px(24.),
                            text_size: px(12.).into(),
                        },
                        cx,
                    );
                    table
                });
                subscriptions.push(cx.subscribe(&table, move |host: &mut Host, _, event, _| {
                    match event {
                        TallTableEvent::Filled { first: true } => {
                            host.filled += 1;
                            if host.filled == n {
                                after_task(|| {
                                    seiza::marks::mark("wall:filled");
                                });
                            }
                        }
                        TallTableEvent::Refreshed { generation, .. } => {
                            DRAWN.with_borrow_mut(|drawn| {
                                drawn[desk] = drawn[desk].max(*generation)
                            });
                            if !QUEUED.replace(true) {
                                after_task(|| {
                                    QUEUED.set(false);
                                    let at =
                                        seiza::marks::mark("wall:refreshed").unwrap_or_default();
                                    let drawn = DRAWN.with_borrow(Clone::clone);
                                    REFRESHED.with_borrow_mut(|log| {
                                        log.push(at);
                                        log.extend(drawn.iter().map(|&g| g as f64));
                                    });
                                });
                            }
                        }
                        _ => {}
                    }
                }));
                table
            })
            .collect();
        let focus = tables[0].read(cx).focus_handle().clone();
        window.focus(&focus, cx);
        Self {
            tables,
            store,
            hold: seiza::url::param("hold").is_some(),
            filled: 0,
            _subscriptions: subscriptions,
        }
    }

    fn feed(&mut self, batch: Vec<u8>, cx: &mut Context<Self>) {
        if self.hold {
            cx.spawn(async move |this, cx| {
                cx.background_executor()
                    .timer(Duration::from_millis(17))
                    .await;
                let _ = this.update(cx, |this, cx| this.apply(&batch, cx));
            })
            .detach();
        } else {
            self.apply(&batch, cx);
        }
    }

    fn apply(&mut self, batch: &[u8], cx: &mut Context<Self>) {
        let (seq, count, sent, ticked) = match self.store.borrow_mut().fold(batch) {
            Ok(folded) => folded,
            Err(message) => return FAILURES.with_borrow_mut(|log| log.push(message)),
        };
        let mut mask = 0u32;
        let mut generations = Vec::with_capacity(self.tables.len());
        for (desk, table) in self.tables.iter().enumerate() {
            let rows = &ticked[desk * DESK_ROWS..(desk + 1) * DESK_ROWS];
            let (generation, visible) = table.update(cx, |table, cx| {
                let visible = table.visible_rows();
                let mut generation = 0;
                let mut seen = false;
                let mut row = 0;
                while row < DESK_ROWS {
                    if !rows[row] {
                        row += 1;
                        continue;
                    }
                    let start = row;
                    while row < DESK_ROWS && rows[row] {
                        row += 1;
                    }
                    let run = start as u64..row as u64;
                    seen |= run.start < visible.end && visible.start < run.end;
                    generation = table.invalidate_rows(run, cx);
                }
                (generation, seen)
            });
            if visible {
                mask |= 1 << desk;
            }
            generations.push(generation as f64);
        }
        BATCHES.with_borrow_mut(|log| {
            log.extend([f64::from(seq), f64::from(count), sent, f64::from(mask)]);
            log.extend(generations);
        });
    }
}

impl Render for Host {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let across = self.tables.len().div_ceil(2);
        let desk = |index: usize, table: &Entity<Table>| {
            div()
                .flex_1()
                .min_w_0()
                .h_full()
                .flex()
                .flex_col()
                .child(
                    div()
                        .h(px(26.))
                        .px_2()
                        .flex()
                        .items_center()
                        .text_size(px(12.))
                        .text_color(theme.foreground)
                        .child(DESKS[index]),
                )
                .child(div().flex_1().min_h_0().child(TallTable::new(table)))
        };
        div()
            .size_full()
            .p_2()
            .gap_2()
            .flex()
            .flex_col()
            .bg(theme.tokens.sidebar)
            .children((0..2).map(|line| {
                div().flex_1().min_h_0().flex().gap_2().children(
                    self.tables
                        .iter()
                        .enumerate()
                        .skip(line * across)
                        .take(across)
                        .map(|(index, table)| desk(index, table)),
                )
            }))
    }
}

/// Called by the JS host once the wasm and the font are in: `symbols` and
/// `prices` are the shown desks' instruments, 50 a desk, in desk order.
#[wasm_bindgen]
pub fn start(ui_font: Vec<u8>, symbols: Vec<String>, prices: Vec<f64>) {
    let n = prices.len() / DESK_ROWS;
    seiza::Bootstrap::new("Monitoring wall spike: GPUI", ui_font).run(move |window, cx| {
        seiza_tall_table::init(cx);
        let host = cx.new(|cx| Host::new(n, symbols, prices, window, cx));
        HOST.set(Some((host.clone(), cx.to_async())));
        host.into()
    });
}

/// A batch from the feed's worker, in its message's task.
#[wasm_bindgen]
pub fn feed(batch: Vec<u8>) {
    let Some((host, mut cx)) = HOST.with_borrow(Clone::clone) else {
        return;
    };
    host.update(&mut cx, |host, cx| host.feed(batch, cx));
}

#[wasm_bindgen(js_name = wallBatches)]
pub fn wall_batches() -> Vec<f64> {
    BATCHES.with_borrow(Clone::clone)
}

#[wasm_bindgen(js_name = wallRefreshed)]
pub fn wall_refreshed() -> Vec<f64> {
    REFRESHED.with_borrow(Clone::clone)
}

/// Each batch the store refused, and why.
#[wasm_bindgen(js_name = wallFailures)]
pub fn wall_failures() -> Vec<String> {
    FAILURES.with_borrow(Clone::clone)
}
