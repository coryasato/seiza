//! Files from the visitor's device: dropped on the page, or picked with the
//! browser's file dialog. Both hand over a `File`, a handle to the bytes on
//! disk, which DuckDB then reads by range (`registerFile`). [`sniff`] reads
//! 8 bytes; a CSV's chunks are cut by `crate::csv`, which reads it through
//! [`read`].
//!
//! GPUI can't deliver these. gpui-pre-web 0.3.5 intercepts `dragover` and
//! `drop` on its canvas only to stop the browser navigating to the file: a
//! browser drop has `File` objects, not the paths GPUI's `ExternalPaths`
//! expects (`gpui-pre-web/src/events.rs`, `register_drop`). So Tycho listens
//! on the window itself, next to GPUI's listeners, which don't stop the events.

use std::cell::Cell;
use std::rc::Rc;

use gpui_kit::{AnyWindowHandle, App, AsyncApp, WeakEntity};
use js_sys::Uint8Array;
use wasm_bindgen::JsCast as _;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

/// What the page reports to whoever [`listen`]s.
pub enum FileEvent {
    /// Files are being dragged over the page (true), or left it (false).
    Dragging(bool),
    /// A file was dropped or picked, at this time (ms from `timeOrigin`).
    /// With several, the first; `more` counts the rest.
    Chosen {
        file: web_sys::File,
        at: f64,
        more: u32,
    },
}

/// Something that takes [`FileEvent`]s: the workbench.
pub trait FileTarget: Sized + 'static {
    fn file_event(
        &mut self,
        event: FileEvent,
        window: &mut gpui_kit::Window,
        cx: &mut gpui_kit::Context<Self>,
    );
}

/// Delivers drops on the page (and [`pick`]'s choices) to `target`, until the
/// page closes. Called once, when the window opens: the listeners are
/// forgotten, not removed, since they live as long as the app.
///
/// DOM events arrive outside GPUI's update cycle; each one is handed to GPUI's
/// foreground executor, which runs it on its next turn, so it never borrows
/// the app while GPUI holds it.
pub fn listen<T: FileTarget>(target: WeakEntity<T>, window: AnyWindowHandle, cx: &mut App) {
    let Some(page) = web_sys::window() else {
        return;
    };
    let deliver = Deliver::new(target, window, cx.to_async());
    // `dragenter` and `dragleave` fire for every element the pointer crosses;
    // only the page's own enter and leave count.
    let depth = Rc::new(Cell::new(0u32));

    let on_enter = {
        let (deliver, depth) = (deliver.clone(), depth.clone());
        move |event: web_sys::DragEvent| {
            if !carries_files(&event) {
                return;
            }
            event.prevent_default();
            depth.set(depth.get() + 1);
            if depth.get() == 1 {
                deliver.send(FileEvent::Dragging(true));
            }
        }
    };
    let on_over = |event: web_sys::DragEvent| {
        if !carries_files(&event) {
            return;
        }
        // Without this the browser opens the file in the tab. The cursor says
        // "copy", not "move": the file stays where it is.
        event.prevent_default();
        if let Some(transfer) = event.data_transfer() {
            transfer.set_drop_effect("copy");
        }
    };
    let on_leave = {
        let (deliver, depth) = (deliver.clone(), depth.clone());
        move |_: web_sys::DragEvent| {
            // No `carries_files` check: only file drags raise `depth`, and a
            // browser may report other types on the way out, which would
            // leave the overlay up.
            if depth.get() == 0 {
                return;
            }
            depth.set(depth.get() - 1);
            if depth.get() == 0 {
                deliver.send(FileEvent::Dragging(false));
            }
        }
    };
    let on_drop = {
        let deliver = deliver.clone();
        move |event: web_sys::DragEvent| {
            event.prevent_default();
            if depth.replace(0) > 0 {
                deliver.send(FileEvent::Dragging(false));
            }
            if let Some(files) = event.data_transfer().and_then(|transfer| transfer.files()) {
                deliver.chosen(&files);
            }
        }
    };
    add_listener(&page, "dragenter", on_enter);
    add_listener(&page, "dragover", on_over);
    add_listener(&page, "dragleave", on_leave);
    add_listener(&page, "drop", on_drop);

    PICKER.set(Some(Box::new(move |files: &web_sys::FileList| {
        deliver.chosen(files)
    })));
}

fn add_listener(
    page: &web_sys::Window,
    name: &str,
    handler: impl FnMut(web_sys::DragEvent) + 'static,
) {
    let closure = Closure::<dyn FnMut(web_sys::DragEvent)>::new(handler);
    let _ = page.add_event_listener_with_callback(name, closure.as_ref().unchecked_ref());
    closure.forget();
}

/// Drags of text or links aren't file drops: leave them to the browser.
fn carries_files(event: &web_sys::DragEvent) -> bool {
    event
        .data_transfer()
        .is_some_and(|transfer| transfer.types().includes(&JsValue::from_str("Files"), 0))
}

/// Hands [`FileEvent`]s to the target on GPUI's next turn.
struct Deliver<T> {
    target: WeakEntity<T>,
    window: AnyWindowHandle,
    cx: AsyncApp,
}

impl<T> Clone for Deliver<T> {
    fn clone(&self) -> Self {
        Self {
            target: self.target.clone(),
            window: self.window,
            cx: self.cx.clone(),
        }
    }
}

impl<T: FileTarget> Deliver<T> {
    fn new(target: WeakEntity<T>, window: AnyWindowHandle, cx: AsyncApp) -> Self {
        Self { target, window, cx }
    }

