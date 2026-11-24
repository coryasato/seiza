//! An action checked against the open file, all or none (`docs/DECISIONS.md`,
//! "Scope", 2026-11-21, "A pasted action waits for Enter, always, and its
//! steps run all or none"): every step is run on a copy of the controller,
//! in order, and the first that can't run refuses the whole action, saying
//! which step and why.

use std::fmt;

use seiza_duckdb::sql::ColumnInfo;

use super::{Name, Step, list, quote};
use crate::dataset::format_count;
use crate::view::{Controller, PinRefused};

/// What an action is checked against: the open file's view, and whether
/// its rows are still loading (a CSV).
#[derive(Debug, Clone, PartialEq)]
pub struct Catalog {
    pub view: Controller,
    pub loading: bool,
}

/// A step that will run: its command line, the file's names in it, and its
/// plain words.
#[derive(Debug, Clone, PartialEq)]
pub struct Checked {
    pub line: String,
    pub words: String,
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
    pub steps: Vec<Checked>,
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
                let result = if pin {
                    view.pin(column)
                } else {
                    view.unpin(column)
                };
                match result {
                    Ok(()) => checked.push(Checked {
                        line: format!("{} {shown}", if pin { "pin" } else { "unpin" }),
                        words: format!("{} {shown}", if pin { "Pin" } else { "Unpin" }),
                    }),
                    Err(PinRefused::AlreadyPinned) => {
                        return Err(refuse(format!("{shown} is pinned already."), false));
                    }
                    Err(PinRefused::NotPinned) => {
                        return Err(refuse(format!("{shown} isn't pinned."), false));
                    }
                }
            }
            Step::Jump(written) => {
                let rows = view.view().source.rows;
                match crate::jump::parse(written, rows, catalog.loading) {
                    Ok(Some(row)) => {
                        jump = Some(row);
                        checked.push(Checked {
                            line: format!("jump {}", row + 1),
                            words: format!("Jump to row {}", format_count(row + 1)),
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
            Step::Undo if several => {
                return Err(refuse(
                    "undo runs on its own, not in an action of several.".into(),
                    true,
                ));
            }
            Step::Undo => checked.push(Checked {
                line: "undo".into(),
                words: "Undo".into(),
            }),
        }
    }
    let changed = view != catalog.view;
    Ok(Plan {
        view,
        changed,
        jump,
        steps: checked,
    })
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
}
