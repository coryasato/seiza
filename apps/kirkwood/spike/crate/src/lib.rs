//! Throwaway: Kirkwood's two-canvas spike. A GPUI window with nothing
//! behind its interface (the root's background is transparent, and the JS
//! host makes the canvas composite by its alpha), over a Three.js canvas
//! that draws the belt.
//!
//! What's here, as the stack leans (`apps/kirkwood/CLAUDE.md`):
//! - the orbital elements, six f32s a row (a au, e, i degrees, then the
//!   node, the argument of perihelion, and the mean anomaly in radians,
//!   seeded at random: the sample has no angles), which the scene reads
//!   through a view over this module's memory (`elements_ptr`);
//! - the clock (`scene_years`, asked by the scene every frame);
//! - the scene's input: GPUI's hit test decides. A surface under the
//!   interface takes what nothing above it took: a drag draws a freehand
//!   shape (drawn here, in white), a wheel is handed to the scene;
//! - the tall table over those rows, in a panel behind a handle;
//! - the moves: the sort flight's progress (the scene's shader flies each
//!   dot from space to a against e), a drawn group (the rows under a closed
//!   shape, picked here through the scene's camera; the scene grays the
//!   rest and flies in while the panel comes in, the table filtered to the
//!   group), and a live column (each row's distance from the Sun at the
//!   clock's time, redrawn at a rate a person can read).
//!
//! `spike_state` and the published targets are for `run.ts`.

#![cfg(target_family = "wasm")]

use std::cell::{Cell, RefCell};
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::menu::DropdownMenu as _;
use gpui_kit::component::{ActiveTheme as _, Sizable as _, Theme, ThemeMode};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use seiza_tall_table::{
    CellValue, ColumnKind, NumberFormat, PageLoad, Paging, TallTable, TallTableColumn,
    TallTableDelegate, TallTableEvent, TallTablePage, TallTableSelection, TallTableState,
};
use wasm_bindgen::prelude::*;

/// Floats a row in the elements buffer.
const STRIDE: usize = 6;
const PANEL_WIDTH: f32 = 560.;
/// The storyboard's surfaces (board 1's handle and time control).
const SURFACE: u32 = 0x171717;
const EDGE: u32 = 0x262626;
const MUTED: u32 = 0xa3a3a3;
const TEXT: u32 = 0xfafafa;
/// Days from 1970-01-01 to 2026-11-10, where the clock starts.
const START_DAY: f64 = 20767.0;
/// The most the clock moves after a stall (a tab back from the background).
const MAX_STEP_MS: f64 = 100.0;
/// A gap between two readings of the clock past this is a stall.
const STALL_MS: f64 = 500.0;
/// The sort flight, end to end (the shader staggers the dots within it).
const FLIGHT_MS: f64 = 3000.0;
/// The camera's fly-in to a drawn group, and its way back.
const FLY_MS: f64 = 1600.0;
/// The panel's slide when nothing flies with it.
const SLIDE_MS: f64 = 350.0;
/// The live column: each row's distance from the Sun.
const LIVE_COLUMN: usize = 1;
/// The live column's refreshes a second, cycled by its button.
const LIVE_RATES: [f64; 5] = [1.0, 2.0, 4.0, 10.0, 60.0];

actions!(kirkwood_spike, [MenuItem]);

#[wasm_bindgen]
extern "C" {
    /// A wheel over the scene, at a window position (CSS px).
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = wheel)]
    fn scene_wheel(x: f32, y: f32, delta: f32);
    /// The first frame is on screen: the host starts the scene and the data.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = firstFrame)]
    fn first_frame();
    /// The scene's camera: projection × view (16 floats, column-major),
    /// then the window's width and height (CSS px).
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = viewProjection)]
    fn view_projection() -> Vec<f32>;
    /// Flies the camera until a sphere (the scene's coordinates, au) fills
    /// what a panel `inset` px wide leaves of the window.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = flyTo)]
    fn fly_to(x: f64, y: f64, z: f64, radius: f64, inset: f32, ms: f64);
    /// Flies the camera back to the whole belt.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = flyHome)]
    fn fly_home(ms: f64);
    /// A byte a row, 255 for a row of the group; empty for no group.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = setPicked)]
    fn set_picked(picked: &[u8]);
    /// The closed shape (window px, x then y), for the scene to keep on the
    /// ecliptic as its camera moves; empty for none.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = setOutline)]
    fn set_outline(points: &[f32]);
}

#[derive(Clone, Copy)]
struct Clock {
    /// One a second while it moves, as the time control says.
    years: f64,
    running: bool,
    /// A shape is being drawn: time holds.
    held: bool,
    last_ms: f64,
}

/// What the scene asks each frame beside the clock.
#[derive(Clone, Copy)]
struct Motion {
    /// The sort flight: 0 in space, 1 landed in a against e, linear between.
    flight: f64,
    /// Where the flight is headed: 0 or 1.
    to: f64,
    last_ms: f64,
    /// The panel's width on screen (CSS px): the scene centers in the rest.
    inset: f32,
}

