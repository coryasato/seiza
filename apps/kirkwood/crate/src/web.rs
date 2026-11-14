//! The page's side of the crate: the entry point, the two files' arrival,
//! and what the scene asks. The page asks for each file after the first
//! frame and writes the response into this module's memory as it comes
//! ([`file_begin`]), so a file is held once: no copy on the page's side,
//! and none here. The elements are read as they arrive
//! ([`elements_arrived`]): the scene fills its attributes from views over
//! each block of rows where it lies ([`elements_blocks`]), and says how
//! far it has drawn ([`belt_drawn`]). Each frame it asks for the clock
//! ([`scene_years`]), the sort flight ([`scene_flight`]), the ride with
//! Jupiter ([`scene_ride`]), and for what else it draws by.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::*;
use wasm_bindgen::prelude::*;

use crate::bytes::Bytes;
use crate::catalog::Catalog;
use crate::clock;
use crate::elements::{Element, Elements};
use crate::find;
use crate::flight;
use crate::gap;
use crate::group::{self, Stepped};
use crate::host::Host;
use crate::integrate::{self, Moved};
use crate::layout::{self, Plot};
use crate::orbit::{JUPITER, Orbit};
use crate::ramp;
use crate::ride;
use crate::rows::{Rows, day_of};
use crate::scene;

/// The least time between two redraws for the files' progress.
const PROGRESS_EVERY_MS: f64 = 100.0;
/// The places Jupiter's orbit is drawn through.
const ORBIT_POINTS: usize = 256;
/// What the table's head keeps of the panel's fill, over the glass: the
/// table draws its columns' names dimmer than its cells, and over dust in
/// full color they couldn't be read with none (`docs/DECISIONS.md`,
/// "Table").
const GLASS_HEAD: f32 = 0.85;

/// The most time one frame's call spends stepping the two groups toward
/// the clock, when the clock has jumped: the rest waits for the next.
const INTEGRATE_MS: f64 = 8.0;
/// The most time one frame's call spends on a drawn group's rows: placing
/// them while the shape is drawn, and testing them against it once it's
/// closed (`docs/DECISIONS.md`, "Scene").
const PICK_MS: f64 = 6.0;

/// Set once each file is held and read as one.
const ELEMENTS_MARK: &str = "kirkwood:elements";
const ROWS_MARK: &str = "kirkwood:rows";

/// The files, as the page names them to [`file_begin`] and [`file_end`].
const ELEMENTS: u8 = 0;
const ROWS: u8 = 1;

#[wasm_bindgen]
extern "C" {
    /// The first frame is on screen: the page asks for the scene's module
    /// and the files.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = firstFrame)]
    fn first_frame();

    /// A wheel over the scene, at a window position (CSS px), with the
    /// modifiers held (`scene::modifiers`), for the camera of a frame
    /// (`scene::Frame`).
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = wheel)]
    pub fn scene_wheel(x: f32, y: f32, delta: f32, modifiers: u8, frame: u8);

    /// A double click on the scene, at a window position.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = doubleClick)]
    pub fn scene_double_click(x: f32, y: f32, frame: u8);

    /// A press anywhere in the window.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = press)]
    pub fn scene_press();

    /// A drag on the scene: its start (the button, the modifiers, the
    /// frame), its moves, its end, at window positions (CSS px).
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = dragStart)]
    pub fn scene_drag_start(x: f32, y: f32, button: u8, modifiers: u8, frame: u8);
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = dragMove)]
    pub fn scene_drag_move(x: f32, y: f32);
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = dragEnd)]
    pub fn scene_drag_end(x: f32, y: f32);

    /// An arrow key (`right` and `up` each -1, 0, or 1), the + or − key,
    /// and the way home, each for the camera of a frame.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = nudge)]
    pub fn scene_nudge(right: i8, up: i8, frame: u8);
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = zoomStep)]
    pub fn scene_zoom_step(nearer: bool, frame: u8);
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = home)]
    pub fn scene_home(frame: u8);

    /// A shape drawn in the lasso's mode: its start, its next point (window
    /// positions, CSS px), and its release (closed, or gone).
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = drawStart)]
    pub fn scene_draw_start(x: f32, y: f32);
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = drawMove)]
    pub fn scene_draw_move(x: f32, y: f32);
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = drawEnd)]
    pub fn scene_draw_end(closed: bool);

    /// The scene's camera as it is: projection × view (column-major), then
    /// the window's width and height. Empty before the scene is up.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = camera)]
    pub fn scene_camera() -> Vec<f64>;

    /// A click on the scene, at a window position (CSS px): the row whose
    /// dot the scene drew nearest it, within its reach, or -1.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = click)]
    pub fn scene_click(x: f32, y: f32) -> i32;

    /// Whether the hint was folded on an earlier visit, and that it is
    /// now: the page's to remember.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = hintFolded)]
    pub fn hint_folded() -> bool;
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = foldHint)]
    pub fn fold_hint();
}

thread_local! {
    static HOST: RefCell<Option<(Entity<Host>, AsyncApp)>> = const { RefCell::new(None) };
    /// The rows file, while the page is writing into it.
    static ARRIVING: RefCell<Option<Bytes>> = const { RefCell::new(None) };
    /// The elements, while the page is writing into them: read a block at
    /// a time as each is whole, so the scene draws the belt as it arrives.
    static FILLING: RefCell<Option<Elements>> = const { RefCell::new(None) };
    /// The elements, from the moment they're all held: the table reads the
    /// ones the scene drew from.
    static HELD: RefCell<Option<Rc<Elements>>> = const { RefCell::new(None) };
    /// The rows the scene has drawn so far, as it last said.
    static DRAWN: Cell<usize> = const { Cell::new(0) };
    static PROGRESS_AT: Cell<f64> = const { Cell::new(f64::NEG_INFINITY) };
    /// The Hildas and the Trojans, moved under the Sun and Jupiter: made
    /// when the scene first asks for their rows, once the elements are held.
    static MOVED: RefCell<Option<Moved>> = const { RefCell::new(None) };
    /// What the last drawn group cost: the milliseconds its rows took to
    /// place and to test against the shape, the calls those were spread
    /// over, the longest of them, and from the release to the group.
    static PICK: Cell<[f64; 5]> = const { Cell::new([0.0; 5]) };
    /// The page clock at the last release, and the scene's camera then.
    static RELEASED: Cell<f64> = const { Cell::new(f64::NAN) };
}

