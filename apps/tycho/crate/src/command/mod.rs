//! The command bar's grammar: one parser for a typed line and an agent's
//! JSON, both read to the same steps (`docs/DECISIONS.md`, "Scope",
//! 2026-11-21, "A command is a verb, then a column, then its parts").
//!
//! A typed line is a verb, then its parts: `pin mag`, `unpin "launch
//! date"`, `jump 1,204`, `undo`. A column's name is bare, or in double
//! quotes with a quote inside written twice; it's matched without regard to
//! case ([`plan`]). JSON names the same verbs as keys, `{"pin": {"column":
//! "mag"}}`, several steps under `"actions"`. The bar runs the verbs the
//! controller can do today; every other verb of the grammar is answered
//! with the goal it comes with ([`LATER`]), and a line that opens with no
//! verb and reads as words is a sentence, which Tycho doesn't read
//! (2026-11-24, "The first command bar runs what the controller can do
//! today").
//!
//! [`plan`] checks the steps against the open file, all or none;
//! [`complete`] says what's being typed and what matches.

mod complete;
pub mod plan;

pub use complete::{Completion, Item, Part, Preview, complete};
pub use plan::{Catalog, Checked, Plan, Refusal, plan};

/// A verb the bar runs now, with what it does (completion's hint).
pub const VERBS: &[(&str, &str)] = &[
    ("pin", "Pin a column"),
    ("unpin", "Unpin a column"),
    ("jump", "Jump to a row"),
    ("undo", "Go back one step"),
];

/// The grammar's other verbs, each with the goal that builds it (`PLAN.md`).
pub const LATER: &[(&str, &str)] = &[
    ("filter", "sort, filter, and find"),
    ("sort", "sort, filter, and find"),
    ("find", "sort, filter, and find"),
    ("clear", "sort, filter, and find"),
    ("hide", "the table's basics"),
    ("show", "the table's basics"),
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
    /// The row's number as written (`jump.rs` reads it against the rows).
    Jump(String),
    Undo,
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
            Self::Jump(row) => format!("Jump to row {}", row.trim()),
            Self::Undo => "Undo".into(),
        }
    }

    /// The step as a command line, its name as written.
    pub fn written(&self) -> String {
        match self {
            Self::Pin(name) => format!("pin {}", quote(&name.text)),
            Self::Unpin(name) => format!("unpin {}", quote(&name.text)),
            Self::Jump(row) => format!("jump {}", row.trim()),
            Self::Undo => "undo".into(),
        }
    }
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
        Some("pin") => {
            column_step(rest, "pin").map_or_else(Parsed::Error, |name| action(Step::Pin(name)))
        }
        Some("unpin") => {
            column_step(rest, "unpin").map_or_else(Parsed::Error, |name| action(Step::Unpin(name)))
        }
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
        Some("pin") => Ok(Ok(Step::Pin(column(fields(&["column"])?)?))),
        Some("unpin") => Ok(Ok(Step::Unpin(column(fields(&["column"])?)?))),
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
            .any(|c| c.is_whitespace() || c == '"' || c == ',')
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
            "Tycho has no command 42. It runs pin, unpin, jump, and undo."
        );
    }

    #[test]
    fn later_verbs_meet_their_goal() {
        assert_eq!(
            parse("sort mag desc"),
            Parsed::Later {
                verb: "sort",
                goal: "sort, filter, and find",
                step: None
            }
        );
        assert!(matches!(
            parse("HIDE mag"),
            Parsed::Later { verb: "hide", .. }
        ));
        assert!(matches!(
            parse("export csv"),
            Parsed::Later { verb: "export", .. }
        ));
        assert_eq!(parse("open other.csv"), Parsed::Open);
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
            parse(r#"{"actions": [{"pin": {"column": "a"}}, {"sort": {"column": "a"}}]}"#),
            Parsed::Later {
                verb: "sort",
                goal: "sort, filter, and find",
                step: Some(1)
            }
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
        // What `quote` writes reads back as the name.
        for name in ["launch date", "12\" pizza", "desc", "", "a,b", "日付"] {
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
