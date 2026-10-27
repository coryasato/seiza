//! The web's clipboard for the table's copies (`copy`): the table builds a
//! copy's text and reports it in events, and this writes it (the table's
//! `docs/DECISIONS.md`, "Features"). At `Started`, in the task that asked
//! (a key's, so the gesture still counts), it opens
//! `navigator.clipboard.write([new ClipboardItem({'text/plain': promise})])`;
//! it keeps each `Text` as a JS string; at `Copied` it resolves the promise
//! with a Blob of them, dropping the strings once it's built; at `Failed`
//! it rejects it, leaving the clipboard as it was. Without `ClipboardItem`
//! (an old browser) it calls `writeText` at `Copied`, which lands only
//! within ~5 s of the key. Without `navigator.clipboard` (an insecure
//! context) nothing can be written: [`Clipboard::event`] says so at
//! `Started`, and the host cancels the copy.
//!
//! What became of the last copy started ([`Outcome`]) goes on a global the
//! host names and to a callback it gives; an earlier copy's write settling
//! after a later copy started says nothing. Natively every call is a no-op.

#[cfg(target_family = "wasm")]
use seiza_tall_table::CopyFailure;
use seiza_tall_table::{CopyId, TallTableCopy};

/// What became of a copy, as the host is told: on its global (as
/// [`Outcome::to_js`] writes it) and to its callback.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum Outcome {
    /// Cmd+C past the key's limit: nothing read. A host may ask the reader
    /// and call `copy`.
    Declined { rows: u64, columns: usize },
    /// The write is open and the text coming: `rows_done` of `rows`.
    Copying {
        id: CopyId,
        rows: u64,
        rows_done: u64,
    },
    /// Every piece in: the browser is writing `bytes` bytes.
    Writing { id: CopyId, bytes: usize },
    /// The browser wrote it.
    Written { id: CopyId, bytes: usize },
    /// The browser refused the write (`NotAllowedError: …`). Refused while
    /// the copy ran, [`Clipboard::event`] asks the host to cancel it at its
    /// next event.
    Refused { id: CopyId, error: String },
    /// The copy ended without its text: the write rejected, the clipboard
    /// as it was.
    Failed { id: CopyId, reason: Failure },
    /// Nothing can be written here (no `navigator.clipboard`: an insecure
    /// context); the host cancels the copy.
    Unavailable { id: CopyId },
}

/// Why a copy's write was rejected.
#[derive(Debug, Clone, PartialEq)]
pub enum Failure {
    /// The table's `CopyFailure::TooLarge`.
    TooLarge { bytes: usize, max_bytes: usize },
    /// The table's `CopyFailure::Read`.
    Read(String),
    /// The table's `CopyFailure::Cancelled`.
    Cancelled,
    /// The host closed the table during the copy ([`Clipboard::closed`]).
    Closed,
}

#[cfg(target_family = "wasm")]
impl Failure {
    fn from_copy(reason: &CopyFailure) -> Self {
        match reason {
            CopyFailure::TooLarge { bytes, max_bytes } => Self::TooLarge {
                bytes: *bytes,
                max_bytes: *max_bytes,
            },
            CopyFailure::Read(error) => Self::Read(error.clone()),
            // `Cancelled`, and a reason this bridge doesn't know yet
            // (`#[non_exhaustive]`).
            _ => Self::Cancelled,
        }
    }
}

/// What a host is told each [`Outcome`] through.
pub type OnOutcome = Box<dyn Fn(&Outcome)>;

/// Writes the table's copies to the web's clipboard: hand it each
/// `TallTableEvent::Copy`, and tell it when the table closes.
pub struct Clipboard {
    #[cfg(target_family = "wasm")]
    web: web::Writer,
}

impl Clipboard {
    /// A writer publishing each [`Outcome`] on global `global` (if any) and
    /// to `on_outcome` (if any). The callback runs outside GPUI when the
    /// browser settles a write; a host that updates its views from it
    /// enters GPUI through its foreground executor.
    #[cfg_attr(
        not(target_family = "wasm"),
        expect(unused_variables, reason = "natively a no-op")
    )]
    pub fn new(global: Option<&'static str>, on_outcome: Option<OnOutcome>) -> Self {
        Self {
            #[cfg(target_family = "wasm")]
            web: web::Writer::new(global, on_outcome),
        }
    }

    /// Takes a copy's event. Returns the copy to cancel (`cancel_copy`)
    /// when its text can't be written: no clipboard here, or the browser
    /// refused the write while the copy ran.
    #[must_use]
    #[cfg_attr(
        not(target_family = "wasm"),
        expect(unused_variables, reason = "natively a no-op")
    )]
    pub fn event(&mut self, event: &TallTableCopy) -> Option<CopyId> {
        #[cfg(target_family = "wasm")]
        return self.web.event(event);
        #[cfg(not(target_family = "wasm"))]
        None
    }

    /// The host closed the table (`close`, which ends a copy without an
    /// event): a write still open is rejected.
    pub fn closed(&mut self) {
        #[cfg(target_family = "wasm")]
        self.web.closed();
    }
}

