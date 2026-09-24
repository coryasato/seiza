//! seiza: the app-agnostic foundation every seiza app builds on.
//!
//! This crate knows nothing about any app. It owns the web bootstrap order
//! (panic hook → fonts → `gpui_kit::init` → first frame → `gpui:first-frame`
//! mark → post-paint callback) and the window shell apps render into.

pub mod perf;
mod shell;

#[cfg(target_family = "wasm")]
mod bootstrap;
#[cfg(target_family = "wasm")]
mod first_frame;

pub use perf::{PerfOverlay, TogglePerfOverlay};
pub use shell::AppShell;

#[cfg(target_family = "wasm")]
pub use bootstrap::Bootstrap;
#[cfg(target_family = "wasm")]
pub use first_frame::{FIRST_FRAME_MARK, mark_after_current_task};
