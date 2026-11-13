//! The interface: the title, the time control, the actions beside it
//! ("Sort by orbit size", "Ride with Jupiter"), the furniture of the axes
//! the sort lands the dots on, and the table behind its handle on the right edge, a panel
//! that slides in over the rows. Under them, a window-sized surface that hears what nothing above it took: a
//! wheel there is the scene's, and a press there starts a drag of the
//! scene's, its camera's to pan, which the scene keeps to its release.
//!
//! In the bottom right corner, once the scene is up and while the dots are
//! in space: a compass (the camera's turn and tilt; a press flies it home),
//! a hint of the camera's controls that folds to a `?` button after the
//! camera's first move, and behind that button the controls' list. The keys
//! are the scene's while the table's panel is shut.
//!
//! A row of the table is found in the scene: the table's rows are
//! selectable, and the selected row is marked on its dot and flown to
//! ([`find`]). "Find Ceres", the third action, is that for the first row.
//!
//! A group is drawn in the scene: "Draw a group", the fourth action, is the
//! lasso's mode, where a drag on the surface draws a shape ([`group`]); the
//! rows under it are the table's rows until the action is pressed back, or
//! "Show all rows" in the panel is.
//!
//! Its first frame holds no data: the title, the time control, and the
//! handle saying its rows are loading. The files arrive after it
//! ([`Host::progress`], then [`Host::loaded`] or [`Host::failed`]), and the
//! scene says when the belt is drawn ([`Host::belt_drawn`]), which is when
//! time starts to move.

use std::cell::{Cell, RefCell};
use std::ops::Range;
use std::rc::Rc;
use std::sync::LazyLock;
use std::time::Duration;

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::component::Disableable as _;
use gpui_kit::component::Sizable as _;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use seiza_tall_table::{
    Paging, Selectable, Sort, SortDirection, TallTable, TallTableEvent, TallTableSelection,
};
use tall_table_bridge::Publish;

use crate::catalog::{Catalog, columns};
use crate::clock;
use crate::find;
use crate::flight;
use crate::gap;
use crate::group;
use crate::layout::{self, Plot};
use crate::ramp;
use crate::ride;
use crate::scene;
use crate::table::{Source, Table, View};

/// The panel's width, CSS px.
const PANEL_WIDTH: f32 = 560.;
/// `?glass`: the panel as glass, to be looked at. What is left of its fill
/// (`?glass=<0 to 1>`, 0.6 with no value); the page blurs the scene behind
/// it (`web/src/scene.ts`). Not there, the panel is opaque.
pub static GLASS: LazyLock<Option<f32>> = LazyLock::new(|| {
    seiza::url::has_param("glass").then(|| {
        seiza::url::param("glass")
            .and_then(|fill| fill.parse::<f32>().ok())
            .map_or(0.6, |fill| fill.clamp(0.0, 1.0))
    })
});
/// The panel's slide in or out.
const SLIDE_MS: f64 = 350.0;
/// How often the date redraws while time moves: a rate a person can read.
const DATE_EVERY: Duration = Duration::from_millis(250);

/// Set right after the first frame that draws the table's rows.
pub const TABLE_MARK: &str = "kirkwood:table";
/// The controls' published bounds, for scripts (`__seizaTargets`).
pub const HANDLE_TARGET: &str = "table-handle";
pub const CLOSE_TARGET: &str = "table-close";
pub const TIME_TARGET: &str = "time";
pub const SORT_TARGET: &str = "sort";
pub const RIDE_TARGET: &str = "ride";
pub const FIND_TARGET: &str = "find";
pub const LASSO_TARGET: &str = "lasso";
/// The panel's way back from a group, and its count of the group's rows.
pub const SHOW_ALL_TARGET: &str = "show-all";
pub const GROUP_COUNT_TARGET: &str = "group-count";
/// The line the panel says of a found row that has no dot.
pub const NO_DOT_TARGET: &str = "no-dot";
/// The row "Find Ceres" finds: the file's first.
const CERES: usize = 0;
pub const LEGEND_TARGET: &str = "legend";
/// The axes' furniture: the two lines, their labels, the line over the
/// chips, each chip, each group's name, and the count of rows in view.
pub const AXIS_A_TARGET: &str = "axis-a";
pub const AXIS_E_TARGET: &str = "axis-e";
pub const LABEL_A_TARGET: &str = "label-a";
pub const LABEL_E_TARGET: &str = "label-e";
pub const GAPS_LINE_TARGET: &str = "gaps-line";
pub const CHIP_TARGETS: [&str; 4] = ["chip-0", "chip-1", "chip-2", "chip-3"];
pub const GROUP_TARGETS: [&str; 2] = ["group-0", "group-1"];
pub const IN_VIEW_TARGET: &str = "in-view";
/// A picked gap's card, and the four gaps' chips in it.
pub const CARD_TARGET: &str = "gap-card";
pub const CARD_CHIP_TARGETS: [&str; 4] =
    ["card-chip-0", "card-chip-1", "card-chip-2", "card-chip-3"];

/// A picked gap's card, as board 5 draws it, CSS px: its left, its width,
/// and how far under the title's lines it starts (the board's card is 20
/// under its title's, at 104; the app's title is taller, and the card
/// keeps the distance: `docs/DECISIONS.md`, "Interface").
const CARD_LEFT: f32 = 24.;
const CARD_WIDTH: f32 = 300.;
const CARD_UNDER_TITLE: f32 = 20.;
const CARD_TOP: f32 = 104.;
/// The card's fill: a chip's, neutral-950, oklch(0.145 0 0), at 0.92 of its
/// opacity, as board 5 draws it.
const CARD_FILL: u32 = 0x0a0a0aeb;
/// The axes' lines and ticks, and a chip's border: neutral-700,
/// oklch(0.371 0 0), as board 4 draws them. The theme's border is a step
/// darker, and too faint over the scene.
const AXIS: u32 = 0x404040;
/// A chip's fill: neutral-950, oklch(0.145 0 0), the theme's background
/// before the window's was made clear.
const CHIP_FILL: u32 = 0x0a0a0a;
/// How far under the title's lines the e axis starts, where they reach
/// past its top.
const UNDER_TITLE: f64 = 8.;

/// The corner, as boards 8 to 10 draw it, CSS px: how far in from the right
/// and the bottom of what the panel leaves, the controls' list's width and
/// how far up it ends, and the least width of what the panel leaves that
/// has room for the hint whole beside the time control's row.
const CORNER_IN: f32 = 24.;
const CONTROLS_WIDTH: f32 = 320.;
const CONTROLS_BOTTOM: f32 = 72.;
const HINT_ROOM: f32 = 1215.;
/// How far the controls' list keeps from the table's handle.
const CONTROLS_CLEAR: f32 = 8.;
/// The compass: its button, the ring's radius (flattened by the camera's
/// tilt, never thinner than `COMPASS_THIN`), and the needle's half width.
const COMPASS: f32 = 36.;
const COMPASS_RING: f32 = 11.;
const COMPASS_THIN: f32 = 1.2;
const COMPASS_NEEDLE: f32 = 3.;
/// The ring, and the needle's far half: neutral-600, oklch(0.439 0 0).
const COMPASS_DIM: u32 = 0x525252;
/// What a control does, in the controls' list: neutral-300,
/// oklch(0.87 0 0).
const CONTROLS_SAYS: u32 = 0xd4d4d4;
/// The controls' published bounds: the hint (whole, or folded to its
/// button), the compass, the controls' list, and its close button.
pub const HINT_TARGET: &str = "hint";
pub const COMPASS_TARGET: &str = "compass";
pub const CONTROLS_TARGET: &str = "controls";
pub const CONTROLS_CLOSE_TARGET: &str = "controls-close";

/// The legend's bar, CSS px, and the width of each slice of it: one tint.
const LEGEND_WIDTH: f32 = 140.;
const LEGEND_SLICE: f32 = 2.;

/// The page clock, ms; 0 off the web, where nothing animates.
fn now() -> f64 {
    #[cfg(target_family = "wasm")]
    return seiza::marks::now();
    #[cfg(not(target_family = "wasm"))]
    0.0
}

/// Where the two files are.
enum Files {
    /// On their way: the bytes held so far, of how many.
    Loading {
        received: f64,
        total: f64,
    },
    Failed(SharedString),
    Held,
}

struct Slide {
    from: f32,
    to: f32,
    start_ms: f64,
}

/// The belt as the scene has drawn it, counted from the elements' rows.
#[derive(Clone, Copy)]
enum Belt {
    /// Some of the file's blocks of rows are drawn, and more are arriving.
    Filling {
        /// The dots so far: the drawn rows with an ellipse.
        dots: usize,
        /// The rows the file has.
        rows: usize,
        /// The drawn rows with a place on the sort's axes.
        in_view: usize,
    },
    /// Every row is drawn.
    Whole {
        /// The rows with an ellipse: a dot each.
        drawn: usize,
        /// The rows with none (e not below 1): no dot.
        unbound: usize,
        /// The rows with a place on the sort's axes.
        in_view: usize,
    },
}

pub struct Host {
    files: Files,
    belt: Option<Belt>,
    /// The sky is drawn behind the belt.
    sky: bool,
    /// Why there's no scene, if it didn't start.
    scene_failed: Option<SharedString>,
    table: Option<Entity<Table>>,
    /// The rows the table is over: a found row's name, and whether it has
    /// a dot, are read from them.
    catalog: Option<Rc<Catalog>>,
    /// Which of those rows the table reads, and in what order: shared
    /// with the table's source.
    view: Rc<RefCell<View>>,
    /// Counted from the files.
    rows: usize,
    panel_open: bool,
    /// How far in the panel is, 0..1.
    panel_t: f32,
    slide: Option<Slide>,
    date: Entity<DateLabel>,
    /// The compass, a view of its own, so the camera's turn redraws it
    /// alone. Nothing until the scene's first frame.
    compass: Option<Entity<Compass>>,
    /// The hint is folded to its button: the camera has been moved, or the
    /// controls' list opened, on this visit or one before.
    hint_folded: bool,
    /// The controls' list is open.
    controls_open: bool,
    /// The keys are the interface's while this has them: the scene's, with
    /// the table's panel shut.
    focus: FocusHandle,
    /// Where the table's handle starts, CSS px from the window's left, as
    /// last laid out: the controls' list keeps clear of it.
    handle_left: Rc<Cell<f32>>,
    _table_events: Option<Subscription>,
}

