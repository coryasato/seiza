//! The interface: the title, the time control, the action beside it
//! ("Sort by orbit size"), the furniture of the axes the sort lands the
//! dots on, and the table behind its handle on the right edge, a panel
//! that slides in over the rows. Under them, a window-sized surface that hears what nothing above it took: a
//! wheel there is the scene's.
//!
//! Its first frame holds no data: the title, the time control, and the
//! handle saying its rows are loading. The files arrive after it
//! ([`Host::progress`], then [`Host::loaded`] or [`Host::failed`]), and the
//! scene says when the belt is drawn ([`Host::belt_drawn`]), which is when
//! time starts to move.

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
use seiza_tall_table::{Paging, TallTable};
use tall_table_bridge::Publish;

use crate::catalog::{Catalog, columns};
use crate::clock;
use crate::flight;
use crate::layout::{self, Plot};
use crate::ramp;
use crate::scene;
use crate::table::{Source, Table};

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
    /// Counted from the files.
    rows: usize,
    panel_open: bool,
    /// How far in the panel is, 0..1.
    panel_t: f32,
    slide: Option<Slide>,
    date: Entity<DateLabel>,
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
            rows: 0,
            panel_open: false,
            panel_t: 0.0,
            slide: None,
            date: cx.new(DateLabel::new),
            _table_events: None,
        }
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
        let table = cx.new(|cx| {
            Table::new(Source::new(catalog), columns(), rows, Paging::default(), cx)
                .probe_frames(probing)
                .probe_cells(probe_cells)
        });
        let publish = Publish {
            filled_mark: Some(TABLE_MARK),
            scrollbar: true,
            probe: probing.then_some("__kirkwoodTable"),
            layout: probing.then_some("__kirkwoodLayout"),
            cells: probe_cells.then_some("__kirkwoodCells"),
            ..Publish::default()
        };
        self._table_events = Some(cx.subscribe(&table, move |_, _, event, _| publish.event(event)));
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
        }
        self.slide = Some(Slide {
            from: self.panel_t,
            to: if self.panel_open { 1.0 } else { 0.0 },
            start_ms: now(),
        });
        cx.notify();
    }

    /// "Sort by orbit size": the dots turn for a against e, or back for
    /// space, from wherever they are. Time moves nothing on the axes, so
    /// the press pauses it, and the press back gives it back
    /// (`docs/DECISIONS.md`, "Scene").
    fn toggle_sort(&mut self, cx: &mut Context<Self>) {
        // The way back is never turned down: a sort pressed before the
        // asteroids failed to load can still be pressed back.
        if !flight::sorted() && !self.can_sort() {
            return;
        }
        flight::toggle();
        if flight::sorted() {
            clock::pause_for_sort();
        } else {
            clock::resume_after_sort();
        }
        cx.notify();
    }

    /// Whether there are dots to sort, or may yet be: not once the
    /// asteroids or the scene failed with no belt drawn.
    fn can_sort(&self) -> bool {
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
        // The line about the stars leaves with them as the dots fly to a
        // against e, and returns with them: it keeps its place in the
        // line, so nothing under it moves.
        let look = look_line(self.belt.is_some(), self.sky).map(|(line, stars)| {
            let fades = HighlightStyle {
                // (A highlight's color is blended over the text's own, so
                // a clear one would change nothing.)
                fade_out: Some(1.0 - flight::space() as f32),
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
                        if moved && flight::axes() > 0.0 {
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
                        .on_click(cx.listener(|_, _, _, cx| {
                            clock::set_running(!clock::running());
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
        // Board 1's row: the time control, then the actions.
        div()
            .absolute()
            .left(px(24.))
            .bottom(px(24.))
            .flex()
            .items_center()
            .gap_4()
            .child(control)
            .child(self.render_sort(cx))
    }

    /// The action: "Sort by orbit size", as board 1 draws it, and pressed
    /// (the dots on their way to a against e, or there) as board 4 does.
    fn render_sort(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let pressed = flight::sorted();
        let able = pressed || self.can_sort();
        let (fill, hover, text) = if pressed {
            (theme.primary, theme.primary_hover, theme.primary_foreground)
        } else {
            (theme.secondary, theme.secondary_hover, theme.foreground)
        };
        div()
            .id("sort")
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
            .on_click(cx.listener(|this, _, _, cx| this.toggle_sort(cx)))
            .child("Sort by orbit size")
            .child(target(SORT_TARGET))
    }

    /// The furniture of a against e, as board 4 draws it: the two axes
    /// with a tick and its number every half au and every tenth, their
    /// labels, a chip over each gap with its line down into the dots, the
    /// two groups' names, the line over the chips, and the count of rows
    /// in view. Dim while the dots fly (board 3), and what's said of the
    /// landed dots only as they land ([`flight::axes`], [`flight::landed`]).
    /// Every place is the crate's own plot's, the one the scene's shader
    /// lands the dots on ([`Plot`]). None of it takes a press.
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
        let chips = plot.chips();
        let middle = (chips[0].2 + chips[chips.len() - 1].2) / 2.0;
        let drops = chips.into_iter().map(|(_, gap, _)| {
            at(gap - 0.5, plot.top + layout::DROP_TOP, 1.0, layout::DROP).bg(linear_gradient(
                180.,
                linear_color_stop(plain.opacity(0.35), 0.),
                linear_color_stop(plain.opacity(0.), 1.),
            ))
        });
        let [chip_width, chip_height] = layout::CHIP;
        let chips =
            chips
                .into_iter()
                .zip(CHIP_TARGETS)
                .map(|(((turns, jupiters), _, middle), id)| {
                    at(
                        middle - chip_width / 2.0,
                        plot.top + layout::CHIPS_TOP,
                        chip_width,
                        chip_height,
                    )
                    .child(
                        div()
                            .size_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .border_1()
                            .border_color(line)
                            .rounded(px(6.))
                            .bg(rgb(CHIP_FILL))
                            .text_color(plain)
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
                .child(
                    at(
                        middle - 200.0,
                        plot.top + layout::CHIPS_LINE_TOP,
                        400.0,
                        18.0,
                    )
                    .text_center()
                    .child("Orbits in step with Jupiter are missing.")
                    .child(target(GAPS_LINE_TARGET)),
                )
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
            .child(target(HANDLE_TARGET));
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
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(14.))
                            .child(format!("{} rows", grouped(self.rows))),
                    )
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
            .child(div().flex_1().min_h_0().child(TallTable::new(table)))
    }
}

impl Render for Host {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.step_slide(window);
        self.step_flight(window);
        // The scene centers its picture in what the panel leaves.
        scene::set_inset(self.panel_t * PANEL_WIDTH);
        let root =
            div()
                .relative()
                .size_full()
                .text_color(cx.theme().foreground)
                // Under everything: what the title, the time control, the
                // handle, and the panel don't take is the scene's. They occlude
                // it, so a wheel over the table never zooms.
                .child(div().id("scene").absolute().inset_0().on_scroll(
                    |event: &ScrollEvent, _, _| {
                        // The camera is space's: with the dots headed for
                        // the axes, on them, or on their way back, a wheel
                        // moves nothing.
                        if flight::sorted() || flight::progress() > 0.0 {
                            return;
                        }
                        let delta = event.delta.pixel_delta(px(16.)).y;
                        scene::wheel(
                            event.position.x.into(),
                            event.position.y.into(),
                            delta.into(),
                        );
                    },
                ))
                // The axes' furniture takes no input: a wheel or a press
                // on it falls through to the surface above.
                .children(self.render_furniture(window, cx))
                .child(self.render_title(cx))
                .child(self.render_time_control(cx));
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

/// Publishes its parent's bounds under `id` (`__seizaTargets[id]`).
fn target(id: &'static str) -> impl IntoElement {
    canvas(
        move |bounds, _, _| seiza::targets::publish(id, bounds),
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
/// when they do.
fn look_line(belt: bool, sky: bool) -> Option<(SharedString, Range<usize>)> {
    let dots = "Dot sizes are exaggerated: at true scale each one is an invisible speck.";
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
    use super::{Belt, belt_line, grouped, in_view_line, look_line};

    #[test]
    fn what_the_picture_isnt_is_said_while_its_on_screen() {
        assert_eq!(look_line(false, false), None);
        let (stars, part) = look_line(false, true).unwrap();
        assert!(stars.contains("aren't rows") && !stars.contains("exaggerated"));
        assert_eq!(&stars[part], stars.as_ref());
        let (dots, part) = look_line(true, false).unwrap();
        assert!(dots.contains("exaggerated") && !dots.contains("Gaia"));
        assert!(part.is_empty());
        // The part that leaves with the stars is the stars' sentence alone.
        let (both, part) = look_line(true, true).unwrap();
        assert!(both.contains("exaggerated") && both.contains("aren't rows"));
        assert!(
            both[part.clone()]
                .trim_start()
                .starts_with("The stars behind")
        );
        assert!(both[..part.start].ends_with("speck."));
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
