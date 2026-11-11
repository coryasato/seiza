//! The interface: the title, the time control, and the table behind its
//! handle on the right edge, a panel that slides in over the rows.
//!
//! Its first frame holds no data: the title, the time control, and the
//! handle saying its rows are loading. The files arrive after it
//! ([`Host::progress`], then [`Host::loaded`] or [`Host::failed`]).

use std::rc::Rc;
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
use crate::table::{Source, Table};

/// The panel's width, CSS px.
const PANEL_WIDTH: f32 = 560.;
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

pub struct Host {
    files: Files,
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
        cx.notify();
    }

    /// Both files are held: the table opens over them, and time may move.
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
        clock::release();
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
        let line: SharedString = match &self.files {
            // No count until it's counted from the rows.
            Files::Loading { received, total } if *total > 0.0 => format!(
                "Loading the asteroids: {:.0} of {:.0} MB",
                received / 1e6,
                total / 1e6
            )
            .into(),
            Files::Loading { .. } => "Loading the asteroids…".into(),
            Files::Failed(message) => format!("The asteroids didn't load. {message}").into(),
            Files::Held => {
                format!("{} asteroids, each a row of the table.", grouped(self.rows)).into()
            }
        };
        div()
            .absolute()
            .left(px(24.))
            .top(px(20.))
            .max_w(px(560.))
            .flex()
            .flex_col()
            .gap_1()
            .child(
                div()
                    .text_size(px(14.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Kirkwood"),
            )
            .child(
                div()
                    .text_size(px(12.))
                    .text_color(cx.theme().muted_foreground)
                    .child(line),
            )
    }

    fn render_time_control(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let running = clock::running();
        let failed = matches!(self.files, Files::Failed(_));
        let says = if failed {
            "no asteroids to move"
        } else if clock::held() {
            "waiting for the asteroids"
        } else if running {
            "1 year a second"
        } else {
            "paused"
        };
        div()
            .absolute()
            .left(px(24.))
            .bottom(px(24.))
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
                        .tooltip(if running { "Pause time" } else { "Run time" })
                        // Nothing loaded: there's no time to run.
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
            .bg(theme.popover)
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
        let root = div()
            .relative()
            .size_full()
            .text_color(cx.theme().foreground)
            .child(self.render_title(cx))
            .child(self.render_time_control(cx));
        match &self.table {
            Some(table) if self.panel_t > 0.0 => root.child(self.render_panel(&table.clone(), cx)),
            _ => root.child(self.render_handle(cx)),
        }
    }
}

/// The clock's date, a view of its own: while time moves it redraws at
/// [`DATE_EVERY`], and nothing else in the window redraws with it.
struct DateLabel;

impl DateLabel {
    fn new(cx: &mut Context<Self>) -> Self {
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(DATE_EVERY).await;
                let alive = this.update(cx, |_, cx| {
                    if clock::moves() {
                        clock::advance(now());
                        cx.notify();
                    }
                });
                if alive.is_err() {
                    break;
                }
            }
        })
        .detach();
        Self
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
    use super::grouped;

    #[test]
    fn counts_are_grouped_by_thousands() {
        assert_eq!(grouped(0), "0");
        assert_eq!(grouped(999), "999");
        assert_eq!(grouped(1000), "1,000");
        assert_eq!(grouped(1_580_272), "1,580,272");
    }
}
