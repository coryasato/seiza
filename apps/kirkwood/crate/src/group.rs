//! A group drawn: in the lasso's mode a drag draws a freehand shape over
//! the scene, and its release closes it. The group is every row whose dot
//! lies under the shape through the scene's whole depth: a set of rows, not
//! a region, so its dots stay lit as they drift apart. The scene grays
//! every other dot (a byte a row), and the table reads the group's rows
//! (their indices, in the file's order).
//!
//! The pick is taken off the frame (`docs/DECISIONS.md`, "Scene"). Time is
//! paused in the mode, so where each row is can't change under the shape:
//! the rows are placed a few milliseconds a frame from the moment the mode
//! begins ([`step`]), while the shape is being drawn, and at the release
//! what's left is a row's place through the scene's camera and one lookup
//! in the shape's pixels ([`Mask`]), spread over frames the same way.
//!
//! A group is flown in to: with its rows comes where their dots were in the
//! window it was drawn in, the middle of them ([`Group::fit`]), which the
//! scene's camera closes on. And its biggest bodies are named ([`name`]):
//! the rows, and what each one's label says.
//!
//! A click on one dot is a group of that row alone ([`pick_one`]): no
//! shape, and nothing to fit.
//!
//! What's here is the mode, the shape, the work, and the group. Who enters
//! and leaves the mode, and what the group does to the table, are the
//! interface's (`host.rs`); the outline and the gray are the scene's.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

/// The least distance between two of a shape's points, CSS px: a slow
/// drag adds nothing.
const APART: f32 = 2.0;
/// The most points a shape keeps.
const MOST_POINTS: usize = 4096;
/// The rows placed, or tested against the shape, between two looks at the
/// frame's budget.
const PLACED_AT_ONCE: usize = 2048;
const TESTED_AT_ONCE: usize = 16_384;
/// The share of a group's dots left out at each side of the window when
/// the camera fits it: a few rows far from the rest (a body on a long
/// orbit, behind the others) don't decide where it flies.
const FIT_TRIM: f64 = 0.01;

/// A closed shape's pixels, filled once: a row's test is one lookup. A
/// pixel is inside when its center is, by the even-odd rule.
pub struct Mask {
    width: usize,
    height: usize,
    bits: Vec<u64>,
}

impl Mask {
    /// The pixels of a window `width` by `height` (CSS px) inside the
    /// closed shape through `points`.
    pub fn fill(points: &[[f32; 2]], width: f64, height: f64) -> Self {
        let (width, height) = (
            width.ceil().max(0.0) as usize,
            height.ceil().max(0.0) as usize,
        );
        let mut mask = Self {
            width,
            height,
            bits: vec![0; (width * height).div_ceil(64)],
        };
        let mut crossings: Vec<f64> = Vec::new();
        for row in 0..height {
            let y = row as f64 + 0.5;
            crossings.clear();
            for (at, from) in points.iter().enumerate() {
                let to = points[(at + 1) % points.len()];
                let (x0, y0) = (f64::from(from[0]), f64::from(from[1]));
                let (x1, y1) = (f64::from(to[0]), f64::from(to[1]));
                if (y0 > y) != (y1 > y) {
                    crossings.push(x0 + (y - y0) * (x1 - x0) / (y1 - y0));
                }
            }
            crossings.sort_by(f64::total_cmp);
            // A center is inside when an odd count of crossings lie past
            // it: from each odd crossing to the next.
            for pair in crossings.as_chunks::<2>().0 {
                let from = (pair[0] - 0.5).ceil().max(0.0) as usize;
                let to = ((pair[1] - 0.5).ceil().max(0.0) as usize).min(width);
                for column in from..to {
                    let bit = row * width + column;
                    mask.bits[bit / 64] |= 1 << (bit % 64);
                }
            }
        }
        mask
    }

    /// Whether the pixel a window position falls in is inside the shape.
    pub fn holds(&self, x: f64, y: f64) -> bool {
        if !(x >= 0.0 && y >= 0.0) {
            return false;
        }
        let (column, row) = (x as usize, y as usize);
        if column >= self.width || row >= self.height {
            return false;
        }
        let bit = row * self.width + column;
        self.bits[bit / 64] >> (bit % 64) & 1 == 1
    }

