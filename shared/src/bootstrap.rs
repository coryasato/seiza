//! The web bootstrap. Its order is fixed and every app goes through it:
//! panic hook → fonts → `gpui_kit::init` → first frame → `gpui:first-frame`
//! mark → post-paint callback.

use std::borrow::Cow;
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use gpui_kit::component::Theme;
use gpui_kit::web::{CanvasFontFallback, WebBackendPreference, WebPlatform};
use gpui_kit::*;

use crate::AppShell;

thread_local! {
    // The browser owns the run loop, so the app lives as long as this handle.
    static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
}

type BuildContent = Box<dyn FnOnce(&mut Window, &mut App) -> AnyView>;
type AfterFirstPaint = Box<dyn FnOnce(&mut Window, &mut App)>;

/// Starts a seiza app on the page's canvas.
///
/// ```ignore
/// seiza::Bootstrap::new("Tycho", ui_font)
///     .after_first_paint(|window, cx| { /* start heavy loads */ })
///     .run(|window, cx| cx.new(|cx| Workbench::new(window, cx)).into());
/// ```
pub struct Bootstrap {
    title: SharedString,
    ui_font: Vec<u8>,
    after_first_paint: Option<AfterFirstPaint>,
}

impl Bootstrap {
    /// `ui_font` is the one bundled UI face. The JS host fetches it in
    /// parallel with the wasm and hands the bytes over.
    pub fn new(title: impl Into<SharedString>, ui_font: Vec<u8>) -> Self {
        Self {
            title: title.into(),
            ui_font,
            after_first_paint: None,
        }
    }

    /// Runs `callback` after the first frame is presented and marked. Start
    /// engines, workers, and datasets here, never earlier.
    pub fn after_first_paint(
        mut self,
        callback: impl FnOnce(&mut Window, &mut App) + 'static,
    ) -> Self {
        self.after_first_paint = Some(Box::new(callback));
        self
    }

    /// Opens the window and renders `content` inside the [`AppShell`].
    pub fn run(self, content: impl FnOnce(&mut Window, &mut App) -> AnyView + 'static) {
        #[cfg(debug_assertions)]
        console_error_panic_hook::set_once();
        // Kept in release: it costs 0.8 KiB brotli and no measurable TTFP
        // (M1), and it's how a graphics-backend fallback or failure shows up.
        gpui_kit::web::init_logging();

        let content: BuildContent = Box::new(content);
        let Self {
            title,
            ui_font,
            after_first_paint,
        } = self;

        let handle = web_application().run_embedded(move |cx| {
            // Fonts before init: on wasm the font database starts empty, and
            // `gpui_kit::init` resolves `.SystemUIFont` through it. See
            // longbridge/gpui-kit#3101 and #3105.
            cx.text_system()
                .add_fonts(vec![Cow::Owned(ui_font)])
                .expect("failed to load the UI font");
            let mac = is_mac_browser();
            if mac {
                // Before init: a menu labels an action with its latest
                // binding, and a wasm build spells Cmd "Win".
                bind_mac_menu_keys(cx);
            }
            gpui_kit::init(cx);
            if mac {
                // After init: these must outrank the wasm build's own (its
                // Shift+Alt+←/→ selects a character, not a word).
                bind_mac_input_keys(cx);
            }
            crate::perf::init(cx);
            crate::shell::init(cx);
            Theme::sync_system_appearance(None, cx);

            let options = WindowOptions {
                titlebar: Some(TitlebarOptions {
                    title: Some(title.clone()),
                    ..Default::default()
                }),
                ..Default::default()
            };
            // Kit wraps the shell in `Root`, which hosts dialogs, sheets, and
            // notifications itself (since 0.7.0).
            gpui_kit::open_window(options, cx, move |window, cx| {
                let content = content(window, cx);
                // The shell always arms the first-frame mark; the post-paint
                // callback is optional.
                let after_first_paint = after_first_paint.unwrap_or_else(|| Box::new(|_, _| {}));
                cx.new(|cx| {
                    AppShell::new(title, content, window, cx).on_first_frame(after_first_paint)
                })
            })
            .expect("failed to open the window");
            cx.activate(true);
        });

        APPLICATION.with(|application| *application.borrow_mut() = Some(handle));
    }
}

/// A single-threaded web platform: WebGPU where the browser offers a usable
/// adapter, WebGL2 otherwise (GPUI's `Auto`).
///
/// Chosen by cold-start TTFP in Tycho's M1, reference run (Chromium): Auto
/// 173.5 ms vs forced WebGL2 291.0 ms. WebKit: 296 vs 412 ms. Firefox, whose
/// headless adapter is blocklisted, falls back to WebGL2 at no measurable cost
/// (550 vs 551 ms). See Tycho's `perf/results/2026-09-23-m1.md`.
fn web_application() -> Application {
    let platform = Rc::new(WebPlatform::new_with_backend_and_font_fallback(
        false,
        WebBackendPreference::Auto,
        CanvasFontFallback::Emoji,
    ));
    let http_client = Arc::new(platform.fetch_http_client());
    Application::with_platform(platform)
        .with_http_client(http_client)
        .with_assets(Icons)
}