#[cfg(target_family = "wasm")]
impl Outcome {
    /// `{state, id, …}`: `state` is `declined` (`rows`, `columns`),
    /// `copying` (`rows`, `rowsDone`), `writing` or `written` (`bytes`),
    /// `refused` (`error`), `failed` (`reason`: `too-large`, with `bytes`
    /// and `maxBytes`, `read`, with `error`, `cancelled`, or `closed`), or
    /// `unavailable`; `id` is the copy's (`null` when declined).
    pub fn to_js(&self) -> wasm_bindgen::JsValue {
        use js_sys::{Object, Reflect};
        use wasm_bindgen::JsValue;
        let object = Object::new();
        let set = |key: &str, value: JsValue| {
            let _ = Reflect::set(&object, &JsValue::from_str(key), &value);
        };
        let number = |value: f64| JsValue::from_f64(value);
        let (state, id) = match self {
            Self::Declined { rows, columns } => {
                set("rows", number(*rows as f64));
                set("columns", number(*columns as f64));
                ("declined", None)
            }
            Self::Copying {
                id,
                rows,
                rows_done,
            } => {
                set("rows", number(*rows as f64));
                set("rowsDone", number(*rows_done as f64));
                ("copying", Some(id))
            }
            Self::Writing { id, bytes } => {
                set("bytes", number(*bytes as f64));
                ("writing", Some(id))
            }
            Self::Written { id, bytes } => {
                set("bytes", number(*bytes as f64));
                ("written", Some(id))
            }
            Self::Refused { id, error } => {
                set("error", JsValue::from_str(error));
                ("refused", Some(id))
            }
            Self::Failed { id, reason } => {
                let reason = match reason {
                    Failure::TooLarge { bytes, max_bytes } => {
                        set("bytes", number(*bytes as f64));
                        set("maxBytes", number(*max_bytes as f64));
                        "too-large"
                    }
                    Failure::Read(error) => {
                        set("error", JsValue::from_str(error));
                        "read"
                    }
                    Failure::Cancelled => "cancelled",
                    Failure::Closed => "closed",
                };
                set("reason", JsValue::from_str(reason));
                ("failed", Some(id))
            }
            Self::Unavailable { id } => ("unavailable", Some(id)),
        };
        set("state", JsValue::from_str(state));
        set("id", id.map_or(JsValue::NULL, |id| number(id.get() as f64)));
        object.into()
    }
}

#[cfg(target_family = "wasm")]
mod web {
    use std::cell::Cell;
    use std::rc::Rc;