    /// Whether any pixel is inside.
    pub fn is_empty(&self) -> bool {
        self.bits.iter().all(|&word| word == 0)
    }
}

/// The scene's camera at a release: projection × view, column-major, as
/// the scene's own matrix is, and the window it draws into (CSS px).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera {
    pub matrix: [f64; 16],
    pub width: f64,
    pub height: f64,
}

impl Camera {
    /// The scene's answer (`scene::camera`): 16 numbers and the window's
    /// two; nothing from anything else.
    pub fn from_scene(numbers: &[f64]) -> Option<Self> {
        let (matrix, size) = numbers.split_first_chunk::<16>()?;
        let &[width, height] = size else {
            return None;
        };
        Some(Self {
            matrix: *matrix,
            width,
            height,
        })
    }

    /// Where a place (the ecliptic's x, y, z, au) is drawn in the window,
    /// CSS px; nothing for a place the scene doesn't draw (behind the
    /// camera, or past its near or far plane).
    pub fn window(&self, place: [f32; 3]) -> Option<[f64; 2]> {
        // The ecliptic is the scene's xz plane.
        let (x, y, z) = (
            f64::from(place[0]),
            f64::from(place[2]),
            -f64::from(place[1]),
        );
        let m = &self.matrix;
        let along = |row: usize| m[row] * x + m[4 + row] * y + m[8 + row] * z + m[12 + row];
        let (clip_x, clip_y, clip_z, w) = (along(0), along(1), along(2), along(3));
        if !(w > 0.0 && clip_z >= -w && clip_z <= w) {
            return None;
        }
        Some([
            (clip_x / w + 1.0) / 2.0 * self.width,
            (1.0 - clip_y / w) / 2.0 * self.height,
        ])
    }
}

/// The rows picked: the table's, the scene's, and where the shape was.
pub struct Group {
    /// The group's rows, in the file's order.
    pub rows: Rc<[u32]>,
    /// A byte a row of the file: 1 in the group. The scene's copy is made
    /// from a view over these, which never move while the group is held.
    pub bytes: Vec<u8>,
    /// The closed shape, window positions (CSS px) as it was drawn; none
    /// for a row picked by a click on its dot.
    pub shape: Vec<[f32; 2]>,
    /// The clock's years it was drawn on: its outline is true only there.
    pub years: f64,
    /// Where its dots were in the window it was drawn in, but for the
    /// [`FIT_TRIM`] of them farthest out each way: left, top, right, bottom
    /// (CSS px). The camera's flight in fits this to what the panel leaves.
    /// None for a row picked by a click.
    pub fit: Option<[f32; 4]>,
}

/// One of a group's biggest bodies, named on its dot.
#[derive(Clone, Debug, PartialEq)]
pub struct Named {
    pub row: u32,
    /// Its name, and its diameter, as its label says them.
    pub name: String,
    pub size: String,
}

/// A release waiting for its rows.
struct Pending {
    mask: Mask,
    camera: Camera,
    shape: Vec<[f32; 2]>,
    /// The rows tested so far, and those inside.
    tested: usize,
    inside: Vec<u32>,
    /// Of those inside, how many fell in each column of the window's
    /// pixels, and in each row of them.
    across: Vec<u32>,
    down: Vec<u32>,
    /// Whether the rows drawn apart have been put where they're drawn.
    apart: bool,
}

/// The mode's work: every row's place on the clock's (paused) years.
struct Work {
    years: f64,
    /// x, y, z of each row, au; NaN for a row with no dot.
    places: Vec<f32>,
    placed: usize,
}

thread_local! {
    static MODE: Cell<bool> = const { Cell::new(false) };
    static DRAWING: RefCell<Option<Vec<[f32; 2]>>> = const { RefCell::new(None) };
    static WORK: RefCell<Option<Work>> = const { RefCell::new(None) };
    static PENDING: RefCell<Option<Pending>> = const { RefCell::new(None) };
    static GROUP: RefCell<Option<Group>> = const { RefCell::new(None) };
    /// The group's biggest bodies, as the interface named them.
    static NAMED: RefCell<Vec<Named>> = const { RefCell::new(Vec::new()) };
    /// How many times the group, or a release's fate, has changed: the
    /// scene asks for the group again when this has moved.
    static CHANGES: Cell<u32> = const { Cell::new(0) };
}