/// The elements, whole or still arriving; nothing before the page begins
/// them.
fn with_elements<R>(read: impl FnOnce(&Elements) -> R) -> Option<R> {
    if let Some(held) = HELD.with_borrow(Clone::clone) {
        return Some(read(&held));
    }
    FILLING.with_borrow(|filling| filling.as_ref().map(read))
}

fn update_host(update: impl FnOnce(&mut Host, &mut Context<Host>)) {
    if let Some((host, mut cx)) = HOST.with_borrow(Clone::clone) {
        host.update(&mut cx, update);
    }
}

/// Called by the page once the wasm and the font are in.
#[wasm_bindgen]
pub fn start(ui_font: Vec<u8>) {
    // The clock starts today, or at `?date=YYYY-MM-DD`; `?paused` holds it
    // there, for a screenshot of one date.
    // Today is the visitor's own calendar day, not UTC's.
    let now = js_sys::Date::new_0();
    let today = format!(
        "{:04}-{:02}-{:02}",
        now.get_full_year(),
        now.get_month() + 1,
        now.get_date()
    );
    let day = seiza::url::param("date")
        .and_then(|date| day_of(&date))
        .or_else(|| day_of(&today))
        .map_or_else(
            || (js_sys::Date::now() / 86_400_000.0).floor(),
            |day| day as f64,
        );
    clock::start(day, !seiza::url::has_param("paused"));
    seiza::Bootstrap::new("Kirkwood", ui_font)
        .after_first_paint(|_, _| first_frame())
        .run(move |_, cx| {
            // The scene is dark, whatever the system is; and nothing is
            // drawn behind the interface: `Root` fills the window with
            // this token, and the scene's canvas (until it draws, the
            // page's own background) shows through.
            seiza::stop_following_system_appearance(cx);
            Theme::change(ThemeMode::Dark, None, cx);
            Theme::global_mut(cx).tokens.background = gpui_kit::transparent_black().into();
            // Text in gray, never subpixel. On a GPU with dual-source
            // blending GPUI draws subpixel text in a window it takes for
            // opaque (this one: it's made clear by hand), blending each
            // channel and leaving the canvas's alpha as it was: over
            // nothing that's 0, and the text is composited away. Headless
            // Chromium has no such blending, so no check sees it.
            cx.set_text_rendering_mode(TextRenderingMode::Grayscale);
            // The panel is glass (unless `?glass=1`): the table's own fills let the panel's show (and
            // through it the scene), its stripes half as strong. Its head
            // keeps a fill of its own: the columns' names are the muted
            // color, which over dust in full color can't be read
            // (`docs/DECISIONS.md`, "Table").
            if crate::host::GLASS.is_some() {
                let theme = Theme::global_mut(cx);
                theme.tokens.table = gpui_kit::transparent_black().into();
                theme.tokens.table_head = theme.popover.opacity(GLASS_HEAD).into();
                theme.table_even = theme.table_even.opacity(0.5);
            }
            seiza_tall_table::init(cx);
            let host = cx.new(Host::new);
            HOST.set(Some((host.clone(), cx.to_async())));
            host.into()
        });
}

/// Room for `file`, `bytes` bytes long, and where to write it: the page
/// copies each piece of the response there as it arrives. The address
/// holds until [`file_end`] (the elements' for the page's life); the page
/// makes its view over the memory anew for each piece, since the memory
/// growing detaches one. Null for a file there isn't.
#[wasm_bindgen]
pub fn file_begin(file: u8, bytes: usize) -> *mut u8 {
    match file {
        ELEMENTS => {
            let mut elements = Elements::arriving(bytes);
            let at = elements.as_mut_ptr();
            FILLING.set(Some(elements));
            at
        }
        ROWS => {
            let mut rows = Bytes::zeroed(bytes);
            let at = rows.as_mut_ptr();
            ARRIVING.set(Some(rows));
            at
        }
        _ => std::ptr::null_mut(),
    }
}

/// The elements file's first `held` bytes are written. Returns the rows
/// that are whole so far: the file is in blocks of rows, and the scene
/// draws each block as it's whole ([`elements_blocks`]). Throws if the
/// header, once it's in, isn't this file's.
#[wasm_bindgen]
pub fn elements_arrived(held: usize) -> Result<usize, JsError> {
    FILLING.with_borrow_mut(|filling| match filling {
        Some(elements) => elements.arrived(held).map_err(|why| JsError::new(&why)),
        None => Err(JsError::new("no elements file was arriving")),
    })
}

/// The bytes held so far, of both files' together.
#[wasm_bindgen]
pub fn file_progress(received: f64, total: f64) {
    let now = seiza::marks::now();
    if received < total && now - PROGRESS_AT.get() < PROGRESS_EVERY_MS {
        return;
    }
    PROGRESS_AT.set(now);
    update_host(|host, cx| host.progress(received, total, cx));
}

/// The file [`file_begin`] made room for is whole. Returns why it isn't
/// one, or nothing. With the elements held the scene has every block;
/// with both files, the table opens.
#[wasm_bindgen]
pub fn file_end(file: u8) -> Option<String> {
    match file {
        ELEMENTS => {
            let Some(elements) = FILLING.take() else {
                return Some("no elements file was arriving".into());
            };
            if !elements.is_whole() {
                return Some(format!(
                    "the elements file ended with {} of its {} rows",
                    elements.whole(),
                    elements.rows()
                ));
            }
            HELD.set(Some(Rc::new(elements)));
            seiza::marks::mark(ELEMENTS_MARK);
            None
        }
        ROWS => {
            let Some(bytes) = ARRIVING.take() else {
                return Some("no rows file was arriving".into());
            };
            let Some(elements) = HELD.with_borrow(Clone::clone) else {
                return Some("the rows file arrived before the elements".into());
            };
            match Rows::new(bytes).and_then(|rows| Catalog::new(elements, rows)) {
                Ok(catalog) => {
                    seiza::marks::mark(ROWS_MARK);
                    let catalog = Rc::new(catalog);
                    update_host(|host, cx| host.loaded(catalog, cx));
                    None
                }
                Err(why) => Some(why),
            }
        }
        _ => Some(format!("no file {file}")),
    }
}

