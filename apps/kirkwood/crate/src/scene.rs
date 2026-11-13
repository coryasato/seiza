//! What passes between the interface and the scene (`web/src/scene.ts`),
//! which isn't Rust's: plain cells the scene reads each frame, and the
//! calls the interface makes into it (a wheel, a press, a drag). The scene never calls into GPUI from
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

/// The modifiers held with an input, as the scene takes them: 1 Ctrl, 2
/// Shift, 4 Alt, 8 the platform's.
pub fn modifiers(control: bool, shift: bool, alt: bool, platform: bool) -> u8 {
    u8::from(control) | u8::from(shift) << 1 | u8::from(alt) << 2 | u8::from(platform) << 3
}

/// A wheel over the scene riding with Jupiter: the ride's own distance.
pub fn ride_wheel(delta: f32, modifiers: u8) {
    #[cfg(target_family = "wasm")]
    crate::web::scene_ride_wheel(delta, modifiers);
    #[cfg(not(target_family = "wasm"))]
    let _ = (delta, modifiers);
}

/// A wheel over the scene in the fixed frame, at a window position (CSS
/// px): it zooms toward the pointer. Off the web there is no scene.
pub fn wheel(x: f32, y: f32, delta: f32, modifiers: u8) {
    #[cfg(target_family = "wasm")]
    crate::web::scene_wheel(x, y, delta, modifiers);
    #[cfg(not(target_family = "wasm"))]
    let _ = (x, y, delta, modifiers);
}

thread_local! {
    /// The button of the drag the scene has, from its press on the surface
    /// to its release, wherever in the window that is.
    static DRAG: Cell<Option<u8>> = const { Cell::new(None) };
}

/// A press anywhere in the window: a camera gliding stops.
pub fn press() {
    #[cfg(target_family = "wasm")]
    crate::web::scene_press();
}

/// The button of the drag the scene has (0 the left, 1 the middle, 2 the
/// right), if it has one.
pub fn dragging() -> Option<u8> {
    DRAG.get()
}

/// A press on the surface, at a window position (CSS px): a drag is the
/// scene's from here to its release.
pub fn drag_start(x: f32, y: f32, button: u8, modifiers: u8) {
    DRAG.set(Some(button));
    #[cfg(target_family = "wasm")]
    crate::web::scene_drag_start(x, y, button, modifiers);
    #[cfg(not(target_family = "wasm"))]
    let _ = (x, y, modifiers);
}

/// The drag's pointer moved, anywhere in the window.
pub fn drag_move(x: f32, y: f32) {
    if DRAG.get().is_none() {
        return;
    }
    #[cfg(target_family = "wasm")]
    crate::web::scene_drag_move(x, y);
    #[cfg(not(target_family = "wasm"))]
    let _ = (x, y);
}

/// The drag's release, anywhere in the window (or its button found up,
/// the release never having come).
pub fn drag_end(x: f32, y: f32) {
    if DRAG.take().is_none() {
        return;
    }
    #[cfg(target_family = "wasm")]
    crate::web::scene_drag_end(x, y);
    #[cfg(not(target_family = "wasm"))]
    let _ = (x, y);
}

#[cfg(test)]
mod tests {
    use super::{drag_end, drag_move, drag_start, dragging, modifiers};

    #[test]
    fn a_drag_is_the_scenes_from_its_press_to_its_release() {
        assert_eq!(dragging(), None);
        drag_move(1.0, 1.0);
        assert_eq!(dragging(), None);
        drag_start(10.0, 10.0, 0, 0);
        assert_eq!(dragging(), Some(0));
        drag_move(20.0, 10.0);
        assert_eq!(dragging(), Some(0));
        drag_end(20.0, 10.0);
        assert_eq!(dragging(), None);
        drag_end(20.0, 10.0);
        assert_eq!(dragging(), None);
    }

    #[test]
    fn the_modifiers_are_a_bit_each() {
        assert_eq!(modifiers(false, false, false, false), 0);
        assert_eq!(modifiers(true, false, false, false), 1);
        assert_eq!(modifiers(false, true, false, false), 2);
        assert_eq!(modifiers(true, true, true, true), 15);
    }
}
