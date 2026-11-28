//! Completion: for the bar's text and its caret, the part being typed (a
//! verb, a column, a row), what matches it, and what the line would do on
//! Enter. Synchronous, so it keeps up with typing (`docs/DECISIONS.md`,
//! "Scope", 2026-11-24, "The thread's two proposed items are taken").
//! Offsets are the page's: UTF-16 code units.

use serde::Serialize;

use super::plan::{self, Catalog};
use super::{
    FilterLine, LATER, Parsed, Token, VERBS, groups, parse, quote, split_filter, tokenize,
};
use crate::filter::{Arity, Direction, Kind, Op};

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
    /// then `row`, `filter` then `column`, `operator`, and `value`, `sort`
    /// then `column` and `direction`, `clear` then `what`, `find` then
    /// `text`, `undo` alone, a catalog entry its parts (`top` then
    /// `column` and `count`).
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
    /// A filter's operator, after its column.
    Operator,
    /// A filter's value or values, after its operator.
    Value,
    /// A sort's `asc` or `desc`, after its column.
    Direction,
    /// What `clear` removes.
    Clear,
    /// Find's text.
    Text,
    /// A catalog entry's count, after its column (`top orbit 10`).
    Count,
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
    /// A part follows it: the bar puts a space after it.
    pub space: bool,
}