impl Host {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            files: Files::Loading {
                received: 0.0,
                total: 0.0,
            },
            belt: None,
            sky: false,
            scene_failed: None,
            table: None,
            catalog: None,
            view: Rc::default(),
            rows: 0,
            panel_open: false,
            panel_t: 0.0,
            slide: None,
            date: cx.new(DateLabel::new),
            compass: None,
            hint_folded: scene::hint_folded(),
            controls_open: false,
            focus: cx.focus_handle(),
            handle_left: Rc::new(Cell::new(f32::INFINITY)),
            _table_events: None,
        }
    }

    /// The scene drew its camera: turned `turned` degrees from where it
    /// opened, tilted `tilt` from straight down. `moved`: a hand has moved
    /// a camera, and the hint has done its work.
    pub fn camera_seen(&mut self, turned: f32, tilt: f32, moved: bool, cx: &mut Context<Self>) {
        let camera = [turned, tilt];
        // The interface itself is drawn again only for what changes more
        // than the compass: its first showing, and the hint's fold.
        let mut redraw = moved && !self.hint_folded;
        match &self.compass {
            Some(compass) => compass.update(cx, |compass, cx| {
                compass.camera = camera;
                cx.notify();
            }),
            None => {
                self.compass = Some(cx.new(|_| Compass { camera }));
                redraw = true;
            }
        }
        if moved {
            self.fold_hint();
        }
        if redraw {
            cx.notify();
        }
    }

    /// For the checks: the compass's turn and tilt, whether the hint is
    /// folded, and whether the controls' list is open.
    pub fn corner(&self, cx: &App) -> Option<[f32; 4]> {
        self.compass.as_ref().map(|compass| {
            let [turned, tilt] = compass.read(cx).camera;
            [
                turned,
                tilt,
                f32::from(u8::from(self.hint_folded)),
                f32::from(u8::from(self.controls_open)),
            ]
        })
    }

    /// The hint folds to its button, for good: the page remembers.
    fn fold_hint(&mut self) {
        if !self.hint_folded {
            self.hint_folded = true;
            scene::fold_hint();
        }
    }

    /// The controls' list, opened or closed: by the hint, its button, its
    /// own close button, or the `?` key. Opened, the hint has done its
    /// work.
    fn toggle_controls(&mut self, cx: &mut Context<Self>) {
        self.controls_open = !self.controls_open;
        if self.controls_open {
            self.fold_hint();
        }
        cx.notify();
    }

    /// Whether the corner is drawn: the scene is up, and the dots aren't
    /// landed on the axes, where the camera is nobody's and the corner is
    /// the count's.
    fn corner_shown(&self) -> bool {
        self.compass.is_some() && self.scene_failed.is_none() && flight::space() > 0.0
    }

    /// A key, while the scene has the keys: the arrows pan, + and − zoom,
    /// H flies home, `?` opens and closes the controls' list, and Escape
    /// closes it. With the table's panel open they are the table's.
    fn key(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        let held = keystroke.modifiers;
        // (With Ctrl or the platform's key, + and − are the browser's zoom.)
        if held.control || held.platform || held.alt {
            return;
        }
        // Escape shuts the list wherever the keys are, the table's too.
        if keystroke.key == "escape" && self.controls_open {
            self.toggle_controls(cx);
            cx.stop_propagation();
            return;
        }
        // And leaves the lasso's mode, a shape half drawn with it.
        if keystroke.key == "escape" && group::mode() {
            self.leave_mode(cx);
            cx.stop_propagation();
            return;
        }
        // The camera holds still under a shape from its press until its
        // rows are in.
        if group::drawing() || group::pending() {
            return;
        }
        // The rest are the scene's, where the corner is a hand's to press.
        if self.panel_open || !self.corner_shown() || !in_space() {
            return;
        }
        match keystroke.key.as_str() {
            "?" => self.toggle_controls(cx),
            key @ ("left" | "right" | "up" | "down" | "+" | "=" | "-" | "h") => {
                // Where the camera is no hand's the key does nothing, and
                // is still the scene's.
                if let Some(frame) = hands_frame() {
                    match key {
                        "left" => scene::nudge(-1, 0, frame),
                        "right" => scene::nudge(1, 0, frame),
                        "up" => scene::nudge(0, 1, frame),
                        "down" => scene::nudge(0, -1, frame),
                        "+" | "=" => scene::zoom_step(true, frame),
                        "-" => scene::zoom_step(false, frame),
                        _ => scene::home(frame),
                    }
                }
            }
            _ => return,
        }
        cx.stop_propagation();
    }

    /// The files' bytes held so far, of both files' together.
    pub fn progress(&mut self, received: f64, total: f64, cx: &mut Context<Self>) {
        if matches!(self.files, Files::Loading { .. }) {
            self.files = Files::Loading { received, total };
            cx.notify();
        }
    }

    /// A file didn't arrive, or isn't one: the page says so, and the handle
    /// has nothing to open.
    pub fn failed(&mut self, message: String, cx: &mut Context<Self>) {
        self.files = Files::Failed(message.into());
        // The elements stopped short: the page clears what the scene had
        // drawn of them, and nothing is counted.
        if matches!(self.belt, Some(Belt::Filling { .. })) {
            self.belt = None;
        }
        cx.notify();
    }

    /// The scene has drawn the first of the elements' blocks: `dots` rows
    /// on their ellipses so far, `in_view` of them with a place on the
    /// sort's axes, of a file of `rows` rows still arriving. Time waits
    /// for the rest (`docs/DECISIONS.md`, "Scene").
    pub fn belt_filling(
        &mut self,
        dots: usize,
        rows: usize,
        in_view: usize,
        cx: &mut Context<Self>,
    ) {
        self.belt = Some(Belt::Filling {
            dots,
            rows,
            in_view,
        });
        cx.notify();
    }

    /// The scene drew the whole belt from the elements: `drawn` rows on
    /// their ellipses and `unbound` with none, `in_view` with a place on
    /// the sort's axes, counted from the rows. Time moves from here.
    pub fn belt_drawn(
        &mut self,
        drawn: usize,
        unbound: usize,
        in_view: usize,
        cx: &mut Context<Self>,
    ) {
        self.belt = Some(Belt::Whole {
            drawn,
            unbound,
            in_view,
        });
        if clock::held() {
            clock::release();
        }
        cx.notify();
    }

    /// The stars are in behind the belt: dots that aren't rows, which the
    /// page says.
    pub fn sky_drawn(&mut self, cx: &mut Context<Self>) {
        self.sky = true;
        cx.notify();
    }

    /// The scene didn't start (no WebGL, or its module didn't arrive): the
    /// page says so. The table doesn't need it.
    pub fn scene_failed(&mut self, message: String, cx: &mut Context<Self>) {
        self.scene_failed = Some(message.into());
        // A belt part drawn gets no more rows, and the page clears it:
        // nothing is counted, and there's no time to wait for.
        if matches!(self.belt, Some(Belt::Filling { .. })) {
            self.belt = None;
        }
        cx.notify();
    }

    /// Both files are held: the table opens over them.
    pub fn loaded(&mut self, catalog: Rc<Catalog>, cx: &mut Context<Self>) {
        self.rows = catalog.rows();
        self.files = Files::Held;
        let probing = seiza::url::has_param("perf");
        let probe_cells = probing && seiza::url::has_param("probe-cells");
        let rows = self.rows as u64;
        self.catalog = Some(catalog.clone());
        let table = cx.new(|cx| {
            let mut table = Table::new(
                Source::new(catalog, self.view.clone()),
                columns(),
                rows,
                Paging::default(),
                cx,
            )
            .probe_frames(probing)
            .probe_cells(probe_cells);
            // A press picks a row, whichever cell it lands on: the row is
            // what the scene has a dot for.
            table.set_selectable(Selectable::none().rows(true), cx);
            table
        });
        let publish = Publish {
            filled_mark: Some(TABLE_MARK),
            scrollbar: true,
            probe: probing.then_some("__kirkwoodTable"),
            layout: probing.then_some("__kirkwoodLayout"),
            cells: probe_cells.then_some("__kirkwoodCells"),
            selection: probing.then_some("__kirkwoodSelection"),
            ..Publish::default()
        };
        self._table_events = Some(cx.subscribe(&table, move |this, _, event, cx| {
            publish.event(event);
            if let TallTableEvent::Selected(selection) = event {
                this.selected(*selection, cx);
            }
        }));
        self.table = Some(table);
        cx.notify();
    }

    fn toggle_panel(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // Nothing to open until the rows are held: a press on the loading
        // handle isn't kept for later.
        let Some(table) = &self.table else {
            return;
        };
        self.panel_open = !self.panel_open;
        if self.panel_open {
            // The table's keys (the arrows, Page Up and Down, Home, End)
            // work from the moment it's open.
            let focus = table.read(cx).focus_handle().clone();
            window.focus(&focus, cx);
        } else {
            // And the scene's, from the moment it's shut.
            window.focus(&self.focus, cx);
        }
        self.slide = Some(Slide {
            from: self.panel_t,
            to: if self.panel_open { 1.0 } else { 0.0 },
            start_ms: now(),
        });
        cx.notify();
    }

    /// The table's selection changed: one row selected is the row found,
    /// and with nothing selected none is. A range of more rows (Shift, a
    /// drag, every row) finds nothing new: what was found stays so.
    fn selected(&mut self, selection: Option<TallTableSelection>, cx: &mut Context<Self>) {
        match selection {
            Some(selection) if selection.anchor().0 != selection.head().0 => {}
            // (A row of the table: of a group, or sorted, another of the
            // file's.)
            Some(selection) => {
                let row = self.view.borrow().file_row(selection.head().0 as usize);
                if let Some(row) = row {
                    self.find(row, cx);
                }
            }
            None => {
                find::let_go();
                cx.notify();
            }
        }
    }

    /// A row is found: the scene marks its dot and flies its camera
    /// there. One action at a time, and a find is one: the dots fly back
    /// from the axes, and the frame stops turning with Jupiter, as the
    /// camera leaves for the row (`docs/DECISIONS.md`, "Interface"). A
    /// row with no ellipse has no dot: nothing moves, and the panel says
    /// why.
    fn find(&mut self, row: usize, cx: &mut Context<Self>) {
        let Some(catalog) = &self.catalog else {
            return;
        };
        if row >= catalog.rows() {
            return;
        }
        let dot = catalog.elements().is_bound(row) && self.can_act();
        find::find(row, row_name(catalog, row), dot);
        if dot {
            if flight::sorted() {
                flight::toggle();
                clock::resume_after_sort();
            }
            if ride::riding() {
                ride::toggle();
            }
            // The lasso's mode is let go too. A group that's held isn't:
            // the row found is one of its rows.
            if group::mode() {
                self.leave_mode(cx);
            }
        }
        cx.notify();
    }

    /// The found row is let go: no mark, and nothing selected in the
    /// table. (Its `Selected` comes back here, and lets go again.)
    fn lose(&mut self, cx: &mut Context<Self>) {
        if find::found().is_none() {
            return;
        }
        find::let_go();
        if let Some(table) = &self.table {
            table.update(cx, |table, cx| table.select(None, cx));
        }
    }

    /// For the checks: the table scrolled to the file's `row` and that row
    /// selected, and so found, as "Find Ceres" does for the first. Nothing
    /// for a row the table doesn't hold (it isn't in the group).
    pub fn jump(&mut self, row: usize, cx: &mut Context<Self>) {
        let at = self.view.borrow().at(row).filter(|_| row < self.rows);
        if let (Some(table), Some(at)) = (self.table.clone(), at) {
            table.update(cx, |table, cx| table.jump_to(at as u64, cx));
        }
    }

    /// For the checks: the table sorted by a column (and whether
    /// descending), as a press on its arrow sorts it, or back in the
    /// file's order. Whether it was.
    pub fn sort_table(&mut self, sort: Option<(usize, bool)>, cx: &mut Context<Self>) -> bool {
        let sort = sort.map(|(column, descending)| {
            Sort::new(
                column,
                if descending {
                    SortDirection::Descending
                } else {
                    SortDirection::Ascending
                },
            )
        });
        if sort.is_some_and(|sort| !crate::table::SORTABLE.contains(&sort.column)) {
            return false;
        }
        self.table
            .clone()
            .is_some_and(|table| table.update(cx, |table, cx| table.set_sort(sort, cx).is_ok()))
    }

    /// For the checks: the table's rows, and its sort (the column, and
    /// whether it's descending).
    pub fn table_rows(&self, cx: &App) -> Option<(u64, Option<(usize, bool)>)> {
        self.table.as_ref().map(|table| {
            let sort = table
                .read(cx)
                .sort()
                .map(|sort| (sort.column, sort.direction == SortDirection::Descending));
            (self.view.borrow().rows(self.rows) as u64, sort)
        })
    }

    /// For the checks: a file row's number in a column the table sorts by.
    pub fn number(&self, row: usize, column: usize) -> f32 {
        self.catalog
            .as_ref()
            .filter(|catalog| row < catalog.rows())
            .map_or(f32::NAN, |catalog| catalog.number(row, column))
    }

    /// For the checks: the file row at a row of the table.
    pub fn file_row(&self, at: usize) -> Option<usize> {
        let view = self.view.borrow();
        view.file_row(at).filter(|_| at < view.rows(self.rows))
    }

    /// "Draw a group": the lasso's mode begins, where a drag on the scene
    /// draws a shape and time is paused under it; or, pressed in the mode
    /// or with a group held, it is let go: every row, every color, and
    /// time as it was. One action at a time: the dots fly back from the
    /// axes, the frame stops turning, and a found row is let go, as the
    /// mode begins (`docs/DECISIONS.md`, "Interface").
    fn toggle_lasso(&mut self, cx: &mut Context<Self>) {
        if group::held() {
            self.show_all(cx);
        } else if group::mode() || group::pending() {
            self.leave_mode(cx);
        } else if self.can_draw() {
            self.lose(cx);
            if flight::sorted() {
                flight::toggle();
                clock::resume_after_sort();
            }
            if ride::riding() {
                ride::toggle();
            }
            group::enter();
            clock::pause_for_group();
        }
        cx.notify();
    }

    /// Whether a group can be drawn: every row is drawn, and there's a
    /// table for its rows.
    fn can_draw(&self) -> bool {
        matches!(self.belt, Some(Belt::Whole { .. }))
            && self.scene_failed.is_none()
            && self.table.is_some()
    }

    /// The lasso's mode is left with no group: a shape half drawn goes,
    /// and time is given back.
    fn leave_mode(&mut self, cx: &mut Context<Self>) {
        if group::drawing() {
            scene::draw_end(false);
        }
        group::leave();
        clock::resume_after_group();
        cx.notify();
    }

    /// A release got its rows (`web::scene_pick`): with a group, the
    /// table is its rows; with none under the shape, the mode goes on.
    pub fn group_picked(&mut self, cx: &mut Context<Self>) {
        if group::held() {
            self.refilter(cx);
        }
        cx.notify();
    }

    /// "Show all rows", and the action pressed back: the group is let go.
    /// Every row is the table's again and every dot has its color; time
    /// runs again if the mode paused it.
    fn show_all(&mut self, cx: &mut Context<Self>) {
        if !group::held() {
            return;
        }
        group::let_go();
        clock::resume_after_group();
        self.refilter(cx);
        cx.notify();
    }

    /// The group, and the mode, let go by another action's press.
    fn drop_group(&mut self, cx: &mut Context<Self>) {
        if group::held() {
            self.show_all(cx);
        } else if group::mode() || group::pending() {
            self.leave_mode(cx);
        }
    }

    /// The table reads the group's rows, or with none every row: the count,
    /// and every page again, in the sort it had (`docs/DECISIONS.md`,
    /// "Table"). It goes to the top, and nothing is selected.
    fn refilter(&mut self, cx: &mut Context<Self>) {
        let Some(table) = self.table.clone() else {
            return;
        };
        self.view.borrow_mut().set_group(group::rows());
        let rows = self.view.borrow().rows(self.rows) as u64;
        // A found row is the table's selected row, which the new rows
        // clear.
        find::let_go();
        table.update(cx, |table, cx| {
            table.select(None, cx);
            table.set_rows(rows, cx);
            let sort = table.sort();
            // (Its own sort again: never refused.)
            let _ = table.set_sort(sort, cx);
        });
    }

    /// "Find Ceres": the table's first row is selected, and so found; or,
    /// pressed with Ceres found, it is let go and the camera flies back
    /// to where it opened.
    fn toggle_find(&mut self, cx: &mut Context<Self>) {
        if find::marked() == Some(CERES) {
            self.lose(cx);
            if let Some(frame) = hands_frame() {
                scene::home(frame);
            }
        } else if let Some(table) = self.table.clone().filter(|_| self.can_act()) {
            // A group Ceres isn't in is let go: the first row is every
            // row's first.
            if self.view.borrow().at(CERES).is_none() {
                self.show_all(cx);
            }
            let at = self.view.borrow().at(CERES).unwrap_or(CERES);
            // (The table's own row, scrolled to: found by its `Selected`.)
            table.update(cx, |table, cx| table.jump_to(at as u64, cx));
        }
        cx.notify();
    }

    /// "Sort by orbit size": the dots turn for a against e, or back for
    /// space, from wherever they are. Time moves nothing on the axes, so
    /// the press pauses it, and the press back gives it back
    /// (`docs/DECISIONS.md`, "Scene").
    fn toggle_sort(&mut self, cx: &mut Context<Self>) {
        // The way back is never turned down: a sort pressed before the
        // asteroids failed to load can still be pressed back.
        if !flight::sorted() && !self.can_act() {
            return;
        }
        flight::toggle();
        if flight::sorted() {
            // The corner leaves with space, and an open list with it: it
            // isn't there to be shut on the axes.
            self.controls_open = false;
            // A group, or the lasso's mode, is let go, and time with it,
            // before the sort pauses it again.
            self.drop_group(cx);
            clock::pause_for_sort();
            // A found row is let go: its mark is space's.
            self.lose(cx);
            // One action at a time: the frame stops turning, and the
            // camera heads back, as the dots leave for the axes
            // (`docs/DECISIONS.md`, "Interface"). A picked gap's marker
            // leaves with the frame it's drawn in.
            if ride::riding() {
                ride::toggle();
            }
        } else {
            clock::resume_after_sort();
        }
        cx.notify();
    }

    /// "Ride with Jupiter": the frame turns with Jupiter and the camera
    /// flies to straight above, or the frame stops turning and the camera
    /// goes back where it was, from wherever they are. Time runs on.
    fn toggle_ride(&mut self, cx: &mut Context<Self>) {
        // The way back is never turned down.
        if !ride::riding() && !self.can_act() {
            return;
        }
        ride::toggle();
        // A gap that was picked isn't this press's: pressed back, it
        // leaves with the frame (`gap::advance`); pressed again before
        // the camera is back, the ride opens as board 2 has it.
        if ride::riding() {
            gap::let_go();
            // One action at a time: a found row is let go, and a group.
            self.lose(cx);
            self.drop_group(cx);
        }
        // One action at a time: the dots fly back to space as the frame
        // starts to turn, and time, which the sort paused, runs again.
        if ride::riding() && flight::sorted() {
            flight::toggle();
            clock::resume_after_sort();
        }
        cx.notify();
    }

    /// A gap picked, by its chip on the landed layout or in the card: the
    /// marker goes to that gap, in the frame that turns with Jupiter. From
    /// the landed layout that lets the sort go and rides, both at once, as
    /// a press on "Ride with Jupiter" there would. A press on the card's
    /// picked chip (`in_card`) lets the marker go, and leaves the ride as
    /// board 2 has it; a second press on the landed layout's chip, still
    /// under the pointer as it fades, picks the same gap again
    /// (`docs/DECISIONS.md`, "Interface").
    fn pick_gap(&mut self, picked: usize, in_card: bool, cx: &mut Context<Self>) {
        if !self.can_act() {
            return;
        }
        if in_card && ride::riding() && gap::picked() == Some(picked) {
            gap::let_go();
        } else {
            gap::pick(picked);
            self.lose(cx);
            self.drop_group(cx);
            if !ride::riding() {
                ride::toggle();
            }
            if flight::sorted() {
                flight::toggle();
                clock::resume_after_sort();
            }
        }
        cx.notify();
    }

    /// Whether there are dots to sort or to ride beside, or may yet be:
    /// not once the asteroids or the scene failed with no belt drawn.
    fn can_act(&self) -> bool {
        self.belt.is_some()
            || !(matches!(self.files, Files::Failed(_)) || self.scene_failed.is_some())
    }

    /// The flight's step for this frame, and the next frame asked for
    /// while the dots fly: what leaves the picture with them is drawn at
    /// each step, and once more landed.
    fn step_flight(&mut self, window: &mut Window) {
        if flight::flying() {
            flight::advance(now());
            window.request_animation_frame();
        }
    }

    /// The ride's step for this frame, and the next frame asked for while
    /// the camera flies: the line about the stars leaves with them.
    fn step_ride(&mut self, window: &mut Window) {
        if ride::flying() {
            ride::advance(now());
            window.request_animation_frame();
        }
    }

    /// The marker's step for this frame, and the next frame asked for
    /// while it comes or goes: the card and the title's line go with it.
    /// (Read every frame: back in the fixed frame, this lets the gap go.)
    fn step_gap(&mut self, window: &mut Window) {
        gap::advance(now());
        if gap::moving() {
            window.request_animation_frame();
        }
    }

    /// The slide's step for this frame, and the next frame asked for while
    /// it moves.
    fn step_slide(&mut self, window: &mut Window) {
        let Some(slide) = &self.slide else {
            return;
        };
        let k = ((now() - slide.start_ms) / SLIDE_MS).clamp(0.0, 1.0);
        // Off the web the page clock stands still: the slide lands at once.
        let k = if cfg!(target_family = "wasm") { k } else { 1.0 };
        self.panel_t = slide.from + (slide.to - slide.from) * ease(k) as f32;
        if k >= 1.0 {
            self.slide = None;
        } else {
            window.request_animation_frame();
        }
    }

    fn render_title(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let line: SharedString = match (&self.files, &self.scene_failed, self.belt) {
            // The belt is drawn and the rows file isn't coming: the dots
            // keep their count, and the table has nothing.
            (Files::Failed(message), _, Some(belt @ Belt::Whole { .. })) => format!(
                "{} The table's rows didn't load. {message}",
                belt_line(belt)
            )
            .into(),
            (Files::Failed(message), _, _) => {
                format!("The asteroids didn't load. {message}").into()
            }
            (_, Some(message), _) => format!("The scene didn't start. {message}").into(),
            // The dots on screen, counted from the rows drawn; and, once
            // every row is, the rows that have no dot.
            (_, None, Some(belt)) => belt_line(belt).into(),
            // No count until it's counted from the rows.
            (Files::Loading { received, total }, None, None) if *total > 0.0 => format!(
                "Loading the asteroids: {:.0} of {:.0} MB",
                received / 1e6,
                total / 1e6
            )
            .into(),
            (Files::Loading { .. } | Files::Held, None, None) => "Loading the asteroids…".into(),
        };
        let muted = cx.theme().muted_foreground;
        let says = |line: SharedString| div().text_size(px(12.)).text_color(muted).child(line);
        // The line about the stars leaves with them (as the dots fly to a
        // against e, and as the frame turns with Jupiter), and returns
        // with them: it keeps its place in the line, so nothing under it
        // moves. In the frame that turns with Jupiter its place is taken
        // by what that frame exaggerates: the stars' sentence is gone by
        // the middle of the camera's flight, and the ride's comes in over
        // the rest of it, no sooner than the dots are back from the axes.
        // (The two aren't one length: where they wrap differently, or no
        // sky was drawn, the lines under them move at the swap, while
        // neither shows.)
        // With a gap picked the ride's sentence gives its place to the
        // marker's, the one leaving before the other comes.
        let turned = ride::turned();
        let marked = gap::shown();
        let riding = (turned >= 0.5 && self.belt.is_some()).then_some(if marked >= 0.5 {
            GAP_LINE
        } else {
            RIDE_LINE
        });
        let shows = if riding.is_some() {
            flight::space() * (2.0 * turned - 1.0) * (2.0 * marked - 1.0).abs()
        } else {
            flight::space() * (1.0 - 2.0 * turned).max(0.0)
        };
        let look = look_line(self.belt.is_some(), self.sky, riding).map(|(line, stars)| {
            let fades = HighlightStyle {
                // (A highlight's color is blended over the text's own, so
                // a clear one would change nothing.)
                fade_out: Some(1.0 - shows as f32),
                ..HighlightStyle::default()
            };
            div()
                .text_size(px(12.))
                .text_color(muted)
                .child(StyledText::new(line).with_highlights([(stars, fades)]))
        });
        div()
            .absolute()
            .left(px(24.))
            .top(px(20.))
            .max_w(px(560.))
            .flex()
            .flex_col()
            .gap_1()
            // Where this text lies: the scene quiets its picture under it.
            .child(
                canvas(
                    |bounds, window, _| {
                        let moved = scene::set_scrim([
                            bounds.origin.x.into(),
                            bounds.origin.y.into(),
                            bounds.size.width.into(),
                            bounds.size.height.into(),
                        ]);
                        // The e axis starts under these lines, and was
                        // laid out before they were measured: once more.
                        if moved && (flight::axes() > 0.0 || gap::lit() > 0.0) {
                            window.request_animation_frame();
                        }
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .child(
                div()
                    .text_size(px(14.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Kirkwood"),
            )
            .child(says(line))
            // What the picture means, once there's a picture: what's
            // exaggerated, whose the stars are, and what a color is.
            .children(look)
            .when(self.belt.is_some(), |block| {
                block.child(self.render_legend(cx))
            })
    }

    /// Color is orbit size: the tints from the ramp's first stop to its
    /// last, as board 1 draws the legend. Each slice is the tint the scene
    /// gives a dot of that orbit size.
    fn render_legend(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        // The bar never changes: its tints are mixed once.
        static TINTS: LazyLock<Vec<[f32; 3]>> = LazyLock::new(|| {
            let slices = (LEGEND_WIDTH / LEGEND_SLICE) as usize;
            (0..slices)
                .map(|slice| {
                    let along = (slice as f32 + 0.5) / slices as f32;
                    ramp::display(ramp::tint(ramp::FROM + (ramp::TO - ramp::FROM) * along))
                })
                .collect()
        });
        let bar = div()
            .relative()
            .w(px(LEGEND_WIDTH))
            .h(px(8.))
            .rounded(px(2.))
            .overflow_hidden()
            .flex()
            .children(TINTS.iter().map(|&[r, g, b]| {
                div()
                    .w(px(LEGEND_SLICE))
                    .h_full()
                    .bg(Rgba { r, g, b, a: 1.0 })
            }))
            .child(target(LEGEND_TARGET));
        let end = |au: f32| div().text_color(theme.foreground).child(format!("{au}"));
        div()
            .flex()
            .items_center()
            .gap_2()
            .text_size(px(12.))
            .text_color(theme.muted_foreground)
            .child("Color: orbit size (au)")
            .child(end(ramp::FROM))
            .child(bar)
            .child(end(ramp::TO))
    }

    fn render_time_control(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let running = clock::running();
        // No belt, and none coming: there's no time to run. (A rows file
        // that fails after the belt is drawn leaves the belt its clock.)
        let failed = self.belt.is_none()
            && (matches!(self.files, Files::Failed(_)) || self.scene_failed.is_some());
        let ended = clock::ended();
        let says = if failed {
            "no asteroids to move"
        } else if clock::held() && self.belt.is_some() {
            // The first dots are on screen, and stand still until the last.
            "waiting for the rest of the asteroids"
        } else if clock::held() {
            "waiting for the asteroids"
        } else if running {
            "1 year a second"
        } else if ended {
            // Every dot is on its 2026 orbit: a picture of the belt, and
            // not a forecast this far from it.
            "as far as 2026's orbits go"
        } else {
            "paused"
        };
        let tooltip: SharedString = if running {
            "Pause time".into()
        } else if ended {
            format!(
                "Run time again, from {}",
                clock::date(clock::starts_over_at())
            )
            .into()
        } else {
            "Run time".into()
        };
        let control = div()
            .h(px(28.))
            .flex()
            .items_center()
            .gap_2()
            .pl_1()
            .pr(px(10.))
            .border_1()
            .border_color(theme.border)
            .rounded(px(6.))
            .bg(theme.popover)
            // Nothing under it takes its presses.
            .occlude()
            .child(
                div().relative().child(target(TIME_TARGET)).child(
                    Button::new("time")
                        .ghost()
                        .xsmall()
                        .label(if running { "Pause" } else { "Run" })
                        .tooltip(tooltip)
                        .disabled(failed)
                        .on_click(cx.listener(|this, _, _, cx| {
                            // Run in the lasso's mode, the dots would move
                            // under the shape: the mode is left. (A group
                            // that's held stays lit as its dots drift apart.)
                            if group::mode() || group::pending() {
                                this.leave_mode(cx);
                                clock::set_running(true);
                            } else {
                                clock::set_running(!clock::running());
                            }
                            cx.notify();
                        })),
                ),
            )
            .child(self.date.clone())
            .child(
                div()
                    .text_size(px(12.))
                    .text_color(theme.muted_foreground)
                    .child(says),
            );
        // Board 1's row: the time control, then the actions. "Sort by
        // orbit size" is pressed with the dots on their way to a against
        // e, or there (board 4); "Ride with Jupiter", with the frame
        // turning to Jupiter's, or with it (board 2).
        let actions = div()
            .flex()
            .gap(px(6.))
            .child(self.render_action(
                "Sort by orbit size",
                SORT_TARGET,
                flight::sorted(),
                true,
                Self::toggle_sort,
                cx,
            ))
            .child(self.render_action(
                "Ride with Jupiter",
                RIDE_TARGET,
                ride::riding(),
                true,
                Self::toggle_ride,
                cx,
            ))
            // Board 1's third: pressed while Ceres is the row found. It
            // needs the table's rows, which a found row is one of.
            .child(self.render_action(
                "Find Ceres",
                FIND_TARGET,
                // (Marked: with no dots drawn, Ceres found has none.)
                find::marked() == Some(CERES),
                self.table.is_some(),
                Self::toggle_find,
                cx,
            ))
            // The lasso: pressed in its mode, and while a group is held.
            .child(self.render_action(
                "Draw a group",
                LASSO_TARGET,
                group::mode() || group::pending() || group::held(),
                self.can_draw(),
                Self::toggle_lasso,
                cx,
            ));
        div()
            .absolute()
            .left(px(24.))
            .bottom(px(24.))
            .flex()
            .items_center()
            .gap_4()
            .child(control)
            .child(actions)
    }

    /// An action, as board 1 draws one, and pressed as boards 2 and 4 do.
    /// `ready`: what it needs beyond dots to act on is there.
    fn render_action(
        &self,
        label: &'static str,
        published: &'static str,
        pressed: bool,
        ready: bool,
        press: fn(&mut Self, &mut Context<Self>),
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        let able = pressed || (ready && self.can_act());
        let (fill, hover, text) = if pressed {
            (theme.primary, theme.primary_hover, theme.primary_foreground)
        } else {
            (theme.secondary, theme.secondary_hover, theme.foreground)
        };
        div()
            .id(published)
            .h(px(28.))
            .px(px(10.))
            .flex()
            .items_center()
            .rounded(px(6.))
            .bg(fill)
            .text_size(px(14.))
            .text_color(text)
            .when(able, |action| {
                action
                    .cursor_pointer()
                    .hover(move |action| action.bg(hover))
            })
            .when(!able, |action| action.opacity(0.5))
            // Nothing under it takes its presses.
            .occlude()
            .on_click(cx.listener(move |this, _, _, cx| press(this, cx)))
            .child(label)
            .child(target(published))
    }

    /// The furniture of a against e, as board 4 draws it: the two axes
    /// with a tick and its number every half au and every tenth, their
    /// labels, a chip over each gap with its line down into the dots, the
    /// two groups' names, the line over the chips, and the count of rows
    /// in view. Dim while the dots fly (board 3), and what's said of the
    /// landed dots only as they land ([`flight::axes`], [`flight::landed`]).
    /// Every place is the crate's own plot's, the one the scene's shader
    /// lands the dots on ([`Plot`]). None of it takes a press but the
    /// chips, which are buttons.
    fn render_furniture(&self, window: &Window, cx: &Context<Self>) -> Option<impl IntoElement> {
        let (axes, landed) = (flight::axes() as f32, flight::landed() as f32);
        if axes <= 0.0 {
            return None;
        }
        let theme = cx.theme();
        let (muted, plain) = (theme.muted_foreground, theme.foreground);
        let line = rgb(AXIS);
        let size = window.viewport_size();
        let inset = f64::from(scene::inset());
        let plot = Plot::in_window(
            f64::from(f32::from(size.width)),
            f64::from(f32::from(size.height)),
            inset,
        );
        // A box of the window, CSS px.
        let at = |left: f64, top: f64, width: f64, height: f64| {
            div()
                .absolute()
                .left(px(left as f32))
                .top(px(top as f32))
                .w(px(width as f32))
                .h(px(height as f32))
        };
        // The title's lines are taller than the board's, and reach past
        // the e axis's top: the axis starts under them, with its label,
        // and a tick they cover isn't drawn (`docs/DECISIONS.md`,
        // "Interface").
        let [_, top, _, height] = scene::scrim().map(f64::from);
        let under = top + height + UNDER_TITLE;
        let e_top = plot.top.max(under);
        // The label: 14 px under the plot's top, as the board has it, or
        // under the title's lines if they end lower.
        let label_e_top = (plot.top + 14.0).max(under);

        let across = plot.ticks_a().into_iter().flat_map(|(a, x)| {
            [
                at(x - 0.5, plot.bottom, 1.0, 4.0).bg(line),
                at(x - 30.0, plot.bottom + 5.0, 60.0, 18.0)
                    .text_center()
                    .child(format!("{a:.1}")),
            ]
        });
        let up = plot
            .ticks_e()
            .into_iter()
            .filter(|&(_, y)| y >= e_top)
            .flat_map(|(e, y)| {
                [
                    at(plot.left - 5.0, y - 0.5, 4.0, 1.0).bg(line),
                    at(plot.left - 46.0, y - 9.5, 36.0, 18.0)
                        .text_right()
                        .child(format!("{e:.1}")),
                ]
            });
        let lines = div()
            .absolute()
            .inset_0()
            .opacity(axes)
            .text_color(muted)
            .child(
                at(plot.left, plot.bottom, plot.right - plot.left, 1.0)
                    .bg(line)
                    .child(target(AXIS_A_TARGET)),
            )
            .child(
                at(plot.left - 1.0, e_top, 1.0, plot.bottom - e_top)
                    .bg(line)
                    .child(target(AXIS_E_TARGET)),
            )
            .children(across)
            .children(up)
            .child(
                at(plot.left, plot.bottom + 25.0, plot.right - plot.left, 18.0)
                    .text_center()
                    .text_color(plain)
                    .child("a, the orbit's size (au)")
                    .child(target(LABEL_A_TARGET)),
            )
            .child(
                div()
                    .absolute()
                    .left(px(plot.left as f32 + 10.))
                    .top(px(label_e_top as f32))
                    .text_color(plain)
                    .child("e, how stretched the orbit is")
                    .child(target(LABEL_E_TARGET)),
            );

        // What's said of the landed dots.
        // (None in a plot too narrow for four chips in a row: the line
        // over them and their drops go with them.)
        let chips = plot.chips();
        let middle = chips.map(|chips| (chips[0].2 + chips[chips.len() - 1].2) / 2.0);
        let drops = chips.into_iter().flatten().map(|(_, gap, _)| {
            at(gap - 0.5, plot.top + layout::DROP_TOP, 1.0, layout::DROP).bg(linear_gradient(
                180.,
                linear_color_stop(plain.opacity(0.35), 0.),
                linear_color_stop(plain.opacity(0.), 1.),
            ))
        });
        let [chip_width, chip_height] = layout::CHIP;
        // Each chip is a button: a press picks its gap (board 5). It
        // takes its presses, so none reaches the surface under it.
        let chips = chips
            .into_iter()
            .flatten()
            .zip(CHIP_TARGETS)
            .enumerate()
            .map(|(gap, (((turns, jupiters), _, middle), id))| {
                at(
                    middle - chip_width / 2.0,
                    plot.top + layout::CHIPS_TOP,
                    chip_width,
                    chip_height,
                )
                .child(
                    div()
                        .id(("chip", gap))
                        .size_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .border_1()
                        .border_color(line)
                        .rounded(px(6.))
                        .bg(rgb(CHIP_FILL))
                        .text_color(plain)
                        .cursor_pointer()
                        .hover(move |chip| chip.border_color(plain))
                        .occlude()
                        .on_click(cx.listener(move |this, _, _, cx| this.pick_gap(gap, false, cx)))
                        .child(format!("{turns}:{jupiters}")),
                )
                // (Beside the chip, not in it: inside its border the
                // bounds would be a pixel short all round.)
                .child(target(id))
            });
        let groups = plot
            .groups()
            .into_iter()
            .zip(GROUP_TARGETS)
            .map(|((name, [x, y]), id)| {
                at(x - 130.0, y - 9.0, 260.0, 18.0)
                    .text_center()
                    .child(name)
                    .child(target(id))
            });
        // Said of dots that are drawn: with no belt (the sort pressed
        // before the first rows, or the asteroids failed since) the axes
        // stand empty and say nothing.
        let said = self.belt.filter(|_| landed > 0.0).map(|belt| {
            div()
                .absolute()
                .inset_0()
                .opacity(landed)
                .text_color(muted)
                .children(middle.map(|middle| {
                    at(
                        middle - 200.0,
                        plot.top + layout::CHIPS_LINE_TOP,
                        400.0,
                        18.0,
                    )
                    .text_center()
                    .child("Orbits in step with Jupiter are missing. Pick a gap.")
                    .child(target(GAPS_LINE_TARGET))
                }))
                .children(drops)
                .children(chips)
                .children(groups)
                // Bottom right of what the panel leaves, counted from the
                // rows drawn.
                .child(
                    div()
                        .absolute()
                        .right(px(inset as f32 + 24.))
                        .bottom(px(29.))
                        .child(in_view_line(belt))
                        .child(target(IN_VIEW_TARGET)),
                )
        });
        Some(
            div()
                .absolute()
                .inset_0()
                .text_size(px(12.))
                .line_height(px(18.))
                .child(lines)
                .children(said),
        )
    }

    /// A picked gap's card, as board 5 draws it: the four gaps as chips
    /// (the picked one outlined in white; a press on another moves the
    /// marker there, and one on the picked lets it go), the gap's name,
    /// why its orbit empties, and three numbers, each computed from
    /// Jupiter's own orbit ([`gap::card`]). Under the title's lines, as
    /// far under as the board's card is under its title.
    fn render_card(&self, cx: &Context<Self>) -> Option<impl IntoElement> {
        let lit = gap::lit() as f32;
        if lit <= 0.0 || self.belt.is_none() {
            return None;
        }
        let theme = cx.theme();
        let (muted, plain, edge) = (theme.muted_foreground, theme.foreground, theme.border);
        let marker = gap::marker();
        let picked = gap::picked();
        let card = gap::card(marker);
        let [_, top, _, height] = scene::scrim();
        let chips = layout::GAPS
            .into_iter()
            .zip(CARD_CHIP_TARGETS)
            .enumerate()
            .map(|(gap, ((turns, jupiters), id))| {
                let is_picked = picked == Some(gap);
                div()
                    .relative()
                    .child(
                        div()
                            .id(("card-chip", gap))
                            .h(px(24.))
                            .px(px(8.))
                            .flex()
                            .items_center()
                            .border_1()
                            .rounded(px(6.))
                            .text_size(px(12.))
                            .cursor_pointer()
                            .map(|chip| {
                                if is_picked {
                                    chip.border_color(plain).bg(plain.opacity(0.14))
                                } else {
                                    chip.border_color(rgb(AXIS))
                                        .hover(move |chip| chip.border_color(plain))
                                }
                            })
                            .on_click(
                                cx.listener(move |this, _, _, cx| this.pick_gap(gap, true, cx)),
                            )
                            .child(format!("{turns}:{jupiters}")),
                    )
                    .child(target(id))
            });
        let numbers = card.numbers.into_iter().map(|(label, number)| {
            div()
                .flex()
                .justify_between()
                .gap_3()
                .child(div().text_color(muted).child(label))
                .child(number)
        });
        Some(
            div()
                .absolute()
                .left(px(CARD_LEFT))
                .top(px((top + height + CARD_UNDER_TITLE).max(CARD_TOP)))
                .w(px(CARD_WIDTH))
                .opacity(lit)
                .child(
                    div()
                        .p_4()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .border_1()
                        .border_color(edge)
                        .rounded(px(8.))
                        .bg(rgba(CARD_FILL))
                        .text_size(px(12.))
                        .line_height(px(18.))
                        // Nothing under it takes its presses, or its wheel.
                        .occlude()
                        .child(div().flex().gap(px(6.)).children(chips))
                        .child(
                            div()
                                .text_size(px(16.))
                                .line_height(px(22.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(card.name),
                        )
                        .child(div().text_color(muted).child(card.why))
                        .child(
                            div()
                                .pt_3()
                                .flex()
                                .flex_col()
                                .gap_1()
                                .border_t_1()
                                .border_color(edge)
                                .children(numbers),
                        ),
                )
                // (Beside the card, not in it: inside its border the
                // bounds would be a pixel short all round.)
                .child(target(CARD_TARGET)),
        )
    }

    /// The corner, as boards 8 to 10 draw it: the hint (whole on a first
    /// visit, where there's room for it, and folded to its `?` button
    /// after), the compass beside it, and over them the controls' list
    /// while it's open. Bottom right of what the panel leaves. It is the
    /// camera's, so it leaves with space as the dots fly to the axes.
    fn render_corner(&self, window: &Window, cx: &Context<Self>) -> Option<impl IntoElement> {
        if !self.corner_shown() {
            return None;
        }
        let compass_view = self.compass.clone()?;
        // On its way out with space, it is drawn and takes nothing: a
        // press on what can barely be seen isn't one.
        let live = in_space();
        let theme = cx.theme();
        let (muted, plain, edge, fill) = (
            theme.muted_foreground,
            theme.foreground,
            theme.border,
            theme.popover,
        );
        let inset = scene::inset();
        let room = f32::from(window.viewport_size().width) - inset;
        let whole = !self.hint_folded && !self.controls_open && room >= HINT_ROOM;
        let open = self.controls_open;
        let hint = if whole {
            let says = |what: &'static str, does: &'static str| {
                div()
                    .flex()
                    .gap_1()
                    .child(div().text_color(plain).child(what))
                    .child(does)
            };
            let dot = || div().child("·");
            div()
                .id("hint")
                .h(px(28.))
                .px(px(10.))
                .flex()
                .items_center()
                .gap_2()
                .border_1()
                .border_color(edge)
                .rounded(px(6.))
                .bg(fill)
                .text_size(px(12.))
                .text_color(muted)
                .child(says("Drag", "to move"))
                .child(dot())
                .child(says("Scroll", "to zoom"))
                .child(dot())
                .child(says("Shift+drag", "to tilt"))
                .child(dot())
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_1()
                        .child(
                            div()
                                .min_w(px(16.))
                                .h(px(16.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .border_1()
                                .border_color(rgb(AXIS))
                                .rounded(px(4.))
                                .text_color(plain)
                                .child("?"),
                        )
                        .child("for more"),
                )
        } else {
            // Folded: the button, lit while the list is open (board 10).
            div()
                .id("hint")
                .size(px(28.))
                .flex()
                .items_center()
                .justify_center()
                .border_1()
                .rounded(px(6.))
                .text_size(px(14.))
                .map(|button| {
                    if open {
                        button
                            .border_color(theme.primary)
                            .bg(theme.primary)
                            .text_color(theme.primary_foreground)
                    } else {
                        button.border_color(edge).bg(fill).text_color(plain)
                    }
                })
                .child("?")
        }
        .when(live, |hint| {
            hint.cursor_pointer()
                .hover(move |hint| hint.border_color(plain))
                // Nothing under it takes its presses.
                .occlude()
                .on_click(cx.listener(|this, _, _, cx| this.toggle_controls(cx)))
        });
        let compass = div()
            .id("compass")
            .size(px(COMPASS))
            .flex()
            .items_center()
            .justify_center()
            .border_1()
            .border_color(edge)
            .rounded(px(COMPASS / 2.))
            .bg(fill)
            .when(live, |compass| {
                compass
                    .cursor_pointer()
                    .hover(move |compass| compass.border_color(plain))
                    .occlude()
                    // The way home: where the camera is a hand's, the one
                    // it has.
                    .on_click(|_, _, _| {
                        if let Some(frame) = hands_frame() {
                            scene::home(frame);
                        }
                    })
            })
            .child(compass_view);
        Some(
            div()
                .absolute()
                .inset_0()
                .opacity(flight::space() as f32)
                .children(open.then(|| {
                    // Beside the handle, not under it: the board's list is
                    // as tall as the handle is high up, and the handle is
                    // drawn over it (`docs/DECISIONS.md`, "Interface").
                    // The open panel has no handle.
                    let clear = if self.panel_t > 0.0 {
                        0.0
                    } else {
                        room - self.handle_left.get() + CONTROLS_CLEAR
                    };
                    self.render_controls(inset + CORNER_IN.max(clear), cx)
                }))
                .child(
                    div()
                        .absolute()
                        .right(px(inset + CORNER_IN))
                        .bottom(px(CORNER_IN))
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(div().relative().child(hint).child(target(HINT_TARGET)))
                        .child(
                            div()
                                .relative()
                                .child(compass)
                                .child(target(COMPASS_TARGET)),
                        ),
                ),
        )
    }

    /// The controls' list, as board 10 draws it: the mouse's, the
    /// trackpad's, and the keys' controls, over the corner. It takes its
    /// presses and its wheel: none reaches the scene under it.
    fn render_controls(&self, right: f32, cx: &Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (muted, edge) = (theme.muted_foreground, theme.border);
        let says = rgb(CONTROLS_SAYS);
        let key = |names: &'static str| {
            div()
                .px(px(5.))
                .border_1()
                .border_color(rgb(AXIS))
                .rounded(px(4.))
                .child(names)
        };
        let row = |does: &'static str, how: Div| {
            div()
                .flex()
                .justify_between()
                .child(does)
                .child(how.flex().items_center().gap_1().text_color(says))
        };
        let group = |name: &'static str| {
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(div().text_color(muted).child(name))
        };
        let close = div()
            .id("controls-close")
            .relative()
            .size(px(20.))
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(4.))
            .cursor_pointer()
            .hover(|close| close.bg(theme.secondary))
            .on_click(cx.listener(|this, _, _, cx| this.toggle_controls(cx)))
            .child(cross_drawing(muted))
            .child(target(CONTROLS_CLOSE_TARGET));
        div()
            .absolute()
            .right(px(right))
            .bottom(px(CONTROLS_BOTTOM))
            .w(px(CONTROLS_WIDTH))
            .child(
                div()
                    .pt(px(14.))
                    .px_4()
                    .pb_4()
                    .flex()
                    .flex_col()
                    .gap(px(14.))
                    .border_1()
                    .border_color(edge)
                    .rounded(px(8.))
                    .bg(theme.popover)
                    .text_size(px(12.))
                    .line_height(px(18.))
                    .occlude()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_size(px(14.))
                                    .line_height(px(20.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child("Moving the camera"),
                            )
                            .child(close),
                    )
                    .child(
                        group("Mouse")
                            .child(row("Move", div().child("Drag")))
                            .child(row("Zoom", div().child("Scroll, or double click")))
                            .child(row(
                                "Tilt and turn",
                                div().child(key("Shift")).child("+ drag"),
                            )),
                    )
                    .child(
                        group("Trackpad")
                            .child(row("Move", div().child("Click and drag")))
                            .child(row(
                                "Zoom",
                                div().child("Pinch, or two fingers up and down"),
                            ))
                            .child(row(
                                "Tilt and turn",
                                div().child(key("Shift")).child("+ click and drag"),
                            )),
                    )
                    .child(
                        group("Keys")
                            .child(row(
                                "Move",
                                div()
                                    .child(key("←"))
                                    .child(key("↑"))
                                    .child(key("↓"))
                                    .child(key("→")),
                            ))
                            .child(row("Zoom", div().child(key("+")).child(key("−"))))
                            .child(row(
                                "Back to the first view",
                                div().child(key("H")).child(", or the compass"),
                            ))
                            .child(row("This list", div().child(key("?")))),
                    )
                    .child(
                        div()
                            .text_color(muted)
                            .child("With the table open, the keys are the table's."),
                    ),
            )
            // (Beside the list, not in it: inside its border the bounds
            // would be a pixel short all round.)
            .child(target(CONTROLS_TARGET))
    }

    fn render_handle(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let says: SharedString = match &self.files {
            Files::Loading { .. } => "Loading rows…".into(),
            Files::Failed(_) => "No rows".into(),
            Files::Held => format!("{} rows", grouped(self.rows)).into(),
        };
        let handle = div()
            .id("handle")
            .h(px(56.))
            .pl(px(10.))
            .pr(px(14.))
            .flex()
            .flex_col()
            .justify_center()
            .border_1()
            .border_color(theme.border)
            .rounded_l(px(8.))
            .bg(theme.popover)
            .when(self.table.is_some(), |handle| handle.cursor_pointer())
            .occlude()
            .on_click(cx.listener(|this, _, window, cx| this.toggle_panel(window, cx)))
            .child(
                div()
                    .text_size(px(12.))
                    .text_color(theme.muted_foreground)
                    .child("Table"),
            )
            .child(div().text_size(px(14.)).child(says))
            // Where it starts: the controls' list, laid out before it,
            // keeps clear of it, so it is laid out once more when this moves.
            .child({
                let (left, open) = (self.handle_left.clone(), self.controls_open);
                measured(HANDLE_TARGET, move |bounds, window| {
                    if left.replace(bounds.origin.x.into()) != f32::from(bounds.origin.x) && open {
                        window.request_animation_frame();
                    }
                })
            });
        // Halfway down the right edge, whatever the window's height.
        div()
            .absolute()
            .right_0()
            .top_0()
            .h_full()
            .flex()
            .flex_col()
            .justify_center()
            .child(handle)
    }

    fn render_panel(&self, table: &Entity<Table>, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        div()
            .absolute()
            // Slides in from the right edge.
            .right(px(-(1.0 - self.panel_t) * PANEL_WIDTH))
            .top_0()
            .h_full()
            .w(px(PANEL_WIDTH))
            .flex()
            .flex_col()
            .border_l_1()
            .border_color(theme.border)
            .bg(GLASS.map_or(theme.popover, |fill| theme.popover.opacity(fill)))
            .occlude()
            .child(
                div()
                    .h(px(40.))
                    .pl_3()
                    .pr_2()
                    .flex()
                    .items_center()
                    .gap_2()
                    .children(match group::rows() {
                        // Board 7's header: the group's rows, of the
                        // file's, and the way back to them.
                        Some(rows) => vec![
                            div()
                                .relative()
                                .text_size(px(14.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(format!("{} rows in the shape", grouped(rows.len())))
                                .child(target(GROUP_COUNT_TARGET))
                                .into_any_element(),
                            div()
                                .flex_1()
                                .text_size(px(12.))
                                .text_color(theme.muted_foreground)
                                .child(format!("of {}", grouped(self.rows)))
                                .into_any_element(),
                            div()
                                .id("show-all")
                                .relative()
                                .h(px(24.))
                                .px_2()
                                .flex()
                                .items_center()
                                .rounded(px(6.))
                                .bg(theme.secondary)
                                .hover(|button| button.bg(theme.secondary_hover))
                                .cursor_pointer()
                                .text_size(px(14.))
                                .on_click(cx.listener(|this, _, _, cx| this.show_all(cx)))
                                .child("Show all rows")
                                .child(target(SHOW_ALL_TARGET))
                                .into_any_element(),
                        ],
                        None => vec![
                            div()
                                .flex_1()
                                .text_size(px(14.))
                                .child(format!("{} rows", grouped(self.rows)))
                                .into_any_element(),
                        ],
                    })
                    .child(
                        div().relative().child(target(CLOSE_TARGET)).child(
                            Button::new("close")
                                .ghost()
                                .small()
                                .label("Close")
                                .on_click(
                                    cx.listener(|this, _, window, cx| {
                                        this.toggle_panel(window, cx)
                                    }),
                                ),
                        ),
                    ),
            )
            // A found row with no dot: the press flew nowhere, and
            // this says why.
            .children(find::found().filter(|_| find::marked().is_none()).map(|_| {
                div()
                    .relative()
                    .px_3()
                    .pb_2()
                    .text_size(px(12.))
                    .text_color(theme.muted_foreground)
                    .child(no_dot_line(&find::name(), self.belt.is_some()))
                    .child(target(NO_DOT_TARGET))
            }))
            .child(div().flex_1().min_h_0().child(TallTable::new(table)))
    }
}

impl Render for Host {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.step_slide(window);
        self.step_flight(window);
        self.step_ride(window);
        self.step_gap(window);
        // The scene centers its picture in what the panel leaves.
        scene::set_inset(self.panel_t * PANEL_WIDTH);
        // The keys are the scene's unless something else has them (the
        // table, from its panel's opening until a press elsewhere).
        if !self.panel_open && window.focused(cx).is_none() {
            window.focus(&self.focus, cx);
        }
        let root = div()
            .relative()
            .size_full()
            .text_color(cx.theme().foreground)
            .track_focus(&self.focus)
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| this.key(event, cx)))
            // Under everything: what the title, the time control, the
            // handle, and the panel don't take is the scene's. They occlude
            // it, so a wheel over the table never zooms.
            .child(
                div()
                    .id("scene")
                    .absolute()
                    .inset_0()
                    // In the lasso's mode a drag here draws.
                    .when(group::mode(), |surface| {
                        surface.cursor(CursorStyle::Crosshair)
                    })
                    .on_scroll(|event: &ScrollEvent, _, _| {
                        // The camera holds still under a shape, from its
                        // press until its rows are in.
                        if group::drawing() || group::pending() {
                            return;
                        }
                        // The camera is space's: with the dots headed
                        // for the axes, on them, or on their way back,
                        // a wheel moves nothing. Nor while the camera
                        // flies to the ride or back: it would be the
                        // fixed frame's, changed unseen.
                        let Some(frame) = hands_frame() else {
                            return;
                        };
                        scene::wheel(
                            event.position.x.into(),
                            event.position.y.into(),
                            event.delta.pixel_delta(px(16.)).y.into(),
                            held(event.modifiers),
                            frame,
                        );
                    })
                    // A press here starts a drag of the scene's, which
                    // it keeps to its release wherever that is
                    // (`drag_listeners`); a double click's second press
                    // zooms in, and starts none. Only where the camera
                    // is a hand's.
                    .on_any_mouse_down(|event: &MouseDownEvent, _, _| {
                        let Some(button) = button(event.button) else {
                            return;
                        };
                        let Some(frame) = hands_frame() else {
                            return;
                        };
                        let (x, y) = (event.position.x.into(), event.position.y.into());
                        // In the lasso's mode the left button draws a
                        // shape, through the fixed frame's camera at
                        // rest, and no button moves it.
                        if group::mode() || group::pending() {
                            if button == 0 && frame == scene::Frame::Fixed && group::press(x, y) {
                                scene::draw_start(x, y);
                            }
                            return;
                        }
                        let held = held(event.modifiers);
                        let plain = button == 0 && held == 0;
                        // (Asked of every plain press, so the next knows
                        // of this one.)
                        let second = plain && scene::surface_press(frame);
                        if second && event.click_count == 2 {
                            scene::double_click(x, y, frame);
                        } else {
                            scene::drag_start(x, y, button, held, frame);
                        }
                    }),
            )
            .child(drag_listeners())
            // The axes' furniture takes no input: a wheel or a press
            // on it falls through to the surface above.
            .children(self.render_furniture(window, cx))
            .child(self.render_title(cx))
            .children(self.render_card(cx))
            .child(self.render_time_control(cx))
            .children(self.render_corner(window, cx));
        match &self.table {
            Some(table) if self.panel_t > 0.0 => root.child(self.render_panel(&table.clone(), cx)),
            _ => root.child(self.render_handle(cx)),
        }
    }
}

/// The clock's date, a view of its own: it looks at the clock every
/// [`DATE_EVERY`], and asks for a redraw when the date it shows is old, or
/// when the clock stopped or started under it (the scene's reading can
/// carry it to its last day, where it stops).
struct DateLabel {
    /// The clock as last shown: its years, and whether it ran.
    shown: (f64, bool),
}

impl DateLabel {
    fn new(cx: &mut Context<Self>) -> Self {
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(DATE_EVERY).await;
                let alive = this.update(cx, |this, cx| {
                    if clock::moves() {
                        clock::advance(now());
                    }
                    let clock = (clock::years(), clock::running());
                    if clock != this.shown {
                        this.shown = clock;
                        cx.notify();
                    }
                });
                if alive.is_err() {
                    break;
                }
            }
        })
        .detach();
        Self {
            shown: (clock::years(), clock::running()),
        }
    }
}