thread_local! {
    static ELEMENTS: RefCell<Rc<Vec<f32>>> = RefCell::new(Rc::new(Vec::new()));
    static CLOCK: Cell<Clock> = const { Cell::new(Clock { years: 0.0, running: true, held: false, last_ms: f64::NAN }) };
    static MOTION: Cell<Motion> = const { Cell::new(Motion { flight: 0.0, to: 0.0, last_ms: f64::NAN, inset: 0.0 }) };
    /// The clock's time the live column shows: moved on at its refresh rate.
    static LIVE_YEARS: Cell<f64> = const { Cell::new(0.0) };
    /// The live column's refreshes a second.
    static LIVE_RATE: Cell<f64> = const { Cell::new(2.0) };
    /// The drawn group's rows, for `group_radius`.
    static GROUP: RefCell<Rc<Vec<u32>>> = RefCell::new(Rc::new(Vec::new()));
    static HOST: RefCell<Option<(Entity<Host>, AsyncApp)>> = const { RefCell::new(None) };
    /// See `state`'s indices.
    static STATE: RefCell<[f64; 16]> = const { RefCell::new([0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]) };
}

/// `STATE`'s indices: the panel open, the shape's points, the shape closed,
/// the table's top row, its selected row or -1, its frames filled, its
/// tooltip shown; then the sort flight's progress, the group's rows, the
/// milliseconds its pick took, the camera's flights finished, the panel's
/// slide (0..1), the live column's refreshes, the table's rows, the group's
/// radius (au), and the live column's refreshes a second.
mod state {
    pub const PANEL: usize = 0;
    pub const SHAPE_POINTS: usize = 1;
    pub const SHAPE_CLOSED: usize = 2;
    pub const TOP: usize = 3;
    pub const SELECTED: usize = 4;
    pub const FILLED: usize = 5;
    pub const TOOLTIP: usize = 6;
    pub const FLIGHT: usize = 7;
    pub const GROUP_ROWS: usize = 8;
    pub const PICK_MS: usize = 9;
    pub const FLOWN: usize = 10;
    pub const SLIDE: usize = 11;
    pub const LIVE_REFRESHES: usize = 12;
    pub const TABLE_ROWS: usize = 13;
    pub const GROUP_RADIUS: usize = 14;
    pub const LIVE_RATE: usize = 15;
}

fn set_state(index: usize, value: f64) {
    STATE.with_borrow_mut(|state| state[index] = value);
}

fn add_state(index: usize) {
    STATE.with_borrow_mut(|state| state[index] += 1.0);
}

/// Moves the clock on to `now_ms` (the page clock) and returns its years.
/// Read by the scene every frame it draws, and by the date and the live
/// column at their own rates, so time runs whether or not the scene draws.
fn advance_clock(now_ms: f64) -> f64 {
    let mut clock = CLOCK.get();
    if clock.running && !clock.held && !clock.last_ms.is_nan() {
        // A stall (a tab back from the background) doesn't jump the belt
        // by the time it was away.
        let step = now_ms - clock.last_ms;
        let step = if step > STALL_MS {
            MAX_STEP_MS
        } else {
            step.max(0.0)
        };
        clock.years += step / 1000.0;
    }
    clock.last_ms = now_ms;
    CLOCK.set(clock);
    clock.years
}

fn clock_moves() -> bool {
    let clock = CLOCK.get();
    clock.running && !clock.held
}

fn ease(k: f64) -> f64 {
    if k < 0.5 {
        4.0 * k * k * k
    } else {
        1.0 - (-2.0 * k + 2.0).powi(3) / 2.0
    }
}

// --------------------------------------------------------------- the orbits

/// A row's a, e, and eccentric anomaly at `years`, if its orbit is an
/// ellipse: the shader's math (Kepler's equation by Newton's method), in
/// f64.
fn eccentric_anomaly(row: &[f32], years: f64) -> Option<(f64, f64, f64)> {
    let (a, e) = (f64::from(row[0]), f64::from(row[1]));
    if a.is_nan() || a <= 0.0 || e.is_nan() || e >= 1.0 {
        return None;
    }
    let m = (f64::from(row[5]) + std::f64::consts::TAU / (a * a.sqrt()) * years)
        .rem_euclid(std::f64::consts::TAU);
    let mut anomaly = m + e * m.sin();
    for _ in 0..6 {
        let (sin, cos) = anomaly.sin_cos();
        let step = (anomaly - e * sin - m) / (1.0 - e * cos);
        anomaly -= step;
        if step.abs() < 1e-7 {
            break;
        }
    }
    Some((a, e, anomaly))
}

/// A row's distance from the Sun at `years` (au).
fn sun_au(row: &[f32], years: f64) -> Option<f64> {
    eccentric_anomaly(row, years).map(|(a, e, anomaly)| a * (1.0 - e * anomaly.cos()))
}

/// A row's place at `years` in the scene's coordinates (au; the ecliptic is
/// its xz plane), as the shader places it.
fn position(row: &[f32], years: f64) -> Option<[f64; 3]> {
    let (a, e, anomaly) = eccentric_anomaly(row, years)?;
    let (sin, cos) = anomaly.sin_cos();
    let xo = a * (cos - e);
    let yo = a * (1.0 - e * e).sqrt() * sin;
    let (so, co) = f64::from(row[3]).sin_cos();
    let (sw, cw) = f64::from(row[4]).sin_cos();
    let (si, ci) = f64::from(row[2]).to_radians().sin_cos();
    let x = (co * cw - so * sw * ci) * xo + (-co * sw - so * cw * ci) * yo;
    let y = (so * cw + co * sw * ci) * xo + (-so * sw + co * cw * ci) * yo;
    let z = sw * si * xo + cw * si * yo;
    Some([x, z, -y])
}

/// The pixels inside a closed shape (even-odd), over its bounding box.
struct Mask {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
    inside: Vec<bool>,
}

