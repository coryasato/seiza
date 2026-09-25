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

/// Whether the page was opened for measuring (`?perf` or `?bench` in the
/// URL). Hooks only the scripts read, like [`publish_table`] and the
/// table's `tycho:viewport-filled` mark, run only then.
pub fn measuring() -> bool {
    thread_local! {
        static MEASURING: bool =
            seiza::url::has_param("perf") || seiza::url::has_param("bench");
    }
    MEASURING.with(|measuring| *measuring)
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

/// Publishes what the table shows to `globalThis.__tychoTable`, when it
/// changes: `{rows, top, first, end, loaded, pending, failed, lastCell}`.
/// The table calls it only while [`measuring`].
pub fn publish_table(probe: &crate::table::TableProbe) {
    #[cfg(target_family = "wasm")]
    {
        use js_sys::{Object, Reflect};
        use wasm_bindgen::JsValue;

        thread_local! {
            static LAST: std::cell::RefCell<Option<crate::table::TableProbe>> =
                const { std::cell::RefCell::new(None) };
        }
        if LAST.with_borrow(|last| last.as_ref() == Some(probe)) {
            return;
        }
        LAST.set(Some(probe.clone()));
        let object = Object::new();
        let set = |key: &str, value: JsValue| {
            let _ = Reflect::set(&object, &JsValue::from_str(key), &value);
        };
        set("rows", JsValue::from_f64(probe.rows as f64));
        set("top", JsValue::from_f64(probe.top));
        set("first", JsValue::from_f64(probe.first as f64));
        set("end", JsValue::from_f64(probe.end as f64));
        set("loaded", JsValue::from_f64(probe.loaded as f64));
        set("pending", JsValue::from_f64(probe.pending as f64));
        set("failed", JsValue::from_f64(probe.failed as f64));
        set(
            "lastCell",
            probe
                .last_cell
                .as_deref()
                .map_or(JsValue::NULL, JsValue::from_str),
        );
        let _ = Reflect::set(
            &js_sys::global(),
            &JsValue::from_str("__tychoTable"),
            &object,
        );
    }
    #[cfg(not(target_family = "wasm"))]
    let _ = probe;
}
