//! The log: the open file's history, every step a person or an agent took
//! and Tycho's reply (the research, "The thread"). Each entry that changed
//! the view holds the view state after it, so the way back and `undo`
//! restore a state; neither adds an entry, and a step taken after going
//! back is added at the end (`docs/DECISIONS.md`, "Scope", 2026-11-24).
//!
//! `undo` goes back to the entry the current one was taken from, which
//! after a way back isn't the one before it in the list: each entry keeps
//! where it started.
//!
//! A drag in the table is an entry in words with no command line ("Moved
//! mag after time"), a run of resizes of one column one entry; a pin the
//! table made is the entry `pin x`, from a click.

use std::cell::RefCell;
use std::rc::Rc;

use serde::Serialize;

use crate::command::{list, quote};
use crate::dataset::format_count;
use crate::view::{Controller, ViewState};

/// Wall-clock ms since the epoch, an entry's time; 0 natively.
pub fn now() -> f64 {
    #[cfg(target_family = "wasm")]
    return js_sys::Date::now();
    #[cfg(not(target_family = "wasm"))]
    0.0
}

/// Where a step came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    /// A file dropped on the page.
    Drop,
    /// A file chosen in the dialog.
    Pick,
    /// The sample's row.
    Sample,
    /// Typed in the bar.
    Typed,
    /// Pasted in the bar: an assistant's action.
    Pasted,
    /// A press in the table or the page.
    Click,
}

impl Origin {
    /// The page's word for it; a word it doesn't know is typed.
    pub fn named(word: &str) -> Self {
        match word {
            "drop" => Self::Drop,
            "pick" => Self::Pick,
            "sample" => Self::Sample,
            "pasted" => Self::Pasted,
            "click" => Self::Click,
            _ => Self::Typed,
        }
    }
}

/// Tycho's reply.
#[derive(Debug, Clone, PartialEq)]
pub enum Reply {
    /// The view's rows and columns.
    Rows {
        rows: u64,
        columns: usize,
    },
    /// A small answer.
    Answer(String),
    Error(String),
}

impl Reply {
    /// The rows and columns of `view`.
    pub fn of(view: &Controller) -> Self {
        Self::Rows {
            rows: view.view().source.rows,
            columns: view.columns().len(),
        }
    }

    /// Its words in the log.
    pub fn text(&self) -> String {
        match self {
            Self::Rows { rows, columns } => format!(
                "{} row{} · {} column{}",
                format_count(*rows),
                if *rows == 1 { "" } else { "s" },
                format_count(*columns as u64),
                if *columns == 1 { "" } else { "s" },
            ),
            Self::Answer(text) | Self::Error(text) => text.clone(),
        }
    }
}

/// What a drag's entry was, so a run of resizes of one column is one.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Step,
    /// A resize of column `index`, from `from` px (its width drawn before
    /// the run; none if unknown).
    Width {
        index: usize,
        from: Option<f32>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    /// Counts across files, so a way back the page asks for after another
    /// file opened finds nothing.
    pub id: u32,
    /// Its command lines (several for an action of several); none for a
    /// drag.
    pub command: Option<String>,
    /// Its plain words, a line a step.
    pub words: String,
    pub reply: Reply,
    pub origin: Origin,
    /// Wall-clock ms since the epoch.
    pub at: f64,
    /// The view after it; none for an entry whose state can't be given
    /// back (a refusal, an answer).
    pub view: Option<ViewState>,
    /// The entry current when it was taken, whose state it started from:
    /// where `undo` goes from it. None for the opening and for an entry
    /// with no state.
    from: Option<usize>,
    kind: Kind,
}

/// Where `undo` or the way back would go: an entry with a state. Nothing
/// changes until [`Log::go`], once the state is given back.
#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub index: usize,
    pub view: ViewState,
    pub words: String,
}

/// An entry as the page draws it (`web/src/frame/state.ts`, `LogEntry`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryView {
    pub id: u32,
    pub command: Option<String>,
    pub words: String,
    pub reply: String,
    /// `rows`, `answer`, or `error`.
    pub reply_kind: &'static str,
    pub origin: Origin,
    pub at: f64,
    /// It has a way back.
    pub back: bool,
}