impl Mask {
    fn new(shape: &[Point<Pixels>], window: (f32, f32)) -> Self {
        let points: Vec<(f32, f32)> = shape.iter().map(|p| (p.x.into(), p.y.into())).collect();
        let over = |of: fn(&(f32, f32)) -> f32| {
            let values = points.iter().map(of);
            (
                values.clone().fold(f32::MAX, f32::min),
                values.fold(f32::MIN, f32::max),
            )
        };
        let (x, y) = (over(|p| p.0), over(|p| p.1));
        let (left, top) = (x.0.max(0.0).floor() as i32, y.0.max(0.0).floor() as i32);
        let width = (x.1.min(window.0).ceil() as i32 - left).max(0);
        let height = (y.1.min(window.1).ceil() as i32 - top).max(0);
        let mut inside = vec![false; (width * height) as usize];
        let mut crossings = Vec::new();
        for line in 0..height {
            let y = (top + line) as f32 + 0.5;
            crossings.clear();
            for (index, &(x1, y1)) in points.iter().enumerate() {
                let (x2, y2) = points[(index + 1) % points.len()];
                if (y1 <= y) != (y2 <= y) {
                    crossings.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1));
                }
            }
            crossings.sort_by(f32::total_cmp);
            for pair in crossings.as_chunks::<2>().0 {
                let from = ((pair[0] - 0.5).ceil() as i32 - left).clamp(0, width);
                let to = ((pair[1] - 0.5).floor() as i32 - left + 1).clamp(0, width);
                for x in from..to {
                    inside[(line * width + x) as usize] = true;
                }
            }
        }
        Self {
            left,
            top,
            width,
            height,
            inside,
        }
    }

    fn holds(&self, x: f64, y: f64) -> bool {
        let (x, y) = (x.floor() as i32 - self.left, y.floor() as i32 - self.top);
        x >= 0
            && y >= 0
            && x < self.width
            && y < self.height
            && self.inside[(y * self.width + x) as usize]
    }
}

/// The rows a closed shape holds.
struct Picked {
    rows: Vec<u32>,
    /// A byte a row, 255 for a row of the group.
    bytes: Vec<u8>,
    center: [f64; 3],
    radius: f64,
}

/// The rows under `shape` (window px) through the scene's whole depth, at
/// `years`, seen through `camera` (`view_projection`'s floats).
fn pick(elements: &[f32], shape: &[Point<Pixels>], camera: &[f32], years: f64) -> Picked {
    let m: Vec<f64> = camera[..16].iter().map(|&value| f64::from(value)).collect();
    let (width, height) = (f64::from(camera[16]), f64::from(camera[17]));
    let mask = Mask::new(shape, (camera[16], camera[17]));
    let mut rows = Vec::new();
    let mut bytes = vec![0u8; elements.len() / STRIDE];
    let mut places = Vec::new();
    for (index, row) in elements.as_chunks::<STRIDE>().0.iter().enumerate() {
        let Some([x, y, z]) = position(row, years) else {
            continue;
        };
        let w = m[3] * x + m[7] * y + m[11] * z + m[15];
        if w <= 0.0 {
            continue;
        }
        let px = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * width;
        let py = (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * height;
        if mask.holds(px, py) {
            rows.push(index as u32);
            bytes[index] = 255;
            places.push([x, y, z]);
        }
    }
    let (center, radius) = extent(&places);
    Picked {
        rows,
        bytes,
        center,
        radius,
    }
}

/// The places' centroid, and the distance from it that holds 95% of them
/// (a shape picks through the scene's depth: a few rows sit far behind).
fn extent(places: &[[f64; 3]]) -> ([f64; 3], f64) {
    if places.is_empty() {
        return ([0.0; 3], 0.0);
    }
    let mut center = [0.0; 3];
    for place in places {
        for axis in 0..3 {
            center[axis] += place[axis] / places.len() as f64;
        }
    }
    let mut distances: Vec<f64> = places
        .iter()
        .map(|place| {
            (0..3)
                .map(|axis| (place[axis] - center[axis]).powi(2))
                .sum::<f64>()
                .sqrt()
        })
        .collect();
    let at = (distances.len() * 95 / 100).min(distances.len() - 1);
    let (_, radius, _) = distances.select_nth_unstable_by(at, f64::total_cmp);
    (center, *radius)
}

// ---------------------------------------------------------------- the rows

struct Rows {
    elements: Rc<Vec<f32>>,
    /// The drawn group's rows, while the table is filtered to them.
    group: Option<Rc<Vec<u32>>>,
    next: u64,
}

struct Page {
    elements: Rc<Vec<f32>>,
    group: Option<Rc<Vec<u32>>>,
    first: usize,
    rows: usize,
}

impl TallTableDelegate for Rows {
    type Page = Page;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Page>) {
        let page = Page {
            elements: self.elements.clone(),
            group: self.group.clone(),
            first: rows.start as usize,
            rows: (rows.end - rows.start) as usize,
        };
        self.next += 1;
        (self.next, Box::pin(std::future::ready(Ok(page))))
    }

    fn cancel(&mut self, _: u64, _: &mut App) {}
}