fn changed() {
    CHANGES.set(CHANGES.get().wrapping_add(1));
}

/// The lasso's mode begins: a drag on the scene draws.
pub fn enter() {
    MODE.set(true);
}

/// The mode ends with nothing picked: a shape half drawn, a release still
/// waiting, and the rows' places are let go.
pub fn leave() {
    let was = MODE.replace(false);
    let drawing = DRAWING.take().is_some();
    let pending = PENDING.take().is_some();
    WORK.set(None);
    if was || drawing || pending {
        changed();
    }
}

/// Whether a drag on the scene draws.
pub fn mode() -> bool {
    MODE.get()
}

/// Whether a shape is being drawn: from its press to its release.
pub fn drawing() -> bool {
    DRAWING.with_borrow(Option::is_some)
}

/// Whether a closed shape is waiting for its rows.
pub fn pending() -> bool {
    PENDING.with_borrow(Option::is_some)
}

/// A press on the scene in the mode: a shape begins there. Returns
/// whether it did (not while a release waits for its rows).
pub fn press(x: f32, y: f32) -> bool {
    if !mode() || pending() {
        return false;
    }
    DRAWING.set(Some(vec![[x, y]]));
    true
}

/// The pointer moved, drawing: the shape's next point, if it's far enough
/// from the last. Returns whether it was added.
pub fn point(x: f32, y: f32) -> bool {
    DRAWING.with_borrow_mut(|drawing| {
        let Some(points) = drawing else {
            return false;
        };
        let far = points
            .last()
            .is_none_or(|last| (last[0] - x).hypot(last[1] - y) >= APART);
        // (At the most a shape keeps, the rest of the drag adds nothing: the
        // scene's outline is told of the points kept, and no others.)
        let added = far && points.len() < MOST_POINTS;
        if added {
            points.push([x, y]);
        }
        added
    })
}

/// The release: the shape closes, through the scene's camera as it is.
/// Returns whether it holds any of the window (a press and a release in
/// one place, or with no camera, closes nothing, and the mode goes on).
pub fn release(camera: Option<Camera>) -> bool {
    let Some(shape) = DRAWING.take() else {
        return false;
    };
    let Some(camera) = camera.filter(|_| shape.len() >= 3) else {
        return false;
    };
    let mask = Mask::fill(&shape, camera.width, camera.height);
    if mask.is_empty() {
        return false;
    }
    let (across, down) = (vec![0; mask.width], vec![0; mask.height]);
    PENDING.set(Some(Pending {
        mask,
        camera,
        shape,
        tested: 0,
        inside: Vec::new(),
        across,
        down,
        apart: false,
    }));
    true
}

/// What a call to [`step`] did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stepped {
    /// Nothing to do: no mode, or every row placed and no release waiting.
    Idle,
    /// Rows were placed or tested, and there are more.
    Working,
    /// A release got its rows: this many. With none the mode goes on.
    Picked(usize),
}

