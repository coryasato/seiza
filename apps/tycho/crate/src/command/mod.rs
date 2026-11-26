//! The command bar's grammar: one parser for a typed line and an agent's
//! JSON, both read to the same steps (`docs/DECISIONS.md`, "Scope",
//! 2026-11-21, "A command is a verb, then a column, then its parts").
//!
//! A typed line is a verb, then its parts: `filter inclination_deg >= 90`,
//! `filter owner in US, CN`, `sort launch_date desc`, `clear filters`,
//! `find starlink`, `pin mag`, `unpin "launch date"`, `hide nst, dmin, rms`,
//! `show all`, `jump 1,204`, `undo`. A column's name is bare, or in double
//! quotes with a quote inside written twice; it's matched without regard
//! to case ([`plan`]). A filter's value is read as its column's type once
//! the column is known ([`plan`]): text in double quotes when it holds a
//! space or a comma. JSON names the same verbs as keys, `{"filter":
//! {"column": "inclination_deg", "op": ">=", "value": 90}}`, `{"hide":
//! ["nst", "dmin"]}`, several steps under `"actions"`. The bar runs the
//! verbs the controller can do today; every other verb of the grammar is
//! answered with the goal it comes with ([`LATER`]), and a line that opens
//! with no verb and reads as words is a sentence, which Tycho doesn't read
//! (2026-11-24, "The first command bar runs what the controller can do
//! today").
//!
//! [`plan`] checks the steps against the open file, all or none;
//! [`complete`] says what's being typed and what matches.

mod complete;
pub mod plan;

pub use complete::{Completion, Item, Part, Preview, complete};
pub use plan::{Catalog, Checked, Plan, Refusal, plan};

use crate::filter::{Arity, Direction, Op, Value, Values};

/// A verb the bar runs now, with what it does (completion's hint).
pub const VERBS: &[(&str, &str)] = &[
    ("filter", "Keep the rows that match"),
    ("sort", "Sort the rows by a column"),
    ("find", "Find text in every row"),
    ("pin", "Pin a column"),
    ("unpin", "Unpin a column"),
    ("hide", "Hide columns"),
    ("show", "Show hidden columns"),
    ("jump", "Jump to a row"),
    ("clear", "Clear filters or the sort"),
    ("undo", "Go back one step"),
];

/// The grammar's other verbs, each with the goal that builds it (`PLAN.md`).
pub const LATER: &[(&str, &str)] = &[
    ("group", "profiles and the catalog"),
    ("rows", "profiles and the catalog"),
    ("top", "profiles and the catalog"),
    ("nulls", "profiles and the catalog"),
    ("distinct", "profiles and the catalog"),
    ("sql", "export"),
    ("export", "export"),
];

/// The grammar's own words besides its verbs: a column named one is
/// written in quotes (`sort "desc"`).
const WORDS: &[&str] = &[
    "asc", "desc", "all", "filters", "and", "is", "null", "not", "between", "contains", "starts",
    "in", "count", "sum", "avg", "min", "max", "open",
];

/// One step of an action, as written: names not yet matched to columns.
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    Pin(Name),
    Unpin(Name),
    /// One or more columns, in the order written.
    Hide(Vec<Name>),
    Show(Vec<Name>),
    /// `show all`: every hidden column.
    ShowAll,
    /// The row's number as written (`jump.rs` reads it against the rows).
    Jump(String),
    /// A filter: its column, its operator, and its value or values.
    Filter {
        column: Name,
        op: Op,
        value: Given,
    },
    /// The sort: none written takes the column's first direction.
    Sort {
        column: Name,
        direction: Option<Direction>,
    },
    Clear(Clear),
    /// Find's term, as written.
    Find(String),
    Undo,
}

/// A filter's value or values as given: a typed line's words, read as the
/// column's type once it's known ([`plan`]), or JSON's.
#[derive(Debug, Clone, PartialEq)]
pub enum Given {
    Typed(Vec<String>),
    Json(Values),
}

/// What `clear` removes.
#[derive(Debug, Clone, PartialEq)]
pub enum Clear {
    /// Every filter on one column.
    Filter(Name),
    Filters,
    Sort,
    /// Every filter and the sort.
    All,
}

/// A column's name as written.
#[derive(Debug, Clone, PartialEq)]
pub struct Name {
    pub text: String,
    /// Several bare words read as one name (`pin launch date`): matched if
    /// the file has it, else answered that a name with a space goes in
    /// quotes.
    pub spaced: bool,
}

impl Name {
    fn bare(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            spaced: false,
        }
    }
}

impl Step {
    /// The step's plain words, its name as written.
    pub fn words(&self) -> String {
        match self {
            Self::Pin(name) => format!("Pin {}", quote(&name.text)),
            Self::Unpin(name) => format!("Unpin {}", quote(&name.text)),
            Self::Hide(names) => format!("Hide {}", spoken(names)),
            Self::Show(names) => format!("Show {}", spoken(names)),
            Self::ShowAll => "Show all hidden columns".into(),
            Self::Jump(row) => format!("Jump to row {}", row.trim()),
            Self::Filter { column, op, value } => format!(
                "Keep rows where {} {op}{}",
                quote(&column.text),
                given(*op, value)
            ),
            Self::Sort { column, direction } => format!(
                "Sort by {}{}",
                quote(&column.text),
                direction.map_or(String::new(), |direction| format!(
                    ", {}",
                    direction.as_str()
                ))
            ),
            Self::Clear(Clear::Filter(column)) => {
                format!("Clear the filters on {}", quote(&column.text))
            }
            Self::Clear(Clear::Filters) => "Clear the filters".into(),
            Self::Clear(Clear::Sort) => "Clear the sort".into(),
            Self::Clear(Clear::All) => "Clear the filters and the sort".into(),
            Self::Find(term) => format!("Find {}", quote(term)),
            Self::Undo => "Undo".into(),
        }
    }

    /// The step as a command line, its name as written.
    pub fn written(&self) -> String {
        match self {
            Self::Pin(name) => format!("pin {}", quote(&name.text)),
            Self::Unpin(name) => format!("unpin {}", quote(&name.text)),
            Self::Hide(names) => format!("hide {}", listed(names)),
            Self::Show(names) => format!("show {}", listed(names)),
            Self::ShowAll => "show all".into(),
            Self::Jump(row) => format!("jump {}", row.trim()),
            Self::Filter { column, op, value } => {
                format!("filter {} {op}{}", quote(&column.text), given(*op, value))
            }
            Self::Sort { column, direction } => format!(
                "sort {}{}",
                quote(&column.text),
                direction.map_or(String::new(), |direction| format!(
                    " {}",
                    direction.as_str()
                ))
            ),
            Self::Clear(Clear::Filter(column)) => format!("clear filter {}", quote(&column.text)),
            Self::Clear(Clear::Filters) => "clear filters".into(),
            Self::Clear(Clear::Sort) => "clear sort".into(),
            Self::Clear(Clear::All) => "clear all".into(),
            Self::Find(term) => format!("find {}", quote(term)),
            Self::Undo => "undo".into(),
        }
    }
}