/// The log as the page draws it, compared by its revision.
#[derive(Debug, Clone, Default)]
pub struct LogView {
    pub revision: u64,
    pub entries: Rc<Vec<EntryView>>,
    pub current: Option<u32>,
}

impl PartialEq for LogView {
    fn eq(&self, other: &Self) -> bool {
        self.revision == other.revision
    }
}

#[derive(Debug, Default)]
pub struct Log {
    entries: Vec<Entry>,
    /// The entry whose state is shown.
    current: Option<usize>,
    next_id: u32,
    revision: u64,
    shown: RefCell<Option<LogView>>,
}

impl Log {
    /// Starts again with a file's opening: `open <name>`, as a record.
    pub fn open(&mut self, name: &str, view: &Controller, origin: Origin, at: f64) {
        self.entries.clear();
        self.current = None;
        self.push(
            Some(format!("open {}", quote(name))),
            format!("Opened {name}"),
            Reply::of(view),
            origin,
            at,
            Some(view.view()),
        );
    }

    /// A CSV read on: its rows so far, in every entry's reply that counts
    /// them, since each counts the file's rows (with no filter yet, every
    /// view shows them all) and the opening's was the first chunk's.
    pub fn set_rows(&mut self, rows: u64) {
        let mut changed = false;
        for entry in &mut self.entries {
            if let Reply::Rows { rows: counted, .. } = &mut entry.reply
                && *counted != rows
            {
                *counted = rows;
                changed = true;
            }
        }
        if changed {
            self.changed();
        }
    }

    /// No file: no log.
    pub fn clear(&mut self) {
        if !self.entries.is_empty() {
            self.entries.clear();
            self.current = None;
            self.changed();
        }
    }

    /// A step that changed the view to `view`: it's current.
    pub fn step(
        &mut self,
        command: Option<String>,
        words: String,
        reply: Reply,
        origin: Origin,
        at: f64,
        view: ViewState,
    ) {
        self.push(command, words, reply, origin, at, Some(view));
    }

    /// An entry with no way back (a refusal, an answer): the current entry
    /// stays.
    pub fn note(
        &mut self,
        command: Option<String>,
        words: String,
        reply: Reply,
        origin: Origin,
        at: f64,
    ) {
        self.push(command, words, reply, origin, at, None);
    }

    fn push(
        &mut self,
        command: Option<String>,
        words: String,
        reply: Reply,
        origin: Origin,
        at: f64,
        view: Option<ViewState>,
    ) {
        let from = view.as_ref().and(self.current);
        if view.is_some() {
            self.current = Some(self.entries.len());
        }
        self.entries.push(Entry {
            id: self.next_id,
            command,
            words,
            reply,
            origin,
            at,
            view,
            from,
            kind: Kind::Step,
        });
        self.next_id += 1;
        self.changed();
    }

