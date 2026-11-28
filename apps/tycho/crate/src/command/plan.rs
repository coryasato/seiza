//! An action checked against the open file, all or none (`docs/DECISIONS.md`,
//! "Scope", 2026-11-21, "A pasted action waits for Enter, always, and its
//! steps run all or none"): every step is run on a copy of the controller,
//! in order, and the first that can't run refuses the whole action, saying
//! which step and why.

use std::fmt;

use seiza_duckdb::sql::ColumnInfo;

use super::{Clear, Given, Name, Step, list, quote, value_written, values_written};
use crate::dataset::format_count;
use crate::filter::{Arity, Filter, FilterRefused, Kind, Op, Values};
use crate::view::{Controller, HideRefused, PinRefused};

/// What an action is checked against: the open file's view, and whether
/// its rows are still loading (a CSV).
#[derive(Debug, Clone, PartialEq)]
pub struct Catalog {
    pub view: Controller,
    pub loading: bool,
    /// Each column's line in the bar's list where the profile knows it
    /// (`Profiling::lines`), by name: else its type.
    pub lines: std::collections::HashMap<String, String>,
    /// Each column's bins' range where the profile has bins of the rows in
    /// view (`Profiling::spans`), by name: the filter editor's bars.
    pub spans: std::collections::HashMap<String, (f64, f64)>,
}

/// A step that will run: its command line, the file's names in it, and its
/// plain words.
#[derive(Debug, Clone, PartialEq)]
pub struct Checked {
    pub line: String,
    pub words: String,
    /// The step as an agent writes it, the file's names in it
    /// (`{"pin": {"column": "mag"}}`): what the bar shows a command
    /// becomes.
    pub json: serde_json::Value,
    /// The column a `pin` step pins (its index in the file): the workbench
    /// refuses the action if the table can't draw it pinned.
    pub pins: Option<usize>,
}

/// An action that runs: the view after it, the row to bring into view, and
/// each step.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub view: Controller,
    /// The view differs from the one it was checked against.
    pub changed: bool,
    /// 0-based: the last `jump`'s row.
    pub jump: Option<u64>,
    /// The last `find`'s term.
    pub find: Option<String>,
    /// A catalog entry's question, asked on its own: the workbench reads
    /// its answer.
    pub ask: Option<Ask>,
    pub steps: Vec<Checked>,
}

/// A catalog entry's question of one column, checked.
#[derive(Debug, Clone, PartialEq)]
pub struct Ask {
    pub entry: &'static crate::catalog::Entry,
    /// Its index in the file.
    pub column: usize,
    /// The column's name as a command writes it.
    pub shown: String,
    /// `top`'s count; 0 for an entry with none.
    pub count: u64,
}

/// Why an action doesn't run: nothing of it does.
#[derive(Debug, Clone, PartialEq)]
pub struct Refusal {
    /// The step (0-based) and the action's count, for an action of several.
    pub step: Option<(usize, usize)>,
    /// The step as written.
    pub written: String,
    pub why: String,
    /// A fault, rather than an answer (a column already on that side).
    pub error: bool,
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.step {
            None => f.write_str(&self.why),
            Some((step, of)) => write!(
                f,
                "Step {} of {of}, {}: {} Nothing ran.",
                step + 1,
                self.written,
                self.why
            ),
        }
    }
}

