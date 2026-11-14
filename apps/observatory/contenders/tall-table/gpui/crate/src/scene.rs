//! The scenario the page asked for (`contenders/scenarios.ts`, picked by the
//! JS host from `?scenario=` and `?stop=`): the data file's SQL name and, on
//! a feature level's build, what the level sets on the table. The JS host
//! resolves the ids; an id the build doesn't know reaches here as a failure,
//! which the host shows and marks (`contender:failed`).

use gpui_kit::*;
#[cfg(not(any(feature = "tail", feature = "wall")))]
#[cfg(any(target_family = "wasm", not(feature = "wide")))]
use seiza_duckdb::tall_table::{ParquetFile, QueryRows};

#[cfg(any(
    all(feature = "wide", feature = "market"),
    all(feature = "wide", feature = "tail"),
    all(feature = "wide", feature = "wall"),
    all(feature = "market", feature = "tail"),
    all(feature = "market", feature = "wall"),
    all(feature = "tail", feature = "wall")
))]
compile_error!("a build is one level: only one of `wide`, `market`, `tail`, and `wall` can be on");

/// Market watch's level: its store as the table's source, its formats and
/// colors. The monitoring wall draws its colors and flash (`wall`).
#[cfg(any(feature = "market", feature = "wall"))]
#[cfg_attr(
    feature = "wall",
    expect(
        dead_code,
        reason = "the wall draws market watch's colors, not its table"
    )
)]
pub mod market;
/// Live tail's level: the replay's pages, the time's text, its colors.
#[cfg(feature = "tail")]
pub mod tail;
/// The monitoring wall's level: N desks of the store, its grid.
#[cfg(feature = "wall")]
pub mod wall;

/// What the host opens and how it sets the table.
#[derive(Debug, Clone, PartialEq)]
pub struct Scene {
    /// The data file's SQL name, which the page SQL names: the same on both
    /// sides (root `CLAUDE.md`, "Comparison protocol").
    pub file: String,
    #[cfg(feature = "wide")]
    pub wide: Wide,
    #[cfg(feature = "market")]
    pub market: market::Market,
    #[cfg(feature = "tail")]
    pub tail: tail::Tail,
    #[cfg(feature = "wall")]
    pub wall: wall::Wall,
}

/// The wide sheet's level at a stop.
#[cfg(feature = "wide")]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Wide {
    pub row_height: f32,
    pub text_size: f32,
    /// The painted columns' width, px.
    pub column_width: f32,
    /// The first columns pinned.
    pub pinned: usize,
    /// The first column painted; every one from it on is.
    pub heat_from: usize,
    /// The heat's domain: the ramp's ends and its middle.
    pub domain: seiza_tall_table::Domain,
}

impl Scene {
    /// From the JS host's numbers: on the wide level `[row_height,
    /// text_size, column_width, pinned, heat_from, lo, mid, hi]`, on the
    /// base none (the market level's is [`Scene::market`], the tail
    /// level's [`Scene::tail`], the wall's [`Scene::wall`]). Anything else
    /// is an error the host shows.
    #[cfg(not(any(feature = "market", feature = "tail", feature = "wall")))]
    pub fn new(file: String, level: &[f64]) -> Result<Self, String> {
        #[cfg(feature = "wide")]
        {
            let &[
                row_height,
                text_size,
                column_width,
                pinned,
                heat_from,
                lo,
                mid,
                hi,
            ] = level
            else {
                return Err(format!(
                    "the wide level takes 8 numbers, not {}",
                    level.len()
                ));
            };
            if !(row_height > 0.0
                && text_size > 0.0
                && column_width > 0.0
                && lo <= mid
                && mid <= hi
                && lo < hi)
            {
                return Err(format!(
                    "the wide level's numbers are out of range: {level:?}"
                ));
            }
            Ok(Self {
                file,
                wide: Wide {
                    row_height: row_height as f32,
                    text_size: text_size as f32,
                    column_width: column_width as f32,
                    pinned: pinned as usize,
                    heat_from: heat_from as usize,
                    domain: seiza_tall_table::Domain::new(lo, hi).mid(mid),
                },
            })
        }
        #[cfg(not(feature = "wide"))]
        {
            if !level.is_empty() {
                return Err(format!(
                    "the base level takes no numbers, not {}",
                    level.len()
                ));
            }
            Ok(Self { file })
        }
    }
}

#[cfg(feature = "market")]
impl Scene {
    /// The market level's scene: `level` as `market::Market::new` takes
    /// it, and the columns that flash by name.
    pub fn market(file: String, level: &[f64], flash: &[String]) -> Result<Self, String> {
        Ok(Self {
            file,
            market: market::Market::new(level, flash)?,
        })
    }
}

