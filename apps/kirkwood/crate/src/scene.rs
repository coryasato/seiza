//! What passes between the interface and the scene (`web/src/scene.ts`),
//! which isn't Rust's: plain cells the scene reads each frame, and the one
//! call the interface makes into it. The scene never calls into GPUI from
//! here: its exports are in `web`.

use std::cell::Cell;

thread_local! {
    static INSET: Cell<f32> = const { Cell::new(0.0) };
}

/// The panel's width on screen, CSS px: the scene centers its picture in
/// what's left of the window.
pub fn inset() -> f32 {
    INSET.get()
}

pub fn set_inset(px: f32) {
    INSET.set(px);
}

/// A wheel over the scene, at a window position (CSS px): it zooms. Off
/// the web there is no scene.
pub fn wheel(x: f32, y: f32, delta: f32) {
    #[cfg(target_family = "wasm")]
    crate::web::scene_wheel(x, y, delta);
    #[cfg(not(target_family = "wasm"))]
    let _ = (x, y, delta);
}
