//! The elements file (`docs/data.md`, "`elements.bin`"): every row's orbit
//! at one epoch and its H, seven columns of 32-bit floats behind a 16-byte
//! header. What the scene draws from, and the table's a, e, i, and H.

use crate::bytes::Bytes;

/// The epoch every row's mean anomaly is at: a Julian day, TDB (2026-06-09).
/// The file's header says the same, or it isn't read: every dot would be
/// drawn at a place it isn't, with nothing to say so.
pub const EPOCH_JD: f64 = 2_461_200.5;

/// One turn of a 1 au orbit, in days (the Gaussian constant's): the year
/// the clock counts in, so a row's period is its a^1.5 of them.
pub const YEAR_DAYS: f64 = 365.256_898_326_3;

const MAGIC: &[u8; 4] = b"KWE1";
const HEADER: usize = 16;

/// The file's columns, in its order.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Element {
    /// The semi-major axis, au.
    A,
    /// The eccentricity.
    E,
    /// The inclination, degrees.
    I,
    /// The longitude of the ascending node, degrees.
    Node,
    /// The argument of perihelion, degrees.
    Perihelion,
    /// The mean anomaly at [`EPOCH_JD`], degrees: -180 to 180 on an ellipse.
    MeanAnomaly,
    /// The absolute magnitude; NaN for none.
    H,
}

impl Element {
    pub const COUNT: usize = 7;
}

pub struct Elements {
    bytes: Bytes,
    rows: usize,
    /// The rows with an ellipse, counted once as the file is read.
    bound: usize,
}

impl Elements {
    /// The file, or why its bytes aren't one.
    pub fn new(bytes: Bytes) -> Result<Self, String> {
        if bytes.len() < HEADER || bytes.u32_at(0) != u32::from_le_bytes(*MAGIC) {
            return Err("the elements file doesn't start as one (KWE1)".into());
        }
        let rows = bytes.u32_at(4) as usize;
        let epoch = bytes.f64_at(8);
        if epoch != EPOCH_JD {
            return Err(format!(
                "the elements file's epoch is JD {epoch}, and the clock counts from JD {EPOCH_JD}"
            ));
        }
        if bytes.len() as u64 != HEADER as u64 + rows as u64 * Element::COUNT as u64 * 4 {
            return Err(format!(
                "the elements file is {} bytes, not its {rows} rows' seven columns",
                bytes.len()
            ));
        }
        let mut elements = Self {
            bytes,
            rows,
            bound: 0,
        };
        elements.bound = (0..rows).filter(|row| elements.is_bound(*row)).count();
        Ok(elements)
    }

    pub fn rows(&self) -> usize {
        self.rows
    }

    /// A row's `element`, as stored.
    #[inline]
    pub fn get(&self, element: Element, row: usize) -> f32 {
        assert!(row < self.rows);
        self.bytes
            .f32_at(HEADER + (element as usize * self.rows + row) * 4)
    }

    /// Where the columns are in memory: [`Element::COUNT`] runs of
    /// [`Self::rows`] 32-bit floats, end to end, in the file's order. The
    /// scene's attributes are views over them.
    pub fn columns_ptr(&self) -> *const f32 {
        self.bytes.as_ptr().wrapping_add(HEADER).cast()
    }

    /// The rows whose orbit is an ellipse: the ones the scene draws.
    pub fn bound(&self) -> usize {
        self.bound
    }

    /// Whether a row's orbit is an ellipse. A row whose isn't (e not below
    /// 1, a below 0) keeps its a and e; its mean anomaly is a hyperbola's.
    pub fn is_bound(&self, row: usize) -> bool {
        self.get(Element::E, row) < 1.0 && self.get(Element::A, row) > 0.0
    }
}