/// A file didn't arrive, or [`file_end`] turned it down: the page says so.
/// Elements that stopped short are let go of, with whatever of the belt
/// they'd drawn (the page clears the scene's): a dot is a row of a table
/// that can open.
#[wasm_bindgen]
pub fn file_failed(message: String) {
    ARRIVING.set(None);
    if FILLING.take().is_some() {
        DRAWN.set(0);
    }
    update_host(|host, cx| host.failed(message, cx));
}

// --- What the scene asks. None of these enters GPUI but `belt_drawn`,
// `sky_drawn`, `scene_failed`, `flight_hold`, `ride_hold`, and `gap_hold`, which the page
// calls from its own tasks, never from inside a call Rust made.

/// The blocks holding the elements' rows `from..to`, each as two numbers:
/// where it is in this memory, and its rows. A block is
/// [`elements_columns`] runs of that many 32-bit floats, end to end (a, e,
/// i, the node, the argument of perihelion, the mean anomaly, H). The
/// scene fills its attributes from views over them, so the upload to the
/// GPU is the only copy. An address holds for the page's life; a view over
/// it doesn't (the memory growing detaches one), so the scene makes its
/// views and uploads them with no call in here between. `from` and `to`
/// are rows [`elements_arrived`] has returned (or 0).
#[wasm_bindgen]
pub fn elements_blocks(from: usize, to: usize) -> Vec<u32> {
    with_elements(|elements| {
        elements
            .blocks(from, to)
            .into_iter()
            .flat_map(|(at, rows)| [at as usize as u32, rows as u32])
            .collect()
    })
    .unwrap_or_default()
}

/// The elements' rows, as the file's header says; 0 before it's in.
#[wasm_bindgen]
pub fn elements_rows() -> usize {
    with_elements(Elements::rows).unwrap_or(0)
}

/// The rows whose block is whole: what the scene can draw.
#[wasm_bindgen]
pub fn elements_whole() -> usize {
    with_elements(Elements::whole).unwrap_or(0)
}

/// The columns of a block ([`elements_blocks`]).
#[wasm_bindgen]
pub fn elements_columns() -> usize {
    Element::COUNT
}

/// The clock, moved on to `now_ms` (the page clock): years since the
/// elements' epoch. The scene asks every frame, and draws when the answer
/// is new.
#[wasm_bindgen]
pub fn scene_years(now_ms: f64) -> f64 {
    clock::advance(now_ms)
}

/// The sort flight, moved on to `now_ms` (the page clock): 0 in space, 1
/// landed in a against e. The scene asks every frame, and its shader
/// places each dot by it.
#[wasm_bindgen]
pub fn scene_flight(now_ms: f64) -> f64 {
    flight::advance(now_ms)
}

/// How much of what isn't a row the scene still draws (the sky, the Sun,
/// Jupiter, its orbit, their names): 1 in space, 0 with the dots landed.
#[wasm_bindgen]
pub fn scene_space() -> f64 {
    flight::space()
}

/// The axes the dots land on: the least a and the most (au), then the
/// least e and the most. A row past either has no place there.
#[wasm_bindgen]
pub fn scene_axes() -> Vec<f32> {
    [layout::A, layout::E]
        .into_iter()
        .flatten()
        .map(|end| end as f32)
        .collect()
}

/// Where those axes are in a window `width` by `height` (CSS px), in what
/// the panel leaves of it, in the window's clip space, as the shader takes
/// them: the x of the least a and the y of the least e, then those of the
/// most.
#[wasm_bindgen]
pub fn scene_plot(width: f64, height: f64) -> Vec<f32> {
    Plot::in_window(width, height, f64::from(scene::inset()))
        .clip(width, height)
        .to_vec()
}

/// `?flight=<0 to 1>`: holds the sort flight there, for a screenshot of
/// one moment of it. The page reads the knob (one that isn't a number is
/// its error) and calls this from its own task.
#[wasm_bindgen]
pub fn flight_hold(progress: f64) {
    flight::hold(progress);
    update_host(|_, cx| cx.notify());
}

/// The ride with Jupiter, moved on to `now_ms` (the page clock): how far
/// the frame has turned to Jupiter's, 0 fixed with the camera where it
/// was, 1 turning with Jupiter from straight above. The scene asks every
/// frame, and flies its camera by it.
#[wasm_bindgen]
pub fn scene_ride(now_ms: f64) -> f64 {
    ride::advance(now_ms);
    ride::turned()
}

/// How much of the sky the scene still draws: none with the dots landed,
/// and none in the frame that turns with Jupiter.
#[wasm_bindgen]
pub fn scene_sky() -> f64 {
    flight::space() * ride::sky()
}

/// The three points in step with Jupiter, `years` after the epoch: 60°
/// ahead of it, 60° behind, and opposite, at its own orbit size (x, y, z
/// of each, au). The ride's names and its triangle are placed on them.
#[wasm_bindgen]
pub fn ride_points(years: f64) -> Vec<f64> {
    ride::points(years).into_iter().flatten().collect()
}

/// The two groups the ride lights, as the shader takes them: the Hildas'
/// least orbit size and most (au), the Trojans' least and most, and the
/// Trojans' most e.
#[wasm_bindgen]
pub fn ride_groups() -> Vec<f32> {
    ride::bounds().to_vec()
}

/// `?ride=<0 to 1>`: holds the ride there, for a screenshot of one moment
/// of it. Called from the page's own task, as [`flight_hold`] is.
#[wasm_bindgen]
pub fn ride_hold(progress: f64) {
    ride::hold(progress);
    update_host(|_, cx| cx.notify());
}