/// A filter's values as a command writes them after its operator, with
/// the space before them: ` 90`, ` 1 and 10`, ` mb, mww`, none for `is
/// null`.
pub fn values_written(op: Op, values: &[String]) -> String {
    match (op.arity(), values) {
        (_, []) => String::new(),
        (Arity::Two, [low, high]) => format!(" {low} and {high}"),
        (_, values) => format!(" {}", values.join(", ")),
    }
}

/// A value as a command writes it: text quoted where it needs to be
/// ([`quote`]), a number or a boolean as JSON writes it.
pub fn value_written(value: &Value) -> String {
    match value {
        Value::Text(text) => quote(text),
        other => other.to_string(),
    }
}

/// The values given, as a command writes them.
fn given(op: Op, given: &Given) -> String {
    let values: Vec<String> = match given {
        Given::Typed(words) => words.iter().map(|word| quote(word)).collect(),
        Given::Json(Values::None) => Vec::new(),
        Given::Json(Values::One(value)) => vec![value_written(value)],
        Given::Json(Values::Many(values)) => values.iter().map(value_written).collect(),
    };
    values_written(op, &values)
}

/// Names as a command writes them: `nst, dmin, rms`.
pub fn listed(names: &[Name]) -> String {
    names
        .iter()
        .map(|name| quote(&name.text))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Names in words: `nst, dmin, and rms`.
fn spoken(names: &[Name]) -> String {
    let quoted: Vec<String> = names.iter().map(|name| quote(&name.text)).collect();
    list(quoted.iter().map(String::as_str), "and")
}

/// Where an action's steps came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Form {
    Typed,
    Json,
}

/// What a line reads as.
#[derive(Debug, Clone, PartialEq)]
pub enum Parsed {
    /// Nothing typed.
    Empty,
    Action {
        steps: Vec<Step>,
        form: Form,
    },
    /// Words, not a command: Tycho reads no sentences.
    Sentence,
    /// A verb of the grammar not built yet, with its goal; `step` is its
    /// place in a JSON action of several.
    Later {
        verb: &'static str,
        goal: &'static str,
        step: Option<usize>,
    },
    /// `open`: another file opens from the bar's list, not a typed name.
    Open,
    /// Not a command, and why.
    Error(String),
}

/// Reads `text`: JSON if it opens with `{`, else a typed line.
pub fn parse(text: &str) -> Parsed {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Parsed::Empty;
    }
    if trimmed.starts_with('{') {
        return parse_json(trimmed);
    }
    parse_line(trimmed)
}

// --- the typed line ---

/// A word of a line: bare, or in double quotes.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Token {
    /// Unquoted: a quote inside written twice is one.
    pub text: String,
    /// Byte range in the line, quotes included.
    pub start: usize,
    pub end: usize,
    pub quoted: bool,
    /// A quoted word's closing quote is there.
    pub closed: bool,
}

/// `text`'s words, split at whitespace outside quotes.
pub(crate) fn tokenize(text: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut chars = text.char_indices().peekable();
    while let Some(&(start, c)) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
            continue;
        }
        if c == '"' {
            chars.next();
            let mut word = String::new();
            let mut closed = false;
            let mut end = text.len();
            while let Some((at, c)) = chars.next() {
                if c == '"' {
                    if chars.peek().map(|&(_, next)| next) == Some('"') {
                        chars.next();
                        word.push('"');
                    } else {
                        closed = true;
                        end = at + 1;
                        break;
                    }
                } else {
                    word.push(c);
                }
            }
            tokens.push(Token {
                text: word,
                start,
                end,
                quoted: true,
                closed,
            });
        } else {
            let mut end = text.len();
            let mut word = String::new();
            while let Some(&(at, c)) = chars.peek() {
                if c.is_whitespace() {
                    end = at;
                    break;
                }
                word.push(c);
                chars.next();
            }
            tokens.push(Token {
                text: word,
                start,
                end,
                quoted: false,
                closed: true,
            });
        }
    }
    tokens
}

fn built(word: &str) -> Option<&'static str> {
    VERBS
        .iter()
        .map(|(verb, _)| *verb)
        .find(|verb| verb.eq_ignore_ascii_case(word))
}

fn later(word: &str) -> Option<(&'static str, &'static str)> {
    LATER
        .iter()
        .copied()
        .find(|(verb, _)| verb.eq_ignore_ascii_case(word))
}

