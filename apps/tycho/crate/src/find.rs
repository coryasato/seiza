//! Find's bar, the app's half (the page draws it: `web/src/frame/find.tsx`).
//! The term the page sets as it's typed (or the bar's `find`), which the
//! table highlights and steps through (its `find`); what a step came to;
//! and the count of matching cells and the current match's place among
//! them, each a query of its own over the rows in view
//! (`seiza_duckdb::view::ViewRows::find_count_sql`, `find_place_sql`),
//! sent again whenever what it counts changes and cancelled when it does
//! (`docs/DECISIONS.md`, "Scope", 2026-11-26: the bar says it's counting
//! while either is out, and shows the place and the count together).

use serde::Serialize;

use crate::dataset::format_count;

/// What find's bar shows (`web/src/frame/state.ts`, `FindState`).
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct FindFacts {
    /// The term set; none with no find.
    pub term: Option<String>,
    /// "3 of 18", "18 matches", "Counting…", "No matches"; none with no
    /// term.
    pub text: Option<String>,
    /// `text` is a fault.
    pub error: bool,
    /// A step is out.
    pub stepping: bool,
    /// A step has landed on its cell, selected, since the term was set:
    /// Escape gives the table focus there.
    pub landed: bool,
    /// Counts the bar's `find` commands: each opens the bar on its term.
    pub opens: u32,
}

/// What the last step came to, said until the next step or term.
#[derive(Debug, Clone, PartialEq)]
pub enum Said {
    NoMatch,
    Refused,
    Failed(String),
}

/// A count's state: the matches, or the current match's place.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Count {
    Out,
    Done(u64),
    Failed,
}

/// The bar's words, and whether they're a fault: `count` of the matches,
/// `place` of the current match (none with no current match).
pub fn text(count: Count, place: Option<Count>, said: Option<&Said>) -> (String, bool) {
    match said {
        Some(Said::Failed(message)) => {
            return (
                format!("Couldn't search: {}.", message.trim_end_matches('.')),
                true,
            );
        }
        Some(Said::Refused) => return ("This file can't be searched.".into(), true),
        Some(Said::NoMatch) => return ("No matches".into(), false),
        None => {}
    }
    let words = match (count, place) {
        (Count::Done(0), _) => "No matches".into(),
        (Count::Out, _) | (_, Some(Count::Out)) => "Counting…".into(),
        (Count::Done(matches), Some(Count::Done(place))) => {
            format!("{} of {}", format_count(place), format_count(matches))
        }
        (Count::Done(1), _) => "1 match".into(),
        (Count::Done(matches), _) => format!("{} matches", format_count(matches)),
        (Count::Failed, Some(Count::Done(place))) => format!("Match {}", format_count(place)),
        (Count::Failed, _) => "Not counted".into(),
    };
    (words, false)
}

/// What a count was asked of: the shown table, the term, the shown
/// columns in their drawn order, the filters the rows are chosen by, and
/// the rows (a CSV's grow), none while the source is still loading: a
/// count of a CSV still growing is sent once, and again when it's done,
/// not after each chunk, which would cancel each before it answered.
#[derive(Debug, Clone, PartialEq)]
pub struct Key {
    pub table: u64,
    pub term: String,
    pub columns: Vec<usize>,
    pub filters: Vec<crate::filter::Filter>,
    pub rows: Option<u64>,
}

/// What a place was asked of: the count's, the sort (the order the steps
/// follow), and the current match.
#[derive(Debug, Clone, PartialEq)]
pub struct PlaceKey {
    pub count: Key,
    pub sort: Vec<seiza_tall_table::Sort>,
    pub cell: seiza_tall_table::FoundCell,
}

/// How long after a count first fails it's sent again; each failure since
/// what it counts last changed doubles it, to [`RETRY_MAX_MS`].
pub const RETRY_MS: u64 = 5_000;
pub const RETRY_MAX_MS: u64 = 60_000;