impl Render for DateLabel {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().text_size(px(14.)).child(clock::date(clock::years()))
    }
}

/// Whether the dots are in space: not headed for the axes, on them, or on
/// their way back.
fn in_space() -> bool {
    !(flight::sorted() || flight::progress() > 0.0)
}

/// Whether the camera is the fixed frame's, at rest there: not riding with
/// Jupiter, nor on its way there or back.
fn fixed_frame() -> bool {
    !ride::riding() && ride::turned() <= 0.0
}

/// Whose camera a hand has, if either: in space, the fixed frame's at rest
/// there, or the ride's own once the frame turns with Jupiter. On the way
/// between the two, and with the dots out of space, neither.
fn hands_frame() -> Option<scene::Frame> {
    if !in_space() {
        None
    } else if fixed_frame() {
        Some(scene::Frame::Fixed)
    } else if ride::riding() && ride::turned() >= 1.0 {
        Some(scene::Frame::Turning)
    } else {
        None
    }
}

/// A button as the scene takes it: 0 the left, 1 the middle, 2 the right.
fn button(button: MouseButton) -> Option<u8> {
    match button {
        MouseButton::Left => Some(0),
        MouseButton::Middle => Some(1),
        MouseButton::Right => Some(2),
        MouseButton::Navigate(_) => None,
    }
}