#[cfg(feature = "wall")]
impl Scene {
    /// The wall level's scene: `level` as `wall::Wall::new` takes it, and
    /// the columns that flash by name.
    pub fn wall(file: String, level: &[f64], flash: &[String]) -> Result<Self, String> {
        Ok(Self {
            file,
            wall: wall::Wall::new(level, flash)?,
        })
    }
}

#[cfg(feature = "tail")]
impl Scene {
    /// The tail level's scene: `level` as `tail::Tail::new` takes it.
    pub fn tail(file: String, level: &[f64]) -> Result<Self, String> {
        Ok(Self {
            file,
            tail: tail::Tail::new(level)?,
        })
    }
}

/// The table's source: the engine's rows, on the wide level painted, on
/// the market level the store's once the open's page is in, on the tail
/// level the replay's pages over the file fetched whole, on the wall a
/// desk of the store's.
#[cfg(not(any(
    feature = "wide",
    feature = "market",
    feature = "tail",
    feature = "wall"
)))]
pub type Rows = QueryRows<ParquetFile>;
#[cfg(feature = "wide")]
pub type Rows = heat::HeatRows;
#[cfg(feature = "market")]
pub type Rows = market::MarketRows<QueryRows<ParquetFile>>;
#[cfg(feature = "tail")]
pub type Rows = tail::TailRows;
#[cfg(feature = "wall")]
pub type Rows = wall::DeskRows;

/// The source over `engine` for `scene` (the engine exists only on the web;
/// the wall's host makes its own, `wall::DeskRows`).
#[cfg(all(target_family = "wasm", not(feature = "wall")))]
pub fn rows(engine: seiza_duckdb::Engine, scene: &Scene) -> Rows {
    // Every page from the file fetched whole, never the ranged copy the
    // open read (`scene.file`).
    #[cfg(feature = "tail")]
    let _ = scene;
    #[cfg(feature = "tail")]
    return tail::TailRows {
        rows: seiza_duckdb::tall_table::QueryRows::new(engine, crate::tail::TailQuery::default()),
    };
    #[cfg(not(feature = "tail"))]
    let rows = QueryRows::new(engine, ParquetFile::new(scene.file.clone()));
    #[cfg(feature = "wide")]
    return heat::HeatRows {
        rows,
        from: scene.wide.heat_from,
        domain: scene.wide.domain,
    };
    #[cfg(feature = "market")]
    return market::MarketRows::new(rows, &scene.market);
    #[cfg(not(any(feature = "wide", feature = "market", feature = "tail")))]
    rows
}

/// The columns as the summary describes them, set as the scene's level says
/// (the wall's are `wall::columns`).
#[cfg(not(feature = "wall"))]
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens the file")
)]
pub fn columns(
    summary: &[seiza_duckdb::sql::ColumnInfo],
    scene: &Scene,
) -> Vec<seiza_tall_table::TallTableColumn> {
    let _ = scene;
    #[cfg(feature = "market")]
    return market::columns(
        summary
            .iter()
            .map(|info| info.tall_table_column())
            .collect(),
        &scene.market,
    );
    #[cfg(feature = "tail")]
    return tail::columns(
        summary
            .iter()
            .map(|info| info.tall_table_column())
            .collect(),
        &scene.tail,
    );
    #[cfg(not(any(feature = "market", feature = "tail")))]
    summary
        .iter()
        .enumerate()
        .map(|(index, info)| {
            let column = info.tall_table_column();
            #[cfg(feature = "wide")]
            if index >= scene.wide.heat_from {
                return column.fill(heat::ramp()).width(px(scene.wide.column_width));
            }
            let _ = index;
            column
        })
        .collect()
}

/// Sets the scene's level on a new table, before its first frame (the
/// wall's host sets its tables' own).
#[cfg(not(feature = "wall"))]
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens the file")
)]
pub fn set_level(
    table: &mut seiza_tall_table::TallTableState<Rows>,
    scene: &Scene,
    cx: &mut Context<seiza_tall_table::TallTableState<Rows>>,
) {
    #[cfg(feature = "wide")]
    {
        table.set_pinned(scene.wide.pinned, cx);
        table.set_density(
            seiza_tall_table::Density {
                row_height: px(scene.wide.row_height),
                text_size: px(scene.wide.text_size).into(),
            },
            cx,
        );
    }
    // A log view follows from the start, before its first frame.
    #[cfg(feature = "tail")]
    table.follow(cx);
    #[cfg(not(any(feature = "wide", feature = "tail")))]
    let _ = (table, scene, cx);
    #[cfg(feature = "tail")]
    let _ = scene;
}

