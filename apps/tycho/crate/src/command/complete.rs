//! Completion: for the bar's text and its caret, the part being typed (a
//! verb, a column, a row), what matches it, and what the line would do on
//! Enter. Synchronous, so it keeps up with typing (`docs/DECISIONS.md`,
//! "Scope", 2026-11-24, "The thread's two proposed items are taken").
//! Offsets are the page's: UTF-16 code units.

use serde::Serialize;

use super::plan::{self, Catalog};
use super::{LATER, Parsed, Token, VERBS, groups, parse, quote, tokenize};

/// The most items a completion lists.
const MOST: usize = 100;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub part: Part,
    /// The text an item replaces (UTF-16 offsets): the part being typed.
    pub from: usize,
    pub to: usize,
    pub items: Vec<Item>,
    pub preview: Preview,
    /// The command's parts across the top of the bar, once its verb is one
    /// the bar runs: `pin` then `column`, `hide` then `columns`, `jump`
    /// then `row`, `undo` alone.
    pub slots: Vec<Slot>,
}

/// A part of the command being typed, as the bar's row of parts shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Slot {
    /// The part's value once it's written, else its name (`column`).
    pub text: String,
    /// `done`, `now` (the caret is in it), or `next`.
    pub state: &'static str,
}

/// What the caret is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Part {
    /// Nothing to complete: JSON, `undo`'s nothing, a part past the last.
    None,
    Verb,
    Column,
    Row,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// What replaces the part: a name quoted where it needs to be.
    pub text: String,
    /// What the list shows: the verb, or the column's name.
    pub label: String,
    /// A verb's hint, a column's type, or a later verb's goal.
    pub detail: String,
    /// A verb of the grammar not built yet.
    pub later: bool,
    /// A column's kind, for its badge: `number`, `text`, `time`, or
    /// `boolean`; none for a verb.
    pub kind: Option<&'static str>,
}

/// What Enter would do with the whole line.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// `empty`; `command` (a typed line) or `action` (JSON, its steps
    /// listed), each step's words in `steps`; `typing` (a part still
    /// matching what's typed); `refused`, `sentence`, `later`, `open`, or
    /// `nofile`, with `text`.
    pub kind: &'static str,
    pub steps: Vec<String>,
    pub text: Option<String>,
    /// `refused` by a fault, rather than answered.
    pub error: bool,
    /// `command` or `action`: the action as an agent writes it.
    pub json: Option<String>,
}

impl Preview {
    fn say(kind: &'static str, text: impl Into<String>, error: bool) -> Self {
        Self {
            kind,
            steps: Vec::new(),
            text: Some(text.into()),
            error,
            json: None,
        }
    }
}

/// The completion of `text` with its caret at `caret` (UTF-16), against
/// the open file (`None`: none is open).
pub fn complete(text: &str, caret: usize, catalog: Option<&Catalog>) -> Completion {
    let caret = byte_of(text, caret);
    let (part, span, items) = if text.trim_start().starts_with('{') {
        (Part::None, caret..caret, Vec::new())
    } else {
        part_at(text, caret, catalog)
    };
    let typing = !items.is_empty() && text[span.end..].trim().is_empty();
    let preview = preview(text, catalog, typing);
    let slots = slots(text, part, &preview);
    Completion {
        part,
        from: utf16_of(text, span.start),
        to: utf16_of(text, span.end),
        items,
        preview,
        slots,
    }
}