/// A picked gap, moved on to `now_ms` (the page clock): how much of the
/// ride's own names, triangle, and light it has taken away, 0 with no gap
/// and 1 by the time half of one is there (the marker comes in over the
/// other half: [`scene_gap_lit`]). Asked after [`scene_ride`].
#[wasm_bindgen]
pub fn scene_gap(now_ms: f64) -> f64 {
    gap::advance(now_ms);
    gap::groups_gone()
}

/// How much of the marker, its path, and the dim under them the scene
/// draws: as the ride's light comes in, and only in space.
#[wasm_bindgen]
pub fn scene_gap_lit() -> f64 {
    gap::lit()
}

/// The gap the marker is at (or was last): 0 to 3, in the order of the
/// sort's chips.
#[wasm_bindgen]
pub fn gap_marker() -> usize {
    gap::marker()
}

/// Where a gap's marker is, `years` after the epoch: x, y, z in au. It
/// isn't a row: its orbit is the crate's own, exactly in step with
/// Jupiter. Empty for a gap there isn't.
#[wasm_bindgen]
pub fn gap_place(picked: usize, years: f64) -> Vec<f64> {
    if picked >= layout::GAPS.len() {
        return Vec::new();
    }
    gap::place(picked, years).to_vec()
}

/// A gap's marker's path in the frame that turns with Jupiter, a closed
/// curve: the x (along Jupiter's line from the Sun) and y (the way Jupiter
/// goes) of each place, au. The scene turns it by Jupiter's longitude.
#[wasm_bindgen]
pub fn gap_path(picked: usize) -> Vec<f32> {
    if picked >= layout::GAPS.len() {
        return Vec::new();
    }
    gap::path(picked)
        .into_iter()
        .flatten()
        .map(|au| au as f32)
        .collect()
}

/// `?gap=<0 to 3>`: holds that gap picked, for a screenshot (with
/// `?ride=1`). Called from the page's own task, as [`ride_hold`] is.
#[wasm_bindgen]
pub fn gap_hold(picked: usize) {
    gap::hold(picked);
    update_host(|_, cx| cx.notify());
}

/// `?markerE=<e>`: another eccentricity for the marker, to be looked at.
#[wasm_bindgen]
pub fn gap_e(e: f64) {
    gap::set_e(e);
}

/// The rows the integration moves (the Hildas and the Trojans with an
/// ellipse), in the file's order: the order of their places
/// ([`scene_integrated`]) and of their columns ([`integrated_columns`]).
/// Empty until the elements are held whole. The first call makes their
/// states, each row where its ellipse puts it on the epoch.
#[wasm_bindgen]
pub fn integrated_rows() -> Vec<u32> {
    let Some(elements) = HELD.with_borrow(Clone::clone) else {
        return Vec::new();
    };
    MOVED.with_borrow_mut(|moved| {
        moved
            .get_or_insert_with(|| Moved::new(&elements, elements.grouped()))
            .rows()
            .to_vec()
    })
}

/// What the scene draws those rows by, beside their places: each row's a,
/// then each row's e, node, argument of perihelion, and H, as the file
/// holds them. A copy, made once.
#[wasm_bindgen]
pub fn integrated_columns() -> Vec<f32> {
    let Some(elements) = HELD.with_borrow(Clone::clone) else {
        return Vec::new();
    };
    MOVED.with_borrow(|moved| {
        let rows = moved.as_ref().map_or(&[][..], Moved::rows);
        [
            Element::A,
            Element::E,
            Element::Node,
            Element::Perihelion,
            Element::H,
        ]
        .into_iter()
        .flat_map(|element| rows.iter().map(move |&row| (element, row)))
        .map(|(element, row)| elements.get(element, row as usize))
        .collect()
    })
}

/// The two groups' rows moved to `years` on the clock: where their places
/// are in this memory (x, y, z of each in au, 32-bit floats, in the order
/// of [`integrated_rows`]), or 0 while they aren't there yet. The clock
/// running, that's a step now and then; after a jump of the clock it's
/// many, taken a few milliseconds a call, and the scene draws the rows on
/// their ellipses until they're in. With `draw` false the rows are stepped
/// and no place is worked out (nothing of space is drawn). The address
/// holds for the page's life; a view over it doesn't, so the scene makes
/// its view and uploads it with no call in here between.
#[wasm_bindgen]
pub fn scene_integrated(years: f64, draw: bool) -> u32 {
    MOVED.with_borrow_mut(|moved| {
        let Some(moved) = moved else {
            return 0;
        };
        let started = seiza::marks::now();
        while !moved.toward(years, 1) {
            if seiza::marks::now() - started > INTEGRATE_MS {
                return 0;
            }
        }
        if !draw {
            return 0;
        }
        moved
            .places(years)
            .map_or(0, |places| places.as_ptr() as usize as u32)
    })
}

/// The panel's width on screen (CSS px): the scene centers in the rest.
#[wasm_bindgen]
pub fn scene_inset() -> f32 {
    scene::inset()
}

/// Where the page's text lies over the scene (left, top, width, height,
/// CSS px): the scene quiets its picture there. Asked for when
/// [`scene_scrim_changes`] has moved, not every frame.
#[wasm_bindgen]
pub fn scene_scrim() -> Vec<f32> {
    scene::scrim().to_vec()
}

/// How many times the text's bounds have changed: a plain number, read
/// every frame.
#[wasm_bindgen]
pub fn scene_scrim_changes() -> u32 {
    scene::scrim_changes()
}

/// A dot's color by its orbit size: for each stop its a in au, then its
/// red, green, and blue in linear light. The legend is drawn from the same
/// table.
#[wasm_bindgen]
pub fn orbit_ramp() -> Vec<f32> {
    ramp::table()
}

/// Where Jupiter is, `years` after the epoch: heliocentric ecliptic x, y,
/// z in au. It isn't a row: its orbit is the crate's own.
#[wasm_bindgen]
pub fn jupiter_place(years: f64) -> Vec<f64> {
    JUPITER.place(years).to_vec()
}