impl Item {
    /// A word of the grammar: an operator, a direction, `clear`'s part.
    fn word(text: &str, detail: impl Into<String>, space: bool) -> Self {
        Self {
            text: text.into(),
            label: text.into(),
            detail: detail.into(),
            later: false,
            kind: None,
            space,
        }
    }
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
    let after = text[span.end..].trim().is_empty();
    let typing = !items.is_empty() && after;
    // A value or a term not begun, the caret where it goes: the line isn't
    // whole yet, and what's wrong with it is said once something's typed.
    let incomplete =
        typing || (matches!(part, Part::Value | Part::Text) && after && span.is_empty());
    let preview = preview(text, catalog, typing, incomplete);
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
    if tokens[0].quoted {
        return (Part::None, caret..caret, Vec::new());
    }
    let rest = &tokens[1..];
    match verb.as_str() {
        "pin" | "unpin" => {
            let Some(span) = name_span(rest, caret) else {
                return (Part::None, caret..caret, Vec::new());
            };
            let typed = typed_part(text, span.start, caret);
            let items = catalog.map_or_else(Vec::new, |catalog| {
                let pin = verb == "pin";
                let view = &catalog.view;
                // `pin` takes a shown column; `unpin` any pinned one.
                columns(&typed, catalog, false, |index| {
                    view.is_pinned(index) != pin && !(pin && view.is_hidden(index))
                })
            });
            (Part::Column, span, items)
        }
        "filter" => filter_part(text, rest, caret, catalog),
        "sort" => sort_part(text, rest, caret, catalog),
        "clear" => clear_part(text, rest, caret, catalog),
        "find" => {
            let start = rest.first().map_or(caret, |token| token.start.min(caret));
            (
                Part::Text,
                start..text.trim_end().len().max(caret),
                Vec::new(),
            )
        }
        "hide" | "show" => {
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
                        space: false,
                    });
                }
                items.extend(columns(&typed, catalog, false, |index| {
                    view.is_hidden(index) != hide && !named(index)
                }));
                items
            });
            (Part::Column, span, items)
        }
        word if let Some(entry) = crate::catalog::entry(word) => {
            ask_part(text, entry, rest, caret, catalog)
        }
        "jump" => {
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

/// A bare count, as `parse` reads one after an entry's column.
fn is_count(token: &Token) -> bool {
    !token.quoted && token.text.chars().all(|c| c.is_ascii_digit() || c == ',')
}

/// A catalog entry's parts: its column, the columns of a type it takes;
/// then its count, if it takes one, once the column is written.
fn ask_part(
    text: &str,
    entry: &'static crate::catalog::Entry,
    rest: &[Token],
    caret: usize,
    catalog: Option<&Catalog>,
) -> (Part, std::ops::Range<usize>, Vec<Item>) {
    let counted = entry.count_part().is_some();
    if counted && let Some(catalog) = catalog {
        // The caret in or just after a number after the column.
        if let Some((last, names)) = rest.split_last()
            && is_count(last)
            && caret >= last.start
            && caret <= last.end
            && column_of(names, catalog).is_some()
        {
            return (Part::Count, last.start..last.end, Vec::new());
        }
        // The caret past a whole column, a space after it.
        if let Some(last) = rest.last()
            && caret > last.end
        {
            if is_count(last) && rest.len() > 1 {
                return (Part::None, caret..caret, Vec::new());
            }
            if column_of(rest, catalog).is_some() {
                return (Part::Count, caret..caret, Vec::new());
            }
        }
    }
    column_part(text, rest, caret, catalog, counted, |catalog, index| {
        entry.takes(Kind::of(&catalog.view.columns()[index]))
    })
}

/// The span of a command's one column, written in `names` (the words after
/// its verb, or after `clear filter`): a quoted name is one word; bare
/// words run from the first to the last (`pin launch d`), wherever the
/// caret is in them. None with the caret past a quoted name.
fn name_span(names: &[Token], caret: usize) -> Option<std::ops::Range<usize>> {
    match names.first() {
        Some(first) if first.quoted => {
            if caret > first.end {
                None
            } else if caret >= first.start {
                Some(first.start..first.end)
            } else {
                Some(caret..caret)
            }
        }
        Some(first) => {
            let last = names.last().map_or(caret, |token| token.end);
            Some(first.start.min(caret)..last.max(caret))
        }
        None => Some(caret..caret),
    }
}

/// The open file's column `names` names, as `plan` resolves it: one word,
/// or bare words as one name.
fn column_of(names: &[Token], catalog: &Catalog) -> Option<usize> {
    let text = match names {
        [] => return None,
        [one] => one.text.clone(),
        _ if names.iter().all(|token| !token.quoted) => names
            .iter()
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>()
            .join(" "),
        _ => return None,
    };
    let name = super::Name {
        text,
        spaced: names.len() > 1,
    };
    plan::resolve(&name, catalog.view.columns()).ok()
}

/// A column part over `names`: the file's columns matching what's typed.
fn column_part(
    text: &str,
    names: &[Token],
    caret: usize,
    catalog: Option<&Catalog>,
    space: bool,
    takes: impl Fn(&Catalog, usize) -> bool,
) -> (Part, std::ops::Range<usize>, Vec<Item>) {
    let Some(span) = name_span(names, caret) else {
        return (Part::None, caret..caret, Vec::new());
    };
    let typed = typed_part(text, span.start, caret);
    let items = catalog.map_or_else(Vec::new, |catalog| {
        columns(&typed, catalog, space, |index| takes(catalog, index))
    });
    (Part::Column, span, items)
}

/// A part after a column: the column's words then the caret past them, or
/// the caret in a last word that starts one of `words` (which `matching`
/// lists for what's typed). The column, the part's span, and what's typed.
fn after_column(
    text: &str,
    words: &[Token],
    caret: usize,
    catalog: &Catalog,
    matching: impl Fn(usize, &str) -> bool,
) -> Option<(usize, std::ops::Range<usize>, String)> {
    let last = words.last()?;
    if caret > last.end {
        let column = column_of(words, catalog)?;
        return Some((column, caret..caret, String::new()));
    }
    let (last, names) = words.split_last()?;
    if last.quoted || caret < last.start || names.is_empty() {
        return None;
    }
    let column = column_of(names, catalog)?;
    let typed = text[last.start..caret].to_owned();
    matching(column, &typed).then_some((column, last.start..last.end, typed))
}

/// The operators column `column`'s type takes, those starting with what's
/// typed, each with its words.
fn operators(catalog: &Catalog, column: usize, typed: &str) -> Vec<Item> {
    let kind = Kind::of(&catalog.view.columns()[column]);
    // Its words a space apart: `is  n` is `is n`.
    let mut words = typed.split_whitespace().collect::<Vec<_>>().join(" ");
    if typed.ends_with(char::is_whitespace) && !words.is_empty() {
        words.push(' ');
    }
    let typed = words.to_lowercase();
    kind.ops()
        .filter(|op| {
            // `not null` is read as `is not null` too.
            op.as_str().starts_with(&typed)
                || (*op == Op::NotNull && "is not null".starts_with(&typed))
        })
        .map(|op| Item::word(op.as_str(), op.words(kind), op.arity() != Arity::None))
        .collect()
}

fn filter_part(
    text: &str,
    rest: &[Token],
    caret: usize,
    catalog: Option<&Catalog>,
) -> (Part, std::ops::Range<usize>, Vec<Item>) {
    let FilterLine { column, op, values } = split_filter(rest);
    let any = |_: &Catalog, _: usize| true;
    let Some(op) = op else {
        // No operator yet: one after a whole column, or the column.
        if let Some(catalog) = catalog
            && let Some((index, span, typed)) =
                after_column(text, &column, caret, catalog, |index, typed| {
                    !operators(catalog, index, typed).is_empty()
                })
        {
            return (Part::Operator, span, operators(catalog, index, &typed));
        }
        return column_part(text, &column, caret, catalog, true, any);
    };
    if caret < op.start {
        return column_part(text, &column, caret, catalog, true, any);
    }
    let resolved = catalog.and_then(|catalog| Some((catalog, column_of(&column, catalog)?)));
    // In the operator, or after an `is` or a `not` still to be finished,
    // its next word (`is n`) the operator's too.
    let unfinished = matches!(op.text.as_str(), "is" | "not" | "is not");
    let finishing = match values.as_slice() {
        [] => true,
        [word] => !word.quoted && caret <= word.end,
        _ => false,
    };
    if caret <= op.end || (unfinished && finishing) {
        let end = values.first().map_or(op.end, |word| word.end);
        let span = op.start..end.max(caret);
        let items = resolved.map_or_else(Vec::new, |(catalog, index)| {
            operators(catalog, index, &text[op.start..caret])
        });
        return (Part::Operator, span, items);
    }
    let Some(read) = Op::read(&op.text) else {
        return (Part::None, caret..caret, Vec::new());
    };
    // The value the caret is in, or a new one at it.
    let at = values
        .iter()
        .position(|value| value.start <= caret && caret <= value.end);
    let span = at.map_or(caret..caret, |at| values[at].start..values[at].end);
    let typed = text[span.start..caret].to_lowercase();
    let mut items = Vec::new();
    if read == Op::Between {
        // `and` after the first value.
        let second = match at {
            Some(1) => true,
            None => values.len() == 1 && caret > values[0].end,
            _ => false,
        };
        if second && "and".starts_with(&typed) {
            items.push(Item::word("and", "Then the second value", true));
        }
    } else if read.arity() == Arity::One
        && let Some((catalog, index)) = resolved
        && Kind::of(&catalog.view.columns()[index]) == Kind::Boolean
    {
        items.extend(
            ["true", "false"]
                .into_iter()
                .filter(|word| word.starts_with(&typed))
                .map(|word| Item::word(word, "", false)),
        );
    }
    (Part::Value, span, items)
}

/// The directions of column `column`, its type's first first, those
/// starting with what's typed.
fn directions(catalog: &Catalog, column: usize, typed: &str) -> Vec<Item> {
    let info = &catalog.view.columns()[column];
    let kind = Kind::of(info);
    let first = crate::filter::first_direction(info);
    let other = match first {
        Direction::Asc => Direction::Desc,
        Direction::Desc => Direction::Asc,
    };
    let typed = typed.to_lowercase();
    [first, other]
        .into_iter()
        .filter(|direction| direction.as_str().starts_with(&typed))
        .map(|direction| Item::word(direction.as_str(), kind.order_words(direction), false))
        .collect()
}

fn sort_part(
    text: &str,
    rest: &[Token],
    caret: usize,
    catalog: Option<&Catalog>,
) -> (Part, std::ops::Range<usize>, Vec<Item>) {
    if let Some(catalog) = catalog
        && catalog.view.is_sortable()
        && let Some((index, span, typed)) =
            after_column(text, rest, caret, catalog, |index, typed| {
                !directions(catalog, index, typed).is_empty()
            })
    {
        return (Part::Direction, span, directions(catalog, index, &typed));
    }
    // A whole sort, the caret past its direction: nothing more.
    if let Some((last, names)) = rest.split_last()
        && caret > last.end
        && !last.quoted
        && ["asc", "desc"].contains(&last.text.to_lowercase().as_str())
        && catalog.is_some_and(|catalog| column_of(names, catalog).is_some())
    {
        return (Part::None, caret..caret, Vec::new());
    }
    column_part(text, rest, caret, catalog, true, |catalog, _| {
        catalog.view.is_sortable()
    })
}

fn clear_part(
    text: &str,
    rest: &[Token],
    caret: usize,
    catalog: Option<&Catalog>,
) -> (Part, std::ops::Range<usize>, Vec<Item>) {
    match rest.first() {
        Some(first) if caret > first.end => {
            if !first.quoted && first.text.eq_ignore_ascii_case("filter") {
                // `clear filter` takes a column with a filter on it.
                column_part(text, &rest[1..], caret, catalog, false, |catalog, index| {
                    let name = &catalog.view.columns()[index].name;
                    catalog
                        .view
                        .filters()
                        .iter()
                        .any(|filter| &filter.column == name)
                })
            } else {
                (Part::None, caret..caret, Vec::new())
            }
        }
        first => {
            // The caret in the gap before the word: from the caret.
            let span = first.map_or(caret..caret, |first| first.start.min(caret)..first.end);
            let typed = text[span.start..caret].to_lowercase();
            let items = catalog.map_or_else(Vec::new, |catalog| {
                let view = &catalog.view;
                let filters = view.filters().len();
                let sort = view.sort().map(|(index, direction)| {
                    let info = &view.columns()[index];
                    format!("{}, {}", info.name, Kind::of(info).order_words(direction))
                });
                let mut items = Vec::new();
                if filters > 0 {
                    items.push(Item::word("filter", "Every filter on a column", true));
                    items.push(Item::word(
                        "filters",
                        if filters == 1 {
                            "The one filter".to_owned()
                        } else {
                            format!("All {filters} filters")
                        },
                        false,
                    ));
                }
                if let Some(sort) = &sort {
                    items.push(Item::word("sort", sort.clone(), false));
                }
                if filters > 0 && sort.is_some() {
                    items.push(Item::word("all", "The filters and the sort", false));
                }
                items.retain(|item| item.text.starts_with(&typed));
                items
            });
            (Part::Clear, span, items)
        }
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
            space: *verb != "undo",
        });
    let asks = crate::catalog::ENTRIES
        .iter()
        .filter(|entry| entry.name.starts_with(&typed))
        .map(|entry| Item {
            text: entry.name.into(),
            label: entry.name.into(),
            detail: entry.hint.into(),
            later: false,
            kind: None,
            space: true,
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
            space: false,
        });
    built.chain(asks).chain(later).collect()
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
/// starting with what's typed first, then those holding it; `space` when a
/// part follows the column.
fn columns(
    typed: &str,
    catalog: &Catalog,
    space: bool,
    takes: impl Fn(usize) -> bool,
) -> Vec<Item> {
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
                detail: catalog
                    .lines
                    .get(&info.name)
                    .cloned()
                    .unwrap_or_else(|| info.data_type.clone()),
                later: false,
                kind: Some(kind(info)),
                space,
            }
        })
        .collect()
}