/// The mode's work, a frame's worth: the rows placed on `years` (the
/// clock's, paused), then, once a release waits, each row tested against
/// its shape. `place` is where a row's dot is (nothing for a row with
/// none); `apart` the rows the scene draws from other places than those,
/// and where, asked once at a release; `expired` whether the frame's
/// budget is spent, asked between batches of rows.
pub fn step(
    years: f64,
    rows: usize,
    place: impl Fn(usize) -> Option<[f64; 3]>,
    apart: impl FnOnce() -> Vec<(u32, [f64; 3])>,
    mut expired: impl FnMut() -> bool,
) -> Stepped {
    if !mode() && !pending() {
        return Stepped::Idle;
    }
    let done = WORK.with_borrow_mut(|work| {
        // The clock moved under the mode (it shouldn't): begun again.
        if work
            .as_ref()
            .is_none_or(|work| work.years != years || work.places.len() != rows * 3)
        {
            *work = Some(Work {
                years,
                // (Zeroed: the memory comes that way, and filling it is a
                // long first call. A row with no dot gets its NaN below.)
                places: vec![0.0; rows * 3],
                placed: 0,
            });
            PENDING.with_borrow_mut(|pending| {
                if let Some(pending) = pending {
                    (pending.tested, pending.apart) = (0, false);
                    pending.inside.clear();
                    pending.across.fill(0);
                    pending.down.fill(0);
                }
            });
        }
        let work = work.as_mut().expect("made above");
        while work.placed < rows {
            let to = (work.placed + PLACED_AT_ONCE).min(rows);
            for row in work.placed..to {
                let [x, y, z] = place(row).unwrap_or([f64::NAN; 3]);
                work.places[row * 3..row * 3 + 3].copy_from_slice(&[x as f32, y as f32, z as f32]);
            }
            work.placed = to;
            if work.placed < rows && expired() {
                return None;
            }
        }
        PENDING.with_borrow_mut(|pending| {
            let Some(pending) = pending else {
                return Some(None);
            };
            if expired() {
                return None;
            }
            if !pending.apart {
                for (row, [x, y, z]) in apart() {
                    let at = row as usize * 3;
                    if let Some(place) = work.places.get_mut(at..at + 3) {
                        place.copy_from_slice(&[x as f32, y as f32, z as f32]);
                    }
                }
                pending.apart = true;
            }
            while pending.tested < rows {
                let to = (pending.tested + TESTED_AT_ONCE).min(rows);
                for row in pending.tested..to {
                    let place = [
                        work.places[row * 3],
                        work.places[row * 3 + 1],
                        work.places[row * 3 + 2],
                    ];
                    // (A row with no dot is NaN, and is nowhere.)
                    if let Some([x, y]) = pending.camera.window(place)
                        && pending.mask.holds(x, y)
                    {
                        pending.inside.push(row as u32);
                        // (Inside the shape is inside the window.)
                        pending.across[x as usize] += 1;
                        pending.down[y as usize] += 1;
                    }
                }
                pending.tested = to;
                if pending.tested < rows && expired() {
                    return None;
                }
            }
            Some(Some(years))
        })
    });
    match done {
        None => Stepped::Working,
        Some(None) => Stepped::Idle,
        Some(Some(years)) => {
            let pending = PENDING.take().expect("it was tested above");
            let picked = pending.inside.len();
            if picked > 0 {
                let mut bytes = vec![0; rows];
                for &row in &pending.inside {
                    bytes[row as usize] = 1;
                }
                let (left, right) = middle(&pending.across, picked);
                let (top, bottom) = middle(&pending.down, picked);
                NAMED.set(Vec::new());
                GROUP.set(Some(Group {
                    rows: pending.inside.into(),
                    bytes,
                    shape: pending.shape,
                    years,
                    fit: Some([left, top, right, bottom]),
                }));
                MODE.set(false);
                WORK.set(None);
            }
            changed();
            Stepped::Picked(picked)
        }
    }
}

/// Where the middle of `total` dots lies along one side of the window,
/// from how many fell in each pixel of it: from the first pixel to past the
/// last, with [`FIT_TRIM`] of them left out at each end.
fn middle(counts: &[u32], total: usize) -> (f32, f32) {
    let skip = (total as f64 * FIT_TRIM) as usize;
    let first = |pixels: &mut dyn Iterator<Item = (usize, &u32)>| {
        let mut seen = 0;
        for (at, &count) in pixels {
            seen += count as usize;
            if seen > skip {
                return Some(at);
            }
        }
        None
    };
    let low = first(&mut counts.iter().enumerate()).unwrap_or(0);
    let high = first(&mut counts.iter().enumerate().rev()).unwrap_or(low);
    (low as f32, (high + 1) as f32)
}

