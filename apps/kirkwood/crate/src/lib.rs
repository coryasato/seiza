//! Kirkwood: the asteroid belt as a scene whose every dot is a row of the
//! table beside it (`apps/kirkwood/CLAUDE.md`).
//!
//! What's here:
//! - the two files' bytes, each held once as it arrived and read where it
//!   lies ([`bytes`]): the elements ([`elements`]) and the table's other
//!   columns ([`rows`]), as one table of the sample's 18 columns
//!   ([`catalog`]);
//! - the table's source over them ([`table`]): every page a view;
//! - the live columns ([`live`]): a row's distance from the Sun and from
//!   Jupiter at the instant the table shows;
//! - the clock ([`clock`]), and where an orbit puts its body at a time on
//!   it, in 64-bit floats ([`orbit`]): a row's place, and Jupiter's;
//! - a dot's color by its orbit size ([`ramp`]): the scene's and the
//!   legend's one table;
//! - the sort flight's progress ([`flight`]) and the axes it lands the
//!   dots on, a against e ([`layout`]);
//! - the ride with Jupiter ([`ride`]): how far the frame has turned to
//!   it, the points in step with it, and the two groups that hold there;
//! - a gap picked ([`gap`]): a marker on an orbit exactly in step with
//!   Jupiter, its path in the frame that turns, and its card's numbers;
//! - a row found ([`find`]): the table's selected row, which the scene
//!   marks on its dot and flies its camera to;
//! - a group drawn ([`group`]): the lasso's mode, the shape, and the rows
//!   under it, picked through the scene's camera a frame's worth at a time;
//! - those two groups moved for real ([`integrate`]): the Hildas and the
//!   Trojans under the Sun and Jupiter, and their places for the scene;
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
pub mod find;
pub mod flight;
pub mod gap;
pub mod group;
mod host;
pub mod integrate;
pub mod layout;
pub mod live;
pub mod orbit;
pub mod ramp;
pub mod ride;
pub mod rows;
pub mod scene;
#[cfg(test)]
mod shader;
mod table;
mod tween;
#[cfg(target_family = "wasm")]
mod web;

pub use host::Host;
