//! What passes between the interface and the scene (`web/src/scene.ts`),
//! which isn't Rust's: plain cells the scene reads each frame, and the
//! calls the interface makes into it (a wheel, a press, a drag, a double
//! click, a key, the way home). The scene never calls into GPUI from here:
//! its exports are in `web`.

use std::cell::Cell;

thread_local! {
    static INSET: Cell<f32> = const { Cell::new(0.0) };
    static INSET_TO: Cell<f32> = const { Cell::new(0.0) };
    static SCRIM: Cell<[f32; 4]> = const { Cell::new([0.0; 4]) };
    static SCRIM_CHANGES: Cell<u32> = const { Cell::new(0) };
    static BACKS: Cell<u32> = const { Cell::new(0) };
}

/// The panel's width once its slide is over, CSS px: a flight that ends
/// with the panel in fits its picture to what the panel will leave.
pub fn inset_to() -> f32 {
    INSET_TO.get()
}

pub fn set_inset_to(px: f32) {
    INSET_TO.set(px);
}

/// How many times a group's way back has been taken ("Show all rows", "The
/// whole belt", "Draw a group" pressed back): the scene flies its camera
/// back to where it was before the flight in when this has moved. A group
/// let go by another action's press isn't one: the camera is that action's.
pub fn backs() -> u32 {
    BACKS.get()
}

pub fn back() {
    BACKS.set(BACKS.get().wrapping_add(1));
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

/// Whose camera an input moves: the fixed frame's, or the ride's own, in
/// the frame that turns with Jupiter. The interface says which, from the
/// crate's own state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Frame {
    Fixed = 0,
    Turning = 1,
}

/// A wheel over the scene, at a window position (CSS px): it zooms toward
/// the pointer. Off the web there is no scene.
pub fn wheel(x: f32, y: f32, delta: f32, modifiers: u8, frame: Frame) {
    input();
    #[cfg(target_family = "wasm")]
    crate::web::scene_wheel(x, y, delta, modifiers, frame as u8);
    #[cfg(not(target_family = "wasm"))]
    let _ = (x, y, delta, modifiers, frame);
}

/// A double click on the scene, at a window position: nearer, toward the
/// pointer.
pub fn double_click(x: f32, y: f32, frame: Frame) {
    input();
    #[cfg(target_family = "wasm")]
    crate::web::scene_double_click(x, y, frame as u8);
    #[cfg(not(target_family = "wasm"))]
    let _ = (x, y, frame);
}

/// An arrow key, for `frame`'s camera: it slides along the ecliptic,
/// `right` and `up` each -1, 0, or 1 as the window has them.
pub fn nudge(right: i8, up: i8, frame: Frame) {
    input();
    #[cfg(target_family = "wasm")]
    crate::web::scene_nudge(right, up, frame as u8);
    #[cfg(not(target_family = "wasm"))]
    let _ = (right, up, frame);
}

/// The + key or the − key, for `frame`'s camera: nearer, or farther.
pub fn zoom_step(nearer: bool, frame: Frame) {
    input();
    #[cfg(target_family = "wasm")]
    crate::web::scene_zoom_step(nearer, frame as u8);
    #[cfg(not(target_family = "wasm"))]
    let _ = (nearer, frame);
}

/// The way home, for `frame`'s camera: it flies back to where it opened.
pub fn home(frame: Frame) {
    input();
    #[cfg(target_family = "wasm")]
    crate::web::scene_home(frame as u8);
    #[cfg(not(target_family = "wasm"))]
    let _ = frame;
}

/// Whether the hint was folded on an earlier visit: the page remembers.
pub fn hint_folded() -> bool {
    #[cfg(target_family = "wasm")]
    return crate::web::hint_folded();
    #[cfg(not(target_family = "wasm"))]
    false
}

/// The hint is folded: the page keeps that for the next visit.
pub fn fold_hint() {
    #[cfg(target_family = "wasm")]
    crate::web::fold_hint();
}

/// The scene's resolution, as the visitor may have it: the scene's pixels
/// for each of the display's, and the step's name. The first is the
/// display's own, as the scene opens (`docs/DECISIONS.md`, "Scene").
pub const SCALES: [(f32, &str); 3] = [(1.0, "Full"), (0.75, "¾"), (0.5, "½")];

thread_local! {
    static SCALE: Cell<f32> = const { Cell::new(1.0) };
    static TOUCHING: Cell<bool> = const { Cell::new(false) };
    static TAPPED: Cell<Option<([f32; 2], f64, usize)>> = const { Cell::new(None) };
    static SLOP: Cell<f32> = const { Cell::new(CLICK_SLOP) };
}

/// The scene's pixels for each of the display's: the scene asks each
/// frame, and makes its buffers again when this has moved.
pub fn scale() -> f32 {
    SCALE.get()
}

