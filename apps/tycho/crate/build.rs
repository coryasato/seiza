//! Reads Tycho's token file (`web/src/tokens.css`), the one source of the
//! page's and the table's colors, into `$OUT_DIR/tokens.rs`: a `Tokens`
//! value per theme, in sRGB, for `src/theme.rs`. A line the parser can't
//! read fails the build, so the two sides never drift.

use std::fmt::Write as _;
use std::path::PathBuf;

const FILE: &str = "../web/src/tokens.css";
const THEMES: [(&str, &str); 2] = [("DARK", "dark"), ("LIGHT", "light")];

fn main() {
    println!("cargo::rerun-if-changed={FILE}");
    let css = std::fs::read_to_string(FILE).unwrap_or_else(|error| panic!("{FILE}: {error}"));
    let themes: Vec<_> = THEMES
        .iter()
        .map(|(constant, name)| (*constant, tokens(&css, name)))
        .collect();
    let names: Vec<&str> = themes[0].1.iter().map(|(name, _)| name.as_str()).collect();
    for (constant, tokens) in &themes {
        let these: Vec<&str> = tokens.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(
            these, names,
            "{FILE}: {constant} lists other tokens than {}",
            themes[0].0
        );
    }

    let mut out = String::from(
        "/// One theme's tokens, from `web/src/tokens.css`.\n#[derive(Debug, Clone, Copy)]\npub struct Tokens {\n",
    );
    for name in &names {
        writeln!(out, "    pub {}: gpui_kit::Rgba,", field(name)).unwrap();
    }
    out.push_str("}\n");
    for (constant, tokens) in &themes {
        writeln!(out, "pub const {constant}: Tokens = Tokens {{").unwrap();
        for (name, [r, g, b, a]) in tokens {
            writeln!(
                out,
                "    {}: gpui_kit::Rgba {{ r: {r:?}, g: {g:?}, b: {b:?}, a: {a:?} }},",
                field(name)
            )
            .unwrap();
        }
        out.push_str("};\n");
    }
    let path = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("tokens.rs");
    std::fs::write(path, out).unwrap();
}

/// `accent-tint` → `accent_tint`.
fn field(name: &str) -> String {
    name.replace('-', "_")
}

/// The `--name: oklch(…)` lines of `:root[data-theme='<theme>'] { … }`.
fn tokens(css: &str, theme: &str) -> Vec<(String, [f32; 4])> {
    let head = format!(":root[data-theme='{theme}']");
    let start = css
        .find(&head)
        .unwrap_or_else(|| panic!("{FILE}: no {head} block"));
    let body = &css[start..];
    let body = &body[body.find('{').unwrap() + 1..body.find('}').unwrap()];
    body.lines()
        .map(|line| match line.find("/*") {
            Some(comment) => &line[..comment],
            None => line,
        })
        .map(str::trim)
        .filter(|line| line.starts_with("--"))
        .map(|line| {
            let (name, value) = line
                .split_once(':')
                .unwrap_or_else(|| panic!("{FILE}: {line}"));
            let value = value.trim().trim_end_matches(';');
            (
                name.trim_start_matches("--").to_owned(),
                oklch(value).unwrap_or_else(|| panic!("{FILE}: can't read {line}")),
            )
        })
        .collect()
}

/// `oklch(L C H)` or `oklch(L C H / A%)` as sRGB (gamma-encoded, 0–1,
/// clamped to the gamut) and alpha.
fn oklch(value: &str) -> Option<[f32; 4]> {
    let inner = value.strip_prefix("oklch(")?.strip_suffix(')')?;
    let (lch, alpha) = match inner.split_once('/') {
        Some((lch, alpha)) => (
            lch,
            alpha.trim().strip_suffix('%')?.parse::<f64>().ok()? / 100.0,
        ),
        None => (inner, 1.0),
    };
    let parts: Vec<f64> = lch
        .split_whitespace()
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    let [l, c, h] = parts[..] else { return None };
    let (a, b) = (c * h.to_radians().cos(), c * h.to_radians().sin());
    let l_ = (l + 0.396_337_777_4 * a + 0.215_803_757_3 * b).powi(3);
    let m_ = (l - 0.105_561_345_8 * a - 0.063_854_172_8 * b).powi(3);
    let s_ = (l - 0.089_484_177_5 * a - 1.291_485_548 * b).powi(3);
    let linear = [
        4.076_741_662_1 * l_ - 3.307_711_591_3 * m_ + 0.230_969_929_2 * s_,
        -1.268_438_004_6 * l_ + 2.609_757_401_1 * m_ - 0.341_319_396_5 * s_,
        -0.004_196_086_3 * l_ - 0.703_418_614_7 * m_ + 1.707_614_701 * s_,
    ];
    let encode = |u: f64| {
        let u = u.clamp(0.0, 1.0);
        let v = if u <= 0.003_130_8 {
            12.92 * u
        } else {
            1.055 * u.powf(1.0 / 2.4) - 0.055
        };
        ((v * 255.0).round() / 255.0) as f32
    };
    Some([
        encode(linear[0]),
        encode(linear[1]),
        encode(linear[2]),
        alpha as f32,
    ])
}