impl TallTablePage for Page {
    fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
        if row >= self.rows {
            return None;
        }
        let source = match &self.group {
            Some(group) => *group.get(self.first + row)? as usize,
            None => self.first + row,
        };
        let at = source * STRIDE;
        let [a, e, i] = [
            self.elements[at],
            self.elements[at + 1],
            self.elements[at + 2],
        ];
        let bound = a > 0.0 && e < 1.0;
        // The period first: a computed f64, rounded to fit, so its cells'
        // tooltips open at the panel's left edge, over the scene.
        let own = |value: f32| {
            if value.is_nan() {
                CellValue::Null
            } else {
                CellValue::Float32(value)
            }
        };
        Some(match column {
            2 => own(a),
            3 => own(e),
            4 => own(i),
            _ if !bound => CellValue::Null,
            0 => CellValue::Float(f64::from(a).powf(1.5)),
            // Computed when drawn, at the time the column last moved to:
            // the page holds no value for it, so a redraw is a refresh.
            LIVE_COLUMN => sun_au(&self.elements[at..at + STRIDE], LIVE_YEARS.get())
                .map_or(CellValue::Null, CellValue::Float),
            5 => CellValue::Float(f64::from(a) * (1.0 - f64::from(e))),
            _ => CellValue::Float(f64::from(a) * (1.0 + f64::from(e))),
        })
    }

    fn heap_bytes(&self) -> usize {
        // A view over the elements: nothing of its own.
        0
    }
}

fn columns() -> Vec<TallTableColumn> {
    // The live column's decimals (`?decimals=`): the storyboard's 3.
    let decimals = seiza::url::param("decimals")
        .and_then(|decimals| decimals.parse().ok())
        .unwrap_or(3);
    [
        "period (yr)",
        "sun_au (live)",
        "a (au)",
        "e",
        "i (deg)",
        "nearest (au)",
        "farthest (au)",
    ]
    .into_iter()
    .enumerate()
    .map(|(index, name)| {
        let column = TallTableColumn::new(name, ColumnKind::Float);
        if index == LIVE_COLUMN {
            column.format(NumberFormat::new().decimals(decimals))
        } else {
            column
        }
    })
    .collect()
}

type Table = TallTableState<Rows>;

// ---------------------------------------------------------------- the host

/// When the table comes in after a shape closes (`?arrive=`).
#[derive(Clone, Copy, PartialEq)]
enum Arrive {
    /// With the camera's fly-in, over its length (or `?slide=<ms>`).
    With,
    /// Once the camera has arrived.
    After,
}

struct Slide {
    from: f32,
    to: f32,
    start_ms: f64,
    ms: f64,
}

struct Group {
    rows: Rc<Vec<u32>>,
    /// Whether time ran before the shape, to run again at the whole belt.
    resume: bool,
}

struct Host {
    table: Option<Entity<Table>>,
    rows: usize,
    panel_open: bool,
    /// How far in the panel is, 0..1.
    panel_t: f32,
    slide: Option<Slide>,
    /// The freehand shape while it's drawn, in window pixels. Shared with
    /// the frame's paint, which holds it only for the frame, so a point
    /// added between frames copies nothing. Closed, it's the scene's.
    shape: Rc<Vec<Point<Pixels>>>,
    drawing: bool,
    group: Option<Group>,
    /// The table shows the group's rows only.
    filtered: bool,
    arrive: Arrive,
    /// The slide's length when the table arrives with the fly-in.
    arrive_ms: f64,
    /// The panel waits for the camera to arrive.
    arriving: bool,
    date: Entity<DateLabel>,
    _subscriptions: Vec<Subscription>,
}