fn held(modifiers: Modifiers) -> u8 {
    scene::modifiers(
        modifiers.control,
        modifiers.shift,
        modifiers.alt,
        modifiers.platform,
    )
}

/// What the window hears for the scene, wherever the pointer is: any press
/// (a camera gliding stops), and a drag's moves and release once the
/// surface has handed its press over, so a drag that crosses the panel or
/// a control keeps the camera. Registered every frame, not only once a
/// drag starts: a press and its release can both come before the next
/// paint. It draws nothing and takes no input of its own.
fn drag_listeners() -> impl IntoElement {
    canvas(
        |_, _, _| {},
        |_, _, window, _| {
            window.on_mouse_event(|_: &MouseDownEvent, phase, _, _| {
                if phase == DispatchPhase::Capture {
                    scene::press();
                }
            });
            window.on_mouse_event(|event: &MouseMoveEvent, phase, window, _| {
                if phase != DispatchPhase::Capture {
                    return;
                }
                // A shape being drawn: its next point, or, its button
                // found up, its close.
                if group::drawing() {
                    let [x, y] = in_scene(event.position, window);
                    if event.pressed_button == Some(MouseButton::Left) {
                        if group::point(x, y) {
                            scene::draw_move(x, y);
                        }
                    } else {
                        close_shape();
                    }
                    return;
                }
                let Some(dragging) = scene::dragging() else {
                    return;
                };
                let (x, y) = (event.position.x.into(), event.position.y.into());
                // The release never came (a canceled pointer, say): the
                // button isn't down.
                if event.pressed_button.and_then(button) == Some(dragging) {
                    scene::drag_move(x, y);
                } else {
                    scene::drag_end(x, y);
                }
            });
            // Any button's release ends it: with two held, the platform
            // tells the first one's release as a move, with the button
            // it remembers still down, so the drag's own may never come.
            window.on_mouse_event(|event: &MouseUpEvent, phase, window, _| {
                if phase != DispatchPhase::Capture {
                    return;
                }
                // The release closes a shape wherever it lands.
                if group::drawing() {
                    let [x, y] = in_scene(event.position, window);
                    if group::point(x, y) {
                        scene::draw_move(x, y);
                    }
                    close_shape();
                }
                scene::drag_end(event.position.x.into(), event.position.y.into());
            });
        },
    )
    .absolute()
    .size_0()
}

