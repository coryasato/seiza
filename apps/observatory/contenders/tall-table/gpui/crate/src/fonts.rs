//! The admin table's fonts toggle, on the base level (`docs/DECISIONS.md`,
//! "Scenarios"). The JS host's base-level host (`web/src/base.ts`) calls
//! [`script_fonts`] before `start` when the page asks for fonts: the window
//! then starts with the browser drawing Han and Hangul
//! (`CanvasFontFallback::EmojiAndCjk`) and draws its rows in the bundled
//! face first. Once they're in, the host (`web/src/fonts.ts`) fetches the
//! script faces, checks them against their pins, and hands them to
//! [`add_fonts`]. GPUI reaches them by cosmic-text's fallback by coverage,
//! with no fallback list on any style. The mark the host named is set right
//! after the first frame drawn with them.

use std::borrow::Cow;
use std::cell::Cell;

use gpui_kit::web::CanvasFontFallback;
use wasm_bindgen::prelude::*;

thread_local! {
    /// The mark to set after the faces' first frame: set, the toggle is on.
    static MARK: Cell<Option<&'static str>> = const { Cell::new(None) };
    /// The faces are in; the host's next render marks it.
    static ADDED: Cell<bool> = const { Cell::new(false) };
}

/// Turns the toggle on, before `start`: `mark` is set right after the
/// first frame drawn with the faces (`contender:fonts`, the contract's).
#[wasm_bindgen(js_name = scriptFonts)]
pub fn script_fonts(mark: String) {
    // Once a load: `mark_after_current_task` takes a `'static` name.
    MARK.set(Some(Box::leak(mark.into_boxed_str())));
}

/// The browser's part: emoji, and with the toggle Han, kana, and Hangul too.
pub fn canvas_font_fallback() -> CanvasFontFallback {
    if MARK.get().is_some() {
        CanvasFontFallback::EmojiAndCjk
    } else {
        CanvasFontFallback::Emoji
    }
}

/// Adds `faces` (each a whole font file, checked by the JS host against its
/// pin) to the window's text system and draws every view again, its lines
/// shaped anew (their cache holds the boxes); the host's render in that
/// frame marks it ([`drew`]). gpui-pre-wgpu's `add_fonts` skips bytes it
/// can't parse without an error, which is why the host checks them.
#[wasm_bindgen(js_name = addFonts)]
pub fn add_fonts(faces: Vec<js_sys::Uint8Array>) -> Result<(), JsError> {
    let faces: Vec<Cow<'static, [u8]>> =
        faces.iter().map(|face| Cow::Owned(face.to_vec())).collect();
    let mut result = Ok(());
    let installed = crate::contract::with_window_now(|window, cx| {
        result = cx
            .text_system()
            .add_fonts(faces)
            .map_err(|error| JsError::new(&format!("{error:#}")));
        if result.is_ok() {
            ADDED.set(true);
            window.refresh();
        }
    });
    if !installed {
        return Err(JsError::new("addFonts: no window yet"));
    }
    result
}

/// Called from the host's render: sets the toggle's mark right after the
/// first frame drawn once the faces are in.
pub fn drew() {
    if ADDED.replace(false)
        && let Some(mark) = MARK.get()
    {
        drop(seiza::mark_after_current_task(mark));
    }
}