/// An Oklch color in sRGB (each of a level's colors is inside its gamut),
/// as CSS converts `oklch()`: Björn Ottosson's matrices.
#[cfg(any(
    feature = "wide",
    feature = "market",
    feature = "tail",
    feature = "wall"
))]
pub(crate) fn oklch([l, c, h]: [f32; 3]) -> Hsla {
    let (a, b) = (c * h.to_radians().cos(), c * h.to_radians().sin());
    let l_ = (l + 0.396_337_78 * a + 0.215_803_76 * b).powi(3);
    let m_ = (l - 0.105_561_346 * a - 0.063_854_17 * b).powi(3);
    let s_ = (l - 0.089_484_18 * a - 1.291_485_5 * b).powi(3);
    let encode = |linear: f32| {
        let linear = linear.clamp(0.0, 1.0);
        if linear <= 0.003_130_8 {
            linear * 12.92
        } else {
            1.055 * linear.powf(1.0 / 2.4) - 0.055
        }
    };
    Rgba {
        r: encode(4.076_741_7 * l_ - 3.307_711_6 * m_ + 0.230_969_94 * s_),
        g: encode(-1.268_438 * l_ + 2.609_757_4 * m_ - 0.341_319_38 * s_),
        b: encode(-0.004_196_086_3 * l_ - 0.703_418_6 * m_ + 1.707_614_7 * s_),
        a: 1.0,
    }
    .into()
}

/// Heat on the days: the engine's pages, each painted column's float
/// mapped through the scenario's domain (one for every page: colors would
/// jump at page boundaries otherwise), drawn through its diverging ramp.
#[cfg(feature = "wide")]
mod heat {
    use std::ops::Range;
    use std::sync::OnceLock;

    use gpui_kit::component::Theme;
    use gpui_kit::{App, Hsla};
    use seiza_duckdb::arrow::Value;
    use seiza_duckdb::tall_table::{ParquetFile, QueryRows};
    use seiza_tall_table::{
        CellPaint, CellValue, Domain, PageLoad, TallTableDelegate, TallTablePage,
    };

    type Inner = QueryRows<ParquetFile>;

    /// The ramp's stops in Oklch, `[l, c, h]`: cold, the middle, warm, in
    /// the light theme and the dark. `contenders/scenarios.ts`'s wide
    /// sheet's `heat.stops`, which the TanStack side and the page draw; a
    /// `Stop` captures nothing, so they're copied here and `perf/wide.ts`
    /// fails if they differ.
    const LIGHT: [[f32; 3]; 3] = [[0.6, 0.13, 262.0], [0.985, 0.0, 0.0], [0.64, 0.18, 32.0]];
    const DARK: [[f32; 3]; 3] = [[0.48, 0.12, 262.0], [0.2, 0.0, 0.0], [0.55, 0.17, 32.0]];

    /// Stop `index` in `theme`'s mode, converted once per theme: a column's
    /// ramp resolves its stops each frame.
    fn stop(theme: &Theme, index: usize) -> Hsla {
        static STOPS: OnceLock<[[Hsla; 3]; 2]> = OnceLock::new();
        let [light, dark] = STOPS.get_or_init(|| [LIGHT.map(super::oklch), DARK.map(super::oklch)]);
        let stops = if theme.is_dark() { dark } else { light };
        stops[index]
    }

    /// The days' fill: cold through the middle to warm, mixed in Oklab.
    pub fn ramp() -> seiza_tall_table::Ramp {
        seiza_tall_table::Ramp::new(&[
            |theme| stop(theme, 0),
            |theme| stop(theme, 1),
            |theme| stop(theme, 2),
        ])
    }

    pub struct HeatRows {
        pub rows: Inner,
        pub from: usize,
        pub domain: Domain,
    }

    impl TallTableDelegate for HeatRows {
        type Page = HeatPage;
        type Request = <Inner as TallTableDelegate>::Request;

        fn load_page(
            &mut self,
            rows: Range<u64>,
            cx: &mut App,
        ) -> (Self::Request, PageLoad<Self::Page>) {
            let (request, load) = self.rows.load_page(rows, cx);
            let (from, domain) = (self.from, self.domain);
            (
                request,
                Box::pin(async move { load.await.map(|page| HeatPage { page, from, domain }) }),
            )
        }

        fn cancel(&mut self, request: Self::Request, cx: &mut App) {
            self.rows.cancel(request, cx);
        }
    }

    pub struct HeatPage {
        page: <Inner as TallTableDelegate>::Page,
        from: usize,
        domain: Domain,
    }

    impl TallTablePage for HeatPage {
        fn value(&self, row: usize, column: usize) -> Option<CellValue<'_>> {
            // The trait's, not the page's own (the engine's `Value`).
            TallTablePage::value(&self.page, row, column)
        }

        fn paint(&self, row: usize, column: usize) -> CellPaint {
            let mut paint = CellPaint::default();
            if column >= self.from
                && let Some(Value::Float(value)) = self.page.value(row, column)
            {
                paint.fill = Some(self.domain.unit(value));
            }
            paint
        }

        fn heap_bytes(&self) -> usize {
            TallTablePage::heap_bytes(&self.page)
        }
    }
}