// The icons the shell draws, embedded in the wasm. gpui-kit's default
// `Assets` fetches each icon from a CDN on first use on the web, which would
// put a request between the first frame and its icons. Unlisted icons draw
// nothing.
gpui_kit::assets::icon_assets!(Icons, [Sun, Moon]);

/// Whether the page runs in a Mac browser (`navigator.platform`), where Cmd
/// and Opt are the editing modifiers.
fn is_mac_browser() -> bool {
    use wasm_bindgen::JsValue;

    js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("navigator"))
        .and_then(|navigator| js_sys::Reflect::get(&navigator, &JsValue::from_str("platform")))
        .ok()
        .and_then(|platform| platform.as_string())
        .is_some_and(|platform| platform.starts_with("Mac"))
}

/// The Mac editing keys for gpui-kit's text inputs, in Mac browsers.
///
/// gpui-kit 0.7.1 binds an input's Mac shortcuts only under
/// `cfg(target_os = "macos")`, which a wasm build never is: the web build
/// gets the Windows/Linux set, so in a Mac browser Cmd+A, Cmd+C, Cmd+Z and
/// friends did nothing (Tycho M7 part C; no upstream issue found
/// 2026-10-08). These are gpui-base's macOS input bindings, minus Cmd+V: a
/// Cmd+V that nothing binds reaches the browser's own paste event, which
/// needs no clipboard permission, while the `Paste` action reads the
/// clipboard asynchronously, behind the browser's permission. Only in Mac
/// browsers: elsewhere Alt+←/→ is the browser's Back/Forward.
///
/// The actions the input's right-click menu shows. Bound before
/// `gpui_kit::init`, so the menu keeps labelling the Ctrl keys.
fn bind_mac_menu_keys(cx: &mut App) {
    use gpui_kit::component::input::{Copy, Cut, SelectAll};

    const INPUT: Option<&str> = Some("Input");
    cx.bind_keys([
        KeyBinding::new("cmd-a", SelectAll, INPUT),
        KeyBinding::new("cmd-c", Copy, INPUT),
        KeyBinding::new("cmd-x", Cut, INPUT),
    ]);
}

/// The rest of [`bind_mac_menu_keys`]'s set, bound after `gpui_kit::init`
/// to outrank the wasm build's bindings for the same keys.
fn bind_mac_input_keys(cx: &mut App) {
    use gpui_kit::component::input::{
        DeleteToBeginningOfLine, DeleteToEndOfLine, DeleteToNextWordEnd, DeleteToPreviousWordStart,
        MoveEnd, MoveHome, MoveToEnd, MoveToNextWord, MoveToPreviousWord, MoveToStart, Redo,
        SelectToEnd, SelectToEndOfLine, SelectToNextWordEnd, SelectToPreviousWordStart,
        SelectToStart, SelectToStartOfLine, Undo,
    };

    const INPUT: Option<&str> = Some("Input");
    cx.bind_keys([
        KeyBinding::new("cmd-z", Undo, INPUT),
        KeyBinding::new("cmd-shift-z", Redo, INPUT),
        KeyBinding::new("cmd-left", MoveHome, INPUT),
        KeyBinding::new("cmd-right", MoveEnd, INPUT),
        KeyBinding::new("cmd-up", MoveToStart, INPUT),
        KeyBinding::new("cmd-down", MoveToEnd, INPUT),
        KeyBinding::new("shift-cmd-left", SelectToStartOfLine, INPUT),
        KeyBinding::new("shift-cmd-right", SelectToEndOfLine, INPUT),
        KeyBinding::new("cmd-shift-up", SelectToStart, INPUT),
        KeyBinding::new("cmd-shift-down", SelectToEnd, INPUT),
        KeyBinding::new("cmd-backspace", DeleteToBeginningOfLine, INPUT),
        KeyBinding::new("cmd-delete", DeleteToEndOfLine, INPUT),
        KeyBinding::new("alt-left", MoveToPreviousWord, INPUT),
        KeyBinding::new("alt-right", MoveToNextWord, INPUT),
        KeyBinding::new("alt-shift-left", SelectToPreviousWordStart, INPUT),
        KeyBinding::new("alt-shift-right", SelectToNextWordEnd, INPUT),
        KeyBinding::new("alt-backspace", DeleteToPreviousWordStart, INPUT),
        KeyBinding::new("alt-delete", DeleteToNextWordEnd, INPUT),
    ]);
}
