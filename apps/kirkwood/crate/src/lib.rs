//! Kirkwood: the asteroid belt as a scene whose every dot is a row of the
//! table beside it (`apps/kirkwood/CLAUDE.md`).
//!
//! What's here:
//! - the two files' bytes, each held once as it arrived and read where it
//!   lies ([`bytes`]): the elements ([`elements`]) and the table's other
//!   columns ([`rows`]), as one table of the sample's 18 columns
//!   ([`catalog`]);
//! - the table's source over them ([`table`]): every page a view;
//! - the clock ([`clock`]), and where an orbit puts its body at a time on
//!   it, in 64-bit floats ([`orbit`]): a row's place, and Jupiter's;
//! - the interface ([`host`]): the title, the time control, and the table
//!   in a panel behind its handle, over a surface that hands the scene its
//!   wheel (`scene`);
//! - on the web, the entry point, the files' arrival, and what the scene
//!   asks each frame (`web`).
//!
//! The scene itself is the page's (`web/src/scene.ts`, Three.js): its
//! attributes are views over the elements' columns, here in this memory.

pub mod bytes;
pub mod catalog;
pub mod clock;
pub mod elements;
mod host;
pub mod orbit;
pub mod rows;
pub mod scene;
#[cfg(test)]
mod shader;
mod table;
#[cfg(target_family = "wasm")]
mod web;

pub use host::Host;