/// The wait before a count that has failed `failures` times in a row is
/// sent again.
pub fn retry_after(failures: u32) -> u64 {
    RETRY_MS
        .saturating_mul(1 << failures.saturating_sub(1).min(4))
        .min(RETRY_MAX_MS)
}

/// Find's state in the workbench.
#[derive(Default)]
pub struct Finding {
    pub term: Option<String>,
    pub stepping: bool,
    pub landed: bool,
    pub said: Option<Said>,
    pub opens: u32,
    /// The count asked last, and what it came to.
    pub count: Option<(Key, Count)>,
    pub place: Option<(PlaceKey, Count)>,
    /// A count that failed is due to be sent again ([`RETRY_MS`] after it
    /// failed): what it counts may not have changed (a file registered
    /// again after a failed read keeps its table and its term).
    pub retry: bool,
    /// The failures in a row since what the counts ask of last changed.
    pub failures: u32,
    #[cfg(target_family = "wasm")]
    pub count_out: Option<Out>,
    #[cfg(target_family = "wasm")]
    pub place_out: Option<Out>,
}

impl Finding {
    /// A new term (none: find closed): the step's state and both counts
    /// start again.
    pub fn set_term(&mut self, term: Option<String>) {
        let term = term.filter(|term| !term.is_empty());
        if term == self.term {
            return;
        }
        let opens = self.opens;
        *self = Self {
            term,
            opens,
            ..Self::default()
        };
    }

    /// A step went out.
    pub fn started(&mut self) {
        self.stepping = true;
        self.said = None;
    }

    /// What a step came to.
    pub fn found(&mut self, outcome: &seiza_tall_table::FindOutcome) {
        use seiza_tall_table::FindOutcome;

        self.stepping = false;
        match outcome {
            FindOutcome::Match { .. } => {
                self.landed = true;
                self.said = None;
            }
            FindOutcome::NoMatch => self.said = Some(Said::NoMatch),
            FindOutcome::Refused => self.said = Some(Said::Refused),
            FindOutcome::Failed(message) => self.said = Some(Said::Failed(message.to_string())),
            // `Cancelled`, and any outcome the table adds: nothing to say.
            _ => {}
        }
    }

    /// What the bar shows; `current`, whether the table has a current
    /// match.
    pub fn facts(&self, current: bool) -> FindFacts {
        let text = self.term.as_ref().map(|_| {
            let count = self.count.as_ref().map_or(Count::Out, |(_, count)| *count);
            let place =
                current.then(|| self.place.as_ref().map_or(Count::Out, |(_, place)| *place));
            text(count, place, self.said.as_ref())
        });
        FindFacts {
            term: self.term.clone(),
            error: text.as_ref().is_some_and(|(_, error)| *error),
            text: text.map(|(text, _)| text),
            stepping: self.stepping,
            // The table forgets its match at a sort, a filter, or another
            // set of columns: Escape then goes back where find opened.
            landed: self.landed && current,
            opens: self.opens,
        }
    }
}

/// A count's query out: cancelled in DuckDB when dropped (its task with it).
#[cfg(target_family = "wasm")]
pub struct Out {
    engine: seiza_duckdb::Engine,
    id: seiza_duckdb::RequestId,
    /// None once it has answered: nothing to cancel.
    task: Option<gpui_kit::Task<()>>,
}

#[cfg(target_family = "wasm")]
impl Drop for Out {
    fn drop(&mut self) {
        if self.task.is_some() {
            self.engine.cancel(self.id);
        }
    }
}

/// Which of the two counts a query answers.
#[cfg(target_family = "wasm")]
#[derive(Debug, Clone, Copy, PartialEq)]
enum Which {
    Matches,
    Place,
}

#[cfg(target_family = "wasm")]
mod web {
    use gpui_kit::{Context, Entity};
    use seiza_duckdb::arrow::Value;

    use super::{Count, Key, Out, PlaceKey, Which};
    use crate::Workbench;
    use crate::table::RowTable;

