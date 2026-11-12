//! The two files as one table: the 18 columns of Tycho's asteroid sample,
//! in its order, each cell read from the files' bytes when it's asked for
//! (`docs/data.md`). A, e, i, and H are the elements file's own floats, so a
//! cell and its dot never disagree; q and the period follow from a and e.

use std::rc::Rc;

use seiza_tall_table::{CellValue, ColumnKind, TallTableColumn};

use crate::elements::{Element, Elements, YEAR_DAYS};
use crate::rows::{Flag, Observed, Rows};

/// The columns, in the table's order.
pub mod column {
    pub const SPKID: usize = 0;
    pub const FULL_NAME: usize = 1;
    pub const PDES: usize = 2;
    pub const NAME: usize = 3;
    pub const NEO: usize = 4;
    pub const PHA: usize = 5;
    pub const CLASS: usize = 6;
    pub const H: usize = 7;
    pub const DIAMETER: usize = 8;
    pub const ALBEDO: usize = 9;
    pub const A: usize = 10;
    pub const E: usize = 11;
    pub const I: usize = 12;
    pub const Q: usize = 13;
    pub const PER_Y: usize = 14;
    pub const FIRST_OBS: usize = 15;
    pub const LAST_OBS: usize = 16;
    pub const N_OBS_USED: usize = 17;
    pub const COUNT: usize = 18;
}

/// The columns' names, as the sample spells them.
pub const NAMES: [&str; column::COUNT] = [
    "spkid",
    "full_name",
    "pdes",
    "name",
    "neo",
    "pha",
    "class",
    "H",
    "diameter",
    "albedo",
    "a",
    "e",
    "i",
    "q",
    "per_y",
    "first_obs",
    "last_obs",
    "n_obs_used",
];

/// Every row: its orbit and H from the elements file, the rest of it from
/// the rows file.
pub struct Catalog {
    /// Shared with the scene's side, which has them before the rows arrive.
    elements: Rc<Elements>,
    rows: Rows,
}

impl Catalog {
    /// The two files as one, if they're of the same rows.
    pub fn new(elements: Rc<Elements>, rows: Rows) -> Result<Self, String> {
        if elements.rows() != rows.rows() {
            return Err(format!(
                "the elements file has {} rows and the rows file {}: they aren't one fetch's",
                elements.rows(),
                rows.rows()
            ));
        }
        Ok(Self { elements, rows })
    }

    /// The rows, counted by the files' own headers (each checked against
    /// its file's length).
    pub fn rows(&self) -> usize {
        self.rows.rows()
    }

    pub fn elements(&self) -> &Elements {
        &self.elements
    }

    pub fn file_rows(&self) -> &Rows {
        &self.rows
    }

    /// A row's perihelion distance, au: a(1 − e), in the precision a and e
    /// are held at.
    pub fn q(&self, row: usize) -> f32 {
        let (a, e) = self.a_e(row);
        (a * (1.0 - e)) as f32
    }

    /// A row's period in years of 365.25 days, as JPL counts `per_y`: its
    /// a^1.5 turns of a 1 au orbit. None where the orbit isn't an ellipse.
    pub fn period(&self, row: usize) -> Option<f32> {
        let (a, _) = self.a_e(row);
        self.elements
            .is_bound(row)
            .then(|| (a * a.sqrt() * YEAR_DAYS / 365.25) as f32)
    }

    fn a_e(&self, row: usize) -> (f64, f64) {
        (
            f64::from(self.elements.get(Element::A, row)),
            f64::from(self.elements.get(Element::E, row)),
        )
    }