impl Host {
    fn new(cx: &mut Context<Self>) -> Self {
        if let Some(rate) = seiza::url::param("live").and_then(|rate| rate.parse::<f64>().ok())
            && rate > 0.0
        {
            LIVE_RATE.set(rate);
        }
        set_state(state::LIVE_RATE, LIVE_RATE.get());
        // The live column's refresh: a redraw of the table at the column's
        // rate while time moves and the panel shows.
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_secs_f64(1.0 / LIVE_RATE.get()))
                    .await;
                if this.update(cx, |host, cx| host.refresh_live(cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        Self {
            table: None,
            rows: 0,
            panel_open: false,
            panel_t: 0.0,
            slide: None,
            shape: Rc::new(Vec::new()),
            drawing: false,
            group: None,
            filtered: false,
            arrive: match seiza::url::param("arrive").as_deref() {
                Some("after") => Arrive::After,
                _ => Arrive::With,
            },
            arrive_ms: seiza::url::param("slide")
                .and_then(|ms| ms.parse().ok())
                .unwrap_or(FLY_MS),
            arriving: false,
            date: cx.new(DateLabel::new),
            _subscriptions: Vec::new(),
        }
    }

    fn loaded(&mut self, elements: Rc<Vec<f32>>, cx: &mut Context<Self>) {
        self.rows = elements.len() / STRIDE;
        let rows = Rows {
            elements,
            group: None,
            next: 0,
        };
        let probe = seiza::url::param("probe").is_some();
        let count = self.rows as u64;
        let table = cx.new(|cx| {
            Table::new(rows, columns(), count, Paging::default(), cx).probe_frames(probe)
        });
        self._subscriptions
            .push(cx.subscribe(&table, |_, _, event, _| match event {
                TallTableEvent::Filled { .. } => add_state(state::FILLED),
                TallTableEvent::Probe(probe) => {
                    set_state(state::TOP, probe.top);
                    set_state(state::TOOLTIP, f64::from(u8::from(probe.tooltip.is_some())));
                }
                TallTableEvent::Selected(selection) => {
                    let row = match selection {
                        Some(TallTableSelection::Cells { anchor, .. })
                        | Some(TallTableSelection::Rows { anchor, .. }) => anchor.0 as f64,
                        _ => -1.0,
                    };
                    set_state(state::SELECTED, row);
                }
                _ => {}
            }));
        self.table = Some(table);
        set_state(state::TABLE_ROWS, count as f64);
        cx.notify();
    }

    fn toggle_panel(&mut self, cx: &mut Context<Self>) {
        // Nothing to open until the rows are in: a press on the loading
        // handle isn't kept for later.
        if self.table.is_none() {
            return;
        }
        self.arriving = false;
        self.slide_panel(!self.panel_open, SLIDE_MS, cx);
    }

    fn slide_panel(&mut self, open: bool, ms: f64, cx: &mut Context<Self>) {
        self.panel_open = open;
        self.slide = Some(Slide {
            from: self.panel_t,
            to: if open { 1.0 } else { 0.0 },
            start_ms: seiza::marks::now(),
            ms,
        });
        set_state(state::PANEL, f64::from(u8::from(open)));
        cx.notify();
    }

    /// The slide's step for this frame, and the next frame asked for while
    /// it moves. The scene reads the panel's width on screen each frame.
    fn step_slide(&mut self, window: &mut Window) {
        if let Some(slide) = &self.slide {
            let k = ((seiza::marks::now() - slide.start_ms) / slide.ms.max(1.0)).clamp(0.0, 1.0);
            self.panel_t = slide.from + (slide.to - slide.from) * ease(k) as f32;
            if k >= 1.0 {
                self.slide = None;
            } else {
                window.request_animation_frame();
            }
        }
        MOTION.set(Motion {
            inset: self.panel_t * PANEL_WIDTH,
            ..MOTION.get()
        });
        set_state(state::SLIDE, f64::from(self.panel_t));
    }

    fn refresh_live(&mut self, cx: &mut Context<Self>) {
        let years = advance_clock(seiza::marks::now());
        if years == LIVE_YEARS.get() || self.panel_t == 0.0 {
            return;
        }
        if let Some(table) = &self.table {
            LIVE_YEARS.set(years);
            add_state(state::LIVE_REFRESHES);
            // The table keeps no cell cache: a redraw reads each visible
            // cell again, and the live column's answers the new time.
            table.update(cx, |_, cx| cx.notify());
        }
    }

    fn cycle_live_rate(&mut self, cx: &mut Context<Self>) {
        let at = LIVE_RATES
            .iter()
            .position(|&rate| rate >= LIVE_RATE.get())
            .unwrap_or(0);
        LIVE_RATE.set(LIVE_RATES[(at + 1) % LIVE_RATES.len()]);
        set_state(state::LIVE_RATE, LIVE_RATE.get());
        cx.notify();
    }

    fn toggle_sort(&mut self, cx: &mut Context<Self>) {
        let motion = MOTION.get();
        MOTION.set(Motion {
            to: 1.0 - motion.to,
            last_ms: f64::NAN,
            ..motion
        });
        cx.notify();
    }

    /// The table over the group's rows, or over every row.
    fn filter_table(&mut self, group: Option<Rc<Vec<u32>>>, cx: &mut Context<Self>) {
        let Some(table) = &self.table else {
            return;
        };
        let rows = group.as_ref().map_or(self.rows, |group| group.len()) as u64;
        self.filtered = group.is_some();
        table.update(cx, |table, cx| {
            table.delegate_mut().group = group;
            // The source's rows changed under every page: the new count,
            // then every row read again (`live`).
            table.set_rows(rows, cx);
            table.invalidate_rows(0..rows, cx);
            table.jump_to(0, cx);
            table.select(None, cx);
        });
        set_state(state::TABLE_ROWS, rows as f64);
        cx.notify();
    }

    /// The shape's release: it closes and time may move again. If it holds
    /// rows they're the group: time stays paused, the scene grays the rest
    /// and flies in, and the table comes in over the group's rows.
    fn end_shape(&mut self, cx: &mut Context<Self>) {
        if !self.drawing {
            return;
        }
        self.drawing = false;
        set_state(state::SHAPE_CLOSED, 1.0);
        let ran = CLOCK.get().running;
        let picked = self.pick_group(ran, cx);
        CLOCK.set(Clock {
            held: false,
            running: ran && !picked,
            last_ms: f64::NAN,
            ..CLOCK.get()
        });
        cx.notify();
    }

    fn pick_group(&mut self, ran: bool, cx: &mut Context<Self>) -> bool {
        let shape = std::mem::take(&mut self.shape);
        if shape.len() < 3 || self.table.is_none() {
            return false;
        }
        let elements = ELEMENTS.with_borrow(Clone::clone);
        let start = seiza::marks::now();
        let camera = view_projection();
        if camera.len() < 18 {
            return false;
        }
        let picked = pick(&elements, &shape, &camera, CLOCK.get().years);
        set_state(state::PICK_MS, seiza::marks::now() - start);
        if picked.rows.is_empty() {
            return false;
        }
        set_state(state::GROUP_ROWS, picked.rows.len() as f64);
        set_state(state::GROUP_RADIUS, picked.radius);
        set_picked(&picked.bytes);
        // Before the camera moves: the scene puts the outline on the
        // ecliptic through the camera it was drawn with.
        let outline: Vec<f32> = shape
            .iter()
            .flat_map(|point| [f32::from(point.x), f32::from(point.y)])
            .collect();
        set_outline(&outline);
        let [x, y, z] = picked.center;
        fly_to(x, y, z, picked.radius, PANEL_WIDTH, FLY_MS);
        let rows = Rc::new(picked.rows);
        GROUP.set(rows.clone());
        // A second shape keeps what the first found running.
        let resume = self.group.take().map_or(ran, |group| group.resume);
        self.group = Some(Group {
            rows: rows.clone(),
            resume,
        });
        self.filter_table(Some(rows), cx);
        if !self.panel_open {
            match self.arrive {
                Arrive::With => self.slide_panel(true, self.arrive_ms, cx),
                Arrive::After => self.arriving = true,
            }
        }
        true
    }

    /// The camera arrived (at a group, or back at the whole belt).
    fn flown(&mut self, cx: &mut Context<Self>) {
        if std::mem::take(&mut self.arriving) && self.group.is_some() {
            self.slide_panel(true, SLIDE_MS, cx);
        }
    }

    /// The way back: no group, every row, the camera out again.
    fn whole_belt(&mut self, cx: &mut Context<Self>) {
        let Some(group) = self.group.take() else {
            return;
        };
        GROUP.set(Rc::new(Vec::new()));
        self.arriving = false;
        set_picked(&[]);
        set_outline(&[]);
        fly_home(FLY_MS);
        set_state(state::GROUP_ROWS, 0.0);
        self.filter_table(None, cx);
        CLOCK.set(Clock {
            running: group.resume,
            last_ms: f64::NAN,
            ..CLOCK.get()
        });
        cx.notify();
    }

    fn render_scene_surface(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let shape = self.shape.clone();
        div()
            .id("scene")
            .absolute()
            .inset_0()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, _, cx| {
                    // A shape is drawn in space: its rows are picked
                    // through the scene's camera.
                    let motion = MOTION.get();
                    if motion.flight != 0.0 || motion.to != 0.0 {
                        return;
                    }
                    this.shape = Rc::new(vec![event.position]);
                    this.drawing = true;
                    CLOCK.set(Clock {
                        held: true,
                        ..CLOCK.get()
                    });
                    set_state(state::SHAPE_POINTS, 1.0);
                    set_state(state::SHAPE_CLOSED, 0.0);
                    cx.notify();
                }),
            )
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _, cx| {
                if !this.drawing {
                    return;
                }
                if event.pressed_button == Some(MouseButton::Left) {
                    Rc::make_mut(&mut this.shape).push(event.position);
                    set_state(state::SHAPE_POINTS, this.shape.len() as f64);
                    cx.notify();
                } else {
                    // Released where no release was heard (outside the
                    // window): the first move back ends it.
                    this.end_shape(cx);
                }
            }))
            // The release ends the shape wherever it lands: on the surface,
            // or over the panel, the handle, or the time control, which
            // occlude it.
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _: &MouseUpEvent, _, cx| this.end_shape(cx)),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, _: &MouseUpEvent, _, cx| this.end_shape(cx)),
            )
            .on_scroll(|event: &ScrollEvent, _, _| {
                let delta = event.delta.pixel_delta(px(16.)).y;
                scene_wheel(
                    event.position.x.into(),
                    event.position.y.into(),
                    delta.into(),
                );
            })
            .child(
                canvas(
                    |_, _, _| {},
                    move |_, _, window, _| {
                        if shape.len() < 2 {
                            return;
                        }
                        let mut path = PathBuilder::stroke(px(1.5));
                        path.move_to(shape[0]);
                        for point in &shape[1..] {
                            path.line_to(*point);
                        }
                        if let Ok(path) = path.build() {
                            window.paint_path(path, gpui_kit::white());
                        }
                    },
                )
                .absolute()
                .size_full(),
            )
    }

    fn render_title(&self) -> impl IntoElement {
        div()
            .absolute()
            .left(px(24.))
            .top(px(20.))
            .flex()
            .flex_col()
            .gap_1()
            .child(
                div()
                    .text_size(px(14.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Kirkwood"),
            )
            .child(
                div()
                    .text_size(px(12.))
                    .text_color(rgb(MUTED))
                    // No count until it's counted from the rows.
                    .child(if self.table.is_some() {
                        format!(
                            "{} asteroids, and every dot is a row. Dot sizes are exaggerated: at true scale each one is an invisible speck.",
                            grouped(self.rows)
                        )
                    } else {
                        "Loading the asteroids…".to_string()
                    }),
            )
    }

    /// The time control, and the storyboard's actions beside it.
    fn render_controls(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let clock = CLOCK.get();
        let sorted = MOTION.get().to == 1.0;
        div()
            .absolute()
            .left(px(24.))
            .bottom(px(24.))
            .flex()
            .items_center()
            .gap_4()
            .child(
                div()
                    .h(px(28.))
                    .flex()
                    .items_center()
                    .gap_2()
                    .pl_1()
                    .pr(px(10.))
                    .border_1()
                    .border_color(rgb(EDGE))
                    .rounded(px(6.))
                    .bg(rgb(SURFACE))
                    // The scene's surface is under it: a press here isn't a
                    // shape.
                    .occlude()
                    .child(
                        Button::new("time")
                            .ghost()
                            .xsmall()
                            .label(if clock.running { "Pause" } else { "Run" })
                            // gpui-kit's tooltip, over the scene.
                            .tooltip(if clock.running {
                                "Pause time"
                            } else {
                                "Run time"
                            })
                            .on_click(cx.listener(|_, _, _, cx| {
                                let clock = CLOCK.get();
                                CLOCK.set(Clock {
                                    running: !clock.running,
                                    last_ms: f64::NAN,
                                    ..clock
                                });
                                cx.notify();
                            })),
                    )
                    .child(self.date.clone())
                    .child(div().text_size(px(12.)).text_color(rgb(MUTED)).child(
                        if clock.running {
                            "1 year a second"
                        } else {
                            "paused"
                        },
                    )),
            )
            .child(
                action("sort", "Sort by orbit size", sorted)
                    .on_click(cx.listener(|this, _, _, cx| this.toggle_sort(cx))),
            )
    }

    fn render_handle(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("handle")
            .absolute()
            .right_0()
            .top(px(422.))
            .h(px(56.))
            .pl(px(10.))
            .pr(px(14.))
            .flex()
            .flex_col()
            .justify_center()
            .border_1()
            .border_color(rgb(EDGE))
            .rounded_l(px(8.))
            .bg(rgb(SURFACE))
            .cursor_pointer()
            .occlude()
            .on_click(cx.listener(|this, _, _, cx| this.toggle_panel(cx)))
            .child(
                div()
                    .text_size(px(12.))
                    .text_color(rgb(MUTED))
                    .child("Table"),
            )
            .child(div().text_size(px(14.)).child(if self.table.is_some() {
                format!("{} rows", grouped(self.rows))
            } else {
                "Loading rows…".to_string()
            }))
    }

    fn render_panel(&self, table: &Entity<Table>, cx: &mut Context<Self>) -> impl IntoElement {
        let rate = LIVE_RATE.get();
        div()
            .absolute()
            // Slides in from the right edge.
            .right(px(-(1.0 - self.panel_t) * PANEL_WIDTH))
            .top_0()
            .h_full()
            .w(px(PANEL_WIDTH))
            .flex()
            .flex_col()
            .border_l_1()
            .border_color(rgb(EDGE))
            .bg(rgb(SURFACE))
            .occlude()
            .child(
                div()
                    .h(px(40.))
                    .px_2()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        // At the panel's left edge, so its menu opens over
                        // the scene.
                        Button::new("menu")
                            .small()
                            .label("Color")
                            .dropdown_menu_with_anchor(Anchor::TopRight, |menu, _, _| {
                                menu.menu("Orbit size", Box::new(MenuItem))
                                    .menu("Class", Box::new(MenuItem))
                                    .menu("Near-Earth", Box::new(MenuItem))
                                    .separator()
                                    .menu("Potentially hazardous", Box::new(MenuItem))
                            }),
                    )
                    .child(div().flex_1().text_size(px(14.)).child(
                        match (&self.group, self.filtered) {
                            (Some(group), true) => {
                                format!("{} rows in the shape", grouped(group.rows.len()))
                            }
                            _ => format!("{} rows", grouped(self.rows)),
                        },
                    ))
                    .when(self.filtered, |header| {
                        header.child(
                            div().relative().child(target("all-rows")).child(
                                Button::new("all-rows")
                                    .small()
                                    .label("Show all rows")
                                    .on_click(
                                        cx.listener(|this, _, _, cx| this.filter_table(None, cx)),
                                    ),
                            ),
                        )
                    })
                    .child(
                        div().relative().child(target("live-rate")).child(
                            Button::new("live-rate")
                                .small()
                                .label(format!("Live {rate}/s"))
                                .tooltip("How often the live column refreshes")
                                .on_click(cx.listener(|this, _, _, cx| this.cycle_live_rate(cx))),
                        ),
                    )
                    .child(
                        Button::new("close")
                            .ghost()
                            .small()
                            .label("Close")
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_panel(cx))),
                    ),
            )
            .child(div().flex_1().min_h_0().child(TallTable::new(table)))
    }
}

