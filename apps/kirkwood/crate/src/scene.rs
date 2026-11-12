//! What passes between the interface and the scene (`web/src/scene.ts`),
//! which isn't Rust's: plain cells the scene reads each frame, and the one
//! call the interface makes into it. The scene never calls into GPUI from
//! here: its exports are in `web`.

use std::cell::Cell;

thread_local! {
    static INSET: Cell<f32> = const { Cell::new(0.0) };
    static SCRIM: Cell<[f32; 4]> = const { Cell::new([0.0; 4]) };
    static SCRIM_CHANGES: Cell<u32> = const { Cell::new(0) };
}

/// The panel's width on screen, CSS px: the scene centers its picture in
/// what's left of the window.
pub fn inset() -> f32 {
    INSET.get()
}

pub fn set_inset(px: f32) {
    INSET.set(px);
}

/// Where the page's own text lies over the scene (the title and its
/// lines): left, top, width, height, CSS px. The scene quiets its picture
/// there, so the text reads over a starry corner.
pub fn scrim() -> [f32; 4] {
    SCRIM.get()
}

/// How many times those bounds have changed: the scene asks for them
/// again only when this has moved.
pub fn scrim_changes() -> u32 {
    SCRIM_CHANGES.get()
}

/// Returns whether they moved.
pub fn set_scrim(bounds: [f32; 4]) -> bool {
    let moved = SCRIM.replace(bounds) != bounds;
    if moved {
        SCRIM_CHANGES.set(SCRIM_CHANGES.get().wrapping_add(1));
    }
    moved
}

/// A wheel over the scene, at a window position (CSS px): it zooms. Off
/// the web there is no scene.
pub fn wheel(x: f32, y: f32, delta: f32) {
    #[cfg(target_family = "wasm")]
    crate::web::scene_wheel(x, y, delta);
    #[cfg(not(target_family = "wasm"))]
    let _ = (x, y, delta);
}