/// A click on one dot: a group of that row alone, of a file of `rows`, on
/// the clock's `years`. No shape, and nothing for the camera to fit: the
/// row is found, and flown to as a found row is. A group held before it,
/// and the mode, are let go.
pub fn pick_one(row: usize, rows: usize, years: f64) {
    if row >= rows {
        return;
    }
    MODE.set(false);
    DRAWING.set(None);
    PENDING.set(None);
    WORK.set(None);
    let mut bytes = vec![0; rows];
    bytes[row] = 1;
    NAMED.set(Vec::new());
    GROUP.set(Some(Group {
        rows: [row as u32].into(),
        bytes,
        shape: Vec::new(),
        years,
        fit: None,
    }));
    changed();
}

/// How many of the rows are placed so far; 0 out of the mode.
pub fn placed() -> usize {
    WORK.with_borrow(|work| work.as_ref().map_or(0, |work| work.placed))
}

/// The group is let go: every row, every color.
pub fn let_go() {
    if GROUP.take().is_some() {
        NAMED.set(Vec::new());
        changed();
    }
}

/// Whether the group held was drawn: a shape, not a click on one dot.
pub fn drawn() -> bool {
    GROUP.with_borrow(|group| group.as_ref().is_some_and(|group| !group.shape.is_empty()))
}

/// The row a click on its dot picked, if that is the group held.
pub fn clicked() -> Option<usize> {
    GROUP.with_borrow(|group| {
        group
            .as_ref()
            .filter(|group| group.shape.is_empty())
            .and_then(|group| group.rows.first().map(|&row| row as usize))
    })
}

/// The group's biggest bodies are named: the interface's to say which,
/// from the rows file. Kept while the group is.
pub fn name(named: Vec<Named>) {
    if held() {
        NAMED.set(named);
    }
}

/// The rows of the group's named bodies, biggest first (asked for every
/// frame time runs: no name is copied for it).
pub fn named_rows() -> Vec<u32> {
    NAMED.with_borrow(|named| named.iter().map(|named| named.row).collect())
}

/// The group's named bodies; none with no group.
pub fn named() -> Vec<Named> {
    NAMED.with_borrow(Clone::clone)
}

/// Whether a group is held.
pub fn held() -> bool {
    GROUP.with_borrow(Option::is_some)
}

/// The group's rows, in the file's order; nothing with no group.
pub fn rows() -> Option<Rc<[u32]>> {
    GROUP.with_borrow(|group| group.as_ref().map(|group| group.rows.clone()))
}

/// Reads the group, if one is held.
pub fn with<R>(read: impl FnOnce(&Group) -> R) -> Option<R> {
    GROUP.with_borrow(|group| group.as_ref().map(read))
}

/// How many times the group, or a release's fate, has changed.
pub fn changes() -> u32 {
    CHANGES.get()
}

#[cfg(test)]
mod tests {
    use super::{
        Camera, Mask, Named, Stepped, changes, clicked, drawing, drawn, enter, held, leave, let_go,
        middle, mode, name, named, pending, pick_one, placed, point, press, release, rows, step,
        with,
    };

    /// A camera that draws the ecliptic's x and y as window pixels, 1 au a
    /// pixel, in a window 100 px square: x right, y down.
    fn flat() -> Camera {
        let mut matrix = [0.0; 16];
        // Clip x = x / 50 − 1, clip y = 1 − (−z) / 50, the scene's z being −y.
        matrix[0] = 1.0 / 50.0;
        matrix[12] = -1.0;
        matrix[9] = 1.0 / 50.0;
        matrix[13] = 1.0;
        matrix[15] = 1.0;
        Camera {
            matrix,
            width: 100.0,
            height: 100.0,
        }
    }

    /// A center inside the shape by the even-odd rule, counted edge by edge.
    fn crosses(points: &[[f32; 2]], x: f64, y: f64) -> bool {
        let mut inside = false;
        for (at, from) in points.iter().enumerate() {
            let to = points[(at + 1) % points.len()];
            let (x0, y0, x1, y1) = (
                f64::from(from[0]),
                f64::from(from[1]),
                f64::from(to[0]),
                f64::from(to[1]),
            );
            if (y0 > y) != (y1 > y) && x < x0 + (y - y0) * (x1 - x0) / (y1 - y0) {
                inside = !inside;
            }
        }
        inside
    }