/// One of the storyboard's actions: a button of its own drawing, pressed
/// while its action holds. Its bounds are published under its id.
fn action(id: &'static str, label: &'static str, pressed: bool) -> Stateful<Div> {
    div()
        .id(id)
        .relative()
        .h(px(28.))
        .px(px(10.))
        .flex()
        .items_center()
        .rounded(px(6.))
        .bg(rgb(if pressed { TEXT } else { EDGE }))
        .text_color(rgb(if pressed { SURFACE } else { TEXT }))
        .text_size(px(14.))
        .cursor_pointer()
        // The scene's surface is under it.
        .occlude()
        .child(label)
        .child(target(id))
}

/// Publishes its parent's bounds for `run.ts` (`__seizaTargets[id]`).
fn target(id: &'static str) -> impl IntoElement {
    canvas(
        move |bounds, _, _| seiza::targets::publish(id, bounds),
        |_, _, _, _| {},
    )
    .absolute()
    .size_full()
}

/// The clock's date, a view of its own: while time moves it redraws 4
/// times a second, a rate a person can read (the scene asks the clock every
/// frame), and nothing else in the window redraws with it.
struct DateLabel;

impl DateLabel {
    fn new(cx: &mut Context<Self>) -> Self {
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(250))
                    .await;
                let moved = this.update(cx, |_, cx| {
                    if clock_moves() {
                        // The scene may be drawing nothing (landed in a
                        // against e): time runs all the same.
                        advance_clock(seiza::marks::now());
                        cx.notify();
                    }
                });
                if moved.is_err() {
                    break;
                }
            }
        })
        .detach();
        Self
    }
}