/// A window position kept to what the panel leaves of the window: a shape
/// drawn across the panel runs along its edge (`docs/DECISIONS.md`,
/// "Interface").
fn in_scene(position: Point<Pixels>, window: &Window) -> [f32; 2] {
    let size = window.viewport_size();
    let room = (f32::from(size.width) - scene::inset()).max(0.0);
    [
        f32::from(position.x).clamp(0.0, room),
        f32::from(position.y).clamp(0.0, f32::from(size.height).max(0.0)),
    ]
}

/// A drawn shape closes, through the scene's camera as it is: its rows
/// are picked over the next frames (`web::scene_pick`). One that holds
/// nothing (a press and a release in one place) is gone, the mode still on.
fn close_shape() {
    let camera = group::Camera::from_scene(&scene::camera());
    scene::draw_end(group::release(camera));
}

/// The compass's drawing, a view of its own: the scene tells of the
/// camera's turn and tilt up to every frame of a drag, and this alone is
/// drawn again for it, as the date alone is for the clock.
struct Compass {
    /// How far the camera stands round from where it opened, and its tilt
    /// from straight down (degrees), as the scene last drew it.
    camera: [f32; 2],
}

impl Render for Compass {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let [turned, tilt] = self.camera;
        compass_drawing(turned, tilt, cx.theme().foreground)
    }
}

