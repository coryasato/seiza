//! `?selftest`: checks the bridge end to end, from Rust, in the real app.
//!
//! Runs once the engine is ready. Each check becomes an overlay row, and the
//! whole report is published to `globalThis.__tychoSelftest` for
//! `perf/engine.ts`:
//!
//! - `SELECT 42 AS x` decodes to an int with x = 42.
//! - A row of every type the table shows decodes to the text DuckDB means.
//!   This is the Arrow reader's check against DuckDB's real output.
//! - A query that would run for minutes stops within 200 ms of `cancel`, and
//!   the next query still succeeds.

use gpui_kit::AsyncApp;
use js_sys::{Array, Object, Promise, Reflect};
use wasm_bindgen::{JsCast as _, JsValue};
use wasm_bindgen_futures::JsFuture;

use crate::arrow::Value;
use crate::engine::{Engine, EngineError, WARM_UP_SQL, now};

/// Cancel must stop a query within this long (PLAN.md, M2).
const CANCEL_BUDGET_MS: f64 = 200.0;

/// How long the long query runs before it's cancelled.
const RUN_BEFORE_CANCEL_MS: i32 = 500;

const TYPES_SQL: &str = "SELECT 42 AS x, NULL AS n, true AS b, -8::TINYINT AS i8, \
    200::UTINYINT AS u8, 9007199254740993::BIGINT AS i64, 1.5::FLOAT AS f32, \
    0.1::DOUBLE AS f64, 12.345::DECIMAL(10, 3) AS dec, 'héllo, \"x\"' AS s, \
    '\\xAA'::BLOB AS bin, DATE '2024-02-29' AS d, TIME '12:34:56.000001' AS t, \
    TIMESTAMP '2024-02-29 12:34:56.123456' AS ts, \
    TIMESTAMPTZ '2024-02-29 12:34:56+00' AS tstz, [1, 2] AS list, NULL::INTEGER AS null_int";

/// What each `TYPES_SQL` column must read as, in order.
const TYPES_EXPECTED: &[&str] = &[
    "42",
    "NULL",
    "true",
    "-8",
    "200",
    "9007199254740993",
    "1.5",
    "0.1",
    "12.345",
    "héllo, \"x\"",
    "\\xAA",
    "2024-02-29",
    "12:34:56.000001",
    "2024-02-29 12:34:56.123456",
    "2024-02-29 12:34:56 UTC",
    "<list>",
    "NULL",
];

/// PLAN.md's `range(1e10)`: DuckDB won't bind `range(DOUBLE)`, so the count
/// is written as a BIGINT literal.
const LONG_SQL: &str = "SELECT count(*) FROM range(10000000000)";

struct Check {
    name: &'static str,
    ok: bool,
    /// What the overlay shows, timings included.
    detail: String,
    /// The check's headline time, for `perf/engine.ts`: the query's round
    /// trip, or for cancel, from `cancel` to the rejection.
    ms: Option<f64>,
}

pub fn requested() -> bool {
    seiza::url::has_param("selftest")
}

pub async fn run(engine: &Engine, cx: &mut AsyncApp) {
    let checks = vec![
        select_42(engine).await,
        types(engine).await,
        cancel(engine).await,
    ];
    publish(&checks);
    cx.update(|cx| {
        for check in &checks {
            let verdict = if check.ok { "ok" } else { "FAIL" };
            seiza::perf::set_metric(
                cx,
                format!("Self-test: {}", check.name),
                format!("{verdict}: {}", check.detail),
            );
        }
    });
}

async fn select_42(engine: &Engine) -> Check {
    let started = now();
    let (_, result) = engine.query(WARM_UP_SQL);
    let result = result.await;
    let ms = now() - started;
    let (ok, detail) = match &result {
        Ok(result) => {
            let name = result.fields.first().map(|field| field.name.as_str());
            let value = result.value(0, 0);
            let ok = name == Some("x") && value == Some(Value::Int(42)) && result.num_rows() == 1;
            let shown = value.map_or("no rows".into(), |value| value.to_string());
            (
                ok,
                format!("{} = {shown} in {ms:.1} ms", name.unwrap_or("?")),
            )
        }
        Err(error) => (false, error.to_string()),
    };
    Check {
        name: "SELECT 42",
        ok,
        detail,
        ms: Some(ms),
    }
}