    /// The cell at `row` and `column` (see [`column`]).
    pub fn value(&self, row: usize, column: usize) -> CellValue<'_> {
        let text = |text: String| CellValue::Text(text.into());
        let float = |value: f32| {
            if value.is_nan() {
                CellValue::Null
            } else {
                CellValue::Float32(value)
            }
        };
        let flag = |flag: Flag| match flag {
            Flag::No => CellValue::Text("false".into()),
            Flag::Yes => CellValue::Text("true".into()),
            Flag::Unknown => CellValue::Null,
        };
        let rows = &self.rows;
        match column {
            column::SPKID => text(rows.spkid(row).to_string()),
            column::FULL_NAME => text(rows.full_name(row)),
            column::PDES => text(rows.pdes(row)),
            column::NAME => rows.name(row).map_or(CellValue::Null, text),
            column::NEO => flag(rows.neo(row)),
            column::PHA => flag(rows.pha(row)),
            column::CLASS => CellValue::Text(rows.class(row).into()),
            column::H => float(self.elements.get(Element::H, row)),
            column::DIAMETER => float(rows.diameter(row)),
            column::ALBEDO => float(rows.albedo(row)),
            column::A => float(self.elements.get(Element::A, row)),
            column::E => float(self.elements.get(Element::E, row)),
            column::I => float(self.elements.get(Element::I, row)),
            column::Q => float(self.q(row)),
            column::PER_Y => self.period(row).map_or(CellValue::Null, float),
            column::FIRST_OBS => rows
                .observed(Observed::First, row)
                .map_or(CellValue::Null, text),
            column::LAST_OBS => rows
                .observed(Observed::Last, row)
                .map_or(CellValue::Null, text),
            column::N_OBS_USED => text(rows.n_obs_used(row).to_string()),
            _ => CellValue::Null,
        }
    }
}

/// The table's columns: the sample's kinds.
pub fn columns() -> Vec<TallTableColumn> {
    use ColumnKind::{Boolean, Date, Float, Integer, Text};
    let kinds = [
        Integer { max_chars: 8 },
        Text,
        Text,
        Text,
        Boolean,
        Boolean,
        Text,
        Float,
        Float,
        Float,
        Float,
        Float,
        Float,
        Float,
        Float,
        Date,
        Date,
        Integer { max_chars: 5 },
    ];
    NAMES
        .into_iter()
        .zip(kinds)
        .map(|(name, kind)| TallTableColumn::new(name, kind))
        .collect()
}

#[cfg(test)]
mod tests {
    //! The readers against the fetch's own cells, for a row of each of the
    //! files' rules: `data/fixture.json`, written by `data/prep.ts`, read
    //! from the two files it built (`data/elements.bin`, `data/rows.bin`).
    //! The files are gitignored, so these tests are `#[ignore]`d: a
    //! workspace-wide `cargo test` passes on a checkout without them, and
    //! `just kirkwood test` runs them and fails without the files.

    use std::path::{Path, PathBuf};

    use seiza_tall_table::CellValue;
    use serde_json::Value;

    use super::{Catalog, NAMES, column, columns};
    use crate::bytes::Bytes;
    use crate::elements::{Element, Elements};
    use crate::rows::Rows;

    /// Every rule the fixture must hold a row for (`docs/data.md`).
    const RULES: [&str; 12] = [
        "numbered and named",
        "numbered, no name",
        "not numbered",
        "a designation with A/",
        "a survey's designation, the last row",
        "a first observation with only its year",
        "no H",
        "no diameter",
        "a diameter and an albedo",
        "a near-Earth asteroid",
        "the circle with no mean anomaly",
        "no ellipse",
    ];

