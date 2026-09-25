//! The page URL's query parameters (`?perf`, and whatever an app reads).
//! Always false or `None` off the web.

/// Whether the page URL has `?name` (with or without a value).
pub fn has_param(name: &str) -> bool {
    params().is_some_and(|params| params.has(name))
}

/// `?name=value`'s value, if the page URL has it.
pub fn param(name: &str) -> Option<String> {
    params().and_then(|params| params.get(name))
}

#[cfg(target_family = "wasm")]
fn params() -> Option<web_sys::UrlSearchParams> {
    let search = web_sys::window()?.location().search().ok()?;
    web_sys::UrlSearchParams::new_with_str(&search).ok()
}

#[cfg(not(target_family = "wasm"))]
fn params() -> Option<NativeParams> {
    None
}

/// Stands in for `UrlSearchParams` off the web, where there's no URL.
#[cfg(not(target_family = "wasm"))]
struct NativeParams;

#[cfg(not(target_family = "wasm"))]
impl NativeParams {
    fn has(&self, _: &str) -> bool {
        false
    }

    fn get(&self, _: &str) -> Option<String> {
        None
    }
}
