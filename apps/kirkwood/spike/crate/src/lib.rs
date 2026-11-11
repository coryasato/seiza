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
//! - the tall table over those rows, in a panel behind a handle.
//!
//! `spike_state` is for `run.ts`.

#![cfg(target_family = "wasm")]

use std::cell::{Cell, RefCell};
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::menu::DropdownMenu as _;
use gpui_kit::component::{ActiveTheme as _, Sizable as _, Theme, ThemeMode};
use gpui_kit::*;
use seiza_tall_table::{
    CellValue, ColumnKind, PageLoad, Paging, TallTable, TallTableColumn, TallTableDelegate,
    TallTableEvent, TallTablePage, TallTableSelection, TallTableState,
};
use wasm_bindgen::prelude::*;

/// Floats a row in the elements buffer.
const STRIDE: usize = 6;
const PANEL_WIDTH: f32 = 560.;
/// The storyboard's surfaces (board 1's handle and time control).
const SURFACE: u32 = 0x171717;
const EDGE: u32 = 0x262626;
const MUTED: u32 = 0xa3a3a3;
/// Days from 1970-01-01 to 2026-11-10, where the clock starts.
const START_DAY: f64 = 20767.0;
/// The most the clock moves between two frames the scene draws.
const MAX_STEP_MS: f64 = 100.0;

actions!(kirkwood_spike, [MenuItem]);

#[wasm_bindgen]
extern "C" {
    /// A wheel over the scene, at a window position (CSS px).
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = wheel)]
    fn scene_wheel(x: f32, y: f32, delta: f32);
    /// The first frame is on screen: the host starts the scene and the data.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = firstFrame)]
    fn first_frame();
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

thread_local! {
    static ELEMENTS: RefCell<Rc<Vec<f32>>> = RefCell::new(Rc::new(Vec::new()));
    static CLOCK: Cell<Clock> = const { Cell::new(Clock { years: 0.0, running: true, held: false, last_ms: f64::NAN }) };
    static HOST: RefCell<Option<(Entity<Host>, AsyncApp)>> = const { RefCell::new(None) };
    /// `[panel open, shape points, shape closed, table top row, selected row or -1, table frames filled, tooltip shown]`.
    static STATE: RefCell<[f64; 7]> = const { RefCell::new([0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0]) };
}

fn set_state(index: usize, value: f64) {
    STATE.with_borrow_mut(|state| state[index] = value);
}

// ---------------------------------------------------------------- the rows

struct Rows {
    elements: Rc<Vec<f32>>,
    next: u64,
}

struct Page {
    elements: Rc<Vec<f32>>,
    first: usize,
    rows: usize,
}

impl TallTableDelegate for Rows {
    type Page = Page;
    type Request = u64;

    fn load_page(&mut self, rows: Range<u64>, _: &mut App) -> (u64, PageLoad<Page>) {
        let page = Page {
            elements: self.elements.clone(),
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
        let at = (self.first + row) * STRIDE;
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
            1 => own(a),
            2 => own(e),
            3 => own(i),
            _ if !bound => CellValue::Null,
            0 => CellValue::Float(f64::from(a).powf(1.5)),
            4 => CellValue::Float(f64::from(a) * (1.0 - f64::from(e))),
            _ => CellValue::Float(f64::from(a) * (1.0 + f64::from(e))),
        })
    }

    fn heap_bytes(&self) -> usize {
        // A view over the elements: nothing of its own.
        0
    }
}

fn columns() -> Vec<TallTableColumn> {
    [
        "period (yr)",
        "a (au)",
        "e",
        "i (deg)",
        "nearest (au)",
        "farthest (au)",
    ]
    .into_iter()
    .map(|name| TallTableColumn::new(name, ColumnKind::Float))
    .collect()
}

type Table = TallTableState<Rows>;

// ---------------------------------------------------------------- the host

struct Host {
    table: Option<Entity<Table>>,
    rows: usize,
    panel_open: bool,
    /// The freehand shape, in window pixels; closed once it isn't being
    /// drawn. Shared with the frame's paint, which holds it only for the
    /// frame, so a point added between frames copies nothing.
    shape: Rc<Vec<Point<Pixels>>>,
    drawing: bool,
    date: Entity<DateLabel>,
    _subscriptions: Vec<Subscription>,
}

impl Host {
    fn new(cx: &mut Context<Self>) -> Self {
        Self {
            table: None,
            rows: 0,
            panel_open: false,
            shape: Rc::new(Vec::new()),
            drawing: false,
            date: cx.new(DateLabel::new),
            _subscriptions: Vec::new(),
        }
    }