/// The compass, as board 8 draws it: a ring that the camera's tilt
/// flattens (a circle from straight down, a line edge-on) and a needle that
/// turns as the camera stands round from where it opened, its near half
/// white. Home, the needle points up.
fn compass_drawing(turned: f32, tilt: f32, lit: Hsla) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let middle = bounds.center();
            let at = |x: f32, y: f32| point(middle.x + px(x), middle.y + px(y));
            let flat = (COMPASS_RING * tilt.to_radians().cos()).max(COMPASS_THIN);
            let mut ring = PathBuilder::stroke(px(1.));
            ring.move_to(at(-COMPASS_RING, 0.));
            for end in [COMPASS_RING, -COMPASS_RING] {
                ring.arc_to(
                    point(px(COMPASS_RING), px(flat)),
                    px(0.),
                    false,
                    true,
                    at(end, 0.),
                );
            }
            ring.close();
            if let Ok(ring) = ring.build() {
                window.paint_path(ring, rgb(COMPASS_DIM));
            }
            // The needle's two halves, turned clockwise as the window has it.
            let (sin, cos) = turned.to_radians().sin_cos();
            let turn = |x: f32, y: f32| at(x * cos - y * sin, x * sin + y * cos);
            for (tip, color) in [
                (COMPASS_RING, Hsla::from(rgb(COMPASS_DIM))),
                (-COMPASS_RING, lit),
            ] {
                let mut half = PathBuilder::fill();
                half.move_to(turn(0., tip));
                half.line_to(turn(COMPASS_NEEDLE, 0.));
                half.line_to(turn(-COMPASS_NEEDLE, 0.));
                half.close();
                if let Ok(half) = half.build() {
                    window.paint_path(half, color);
                }
            }
        },
    )
    .size(px(28.))
}