async fn types(engine: &Engine) -> Check {
    let started = now();
    let (_, result) = engine.query(TYPES_SQL);
    let result = result.await;
    let ms = now() - started;
    let (ok, detail) = match &result {
        Ok(result) => {
            let mismatches: Vec<String> = TYPES_EXPECTED
                .iter()
                .enumerate()
                .filter_map(|(column, expected)| {
                    let field = result.fields.get(column)?;
                    let shown = result
                        .value(0, column)
                        .map_or("missing".into(), |value| value.to_string());
                    (shown != *expected).then(|| {
                        format!(
                            "{} ({}) = {shown:?}, expected {expected:?}",
                            field.name, field.data_type
                        )
                    })
                })
                .collect();
            let count_ok = result.fields.len() == TYPES_EXPECTED.len();
            if mismatches.is_empty() && count_ok {
                (
                    true,
                    format!("{} columns in {ms:.1} ms", result.fields.len()),
                )
            } else {
                let mut detail = mismatches.join("; ");
                if !count_ok {
                    detail.push_str(&format!(
                        " ({} columns, expected {})",
                        result.fields.len(),
                        TYPES_EXPECTED.len()
                    ));
                }
                (false, detail)
            }
        }
        Err(error) => (false, error.to_string()),
    };
    Check {
        name: "types",
        ok,
        detail,
        ms: Some(ms),
    }
}

async fn cancel(engine: &Engine) -> Check {
    let (id, result) = engine.query(LONG_SQL);
    let _ = sleep(RUN_BEFORE_CANCEL_MS).await;
    let cancelled_at = now();
    engine.cancel(id);
    let result = result.await;
    let stop_ms = now() - cancelled_at;

    let next_started = now();
    let (_, next) = engine.query(WARM_UP_SQL);
    let next = next.await;
    let next_ms = now() - next_started;
    let next_ok = matches!(
        next.as_ref().map(|r| r.value(0, 0)),
        Ok(Some(Value::Int(42)))
    );

    let (ok, detail) = match result {
        Err(EngineError::Cancelled) => (
            stop_ms <= CANCEL_BUDGET_MS && next_ok,
            format!(
                "stopped in {stop_ms:.1} ms; next query {} in {next_ms:.1} ms",
                if next_ok { "ok" } else { "FAILED" }
            ),
        ),
        Ok(_) => (false, "finished before it was cancelled".into()),
        Err(error) => (false, format!("failed instead of cancelling: {error}")),
    };
    Check {
        name: "cancel",
        ok,
        detail,
        ms: Some(stop_ms),
    }
}

fn sleep(ms: i32) -> JsFuture {
    JsFuture::from(Promise::new(&mut |resolve, _| {
        if let Some(window) = web_sys::window() {
            let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, ms);
        }
    }))
}

/// `globalThis.__tychoSelftest = { ok, checks: [{ name, ok, detail, ms }] }`.
fn publish(checks: &[Check]) {
    let set = |target: &JsValue, key: &str, value: JsValue| {
        let _ = Reflect::set(target, &key.into(), &value);
    };
    let report: JsValue = Object::new().into();
    set(&report, "ok", checks.iter().all(|check| check.ok).into());
    let list = Array::new();
    for check in checks {
        let entry: JsValue = Object::new().into();
        set(&entry, "name", check.name.into());
        set(&entry, "ok", check.ok.into());
        set(&entry, "detail", check.detail.as_str().into());
        set(&entry, "ms", check.ms.map_or(JsValue::NULL, JsValue::from));
        list.push(&entry);
    }
    set(&report, "checks", list.unchecked_into());
    set(&js_sys::global().into(), "__tychoSelftest", report);
}