/// Jupiter's orbit, for a line: x, y, z of each of its places, one turn.
#[wasm_bindgen]
pub fn jupiter_orbit() -> Vec<f32> {
    JUPITER
        .outline(ORBIT_POINTS)
        .into_iter()
        .flatten()
        .map(|au| au as f32)
        .collect()
}

/// The scene has drawn the elements' first `rows` rows (whole blocks, as
/// [`elements_arrived`] counted them): what the page counts is counted
/// from those rows. With every row drawn the counts are the belt's, and
/// time starts to move.
#[wasm_bindgen]
pub fn belt_drawn(rows: usize) {
    let Some((dots, in_view, of)) = with_elements(|elements| {
        (
            elements.bound_before(rows),
            elements.in_view_before(rows),
            elements.rows(),
        )
    }) else {
        return;
    };
    DRAWN.set(rows);
    update_host(|host, cx| {
        if rows == of {
            host.belt_drawn(dots, of - dots, in_view, cx);
        } else {
            host.belt_filling(dots, of, in_view, cx);
        }
    });
}

/// The sky is drawn behind the belt: the page says whose stars they are,
/// and that they aren't rows.
#[wasm_bindgen]
pub fn sky_drawn() {
    update_host(|host, cx| host.sky_drawn(cx));
}

/// The scene didn't start: the page says so.
#[wasm_bindgen]
pub fn scene_failed(message: String) {
    update_host(|host, cx| host.scene_failed(message, cx));
}

/// The camera as the scene just drew it, for the compass: how far it
/// stands round from where it opened and its tilt from straight down
/// (degrees), and whether a hand has moved a camera yet, which folds the
/// hint. Called from a frame of the scene's own, when one of them changed.
#[wasm_bindgen]
pub fn camera_seen(turned: f32, tilt: f32, moved: bool) {
    update_host(|host, cx| host.camera_seen(turned, tilt, moved, cx));
}

/// The row the scene marks and flies its camera to: the found row, if it
/// has a dot; -1 with none. A plain number, read every frame.
#[wasm_bindgen]
pub fn scene_found() -> f64 {
    find::marked().map_or(-1.0, |row| row as f64)
}

/// How many times a row has been found: the scene's camera flies when
/// this moves. A plain number, read every frame.
#[wasm_bindgen]
pub fn scene_finds() -> u32 {
    find::finds()
}

/// Where the marked row is, `years` after the epoch: x, y, z in au, in
/// 64-bit floats, where the scene draws its dot. With `integrated` (the
/// scene is drawing the Hildas and the Trojans from [`scene_integrated`]'s
/// places this frame), one of those rows is where the integration has it,
/// read from the rows the scene's own are (no row is stepped for this);
/// any other row, and those rows while they're drawn on their ellipses, is
/// on its ellipse. Empty with no row marked.
#[wasm_bindgen]
pub fn found_place(years: f64, integrated: bool) -> Vec<f64> {
    find::marked()
        .and_then(|row| drawn_place(row, years, integrated))
        .map_or_else(Vec::new, |place| place.to_vec())
}

/// Where the scene draws a row's dot, `years` after the epoch
/// ([`found_place`]); nothing for a row with no ellipse.
fn drawn_place(row: usize, years: f64, integrated: bool) -> Option<[f64; 3]> {
    let moved = integrated
        .then(|| {
            MOVED.with_borrow(|moved| {
                let moved = moved.as_ref()?;
                let at = moved.rows().binary_search(&(row as u32)).ok()?;
                moved.place(at, years)
            })
        })
        .flatten();
    moved.or_else(|| {
        with_elements(|elements| {
            Some(elements)
                .filter(|elements| row < elements.whole())
                .and_then(|elements| Orbit::of_row(elements, row))
                .map(|orbit| orbit.place(years))
        })
        .flatten()
    })
}

/// The found row's name, from the rows file: what its mark says.
#[wasm_bindgen]
pub fn found_name() -> String {
    find::name()
}

/// A drawn group's work, a frame's worth ([`PICK_MS`]): in the lasso's
/// mode the rows are placed on the clock's paused years, and once a shape
/// is closed each is tested against it through the scene's camera. Returns
/// how many times the group, or a release's fate, has changed: the scene
/// asks for the group again ([`group_bytes`]) when that has moved. Called
/// every frame from the scene's own, never from a call the crate made: a
/// group picked updates the interface.
#[wasm_bindgen]
pub fn scene_pick() -> u32 {
    if !(group::mode() || group::pending()) {
        return group::changes();
    }
    let Some(elements) = HELD.with_borrow(Clone::clone) else {
        return group::changes();
    };
    let years = clock::years();
    // After a jump of the clock the Hildas and the Trojans are drawn on
    // their ellipses for some frames, then where the integration has them
    // (`scene_integrated`, which the scene asks every frame): the pick
    // waits for them, so a row is picked where it stays drawn.
    if MOVED.with_borrow(|moved| moved.as_ref().is_some_and(|moved| !moved.is_at(years))) {
        return group::changes();
    }
    let started = seiza::marks::now();
    let (was_pending, placed) = (group::pending(), group::placed());
    if placed == 0 && !was_pending {
        PICK.set([0.0; 5]);
        RELEASED.set(f64::NAN);
    }
    // A release's own cost starts with it: a shape before it in this
    // mode, which picked no rows, isn't counted in this one's test.
    if was_pending && RELEASED.get().is_nan() {
        RELEASED.set(started);
        let [place, _, calls, longest, _] = PICK.get();
        PICK.set([place, 0.0, calls, longest, 0.0]);
    }
    let stepped = group::step(
        years,
        elements.rows(),
        |row| Orbit::of_row(&elements, row).map(|orbit| orbit.place(years)),
        // The Hildas and the Trojans, where the scene draws them: the
        // integration's places, while its rows are at the clock.
        || {
            MOVED.with_borrow(|moved| {
                let Some(moved) = moved else {
                    return Vec::new();
                };
                moved
                    .rows()
                    .iter()
                    .enumerate()
                    .filter_map(|(at, &row)| Some((row, moved.place(at, years)?)))
                    .collect()
            })
        },
        || seiza::marks::now() - started > PICK_MS,
    );
    let now = seiza::marks::now();
    let took = now - started;
    if stepped != Stepped::Idle {
        let [mut place, mut test, mut calls, mut longest, mut since] = PICK.get();
        // (A call that finishes the placing and begins the test counts as
        // the test's.)
        if was_pending {
            test += took;
        } else {
            place += took;
        }
        calls += 1.0;
        longest = f64::max(longest, took);
        if let Stepped::Picked(_) = stepped {
            since = now - RELEASED.replace(f64::NAN);
        }
        PICK.set([place, test, calls, longest, since]);
    }
    if let Stepped::Picked(_) = stepped {
        update_host(|host, cx| host.group_picked(cx));
    }
    group::changes()
}

