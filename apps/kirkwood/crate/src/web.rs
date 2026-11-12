//! The page's side of the crate: the entry point, the two files' arrival,
//! and what the scene asks. The page asks for each file after the first
//! frame and writes the response into this module's memory as it comes
//! ([`file_begin`]), so a file is held once: no copy on the page's side,
//! and none here. The scene's attributes are views over the elements where
//! they lie ([`elements_ptr`]); each frame it asks for the clock
//! ([`scene_years`]) and for what else it draws by.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::*;
use wasm_bindgen::prelude::*;

use crate::bytes::Bytes;
use crate::catalog::Catalog;
use crate::clock;
use crate::elements::{Element, Elements};
use crate::host::Host;
use crate::orbit::{JUPITER, Orbit};
use crate::ramp;
use crate::rows::{Rows, day_of};
use crate::scene;

/// The least time between two redraws for the files' progress.
const PROGRESS_EVERY_MS: f64 = 100.0;
/// The places Jupiter's orbit is drawn through.
const ORBIT_POINTS: usize = 256;

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

    /// A wheel over the scene, at a window position (CSS px).
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = wheel)]
    pub fn scene_wheel(x: f32, y: f32, delta: f32);
}

thread_local! {
    static HOST: RefCell<Option<(Entity<Host>, AsyncApp)>> = const { RefCell::new(None) };
    /// The file the page is writing into.
    static ARRIVING: RefCell<Option<Bytes>> = const { RefCell::new(None) };
    /// The elements, from the moment they're held: the scene draws from
    /// them before the rows arrive, and the table reads the same ones.
    static HELD: RefCell<Option<Rc<Elements>>> = const { RefCell::new(None) };
    static PROGRESS_AT: Cell<f64> = const { Cell::new(f64::NEG_INFINITY) };
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
            // `?glass`: the table's own fills let the panel's show (and
            // through it the scene), its stripes half as strong.
            if crate::host::GLASS.is_some() {
                let theme = Theme::global_mut(cx);
                theme.tokens.table = gpui_kit::transparent_black().into();
                theme.tokens.table_head = gpui_kit::transparent_black().into();
                theme.table_even = theme.table_even.opacity(0.5);
            }
            seiza_tall_table::init(cx);
            let host = cx.new(Host::new);
            HOST.set(Some((host.clone(), cx.to_async())));
            host.into()
        });
}

/// Room for a file of `bytes` bytes, and where to write it: the page copies
/// each piece of the response there as it arrives. The address holds until
/// [`file_end`]; the page makes its view over the memory anew for each
/// piece, since the memory growing detaches one.
#[wasm_bindgen]
pub fn file_begin(bytes: usize) -> *mut u8 {
    let mut file = Bytes::zeroed(bytes);
    let at = file.as_mut_ptr();
    ARRIVING.set(Some(file));
    at
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
/// one, or nothing. With the elements held the scene can draw the belt;
/// with both, the table opens.
#[wasm_bindgen]
pub fn file_end(file: u8) -> Option<String> {
    let Some(bytes) = ARRIVING.take() else {
        return Some("no file was arriving".into());
    };
    match file {
        ELEMENTS => match Elements::new(bytes) {
            Ok(elements) => {
                HELD.set(Some(Rc::new(elements)));
                seiza::marks::mark(ELEMENTS_MARK);
                None
            }
            Err(why) => Some(why),
        },
        ROWS => {
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
#[wasm_bindgen]
pub fn file_failed(message: String) {
    ARRIVING.set(None);
    update_host(|host, cx| host.failed(message, cx));
}

// --- What the scene asks. None of these enters GPUI but `belt_drawn`,
// `sky_drawn`, and `scene_failed`, which the page calls from its own tasks,
// never from inside a call Rust made.

/// Where the elements' columns are: `Element::COUNT` runs of
/// [`elements_rows`] 32-bit floats, end to end (a, e, i, the node, the
/// argument of perihelion, the mean anomaly, H). The scene's attributes
/// are views over them, so the upload to the GPU is the only copy. The
/// address holds for the page's life; a view over it doesn't (the memory
/// growing detaches one), so the scene makes its views and uploads them in
/// one task. Null before the elements are held.
#[wasm_bindgen]
pub fn elements_ptr() -> *const f32 {
    HELD.with_borrow(|held| {
        held.as_ref()
            .map_or(std::ptr::null(), |elements| elements.columns_ptr())
    })
}

/// The elements' rows; 0 before they're held.
#[wasm_bindgen]
pub fn elements_rows() -> usize {
    HELD.with_borrow(|held| held.as_ref().map_or(0, |elements| elements.rows()))
}

/// The columns at [`elements_ptr`].
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

/// The belt's first draw is on screen: the page's counts are counted from
/// the rows the scene was given, and time starts to move.
#[wasm_bindgen]
pub fn belt_drawn() {
    let Some(elements) = HELD.with_borrow(Clone::clone) else {
        return;
    };
    let drawn = elements.bound();
    update_host(|host, cx| host.belt_drawn(drawn, elements.rows() - drawn, cx));
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

// --- For the checks (`checks/see.ts`).

/// The crate's own place for a row, `years` after the epoch, in 64-bit
/// floats: x, y, z in au. Empty for a row with no ellipse, or before the
/// elements are held.
#[wasm_bindgen]
pub fn place_of(row: usize, years: f64) -> Vec<f64> {
    HELD.with_borrow(|held| {
        held.as_ref()
            .filter(|elements| row < elements.rows())
            .and_then(|elements| Orbit::of_row(elements, row))
            .map_or_else(Vec::new, |orbit| orbit.place(years).to_vec())
    })
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

/// The rows the scene draws (those with an ellipse), and the rows it
/// doesn't; both 0 before the elements are held.
#[wasm_bindgen]
pub fn belt_counts() -> Vec<f64> {
    HELD.with_borrow(|held| {
        held.as_ref().map_or_else(
            || vec![0.0, 0.0],
            |elements| {
                let drawn = elements.bound();
                vec![drawn as f64, (elements.rows() - drawn) as f64]
            },
        )
    })
}