/// The visitor's choice of a step, which the page keeps for the next visit.
pub fn set_scale(scale: f32) {
    SCALE.set(scale);
    #[cfg(target_family = "wasm")]
    crate::web::keep_scale(scale);
}

/// The step chosen on an earlier visit, if the page kept one of them.
pub fn open_scale() {
    #[cfg(target_family = "wasm")]
    {
        let kept = crate::web::scale_kept();
        if SCALES.iter().any(|(scale, _)| *scale == kept) {
            SCALE.set(kept);
        }
    }
}

/// Whether the visitor's pointer is a finger. Off the web, never.
pub fn coarse() -> bool {
    #[cfg(target_family = "wasm")]
    return crate::web::coarse();
    #[cfg(not(target_family = "wasm"))]
    false
}

/// Whether a finger has the surface, from its landing to its lifting: its
/// moves and release come by the touch listener, not the mouse's.
pub fn touching() -> bool {
    TOUCHING.get()
}

pub fn set_touching(touching: bool) {
    TOUCHING.set(touching);
}

/// A finger landed on the surface at a window position, at `now` (the
/// page clock, ms): which press of a quick run it is, as a mouse's click
/// count says (the platform counts none for a touch it handed over).
pub fn tap([x, y]: [f32; 2], now: f64) -> usize {
    let count = TAPPED
        .get()
        .filter(|&([from_x, from_y], at, _)| {
            now - at <= TAP_WITHIN && (x - from_x).hypot(y - from_y) <= TAP_APART
        })
        .map_or(1, |(_, _, count)| count + 1);
    TAPPED.set(Some(([x, y], now, count)));
    count
}

/// The finger that landed is no tap (it went on to drag, or a second one
/// joined it): the next landing begins a run of its own.
pub fn untap() {
    TAPPED.set(None);
}

/// How far a press may move and still be a click, CSS px: a mouse's, and
/// a finger's, which wobbles.
pub const CLICK_SLOP: f32 = 3.0;
pub const TAP_SLOP: f32 = 10.0;
/// Two taps are a double tap this soon after each other, ms, and this
/// near, CSS px: the platform's own for a touch it recognizes itself.
const TAP_WITHIN: f64 = 400.0;
const TAP_APART: f32 = 16.0;

/// The slop of the press under way: the mouse's, or a finger's.
pub fn set_click_slop(px: f32) {
    SLOP.set(px);
}

thread_local! {
    /// The button of the drag the scene has, from its press on the surface
    /// to its release, wherever in the window that is.
    static DRAG: Cell<Option<u8>> = const { Cell::new(None) };
    /// The frame the surface took this press in, and the one before it:
    /// nothing for a press that went to something over the surface, or
    /// that came while the camera was no hand's.
    static PRESSES: Cell<[Option<Frame>; 2]> = const { Cell::new([None, None]) };
    /// Every input that moves a camera or is a press, counted.
    static INPUTS: Cell<u32> = const { Cell::new(0) };
    /// Where a press that may yet be a click on a dot landed: plain, the
    /// left button's, on the surface, the fixed frame's camera a hand's.
    static CLICK: Cell<Option<[f32; 2]>> = const { Cell::new(None) };
}

/// How many inputs the window has heard that are a press or move a camera
/// (a wheel, a double click, a key, the way home): a click on a dot waits
/// to see that none follows it (a double click's second press, or a hand
/// that went on to something else).
pub fn inputs() -> u32 {
    INPUTS.get()
}

fn input() {
    INPUTS.set(INPUTS.get().wrapping_add(1));
}

/// The surface took a press that a release in the same place makes a
/// click on a dot.
pub fn click_start(x: f32, y: f32) {
    CLICK.set(Some([x, y]));
}

/// The pointer moved: a press that has gone farther than a click's slop is
/// a drag.
pub fn click_moved(x: f32, y: f32) {
    if CLICK
        .get()
        .is_some_and(|[from_x, from_y]| (x - from_x).hypot(y - from_y) > SLOP.get())
    {
        CLICK.set(None);
    }
}

/// A release at a window position: where the click was, if the press it
/// ends was one.
pub fn click_end(x: f32, y: f32) -> Option<[f32; 2]> {
    click_moved(x, y);
    CLICK.take()
}

/// The row whose dot the scene drew nearest a window position, within its
/// reach; none past it, or off the web.
pub fn dot_at(x: f32, y: f32) -> Option<usize> {
    #[cfg(target_family = "wasm")]
    return usize::try_from(crate::web::scene_click(x, y)).ok();
    #[cfg(not(target_family = "wasm"))]
    {
        let _ = (x, y);
        None
    }
}

/// A press anywhere in the window, heard before whatever takes it: a camera
/// gliding stops, and the press before this one is the last one now.
pub fn press() {
    PRESSES.set([None, PRESSES.get()[0]]);
    input();
    CLICK.set(None);
    #[cfg(target_family = "wasm")]
    crate::web::scene_press();
}