/// Runs `steps` on a copy of `catalog`'s view, or says which can't run.
/// `undo` runs on its own (the workbench takes it from the log), so here
/// it's refused in an action of several and a no-op alone.
pub fn plan(steps: &[Step], catalog: &Catalog) -> Result<Plan, Refusal> {
    let mut view = catalog.view.clone();
    let mut jump = None;
    let mut find = None;
    let mut ask = None;
    let mut checked = Vec::with_capacity(steps.len());
    let several = steps.len() > 1;
    for (index, step) in steps.iter().enumerate() {
        let refuse = |why: String, error: bool| Refusal {
            step: several.then_some((index, steps.len())),
            written: step.written(),
            why,
            error,
        };
        match step {
            Step::Pin(name) | Step::Unpin(name) => {
                let pin = matches!(step, Step::Pin(_));
                let column = resolve(name, view.columns()).map_err(|why| refuse(why, true))?;
                let shown = quote(&view.columns()[column].name);
                let verb = if pin { "pin" } else { "unpin" };
                // A hidden column pinned would change nothing on screen.
                if pin && view.is_hidden(column) {
                    return Err(refuse(
                        format!("{shown} is hidden: show it, then pin it."),
                        false,
                    ));
                }
                let result = if pin {
                    view.pin(column)
                } else {
                    view.unpin(column)
                };
                match result {
                    Ok(()) => checked.push(Checked {
                        line: format!("{verb} {shown}"),
                        words: format!("{} {shown}", if pin { "Pin" } else { "Unpin" }),
                        json: serde_json::json!({ verb: { "column": view.columns()[column].name } }),
                        pins: pin.then_some(column),
                    }),
                    Err(PinRefused::AlreadyPinned) => {
                        return Err(refuse(format!("{shown} is pinned already."), false));
                    }
                    Err(PinRefused::NotPinned) => {
                        return Err(refuse(format!("{shown} isn't pinned."), false));
                    }
                }
            }
            Step::Hide(names) | Step::Show(names) => {
                let hide = matches!(step, Step::Hide(_));
                let mut columns: Vec<usize> = Vec::with_capacity(names.len());
                for name in names {
                    let column = resolve(name, view.columns()).map_err(|why| refuse(why, true))?;
                    // A column named twice is hidden once.
                    if !columns.contains(&column) {
                        columns.push(column);
                    }
                }
                let shown: Vec<String> = columns
                    .iter()
                    .map(|&column| quote(&view.columns()[column].name))
                    .collect();
                // Checked before any name is answered, so the reply is the
                // same whatever the order, naming the columns still shown.
                let still: Vec<&str> = columns
                    .iter()
                    .zip(&shown)
                    .filter(|&(&column, _)| !view.is_hidden(column))
                    .map(|(_, name)| name.as_str())
                    .collect();
                let none_left = format!(
                    "Hiding {} would leave no column shown.",
                    list(still.iter().copied(), "and")
                );
                if hide && !still.is_empty() && still.len() >= view.shown() {
                    return Err(refuse(none_left, true));
                }
                for (&column, name) in columns.iter().zip(&shown) {
                    let result = if hide {
                        view.hide(column)
                    } else {
                        view.show(column)
                    };
                    match result {
                        Ok(()) => {}
                        Err(HideRefused::AlreadyHidden) => {
                            return Err(refuse(format!("{name} is hidden already."), false));
                        }
                        Err(HideRefused::NotHidden) => {
                            return Err(refuse(format!("{name} isn't hidden."), false));
                        }
                        Err(HideRefused::LastShown) => return Err(refuse(none_left, true)),
                    }
                }
                let verb = if hide { "hide" } else { "show" };
                let names: Vec<&str> = columns
                    .iter()
                    .map(|&column| view.columns()[column].name.as_str())
                    .collect();
                checked.push(Checked {
                    line: format!("{verb} {}", shown.join(", ")),
                    words: format!(
                        "{} {}",
                        if hide { "Hide" } else { "Show" },
                        list(shown.iter().map(String::as_str), "and")
                    ),
                    json: serde_json::json!({ verb: names }),
                    pins: None,
                });
            }
            Step::ShowAll => {
                let hidden: Vec<usize> = (0..view.columns().len())
                    .filter(|&column| view.is_hidden(column))
                    .collect();
                if hidden.is_empty() {
                    return Err(refuse("No column is hidden.".into(), false));
                }
                for &column in &hidden {
                    let _ = view.show(column);
                }
                checked.push(Checked {
                    line: "show all".into(),
                    words: match hidden.len() {
                        1 => format!(
                            "Show {}, the one hidden column",
                            quote(&view.columns()[hidden[0]].name)
                        ),
                        count => format!("Show all {count} hidden columns"),
                    },
                    json: serde_json::json!({ "show": "all" }),
                    pins: None,
                });
            }
            Step::Jump(written) => {
                let rows = view.view().source.rows;
                match crate::jump::parse(written, rows, catalog.loading) {
                    Ok(Some(row)) => {
                        jump = Some(row);
                        checked.push(Checked {
                            line: format!("jump {}", row + 1),
                            words: format!("Jump to row {}", format_count(row + 1)),
                            json: serde_json::json!({ "jump": { "row": row + 1 } }),
                            pins: None,
                        });
                    }
                    Ok(None) => {
                        return Err(refuse(
                            "jump takes a row's number: jump 1,204.".into(),
                            true,
                        ));
                    }
                    Err(refusal) => return Err(refuse(refusal.message(), true)),
                }
            }
            Step::Filter { column, op, value } => {
                if catalog.loading {
                    return Err(refuse(loading(), false));
                }
                let index = resolve(column, view.columns()).map_err(|why| refuse(why, true))?;
                let info = view.columns()[index].clone();
                let kind = Kind::of(&info);
                let shown = quote(&info.name);
                let value = match value {
                    Given::Json(values) => values.clone(),
                    Given::Typed(words) => {
                        let mut values = words
                            .iter()
                            .map(|word| crate::filter::typed_value(&info, word));
                        match op.arity() {
                            Arity::None => Values::None,
                            Arity::One => values.next().map_or(Values::None, Values::One),
                            Arity::Two | Arity::List => Values::Many(values.collect()),
                        }
                    }
                };
                let filter = Filter {
                    column: info.name.clone(),
                    op: *op,
                    value,
                };
                if let Err(why) = filter.sql(&info) {
                    return Err(refuse(filter_refused(&why, &shown, kind), true));
                }
                match view.add_filter(filter.clone()) {
                    Ok(true) => {}
                    Ok(false) => {
                        return Err(refuse("That filter is in the view already.".into(), false));
                    }
                    Err(refused) => return Err(refuse(sentence(&refused.to_string()), true)),
                }
                let values = filter_values(&filter);
                let spoken = match (op.arity(), values.as_slice()) {
                    (_, []) => String::new(),
                    (Arity::Two, [low, high]) => format!(" {low} and {high}"),
                    (_, values) => format!(" {}", values.join(", ")),
                };
                checked.push(Checked {
                    line: format!("filter {shown} {op}{}", values_written(*op, &values)),
                    words: format!("Keep rows where {shown} {}{spoken}", op.words(kind)),
                    json: serde_json::json!({ "filter": filter }),
                    pins: None,
                });
            }
            Step::Sort { column, direction } => {
                if catalog.loading {
                    return Err(refuse(loading(), false));
                }
                if let Some(why) = view.sort_refusal() {
                    return Err(refuse(sentence(why), false));
                }
                let index = resolve(column, view.columns()).map_err(|why| refuse(why, true))?;
                let info = &view.columns()[index];
                let shown = quote(&info.name);
                let direction = direction.unwrap_or_else(|| crate::filter::first_direction(info));
                let words = Kind::of(info).order_words(direction);
                if view.sort() == Some((index, direction)) {
                    return Err(refuse(
                        format!("The rows are sorted by {shown}, {words}, already."),
                        false,
                    ));
                }
                let name = info.name.clone();
                view.set_sort(Some((index, direction)));
                checked.push(Checked {
                    line: format!("sort {shown} {}", direction.as_str()),
                    words: format!("Sort by {shown}, {words}"),
                    json: serde_json::json!({ "sort": { "column": name, "direction": direction } }),
                    pins: None,
                });
            }
            Step::Clear(clear) => {
                let filters = view.filters().len();
                let sorted = view.sort().is_some();
                let count = |count: usize| match count {
                    1 => "the filter".to_owned(),
                    count => format!("{count} filters"),
                };
                let (line, words, json) = match clear {
                    Clear::Filter(name) => {
                        let index =
                            resolve(name, view.columns()).map_err(|why| refuse(why, true))?;
                        let name = view.columns()[index].name.clone();
                        let shown = quote(&name);
                        let removed = view.remove_filters(|filter| filter.column != name);
                        if removed == 0 {
                            return Err(refuse(format!("No filter is on {shown}."), false));
                        }
                        (
                            format!("clear filter {shown}"),
                            format!("Clear {} on {shown}", count(removed)),
                            serde_json::json!({ "clear": { "filter": name } }),
                        )
                    }
                    Clear::Filters => {
                        if filters == 0 {
                            return Err(refuse("No filter to clear.".into(), false));
                        }
                        view.remove_filters(|_| false);
                        (
                            "clear filters".to_owned(),
                            format!("Clear {}", count(filters)),
                            serde_json::json!({ "clear": "filters" }),
                        )
                    }
                    Clear::Sort => {
                        if !sorted {
                            return Err(refuse("The rows aren't sorted.".into(), false));
                        }
                        view.set_sort(None);
                        (
                            "clear sort".to_owned(),
                            "Clear the sort".to_owned(),
                            serde_json::json!({ "clear": "sort" }),
                        )
                    }
                    Clear::All => {
                        let words = match (filters, sorted) {
                            (0, false) => {
                                return Err(refuse("No filter or sort to clear.".into(), false));
                            }
                            (0, true) => "Clear the sort".to_owned(),
                            (filters, false) => format!("Clear {}", count(filters)),
                            (filters, true) => format!("Clear {} and the sort", count(filters)),
                        };
                        view.remove_filters(|_| false);
                        view.set_sort(None);
                        (
                            "clear all".to_owned(),
                            words,
                            serde_json::json!({ "clear": "all" }),
                        )
                    }
                };
                checked.push(Checked {
                    line,
                    words,
                    json,
                    pins: None,
                });
            }
            Step::Find(term) => {
                let term = term.trim();
                if term.is_empty() {
                    return Err(refuse(
                        "find takes the text to look for: find starlink.".into(),
                        true,
                    ));
                }
                if term.contains('\0') {
                    return Err(refuse(
                        "Find's text can't hold a NUL character.".into(),
                        true,
                    ));
                }
                find = Some(term.to_owned());
                checked.push(Checked {
                    line: format!("find {}", quote(term)),
                    words: format!("Find {}", quote(term)),
                    json: serde_json::json!({ "find": { "text": term } }),
                    pins: None,
                });
            }
            Step::Ask { .. } if several => {
                return Err(refuse(
                    "A question runs on its own, not in an action of several: its answer goes in the log.".into(),
                    true,
                ));
            }
            Step::Ask {
                entry,
                column,
                count,
            } => {
                if catalog.loading {
                    return Err(refuse(loading(), false));
                }
                let index = resolve(column, view.columns()).map_err(|why| {
                    // `top launch 2` of a column named `launch 2`: the
                    // name's last word read as the count. Said, with the
                    // quotes that ask for the column.
                    let whole = count.as_ref().and_then(|count| {
                        let name = Name {
                            text: format!("{} {count}", column.text),
                            spaced: true,
                        };
                        resolve(&name, view.columns()).ok()
                    });
                    match whole {
                        Some(index) => refuse(
                            format!(
                                "No column {}. A name that ends in a number goes in double quotes: {} {}.",
                                quote(&column.text),
                                entry.name,
                                quote(&view.columns()[index].name)
                            ),
                            true,
                        ),
                        None => refuse(why, true),
                    }
                })?;
                let info = &view.columns()[index];
                let shown = quote(&info.name);
                let kind = Kind::of(info);
                if !entry.takes(kind) {
                    return Err(refuse(entry.refusal(&shown, kind), true));
                }
                let Some(count) = entry.count_of(count.as_deref()) else {
                    let most = entry.count_part().map_or(0, |(_, most)| most);
                    return Err(refuse(
                        format!(
                            "{} takes a count from 1 to {most}: {}.",
                            entry.name, entry.example
                        ),
                        true,
                    ));
                };
                let mut json = serde_json::json!({ "column": info.name });
                let mut line = format!("{} {shown}", entry.name);
                if entry
                    .count_part()
                    .is_some_and(|(default, _)| default != count)
                {
                    json["count"] = count.into();
                    line.push_str(&format!(" {count}"));
                }
                checked.push(Checked {
                    line,
                    words: entry.words(&shown, Some(count)),
                    json: serde_json::json!({ entry.name: json }),
                    pins: None,
                });
                ask = Some(Ask {
                    entry,
                    column: index,
                    shown,
                    count,
                });
            }
            Step::Undo if several => {
                return Err(refuse(
                    "undo runs on its own, not in an action of several.".into(),
                    true,
                ));
            }
            Step::Undo => checked.push(Checked {
                line: "undo".into(),
                words: "Undo".into(),
                json: serde_json::json!({ "undo": {} }),
                pins: None,
            }),
        }
    }
    let changed = view != catalog.view;
    Ok(Plan {
        view,
        changed,
        jump,
        find,
        ask,
        steps: checked,
    })
}