/// What Enter would do: `typing` while the part being typed has matches,
/// `incomplete` (`typing`, or a value or a term to come) hiding a line
/// that doesn't parse yet.
fn preview(text: &str, catalog: Option<&Catalog>, typing: bool, incomplete: bool) -> Preview {
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
        Parsed::Error(_) if incomplete => Preview::say("typing", "", false),
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
/// what it takes, each `done`, `now`, or `next`. A part is shown by its
/// name (`column`) until it's written and the caret has gone past it; a
/// whole command shows what's written of each.
fn slots(text: &str, part: Part, preview: &Preview) -> Vec<Slot> {
    let tokens = tokenize(text);
    let Some(first) = tokens.first().filter(|token| !token.quoted) else {
        return Vec::new();
    };
    let verb = first.text.to_lowercase();
    let rest = &tokens[1..];
    let span = |tokens: &[Token]| match (tokens.first(), tokens.last()) {
        (Some(first), Some(last)) => Some(text[first.start..last.end].to_owned()),
        _ => None,
    };
    let all = span(rest);
    let (names, written): (&[&str], Vec<Option<String>>) = match verb.as_str() {
        "pin" | "unpin" => (&["column"], vec![all]),
        "hide" | "show" => (&["columns"], vec![all]),
        "jump" => (&["row"], vec![all]),
        "find" => (&["text"], vec![all]),
        "undo" => (&[], Vec::new()),
        word if let Some(entry) = crate::catalog::entry(word) => match rest.split_last() {
            Some((last, names))
                if entry.count_part().is_some() && !names.is_empty() && is_count(last) =>
            {
                (
                    &["column", "count"],
                    vec![span(names), Some(last.text.clone())],
                )
            }
            _ if entry.count_part().is_some() => (&["column", "count"], vec![all, None]),
            _ => (&["column"], vec![all]),
        },
        "filter" => {
            let line = split_filter(rest);
            (
                &["column", "operator", "value"],
                vec![
                    span(&line.column),
                    line.op.map(|op| text[op.start..op.end].to_owned()),
                    span(&line.values),
                ],
            )
        }
        "sort" => {
            let direction = rest.split_last().filter(|(last, names)| {
                !names.is_empty()
                    && !last.quoted
                    && ["asc", "desc"].contains(&last.text.to_lowercase().as_str())
            });
            match direction {
                Some((last, names)) => (
                    &["column", "direction"],
                    vec![span(names), Some(last.text.clone())],
                ),
                None => (&["column", "direction"], vec![all, None]),
            }
        }
        "clear" => match rest.split_first() {
            Some((what, names)) if !what.quoted && what.text.eq_ignore_ascii_case("filter") => (
                &["what", "column"],
                vec![Some(what.text.clone()), span(names)],
            ),
            _ => (&["what"], vec![all]),
        },
        _ => return Vec::new(),
    };
    let whole = preview.kind == "command";
    let now = match part {
        Part::Column => names.iter().position(|name| name.starts_with("column")),
        Part::Row | Part::Clear | Part::Text => Some(0),
        Part::Operator | Part::Direction | Part::Count => Some(1),
        Part::Value => Some(2),
        Part::Verb | Part::None => None,
    };
    let mut slots = vec![Slot {
        text: verb,
        state: if part == Part::Verb && !whole {
            "now"
        } else {
            "done"
        },
    }];
    for (index, (name, written)) in names.iter().zip(written).enumerate() {
        let slot = match written {
            // A part a whole command may leave out (a sort's direction):
            // shown while the caret is in it, else not.
            None if now == Some(index) => Slot {
                text: (*name).into(),
                state: "now",
            },
            None if whole => continue,
            Some(written) if whole => Slot {
                text: written,
                state: "done",
            },
            _ if now == Some(index) => Slot {
                text: (*name).into(),
                state: "now",
            },
            Some(written) if now.is_some_and(|now| index < now) => Slot {
                text: written,
                state: "done",
            },
            _ => Slot {
                text: (*name).into(),
                state: "next",
            },
        };
        slots.push(slot);
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
            lines: Default::default(),
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
            [
                "filter", "sort", "find", "pin", "unpin", "hide", "show", "jump", "clear", "undo",
                "top", "nulls", "distinct"
            ]
        );
        // A verb takes a space after it, ready for its part; undo none.
        assert!(
            empty
                .items
                .iter()
                .all(|item| item.space == (item.label != "undo"))
        );
        assert_eq!(empty.preview.kind, "empty");
        let u = at_end("u");
        assert_eq!(labels(&u), ["unpin", "undo"]);
        assert_eq!((u.from, u.to), (0, 1));
        assert_eq!(u.preview.kind, "typing");
        // A later verb is listed with its goal once typed.
        let s = at_end("s");
        assert_eq!(labels(&s), ["sort", "show", "sql"]);
        assert!(!s.items[1].later && s.items[2].later);
        assert_eq!(s.items[2].detail, "Comes with export");
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
    fn filter_completes_a_part_at_a_time() {
        // Every column, a space after it: the operator follows.
        let filter = at_end("filter ");
        assert_eq!(filter.part, Part::Column);
        assert_eq!(
            labels(&filter),
            ["id", "launch date", "mag", "magType", "日付"]
        );
        assert!(filter.items.iter().all(|item| item.space));
        // A name being typed: still the column, while it matches.
        let typing = at_end("filter ma");
        assert_eq!(labels(&typing), ["mag", "magType"]);
        assert_eq!(typing.preview.kind, "typing");
        // A whole column and a space: its type's operators, in words.
        let ops = at_end("filter mag ");
        assert_eq!(ops.part, Part::Operator);
        assert_eq!(
            labels(&ops),
            [
                "=", "!=", ">", ">=", "<", "<=", "in", "between", "is null", "not null"
            ]
        );
        assert_eq!(ops.items[3].detail, "is at least");
        assert!(ops.items[3].space && !ops.items[8].space);
        assert_eq!(ops.preview.kind, "typing");
        let text = at_end("filter magType ");
        assert_eq!(
            labels(&text),
            ["=", "!=", "contains", "starts", "in", "is null", "not null"]
        );
        let time = at_end(r#"filter "launch date" "#);
        assert_eq!(time.items[2].detail, "is after");
        // The operator being typed, a word or its symbols.
        let word = at_end("filter magType con");
        assert_eq!(
            (word.part, labels(&word)),
            (Part::Operator, vec!["contains"])
        );
        assert_eq!((word.from, word.to), (15, 18));
        let symbols = at_end("filter mag >");
        assert_eq!(
            (symbols.part, labels(&symbols)),
            (Part::Operator, vec![">", ">="])
        );
        let is = at_end("filter mag is ");
        // `is not null` is `not null`'s too.
        assert_eq!(
            (is.part, labels(&is)),
            (Part::Operator, vec!["is null", "not null"])
        );
        assert_eq!((is.from, is.to), (11, 14));
        // A name of bare words, the operator after it.
        assert_eq!(at_end("filter launch date ").part, Part::Operator);
        // The value: nothing to offer, and no refusal while it's to come.
        let value = at_end("filter mag >= ");
        assert_eq!((value.part, value.items.len()), (Part::Value, 0));
        assert_eq!(value.preview.kind, "typing");
        let whole = at_end("filter mag >= 4.5");
        assert_eq!(whole.part, Part::Value);
        assert_eq!(whole.preview.kind, "command");
        assert_eq!(whole.preview.steps, ["Keep rows where mag is at least 4.5"]);
        // A value that isn't the column's type: said before Enter.
        let wrong = at_end("filter mag >= big");
        assert_eq!(wrong.preview.kind, "refused");
        assert_eq!(
            wrong.preview.text.as_deref(),
            Some("big isn't a number, and mag holds numbers.")
        );
        // between's and.
        let between = at_end("filter mag between 1 ");
        assert_eq!(labels(&between), ["and"]);
        assert_eq!(labels(&at_end("filter mag between 1 a")), ["and"]);
        assert!(at_end("filter mag between 1 and ").items.is_empty());
    }

    #[test]
    fn a_booleans_values_and_sorts_directions() {
        let file = [
            ColumnInfo::new("crewed", "BOOLEAN"),
            ColumnInfo::new("name", "VARCHAR"),
            ColumnInfo::new("launched", "DATE"),
        ];
        let catalog = Catalog {
            view: Controller::of_file(
                SourceView {
                    kind: SourceKind::Parquet,
                    name: "gcat.parquet".into(),
                    rows: 10,
                },
                &file,
            ),
            loading: false,
            lines: Default::default(),
        };
        let at = |text: &str| complete(text, text.encode_utf16().count(), Some(&catalog));
        assert_eq!(
            labels(&at("filter crewed ")),
            ["=", "!=", "is null", "not null"]
        );
        assert_eq!(labels(&at("filter crewed = ")), ["true", "false"]);
        assert_eq!(labels(&at("filter crewed = f")), ["false"]);
        assert_eq!(
            at("filter crewed = TRUE").preview.steps,
            ["Keep rows where crewed is true"]
        );
        // A sort's directions, the type's first first, in its words.
        let sort = at("sort launched ");
        assert_eq!(sort.part, Part::Direction);
        assert_eq!(labels(&sort), ["desc", "asc"]);
        assert_eq!(sort.items[0].detail, "newest first");
        assert_eq!(labels(&at("sort name ")), ["asc", "desc"]);
        assert_eq!(at("sort name ").items[0].detail, "A to Z");
        let typed = at("sort name d");
        assert_eq!(
            (typed.part, labels(&typed)),
            (Part::Direction, vec!["desc"])
        );
        assert_eq!(at("sort name desc ").part, Part::None);
        // The sort's column: every column, a space after it.
        let column = at("sort ");
        assert_eq!(column.part, Part::Column);
        assert!(column.items.iter().all(|item| item.space));
        assert_eq!(at("sort name").preview.steps, ["Sort by name, A to Z"]);
        // A file too large to sort offers no column.
        let large = Catalog {
            view: catalog.view.clone().unsortable("too large".into()),
            loading: false,
            lines: Default::default(),
        };
        let refused = complete("sort ", 5, Some(&large));
        assert!(refused.items.is_empty());
        assert!(complete("sort name ", 10, Some(&large)).part != Part::Direction);
    }

    #[test]
    fn clear_offers_what_there_is() {
        let mut catalog = catalog();
        let at = |text: &str, catalog: &Catalog| {
            complete(text, text.encode_utf16().count(), Some(catalog))
        };
        assert!(at("clear ", &catalog).items.is_empty());
        assert_eq!(at("clear ", &catalog).part, Part::Clear);
        catalog.view = plan::plan(
            &match parse(r#"{"actions": [{"filter": {"column": "mag", "op": ">", "value": 1}}, {"sort": {"column": "mag"}}]}"#) {
                Parsed::Action { steps, .. } => steps,
                other => panic!("{other:?}"),
            },
            &catalog,
        )
        .unwrap()
        .view;
        let clear = at("clear ", &catalog);
        assert_eq!(labels(&clear), ["filter", "filters", "sort", "all"]);
        assert_eq!(clear.items[1].detail, "The one filter");
        assert_eq!(clear.items[2].detail, "mag, largest first");
        assert_eq!(labels(&at("clear f", &catalog)), ["filter", "filters"]);
        // `clear filter`: the columns with a filter.
        let column = at("clear filter ", &catalog);
        assert_eq!((column.part, labels(&column)), (Part::Column, vec!["mag"]));
        assert_eq!(
            at("clear all", &catalog).preview.steps,
            ["Clear the filter and the sort"]
        );
    }

    #[test]
    fn review_fixes() {
        // The caret in a gap before clear's word: no slice backwards.
        let gap = complete("clear  filters", 6, Some(&catalog()));
        assert_eq!((gap.part, gap.from, gap.to), (Part::Clear, 6, 14));
        complete("clear  filter mag", 6, Some(&catalog()));
        // `is null` and `not null` while their last word is typed.
        let is = at_end("filter mag is n");
        assert_eq!(
            (is.part, labels(&is)),
            (Part::Operator, vec!["is null", "not null"])
        );
        assert_eq!((is.from, is.to), (11, 15));
        assert_eq!(is.preview.kind, "typing");
        assert_eq!(labels(&at_end("filter mag is  nu")), ["is null"]);
        assert_eq!(labels(&at_end("filter mag is no")), ["not null"]);
        assert_eq!(labels(&at_end("filter mag is not ")), ["not null"]);
        assert_eq!(labels(&at_end("filter mag is not n")), ["not null"]);
        assert_eq!(labels(&at_end("filter mag not n")), ["not null"]);
        // A value typed and wrong is said before Enter; one not begun isn't.
        let spaced = at_end("filter magType = United States");
        assert_eq!(spaced.preview.kind, "refused");
        assert!(spaced.preview.text.unwrap().contains("double quotes"));
        assert_eq!(at_end("filter magType is null x").preview.kind, "refused");
        assert_eq!(at_end("filter mag >= ").preview.kind, "typing");
        assert_eq!(at_end("filter mag between 1 and ").preview.kind, "typing");
        assert_eq!(at_end("find ").preview.kind, "typing");
    }

    #[test]
    fn the_new_verbs_slots() {
        let slots = |text: &str| -> Vec<(String, &str)> {
            at_end(text)
                .slots
                .into_iter()
                .map(|slot| (slot.text, slot.state))
                .collect()
        };
        let owned = |slots: &[(&str, &'static str)]| -> Vec<(String, &'static str)> {
            slots
                .iter()
                .map(|(text, state)| ((*text).to_owned(), *state))
                .collect()
        };
        assert_eq!(
            slots("filter ma"),
            owned(&[
                ("filter", "done"),
                ("column", "now"),
                ("operator", "next"),
                ("value", "next")
            ])
        );
        assert_eq!(
            slots("filter mag "),
            owned(&[
                ("filter", "done"),
                ("mag", "done"),
                ("operator", "now"),
                ("value", "next")
            ])
        );
        assert_eq!(
            slots("filter mag >= "),
            owned(&[
                ("filter", "done"),
                ("mag", "done"),
                (">=", "done"),
                ("value", "now")
            ])
        );
        assert_eq!(
            slots("filter mag >= 4.5"),
            owned(&[
                ("filter", "done"),
                ("mag", "done"),
                (">=", "done"),
                ("4.5", "done")
            ])
        );
        assert_eq!(
            slots("sort mag "),
            owned(&[("sort", "done"), ("mag", "done"), ("direction", "now")])
        );
        // A whole sort without its direction shows none.
        assert_eq!(
            slots("sort mag"),
            owned(&[("sort", "done"), ("mag", "done")])
        );
        assert_eq!(slots("find "), owned(&[("find", "done"), ("text", "now")]));
        assert_eq!(
            slots("clear "),
            owned(&[("clear", "done"), ("what", "now")])
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
        assert_eq!(at_end("group mag").preview.kind, "later");
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
        assert!(slots("group mag").is_empty());
        assert!(slots("how many").is_empty());
        let kinds: Vec<_> = at_end("pin ")
            .items
            .iter()
            .map(|item| (item.label.clone(), item.kind))
            .collect();
        assert!(kinds.contains(&("mag".into(), Some("number"))), "{kinds:?}");
        assert!(at_end("p").items.iter().all(|item| item.kind.is_none()));
    }

    #[test]
    fn the_catalogs_verbs_take_a_column_then_a_count() {
        assert!(labels(&at_end("")).contains(&"top"));
        let verbs = at_end("n");
        assert_eq!(labels(&verbs), ["nulls"]);
        assert!(verbs.items[0].space);
        assert_eq!(verbs.items[0].detail, "Count the empty cells in a column");
        let columns = at_end("top ma");
        assert_eq!(columns.part, Part::Column);
        assert_eq!(labels(&columns), ["mag", "magType"]);
        // A count follows top's column: a space after it.
        assert!(columns.items[0].space);
        assert!(!at_end("nulls ma").items[0].space);
        let count = at_end("top mag ");
        assert_eq!(count.part, Part::Count);
        assert!(count.items.is_empty());
        let slots: Vec<(&str, &str)> = count
            .slots
            .iter()
            .map(|slot| (slot.text.as_str(), slot.state))
            .collect();
        assert_eq!(slots, [("top", "done"), ("mag", "done"), ("count", "now")]);
        assert_eq!(count.preview.kind, "command");
        assert_eq!(count.preview.steps, ["The 5 most common values of mag"]);
        let typed = at_end("top mag 12");
        assert_eq!(typed.part, Part::Count);
        assert_eq!(typed.preview.steps, ["The 12 most common values of mag"]);
        assert_eq!(
            typed.preview.json.as_deref(),
            Some(r#"{"top":{"column":"mag","count":12}}"#)
        );
        // Bare words read as one name until the column is whole.
        assert_eq!(at_end(r#"nulls "launch d"#).part, Part::Column);
        assert_eq!(
            at_end("nulls mag ").preview.steps,
            ["Count the nulls in mag"]
        );
    }

    #[test]
    fn a_columns_line_is_the_profiles_where_it_knows_it_else_its_type() {
        let mut catalog = catalog();
        catalog.lines.insert("mag".into(), "-1.2 to 9.1".into());
        let items = complete("pin ma", 6, Some(&catalog)).items;
        let details: Vec<&str> = items.iter().map(|item| item.detail.as_str()).collect();
        assert_eq!(details, ["-1.2 to 9.1", "VARCHAR"]);
    }
}