fn part_at(
    text: &str,
    caret: usize,
    catalog: Option<&Catalog>,
) -> (Part, std::ops::Range<usize>, Vec<Item>) {
    let tokens = tokenize(text);
    // The word the caret is in or just after; else a new one at the caret.
    let at = tokens
        .iter()
        .position(|token| token.start <= caret && caret <= token.end);
    let index = at.unwrap_or_else(|| tokens.iter().filter(|token| token.end < caret).count());
    let span = at.map_or(caret..caret, |at| tokens[at].start..tokens[at].end);
    if index == 0 {
        let typed = typed_part(text, span.start, caret);
        return (Part::Verb, span, verbs(&typed));
    }
    let verb = tokens[0].text.to_lowercase();
    match verb.as_str() {
        "pin" | "unpin" if !tokens[0].quoted => {
            // A quoted name is one word; bare words run from the first to
            // the last (`pin launch d`), wherever the caret is in them.
            let name = tokens.get(1);
            let span = match name {
                Some(first) if first.quoted => {
                    if index != 1 {
                        return (Part::None, caret..caret, Vec::new());
                    }
                    span
                }
                Some(first) => {
                    let last = tokens.last().map_or(caret, |token| token.end);
                    first.start.min(caret)..last.max(caret)
                }
                None => span,
            };
            let typed = typed_part(text, span.start, caret);
            let items = catalog.map_or_else(Vec::new, |catalog| {
                let pin = verb == "pin";
                let view = &catalog.view;
                // `pin` takes a shown column; `unpin` any pinned one.
                columns(&typed, catalog, |index| {
                    view.is_pinned(index) != pin && !(pin && view.is_hidden(index))
                })
            });
            (Part::Column, span, items)
        }
        "hide" | "show" if !tokens[0].quoted => {
            let (span, others) = name_at(text, &tokens[1..], caret);
            let typed = typed_part(text, span.start, caret);
            let items = catalog.map_or_else(Vec::new, |catalog| {
                let hide = verb == "hide";
                let view = &catalog.view;
                let named = |index: usize| {
                    let name = view.columns()[index].name.to_lowercase();
                    others.iter().any(|other| other.to_lowercase() == name)
                };
                let mut items = Vec::new();
                // `show all` first, while it's the one name.
                if !hide
                    && others.is_empty()
                    && (0..view.columns().len()).any(|index| view.is_hidden(index))
                    && "all".starts_with(&typed.to_lowercase())
                {
                    let hidden = (0..view.columns().len())
                        .filter(|&index| view.is_hidden(index))
                        .count();
                    items.push(Item {
                        text: "all".into(),
                        label: "all".into(),
                        detail: format!(
                            "{hidden} hidden column{}",
                            if hidden == 1 { "" } else { "s" }
                        ),
                        later: false,
                        kind: None,
                    });
                }
                items.extend(columns(&typed, catalog, |index| {
                    view.is_hidden(index) != hide && !named(index)
                }));
                items
            });
            (Part::Column, span, items)
        }
        "jump" if !tokens[0].quoted => {
            let start = tokens.get(1).map_or(caret, |token| token.start);
            (
                Part::Row,
                start..text.trim_end().len().max(caret),
                Vec::new(),
            )
        }
        _ => (Part::None, caret..caret, Vec::new()),
    }
}

/// What's typed of the part from `start` to the caret, a quote opening it
/// taken off.
fn typed_part(text: &str, start: usize, caret: usize) -> String {
    let typed = &text[start..caret.max(start)];
    match typed.strip_prefix('"') {
        Some(quoted) => tokenize(&format!("\"{quoted}"))
            .first()
            .map_or_else(String::new, |token: &Token| token.text.clone()),
        None => typed.to_owned(),
    }
}

fn verbs(typed: &str) -> Vec<Item> {
    let typed = typed.to_lowercase();
    let built = VERBS
        .iter()
        .filter(|(verb, _)| verb.starts_with(&typed))
        .map(|(verb, hint)| Item {
            text: (*verb).into(),
            label: (*verb).into(),
            detail: (*hint).into(),
            later: false,
            kind: None,
        });
    // The later verbs only once something is typed: an empty bar lists
    // what runs.
    let later = LATER
        .iter()
        .filter(|(verb, _)| !typed.is_empty() && verb.starts_with(&typed))
        .map(|(verb, goal)| Item {
            text: (*verb).into(),
            label: (*verb).into(),
            detail: format!("Comes with {goal}"),
            later: true,
            kind: None,
        });
    built.chain(later).collect()
}