    #[test]
    fn the_mask_is_the_shapes_pixels_by_their_centers() {
        // A shape that crosses itself, with points on pixel centers and
        // on their edges: every pixel against the rule, counted apart.
        let shape = [
            [10.0, 10.5],
            [80.5, 12.0],
            [20.0, 70.0],
            [90.0, 88.5],
            [55.5, 40.0],
            [5.0, 95.0],
        ];
        let mask = Mask::fill(&shape, 100.0, 100.0);
        assert!(!mask.is_empty());
        let mut inside = 0;
        for row in 0..100 {
            for column in 0..100 {
                let (x, y) = (f64::from(column) + 0.5, f64::from(row) + 0.5);
                assert_eq!(
                    mask.holds(x, y),
                    crosses(&shape, x, y),
                    "pixel {column}, {row}"
                );
                inside += usize::from(mask.holds(x, y));
            }
        }
        assert!(inside > 500);
        // Anywhere in a pixel is that pixel; outside the window is outside.
        assert_eq!(mask.holds(30.01, 30.99), mask.holds(30.5, 30.5));
        assert!(!mask.holds(-1.0, 30.0) && !mask.holds(30.0, 100.0) && !mask.holds(f64::NAN, 1.0));
        // A shape with no inside holds nothing.
        assert!(Mask::fill(&[[1.0, 1.0], [50.0, 50.0]], 100.0, 100.0).is_empty());
    }

    #[test]
    fn a_place_goes_through_the_scenes_camera() {
        let camera = flat();
        assert_eq!(camera.window([25.0, 40.0, 0.0]), Some([25.0, 40.0]));
        // Behind the camera, or past its planes: not drawn.
        let mut behind = camera;
        behind.matrix[15] = -1.0;
        assert_eq!(behind.window([25.0, 40.0, 0.0]), None);
        let mut far = camera;
        far.matrix[14] = 2.0;
        assert_eq!(far.window([25.0, 40.0, 0.0]), None);
        assert_eq!(camera.window([f32::NAN; 3]), None);
        // The scene's answer: its matrix, then the window.
        let mut numbers = camera.matrix.to_vec();
        assert_eq!(Camera::from_scene(&numbers), None);
        numbers.extend([100.0, 100.0]);
        assert_eq!(Camera::from_scene(&numbers), Some(camera));
    }

    #[test]
    fn a_drawn_shape_picks_the_rows_under_it_a_frames_worth_at_a_time() {
        leave();
        let_go();
        // 10,000 rows on a grid, 1 au apart; every seventh has no dot; row
        // 4,242 is drawn apart from its place, far outside the shape.
        let rows = 10_000;
        let place = |row: usize| {
            (!row.is_multiple_of(7)).then_some([
                (row % 100) as f64 + 0.5,
                (row / 100) as f64 + 0.5,
                0.0,
            ])
        };
        let apart = || vec![(4242, [99.5, 99.5, 0.0])];
        assert_eq!(step(0.5, rows, place, apart, || false), Stepped::Idle);
        assert!(!press(20.0, 20.0), "no shape out of the mode");
        enter();
        assert!(mode());
        // Placed while the shape is drawn, a batch a call.
        assert_eq!(step(0.5, rows, place, apart, || true), Stepped::Working);
        assert!(placed() > 0 && placed() < rows);
        assert!(press(20.0, 20.0) && drawing());
        assert!(!point(20.5, 20.5), "too near the last point");
        for [x, y] in [[60.0, 20.0], [60.0, 60.0], [20.0, 60.0]] {
            assert!(point(x, y));
        }
        let before = changes();
        assert!(release(Some(flat())));
        assert!(pending() && !drawing() && mode());
        assert!(!press(1.0, 1.0), "not while a release waits");
        // The rest of the rows, then the test, over as many calls as it takes.
        let mut calls = 0;
        let picked = loop {
            calls += 1;
            let mut looks = 0;
            match step(0.5, rows, place, apart, || {
                looks += 1;
                looks > 1
            }) {
                Stepped::Working => assert!(calls < 100),
                Stepped::Picked(picked) => break picked,
                Stepped::Idle => panic!("a release was waiting"),
            }
        };
        assert!(calls > 1);
        // The rows whose pixel's center is in the square, counted apart.
        let expected: Vec<u32> = (0..rows)
            .filter(|&row| !row.is_multiple_of(7) && row != 4242)
            .filter(|&row| (20..60).contains(&(row % 100)) && (20..60).contains(&(row / 100)))
            .map(|row| row as u32)
            .collect();
        assert_eq!(picked, expected.len());
        assert_eq!(rows_held(), expected);
        assert!(held() && !mode() && !pending());
        assert_eq!(changes(), before.wrapping_add(1));
        with(|group| {
            assert_eq!(group.years, 0.5);
            assert_eq!(group.shape.len(), 4);
            assert_eq!(group.bytes.len(), rows);
            assert_eq!(
                group.bytes.iter().filter(|&&byte| byte == 1).count(),
                expected.len()
            );
            assert_eq!(group.bytes[2021], 1);
            assert_eq!(group.bytes[4242], 0);
            // Where its dots were: the square's own pixels.
            assert_eq!(group.fit, Some([20.0, 20.0, 60.0, 60.0]));
        })
        .expect("a group");
        assert!(drawn() && clicked().is_none());
        // Its biggest bodies are named while it's held.
        let ceres = Named {
            row: 2021,
            name: "1 Ceres".into(),
            size: "939 km".into(),
        };
        name(vec![ceres.clone()]);
        assert_eq!(named(), [ceres]);
        // Its places are let go with the mode.
        assert_eq!(placed(), 0);
        let_go();
        assert!(!held() && rows_held().is_empty() && named().is_empty());
        assert_eq!(changes(), before.wrapping_add(2));
    }

