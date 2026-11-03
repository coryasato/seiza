//! The scenario the page asked for (`contenders/scenarios.ts`, picked by the
//! JS host from `?scenario=` and `?stop=`): the data file's SQL name and, on
//! a feature level's build, what the level sets on the table. The JS host
//! resolves the ids; an id the build doesn't know reaches here as a failure,
//! which the host shows and marks (`contender:failed`).

use gpui_kit::*;
#[cfg(any(target_family = "wasm", not(feature = "wide")))]
use seiza_duckdb::tall_table::{ParquetFile, QueryRows};

/// What the host opens and how it sets the table.
#[derive(Debug, Clone, PartialEq)]
pub struct Scene {
    /// The data file's SQL name, which the page SQL names: the same on both
    /// sides (root `CLAUDE.md`, "Comparison protocol").
    pub file: String,
    #[cfg(feature = "wide")]
    pub wide: Wide,
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
    /// The file's least and greatest value over the painted columns.
    pub domain: seiza_tall_table::Domain,
}

impl Scene {
    /// From the JS host's numbers: on the wide level `[row_height,
    /// text_size, column_width, pinned, heat_from, lo, hi]`, on the base
    /// none. Anything else is an error the host shows.
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
                hi,
            ] = level
            else {
                return Err(format!(
                    "the wide level takes 7 numbers, not {}",
                    level.len()
                ));
            };
            if !(row_height > 0.0 && text_size > 0.0 && column_width > 0.0 && lo < hi) {
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
                    domain: seiza_tall_table::Domain::new(lo, hi),
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

/// The table's source: the engine's rows, on the wide level painted.
#[cfg(not(feature = "wide"))]
pub type Rows = QueryRows<ParquetFile>;
#[cfg(feature = "wide")]
pub type Rows = heat::HeatRows;

/// The source over `engine` for `scene` (the engine exists only on the web).
#[cfg(target_family = "wasm")]
pub fn rows(engine: seiza_duckdb::Engine, scene: &Scene) -> Rows {
    let rows = QueryRows::new(engine, ParquetFile::new(scene.file.clone()));
    #[cfg(feature = "wide")]
    return heat::HeatRows {
        rows,
        from: scene.wide.heat_from,
        domain: scene.wide.domain,
    };
    #[cfg(not(feature = "wide"))]
    rows
}

/// The columns as the summary describes them, set as the scene's level says.
#[cfg_attr(
    not(target_family = "wasm"),
    expect(dead_code, reason = "only the web build opens the file")
)]
pub fn columns(
    summary: &[seiza_duckdb::sql::ColumnInfo],
    scene: &Scene,
) -> Vec<seiza_tall_table::TallTableColumn> {
    let _ = scene;
    summary
        .iter()
        .enumerate()
        .map(|(index, info)| {
            let column = info.tall_table_column();
            #[cfg(feature = "wide")]
            if index >= scene.wide.heat_from {
                return column
                    .fill(seiza_tall_table::Ramp::new(&[
                        |theme| theme.background,
                        |theme| theme.chart_1,
                    ]))
                    .width(px(scene.wide.column_width));
            }
            let _ = index;
            column
        })
        .collect()
}

/// Sets the scene's level on a new table, before its first frame.
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
    #[cfg(not(feature = "wide"))]
    let _ = (table, scene, cx);
}

/// Heat on the days: the engine's pages, each painted column's float
/// mapped through the file's whole range (never a page's: colors would
/// jump at page boundaries).
#[cfg(feature = "wide")]
mod heat {
    use std::ops::Range;

    use gpui_kit::App;
    use seiza_duckdb::arrow::Value;
    use seiza_duckdb::tall_table::{ParquetFile, QueryRows};
    use seiza_tall_table::{
        CellPaint, CellValue, Domain, PageLoad, TallTableDelegate, TallTablePage,
    };

    type Inner = QueryRows<ParquetFile>;

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