/// The group, for the scene: where its bytes are in this memory (one a
/// row of the file, 1 in the group), or 0 with no group. The address holds
/// while the group does; a view over it doesn't, so the scene asks for
/// this last and uploads its view with no call in here between.
#[wasm_bindgen]
pub fn group_bytes() -> u32 {
    group::with(|group| group.bytes.as_ptr() as usize as u32).unwrap_or(0)
}

/// The group's closed shape as it was drawn: the x and y of each point,
/// window positions (CSS px). Empty with no group.
#[wasm_bindgen]
pub fn group_shape() -> Vec<f32> {
    group::with(|group| group.shape.iter().flatten().copied().collect()).unwrap_or_default()
}

/// The clock's years the group was drawn on: its outline is true there.
#[wasm_bindgen]
pub fn group_years() -> f64 {
    group::with(|group| group.years).unwrap_or(f64::NAN)
}

/// What the chip at the shape says: the group's rows, counted.
#[wasm_bindgen]
pub fn group_chip() -> String {
    group::with(|group| crate::host::group_line(group.rows.len())).unwrap_or_default()
}

/// Where a drawn group's dots were in the window it was drawn in, the
/// middle of them: left, top, right, bottom (CSS px). The scene's camera
/// flies in until that fills what the panel leaves. Empty with no group,
/// for a row picked by a click (it's flown to as a found row is), and with
/// the flight in turned off (`?fly=0`).
#[wasm_bindgen]
pub fn group_fit() -> Vec<f32> {
    if !*crate::host::FLY_IN {
        return Vec::new();
    }
    group::with(|group| group.fit.map_or_else(Vec::new, |fit| fit.to_vec())).unwrap_or_default()
}

/// The panel's width once its slide is over (CSS px): what a flight in
/// fits its picture beside.
#[wasm_bindgen]
pub fn scene_inset_to() -> f32 {
    scene::inset_to()
}

/// How long the flight in to a group takes, and the flight back, ms: the
/// time the panel slides in over.
#[wasm_bindgen]
pub fn scene_fly_ms() -> f64 {
    crate::host::FLY_IN_MS
}

/// How many times a group's way back has been taken: the camera flies back
/// to where it was before the flight in when this has moved with the group
/// let go.
#[wasm_bindgen]
pub fn scene_backs() -> u32 {
    scene::backs()
}

/// The group's biggest bodies, which the scene names on their dots: their
/// rows, biggest first. Empty with no group, or none of its rows measured.
#[wasm_bindgen]
pub fn group_named() -> Vec<u32> {
    group::named_rows()
}

/// What each of those names says: the body's name, then its diameter.
#[wasm_bindgen]
pub fn group_names() -> Vec<String> {
    group::named()
        .into_iter()
        .flat_map(|named| [named.name, named.size])
        .collect()
}

/// Where each named body's dot is drawn, `years` after the epoch: x, y, z
/// of each, au, in the order of [`group_named`] (as [`found_place`] has a
/// found row's).
#[wasm_bindgen]
pub fn named_places(years: f64, integrated: bool) -> Vec<f64> {
    group::named_rows()
        .into_iter()
        .flat_map(|row| drawn_place(row as usize, years, integrated).unwrap_or([f64::NAN; 3]))
        .collect()
}

// --- For the checks (`checks/see.ts`).

/// The lasso and its group: whether the mode is on, a shape is being
/// drawn, and a release waits for its rows; the group's rows (-1 with
/// none); how many times it has changed; the rows placed so far; and
/// whether the group held was drawn (a shape, not a click on a dot).
#[wasm_bindgen]
pub fn group_state() -> Vec<f64> {
    vec![
        f64::from(u8::from(group::mode())),
        f64::from(u8::from(group::drawing())),
        f64::from(u8::from(group::pending())),
        group::rows().map_or(-1.0, |rows| rows.len() as f64),
        f64::from(group::changes()),
        group::placed() as f64,
        f64::from(u8::from(group::drawn())),
    ]
}

/// The panel: whether it's open, and what its header's second line says
/// of a drawn group (its rows by class); empty with none.
#[wasm_bindgen]
pub fn panel_state() -> Vec<String> {
    let Some((host, cx)) = HOST.with_borrow(Clone::clone) else {
        return Vec::new();
    };
    host.read_with(&cx, |host, _| {
        vec![host.panel_is_open().to_string(), host.class_line()]
    })
}

/// What the last drawn group cost, ms: its rows' placing, their test
/// against the shape, the calls those were spread over, the longest call,
/// and from the release to the group.
#[wasm_bindgen]
pub fn group_cost() -> Vec<f64> {
    PICK.get().to_vec()
}

/// The group's rows, in the file's order.
#[wasm_bindgen]
pub fn group_rows() -> Vec<u32> {
    group::rows().map_or_else(Vec::new, |rows| rows.to_vec())
}