    #[test]
    fn the_fit_leaves_out_the_farthest_of_the_dots() {
        // 1,000 dots in pixels 40 to 49, and one far out each way: 10 are
        // left out at each end, so the two far ones don't count.
        let mut counts = vec![0; 100];
        counts[3] = 1;
        counts[97] = 1;
        for pixel in &mut counts[40..50] {
            *pixel = 100;
        }
        assert_eq!(middle(&counts, 1002), (40.0, 50.0));
        // A few dots: none left out.
        assert_eq!(middle(&counts[..10], 1), (3.0, 4.0));
        assert_eq!(middle(&[0, 0], 0), (0.0, 1.0));
    }

    #[test]
    fn a_click_on_one_dot_is_a_group_of_that_row() {
        leave();
        let_go();
        let before = changes();
        pick_one(12, 10, 0.0);
        assert!(!held(), "no such row");
        enter();
        pick_one(7, 10, 1.5);
        assert!(held() && !mode() && !drawn());
        assert_eq!(clicked(), Some(7));
        assert_eq!(rows_held(), [7]);
        with(|group| {
            assert_eq!(group.bytes, [0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
            assert!(group.shape.is_empty() && group.fit.is_none());
            assert_eq!(group.years, 1.5);
        })
        .expect("a group");
        assert!(changes() != before);
        let_go();
        assert_eq!(clicked(), None);
    }

    fn rows_held() -> Vec<u32> {
        rows().map_or_else(Vec::new, |rows| rows.to_vec())
    }

    #[test]
    fn a_shape_over_nothing_keeps_the_mode() {
        leave();
        let_go();
        enter();
        // A click closes nothing.
        assert!(press(5.0, 5.0));
        assert!(!release(Some(flat())) && !pending() && mode());
        // No camera, no shape.
        assert!(press(5.0, 5.0) && point(9.0, 5.0) && point(9.0, 9.0));
        assert!(!release(None) && !pending());
        // A shape over no dot picks no rows, and the mode goes on.
        assert!(press(1.0, 1.0) && point(9.0, 1.0) && point(9.0, 9.0));
        assert!(release(Some(flat())));
        let place = |_: usize| Some([50.5, 50.5, 0.0]);
        assert_eq!(step(0.0, 10, place, Vec::new, || false), Stepped::Picked(0));
        assert!(mode() && !held() && !pending());
        // Left with a shape half drawn: nothing is kept.
        assert!(press(1.0, 1.0));
        leave();
        assert!(!mode() && !drawing() && placed() == 0);
    }
}