    /// The table changed the view from `before` to `after` by itself (a
    /// drag, a pin made in the table): an entry in words, or `pin x` for a
    /// pin. `drawn` is each column's width as drawn before it, by index.
    pub fn table_changed(
        &mut self,
        before: &Controller,
        after: &Controller,
        drawn: &[f32],
        at: f64,
    ) {
        let view = after.view();
        let reply = Reply::of(after);
        if let Some((command, words)) = hid(before, after) {
            self.step(command, words, reply, Origin::Click, at, view);
            return;
        }
        // A header's arrow, or a sort the source refused cleared.
        if before.sort() != after.sort() {
            let (command, words) = match after.sort() {
                Some((index, direction)) => {
                    let column = &after.columns()[index];
                    let name = quote(&column.name);
                    (
                        format!("sort {name} {}", direction.as_str()),
                        format!(
                            "Sort by {name}, {}",
                            crate::filter::Kind::of(column).order_words(direction)
                        ),
                    )
                }
                None => ("clear sort".to_owned(), "Clear the sort".to_owned()),
            };
            self.step(Some(command), words, reply, Origin::Click, at, view);
            return;
        }
        if let Some(index) = resized(before, after) {
            // A run of resizes of one column, nothing after it: one entry.
            let last_is_current = self.current.is_some_and(|at| at + 1 == self.entries.len());
            if let Some(last) = self.entries.last_mut()
                && let Kind::Width { index: run, from } = last.kind
                && run == index
                && last_is_current
            {
                last.words = width_words(after, index, from);
                last.at = at;
                last.view = Some(view);
                self.changed();
                return;
            }
            let from = drawn.get(index).copied();
            let words = width_words(after, index, from);
            self.push(None, words, reply, Origin::Click, at, Some(view));
            if let Some(last) = self.entries.last_mut() {
                last.kind = Kind::Width { index, from };
            }
            return;
        }
        match moved(before, after) {
            Some(Moved::Pin(index)) => {
                let name = quote(&after.columns()[index].name);
                self.step(
                    Some(format!("pin {name}")),
                    format!("Pin {name}"),
                    reply,
                    Origin::Click,
                    at,
                    view,
                );
            }
            Some(Moved::Unpin(index)) => {
                let name = quote(&after.columns()[index].name);
                self.step(
                    Some(format!("unpin {name}")),
                    format!("Unpin {name}"),
                    reply,
                    Origin::Click,
                    at,
                    view,
                );
            }
            Some(Moved::Block(words)) => self.step(None, words, reply, Origin::Click, at, view),
            None => {}
        }
    }

    /// Where `undo` goes: the entry the current one was taken from. None
    /// if there's none (the opening is current).
    pub fn undo_target(&self) -> Option<Target> {
        let current = self.current?;
        self.target(self.entries[current].from?)
    }

    /// Where the way back on entry `id` goes. None if it has no state (or
    /// isn't this file's).
    pub fn back_target(&self, id: u32) -> Option<Target> {
        self.target(self.entries.iter().position(|entry| entry.id == id)?)
    }

    fn target(&self, index: usize) -> Option<Target> {
        let entry = &self.entries[index];
        Some(Target {
            index,
            view: entry.view.clone()?,
            words: entry.words.clone(),
        })
    }