/// The name the caret is in, of a command that takes several between
/// commas: its span (from its first word to its last, or the caret alone
/// for a new one), and the other names already written.
fn name_at(text: &str, rest: &[Token], caret: usize) -> (std::ops::Range<usize>, Vec<String>) {
    let groups = groups(rest);
    // The commas outside quotes, in order: group `n` starts after the
    // `n`th.
    let mut commas = Vec::new();
    for token in rest.iter().filter(|token| !token.quoted) {
        commas.extend(
            token
                .text
                .match_indices(',')
                .map(|(at, _)| token.start + at),
        );
    }
    let at = commas.iter().filter(|&&comma| comma < caret).count();
    // The caret in a name, or in the gap before one: that name, from the
    // caret if it's before it (as `pin`'s gap is), replaced whole.
    let span = match groups.get(at).and_then(|group| group.span) {
        Some((start, end)) => start.min(caret)..end.max(caret),
        None => caret..caret,
    };
    let span = span.start.min(text.len())..span.end.min(text.len());
    let others = groups
        .iter()
        .enumerate()
        .filter(|(index, group)| *index != at && !group.words.is_empty())
        .map(|(_, group)| {
            group
                .words
                .iter()
                .map(|(word, _)| word.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect();
    (span, others)
}

/// The columns a verb could take (`takes`), in the order drawn, those
/// starting with what's typed first, then those holding it.
fn columns(typed: &str, catalog: &Catalog, takes: impl Fn(usize) -> bool) -> Vec<Item> {
    let typed = typed.to_lowercase();
    let view = &catalog.view;
    let side: Vec<usize> = view
        .order()
        .iter()
        .copied()
        .filter(|&index| takes(index))
        .collect();
    let name = |index: usize| view.columns()[index].name.to_lowercase();
    let starts = side
        .iter()
        .filter(|&&index| name(index).starts_with(&typed));
    let holds = side.iter().filter(|&&index| {
        let name = name(index);
        !name.starts_with(&typed) && name.contains(&typed)
    });
    starts
        .chain(holds)
        .take(MOST)
        .map(|&index| {
            let info = &view.columns()[index];
            Item {
                text: quote(&info.name),
                label: info.name.clone(),
                detail: info.data_type.clone(),
                later: false,
                kind: Some(kind(info)),
            }
        })
        .collect()
}

fn preview(text: &str, catalog: Option<&Catalog>, typing: bool) -> Preview {
    match parse(text) {
        Parsed::Empty => Preview {
            kind: "empty",
            steps: Vec::new(),
            text: None,
            error: false,
            json: None,
        },
        Parsed::Sentence => Preview::say("sentence", plan::SENTENCE, false),
        Parsed::Later { verb, goal, step } => {
            Preview::say("later", plan::later(verb, goal, step), false)
        }
        Parsed::Open => Preview::say("open", plan::OPEN, false),
        Parsed::Error(_) if typing => Preview::say("typing", "", false),
        Parsed::Error(why) => Preview::say("refused", why, true),
        Parsed::Action { steps, form } => {
            let Some(catalog) = catalog else {
                return Preview::say("nofile", plan::NO_FILE, false);
            };
            match plan::plan(&steps, catalog) {
                Ok(plan) => Preview {
                    kind: match form {
                        super::Form::Typed => "command",
                        super::Form::Json => "action",
                    },
                    json: Some(plan.json()),
                    steps: plan.steps.into_iter().map(|step| step.words).collect(),
                    text: None,
                    error: false,
                },
                Err(_) if typing => Preview::say("typing", "", false),
                Err(refusal) => Preview::say("refused", refusal.to_string(), refusal.error),
            }
        }
    }
}

/// A column's kind for its badge, as the table lays it out.
fn kind(info: &seiza_duckdb::sql::ColumnInfo) -> &'static str {
    crate::table::type_name(info)
}

/// The parts of a typed command whose verb the bar runs: the verb, then
/// what it takes, each `done`, `now`, or `next`.
fn slots(text: &str, part: Part, preview: &Preview) -> Vec<Slot> {
    let tokens = tokenize(text);
    let Some(first) = tokens.first().filter(|token| !token.quoted) else {
        return Vec::new();
    };
    let verb = first.text.to_lowercase();
    let takes = match verb.as_str() {
        "pin" | "unpin" => Some("column"),
        "hide" | "show" => Some("columns"),
        "jump" => Some("row"),
        "undo" => None,
        _ => return Vec::new(),
    };
    let whole = preview.kind == "command";
    let mut slots = vec![Slot {
        text: verb,
        state: if part == Part::Verb && !whole {
            "now"
        } else {
            "done"
        },
    }];
    if let Some(takes) = takes {
        slots.push(Slot {
            text: if whole {
                text[first.end..].trim().into()
            } else {
                takes.into()
            },
            state: match part {
                Part::Column | Part::Row if !whole => "now",
                _ if whole => "done",
                _ => "next",
            },
        });
    }
    slots
}

/// The byte offset of UTF-16 offset `units` in `text`, clamped to its end
/// and to a character's start.
fn byte_of(text: &str, units: usize) -> usize {
    let mut counted = 0;
    for (at, c) in text.char_indices() {
        if counted >= units {
            return at;
        }
        counted += c.len_utf16();
    }
    text.len()
}

fn utf16_of(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use seiza_duckdb::sql::ColumnInfo;

    use super::*;
    use crate::view::{Controller, SourceKind, SourceView};

    fn catalog() -> Catalog {
        let file = [
            ColumnInfo::new("id", "BIGINT"),
            ColumnInfo::new("launch date", "DATE"),
            ColumnInfo::new("mag", "DOUBLE"),
            ColumnInfo::new("magType", "VARCHAR"),
            ColumnInfo::new("日付", "DATE"),
        ];
        let mut view = Controller::of_file(
            SourceView {
                kind: SourceKind::Parquet,
                name: "quakes.parquet".into(),
                rows: 25_000,
            },
            &file,
        );
        view.pin(0).unwrap();
        Catalog {
            view,
            loading: false,
        }
    }

    fn at_end(text: &str) -> Completion {
        complete(text, text.encode_utf16().count(), Some(&catalog()))
    }

    fn labels(completion: &Completion) -> Vec<&str> {
        completion
            .items
            .iter()
            .map(|item| item.label.as_str())
            .collect()
    }

    #[test]
    fn verbs_first() {
        let empty = at_end("");
        assert_eq!(empty.part, Part::Verb);
        assert_eq!(
            labels(&empty),
            ["pin", "unpin", "hide", "show", "jump", "undo"]
        );
        assert_eq!(empty.preview.kind, "empty");
        let u = at_end("u");
        assert_eq!(labels(&u), ["unpin", "undo"]);
        assert_eq!((u.from, u.to), (0, 1));
        assert_eq!(u.preview.kind, "typing");
        // A later verb is listed with its goal once typed.
        let s = at_end("s");
        assert_eq!(labels(&s), ["show", "sort", "sql"]);
        assert!(!s.items[0].later && s.items[1..].iter().all(|item| item.later));
        assert_eq!(s.items[1].detail, "Comes with sort, filter, and find");
    }

    #[test]
    fn columns_with_their_types() {
        let pin = at_end("pin ");
        assert_eq!(pin.part, Part::Column);
        assert_eq!((pin.from, pin.to), (4, 4));
        // `id` is pinned: `pin` offers the others, in the order drawn.
        assert_eq!(labels(&pin), ["launch date", "mag", "magType", "日付"]);
        assert_eq!(pin.items[0].text, "\"launch date\"");
        assert_eq!(pin.items[1].detail, "DOUBLE");
        assert_eq!(labels(&at_end("unpin ")), ["id"]);
        // Starting with it, then holding it.
        assert_eq!(labels(&at_end("pin TYPE")), ["magType"]);
        assert_eq!(labels(&at_end("pin ma")), ["mag", "magType"]);
        // A whole name: its words before Enter.
        let mag = at_end("pin mag");
        assert_eq!(mag.preview.kind, "command");
        assert_eq!(mag.preview.steps, ["Pin mag"]);
        // Bare words run to the end, replaced whole.
        let spaced = at_end("pin launch d");
        assert_eq!(labels(&spaced), ["launch date"]);
        assert_eq!((spaced.from, spaced.to), (4, 12));
        assert_eq!(spaced.preview.kind, "typing");
        // An open quote.
        let quoted = at_end("pin \"laun");
        assert_eq!(labels(&quoted), ["launch date"]);
        assert_eq!((quoted.from, quoted.to), (4, 9));
        // The caret in a name of bare words: the whole name is replaced.
        let inside = complete("pin launch date", 6, Some(&catalog()));
        assert_eq!(labels(&inside), ["launch date"]);
        assert_eq!((inside.from, inside.to), (4, 15));
        // The caret in the gap before a name: from the caret to its end.
        let gap = complete("pin  mag", 4, Some(&catalog()));
        assert_eq!((gap.from, gap.to), (4, 8));
        assert_eq!(gap.items.len(), 4);
        // The caret mid-line: the word it's in.
        let mid = complete("pin ma", 2, Some(&catalog()));
        assert_eq!(mid.part, Part::Verb);
        assert_eq!(labels(&mid), ["pin"]);
    }

    #[test]
    fn hide_offers_shown_columns_and_show_hidden_ones() {
        let mut hidden = catalog();
        hidden.view.hide(2).unwrap();
        hidden.view.hide(3).unwrap();
        let at = |text: &str, catalog: &Catalog| {
            complete(text, text.encode_utf16().count(), Some(catalog))
        };
        let hide = at("hide ", &hidden);
        assert_eq!(hide.part, Part::Column);
        assert_eq!(labels(&hide), ["id", "launch date", "日付"]);
        // A name written already isn't offered again.
        assert_eq!(labels(&at("hide id, ", &hidden)), ["launch date", "日付"]);
        // The name being typed is the one after the last comma.
        let typing = at("hide id, lau", &hidden);
        assert_eq!(labels(&typing), ["launch date"]);
        assert_eq!((typing.from, typing.to), (9, 12));
        assert_eq!(typing.preview.kind, "typing");
        // `show` offers the hidden ones, `all` first while it's the one name.
        let show = at("show ", &hidden);
        assert_eq!(labels(&show), ["all", "mag", "magType"]);
        assert_eq!(show.items[0].detail, "2 hidden columns");
        assert_eq!(labels(&at("show mag, ", &hidden)), ["magType"]);
        assert_eq!(labels(&at("show ", &catalog())), Vec::<&str>::new());
        // `pin` doesn't offer a hidden column.
        assert_eq!(labels(&at("pin ", &hidden)), ["launch date", "日付"]);
        // The caret in the gap after a comma: the next name, from the caret.
        let gap = complete("hide id, mag", 8, Some(&hidden));
        assert_eq!((gap.from, gap.to), (8, 12));
        // The caret in the first name of several: that name, whole.
        let inside = complete("hide id, mag", 6, Some(&hidden));
        assert_eq!((inside.from, inside.to), (5, 7));
        let whole = at("hide id, \"launch date\"", &hidden);
        assert_eq!(whole.preview.kind, "command");
        assert_eq!(whole.preview.steps, [r#"Hide id and "launch date""#]);
        assert_eq!(
            whole.preview.json.as_deref(),
            Some(r#"{"hide":["id","launch date"]}"#)
        );
    }

    #[test]
    fn offsets_are_utf16() {
        // `日付` is two UTF-16 units, six bytes.
        let text = "pin 日";
        let completion = at_end(text);
        assert_eq!(labels(&completion), ["日付"]);
        assert_eq!((completion.from, completion.to), (4, 5));
        assert_eq!(byte_of(text, 5), text.len());
        assert_eq!(utf16_of(text, text.len()), 5);
    }

    #[test]
    fn what_enter_would_do() {
        let refused = at_end("pin zzzz");
        assert_eq!(refused.preview.kind, "refused");
        assert_eq!(
            refused.preview.text.as_deref(),
            Some("No column zzzz in this file.")
        );
        let pinned = at_end("pin id");
        // `id` is pinned: no item, so an answer, not a fault.
        assert_eq!(pinned.preview.kind, "refused");
        assert!(!pinned.preview.error);
        let action = at_end(r#"{"actions": [{"pin": {"column": "mag"}}, {"jump": {"row": 3}}]}"#);
        assert_eq!(action.part, Part::None);
        assert_eq!(action.preview.kind, "action");
        assert_eq!(action.preview.steps, ["Pin mag", "Jump to row 3"]);
        assert_eq!(at_end("which rows are big").preview.kind, "sentence");
        assert_eq!(at_end("sort mag").preview.kind, "later");
        assert_eq!(at_end("jump 12").part, Part::Row);
        assert_eq!(at_end("jump 12").preview.steps, ["Jump to row 12"]);
        assert_eq!(complete("pin mag", 7, None).preview.kind, "nofile");
    }

    #[test]
    fn what_a_command_becomes() {
        let one = at_end("pin MAG");
        assert_eq!(
            one.preview.json.as_deref(),
            Some(r#"{"pin":{"column":"mag"}}"#)
        );
        let two = at_end(r#"{"actions": [{"pin": {"column": "mag"}}, {"jump": {"row": "3"}}]}"#);
        assert_eq!(
            two.preview.json.as_deref(),
            Some(r#"{"actions":[{"pin":{"column":"mag"}},{"jump":{"row":3}}]}"#)
        );
        assert_eq!(
            at_end("undo").preview.json.as_deref(),
            Some(r#"{"undo":{}}"#)
        );
        assert_eq!(at_end("pin nope").preview.json, None);
    }

    #[test]
    fn slots_and_kinds() {
        let slots = |text: &str| -> Vec<(String, &str)> {
            at_end(text)
                .slots
                .into_iter()
                .map(|slot| (slot.text, slot.state))
                .collect()
        };
        assert_eq!(
            slots("pin"),
            [("pin".into(), "now"), ("column".into(), "next")]
        );
        assert_eq!(
            slots("pin ma"),
            [("pin".into(), "done"), ("column".into(), "now")]
        );
        assert_eq!(
            slots("pin mag"),
            [("pin".into(), "done"), ("mag".into(), "done")]
        );
        assert_eq!(
            slots("jump "),
            [("jump".into(), "done"), ("row".into(), "now")]
        );
        assert_eq!(slots("undo"), [("undo".into(), "done")]);
        assert_eq!(
            slots("hide nst"),
            [("hide".into(), "done"), ("columns".into(), "now")]
        );
        assert!(slots("sort mag").is_empty());
        assert!(slots("how many").is_empty());
        let kinds: Vec<_> = at_end("pin ")
            .items
            .iter()
            .map(|item| (item.label.clone(), item.kind))
            .collect();
        assert!(kinds.contains(&("mag".into(), Some("number"))), "{kinds:?}");
        assert!(at_end("p").items.iter().all(|item| item.kind.is_none()));
    }
}