/// The cross on the controls' list's close button, as board 10 draws it.
fn cross_drawing(color: Hsla) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let middle = bounds.center();
            for sign in [1., -1.] {
                let mut stroke = PathBuilder::stroke(px(1.5));
                stroke.move_to(point(middle.x - px(4.), middle.y - px(4. * sign)));
                stroke.line_to(point(middle.x + px(4.), middle.y + px(4. * sign)));
                if let Ok(stroke) = stroke.build() {
                    window.paint_path(stroke, color);
                }
            }
        },
    )
    .size(px(12.))
}

/// Publishes its parent's bounds under `id` (`__seizaTargets[id]`).
fn target(id: &'static str) -> impl IntoElement {
    measured(id, |_, _| {})
}

/// Publishes its parent's bounds under `id`, and hands them to `then` as
/// they're laid out.
fn measured(
    id: &'static str,
    then: impl Fn(Bounds<Pixels>, &mut Window) + 'static,
) -> impl IntoElement {
    canvas(
        move |bounds, window, _| {
            seiza::targets::publish(id, bounds);
            then(bounds, window);
        },
        |_, _, _, _| {},
    )
    // From the parent's corner: left to its static place it would start
    // inside the parent's padding.
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

fn ease(k: f64) -> f64 {
    if k < 0.5 {
        4.0 * k * k * k
    } else {
        1.0 - (-2.0 * k + 2.0).powi(3) / 2.0
    }
}

/// What's drawn, counted from the rows drawn: while the belt fills, the
/// dots so far and the rows on their way; whole, the dots, and the rows
/// that have none and why.
fn belt_line(belt: Belt) -> String {
    let (drawn, unbound) = match belt {
        Belt::Filling { dots, rows, .. } => {
            return format!(
                "{} asteroids so far, each on its own orbit, of {} rows arriving.",
                grouped(dots),
                grouped(rows)
            );
        }
        Belt::Whole { drawn, unbound, .. } => (drawn, unbound),
    };
    let dots = format!(
        "{} asteroids, each on its own orbit, and every dot is a row.",
        grouped(drawn)
    );
    match unbound {
        0 => dots,
        1 => format!(
            "{dots} 1 more row has no dot: it's passing through, on a path that never closes."
        ),
        unbound => format!(
            "{dots} {unbound} more rows have no dot: they're passing through, on paths that never close."
        ),
    }
}

/// The rows with a place on the sort's axes, of the file's: counted from
/// the rows drawn, as every count on the page is.
fn in_view_line(belt: Belt) -> String {
    let (in_view, rows) = match belt {
        Belt::Filling { rows, in_view, .. } => (in_view, rows),
        Belt::Whole {
            drawn,
            unbound,
            in_view,
        } => (in_view, drawn + unbound),
    };
    format!("{} of {} rows in view", grouped(in_view), grouped(rows))
}

/// What the picture isn't: with the belt drawn, a dot's size is
/// exaggerated; with the sky drawn, the stars are dots that aren't rows.
/// Each is said while it's on screen, whether or not the other is: the sky
/// is drawn even when the asteroids didn't load. With the line, the part
/// of it that's about the stars (its bytes): that part leaves the picture
/// when they do. `riding`, in the frame that turns with Jupiter, there is
/// no sky, and that part says instead what the frame does to the dots'
/// light ([`RIDE_LINE`], or with a gap picked [`GAP_LINE`]).
fn look_line(
    belt: bool,
    sky: bool,
    riding: Option<&'static str>,
) -> Option<(SharedString, Range<usize>)> {
    let dots = "Dot sizes are exaggerated: at true scale each one is an invisible speck.";
    if let (true, Some(says)) = (belt, riding) {
        let line = format!("{dots} {says}");
        return Some((line.into(), dots.len()..dots.len() + 1 + says.len()));
    }
    match (belt, sky) {
        (true, true) => {
            let line =
                format!("{dots} The stars behind are real, from ESA's Gaia, and aren't rows.");
            let stars = dots.len()..line.len();
            Some((line.into(), stars))
        }
        (true, false) => Some((dots.into(), dots.len()..dots.len())),
        (false, true) => {
            let line = "The stars are real, from ESA's Gaia, and aren't rows.";
            Some((line.into(), 0..line.len()))
        }
        (false, false) => None,
    }
}

/// What the frame that turns with Jupiter exaggerates, said while it does
/// (`docs/DECISIONS.md`, "Look").
const RIDE_LINE: &str = "Here the Hildas and the Trojans are brightened, and the rest dimmed.";

/// What that frame shows with a gap picked, said while it does: the belt
/// dimmed, and a marker that isn't a row (rules 1 and 3).
const GAP_LINE: &str =
    "Here the belt is dimmed under the marker's path, and the marker isn't a row.";

/// A row's name as its mark says it: its own name, or with none its
/// number, or with neither its designation.
fn row_name(catalog: &Catalog, row: usize) -> String {
    let rows = catalog.file_rows();
    rows.name(row).unwrap_or_else(|| rows.pdes(row))
}

/// Why a found row has no mark and the camera didn't move: its path
/// never closes, so it has no dot (the title counts those rows); or there
/// are no dots at all.
fn no_dot_line(name: &str, belt: bool) -> String {
    if belt {
        format!("{name} has no dot to fly to: it's passing through, on a path that never closes.")
    } else {
        format!("{name} has no dot to fly to: the asteroids aren't drawn.")
    }
}

/// What the chip at a drawn shape says, as board 6 has it: the group's
/// rows, counted. (The chip is the scene's: off the web nothing asks.)
#[cfg(any(target_family = "wasm", test))]
pub fn group_line(rows: usize) -> String {
    match rows {
        1 => "1 row".into(),
        rows => format!("{} rows", grouped(rows)),
    }
}

/// A count with its thousands apart: `1,580,272`.
fn grouped(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{Belt, GAP_LINE, RIDE_LINE, belt_line, grouped, in_view_line, look_line};

    #[test]
    fn what_the_picture_isnt_is_said_while_its_on_screen() {
        assert_eq!(look_line(false, false, None), None);
        let (stars, part) = look_line(false, true, None).unwrap();
        assert!(stars.contains("aren't rows") && !stars.contains("exaggerated"));
        assert_eq!(&stars[part], stars.as_ref());
        let (dots, part) = look_line(true, false, None).unwrap();
        assert!(dots.contains("exaggerated") && !dots.contains("Gaia"));
        assert!(part.is_empty());
        // The part that leaves with the stars is the stars' sentence alone.
        let (both, part) = look_line(true, true, None).unwrap();
        assert!(both.contains("exaggerated") && both.contains("aren't rows"));
        assert!(
            both[part.clone()]
                .trim_start()
                .starts_with("The stars behind")
        );
        assert!(both[..part.start].ends_with("speck."));
        // Riding with Jupiter there's no sky: that part says what the
        // turned frame does to the dots' light, whether or not the stars
        // were ever in.
        for sky in [false, true] {
            let (riding, part) = look_line(true, sky, Some(RIDE_LINE)).unwrap();
            assert!(riding.contains("exaggerated") && !riding.contains("Gaia"));
            assert!(
                riding[part.clone()]
                    .trim_start()
                    .starts_with("Here the Hildas")
            );
            assert!(riding[part].ends_with("dimmed."));
            // With a gap picked, it says the marker isn't a row.
            let (marked, part) = look_line(true, sky, Some(GAP_LINE)).unwrap();
            assert!(marked.contains("exaggerated") && !marked.contains("Hildas"));
            assert!(marked[part].ends_with("the marker isn't a row."));
        }
        // With no belt there's nothing brightened to speak of.
        assert_eq!(look_line(false, false, Some(RIDE_LINE)), None);
    }

    #[test]
    fn the_rows_with_no_dot_are_counted_apart() {
        let line = |drawn, unbound| {
            belt_line(Belt::Whole {
                drawn,
                unbound,
                in_view: 0,
            })
        };
        assert_eq!(
            belt_line(Belt::Filling {
                dots: 32_768,
                rows: 1_580_272,
                in_view: 0,
            }),
            "32,768 asteroids so far, each on its own orbit, of 1,580,272 rows arriving."
        );
        assert_eq!(
            line(1_580_265, 7),
            "1,580,265 asteroids, each on its own orbit, and every dot is a row. 7 more rows have no dot: they're passing through, on paths that never close."
        );
        assert!(line(10, 1).contains("1 more row has no dot"));
        assert!(line(10, 0).ends_with("every dot is a row."));
    }

    #[test]
    fn the_chip_counts_the_groups_rows() {
        assert_eq!(super::group_line(143_854), "143,854 rows");
        assert_eq!(super::group_line(1), "1 row");
    }

    #[test]
    fn the_rows_in_view_are_counted_of_the_files_rows() {
        assert_eq!(
            in_view_line(Belt::Whole {
                drawn: 1_580_265,
                unbound: 7,
                in_view: 1_546_968
            }),
            "1,546,968 of 1,580,272 rows in view"
        );
        // While the belt fills: of the rows drawn so far, and still of
        // the file's.
        assert_eq!(
            in_view_line(Belt::Filling {
                dots: 32_768,
                rows: 1_580_272,
                in_view: 32_000
            }),
            "32,000 of 1,580,272 rows in view"
        );
    }

    #[test]
    fn counts_are_grouped_by_thousands() {
        assert_eq!(grouped(0), "0");
        assert_eq!(grouped(999), "999");
        assert_eq!(grouped(1000), "1,000");
        assert_eq!(grouped(1_580_272), "1,580,272");
    }
}