    /// `target`'s entry is current: its state was given back. Adds no entry.
    pub fn go(&mut self, target: &Target) {
        self.current = Some(target.index);
        self.changed();
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn current(&self) -> Option<&Entry> {
        self.current.map(|index| &self.entries[index])
    }

    fn changed(&mut self) {
        self.revision += 1;
        self.shown.take();
    }

    /// The log as the page draws it: built again only when it changed.
    pub fn view(&self) -> LogView {
        let revision = self.revision;
        let current = self.current.map(|index| self.entries[index].id);
        let entries = &self.entries;
        self.shown
            .borrow_mut()
            .get_or_insert_with(|| LogView {
                revision,
                entries: Rc::new(
                    entries
                        .iter()
                        .map(|entry| EntryView {
                            id: entry.id,
                            command: entry.command.clone(),
                            words: entry.words.clone(),
                            reply: entry.reply.text(),
                            reply_kind: match entry.reply {
                                Reply::Rows { .. } => "rows",
                                Reply::Answer(_) => "answer",
                                Reply::Error(_) => "error",
                            },
                            origin: entry.origin,
                            at: entry.at,
                            back: entry.view.is_some(),
                        })
                        .collect(),
                ),
                current,
            })
            .clone()
    }
}

/// A hide or a show the table made, as the commands write it (`hide a, b`,
/// "Hide a and b"); both at once in words alone. None if no flag changed.
fn hid(before: &Controller, after: &Controller) -> Option<(Option<String>, String)> {
    let names = |hidden: bool| -> Vec<String> {
        after
            .order()
            .iter()
            .filter(|&&index| {
                before.is_hidden(index) != after.is_hidden(index)
                    && after.is_hidden(index) == hidden
            })
            .map(|&index| quote(&after.columns()[index].name))
            .collect()
    };
    let (hidden, shown) = (names(true), names(false));
    let spoken = |names: &[String]| list(names.iter().map(String::as_str), "and");
    match (hidden.is_empty(), shown.is_empty()) {
        (true, true) => None,
        (false, true) => Some((
            Some(format!("hide {}", hidden.join(", "))),
            format!("Hide {}", spoken(&hidden)),
        )),
        (true, false) => Some((
            Some(format!("show {}", shown.join(", "))),
            format!("Show {}", spoken(&shown)),
        )),
        (false, false) => Some((
            None,
            format!("Hid {}; showed {}", spoken(&hidden), spoken(&shown)),
        )),
    }
}

/// The one column whose width changed, if only widths did.
fn resized(before: &Controller, after: &Controller) -> Option<usize> {
    if before.order() != after.order() || before.pinned() != after.pinned() {
        return None;
    }
    let mut changed =
        (0..after.columns().len()).filter(|&index| before.width(index) != after.width(index));
    match (changed.next(), changed.next()) {
        (Some(index), None) => Some(index),
        _ => None,
    }
}

/// "Widened place to 240 px", from the width drawn before the run.
fn width_words(view: &Controller, index: usize, from: Option<f32>) -> String {
    let name = quote(&view.columns()[index].name);
    match view.width(index) {
        None => format!("Reset {name}'s width"),
        Some(to) => {
            let verb = match from {
                Some(from) if to < from => "Narrowed",
                Some(from) if to > from => "Widened",
                _ => "Sized",
            };
            format!("{verb} {name} to {} px", to.round())
        }
    }
}

enum Moved {
    Pin(usize),
    Unpin(usize),
    /// A move in words.
    Block(String),
}

/// What a move in the table did: a pin or an unpin as `pin` and `unpin`
/// make them, else a block of columns moved.
fn moved(before: &Controller, after: &Controller) -> Option<Moved> {
    let (old, new) = (before.order(), after.order());
    let (was, now) = (before.pinned(), after.pinned());
    if old == new && was == now {
        return None;
    }
    // As `pin` and `unpin` make them: the column at the run's new end, or
    // just past it.
    let made = |index: usize, pin: bool| {
        let mut made = before.clone();
        let result = if pin {
            made.pin(index)
        } else {
            made.unpin(index)
        };
        result.is_ok() && made.order() == new && made.pinned() == now
    };
    if now == was + 1
        && let Some(&index) = new.get(was)
        && made(index, true)
    {
        return Some(Moved::Pin(index));
    }
    if now + 1 == was
        && let Some(&index) = new.get(now)
        && made(index, false)
    {
        return Some(Moved::Unpin(index));
    }
    // Only the count, more than one column across: no column moved.
    if old == new {
        return Some(Moved::Block(match now {
            0 => "Unpinned every column".to_owned(),
            1 => "Pinned the first column".to_owned(),
            now => format!("Pinned the first {now} columns"),
        }));
    }
    let name = |index: usize| quote(&after.columns()[index].name);
    // Of two blocks that tell the move alike (two columns swapped), the
    // one whose column crossed the run's edge was dragged.
    let crossed = |&(place, length): &(usize, usize)| {
        new[place..place + length]
            .iter()
            .any(|&index| before.is_pinned(index) != after.is_pinned(index))
    };
    let blocks = blocks(old, new);
    let block = blocks
        .iter()
        .find(|block| crossed(block))
        .or(blocks.first())
        .copied();
    let mut words = match block {
        Some((place, length)) => {
            let names: Vec<String> = new[place..place + length]
                .iter()
                .map(|&index| name(index))
                .collect();
            let names = list(names.iter().map(String::as_str), "and");
            match place.checked_sub(1) {
                Some(before) => format!("Moved {names} after {}", name(new[before])),
                None => format!("Moved {names} to the start"),
            }
        }
        None => "Moved columns".to_owned(),
    };
    if was != now {
        words.push_str(&format!(
            ", {} pinned",
            if now == 0 {
                "none".to_owned()
            } else {
                now.to_string()
            }
        ));
    }
    Some(Moved::Block(words))
}

/// The blocks of columns a move from `old` to `new` could be, each as its
/// place in `new` and its length: the shortest that tell it, one moved
/// left and one moved right where both do. None if it's no one block's
/// move.
fn blocks(old: &[usize], new: &[usize]) -> Vec<(usize, usize)> {
    let Some(first) = (0..old.len()).find(|&place| old[place] != new[place]) else {
        return Vec::new();
    };
    let last = (0..old.len())
        .rev()
        .find(|&place| old[place] != new[place])
        .unwrap_or(first);
    let (old, new) = (&old[first..=last], &new[first..=last]);
    let span = old.len();
    (1..span)
        .map(|length| {
            let mut found = Vec::new();
            // Moved left: the block was at the end, now at the start.
            if new[..length] == old[span - length..] && new[length..] == old[..span - length] {
                found.push((first, length));
            }
            // Moved right: the block was at the start, now at the end.
            if new[span - length..] == old[..length] && new[..span - length] == old[length..] {
                found.push((first + span - length, length));
            }
            found
        })
        .find(|found| !found.is_empty())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use seiza_duckdb::sql::ColumnInfo;

    use super::*;
    use crate::view::{SourceKind, SourceView};

    fn file() -> Controller {
        Controller::of_file(
            SourceView {
                kind: SourceKind::Csv,
                name: "quakes.csv".into(),
                rows: 1_204,
            },
            &[
                ColumnInfo::new("time", "TIMESTAMP"),
                ColumnInfo::new("mag", "DOUBLE"),
                ColumnInfo::new("place", "VARCHAR"),
                ColumnInfo::new("depth", "DOUBLE"),
            ],
        )
    }

    /// The view with `order` and `pinned`.
    fn arranged(order: &[usize], pinned: usize) -> Controller {
        let view = file();
        let mut state = view.view();
        state.columns = order
            .iter()
            .map(|&index| state.columns[index].clone())
            .collect();
        state.pinned = pinned;
        Controller::new(&state, view.columns()).unwrap()
    }

    fn widened(view: &Controller, index: usize, width: f32) -> Controller {
        let mut state = view.view();
        let place = view.place(index);
        state.columns[place].width = Some(width);
        Controller::new(&state, view.columns()).unwrap()
    }

    fn words(log: &Log) -> Vec<&str> {
        log.entries()
            .iter()
            .map(|entry| entry.words.as_str())
            .collect()
    }

    #[test]
    fn opening_starts_the_log() {
        let mut log = Log::default();
        log.open("quakes.csv", &file(), Origin::Drop, 1.0);
        let view = log.view();
        assert_eq!(view.entries.len(), 1);
        let entry = &view.entries[0];
        assert_eq!(entry.command.as_deref(), Some("open quakes.csv"));
        assert_eq!(entry.words, "Opened quakes.csv");
        assert_eq!(entry.reply, "1,204 rows · 4 columns");
        assert_eq!(entry.origin, Origin::Drop);
        assert!(entry.back);
        assert_eq!(view.current, Some(entry.id));
        // Another file starts it again; ids go on.
        log.note(
            None,
            "x".into(),
            Reply::Error("no".into()),
            Origin::Typed,
            2.0,
        );
        log.open("other file.parquet", &file(), Origin::Pick, 3.0);
        assert_eq!(log.entries().len(), 1);
        assert_eq!(log.entries()[0].id, 2);
        assert_eq!(
            log.entries()[0].command.as_deref(),
            Some("open \"other file.parquet\"")
        );
    }

    #[test]
    fn a_csv_read_on_counts_its_rows_in_every_entry() {
        let mut log = Log::default();
        log.open("quakes.csv", &file(), Origin::Drop, 1.0);
        log.step(
            Some("pin mag".into()),
            "Pin mag".into(),
            Reply::of(&arranged(&[1, 0, 2, 3], 1)),
            Origin::Typed,
            2.0,
            arranged(&[1, 0, 2, 3], 1).view(),
        );
        log.note(
            Some("pin nope".into()),
            "Pin nope".into(),
            Reply::Error("No column nope.".into()),
            Origin::Typed,
            3.0,
        );
        let revision = log.view().revision;
        log.set_rows(71_431);
        let view = log.view();
        assert!(view.revision > revision);
        let replies: Vec<&str> = view
            .entries
            .iter()
            .map(|entry| entry.reply.as_str())
            .collect();
        assert_eq!(
            replies,
            [
                "71,431 rows · 4 columns",
                "71,431 rows · 4 columns",
                "No column nope."
            ]
        );
        // The same count again changes nothing the page would draw.
        log.set_rows(71_431);
        assert_eq!(log.view().revision, view.revision);
    }

    #[test]
    fn current_undo_and_the_way_back() {
        let mut log = Log::default();
        let open = file();
        log.open("quakes.csv", &open, Origin::Sample, 0.0);
        let one = arranged(&[1, 0, 2, 3], 1);
        log.step(
            Some("pin mag".into()),
            "Pin mag".into(),
            Reply::of(&one),
            Origin::Typed,
            1.0,
            one.view(),
        );
        log.note(
            Some("pin zzz".into()),
            "pin zzz".into(),
            Reply::Error("No column zzz.".into()),
            Origin::Typed,
            2.0,
        );
        let two = arranged(&[1, 2, 0, 3], 2);
        log.step(
            Some("pin place".into()),
            "Pin place".into(),
            Reply::of(&two),
            Origin::Typed,
            3.0,
            two.view(),
        );
        assert_eq!(log.current().unwrap().words, "Pin place");
        // A refusal has no way back, and undo skips it.
        assert!(log.back_target(2).is_none());
        let undo = |log: &mut Log| {
            let target = log.undo_target()?;
            log.go(&target);
            Some(target)
        };
        let target = undo(&mut log).unwrap();
        assert_eq!(
            (target.view, target.words.as_str()),
            (one.view(), "Pin mag")
        );
        assert_eq!(log.current().unwrap().id, 1);
        assert_eq!(undo(&mut log).unwrap().view, open.view());
        // Nothing before the opening.
        assert!(undo(&mut log).is_none());
        // Neither added an entry.
        assert_eq!(log.entries().len(), 4);
        // Nothing moves until the state is given back.
        let target = log.back_target(3).unwrap();
        assert_eq!(target.view, two.view());
        assert_eq!(log.view().current, Some(0));
        log.go(&target);
        assert_eq!(log.view().current, Some(3));
        undo(&mut log);
        // A step after going back is added at the end, current.
        let three = arranged(&[1, 0, 2, 3], 0);
        log.step(
            Some("unpin mag".into()),
            "Unpin mag".into(),
            Reply::of(&three),
            Origin::Typed,
            4.0,
            three.view(),
        );
        assert_eq!(log.entries().len(), 5);
        assert_eq!(log.current().unwrap().id, 4);
        // Its undo goes to the state it was taken from, `pin mag`, not to
        // `pin place`, the entry before it in the list.
        let target = undo(&mut log).unwrap();
        assert_eq!(
            (target.view, target.words.as_str()),
            (one.view(), "Pin mag")
        );
        // An id from no entry.
        assert!(log.back_target(99).is_none());
    }

    #[test]
    fn drags_are_entries_in_words() {
        let mut log = Log::default();
        let open = file();
        log.open("quakes.csv", &open, Origin::Drop, 0.0);
        let drawn = [120.0, 80.0, 160.0, 80.0];
        // `place` dragged after `time`.
        let moved = arranged(&[0, 2, 1, 3], 0);
        log.table_changed(&open, &moved, &drawn, 1.0);
        // `place` and `depth` together to the start.
        let both = arranged(&[2, 3, 0, 1], 0);
        log.table_changed(&open, &both, &drawn, 2.0);
        // `depth` dragged into the pinned run's end: `pin depth`.
        let pinned_before = arranged(&[1, 0, 2, 3], 1);
        let pinned_after = arranged(&[1, 3, 0, 2], 2);
        log.table_changed(&pinned_before, &pinned_after, &drawn, 3.0);
        // And out of it, just past the run: `unpin depth`.
        log.table_changed(&pinned_after, &arranged(&[1, 3, 0, 2], 1), &drawn, 4.0);
        // Out of the run and further: a move, the count said.
        let far = arranged(&[1, 0, 2, 3], 0);
        log.table_changed(&arranged(&[0, 1, 2, 3], 1), &far, &drawn, 5.0);
        assert_eq!(
            words(&log)[1..],
            [
                "Moved place after time",
                "Moved place and depth to the start",
                "Pin depth",
                "Unpin depth",
                "Moved time after mag, none pinned",
            ]
        );
        assert_eq!(log.entries()[3].command.as_deref(), Some("pin depth"));
        // Only the count, by more than one: no column moved.
        log.table_changed(&open, &arranged(&[0, 1, 2, 3], 3), &drawn, 6.0);
        assert_eq!(words(&log).last(), Some(&"Pinned the first 3 columns"));
        assert_eq!(log.entries()[3].origin, Origin::Click);
        assert_eq!(log.entries()[1].command, None);
    }

    #[test]
    fn a_hide_the_table_made_is_an_entry() {
        let mut log = Log::default();
        let before = file();
        log.open("quakes.csv", &before, Origin::Drop, 0.0);
        let mut after = before.clone();
        after.hide(2).unwrap();
        after.hide(0).unwrap();
        log.table_changed(&before, &after, &[], 1.0);
        let entry = log.current().unwrap();
        assert_eq!(entry.command.as_deref(), Some("hide time, place"));
        assert_eq!(entry.words, "Hide time and place");
        assert_eq!(entry.origin, Origin::Click);
        assert_eq!(entry.view, Some(after.view()));
        // Its way back is the opening's state.
        assert_eq!(log.undo_target().unwrap().view, before.view());
        let mut both = after.clone();
        both.show(0).unwrap();
        both.hide(1).unwrap();
        log.table_changed(&after, &both, &[], 2.0);
        assert_eq!(log.current().unwrap().command, None);
        assert_eq!(log.current().unwrap().words, "Hid mag; showed time");
    }

    #[test]
    fn a_sort_the_table_made_is_an_entry() {
        use crate::filter::Direction;

        let mut log = Log::default();
        let before = file();
        log.open("quakes.csv", &before, Origin::Drop, 0.0);
        let mut sorted = before.clone();
        sorted.set_sort(Some((0, Direction::Desc)));
        log.table_changed(&before, &sorted, &[], 1.0);
        let entry = log.current().unwrap();
        assert_eq!(entry.command.as_deref(), Some("sort time desc"));
        assert_eq!(entry.words, "Sort by time, newest first");
        assert_eq!(entry.view, Some(sorted.view()));
        let mut cleared = sorted.clone();
        cleared.set_sort(None);
        log.table_changed(&sorted, &cleared, &[], 2.0);
        assert_eq!(
            log.current().unwrap().command.as_deref(),
            Some("clear sort")
        );
        assert_eq!(log.current().unwrap().words, "Clear the sort");
        // Undo goes back to the sort.
        assert_eq!(log.undo_target().unwrap().view, sorted.view());
    }

    #[test]
    fn a_run_of_resizes_is_one_entry() {
        let mut log = Log::default();
        let open = file();
        log.open("quakes.csv", &open, Origin::Drop, 0.0);
        let drawn = [120.0, 80.0, 160.0, 80.0];
        let first = widened(&open, 2, 200.0);
        log.table_changed(&open, &first, &drawn, 1.0);
        let second = widened(&first, 2, 240.0);
        log.table_changed(&first, &second, &[120.0, 80.0, 200.0, 80.0], 2.0);
        assert_eq!(words(&log)[1..], ["Widened place to 240 px"]);
        assert_eq!(log.current().unwrap().view, Some(second.view()));
        // Another column starts another entry; back to the first, the same.
        let other = widened(&second, 1, 60.0);
        log.table_changed(&second, &other, &drawn, 3.0);
        let again = widened(&other, 2, 100.0);
        log.table_changed(&other, &again, &[120.0, 60.0, 240.0, 80.0], 4.0);
        assert_eq!(
            words(&log)[1..],
            [
                "Widened place to 240 px",
                "Narrowed mag to 60 px",
                "Narrowed place to 100 px"
            ]
        );
        // After going back, a resize of the last entry's column is new.
        let target = log.undo_target().unwrap();
        log.go(&target);
        log.table_changed(&other, &widened(&other, 2, 300.0), &drawn, 5.0);
        assert_eq!(log.entries().len(), 5);
    }
}
