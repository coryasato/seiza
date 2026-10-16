//! seiza: the app-agnostic foundation every seiza app builds on.
//!
//! This crate knows nothing about any app. It owns the web bootstrap order
//! (panic hook → fonts → `gpui_kit::init` → first frame → `gpui:first-frame`
//! mark → post-paint callback) and the window's root around the app's view,
//! and publishes controls' bounds for scripts ([`targets`]). A title bar, a
//! theme toggle, or anything else on screen is the app's.
//!
//! Feature `panel`, on by default: the perf panel and the [`perf`] API.

#[cfg(feature = "panel")]
mod panel;
#[cfg(feature = "panel")]
pub mod perf;
mod shell;
pub mod targets;
pub mod url;

#[cfg(target_family = "wasm")]
mod bootstrap;
#[cfg(target_family = "wasm")]
mod first_frame;
#[cfg(all(target_family = "wasm", feature = "panel"))]
mod frames;
#[cfg(target_family = "wasm")]
pub mod marks;

#[cfg(feature = "panel")]
pub use perf::{FrameStats, LoadStep, PerfOverlay, TogglePerfOverlay, frame_stats, sample_stats};
pub use shell::{AppShell, stop_following_system_appearance};

#[cfg(target_family = "wasm")]
pub use bootstrap::Bootstrap;
#[cfg(target_family = "wasm")]
pub use first_frame::FIRST_FRAME_MARK;
#[cfg(target_family = "wasm")]
pub use marks::mark_after_current_task;