    use js_sys::{Array, Function, Object, Promise, Reflect};
    use seiza_tall_table::{CopyId, TallTableCopy};
    use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};

    use super::{Failure, OnOutcome, Outcome};

    /// What the write's settling reads: it runs outside the writer, when
    /// the browser answers.
    struct Shared {
        global: Option<&'static str>,
        on_outcome: Option<OnOutcome>,
        /// The copy whose write is open and whose text is still coming: a
        /// rejection of its write is the browser's refusal.
        open: Cell<Option<CopyId>>,
        /// The copy whose text is in and whose write the browser is
        /// settling, and its bytes.
        writing: Cell<Option<(CopyId, usize)>>,
        /// The last copy started: the one the global and the callback
        /// describe.
        latest: Cell<Option<CopyId>>,
    }

    impl Shared {
        fn tell(&self, outcome: &Outcome) {
            if let Some(name) = self.global {
                crate::js::set_global(name, &outcome.to_js());
            }
            if let Some(on_outcome) = &self.on_outcome {
                on_outcome(outcome);
            }
        }

        /// Tells what became of `id`'s write when the browser settles it,
        /// unless a later copy has started since: the global describes the
        /// last copy, and the clipboard is the later one's to write.
        fn tell_settled(&self, id: CopyId, outcome: &Outcome) {
            if self.latest.get() == Some(id) {
                self.tell(outcome);
            }
        }
    }

    /// How the text reaches the clipboard.
    enum Write {
        /// A `ClipboardItem` opened at the start, its promise's ends.
        Item { resolve: Function, reject: Function },
        /// `writeText` at the end (no `ClipboardItem`).
        Text { clipboard: JsValue },
    }

    /// The copy whose write is open.
    struct Open {
        id: CopyId,
        rows: u64,
        /// Its pieces so far, as JS strings.
        pieces: Array,
        write: Write,
    }

    pub(super) struct Writer {
        shared: Rc<Shared>,
        open: Option<Open>,
    }

    fn get(target: &JsValue, key: &str) -> JsValue {
        Reflect::get(target, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)
    }

    /// A thrown or rejected value as `Name: message`.
    fn error_text(error: &JsValue) -> String {
        let (name, message) = (
            get(error, "name").as_string(),
            get(error, "message").as_string(),
        );
        match (name, message) {
            (Some(name), Some(message)) => format!("{name}: {message}"),
            _ => error.as_string().unwrap_or_else(|| format!("{error:?}")),
        }
    }

    impl Writer {
        pub(super) fn new(global: Option<&'static str>, on_outcome: Option<OnOutcome>) -> Self {
            Self {
                shared: Rc::new(Shared {
                    global,
                    on_outcome,
                    open: Cell::new(None),
                    writing: Cell::new(None),
                    latest: Cell::new(None),
                }),
                open: None,
            }
        }

        pub(super) fn event(&mut self, event: &TallTableCopy) -> Option<CopyId> {
            match event {
                TallTableCopy::Declined { rows, columns } => {
                    self.shared.tell(&Outcome::Declined {
                        rows: *rows,
                        columns: *columns,
                    });
                    None
                }
                TallTableCopy::Started { id, rows, .. } => {
                    // The table cancels a copy before starting the next, so
                    // one still open is already rejected; this is a guard.
                    self.reject(Failure::Cancelled);
                    self.shared.latest.set(Some(*id));
                    let rows = rows.end().saturating_sub(*rows.start()) + 1;
                    self.start(*id, rows)
                }
                TallTableCopy::Text {
                    id,
                    text,
                    rows_done,
                } => {
                    let open = self.open.as_mut().filter(|open| open.id == *id)?;
                    if self.shared.open.get() != Some(*id) {
                        // The browser refused the write while the copy ran.
                        self.open = None;
                        return Some(*id);
                    }
                    open.pieces.push(&JsValue::from_str(text));
                    let rows = open.rows;
                    self.shared.tell(&Outcome::Copying {
                        id: *id,
                        rows,
                        rows_done: *rows_done,
                    });
                    None
                }
                TallTableCopy::Copied { id, bytes, .. } => {
                    self.finish(*id, *bytes);
                    None
                }
                TallTableCopy::Failed { id, reason } => {
                    // A copy with no write open was said already: no
                    // clipboard, or the browser refused it.
                    if self.open.as_ref().is_some_and(|open| open.id == *id) {
                        self.reject(Failure::from_copy(reason));
                    }
                    None
                }
                // A copy event this bridge doesn't know yet.
                _ => None,
            }
        }

        /// Opens `id`'s write, or says why it can't be.
        fn start(&mut self, id: CopyId, rows: u64) -> Option<CopyId> {
            let global: JsValue = js_sys::global().into();
            let clipboard = get(&get(&global, "navigator"), "clipboard");
            if clipboard.is_undefined() || clipboard.is_null() {
                self.shared.tell(&Outcome::Unavailable { id });
                return Some(id);
            }
            let item = get(&global, "ClipboardItem");
            let (write, written) = if let Some(item) = item.dyn_ref::<Function>() {
                let (mut resolve, mut reject) = (None, None);
                let text = Promise::new(&mut |ok, fail| {
                    resolve = Some(ok);
                    reject = Some(fail);
                });
                let data = Object::new();
                let _ = Reflect::set(&data, &JsValue::from_str("text/plain"), &text);
                let opened = Reflect::construct(item, &Array::of1(&data)).and_then(|item| {
                    let write = get(&clipboard, "write").dyn_into::<Function>()?;
                    write.call1(&clipboard, &Array::of1(&item))
                });
                let written = match opened {
                    Ok(written) => written,
                    Err(error) => {
                        self.shared.tell(&Outcome::Refused {
                            id,
                            error: error_text(&error),
                        });
                        return Some(id);
                    }
                };
                let write = Write::Item {
                    resolve: resolve.expect("the promise's executor runs at once"),
                    reject: reject.expect("the promise's executor runs at once"),
                };
                (write, Some(written))
            } else {
                (Write::Text { clipboard }, None)
            };
            self.shared.open.set(Some(id));
            // Settled on a later task: the write is open by then.
            if let Some(written) = written {
                self.settle(id, &written);
            }
            self.open = Some(Open {
                id,
                rows,
                pieces: Array::new(),
                write,
            });
            self.shared.tell(&Outcome::Copying {
                id,
                rows,
                rows_done: 0,
            });
            None
        }

        /// `id`'s text is in: the item's promise resolved with a Blob of
        /// its pieces, or `writeText` called with them joined.
        fn finish(&mut self, id: CopyId, bytes: usize) {
            if self.open.as_ref().is_none_or(|open| open.id != id) {
                return;
            }
            let Some(open) = self.open.take() else {
                return;
            };
            if self.shared.open.get() != Some(id) {
                // Refused by the browser already, and said.
                return;
            }
            self.shared.open.set(None);
            self.shared.writing.set(Some((id, bytes)));
            self.shared.tell(&Outcome::Writing { id, bytes });
            let Open { pieces, write, .. } = open;
            match write {
                Write::Item { resolve, reject } => {
                    let options = Object::new();
                    let _ = Reflect::set(
                        &options,
                        &JsValue::from_str("type"),
                        &JsValue::from_str("text/plain"),
                    );
                    let blob = get(&js_sys::global().into(), "Blob")
                        .dyn_into::<Function>()
                        .and_then(|blob| Reflect::construct(&blob, &Array::of2(&pieces, &options)));
                    // The strings go with `pieces` here: the Blob holds the
                    // text now.
                    drop(pieces);
                    match blob {
                        Ok(blob) => drop(resolve.call1(&JsValue::NULL, &blob)),
                        Err(error) => {
                            // Settled, so the browser's write ends too.
                            drop(reject.call1(&JsValue::NULL, &error));
                            self.refused(id, &error);
                        }
                    }
                }
                Write::Text { clipboard } => {
                    let text = pieces.join("");
                    drop(pieces);
                    let written = get(&clipboard, "writeText")
                        .dyn_into::<Function>()
                        .and_then(|write| write.call1(&clipboard, &text));
                    match written {
                        Ok(written) => self.settle(id, &written),
                        Err(error) => self.refused(id, &error),
                    }
                }
            }
        }

        /// Rejects the open write, if any, for `reason`: the clipboard as
        /// it was.
        fn reject(&mut self, reason: Failure) {
            let Some(open) = self.open.take() else {
                return;
            };
            let id = open.id;
            let refused = self.shared.open.get() != Some(id);
            self.shared.open.set(None);
            if let Write::Item { reject, .. } = open.write {
                let error = js_sys::Error::new(match reason {
                    Failure::TooLarge { .. } => "the copy is too large",
                    Failure::Read(_) => "a read for the copy failed",
                    Failure::Cancelled => "the copy was cancelled",
                    Failure::Closed => "the table closed",
                });
                drop(reject.call1(&JsValue::NULL, &error));
            }
            // A write the browser refused stays said so.
            if !refused {
                self.shared.tell(&Outcome::Failed { id, reason });
            }
        }

        pub(super) fn closed(&mut self) {
            self.reject(Failure::Closed);
        }

        /// The browser refused `id`'s write as it was made.
        fn refused(&self, id: CopyId, error: &JsValue) {
            self.shared.writing.set(None);
            self.shared.tell(&Outcome::Refused {
                id,
                error: error_text(error),
            });
        }

        /// Says what became of `id`'s write when `written` settles: written
        /// or refused if its text was in by then, refused (and the copy to
        /// cancel at its next event) if it was still coming, and nothing if
        /// this writer rejected it.
        fn settle(&self, id: CopyId, written: &JsValue) {
            let Ok(written) = written.clone().dyn_into::<Promise>() else {
                return;
            };
            let shared = self.shared.clone();
            let on_written = Closure::once_into_js(move |_: JsValue| {
                if let Some((writing, bytes)) = shared.writing.get()
                    && writing == id
                {
                    shared.writing.set(None);
                    shared.tell_settled(id, &Outcome::Written { id, bytes });
                }
            });
            let shared = self.shared.clone();
            let on_refused = Closure::once_into_js(move |error: JsValue| {
                let refused = if shared
                    .writing
                    .get()
                    .is_some_and(|(writing, _)| writing == id)
                {
                    shared.writing.set(None);
                    true
                } else if shared.open.get() == Some(id) {
                    // Still copying: the next event cancels it.
                    shared.open.set(None);
                    true
                } else {
                    false
                };
                if refused {
                    shared.tell_settled(
                        id,
                        &Outcome::Refused {
                            id,
                            error: error_text(&error),
                        },
                    );
                }
            });
            let then = get(&written, "then");
            if let Some(then) = then.dyn_ref::<Function>() {
                drop(then.call2(&written, &on_written, &on_refused));
            }
        }
    }
}