fn parse_line(text: &str) -> Parsed {
    let tokens = tokenize(text);
    if tokens.iter().any(|token| !token.closed) {
        return Parsed::Error("A quote isn't closed: a name in quotes ends with one.".into());
    }
    // A question is a sentence whatever it starts with.
    if text.ends_with('?') {
        return Parsed::Sentence;
    }
    let first = &tokens[0];
    let rest = &tokens[1..];
    if first.quoted {
        return Parsed::Error(format!(
            "A command starts with its verb: {}.",
            list(VERBS.iter().map(|(verb, _)| *verb), "or")
        ));
    }
    match built(&first.text) {
        Some("filter") => filter_step(rest).map_or_else(Parsed::Error, action),
        Some("sort") => {
            let (names, direction) = match rest.split_last() {
                Some((last, names)) if !names.is_empty() => match direction(last) {
                    Some(direction) => (names, Some(direction)),
                    None => (rest, None),
                },
                _ => (rest, None),
            };
            column_step(names, "sort").map_or_else(Parsed::Error, |column| {
                action(Step::Sort { column, direction })
            })
        }
        Some("clear") => {
            clear_step(rest).map_or_else(Parsed::Error, |clear| action(Step::Clear(clear)))
        }
        Some("find") => match rest {
            [] => Parsed::Error("find takes the text to look for: find starlink.".into()),
            [one] if one.quoted => action(Step::Find(one.text.clone())),
            // Quoted words among others: their texts, a space between.
            _ if rest.iter().any(|token| token.quoted) => action(Step::Find(
                rest.iter()
                    .map(|token| token.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
            )),
            // The rest as written: `find low earth` looks for both words.
            _ => action(Step::Find(text[rest[0].start..].trim().to_owned())),
        },
        Some("pin") => {
            column_step(rest, "pin").map_or_else(Parsed::Error, |name| action(Step::Pin(name)))
        }
        Some("unpin") => {
            column_step(rest, "unpin").map_or_else(Parsed::Error, |name| action(Step::Unpin(name)))
        }
        Some(verb @ ("hide" | "show")) => match names_step(rest, verb) {
            Ok(_) if verb == "show" && is_all(rest) => action(Step::ShowAll),
            Ok(names) if verb == "show" => action(Step::Show(names)),
            Ok(names) => action(Step::Hide(names)),
            Err(why) => Parsed::Error(why),
        },
        Some("jump") => {
            if rest.is_empty() {
                Parsed::Error("jump takes a row's number: jump 1,204.".into())
            } else {
                // The rest as written: `jump.rs` reads `1 000 000`.
                action(Step::Jump(text[rest[0].start..].to_owned()))
            }
        }
        Some(_) => {
            if rest.is_empty() {
                action(Step::Undo)
            } else {
                Parsed::Error("undo takes nothing after it.".into())
            }
        }
        None if first.text.eq_ignore_ascii_case("open") => Parsed::Open,
        None => match later(&first.text) {
            Some((verb, goal)) => Parsed::Later {
                verb,
                goal,
                step: None,
            },
            None => no_verb(&first.text, &tokens),
        },
    }
}

fn action(step: Step) -> Parsed {
    Parsed::Action {
        steps: vec![step],
        form: Form::Typed,
    }
}

/// `verb`'s one column: one word, or several bare words read as one name.
fn column_step(rest: &[Token], verb: &str) -> Result<Name, String> {
    match rest {
        [] => Err(format!("{verb} takes a column: {verb} mag.")),
        [one] => Ok(Name::bare(one.text.clone())),
        _ if rest.iter().all(|token| !token.quoted) => Ok(Name {
            text: rest
                .iter()
                .map(|token| token.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
            spaced: true,
        }),
        _ => Err(format!(
            "{verb} takes one column; a name with a space goes in double quotes."
        )),
    }
}

/// `asc` or `desc`, bare.
fn direction(token: &Token) -> Option<Direction> {
    if token.quoted {
        return None;
    }
    [Direction::Asc, Direction::Desc]
        .into_iter()
        .find(|direction| direction.as_str().eq_ignore_ascii_case(&token.text))
}

/// `clear`'s part: `filter` and a column, `filters`, `sort`, or `all`.
fn clear_step(rest: &[Token]) -> Result<Clear, String> {
    let word = |token: &Token, word: &str| !token.quoted && token.text.eq_ignore_ascii_case(word);
    match rest {
        [one] if word(one, "filters") => Ok(Clear::Filters),
        [one] if word(one, "sort") => Ok(Clear::Sort),
        [one] if word(one, "all") => Ok(Clear::All),
        [one] if word(one, "filter") => Err(
            "clear filter takes a column: clear filter mag. clear filters clears every filter."
                .into(),
        ),
        [first, names @ ..] if word(first, "filter") => {
            column_step(names, "clear filter").map(Clear::Filter)
        }
        _ => Err("clear takes filter and a column, filters, sort, or all: clear filters.".into()),
    }
}

/// The words that are operators, a column's name before them.
const OP_WORDS: &[&str] = &["contains", "starts", "in", "between", "is", "not"];

/// The characters an operator like `>=` is written in.
const OP_SYMBOLS: &[char] = &['<', '>', '=', '!'];

/// A `filter` line's parts: its column's words, its operator (a word, `is
/// null`'s words as one, or symbols, which may touch the column and the
/// value: `mag>=4.5`), and the words after it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FilterLine {
    pub column: Vec<Token>,
    pub op: Option<Token>,
    pub values: Vec<Token>,
}

/// Cuts a `filter` line after its verb into its parts. Only the column's
/// words are searched for an operator: a value is taken as written.
pub(crate) fn split_filter(rest: &[Token]) -> FilterLine {
    let piece = |text: &str, start: usize| Token {
        text: text.to_owned(),
        start,
        end: start + text.len(),
        quoted: false,
        closed: true,
    };
    let mut column = Vec::new();
    for (index, token) in rest.iter().enumerate() {
        if token.quoted {
            column.push(token.clone());
            continue;
        }
        let lower = token.text.to_lowercase();
        if !column.is_empty() && OP_WORDS.contains(&lower.as_str()) {
            let mut op = token.clone();
            let mut words = vec![lower];
            let mut end = index + 1;
            // `is null`, `is not null`, `not null`: one operator.
            while let Some(next) = rest.get(end).filter(|next| !next.quoted) {
                let next_word = next.text.to_lowercase();
                let follows = matches!(
                    (words.last().map(String::as_str), next_word.as_str()),
                    (Some("is"), "not" | "null") | (Some("not"), "null")
                );
                if !follows {
                    break;
                }
                words.push(next_word);
                op.end = next.end;
                end += 1;
            }
            op.text = words.join(" ");
            return FilterLine {
                column,
                op: Some(op),
                values: rest[end..].to_vec(),
            };
        }
        if let Some(at) = token.text.find(OP_SYMBOLS) {
            let len = token.text[at..]
                .find(|c: char| !OP_SYMBOLS.contains(&c))
                .unwrap_or(token.text.len() - at);
            let (left, symbols, right) = (
                &token.text[..at],
                &token.text[at..at + len],
                &token.text[at + len..],
            );
            if !left.is_empty() {
                column.push(piece(left, token.start));
            }
            let op = piece(symbols, token.start + at);
            let mut values = Vec::new();
            if !right.is_empty() {
                values.push(piece(right, op.end));
            }
            values.extend_from_slice(&rest[index + 1..]);
            return FilterLine {
                column,
                op: Some(op),
                values,
            };
        }
        column.push(token.clone());
    }
    FilterLine {
        column,
        op: None,
        values: Vec::new(),
    }
}

/// Every operator, as a reason lists them.
fn operators() -> String {
    list(Op::ALL.iter().map(|op| op.as_str()), "or")
}

fn filter_step(rest: &[Token]) -> Result<Step, String> {
    const EXAMPLE: &str = "filter mag >= 4.5";
    let line = split_filter(rest);
    let Some(op) = line.op else {
        return Err(if rest.is_empty() {
            format!("filter takes a column, an operator, and a value: {EXAMPLE}.")
        } else {
            format!(
                "filter takes an operator after its column ({}): {EXAMPLE}.",
                operators()
            )
        });
    };
    if line.column.is_empty() {
        return Err(format!(
            "filter takes a column before its operator: {EXAMPLE}."
        ));
    }
    let column = column_step(&line.column, "filter")?;
    let op = Op::read(&op.text).ok_or_else(|| match op.text.as_str() {
        "is" | "not" | "is not" => "is takes null: filter mag is null, or not null.".to_owned(),
        other => format!(
            "Tycho has no operator {other}. A filter takes {}.",
            operators()
        ),
    })?;
    let shown = quote(&column.text);
    let values = &line.values;
    let spaced = |values: &[Token]| values.iter().all(|value| !value.quoted);
    let words = match op.arity() {
        Arity::None if values.is_empty() => Vec::new(),
        Arity::None => return Err(format!("{op} takes nothing after it.")),
        Arity::One => match values.as_slice() {
            [] => return Err(format!("{op} takes a value after it.")),
            [one] => vec![one.text.clone()],
            many if spaced(many) => {
                let joined: Vec<&str> = many.iter().map(|value| value.text.as_str()).collect();
                return Err(format!(
                    "{op} takes one value; a value with a space goes in double quotes: filter {shown} {op} \"{}\".",
                    joined.join(" ")
                ));
            }
            _ => {
                return Err(format!(
                    "{op} takes one value; a value with a space goes in double quotes."
                ));
            }
        },
        Arity::Two => match values.as_slice() {
            [low, and, high] if !and.quoted && and.text.eq_ignore_ascii_case("and") => {
                vec![low.text.clone(), high.text.clone()]
            }
            _ => {
                return Err(format!(
                    "between takes two values joined by and: filter {shown} between 1 and 10."
                ));
            }
        },
        Arity::List => {
            let mut words = Vec::new();
            for group in groups(values) {
                match group.words.as_slice() {
                    [] => {}
                    [(word, _)] => words.push(word.clone()),
                    _ => {
                        return Err(format!(
                            "in takes values between commas; a value with a space goes in double quotes: filter {shown} in \"United States\", China."
                        ));
                    }
                }
            }
            if words.is_empty() {
                return Err(format!(
                    "in takes one or more values between commas: filter {shown} in a, b."
                ));
            }
            words
        }
    };
    Ok(Step::Filter {
        column,
        op,
        value: Given::Typed(words),
    })
}

/// `show all`'s one word, bare: a column named `all` is written in quotes.
fn is_all(rest: &[Token]) -> bool {
    matches!(rest, [word] if !word.quoted && word.text.eq_ignore_ascii_case("all"))
}

/// `verb`'s columns, one or more between commas (`hide nst, dmin, rms`):
/// each a word, a name in quotes, or bare words read as one name.
fn names_step(rest: &[Token], verb: &str) -> Result<Vec<Name>, String> {
    let groups = groups(rest);
    let mut names = Vec::with_capacity(groups.len());
    for group in groups {
        match group.words.as_slice() {
            [] => {}
            [(text, _)] => names.push(Name::bare(text.clone())),
            words if words.iter().all(|(_, quoted)| !quoted) => names.push(Name {
                text: words
                    .iter()
                    .map(|(text, _)| text.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
                spaced: true,
            }),
            _ => {
                return Err(format!(
                    "{verb} takes columns between commas; a name with a space goes in double quotes."
                ));
            }
        }
    }
    if names.is_empty() {
        return Err(format!(
            "{verb} takes one or more columns: {verb} nst, dmin."
        ));
    }
    Ok(names)
}

/// A run of words between commas, and where it is in the line.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Group {
    /// Each word, and whether it was quoted.
    pub words: Vec<(String, bool)>,
    /// Byte range of its words in the line (none for an empty group).
    pub span: Option<(usize, usize)>,
}

/// `tokens` cut at commas outside quotes: `nst,`, `,`, and `a,b` each end
/// a group. A trailing comma leaves an empty group after it.
pub(crate) fn groups(tokens: &[Token]) -> Vec<Group> {
    let mut groups = vec![Group {
        words: Vec::new(),
        span: None,
    }];
    let add = |groups: &mut Vec<Group>, text: String, quoted: bool, start: usize, end: usize| {
        let group = groups.last_mut().expect("one group at least");
        group.words.push((text, quoted));
        group.span = Some(group.span.map_or((start, end), |(from, _)| (from, end)));
    };
    for token in tokens {
        if token.quoted {
            add(
                &mut groups,
                token.text.clone(),
                true,
                token.start,
                token.end,
            );
            continue;
        }
        let mut at = token.start;
        for (index, piece) in token.text.split(',').enumerate() {
            if index > 0 {
                groups.push(Group {
                    words: Vec::new(),
                    span: None,
                });
                at += 1;
            }
            if !piece.is_empty() {
                add(&mut groups, piece.to_owned(), false, at, at + piece.len());
            }
            at += piece.len();
        }
    }
    groups
}

/// A line whose first word is no verb: a verb mistyped, a sentence, or an
/// unknown command. A verb is offered only for a line of a word or two
/// (`pni mag`): longer, the line is a sentence first, so `how many
/// launches failed` isn't taken for `show`.
fn no_verb(word: &str, tokens: &[Token]) -> Parsed {
    let words = tokens.len() >= 2
        && tokens
            .iter()
            .all(|token| !token.quoted && token.text.chars().any(char::is_alphabetic));
    if words && tokens.len() > 2 {
        return Parsed::Sentence;
    }
    let lower = word.to_lowercase();
    let near = VERBS
        .iter()
        .map(|(verb, _)| *verb)
        .chain(LATER.iter().map(|(verb, _)| *verb))
        .filter(|verb| distance(verb, &lower) <= 1 + verb.len() / 5)
        .min_by_key(|verb| distance(verb, &lower));
    if let Some(verb) = near {
        return Parsed::Error(format!("Tycho has no command {word}. Did you mean {verb}?"));
    }
    if words {
        return Parsed::Sentence;
    }
    Parsed::Error(format!(
        "Tycho has no command {word}. It runs {}.",
        list(VERBS.iter().map(|(verb, _)| *verb), "and")
    ))
}

// --- JSON ---

fn parse_json(text: &str) -> Parsed {
    let value: serde_json::Value = match serde_json::from_str(text) {
        Ok(value) => value,
        Err(error) => {
            return Parsed::Error(format!(
                "That reads as JSON, and it doesn't parse: {error}."
            ));
        }
    };
    let serde_json::Value::Object(object) = &value else {
        unreachable!("a text opening with `{{` that parses is an object");
    };
    let (steps, several) = match object.get("actions") {
        Some(actions) if object.len() == 1 => match actions {
            serde_json::Value::Array(steps) if !steps.is_empty() => {
                (steps.iter().collect::<Vec<_>>(), steps.len() > 1)
            }
            _ => return Parsed::Error("\"actions\" holds a list of steps.".into()),
        },
        Some(_) => {
            return Parsed::Error("An action with \"actions\" holds nothing else.".into());
        }
        None => (vec![&value], false),
    };
    let mut parsed = Vec::with_capacity(steps.len());
    for (index, step) in steps.iter().enumerate() {
        let at = |why: String| {
            if several {
                format!("Step {} of {}: {why}", index + 1, steps.len())
            } else {
                why
            }
        };
        match json_step(step) {
            Ok(Ok(step)) => parsed.push(step),
            Ok(Err((verb, goal))) => {
                return Parsed::Later {
                    verb,
                    goal,
                    step: several.then_some(index),
                };
            }
            Err(why) => return Parsed::Error(at(why)),
        }
    }
    Parsed::Action {
        steps: parsed,
        form: Form::Json,
    }
}

/// One JSON step: `{"<verb>": {…}}`. A later verb is `Ok(Err(…))`.
fn json_step(
    value: &serde_json::Value,
) -> Result<Result<Step, (&'static str, &'static str)>, String> {
    use serde_json::Value;

    let Value::Object(object) = value else {
        return Err(format!(
            "a step is an object with one verb, like {{\"pin\": {{\"column\": \"mag\"}}}}; this is {value}."
        ));
    };
    let mut keys = object.iter();
    let (Some((verb, parts)), None) = (keys.next(), keys.next()) else {
        return Err("a step is an object with one verb.".into());
    };
    let fields = |allowed: &[&str]| -> Result<&serde_json::Map<String, Value>, String> {
        let Value::Object(fields) = parts else {
            return Err(format!(
                "{verb}'s parts are an object, like {{\"{verb}\": {{\"{}\": …}}}}.",
                allowed.first().unwrap_or(&"")
            ));
        };
        if let Some(unknown) = fields.keys().find(|key| !allowed.contains(&key.as_str())) {
            return Err(format!("{verb} has no part \"{unknown}\"."));
        }
        Ok(fields)
    };
    let column = |fields: &serde_json::Map<String, Value>| match fields.get("column") {
        Some(Value::String(name)) => Ok(Name::bare(name.clone())),
        Some(_) => Err(format!(
            "{verb}'s \"column\" is a column's name, in quotes."
        )),
        None => Err(format!("{verb} needs a \"column\".")),
    };
    match built(verb) {
        Some("filter") => {
            let fields = fields(&["column", "op", "value"])?;
            let column = column(fields)?;
            let op = match fields.get("op") {
                Some(Value::String(op)) => Op::read(op).ok_or_else(|| {
                    format!(
                        "Tycho has no operator {op}. A filter takes {}.",
                        operators()
                    )
                })?,
                Some(_) => {
                    return Err("filter's \"op\" is an operator in quotes, like \">=\".".into());
                }
                None => return Err("filter needs an \"op\".".into()),
            };
            let value = match fields.get("value") {
                None | Some(Value::Null) => Values::None,
                Some(value) => serde_json::from_value(value.clone()).map_err(|_| {
                    "filter's \"value\" is a number, text, true or false, or a list of them."
                        .to_owned()
                })?,
            };
            Ok(Ok(Step::Filter {
                column,
                op,
                value: Given::Json(value),
            }))
        }
        Some("sort") => {
            let fields = fields(&["column", "direction"])?;
            let direction = match fields.get("direction") {
                None | Some(Value::Null) => None,
                Some(Value::String(word)) => Some(
                    [
                        crate::filter::Direction::Asc,
                        crate::filter::Direction::Desc,
                    ]
                    .into_iter()
                    .find(|direction| direction.as_str().eq_ignore_ascii_case(word))
                    .ok_or("sort's \"direction\" is \"asc\" or \"desc\".")?,
                ),
                Some(_) => return Err("sort's \"direction\" is \"asc\" or \"desc\".".into()),
            };
            Ok(Ok(Step::Sort {
                column: column(fields)?,
                direction,
            }))
        }
        Some("clear") => {
            const FORMS: &str =
                r#"{"clear": "filters"}, "sort", "all", or {"clear": {"filter": "mag"}}"#;
            match parts {
                Value::String(word) if word.eq_ignore_ascii_case("filters") => {
                    Ok(Ok(Step::Clear(Clear::Filters)))
                }
                Value::String(word) if word.eq_ignore_ascii_case("sort") => {
                    Ok(Ok(Step::Clear(Clear::Sort)))
                }
                Value::String(word) if word.eq_ignore_ascii_case("all") => {
                    Ok(Ok(Step::Clear(Clear::All)))
                }
                Value::Object(fields) if fields.len() == 1 => match fields.get("filter") {
                    Some(Value::String(name)) => {
                        Ok(Ok(Step::Clear(Clear::Filter(Name::bare(name.clone())))))
                    }
                    _ => Err(format!("clear takes {FORMS}.")),
                },
                _ => Err(format!("clear takes {FORMS}.")),
            }
        }
        Some("find") => {
            let text = match parts {
                Value::String(text) => text,
                Value::Object(_) => match fields(&["text"])?.get("text") {
                    Some(Value::String(text)) => text,
                    _ => return Err("find needs a \"text\", in quotes.".into()),
                },
                _ => return Err(r#"find takes text: {"find": {"text": "starlink"}}."#.into()),
            };
            Ok(Ok(Step::Find(text.clone())))
        }
        Some("pin") => Ok(Ok(Step::Pin(column(fields(&["column"])?)?))),
        Some("unpin") => Ok(Ok(Step::Unpin(column(fields(&["column"])?)?))),
        Some(verb @ ("hide" | "show")) => {
            let example = format!("{{\"{verb}\": [\"nst\", \"dmin\"]}}");
            match parts {
                Value::String(all) if verb == "show" && all == "all" => Ok(Ok(Step::ShowAll)),
                Value::String(name) => {
                    let names = vec![Name::bare(name.clone())];
                    Ok(Ok(if verb == "show" {
                        Step::Show(names)
                    } else {
                        Step::Hide(names)
                    }))
                }
                Value::Array(names) if !names.is_empty() => {
                    let names = names
                        .iter()
                        .map(|name| match name {
                            Value::String(name) => Ok(Name::bare(name.clone())),
                            _ => Err(format!(
                                "{verb} takes a list of columns' names, in quotes: {example}."
                            )),
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(Ok(if verb == "show" {
                        Step::Show(names)
                    } else {
                        Step::Hide(names)
                    }))
                }
                _ if verb == "show" => Err(format!(
                    "show takes a list of columns' names, or \"all\": {example}, {{\"show\": \"all\"}}."
                )),
                _ => Err(format!("hide takes a list of columns' names: {example}.")),
            }
        }
        Some("jump") => match fields(&["row"])?.get("row") {
            // A whole number an agent wrote as a float (`1204.0`, `1e3`) is
            // that row; any other is refused as `jump.rs` refuses it.
            Some(Value::Number(row)) => Ok(Ok(Step::Jump(match (row.as_u64(), row.as_f64()) {
                (Some(row), _) => row.to_string(),
                (None, Some(float))
                    if float >= 0.0 && float.fract() == 0.0 && float < u64::MAX as f64 =>
                {
                    (float as u64).to_string()
                }
                _ => row.to_string(),
            }))),
            Some(Value::String(row)) => Ok(Ok(Step::Jump(row.clone()))),
            Some(_) => Err("jump's \"row\" is a row's number.".into()),
            None => Err("jump needs a \"row\".".into()),
        },
        Some(_) => match parts {
            Value::Null | Value::Bool(true) => Ok(Ok(Step::Undo)),
            Value::Object(fields) if fields.is_empty() => Ok(Ok(Step::Undo)),
            _ => Err("undo takes nothing: {\"undo\": {}}.".into()),
        },
        None => match later(verb) {
            Some(later) => Ok(Err(later)),
            None => Err(format!("Tycho has no command {verb}.")),
        },
    }
}

// --- names ---

/// `name` as it's typed: bare, or in double quotes (a quote inside written
/// twice) when it holds a space, a quote, or a comma, is empty, or reads
/// as one of the grammar's words.
pub fn quote(name: &str) -> String {
    let word = |list: &[&str]| list.iter().any(|word| word.eq_ignore_ascii_case(name));
    let needs = name.is_empty()
        || name
            .chars()
            .any(|c| c.is_whitespace() || c == '"' || c == ',' || OP_SYMBOLS.contains(&c))
        || name.starts_with('{')
        || name.ends_with('?')
        || word(WORDS)
        || VERBS
            .iter()
            .any(|(verb, _)| verb.eq_ignore_ascii_case(name))
        || LATER
            .iter()
            .any(|(verb, _)| verb.eq_ignore_ascii_case(name));
    if needs {
        format!("\"{}\"", name.replace('"', "\"\""))
    } else {
        name.to_owned()
    }
}

/// `a`, `a and b`, `a, b, and c`.
pub fn list<'a>(items: impl IntoIterator<Item = &'a str>, and: &str) -> String {
    let items: Vec<_> = items.into_iter().collect();
    match items.as_slice() {
        [] => String::new(),
        [one] => (*one).to_owned(),
        [a, b] => format!("{a} {and} {b}"),
        [init @ .., last] => format!("{}, {and} {last}", init.join(", ")),
    }
}

/// Edit distance, by characters, a swap of two neighbors one edit (`pni`
/// is one from `pin`).
pub(crate) fn distance(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let width = b.len() + 1;
    let mut d = vec![0; (a.len() + 1) * width];
    for i in 0..=a.len() {
        d[i * width] = i;
    }
    for (j, cell) in d.iter_mut().enumerate().take(width) {
        *cell = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut best = (d[(i - 1) * width + j] + 1)
                .min(d[i * width + j - 1] + 1)
                .min(d[(i - 1) * width + j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                best = best.min(d[(i - 2) * width + j - 2] + 1);
            }
            d[i * width + j] = best;
        }
    }
    d[a.len() * width + b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pin(name: &str) -> Parsed {
        action(Step::Pin(Name::bare(name)))
    }

    #[test]
    fn verbs_and_names() {
        assert_eq!(parse("pin mag"), pin("mag"));
        assert_eq!(parse("  PIN   mag "), pin("mag"));
        assert_eq!(parse("pin \"launch date\""), pin("launch date"));
        // A quote inside is written twice.
        assert_eq!(parse(r#"pin "12"" pizza""#), pin("12\" pizza"));
        assert_eq!(parse("unpin mag"), action(Step::Unpin(Name::bare("mag"))));
        assert_eq!(parse("jump 1,204"), action(Step::Jump("1,204".into())));
        assert_eq!(
            parse("jump 1 000 000"),
            action(Step::Jump("1 000 000".into()))
        );
        assert_eq!(parse("undo"), action(Step::Undo));
        assert_eq!(parse(""), Parsed::Empty);
        assert_eq!(parse("   "), Parsed::Empty);
        // Bare words read as one name, matched if the file has it.
        assert_eq!(
            parse("pin launch date"),
            action(Step::Pin(Name {
                text: "launch date".into(),
                spaced: true
            }))
        );
    }

    #[test]
    fn faults_are_said() {
        let error = |text| match parse(text) {
            Parsed::Error(why) => why,
            other => panic!("{text:?} read as {other:?}"),
        };
        assert_eq!(error("pin"), "pin takes a column: pin mag.");
        assert_eq!(
            error("pin \"mag"),
            "A quote isn't closed: a name in quotes ends with one."
        );
        assert_eq!(
            error("pin \"a b\" c"),
            "pin takes one column; a name with a space goes in double quotes."
        );
        assert_eq!(error("undo mag"), "undo takes nothing after it.");
        assert_eq!(error("jump"), "jump takes a row's number: jump 1,204.");
        assert_eq!(
            error("pni mag"),
            "Tycho has no command pni. Did you mean pin?"
        );
        assert_eq!(
            error("upnin mag"),
            "Tycho has no command upnin. Did you mean unpin?"
        );
        assert_eq!(
            error("42"),
            "Tycho has no command 42. It runs filter, sort, find, pin, unpin, hide, show, jump, clear, and undo."
        );
        assert_eq!(
            error("hide"),
            "hide takes one or more columns: hide nst, dmin."
        );
        assert_eq!(
            error("show ,"),
            "show takes one or more columns: show nst, dmin."
        );
        assert_eq!(
            error("hide \"a b\" c, d"),
            "hide takes columns between commas; a name with a space goes in double quotes."
        );
    }

    #[test]
    fn later_verbs_meet_their_goal() {
        assert_eq!(
            parse("group mag"),
            Parsed::Later {
                verb: "group",
                goal: "profiles and the catalog",
                step: None
            }
        );
        assert!(matches!(
            parse("export csv"),
            Parsed::Later { verb: "export", .. }
        ));
        assert_eq!(parse("open other.csv"), Parsed::Open);
    }

    #[test]
    fn hide_and_show_take_columns_between_commas() {
        let names = |names: &[&str]| {
            names
                .iter()
                .map(|name| Name::bare(*name))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            parse("hide nst, dmin, rms"),
            action(Step::Hide(names(&["nst", "dmin", "rms"])))
        );
        assert_eq!(parse("HIDE nst"), action(Step::Hide(names(&["nst"]))));
        // Commas anywhere outside quotes, a trailing one dropped.
        assert_eq!(
            parse("hide nst,dmin ,rms,"),
            action(Step::Hide(names(&["nst", "dmin", "rms"])))
        );
        assert_eq!(
            parse(r#"show "launch date", "a,b", mag"#),
            action(Step::Show(names(&["launch date", "a,b", "mag"])))
        );
        // Bare words between commas read as one name.
        assert_eq!(
            parse("hide launch date, mag"),
            action(Step::Hide(vec![
                Name {
                    text: "launch date".into(),
                    spaced: true
                },
                Name::bare("mag")
            ]))
        );
        assert_eq!(parse("show all"), action(Step::ShowAll));
        assert_eq!(parse("show ALL"), action(Step::ShowAll));
        // A column named all, in quotes.
        assert_eq!(parse(r#"show "all""#), action(Step::Show(names(&["all"]))));
        assert_eq!(
            Step::Hide(names(&["nst", "launch date"])).written(),
            r#"hide nst, "launch date""#
        );
        assert_eq!(
            Step::Hide(names(&["nst", "dmin", "rms"])).words(),
            "Hide nst, dmin, and rms"
        );
    }

    #[test]
    fn sentences() {
        assert_eq!(parse("which launches failed"), Parsed::Sentence);
        assert_eq!(parse("Show me the heaviest ones?"), Parsed::Sentence);
        assert_eq!(parse("what's the biggest mass"), Parsed::Sentence);
        // A word a verb's typo away, in a longer line: still a sentence.
        assert_eq!(parse("how many launches failed"), Parsed::Sentence);
        assert_eq!(parse("to the end"), Parsed::Sentence);
        // A verb leads: a command, whatever follows.
        assert!(matches!(
            parse("pin the first column"),
            Parsed::Action { .. }
        ));
    }

    #[test]
    fn json_and_typed_alike() {
        let json = |text| match parse(text) {
            Parsed::Action { steps, form } => {
                assert_eq!(form, Form::Json);
                steps
            }
            other => panic!("{text:?} read as {other:?}"),
        };
        let typed = |text| match parse(text) {
            Parsed::Action { steps, form } => {
                assert_eq!(form, Form::Typed);
                steps
            }
            other => panic!("{text:?} read as {other:?}"),
        };
        assert_eq!(json(r#"{"pin": {"column": "mag"}}"#), typed("pin mag"));
        assert_eq!(
            json(r#"{"unpin": {"column": "launch date"}}"#),
            typed(r#"unpin "launch date""#)
        );
        assert_eq!(json(r#"{"jump": {"row": 1204}}"#), typed("jump 1204"));
        assert_eq!(json(r#"{"jump": {"row": "1,204"}}"#), typed("jump 1,204"));
        assert_eq!(json(r#"{"jump": {"row": 1204.0}}"#), typed("jump 1204"));
        assert_eq!(json(r#"{"jump": {"row": 1e3}}"#), typed("jump 1000"));
        assert_eq!(json(r#"{"jump": {"row": 1.5}}"#), typed("jump 1.5"));
        assert_eq!(json(r#"{"undo": {}}"#), typed("undo"));
        assert_eq!(
            json(r#"{"hide": ["nst", "dmin", "rms"]}"#),
            typed("hide nst, dmin, rms")
        );
        assert_eq!(json(r#"{"hide": "nst"}"#), typed("hide nst"));
        assert_eq!(
            json(r#"{"show": ["launch date"]}"#),
            typed(r#"show "launch date""#)
        );
        assert_eq!(json(r#"{"show": "all"}"#), typed("show all"));
        assert_eq!(json(r#"{"show": ["all"]}"#), typed(r#"show "all""#));
        assert_eq!(
            json(r#"{"actions": [{"pin": {"column": "mag"}}, {"jump": {"row": 9}}]}"#),
            [Step::Pin(Name::bare("mag")), Step::Jump("9".into())]
        );
    }

    #[test]
    fn json_faults() {
        let error = |text| match parse(text) {
            Parsed::Error(why) => why,
            other => panic!("{text:?} read as {other:?}"),
        };
        assert!(error(r#"{"pin": "#).starts_with("That reads as JSON, and it doesn't parse"));
        assert_eq!(
            error(r#"{"pin": {"col": "mag"}}"#),
            "pin has no part \"col\"."
        );
        assert_eq!(error(r#"{"pin": {}}"#), "pin needs a \"column\".");
        assert_eq!(
            error(r#"{"hide": []}"#),
            r#"hide takes a list of columns' names: {"hide": ["nst", "dmin"]}."#
        );
        assert_eq!(
            error(r#"{"show": [1]}"#),
            r#"show takes a list of columns' names, in quotes: {"show": ["nst", "dmin"]}."#
        );
        assert_eq!(
            error(r#"{"actions": [{"pin": {"column": "a"}}, {"frob": {}}]}"#),
            "Step 2 of 2: Tycho has no command frob."
        );
        assert_eq!(
            error(r#"{"actions": []}"#),
            "\"actions\" holds a list of steps."
        );
        assert_eq!(
            error(r#"{"pin": {"column": "a"}, "unpin": {"column": "b"}}"#),
            "a step is an object with one verb."
        );
        assert_eq!(
            parse(r#"{"actions": [{"pin": {"column": "a"}}, {"group": {"column": "a"}}]}"#),
            Parsed::Later {
                verb: "group",
                goal: "profiles and the catalog",
                step: Some(1)
            }
        );
    }

    fn typed(text: &str) -> Step {
        match parse(text) {
            Parsed::Action { steps, form } if steps.len() == 1 => {
                assert_eq!(form, Form::Typed);
                steps.into_iter().next().unwrap()
            }
            other => panic!("{text:?} read as {other:?}"),
        }
    }

    fn error(text: &str) -> String {
        match parse(text) {
            Parsed::Error(why) => why,
            other => panic!("{text:?} read as {other:?}"),
        }
    }

    fn filter(column: &str, op: Op, words: &[&str]) -> Step {
        Step::Filter {
            column: Name::bare(column),
            op,
            value: Given::Typed(words.iter().map(|word| (*word).to_owned()).collect()),
        }
    }

    #[test]
    fn filter_lines() {
        assert_eq!(typed("filter mag >= 4.5"), filter("mag", Op::Ge, &["4.5"]));
        // The operator against its column, or its value, or both.
        assert_eq!(typed("filter mag>=4.5"), filter("mag", Op::Ge, &["4.5"]));
        assert_eq!(typed("filter mag >=4.5"), filter("mag", Op::Ge, &["4.5"]));
        assert_eq!(typed("filter mag> -3"), filter("mag", Op::Gt, &["-3"]));
        assert_eq!(typed("filter mag == 1"), filter("mag", Op::Eq, &["1"]));
        assert_eq!(typed("filter mag <> 1"), filter("mag", Op::Ne, &["1"]));
        // A value is taken as written: its symbols aren't an operator.
        assert_eq!(
            typed("filter url contains a=b"),
            filter("url", Op::Contains, &["a=b"])
        );
        assert_eq!(
            typed(r#"filter owner = "United States""#),
            filter("owner", Op::Eq, &["United States"])
        );
        assert_eq!(
            typed(r#"filter "launch date" > 1990-01-01"#),
            filter("launch date", Op::Gt, &["1990-01-01"])
        );
        assert_eq!(
            typed("filter launch date > 1990-01-01"),
            Step::Filter {
                column: Name {
                    text: "launch date".into(),
                    spaced: true
                },
                op: Op::Gt,
                value: Given::Typed(vec!["1990-01-01".into()])
            }
        );
        assert_eq!(
            typed("filter name CONTAINS starlink"),
            filter("name", Op::Contains, &["starlink"])
        );
        assert_eq!(
            typed("filter name starts Cosmos"),
            filter("name", Op::Starts, &["Cosmos"])
        );
        assert_eq!(
            typed("filter magType in mb, mww,ml"),
            filter("magType", Op::In, &["mb", "mww", "ml"])
        );
        assert_eq!(
            typed(r#"filter owner in "United States", CN"#),
            filter("owner", Op::In, &["United States", "CN"])
        );
        assert_eq!(
            typed("filter mass between 1 AND 10"),
            filter("mass", Op::Between, &["1", "10"])
        );
        assert_eq!(
            typed("filter name is null"),
            filter("name", Op::IsNull, &[])
        );
        assert_eq!(
            typed("filter name not null"),
            filter("name", Op::NotNull, &[])
        );
        assert_eq!(
            typed("filter name is not null"),
            filter("name", Op::NotNull, &[])
        );
        // A column named as an operator word comes first: it's the column.
        assert_eq!(typed("filter in = 1"), filter("in", Op::Eq, &["1"]));
        let written = |text: &str| typed(text).written();
        assert_eq!(written("filter mag>=4.5"), "filter mag >= 4.5");
        assert_eq!(
            written(r#"filter owner in "United States", CN"#),
            r#"filter owner in "United States", CN"#
        );
        assert_eq!(
            written("filter mass between 1 and 10"),
            "filter mass between 1 and 10"
        );
        assert_eq!(written("filter name is null"), "filter name is null");
    }

    #[test]
    fn filter_faults() {
        assert_eq!(
            error("filter"),
            "filter takes a column, an operator, and a value: filter mag >= 4.5."
        );
        assert!(error("filter mag").starts_with("filter takes an operator after its column ("));
        assert_eq!(
            error("filter >= 4"),
            "filter takes a column before its operator: filter mag >= 4.5."
        );
        assert_eq!(error("filter mag >="), ">= takes a value after it.");
        assert_eq!(
            error("filter owner = United States"),
            r#"= takes one value; a value with a space goes in double quotes: filter owner = "United States"."#
        );
        assert_eq!(
            error("filter mass between 1"),
            "between takes two values joined by and: filter mass between 1 and 10."
        );
        assert_eq!(
            error("filter mass between 1 or 2"),
            "between takes two values joined by and: filter mass between 1 and 10."
        );
        assert_eq!(
            error("filter m in"),
            "in takes one or more values between commas: filter m in a, b."
        );
        assert!(
            error("filter m in United States, CN").starts_with("in takes values between commas")
        );
        assert_eq!(
            error("filter name is null x"),
            "is null takes nothing after it."
        );
        assert_eq!(
            error("filter name is"),
            "is takes null: filter mag is null, or not null."
        );
        assert!(
            error("filter mag => 4").starts_with("Tycho has no operator =>. A filter takes =, !=,")
        );
    }

    #[test]
    fn sort_clear_and_find_lines() {
        let sort = |name: &str, direction| Step::Sort {
            column: Name::bare(name),
            direction,
        };
        assert_eq!(typed("sort mag"), sort("mag", None));
        assert_eq!(typed("sort mag DESC"), sort("mag", Some(Direction::Desc)));
        assert_eq!(typed("sort mag asc"), sort("mag", Some(Direction::Asc)));
        // A column named desc, alone or in quotes.
        assert_eq!(typed("sort desc"), sort("desc", None));
        assert_eq!(
            typed(r#"sort "desc" asc"#),
            sort("desc", Some(Direction::Asc))
        );
        assert_eq!(
            typed("sort launch date desc"),
            Step::Sort {
                column: Name {
                    text: "launch date".into(),
                    spaced: true
                },
                direction: Some(Direction::Desc)
            }
        );
        assert_eq!(error("sort"), "sort takes a column: sort mag.");
        assert_eq!(typed("clear filters"), Step::Clear(Clear::Filters));
        assert_eq!(typed("CLEAR Sort"), Step::Clear(Clear::Sort));
        assert_eq!(typed("clear all"), Step::Clear(Clear::All));
        assert_eq!(
            typed(r#"clear filter "launch date""#),
            Step::Clear(Clear::Filter(Name::bare("launch date")))
        );
        assert_eq!(
            error("clear filter"),
            "clear filter takes a column: clear filter mag. clear filters clears every filter."
        );
        assert_eq!(
            error("clear"),
            "clear takes filter and a column, filters, sort, or all: clear filters."
        );
        assert_eq!(
            error("clear everything"),
            "clear takes filter and a column, filters, sort, or all: clear filters."
        );
        assert_eq!(typed("find starlink"), Step::Find("starlink".into()));
        assert_eq!(typed("find low  earth "), Step::Find("low  earth".into()));
        assert_eq!(typed(r#"find "a ""b""""#), Step::Find(r#"a "b""#.into()));
        assert_eq!(
            error("find"),
            "find takes the text to look for: find starlink."
        );
        assert_eq!(typed("find low earth").written(), r#"find "low earth""#);
        // Quoted words among others: their texts, not their quotes.
        assert_eq!(
            typed(r#"find "low earth" orbit"#),
            Step::Find("low earth orbit".into())
        );
    }

    #[test]
    fn filter_sort_clear_and_find_json() {
        let json = |text: &str| match parse(text) {
            Parsed::Action { steps, form } => {
                assert_eq!(form, Form::Json);
                steps
            }
            other => panic!("{text:?} read as {other:?}"),
        };
        assert_eq!(
            json(r#"{"filter": {"column": "inclination_deg", "op": ">=", "value": 90}}"#),
            [Step::Filter {
                column: Name::bare("inclination_deg"),
                op: Op::Ge,
                value: Given::Json(Values::One(Value::Number(90.into())))
            }]
        );
        assert_eq!(
            json(r#"{"filter": {"column": "name", "op": "is null"}}"#),
            [Step::Filter {
                column: Name::bare("name"),
                op: Op::IsNull,
                value: Given::Json(Values::None)
            }]
        );
        assert_eq!(
            json(r#"{"filter": {"column": "t", "op": "in", "value": ["a", "b"]}}"#),
            [Step::Filter {
                column: Name::bare("t"),
                op: Op::In,
                value: Given::Json(Values::Many(vec![
                    Value::Text("a".into()),
                    Value::Text("b".into())
                ]))
            }]
        );
        assert_eq!(
            json(r#"{"sort": {"column": "mag", "direction": "desc"}}"#),
            [Step::Sort {
                column: Name::bare("mag"),
                direction: Some(Direction::Desc)
            }]
        );
        assert_eq!(
            json(r#"{"sort": {"column": "mag"}}"#),
            [Step::Sort {
                column: Name::bare("mag"),
                direction: None
            }]
        );
        assert_eq!(
            json(r#"{"clear": "filters"}"#),
            [Step::Clear(Clear::Filters)]
        );
        assert_eq!(json(r#"{"clear": "all"}"#), [Step::Clear(Clear::All)]);
        assert_eq!(
            json(r#"{"clear": {"filter": "mag"}}"#),
            [Step::Clear(Clear::Filter(Name::bare("mag")))]
        );
        assert_eq!(
            json(r#"{"find": "starlink"}"#),
            [Step::Find("starlink".into())]
        );
        assert_eq!(
            json(r#"{"find": {"text": "starlink"}}"#),
            [Step::Find("starlink".into())]
        );
        assert_eq!(
            error(r#"{"filter": {"column": "mag", "op": "like", "value": 1}}"#)
                .split('.')
                .next(),
            Some("Tycho has no operator like")
        );
        assert_eq!(
            error(r#"{"filter": {"column": "mag", "value": 1}}"#),
            "filter needs an \"op\"."
        );
        assert_eq!(
            error(r#"{"filter": {"column": "mag", "op": "=", "value": {"a": 1}}}"#),
            "filter's \"value\" is a number, text, true or false, or a list of them."
        );
        assert_eq!(
            error(r#"{"sort": {"column": "mag", "direction": "up"}}"#),
            "sort's \"direction\" is \"asc\" or \"desc\"."
        );
        assert!(error(r#"{"clear": "everything"}"#).starts_with("clear takes"));
        assert_eq!(
            error(r#"{"find": 3}"#),
            r#"find takes text: {"find": {"text": "starlink"}}."#
        );
    }

    #[test]
    fn quoting() {
        assert_eq!(quote("mag"), "mag");
        assert_eq!(quote("launch date"), "\"launch date\"");
        assert_eq!(quote("12\" pizza"), "\"12\"\" pizza\"");
        assert_eq!(quote("desc"), "\"desc\"");
        assert_eq!(quote("Pin"), "\"Pin\"");
        assert_eq!(quote(""), "\"\"");
        assert_eq!(quote("a,b"), "\"a,b\"");
        // An operator's symbols: a bare name with one would split.
        assert_eq!(quote("a>b"), "\"a>b\"");
        assert_eq!(quote("filter"), "\"filter\"");
        // What `quote` writes reads back as the name.
        for name in [
            "launch date",
            "12\" pizza",
            "desc",
            "",
            "a,b",
            "日付",
            "a>=b",
        ] {
            assert_eq!(
                parse(&format!("pin {}", quote(name))),
                pin(name),
                "{name:?}"
            );
        }
    }

    #[test]
    fn lists_and_distance() {
        assert_eq!(list(["a"], "and"), "a");
        assert_eq!(list(["a", "b"], "or"), "a or b");
        assert_eq!(list(["a", "b", "c"], "and"), "a, b, and c");
        assert_eq!(distance("mag", "mag"), 0);
        assert_eq!(distance("mag", "nag"), 1);
        assert_eq!(distance("magtype", "mag"), 4);
        assert_eq!(distance("pni", "pin"), 1);
    }
}