    fn send(&self, event: FileEvent) {
        let Self { target, window, cx } = self.clone();
        let mut app = cx.clone();
        cx.foreground_executor()
            .spawn(async move {
                let _ = window.update(&mut app, |_, window, cx| {
                    target.update(cx, |target, cx| target.file_event(event, window, cx))
                });
            })
            .detach();
    }

    fn chosen(&self, files: &web_sys::FileList) {
        if let Some(file) = files.get(0) {
            self.send(FileEvent::Chosen {
                file,
                at: crate::engine::now(),
                more: files.length().saturating_sub(1),
            });
        }
    }
}

/// Takes the files [`pick`]'s dialog returns.
type Picked = Box<dyn Fn(&web_sys::FileList)>;

thread_local! {
    /// Where [`pick`]'s choice goes: set by [`listen`].
    static PICKER: Cell<Option<Picked>> = const { Cell::new(None) };
    static INPUT: std::cell::OnceCell<Option<web_sys::HtmlInputElement>> = const { std::cell::OnceCell::new() };
}

/// Opens the browser's file dialog. Call it from a click or key handler:
/// browsers open the dialog only with a user gesture, and GPUI dispatches
/// pointer and key events synchronously inside the DOM's own, so the
/// `pointerdown`'s activation is still live.
pub fn pick() {
    INPUT.with(|input| {
        if let Some(input) = input.get_or_init(create_input) {
            input.click();
        }
    });
}

/// A hidden `<input type=file>`, created on the first [`pick`]. It stays in
/// the page: Safari fires `change` only for inputs in the document.
fn create_input() -> Option<web_sys::HtmlInputElement> {
    let document = web_sys::window()?.document()?;
    let input: web_sys::HtmlInputElement = document.create_element("input").ok()?.unchecked_into();
    input.set_type("file");
    // A hint for the dialog's filter, not a check: `sniff` decides.
    input.set_accept(".parquet,.parq,.pq,.csv,.tsv,text/csv,text/tab-separated-values");
    input.set_hidden(true);
    let on_change = Closure::<dyn FnMut(web_sys::Event)>::new(move |event: web_sys::Event| {
        let Some(input) = event
            .target()
            .and_then(|target| target.dyn_into::<web_sys::HtmlInputElement>().ok())
        else {
            return;
        };
        if let Some(files) = input.files() {
            PICKER.with(|picker| {
                let callback = picker.take();
                if let Some(callback) = &callback {
                    callback(&files);
                }
                picker.set(callback);
            });
        }
        // So picking the same file again still fires `change`.
        input.set_value("");
    });
    input.set_onchange(Some(on_change.as_ref().unchecked_ref()));
    on_change.forget();
    document.body()?.append_child(&input).ok()?;
    Some(input)
}

/// What a file's first and last bytes, and its name, say it is.
#[derive(Debug, Clone, PartialEq)]
pub enum Kind {
    Parquet,
    /// `PARE` at both ends: the columns and footer are encrypted, and DuckDB
    /// needs the key.
    EncryptedParquet,
    /// Named or typed as CSV (or TSV). The name decides: CSV has no magic
    /// bytes, and DuckDB's sniffer says whether it reads as one.
    Csv,
    /// A gzipped CSV. Chunks are cut at record boundaries in the raw bytes,
    /// which a compressed file doesn't have.
    CompressedCsv,
    /// Zero bytes.
    Empty,
    Other,
}

/// Reads the 4 bytes at each end of `file`: a Parquet file starts and ends
/// with `PAR1`. Takes well under a millisecond on any size, and needs no
/// engine, so a wrong file is answered at once, even while DuckDB loads.
pub async fn sniff(file: &web_sys::File) -> Result<Kind, String> {
    const MAGIC: &[u8] = b"PAR1";
    const ENCRYPTED: &[u8] = b"PARE";
    let size = file.size();
    if size == 0.0 {
        return Ok(Kind::Empty);
    }
    // Too short to hold a Parquet header and footer (12 bytes): not Parquet.
    if size >= 12.0 {
        let head = read(file, 0.0, 4.0).await?;
        let tail = read(file, size - 4.0, size).await?;
        match (head.as_slice(), tail.as_slice()) {
            (MAGIC, MAGIC) => return Ok(Kind::Parquet),
            (ENCRYPTED, ENCRYPTED) => return Ok(Kind::EncryptedParquet),
            _ => {}
        }
    }
    Ok(csv_kind(&file.name(), &file.type_()).unwrap_or(Kind::Other))
}

pub(crate) async fn read(file: &web_sys::File, start: f64, end: f64) -> Result<Vec<u8>, String> {
    let error = |error: JsValue| {
        error
            .dyn_ref::<js_sys::Error>()
            .map(|error| String::from(error.message()))
            .or_else(|| error.as_string())
            .unwrap_or_else(|| "the browser couldn't read it".into())
    };
    let slice = file.slice_with_f64_and_f64(start, end).map_err(error)?;
    let buffer = JsFuture::from(slice.array_buffer()).await.map_err(error)?;
    Ok(Uint8Array::new(&buffer).to_vec())
}

/// A CSV by name or MIME type, compressed or not.
pub fn csv_kind(name: &str, mime: &str) -> Option<Kind> {
    let name = name.to_ascii_lowercase();
    if [".csv.gz", ".tsv.gz"].iter().any(|ext| name.ends_with(ext)) {
        return Some(Kind::CompressedCsv);
    }
    let csv = [".csv", ".tsv"].iter().any(|ext| name.ends_with(ext))
        || mime == "text/csv"
        || mime == "text/tab-separated-values";
    csv.then_some(Kind::Csv)
}
