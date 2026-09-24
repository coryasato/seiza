//! Where named controls are on the canvas, for the Playwright checks.
//!
//! The UI is drawn on a canvas, so there's no DOM element to click. Views
//! publish a control's bounds (CSS pixels, from the canvas's top-left) to
//! `globalThis.__tychoTargets[id] = [x, y, width, height]`, and the scripts
//! click its center. Written only when the bounds change.

use gpui_kit::{Bounds, Pixels};

#[cfg(target_family = "wasm")]
thread_local! {
    static PUBLISHED: std::cell::RefCell<Vec<(&'static str, Bounds<Pixels>)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

pub fn publish(id: &'static str, bounds: Bounds<Pixels>) {
    #[cfg(target_family = "wasm")]
    {
        use js_sys::{Array, Object, Reflect};
        use wasm_bindgen::JsValue;

        let changed = PUBLISHED.with_borrow_mut(|published| {
            match published.iter_mut().find(|(existing, _)| *existing == id) {
                Some((_, old)) if *old == bounds => false,
                Some((_, old)) => {
                    *old = bounds;
                    true
                }
                None => {
                    published.push((id, bounds));
                    true
                }
            }
        });
        if !changed {
            return;
        }
        let global = js_sys::global();
        let key = JsValue::from_str("__tychoTargets");
        let targets = Reflect::get(&global, &key)
            .ok()
            .filter(JsValue::is_object)
            .unwrap_or_else(|| {
                let targets: JsValue = Object::new().into();
                let _ = Reflect::set(&global, &key, &targets);
                targets
            });
        let rect: Array = [
            f32::from(bounds.origin.x),
            f32::from(bounds.origin.y),
            f32::from(bounds.size.width),
            f32::from(bounds.size.height),
        ]
        .into_iter()
        .map(|value| JsValue::from_f64(value.into()))
        .collect();
        let _ = Reflect::set(&targets, &JsValue::from_str(id), &rect);
    }
    #[cfg(not(target_family = "wasm"))]
    let _ = (id, bounds);
}