/// The table: its rows, and its sort (the column, or -1, and whether it's
/// descending). Empty before the rows are held.
#[wasm_bindgen]
pub fn table_state() -> Vec<f64> {
    let Some((host, cx)) = HOST.with_borrow(Clone::clone) else {
        return Vec::new();
    };
    host.read_with(&cx, |host, cx| host.table_rows(cx))
        .map_or_else(Vec::new, |(rows, sort)| {
            vec![
                rows as f64,
                sort.map_or(-1.0, |(column, _)| column as f64),
                f64::from(u8::from(sort.is_some_and(|(_, descending)| descending))),
            ]
        })
}

/// The file rows at the table's rows `from..to`, in its order.
#[wasm_bindgen]
pub fn table_file_rows(from: usize, to: usize) -> Vec<u32> {
    let Some((host, cx)) = HOST.with_borrow(Clone::clone) else {
        return Vec::new();
    };
    host.read_with(&cx, |host, _| {
        (from..to)
            .map_while(|at| host.file_row(at))
            .map(|row| row as u32)
            .collect()
    })
}

/// The table sorted by a column (`column` -1: the file's order), as a
/// press on its arrow sorts it. Called from the page's own task.
#[wasm_bindgen]
pub fn table_sort(column: i32, descending: bool) -> bool {
    let sort = usize::try_from(column)
        .ok()
        .map(|column| (column, descending));
    let mut sorted = false;
    update_host(|host, cx| sorted = host.sort_table(sort, cx));
    sorted
}

/// What the table's last sort took to put its rows in order, ms: the
/// stall of a press on a column's arrow.
#[wasm_bindgen]
pub fn sort_cost() -> f64 {
    crate::table::sort_cost()
}

/// The instant the live cells show: the clock's years then, and whether
/// time ran (a moving cell is written to fewer decimals).
#[wasm_bindgen]
pub fn live_shown() -> Vec<f64> {
    let (years, moving) = crate::live::shown();
    vec![years, f64::from(u8::from(moving))]
}

/// What a live column's cell must say of a file row at `years`: its
/// distance, au, worked out apart from the table; NaN for a row with no
/// place, or a column that isn't live.
#[wasm_bindgen]
pub fn live_at(row: usize, column: usize, years: f64) -> f64 {
    let Some((host, cx)) = HOST.with_borrow(Clone::clone) else {
        return f64::NAN;
    };
    host.read_with(&cx, |host, _| host.live_at(row, column, years))
}

/// A file row's number in a column of the table that sorts; NaN for none.
#[wasm_bindgen]
pub fn row_number(row: usize, column: usize) -> f32 {
    let Some((host, cx)) = HOST.with_borrow(Clone::clone) else {
        return f32::NAN;
    };
    host.read_with(&cx, |host, _| host.number(row, column))
}

/// The table scrolled to `row` and that row selected, and so found: a
/// row far down the file, without the scroll there. Called from the
/// page's own task.
#[wasm_bindgen]
pub fn table_jump(row: usize) {
    update_host(|host, cx| host.jump(row, cx));
}

/// The row found (-1 with none), whether it has a dot, and how many times
/// a row has been found.
#[wasm_bindgen]
pub fn found_state() -> Vec<f64> {
    vec![
        find::found().map_or(-1.0, |row| row as f64),
        f64::from(u8::from(find::marked().is_some())),
        f64::from(find::finds()),
    ]
}

/// The corner's state: how far the compass says the camera stands round
/// from where it opened and its tilt (degrees), whether the hint is
/// folded, and whether the controls' list is open. Empty before the
/// scene's first frame.
#[wasm_bindgen]
pub fn corner_state() -> Vec<f32> {
    let Some((host, cx)) = HOST.with_borrow(Clone::clone) else {
        return Vec::new();
    };
    host.read_with(&cx, |host, cx| host.corner(cx))
        .map_or_else(Vec::new, |corner| corner.to_vec())
}

/// The crate's own place for a row, `years` after the epoch, in 64-bit
/// floats: x, y, z in au. A Hilda's or a Trojan's is where the integration
/// puts it, moved there from the epoch on its own (not the scene's rows,
/// which came by whatever way the clock did); any other row's is its
/// ellipse's. Which it is goes by the row's group alone, not by what the
/// scene is drawing: on a page with `?integrate=0`, or while the scene's
/// rows are still on their way to the clock, a Hilda or a Trojan is drawn
/// at [`ellipse_of`]. Empty for a row with no ellipse, one that isn't held
/// yet, or a time that isn't on the clock.
#[wasm_bindgen]
pub fn place_of(row: usize, years: f64) -> Vec<f64> {
    with_elements(|elements| row_place(elements, row, years))
        .flatten()
        .map_or_else(Vec::new, |place| place.to_vec())
}

/// A row's place, `years` after the epoch: where the integration puts a
/// Hilda or a Trojan, any other row's ellipse's ([`place_of`]).
fn row_place(elements: &Elements, row: usize, years: f64) -> Option<[f64; 3]> {
    if row >= elements.whole() {
        return None;
    }
    let (a, e) = (elements.get(Element::A, row), elements.get(Element::E, row));
    match ride::group(a, e) {
        Some(_) => integrate::place_of(elements, row, years),
        None => Orbit::of_row(elements, row).map(|orbit| orbit.place(years)),
    }
}

/// Where a row's 2026 ellipse alone puts it, `years` after the epoch: x,
/// y, z in au. Empty for a row with no ellipse, or one that isn't held yet.
#[wasm_bindgen]
pub fn ellipse_of(row: usize, years: f64) -> Vec<f64> {
    with_elements(|elements| {
        Some(elements)
            .filter(|elements| row < elements.whole())
            .and_then(|elements| Orbit::of_row(elements, row))
            .map_or_else(Vec::new, |orbit| orbit.place(years).to_vec())
    })
    .unwrap_or_default()
}

/// The integration: the rows it moves, the bytes held for them, and a
/// step's years. Zeros before the scene has asked for the rows.
#[wasm_bindgen]
pub fn integrated_state() -> Vec<f64> {
    MOVED.with_borrow(|moved| {
        moved.as_ref().map_or_else(
            || vec![0.0, 0.0, integrate::STEP],
            |moved| {
                vec![
                    moved.rows().len() as f64,
                    moved.bytes() as f64,
                    integrate::STEP,
                ]
            },
        )
    })
}

