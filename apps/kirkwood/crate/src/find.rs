//! A row found: the row a press on the table (or "Find Ceres") picked, which
//! the scene marks on its dot and flies its camera to. One row at a time,
//! and it is the table's selected row: the interface finds what the table
//! selects, and lets go of what it clears.
//!
//! What's here is which row, its name, and whether it has a dot to fly to
//! (a row with no ellipse has none). The flight, and whether the camera
//! still follows the row, are the scene's camera's (`web/src/scene.ts`).

use std::cell::{Cell, RefCell};

thread_local! {
    /// The row, and whether it has a dot.
    static FOUND: Cell<Option<(usize, bool)>> = const { Cell::new(None) };
    /// Its name, as the mark says it.
    static NAME: RefCell<String> = const { RefCell::new(String::new()) };
    /// How many times a row has been found: the scene flies when this
    /// moves, so the row found again is flown to again.
    static FINDS: Cell<u32> = const { Cell::new(0) };
}

/// `row` is found: `name` is what its mark says, `dot` whether it has a
/// dot for the scene to mark and fly to.
pub fn find(row: usize, name: String, dot: bool) {
    FOUND.set(Some((row, dot)));
    NAME.set(name);
    FINDS.set(FINDS.get().wrapping_add(1));
}

/// No row is found.
pub fn let_go() {
    FOUND.set(None);
    NAME.set(String::new());
}

/// The row found, dot or none.
pub fn found() -> Option<usize> {
    FOUND.get().map(|(row, _)| row)
}

/// The row the scene marks: the one found, if it has a dot.
pub fn marked() -> Option<usize> {
    FOUND.get().and_then(|(row, dot)| dot.then_some(row))
}

/// The found row's name; empty with none found.
pub fn name() -> String {
    NAME.with_borrow(Clone::clone)
}

/// How many times a row has been found.
pub fn finds() -> u32 {
    FINDS.get()
}

#[cfg(test)]
mod tests {
    use super::{find, finds, found, let_go, marked, name};

    #[test]
    fn one_row_is_found_at_a_time_and_only_a_dot_is_marked() {
        assert_eq!((found(), marked()), (None, None));
        find(0, "Ceres".into(), true);
        assert_eq!(
            (found(), marked(), name().as_str()),
            (Some(0), Some(0), "Ceres")
        );
        // A row with no ellipse is found, and has nothing to mark.
        find(7, "1I/ʻOumuamua".into(), false);
        assert_eq!((found(), marked()), (Some(7), None));
        let_go();
        assert_eq!((found(), marked(), name().as_str()), (None, None, ""));
    }

    #[test]
    fn the_same_row_found_again_is_a_find_again() {
        let before = finds();
        find(3, "Juno".into(), true);
        find(3, "Juno".into(), true);
        assert_eq!(finds(), before.wrapping_add(2));
        let_go();
        assert_eq!(finds(), before.wrapping_add(2));
    }
}