impl Render for DateLabel {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().text_size(px(14.)).child(date(CLOCK.get().years))
    }
}

impl Render for Host {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.step_slide(window);
        let theme = cx.theme();
        let root = div()
            .relative()
            .size_full()
            .text_color(theme.foreground)
            .child(self.render_scene_surface(cx))
            .child(self.render_title())
            .child(self.render_controls(cx))
            .when(self.group.is_some(), |root| {
                root.child(
                    action("whole-belt", "The whole belt", false)
                        .absolute()
                        .left(px(24.))
                        .top(px(104.))
                        .on_click(cx.listener(|this, _, _, cx| this.whole_belt(cx))),
                )
            });
        match &self.table {
            Some(table) if self.panel_t > 0.0 => root.child(self.render_panel(&table.clone(), cx)),
            _ => root.child(self.render_handle(cx)),
        }
    }
}

fn grouped(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// The clock's date, `years` after its start (Hinnant's civil-from-days).
fn date(years: f64) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let z = (START_DAY + years * 365.25).floor() as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year} {} {day:02}", MONTHS[(month - 1) as usize])
}

// ---------------------------------------------------------------- exports

/// Called by the JS host once the wasm and the font are in.
#[wasm_bindgen]
pub fn start(ui_font: Vec<u8>) {
    seiza::Bootstrap::new("Kirkwood: the two canvases", ui_font)
        .after_first_paint(|_, _| first_frame())
        .run(move |_, cx| {
            // The scene is dark, whatever the system is; and nothing is
            // drawn behind the interface: `Root` fills the window with
            // this token.
            seiza::stop_following_system_appearance(cx);
            Theme::change(ThemeMode::Dark, None, cx);
            Theme::global_mut(cx).tokens.background = gpui_kit::transparent_black().into();
            seiza_tall_table::init(cx);
            let host = cx.new(Host::new);
            HOST.set(Some((host.clone(), cx.to_async())));
            host.into()
        });
}