/// What a jump of the clock costs: the rows moved to `years` in one go,
/// however many steps that is, and then their places worked out as a
/// frame's are. The milliseconds each took.
#[wasm_bindgen]
pub fn integrated_jump(years: f64) -> Vec<f64> {
    MOVED.with_borrow_mut(|moved| {
        let Some(moved) = moved else {
            return Vec::new();
        };
        let started = seiza::marks::now();
        if !moved.to(years) {
            return Vec::new();
        }
        let stepped = seiza::marks::now();
        moved.places(years);
        vec![stepped - started, seiza::marks::now() - stepped]
    })
}

/// The crate's own place on the axes for an orbit of size `a` and
/// eccentricity `e`, in a window `width` by `height`: x and y, CSS px.
#[wasm_bindgen]
pub fn layout_of(a: f64, e: f64, width: f64, height: f64) -> Vec<f64> {
    Plot::in_window(width, height, f64::from(scene::inset()))
        .place(a, e)
        .to_vec()
}

/// A row's a and e as the file holds them, and whether they're on the
/// axes; empty for a row that isn't held yet.
#[wasm_bindgen]
pub fn layout_row(row: usize) -> Vec<f64> {
    with_elements(|elements| {
        if row >= elements.whole() {
            return Vec::new();
        }
        let (a, e) = (elements.get(Element::A, row), elements.get(Element::E, row));
        vec![
            f64::from(a),
            f64::from(e),
            f64::from(u8::from(layout::in_view(a, e))),
        ]
    })
    .unwrap_or_default()
}

/// Of the rows the scene has drawn so far, those with a place on the
/// axes: what the page counts in view.
#[wasm_bindgen]
pub fn layout_in_view() -> usize {
    with_elements(|elements| elements.in_view_before(DRAWN.get())).unwrap_or(0)
}

/// The gaps' orbit sizes, au: where Jupiter's a puts each resonance.
#[wasm_bindgen]
pub fn layout_gaps() -> Vec<f64> {
    layout::gaps().to_vec()
}

/// The sort flight: its progress, whether the action is pressed, and
/// whether the dots are on their way.
#[wasm_bindgen]
pub fn flight_state() -> Vec<f64> {
    vec![
        flight::progress(),
        f64::from(u8::from(flight::sorted())),
        f64::from(u8::from(flight::flying())),
    ]
}

/// The ride with Jupiter: how far the frame has turned, whether the
/// action is pressed, and whether the camera is on its way.
#[wasm_bindgen]
pub fn ride_state() -> Vec<f64> {
    vec![
        ride::turned(),
        f64::from(u8::from(ride::riding())),
        f64::from(u8::from(ride::flying())),
    ]
}

/// A picked gap: the gap the marker is at, whether one is picked, how
/// much of one there is, how much of it shows, and whether it's coming or
/// going.
#[wasm_bindgen]
pub fn gap_state() -> Vec<f64> {
    vec![
        gap::marker() as f64,
        f64::from(u8::from(gap::picked().is_some())),
        gap::shown(),
        gap::lit(),
        f64::from(u8::from(gap::moving())),
    ]
}

/// What the card says of a gap, a line each: its name, why its orbit
/// empties, and its three numbers, each after its label.
#[wasm_bindgen]
pub fn gap_card(picked: usize) -> Vec<String> {
    if picked >= layout::GAPS.len() {
        return Vec::new();
    }
    let card = gap::card(picked);
    [card.name, card.why]
        .into_iter()
        .chain(
            card.numbers
                .into_iter()
                .map(|(label, number)| format!("{label} {number}")),
        )
        .collect()
}

/// A gap's numbers: its orbit size (au), one orbit there, one of
/// Jupiter's, and the years its marker's path closes in (the clock's
/// years); then the marker's eccentricity.
#[wasm_bindgen]
pub fn gap_numbers(picked: usize) -> Vec<f64> {
    if picked >= layout::GAPS.len() {
        return Vec::new();
    }
    let [a, orbit, jupiter] = gap::numbers(picked);
    vec![
        a,
        orbit,
        jupiter,
        gap::closes_in(picked),
        gap::orbit(picked).e,
    ]
}

/// Of the rows the scene has drawn so far, those in each group the ride
/// lights: the Hildas, then the Trojans.
#[wasm_bindgen]
pub fn ride_counts() -> Vec<f64> {
    with_elements(|elements| {
        let (mut hildas, mut trojans) = (0.0, 0.0);
        for row in 0..DRAWN.get() {
            match ride::group(elements.get(Element::A, row), elements.get(Element::E, row)) {
                Some(ride::Group::Hildas) => hildas += 1.0,
                Some(ride::Group::Trojans) => trojans += 1.0,
                None => {}
            }
        }
        vec![hildas, trojans]
    })
    .unwrap_or_else(|| vec![0.0; 2])
}

/// The clock: its years, whether it's set to run, whether it's held for
/// the asteroids, whether it's at its last day, and its first and last
/// years.
#[wasm_bindgen]
pub fn clock_state() -> Vec<f64> {
    let (first, last) = clock::reach();
    vec![
        clock::years(),
        f64::from(u8::from(clock::running())),
        f64::from(u8::from(clock::held())),
        f64::from(u8::from(clock::ended())),
        first,
        last,
    ]
}

/// The date the time control shows.
#[wasm_bindgen]
pub fn clock_date() -> String {
    clock::date(clock::years())
}

/// Of the rows the scene has drawn so far: those with an ellipse (a dot
/// each) and those without; then those rows, and the rows the file has.
/// All 0 before the first block is drawn.
#[wasm_bindgen]
pub fn belt_counts() -> Vec<f64> {
    let rows = DRAWN.get();
    with_elements(|elements| {
        let dots = elements.bound_before(rows);
        vec![
            dots as f64,
            (rows - dots) as f64,
            rows as f64,
            elements.rows() as f64,
        ]
    })
    .unwrap_or_else(|| vec![0.0; 4])
}