/// The surface took this press, plain and with the left button, for
/// `frame`'s camera: whether the press before it was one too, so that a
/// click count of two is a double click on the scene. (The count alone
/// isn't: a first click on a chip that leaves from under the pointer, or
/// while the camera flies, counts as well.)
pub fn surface_press(frame: Frame) -> bool {
    let [_, before] = PRESSES.get();
    PRESSES.set([Some(frame), before]);
    before == Some(frame)
}

/// The button of the drag the scene has (0 the left, 1 the middle, 2 the
/// right), if it has one.
pub fn dragging() -> Option<u8> {
    DRAG.get()
}

/// A press on the surface, at a window position (CSS px): a drag is the
/// scene's from here to its release.
pub fn drag_start(x: f32, y: f32, button: u8, modifiers: u8, frame: Frame) {
    DRAG.set(Some(button));
    #[cfg(target_family = "wasm")]
    crate::web::scene_drag_start(x, y, button, modifiers, frame as u8);
    #[cfg(not(target_family = "wasm"))]
    let _ = (x, y, modifiers, frame);
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

/// A shape begun in the lasso's mode, at a window position (CSS px): the
/// scene draws its outline, as it's drawn.
pub fn draw_start(x: f32, y: f32) {
    #[cfg(target_family = "wasm")]
    crate::web::scene_draw_start(x, y);
    #[cfg(not(target_family = "wasm"))]
    let _ = (x, y);
}

/// The shape's next point.
pub fn draw_move(x: f32, y: f32) {
    #[cfg(target_family = "wasm")]
    crate::web::scene_draw_move(x, y);
    #[cfg(not(target_family = "wasm"))]
    let _ = (x, y);
}

/// The shape's release: `closed`, the outline closes and waits for its
/// rows; not, it's gone (a press and a release in one place).
pub fn draw_end(closed: bool) {
    #[cfg(target_family = "wasm")]
    crate::web::scene_draw_end(closed);
    #[cfg(not(target_family = "wasm"))]
    let _ = closed;
}

/// The scene's camera as it is: projection × view (column-major), then
/// the window's width and height (CSS px). Empty off the web, or before
/// the scene is up.
pub fn camera() -> Vec<f64> {
    #[cfg(target_family = "wasm")]
    return crate::web::scene_camera();
    #[cfg(not(target_family = "wasm"))]
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::{Frame, drag_end, drag_move, drag_start, dragging, modifiers};

    #[test]
    fn a_drag_is_the_scenes_from_its_press_to_its_release() {
        assert_eq!(dragging(), None);
        drag_move(1.0, 1.0);
        assert_eq!(dragging(), None);
        drag_start(10.0, 10.0, 0, 0, Frame::Fixed);
        assert_eq!(dragging(), Some(0));
        drag_move(20.0, 10.0);
        assert_eq!(dragging(), Some(0));
        drag_end(20.0, 10.0);
        assert_eq!(dragging(), None);
        drag_end(20.0, 10.0);
        assert_eq!(dragging(), None);
    }

    #[test]
    fn a_double_click_is_two_presses_the_surface_took_in_one_frame() {
        use super::{press, surface_press};
        // The window hears every press first; the surface, only its own.
        press();
        assert!(!surface_press(Frame::Fixed));
        press();
        assert!(surface_press(Frame::Fixed));
        // A press on something over the surface, then one on the surface.
        press();
        press();
        assert!(!surface_press(Frame::Fixed));
        // One in each frame.
        press();
        assert!(!surface_press(Frame::Turning));
        press();
        assert!(surface_press(Frame::Turning));
    }

    #[test]
    fn a_click_is_a_press_released_where_it_landed() {
        use super::{Frame, click_end, click_moved, click_start, inputs, nudge, press};
        let before = inputs();
        press();
        assert_eq!(inputs(), before.wrapping_add(1));
        nudge(1, 0, Frame::Fixed);
        assert_eq!(inputs(), before.wrapping_add(2));
        // No press the surface took: no click.
        assert_eq!(click_end(10.0, 10.0), None);
        press();
        click_start(10.0, 10.0);
        click_moved(12.0, 11.0);
        assert_eq!(click_end(11.0, 10.0), Some([10.0, 10.0]));
        assert_eq!(click_end(11.0, 10.0), None);
        // Moved past the slop, it's a drag, wherever it's released.
        press();
        click_start(10.0, 10.0);
        click_moved(20.0, 10.0);
        assert_eq!(click_end(10.0, 10.0), None);
        // The next press forgets the last.
        click_start(10.0, 10.0);
        press();
        assert_eq!(click_end(10.0, 10.0), None);
    }

    #[test]
    fn the_modifiers_are_a_bit_each() {
        assert_eq!(modifiers(false, false, false, false), 0);
        assert_eq!(modifiers(true, false, false, false), 1);
        assert_eq!(modifiers(false, true, false, false), 2);
        assert_eq!(modifiers(true, true, true, true), 15);
    }
}