    fn data() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../data")
    }

    fn json(name: &str) -> Value {
        let text = std::fs::read_to_string(data().join(name)).expect(name);
        serde_json::from_str(&text).expect(name)
    }

    fn file(name: &str) -> Bytes {
        let path = data().join(name);
        let bytes = std::fs::read(&path).unwrap_or_else(|error| {
            panic!(
                "{}: {error}. The two files aren't in the repo: build them with \
                 `node apps/kirkwood/data/fetch.ts` (once), then \
                 `node --max-old-space-size=12000 apps/kirkwood/data/prep.ts`",
                path.display()
            )
        });
        let manifest = json("MANIFEST.json");
        assert_eq!(
            Some(bytes.len() as u64),
            manifest[name]["bytes"].as_u64(),
            "{name} isn't the manifest's: run data/prep.ts"
        );
        Bytes::from_bytes(&bytes)
    }

    fn catalog() -> Catalog {
        let elements = Elements::new(file("elements.bin")).expect("the elements file");
        let rows = Rows::new(file("rows.bin")).expect("the rows file");
        Catalog::new(elements.into(), rows).expect("one fetch's files")
    }

    /// A fetched cell as a number: JPL writes its floats as text.
    fn number(cell: &Value) -> f64 {
        match cell {
            Value::String(text) => text.parse().expect("a number"),
            other => other.as_f64().expect("a number"),
        }
    }

    /// What a cell must be for the fetch's `cell` in `column`, or why
    /// `value` isn't it.
    fn check(
        column: usize,
        value: &CellValue<'_>,
        cell: &Value,
        bound: bool,
    ) -> Result<(), String> {
        let wrong = || Err(format!("{value:?} for the fetch's {cell}"));
        // None in the fetch is NULL in the table; a hyperbola has no period.
        if cell.is_null() {
            return if *value == CellValue::Null {
                Ok(())
            } else {
                wrong()
            };
        }
        let same = match column {
            // Text, as the fetch writes it.
            column::FULL_NAME
            | column::PDES
            | column::NAME
            | column::CLASS
            | column::FIRST_OBS
            | column::LAST_OBS => {
                matches!(value, CellValue::Text(text) if Some(text.as_ref()) == cell.as_str())
            }
            // Integers, exact.
            column::SPKID | column::N_OBS_USED => {
                matches!(value, CellValue::Text(text) if cell.as_u64().map(|n| n.to_string()).as_deref() == Some(text.as_ref()))
            }
            // JPL's Y and N.
            column::NEO | column::PHA => {
                let expect = if cell == "Y" { "true" } else { "false" };
                matches!(value, CellValue::Text(text) if text == expect)
            }
            // Few digits in the fetch: the float's shortest text is the
            // fetch's own number.
            column::H | column::DIAMETER | column::ALBEDO => {
                matches!(value, CellValue::Float32(_) if value.to_string().parse::<f64>().ok() == Some(number(cell)))
            }
            // Sixteen digits in the fetch: the nearest float to them.
            column::A | column::E | column::I => {
                matches!(value, CellValue::Float32(stored) if *stored == number(cell) as f32)
            }
            // Computed from the stored a and e: within a part in 1,000 of
            // JPL's own column (prep's own bound; the worst rows are 2 and
            // 3 parts in 10,000 off).
            column::Q | column::PER_Y => {
                matches!(value, CellValue::Float32(computed) if (bound || column == column::Q)
                    && (f64::from(*computed) / number(cell) - 1.0).abs() < 1e-3)
            }
            _ => false,
        };
        if same { Ok(()) } else { wrong() }
    }

    #[test]
    #[ignore = "reads data/elements.bin and data/rows.bin, which a checkout builds (just kirkwood test)"]
    fn the_rows_are_the_manifests() {
        let catalog = catalog();
        let manifest = json("MANIFEST.json");
        let rows = &manifest["rows.bin"];
        assert_eq!(Some(catalog.rows() as u64), rows["rows"].as_u64());
        assert_eq!(
            Some(catalog.rows() as u64),
            manifest["elements.bin"]["rows"].as_u64()
        );
        assert_eq!(
            Some(catalog.file_rows().numbered() as u64),
            rows["numbered"].as_u64()
        );
        assert_eq!(
            Some(catalog.file_rows().named() as u64),
            rows["named"].as_u64()
        );
        let classes: Vec<&str> = rows["classes"]
            .as_array()
            .expect("classes")
            .iter()
            .filter_map(Value::as_str)
            .collect();
        assert_eq!(catalog.file_rows().classes(), classes);
        assert_eq!(columns().len(), column::COUNT);
    }

    #[test]
    #[ignore = "reads data/elements.bin and data/rows.bin, which a checkout builds (just kirkwood test)"]
    fn fixture_rows_read_back_as_the_fetch() {
        let catalog = catalog();
        let fixture = json("fixture.json");
        let rows = fixture["rows"].as_array().expect("rows");
        let rules: Vec<&str> = rows.iter().filter_map(|row| row["rule"].as_str()).collect();
        assert_eq!(
            rules, RULES,
            "the fixture's rules aren't the ones this test knows"
        );
        for case in rows {
            let rule = case["rule"].as_str().expect("rule");
            let row = case["row"].as_u64().expect("row") as usize;
            let bound = catalog.elements().is_bound(row);
            for (column, name) in NAMES.into_iter().enumerate() {
                let value = catalog.value(row, column);
                if let Err(why) = check(column, &value, &case["cells"][name], bound) {
                    panic!("{rule} (row {row}), {name}: {why}");
                }
            }
            // The elements the table doesn't show, which the scene draws
            // from: the nearest floats to the fetch's, at the files' epoch.
            for (element, name) in [
                (Element::A, "a"),
                (Element::E, "e"),
                (Element::I, "i"),
                (Element::Node, "om"),
                (Element::Perihelion, "w"),
                (Element::MeanAnomaly, "ma"),
            ] {
                let expect = case["elements"][name].as_f64().expect(name) as f32;
                assert_eq!(
                    catalog.elements().get(element, row),
                    expect,
                    "{rule} (row {row}), {name}"
                );
            }
        }
        // What each rule is for, said of the rows themselves.
        let cell = |rule: &str, column: usize| {
            let case = rows.iter().find(|row| row["rule"] == rule).expect(rule);
            catalog
                .value(case["row"].as_u64().expect("row") as usize, column)
                .to_string()
        };
        assert_eq!(
            cell("numbered and named", column::FULL_NAME),
            "1 Ceres (A801 AA)"
        );
        assert_eq!(cell("numbered, no name", column::NAME), "NULL");
        assert!(cell("not numbered", column::FULL_NAME).starts_with('('));
        assert!(cell("a designation with A/", column::FULL_NAME).contains("(A/"));
        assert!(!cell("a designation with A/", column::PDES).contains("A/"));
        assert!(cell("a survey's designation, the last row", column::PDES).ends_with("P-L"));
        assert!(
            cell("a first observation with only its year", column::FIRST_OBS).ends_with("-??-??")
        );
        assert_eq!(cell("no H", column::H), "NULL");
        assert_eq!(cell("no diameter", column::DIAMETER), "NULL");
        assert_ne!(cell("a diameter and an albedo", column::ALBEDO), "NULL");
        assert_eq!(cell("a near-Earth asteroid", column::NEO), "true");
        assert_eq!(cell("the circle with no mean anomaly", column::E), "0.0");
        assert_eq!(cell("no ellipse", column::PER_Y), "NULL");
    }

    /// The scene lights the Trojans by their a and e (`ride::group`):
    /// those rows are the rows of class TJN, every one and no other.
    #[test]
    #[ignore = "reads data/elements.bin and data/rows.bin, which a checkout builds (just kirkwood test)"]
    fn the_trojans_by_a_and_e_are_the_rows_of_class_tjn() {
        use crate::elements::Element;
        use crate::ride::{Group, group};
        let catalog = catalog();
        let (elements, rows) = (catalog.elements(), catalog.file_rows());
        let (mut trojans, mut hildas) = (0, 0);
        for row in 0..catalog.rows() {
            let found = group(elements.get(Element::A, row), elements.get(Element::E, row));
            assert_eq!(
                found == Some(Group::Trojans),
                rows.class(row) == "TJN",
                "row {row}, of class {}",
                rows.class(row)
            );
            trojans += usize::from(found == Some(Group::Trojans));
            hildas += usize::from(found == Some(Group::Hildas));
        }
        assert_eq!((trojans, hildas), (16_472, 8_400));
    }

    /// The control: a reader that's one row off, or reads another column,
    /// must not pass for the fetch's.
    #[test]
    #[ignore = "reads data/elements.bin and data/rows.bin, which a checkout builds (just kirkwood test)"]
    fn a_wrong_cell_fails_the_check() {
        let catalog = catalog();
        let fixture = json("fixture.json");
        for case in fixture["rows"].as_array().expect("rows") {
            let row = case["row"].as_u64().expect("row") as usize;
            let other = if row == 0 { 1 } else { row - 1 };
            let bound = catalog.elements().is_bound(row);
            for (column, name) in [
                (column::SPKID, "spkid"),
                (column::FULL_NAME, "full_name"),
                (column::A, "a"),
            ] {
                assert!(
                    check(
                        column,
                        &catalog.value(other, column),
                        &case["cells"][name],
                        bound
                    )
                    .is_err()
                );
            }
            assert!(
                check(
                    column::A,
                    &catalog.value(row, column::E),
                    &case["cells"]["a"],
                    bound
                )
                .is_err()
            );
        }
    }
}