    impl super::Finding {
        /// Sends the count and the place again if what they count has
        /// changed since they were asked (the term, a filter, a hide, a
        /// show, a move, a sort, the current match, a CSV's growth, another
        /// file), cancelling what's out; with no term, nothing is out.
        /// `table`: the shown table and its shown columns in their drawn
        /// order; none with no file or no term.
        pub fn sync(
            &mut self,
            table: Option<(Entity<RowTable>, Vec<usize>)>,
            filters: &[crate::filter::Filter],
            cx: &mut Context<Workbench>,
        ) {
            let (Some(term), Some((table, columns))) = (self.term.clone(), table) else {
                self.stop();
                return;
            };
            let shown = table.read(cx);
            let key = Key {
                table: table.entity_id().as_u64(),
                term,
                columns,
                filters: filters.to_vec(),
                rows: {
                    use seiza_duckdb::view::RowSource;
                    shown
                        .delegate()
                        .view()
                        .query()
                        .busy()
                        .is_none()
                        .then(|| shown.rows())
                },
            };
            let place = shown.current_match().map(|cell| PlaceKey {
                count: key.clone(),
                sort: shown.sort().to_vec(),
                cell,
            });
            let retry = std::mem::take(&mut self.retry);
            let count_again = match &self.count {
                Some((asked, count)) => *asked != key || (retry && *count == Count::Failed),
                None => true,
            };
            let place_again = match (&self.place, &place) {
                (Some((asked, count)), Some(place)) => {
                    asked != place || (retry && *count == Count::Failed)
                }
                (None, None) => false,
                _ => true,
            };
            let asked_again = self.count.as_ref().is_none_or(|(asked, _)| *asked != key);
            if asked_again {
                // What a step said was of the rows and columns before:
                // the new count speaks for the new ones, and its failures
                // are its own.
                self.said = None;
                self.failures = 0;
            }
            if !count_again && !place_again {
                return;
            }
            // Written while the table is read, sent after.
            let source = shown.delegate().view();
            let count_sql = count_again
                .then(|| source.find_count_sql(&key.term, &key.columns))
                .flatten();
            let place_sql = place.as_ref().filter(|_| place_again).and_then(|place| {
                source.find_place_sql(
                    &place.count.term,
                    &place.count.columns,
                    place.cell.row,
                    place.cell.column,
                )
            });
            if count_again {
                // No column shown: nothing matches.
                let count = if count_sql.is_some() {
                    Count::Out
                } else {
                    Count::Done(0)
                };
                self.count_out = count_sql.map(|sql| send(&sql, Which::Matches, cx));
                self.count = Some((key, count));
            }
            if place_again {
                let count = if place_sql.is_some() {
                    Count::Out
                } else {
                    Count::Failed
                };
                self.place_out = place_sql.map(|sql| send(&sql, Which::Place, cx));
                self.place = place.map(|place| (place, count));
            }
        }

        /// Nothing out, nothing counted.
        fn stop(&mut self) {
            self.count_out = None;
            self.place_out = None;
            self.count = None;
            self.place = None;
        }

        /// A count's answer: kept if it's the one out.
        fn answered(&mut self, which: Which, id: seiza_duckdb::RequestId, count: Option<Count>) {
            let (out, slot) = match which {
                Which::Matches => (
                    &mut self.count_out,
                    self.count.as_mut().map(|(_, count)| count),
                ),
                Which::Place => (
                    &mut self.place_out,
                    self.place.as_mut().map(|(_, count)| count),
                ),
            };
            if out.as_ref().is_none_or(|out| out.id != id) {
                return;
            }
            // Answered: nothing to cancel, and its task is the one running.
            if let Some(task) = out.take().and_then(|mut out| out.task.take()) {
                task.detach();
            }
            if let (Some(slot), Some(count)) = (slot, count) {
                *slot = count;
            }
        }
    }