    fn loaded(&mut self, elements: Rc<Vec<f32>>, cx: &mut Context<Self>) {
        self.rows = elements.len() / STRIDE;
        let rows = Rows { elements, next: 0 };
        let probe = seiza::url::param("probe").is_some();
        let count = self.rows as u64;
        let table = cx.new(|cx| {
            Table::new(rows, columns(), count, Paging::default(), cx).probe_frames(probe)
        });
        self._subscriptions
            .push(cx.subscribe(&table, |_, _, event, _| match event {
                TallTableEvent::Filled { .. } => {
                    STATE.with_borrow_mut(|state| state[5] += 1.0);
                }
                TallTableEvent::Probe(probe) => {
                    set_state(3, probe.top);
                    set_state(6, f64::from(u8::from(probe.tooltip.is_some())));
                }
                TallTableEvent::Selected(selection) => {
                    let row = match selection {
                        Some(TallTableSelection::Cells { anchor, .. })
                        | Some(TallTableSelection::Rows { anchor, .. }) => anchor.0 as f64,
                        _ => -1.0,
                    };
                    set_state(4, row);
                }
                _ => {}
            }));
        self.table = Some(table);
        cx.notify();
    }

    fn toggle_panel(&mut self, cx: &mut Context<Self>) {
        // Nothing to open until the rows are in: a press on the loading
        // handle isn't kept for later.
        if self.table.is_none() {
            return;
        }
        self.panel_open = !self.panel_open;
        set_state(0, f64::from(u8::from(self.panel_open)));
        cx.notify();
    }

    /// The shape's release: it closes, and the clock moves again.
    fn end_shape(&mut self, cx: &mut Context<Self>) {
        if !self.drawing {
            return;
        }
        self.drawing = false;
        CLOCK.set(Clock {
            held: false,
            last_ms: f64::NAN,
            ..CLOCK.get()
        });
        set_state(2, 1.0);
        cx.notify();
    }

    fn render_scene_surface(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let shape = self.shape.clone();
        let closed = !self.drawing;
        div()
            .id("scene")
            .absolute()
            .inset_0()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, _, cx| {
                    this.shape = Rc::new(vec![event.position]);
                    this.drawing = true;
                    CLOCK.set(Clock {
                        held: true,
                        ..CLOCK.get()
                    });
                    set_state(1, 1.0);
                    set_state(2, 0.0);
                    cx.notify();
                }),
            )
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _, cx| {
                if !this.drawing {
                    return;
                }
                if event.pressed_button == Some(MouseButton::Left) {
                    Rc::make_mut(&mut this.shape).push(event.position);
                    set_state(1, this.shape.len() as f64);
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
                        if closed {
                            path.close();
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

    fn render_time(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let clock = CLOCK.get();
        div()
            .absolute()
            .left(px(24.))
            .bottom(px(24.))
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
            // The scene's surface is under it: a press here isn't a shape.
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
            .child(
                div()
                    .text_size(px(12.))
                    .text_color(rgb(MUTED))
                    .child("1 year a second"),
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
        div()
            .absolute()
            .right_0()
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
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(14.))
                            .child(format!("{} rows", grouped(self.rows))),
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
                    let clock = CLOCK.get();
                    if clock.running && !clock.held {
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
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let root = div()
            .relative()
            .size_full()
            .text_color(theme.foreground)
            .child(self.render_scene_surface(cx))
            .child(self.render_title())
            .child(self.render_time(cx));
        match (&self.table, self.panel_open) {
            (Some(table), true) => root.child(self.render_panel(&table.clone(), cx)),
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
    let mut clock = CLOCK.get();
    if clock.running && !clock.held && !clock.last_ms.is_nan() {
        // A frame's worth at most: a tab back from the background, or a
        // stall, doesn't jump the belt by the time it was away.
        clock.years += (now_ms - clock.last_ms).clamp(0.0, MAX_STEP_MS) / 1000.0;
    }
    clock.last_ms = now_ms;
    CLOCK.set(clock);
    clock.years
}

/// Whether the clock moves (running, and no shape being drawn).
#[wasm_bindgen]
pub fn clock_moves() -> bool {
    let clock = CLOCK.get();
    clock.running && !clock.held
}

/// For `run.ts`: see `STATE`.
#[wasm_bindgen]
pub fn spike_state() -> Vec<f64> {
    STATE.with_borrow(|state| state.to_vec())
}
