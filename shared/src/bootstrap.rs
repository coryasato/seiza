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
            gpui_kit::init(cx);
            crate::perf::init(cx);
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
    Application::with_platform(platform).with_http_client(http_client)
}