    /// Sends `sql`, a count's, and gives its answer to the workbench.
    fn send(sql: &str, which: Which, cx: &mut Context<Workbench>) -> Out {
        let engine = cx.global::<seiza_duckdb::Engine>().clone();
        let (id, result) = engine.query(sql);
        let task = cx.spawn(async move |this, cx| {
            let count = match result.await {
                Ok(result) => Some(match result.value(0, 0) {
                    Some(Value::Int(n)) => u64::try_from(n).map_or(Count::Failed, Count::Done),
                    Some(Value::UInt(n)) => Count::Done(n),
                    _ => Count::Failed,
                }),
                // Its `Out` dropped would have dropped this task too: a
                // cancel that reaches it came from elsewhere (the engine
                // stopped), and the count is sent again as a failure is.
                Err(_) => Some(Count::Failed),
            };
            let failed = count == Some(Count::Failed);
            let Ok(failures) = this.update(cx, |this, cx| {
                let finding = this.finding();
                finding.answered(which, id, count);
                if failed {
                    finding.failures += 1;
                }
                cx.notify();
                finding.failures
            }) else {
                return;
            };
            if failed {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(super::retry_after(
                        failures,
                    )))
                    .await;
                let _ = this.update(cx, |this, cx| {
                    this.finding().retry = true;
                    cx.notify();
                });
            }
        });
        Out {
            engine,
            id,
            task: Some(task),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_count_backs_off_to_a_minute() {
        let waits: Vec<u64> = (1..=6).map(retry_after).collect();
        assert_eq!(waits, [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
        assert_eq!(retry_after(0), RETRY_MS);
    }

    #[test]
    fn the_bar_counts_then_places() {
        assert_eq!(text(Count::Out, None, None).0, "Counting…");
        assert_eq!(text(Count::Done(18), None, None).0, "18 matches");
        assert_eq!(text(Count::Done(1), None, None).0, "1 match");
        assert_eq!(text(Count::Done(1_682), None, None).0, "1,682 matches");
        // A landing's place out: counting, never the count alone.
        assert_eq!(text(Count::Done(18), Some(Count::Out), None).0, "Counting…");
        assert_eq!(text(Count::Out, Some(Count::Done(3)), None).0, "Counting…");
        assert_eq!(
            text(Count::Done(18), Some(Count::Done(3)), None).0,
            "3 of 18"
        );
        assert_eq!(
            text(Count::Done(18), Some(Count::Failed), None).0,
            "18 matches"
        );
        assert_eq!(text(Count::Failed, Some(Count::Done(3)), None).0, "Match 3");
        assert_eq!(text(Count::Failed, None, None).0, "Not counted");
    }

    #[test]
    fn a_step_says_what_the_count_cant() {
        assert_eq!(
            text(Count::Done(0), None, None),
            ("No matches".into(), false)
        );
        // No match found while the count is still out.
        assert_eq!(
            text(Count::Out, None, Some(&Said::NoMatch)),
            ("No matches".into(), false)
        );
        assert_eq!(
            text(
                Count::Done(4),
                None,
                Some(&Said::Failed("Network error.".into()))
            ),
            ("Couldn't search: Network error.".into(), true)
        );
        assert!(text(Count::Done(4), None, Some(&Said::Refused)).1);
    }

    #[test]
    fn a_new_term_starts_again_and_keeps_the_opens() {
        let mut finding = Finding {
            opens: 2,
            ..Finding::default()
        };
        finding.set_term(Some("cosmos".into()));
        finding.started();
        finding.found(&seiza_tall_table::FindOutcome::Match {
            cell: seiza_tall_table::FoundCell { row: 4, column: 1 },
            wrapped: false,
        });
        assert!(finding.landed && !finding.stepping);
        // The table forgot its match (a sort, a filter): not landed.
        assert!(finding.facts(true).landed);
        assert!(!finding.facts(false).landed);
        let facts = finding.facts(true);
        assert_eq!(facts.text.as_deref(), Some("Counting…"));
        assert_eq!(facts.opens, 2);
        finding.set_term(Some("cosmos".into()));
        assert!(finding.landed, "the same term is no new term");
        finding.set_term(Some("".into()));
        assert_eq!(finding.term, None);
        assert!(!finding.landed);
        assert_eq!(finding.facts(false).text, None);
        assert_eq!(finding.opens, 2);
    }
}