/// The sample's a, e, and i (three f32s a row, little-endian), fetched by
/// the host after the first frame. Builds the six-float rows, the angles
/// seeded (xorshift), and opens the table over them.
#[wasm_bindgen]
pub fn load_elements(bytes: &[u8]) -> usize {
    let rows = bytes.len() / 12;
    let mut elements = Vec::with_capacity(rows * STRIDE);
    let mut seed = 0x9E37_79B9_7F4A_7C15_u64;
    let mut angle = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        ((seed >> 40) as f32 / (1u64 << 24) as f32) * std::f32::consts::TAU
    };
    for row in bytes.as_chunks::<12>().0 {
        for value in row.as_chunks::<4>().0 {
            elements.push(f32::from_le_bytes(*value));
        }
        elements.extend([angle(), angle(), angle()]);
    }
    let elements = Rc::new(elements);
    ELEMENTS.set(elements.clone());
    if let Some((host, mut cx)) = HOST.with_borrow(Clone::clone) {
        host.update(&mut cx, |host, cx| host.loaded(elements, cx));
    }
    rows
}

/// Where the elements are in this module's memory, for the scene's view.
#[wasm_bindgen]
pub fn elements_ptr() -> *const f32 {
    ELEMENTS.with_borrow(|elements| elements.as_ptr())
}

/// The clock, in years since its start, moved on to `now_ms` (the page
/// clock): the scene asks every frame it draws.
#[wasm_bindgen]
pub fn scene_years(now_ms: f64) -> f64 {
    advance_clock(now_ms)
}

/// The sort flight's progress, moved on to `now_ms`: 0 in space, 1 landed
/// in a against e. The scene asks every frame it draws.
#[wasm_bindgen]
pub fn scene_flight(now_ms: f64) -> f64 {
    let mut motion = MOTION.get();
    if motion.flight != motion.to && !motion.last_ms.is_nan() {
        let step = (now_ms - motion.last_ms).clamp(0.0, MAX_STEP_MS) / FLIGHT_MS;
        motion.flight = if motion.to > motion.flight {
            (motion.flight + step).min(1.0)
        } else {
            (motion.flight - step).max(0.0)
        };
    }
    motion.last_ms = now_ms;
    MOTION.set(motion);
    set_state(state::FLIGHT, motion.flight);
    motion.flight
}

/// The panel's width on screen (CSS px): the scene centers in the rest.
#[wasm_bindgen]
pub fn scene_inset() -> f32 {
    MOTION.get().inset
}

/// Whether the scene has a frame to draw: the dots are in flight, or the
/// clock moves and they aren't landed in a against e, where time moves
/// nothing.
#[wasm_bindgen]
pub fn scene_moves() -> bool {
    let motion = MOTION.get();
    motion.flight != motion.to || (clock_moves() && motion.flight != 1.0)
}

/// The camera arrived where it was flown to.
#[wasm_bindgen]
pub fn fly_done() {
    add_state(state::FLOWN);
    if let Some((host, mut cx)) = HOST.with_borrow(Clone::clone) {
        host.update(&mut cx, |host, cx| host.flown(cx));
    }
}

/// For `run.ts`: the group's radius (au, about its own centroid) once the
/// clock has run `years_ahead` more, to say how long a group drawn in space
/// stays one.
#[wasm_bindgen]
pub fn group_radius(years_ahead: f64) -> f64 {
    let elements = ELEMENTS.with_borrow(Clone::clone);
    let group = GROUP.with_borrow(Clone::clone);
    let years = CLOCK.get().years + years_ahead;
    let places: Vec<[f64; 3]> = group
        .iter()
        .filter_map(|&row| {
            let at = row as usize * STRIDE;
            position(&elements[at..at + STRIDE], years)
        })
        .collect();
    extent(&places).1
}

/// For `run.ts`: see `state`.
#[wasm_bindgen]
pub fn spike_state() -> Vec<f64> {
    STATE.with_borrow(|state| state.to_vec())
}
