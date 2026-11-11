//! The page's side of the crate: the entry point, and the two files'
//! arrival. The page asks for each file after the first frame and writes
//! the response into this module's memory as it comes ([`file_begin`]), so
//! a file is held once: no copy on the page's side, and none here.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::*;
use wasm_bindgen::prelude::*;

use crate::bytes::Bytes;
use crate::catalog::Catalog;
use crate::clock;
use crate::elements::Elements;
use crate::host::Host;
use crate::rows::{Rows, day_of};

/// The page's background (`web/index.html`), which the window is filled
/// with while nothing is drawn under the interface.
const PAGE: u32 = 0x05060a;
/// The least time between two redraws for the files' progress.
const PROGRESS_EVERY_MS: f64 = 100.0;

/// Set once each file is held and read as one.
const ELEMENTS_MARK: &str = "kirkwood:elements";
const ROWS_MARK: &str = "kirkwood:rows";

/// The files, as the page names them to [`file_begin`] and [`file_end`].
const ELEMENTS: u8 = 0;
const ROWS: u8 = 1;

#[wasm_bindgen]
extern "C" {
    /// The first frame is on screen: the page asks for the files.
    #[wasm_bindgen(js_namespace = __kirkwood, js_name = firstFrame)]
    fn first_frame();
}

thread_local! {
    static HOST: RefCell<Option<(Entity<Host>, AsyncApp)>> = const { RefCell::new(None) };
    /// The file the page is writing into.
    static ARRIVING: RefCell<Option<Bytes>> = const { RefCell::new(None) };
    /// The elements, held until the rows are too.
    static HELD: RefCell<Option<Elements>> = const { RefCell::new(None) };
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
            // The scene is dark, whatever the system is.
            seiza::stop_following_system_appearance(cx);
            Theme::change(ThemeMode::Dark, None, cx);
            Theme::global_mut(cx).tokens.background = Hsla::from(rgb(PAGE)).into();
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
/// one, or nothing. With both held, the table opens.
#[wasm_bindgen]
pub fn file_end(file: u8) -> Option<String> {
    let Some(bytes) = ARRIVING.take() else {
        return Some("no file was arriving".into());
    };
    match file {
        ELEMENTS => match Elements::new(bytes) {
            Ok(elements) => {
                HELD.set(Some(elements));
                seiza::marks::mark(ELEMENTS_MARK);
                None
            }
            Err(why) => Some(why),
        },
        ROWS => {
            let Some(elements) = HELD.take() else {
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