/// What a filter or a sort of a CSV still loading is answered.
fn loading() -> String {
    format!("{}.", crate::table::LOADING)
}

/// `text` as a sentence: its first letter capital, a period after it.
fn sentence(text: &str) -> String {
    let text = text.trim_end_matches('.');
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => format!("{}{}.", first.to_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

/// A filter's values as a command writes them.
fn filter_values(filter: &Filter) -> Vec<String> {
    match &filter.value {
        Values::None => Vec::new(),
        Values::One(value) => vec![value_written(value)],
        Values::Many(values) => values.iter().map(value_written).collect(),
    }
}

/// Why a filter can't apply to column `shown`, which holds `kind`, said
/// with what it takes.
fn filter_refused(why: &FilterRefused, shown: &str, kind: Kind) -> String {
    match why {
        FilterRefused::Op { op, .. } => format!(
            "{op} doesn't apply to {shown}, which holds {}: it takes {}.",
            kind.name(),
            list(kind.ops().map(Op::as_str), "or")
        ),
        FilterRefused::Values { .. } => sentence(&why.to_string()),
        FilterRefused::Value { value, .. } => match kind {
            Kind::Number => format!("{value} isn't a number, and {shown} holds numbers."),
            Kind::Time => format!(
                "{value} isn't a time {shown} holds: write a date as 1990-01-31, a time as 1990-01-31T12:30."
            ),
            Kind::Boolean => format!("{shown} holds true or false, and {value} is neither."),
            Kind::Text => format!("{shown} holds text: write the value in quotes."),
        },
        FilterRefused::Nul => "A value can't hold a NUL character.".into(),
    }
}

/// The file's column `name` names: written as the file does, else the one
/// matching without regard to case. A name that's no column is answered
/// with the nearest ones.
pub fn resolve(name: &Name, columns: &[ColumnInfo]) -> Result<usize, String> {
    if let Some(index) = columns.iter().position(|info| info.name == name.text) {
        return Ok(index);
    }
    let folded: Vec<usize> = (0..columns.len())
        .filter(|&index| columns[index].name.to_lowercase() == name.text.to_lowercase())
        .collect();
    match folded.as_slice() {
        [one] => return Ok(*one),
        [] => {}
        many => {
            return Err(format!(
                "{} matches {}: write it as the file does.",
                quote(&name.text),
                list(
                    many.iter().map(|&index| columns[index].name.as_str()),
                    "and"
                )
            ));
        }
    }
    let near = nearest(&name.text, columns);
    let shown = quote(&name.text);
    Err(match (near.is_empty(), name.spaced) {
        (false, _) => format!(
            "No column {shown}. Did you mean {}?",
            list(near.iter().map(String::as_str), "or")
        ),
        (true, true) => format!(
            "No column {shown}. A command takes one column, and a name with a space goes in double quotes."
        ),
        (true, false) => format!("No column {shown} in this file."),
    })
}

/// Up to three of the file's names nearest `name`, as they're typed: those
/// that hold it or that it holds, then those a few edits from it.
pub fn nearest(name: &str, columns: &[ColumnInfo]) -> Vec<String> {
    let needle = name.to_lowercase();
    let length = needle.chars().count();
    let mut scored: Vec<(bool, usize, usize)> = columns
        .iter()
        .enumerate()
        .filter_map(|(index, info)| {
            let candidate = info.name.to_lowercase();
            let holds = length >= 2 && (candidate.contains(&needle) || needle.contains(&candidate));
            let edits = super::distance(&needle, &candidate);
            let near = edits <= 1 + length / 4;
            (holds || near).then_some((!holds, edits, index))
        })
        .collect();
    scored.sort();
    scored
        .into_iter()
        .take(3)
        .map(|(_, _, index)| quote(&columns[index].name))
        .collect()
}

/// The answer to a sentence (`docs/DECISIONS.md`, "Scope", 2026-11-24).
pub const SENTENCE: &str = "Tycho reads commands, not sentences.";

/// The answer to `open`: another file opens from the bar's list.
pub const OPEN: &str = "Another file opens from the list: choose one, or the sample.";

/// The answer to a command before a file is open.
pub const NO_FILE: &str =
    "Open a file first: choose one, drop one on the page, or open the sample.";

/// The answer to a verb not built yet.
pub fn later(verb: &str, goal: &str, step: Option<usize>) -> String {
    let at = step.map_or(String::new(), |step| format!("Step {}: ", step + 1));
    format!("{at}{verb} isn't in Tycho yet: it comes with {goal}.")
}

impl Plan {
    /// The first `pin` step whose column the table doesn't draw pinned,
    /// once the plan is applied: `drawn` leading columns are, of `view`'s
    /// order (the table's run in effect, cut where the pinned columns would
    /// pass half its width).
    pub fn undrawn_pin(&self, view: &Controller, drawn: usize) -> Option<Refusal> {
        let several = self.steps.len() > 1;
        self.steps.iter().enumerate().find_map(|(index, step)| {
            let column = step.pins?;
            (view.is_pinned(column) && view.place(column) >= drawn).then(|| Refusal {
                step: several.then_some((index, self.steps.len())),
                written: step.line.clone(),
                why: format!(
                    "{} can't be pinned here: the pinned columns would take more than half the table's width.",
                    quote(&view.columns()[column].name)
                ),
                error: false,
            })
        })
    }

    /// The action as an agent writes it: one step alone, several under
    /// `"actions"` (the form `parse` reads).
    pub fn json(&self) -> String {
        match self.steps.as_slice() {
            [one] => one.json.to_string(),
            steps => serde_json::json!({
                "actions": steps.iter().map(|step| step.json.clone()).collect::<Vec<_>>()
            })
            .to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{Parsed, parse};
    use crate::view::{SourceKind, SourceView};

    fn catalog(loading: bool) -> Catalog {
        let file = [
            ColumnInfo::new("id", "BIGINT"),
            ColumnInfo::new("launch date", "DATE"),
            ColumnInfo::new("mag", "DOUBLE"),
            ColumnInfo::new("magType", "VARCHAR"),
            ColumnInfo::new("place", "VARCHAR"),
        ];
        Catalog {
            view: Controller::of_file(
                SourceView {
                    kind: SourceKind::Csv,
                    name: "quakes.csv".into(),
                    rows: 25_000,
                },
                &file,
            ),
            loading,
            lines: Default::default(),
            spans: Default::default(),
        }
    }

    fn run(text: &str, catalog: &Catalog) -> Result<Plan, Refusal> {
        match parse(text) {
            Parsed::Action { steps, .. } => plan(&steps, catalog),
            other => panic!("{text:?} read as {other:?}"),
        }
    }

    fn names(view: &Controller) -> Vec<&str> {
        view.order()
            .iter()
            .map(|&index| view.columns()[index].name.as_str())
            .collect()
    }

    #[test]
    fn a_pin_the_table_cant_draw_is_named() {
        let catalog = catalog(false);
        let plan = run("pin mag", &catalog).unwrap();
        // The table draws the one pinned column: nothing to refuse.
        assert_eq!(plan.undrawn_pin(&plan.view, 1), None);
        // It draws none: the pin is refused, by name.
        let refusal = plan.undrawn_pin(&plan.view, 0).unwrap();
        assert_eq!(
            refusal.to_string(),
            "mag can't be pinned here: the pinned columns would take more than half the table's width."
        );
        // Of several, the step that pinned the undrawn column is named;
        // a jump pins nothing.
        let plan = run(
            r#"{"actions": [{"pin": {"column": "mag"}}, {"jump": {"row": 2}}, {"pin": {"column": "place"}}]}"#,
            &catalog,
        )
        .unwrap();
        assert_eq!(plan.undrawn_pin(&plan.view, 2), None);
        let refusal = plan.undrawn_pin(&plan.view, 1).unwrap();
        assert_eq!(refusal.step, Some((2, 3)));
        assert!(
            refusal
                .to_string()
                .starts_with("Step 3 of 3, pin place: place can't")
        );
        assert!(!refusal.error);
    }

    #[test]
    fn pin_and_unpin_cross_the_runs_edge() {
        let mut catalog = catalog(false);
        let plan = run("pin mag", &catalog).unwrap();
        assert_eq!(
            names(&plan.view),
            ["mag", "id", "launch date", "magType", "place"]
        );
        assert_eq!(plan.view.pinned(), 1);
        assert_eq!(plan.steps[0].words, "Pin mag");
        catalog.view = plan.view;
        // The end of the run, one more pinned.
        let plan = run("pin PLACE", &catalog).unwrap();
        assert_eq!(
            names(&plan.view),
            ["mag", "place", "id", "launch date", "magType"]
        );
        assert_eq!(plan.view.pinned(), 2);
        assert_eq!(plan.steps[0].line, "pin place");
        catalog.view = plan.view;
        // Just past the run, one fewer.
        let plan = run("unpin mag", &catalog).unwrap();
        assert_eq!(
            names(&plan.view),
            ["place", "mag", "id", "launch date", "magType"]
        );
        assert_eq!(plan.view.pinned(), 1);
        // A column already on that side is answered, not moved.
        let refusal = run("pin place", &catalog).unwrap_err();
        assert_eq!(refusal.to_string(), "place is pinned already.");
        assert!(!refusal.error);
        assert_eq!(
            run("unpin id", &catalog).unwrap_err().to_string(),
            "id isn't pinned."
        );
    }

    #[test]
    fn names_are_matched_and_the_nearest_offered() {
        let catalog = catalog(false);
        assert_eq!(
            run(r#"pin "launch date""#, &catalog).unwrap().steps[0].words,
            r#"Pin "launch date""#
        );
        // Bare words read as one name the file has.
        assert!(run("pin Launch Date", &catalog).is_ok());
        assert_eq!(
            run("pin magtyp", &catalog).unwrap_err().why,
            "No column magtyp. Did you mean magType or mag?"
        );
        assert_eq!(
            run("pin launch", &catalog).unwrap_err().why,
            r#"No column launch. Did you mean "launch date"?"#
        );
        assert_eq!(
            run("pin zzzz", &catalog).unwrap_err().why,
            "No column zzzz in this file."
        );
        assert_eq!(
            run("pin the first column", &catalog).unwrap_err().why,
            r#"No column "the first column". A command takes one column, and a name with a space goes in double quotes."#
        );
        // Two names alike but for case: the one written as the file does,
        // else which.
        let file = [
            ColumnInfo::new("Mag", "DOUBLE"),
            ColumnInfo::new("MAG", "DOUBLE"),
        ];
        let name = |text: &str| Name {
            text: text.into(),
            spaced: false,
        };
        assert_eq!(resolve(&name("MAG"), &file), Ok(1));
        assert_eq!(
            resolve(&name("mag"), &file),
            Err("mag matches Mag and MAG: write it as the file does.".into())
        );
    }

    #[test]
    fn all_or_none() {
        let catalog = catalog(false);
        let action = r#"{"actions": [{"pin": {"column": "mag"}}, {"pin": {"column": "depth"}}]}"#;
        let refusal = run(action, &catalog).unwrap_err();
        assert_eq!(refusal.step, Some((1, 2)));
        assert_eq!(
            refusal.to_string(),
            "Step 2 of 2, pin depth: No column depth in this file. Nothing ran."
        );
        // Each step is checked against the view the ones before it leave.
        let twice = r#"{"actions": [{"pin": {"column": "mag"}}, {"pin": {"column": "mag"}}]}"#;
        assert_eq!(run(twice, &catalog).unwrap_err().step, Some((1, 2)));
        let both = r#"{"actions": [{"pin": {"column": "mag"}}, {"jump": {"row": 100}}]}"#;
        let plan = run(both, &catalog).unwrap();
        assert!(plan.changed);
        assert_eq!(plan.jump, Some(99));
        assert_eq!(
            plan.steps
                .iter()
                .map(|step| step.words.as_str())
                .collect::<Vec<_>>(),
            ["Pin mag", "Jump to row 100"]
        );
        let undo = r#"{"actions": [{"pin": {"column": "mag"}}, {"undo": {}}]}"#;
        assert_eq!(
            run(undo, &catalog).unwrap_err().why,
            "undo runs on its own, not in an action of several."
        );
    }

    #[test]
    fn hide_and_show_all_or_none() {
        let mut catalog = catalog(false);
        let plan = run("hide mag, PLACE, mag", &catalog).unwrap();
        assert!(plan.view.is_hidden(2) && plan.view.is_hidden(4));
        assert_eq!(plan.view.shown(), 3);
        // The file's names, a column named twice once.
        assert_eq!(plan.steps[0].line, "hide mag, place");
        assert_eq!(plan.steps[0].words, "Hide mag and place");
        assert_eq!(plan.json(), r#"{"hide":["mag","place"]}"#);
        // The order and the pins stay.
        assert_eq!(names(&plan.view), names(&catalog.view));
        catalog.view = plan.view;
        // A hidden column named again: answered, nothing of it runs.
        let refusal = run("hide id, mag", &catalog).unwrap_err();
        assert_eq!(refusal.to_string(), "mag is hidden already.");
        assert!(!refusal.error);
        assert_eq!(
            run("show id", &catalog).unwrap_err().to_string(),
            "id isn't hidden."
        );
        assert_eq!(
            run("hide nope", &catalog).unwrap_err().why,
            "No column nope in this file."
        );
        // A hidden column isn't pinned.
        let refusal = run("pin mag", &catalog).unwrap_err();
        assert_eq!(refusal.why, "mag is hidden: show it, then pin it.");
        assert!(!refusal.error);
        // The last columns shown stay, named alike whatever the order, the
        // hidden ones left out.
        for action in [
            "hide id, \"launch date\", magType, mag",
            "hide mag, id, \"launch date\", magType",
        ] {
            assert_eq!(
                run(action, &catalog).unwrap_err().why,
                r#"Hiding id, "launch date", and magType would leave no column shown."#,
                "{action}"
            );
        }
        let refusal = run(r#"hide id, "launch date", magType"#, &catalog).unwrap_err();
        assert_eq!(
            refusal.why,
            r#"Hiding id, "launch date", and magType would leave no column shown."#
        );
        assert!(refusal.error);
        assert!(run(r#"hide id, "launch date""#, &catalog).is_ok());
        // Typed and pasted read to the same steps.
        let typed = run("show mag", &catalog).unwrap();
        let pasted = run(r#"{"show": ["mag"]}"#, &catalog).unwrap();
        assert_eq!(typed, pasted);
        assert_eq!(typed.steps[0].words, "Show mag");
        let all = run("show all", &catalog).unwrap();
        assert_eq!(all.view.shown(), 5);
        assert_eq!(all.steps[0].words, "Show all 2 hidden columns");
        assert_eq!(all.json(), r#"{"show":"all"}"#);
        catalog.view = typed.view;
        assert_eq!(
            run("show all", &catalog).unwrap().steps[0].words,
            "Show place, the one hidden column"
        );
        catalog.view = all.view;
        assert_eq!(
            run("show all", &catalog).unwrap_err().to_string(),
            "No column is hidden."
        );
        // Each step on the view the ones before it leave.
        let both = r#"{"actions": [{"hide": ["mag"]}, {"show": ["mag"]}]}"#;
        assert!(!run(both, &catalog).unwrap().changed);
    }

    #[test]
    fn filters_are_typed_by_their_column_and_worded() {
        let mut catalog = catalog(false);
        let plan = run("filter mag >= 4.5", &catalog).unwrap();
        let step = &plan.steps[0];
        assert_eq!(step.line, "filter mag >= 4.5");
        assert_eq!(step.words, "Keep rows where mag is at least 4.5");
        assert_eq!(
            plan.json(),
            r#"{"filter":{"column":"mag","op":">=","value":4.5}}"#
        );
        assert_eq!(plan.view.filters().len(), 1);
        assert!(plan.changed);
        // Typed and pasted read to the same plan.
        assert_eq!(
            run(
                r#"{"filter": {"column": "MAG", "op": ">=", "value": 4.5}}"#,
                &catalog
            )
            .unwrap(),
            plan
        );
        let words =
            |text: &str, catalog: &Catalog| run(text, catalog).unwrap().steps[0].words.clone();
        assert_eq!(
            words(
                r#"filter "launch date" between 1990-01-01 and 1999-12-31"#,
                &catalog
            ),
            r#"Keep rows where "launch date" is between 1990-01-01 and 1999-12-31"#
        );
        assert_eq!(
            words(r#"filter "launch date" < 1957-10-04"#, &catalog),
            r#"Keep rows where "launch date" is before 1957-10-04"#
        );
        assert_eq!(
            words("filter magType in mb, mww", &catalog),
            "Keep rows where magType is any of mb, mww"
        );
        assert_eq!(
            words(r#"filter place contains "of Alaska""#, &catalog),
            r#"Keep rows where place contains "of Alaska""#
        );
        assert_eq!(
            words("filter place is null", &catalog),
            "Keep rows where place has no value"
        );
        // Text that reads as a number is text in a text column.
        let plan = run("filter magType = 42", &catalog).unwrap();
        assert_eq!(
            plan.json(),
            r#"{"filter":{"column":"magType","op":"=","value":"42"}}"#
        );
        assert_eq!(plan.steps[0].line, "filter magType = 42");
        // A filter already in the view is an answer.
        catalog.view = run("filter mag >= 4.5", &catalog).unwrap().view;
        let again = run("filter mag >= 4.5", &catalog).unwrap_err();
        assert_eq!(again.why, "That filter is in the view already.");
        assert!(!again.error);
        // Another on the same column is added: filters combine with AND.
        assert_eq!(
            run("filter mag < 6", &catalog)
                .unwrap()
                .view
                .filters()
                .len(),
            2
        );
    }

    #[test]
    fn a_filter_its_column_cant_take_is_refused_with_why() {
        let catalog = catalog(false);
        let refused = |text: &str| {
            let refusal = run(text, &catalog).unwrap_err();
            assert!(refusal.error, "{text}");
            refusal.why
        };
        assert_eq!(
            refused("filter mag contains 4"),
            "contains doesn't apply to mag, which holds a number: it takes =, !=, >, >=, <, <=, in, between, is null, or not null."
        );
        assert_eq!(
            refused("filter place > a"),
            "> doesn't apply to place, which holds text: it takes =, !=, contains, starts, in, is null, or not null."
        );
        assert_eq!(
            refused("filter mag > big"),
            "big isn't a number, and mag holds numbers."
        );
        assert_eq!(
            refused("filter mag in 1, two"),
            "two isn't a number, and mag holds numbers."
        );
        assert_eq!(
            refused(r#"filter "launch date" > yesterday"#),
            r#"yesterday isn't a time "launch date" holds: write a date as 1990-01-31, a time as 1990-01-31T12:30."#
        );
        assert_eq!(
            refused(r#"{"filter": {"column": "place", "op": "=", "value": 5}}"#),
            "place holds text: write the value in quotes."
        );
        assert_eq!(
            refused(r#"{"filter": {"column": "mag", "op": "between", "value": 5}}"#),
            "Between takes two values."
        );
        assert_eq!(
            refused(r#"{"filter": {"column": "place", "op": "=", "value": "a\u0000b"}}"#),
            "A value can't hold a NUL character."
        );
        assert_eq!(
            refused("filter magtyp = mb"),
            "No column magtyp. Did you mean magType or mag?"
        );
        // A CSV still loading is neither filtered nor sorted: an answer.
        let loading = run("filter mag > 1", &self::catalog(true)).unwrap_err();
        assert_eq!(
            loading.why,
            "The file is still loading: sort and filter it once its rows are all in."
        );
        assert!(!loading.error);
        assert_eq!(
            run("sort mag", &self::catalog(true)).unwrap_err().why,
            loading.why
        );
    }

    #[test]
    fn sort_takes_its_types_first_direction() {
        let mut catalog = catalog(false);
        let plan = run("sort mag", &catalog).unwrap();
        assert_eq!(plan.view.sort(), Some((2, crate::filter::Direction::Desc)));
        assert_eq!(plan.steps[0].line, "sort mag desc");
        assert_eq!(plan.steps[0].words, "Sort by mag, largest first");
        assert_eq!(
            plan.json(),
            r#"{"sort":{"column":"mag","direction":"desc"}}"#
        );
        assert_eq!(
            run("sort place", &catalog).unwrap().steps[0].words,
            "Sort by place, A to Z"
        );
        assert_eq!(
            run(r#"sort "launch date" asc"#, &catalog).unwrap().steps[0].words,
            r#"Sort by "launch date", oldest first"#
        );
        catalog.view = plan.view;
        let again = run("sort mag desc", &catalog).unwrap_err();
        assert_eq!(
            again.why,
            "The rows are sorted by mag, largest first, already."
        );
        assert!(!again.error);
        // Another replaces it: one column at a time.
        let other = run("sort id asc", &catalog).unwrap();
        assert_eq!(other.view.sort(), Some((0, crate::filter::Direction::Asc)));
        // A file too large to sort says why.
        catalog.view = catalog
            .view
            .clone()
            .unsortable("Sorting reads the whole file".into());
        let refused = run("sort id", &catalog).unwrap_err();
        assert_eq!(refused.why, "Sorting reads the whole file.");
        assert!(!refused.error);
    }

    #[test]
    fn clear_removes_and_counts() {
        let mut catalog = catalog(false);
        let answer = |text: &str, catalog: &Catalog| {
            let refusal = run(text, catalog).unwrap_err();
            assert!(!refusal.error, "{text}");
            refusal.why
        };
        assert_eq!(answer("clear filters", &catalog), "No filter to clear.");
        assert_eq!(answer("clear sort", &catalog), "The rows aren't sorted.");
        assert_eq!(answer("clear all", &catalog), "No filter or sort to clear.");
        assert_eq!(answer("clear filter mag", &catalog), "No filter is on mag.");
        catalog.view = run(
            r#"{"actions": [{"filter": {"column": "mag", "op": ">", "value": 1}}, {"filter": {"column": "mag", "op": "<", "value": 6}}, {"filter": {"column": "place", "op": "not null"}}, {"sort": {"column": "id"}}]}"#,
            &catalog,
        )
        .unwrap()
        .view;
        let plan = run("clear filter MAG", &catalog).unwrap();
        assert_eq!(plan.steps[0].words, "Clear 2 filters on mag");
        assert_eq!(plan.steps[0].line, "clear filter mag");
        assert_eq!(plan.view.filters().len(), 1);
        assert_eq!(plan.json(), r#"{"clear":{"filter":"mag"}}"#);
        let plan = run("clear filters", &catalog).unwrap();
        assert_eq!(plan.steps[0].words, "Clear 3 filters");
        assert!(plan.view.filters().is_empty() && plan.view.sort().is_some());
        let plan = run("clear sort", &catalog).unwrap();
        assert_eq!(plan.steps[0].words, "Clear the sort");
        assert_eq!(plan.view.filters().len(), 3);
        let plan = run("clear all", &catalog).unwrap();
        assert_eq!(plan.steps[0].words, "Clear 3 filters and the sort");
        assert!(plan.view.filters().is_empty() && plan.view.sort().is_none());
        // Back to the file's own rows: the view is the opening's.
        assert_eq!(plan.view.view(), self::catalog(false).view.view());
    }

    #[test]
    fn find_takes_a_term_and_changes_no_view() {
        let catalog = catalog(false);
        let plan = run("find Alaska", &catalog).unwrap();
        assert!(!plan.changed);
        assert_eq!(plan.find.as_deref(), Some("Alaska"));
        assert_eq!(plan.steps[0].words, "Find Alaska");
        assert_eq!(plan.json(), r#"{"find":{"text":"Alaska"}}"#);
        let plan = run(r#"{"actions": [{"filter": {"column": "mag", "op": ">", "value": 1}}, {"find": "of Alaska"}]}"#, &catalog).unwrap();
        assert!(plan.changed);
        assert_eq!(plan.find.as_deref(), Some("of Alaska"));
        assert_eq!(plan.steps[1].line, r#"find "of Alaska""#);
        assert_eq!(
            run(r#"{"find": "  "}"#, &catalog).unwrap_err().why,
            "find takes the text to look for: find starlink."
        );
    }

    #[test]
    fn jump_reads_rows_as_jump_rs_does() {
        let plan = run("jump 1,204", &catalog(false)).unwrap();
        assert!(!plan.changed);
        assert_eq!(plan.jump, Some(1203));
        assert_eq!(plan.steps[0].line, "jump 1204");
        assert_eq!(plan.steps[0].words, "Jump to row 1,204");
        assert_eq!(
            run("jump 30000", &catalog(false)).unwrap_err().why,
            "No row 30,000: rows run from 1 to 25,000."
        );
        assert_eq!(
            run("jump 30000", &catalog(true)).unwrap_err().why,
            "No row 30,000: rows 1 to 25,000 are loaded so far."
        );
        assert_eq!(
            run("jump soon", &catalog(false)).unwrap_err().why,
            "Type a row number, like 1,000."
        );
    }

    #[test]
    fn a_question_is_checked_on_its_own_and_changes_no_view() {
        let catalog = catalog(false);
        let plan = run("top magType", &catalog).unwrap();
        assert!(!plan.changed);
        let ask = plan.ask.clone().unwrap();
        assert_eq!((ask.entry.name, ask.column, ask.count), ("top", 3, 5));
        assert_eq!(plan.steps[0].line, "top magType");
        assert_eq!(plan.steps[0].words, "The 5 most common values of magType");
        assert_eq!(plan.json(), r#"{"top":{"column":"magType"}}"#);
        let plan = run("top MAGTYPE 1,0", &catalog).unwrap();
        assert_eq!(plan.ask.as_ref().unwrap().count, 10);
        assert_eq!(plan.steps[0].line, "top magType 10");
        assert_eq!(plan.json(), r#"{"top":{"column":"magType","count":10}}"#);
        let plan = run(r#"{"nulls": {"column": "launch date"}}"#, &catalog).unwrap();
        assert_eq!(plan.steps[0].line, r#"nulls "launch date""#);
        assert_eq!(plan.steps[0].words, r#"Count the nulls in "launch date""#);
        assert_eq!(
            run("top mag 0", &catalog).unwrap_err().why,
            "top takes a count from 1 to 50: top orbit 10."
        );
        assert_eq!(
            run("top mag 51", &catalog).unwrap_err().why,
            "top takes a count from 1 to 50: top orbit 10."
        );
        assert_eq!(
            run("distinct magtyp", &catalog).unwrap_err().why,
            "No column magtyp. Did you mean magType or mag?"
        );
        let several = run(
            r#"{"actions": [{"pin": {"column": "mag"}}, {"nulls": {"column": "mag"}}]}"#,
            &catalog,
        )
        .unwrap_err();
        assert!(several.why.starts_with("A question runs on its own"));
        // A CSV still loading has rows to come: no exact answer yet.
        assert!(!run("nulls mag", &catalog_loading()).unwrap_err().error);
    }

    fn catalog_loading() -> Catalog {
        catalog(true)
    }

    #[test]
    fn a_name_ending_in_a_number_is_said_to_go_in_quotes() {
        let file = [
            ColumnInfo::new("launch 2", "VARCHAR"),
            ColumnInfo::new("place", "VARCHAR"),
        ];
        let catalog = Catalog {
            view: Controller::of_file(
                SourceView {
                    kind: SourceKind::Csv,
                    name: "launches.csv".into(),
                    rows: 10,
                },
                &file,
            ),
            loading: false,
            lines: Default::default(),
            spans: Default::default(),
        };
        let refusal = run("top launch 2", &catalog).unwrap_err();
        assert_eq!(
            refusal.why,
            r#"No column launch. A name that ends in a number goes in double quotes: top "launch 2"."#
        );
        assert!(run(r#"top "launch 2""#, &catalog).is_ok());
        assert!(run("top place 2", &catalog).is_ok());
    }

    #[test]
    fn a_question_of_a_type_its_entry_doesnt_take_is_refused_with_the_types_it_does() {
        static NUMBERS: crate::catalog::Entry = crate::catalog::Entry {
            which: crate::catalog::Which::Distinct,
            name: "spread",
            hint: "",
            takes: &[Kind::Number, Kind::Time],
            parts: &[],
            answers: crate::catalog::Answers::Log,
            example: "spread mag",
        };
        let step = Step::Ask {
            entry: &NUMBERS,
            column: Name {
                text: "place".into(),
                spaced: false,
            },
            count: None,
        };
        let refusal = plan(&[step], &catalog(false)).unwrap_err();
        assert!(refusal.error);
        assert_eq!(
            refusal.why,
            "spread doesn't apply to place, which holds text: it takes a number or a time."
        );
    }
}
