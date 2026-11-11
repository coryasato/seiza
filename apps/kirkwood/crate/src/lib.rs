//! Kirkwood: the asteroid belt as a scene whose every dot is a row of the
//! table beside it (`apps/kirkwood/CLAUDE.md`).
//!
//! What's here:
//! - the two files' bytes, each held once as it arrived and read where it
//!   lies ([`bytes`]): the elements ([`elements`]) and the table's other
//!   columns ([`rows`]), as one table of the sample's 18 columns
//!   ([`catalog`]);
//! - the table's source over them ([`table`]): every page a view;
//! - the clock ([`clock`]);
//! - the interface ([`host`]): the title, the time control, and the table
//!   in a panel behind its handle;
//! - on the web, the entry point and the files' arrival (`web`).

pub mod bytes;
pub mod catalog;
pub mod clock;
pub mod elements;
mod host;
pub mod rows;
mod table;
#[cfg(target_family = "wasm")]
mod web;

pub use host::Host;
