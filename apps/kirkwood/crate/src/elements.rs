//! The elements file (`docs/data.md`, "`elements.bin`"): every row's orbit
//! at one epoch and its H, as 32-bit floats behind a 20-byte header. The
//! rows are in blocks, each block a column at a time, so the file's first
//! rows are whole when its first block is: the scene draws each block as it
//! arrives ([`Elements::arrived`]). What the scene draws from, and the
//! table's a, e, i, and H.

use crate::bytes::Bytes;

/// The epoch every row's mean anomaly is at: a Julian day, TDB (2026-06-09).
/// The file's header says the same, or it isn't read: every dot would be
/// drawn at a place it isn't, with nothing to say so.
pub const EPOCH_JD: f64 = 2_461_200.5;

/// One turn of a 1 au orbit, in days (the Gaussian constant's): the year
/// the clock counts in, so a row's period is its a^1.5 of them.
pub const YEAR_DAYS: f64 = 365.256_898_326_3;

const MAGIC: &[u8; 4] = b"KWE2";
/// The magic, the rows (u32), the epoch (f64), the rows in a block (u32).
const HEADER: usize = 20;

/// A block's columns, in its order.
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

/// A row's bytes: one float of each column.
const ROW: usize = Element::COUNT * 4;

/// What the header says: where every cell is.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Layout {
    rows: usize,
    /// The rows in a block; the last block has what's left.
    block: usize,
}

impl Layout {
    /// The header of a file `len` bytes long, or why it isn't one.
    fn read(bytes: &Bytes) -> Result<Self, String> {
        if bytes.len() < HEADER || bytes.u32_at(0) != u32::from_le_bytes(*MAGIC) {
            return Err("the elements file doesn't start as one (KWE2)".into());
        }
        let rows = bytes.u32_at(4) as usize;
        let epoch = bytes.f64_at(8);
        let block = bytes.u32_at(16) as usize;
        if epoch != EPOCH_JD {
            return Err(format!(
                "the elements file's epoch is JD {epoch}, and the clock counts from JD {EPOCH_JD}"
            ));
        }
        if block == 0 {
            return Err("the elements file's blocks have no rows".into());
        }
        if bytes.len() as u64 != HEADER as u64 + rows as u64 * ROW as u64 {
            return Err(format!(
                "the elements file is {} bytes, not its {rows} rows' seven columns",
                bytes.len()
            ));
        }
        // A block longer than the file is the file's one short block. Kept
        // no longer than the rows, a block's bytes are no more than the
        // file's, which are held: no product of the header's own numbers
        // can wrap (on wasm a `usize` is 32 bits).
        let block = block.min(rows.max(1));
        Ok(Self { rows, block })
    }

    fn blocks(&self) -> usize {
        self.rows.div_ceil(self.block)
    }

    /// The rows in `block`: the last one is short.
    fn block_rows(&self, block: usize) -> usize {
        self.block.min(self.rows - block * self.block)
    }

    /// Where `block` starts, in bytes.
    fn block_at(&self, block: usize) -> usize {
        HEADER + block * self.block * ROW
    }

    /// Where a row's `element` is, in bytes: in its block, the element's
    /// column, the row's place in the block.
    #[inline]
    fn at(&self, element: Element, row: usize) -> usize {
        let block = row / self.block;
        let column = element as usize * self.block_rows(block);
        self.block_at(block) + (column + row % self.block) * 4
    }

    /// The blocks that are whole once the file's first `held` bytes are.
    fn whole_blocks(&self, held: usize) -> usize {
        if held >= HEADER + self.rows * ROW {
            self.blocks()
        } else {
            held.saturating_sub(HEADER) / (self.block * ROW)
        }
    }
}

pub struct Elements {
    bytes: Bytes,
    /// Nothing until the header is held.
    layout: Option<Layout>,
    /// The rows whose block is whole: every row, once the file is held.
    whole: usize,
    /// For each whole block, the rows with an ellipse up to its end,
    /// counted as it arrives.
    bound: Vec<usize>,
}

impl Elements {
    /// Room for a file of `len` bytes, to be filled through
    /// [`Self::as_mut_ptr`] and read as far as [`Self::arrived`] is told.
    pub fn arriving(len: usize) -> Self {
        Self {
            bytes: Bytes::zeroed(len),
            layout: None,
            whole: 0,
            bound: Vec::new(),
        }
    }

    /// A file held whole, or why its bytes aren't one.
    pub fn new(bytes: Bytes) -> Result<Self, String> {
        let held = bytes.len();
        let mut elements = Self {
            bytes,
            layout: None,
            whole: 0,
            bound: Vec::new(),
        };
        elements.arrived(held)?;
        if elements.layout.is_none() {
            return Err("the elements file doesn't start as one (KWE2)".into());
        }
        Ok(elements)
    }

    /// Where the page writes the file.
    pub fn as_mut_ptr(&mut self) -> *mut u8 {
        self.bytes.as_mut_ptr()
    }

    /// The file's first `held` bytes are written. Returns the rows that
    /// are whole (their block is), or why the header isn't this file's.
    pub fn arrived(&mut self, held: usize) -> Result<usize, String> {
        if held > self.bytes.len() {
            return Err(format!(
                "{held} bytes of an elements file of {}",
                self.bytes.len()
            ));
        }
        let layout = match self.layout {
            Some(layout) => layout,
            None if held >= HEADER => *self.layout.insert(Layout::read(&self.bytes)?),
            None => return Ok(0),
        };
        for block in self.bound.len()..layout.whole_blocks(held) {
            let from = block * layout.block;
            self.whole = from + layout.block_rows(block);
            let before = self.bound.last().copied().unwrap_or(0);
            let bound = (from..self.whole).filter(|row| self.is_bound(*row)).count();
            self.bound.push(before + bound);
        }
        Ok(self.whole)
    }

    /// The rows the header says the file has; 0 until it's held.
    pub fn rows(&self) -> usize {
        self.layout.map_or(0, |layout| layout.rows)
    }

    /// The rows held so far, whole blocks of them.
    pub fn whole(&self) -> usize {
        self.whole
    }

    /// Whether every row is held.
    pub fn is_whole(&self) -> bool {
        self.layout.is_some_and(|layout| self.whole == layout.rows)
    }

    /// A row's `element`, as stored. The row's block must be whole.
    #[inline]
    pub fn get(&self, element: Element, row: usize) -> f32 {
        assert!(row < self.whole);
        let layout = self.layout.expect("a whole row has a header");
        self.bytes.f32_at(layout.at(element, row))
    }

    /// The blocks holding the rows `from..to`, each as where it is in
    /// memory and its rows: [`Element::COUNT`] runs of that many 32-bit
    /// floats, end to end, in the file's order. The scene's attributes are
    /// filled from views over them. `from` and `to` are where blocks start
    /// or end, and `to` is no further than [`Self::whole`].
    pub fn blocks(&self, from: usize, to: usize) -> Vec<(*const f32, usize)> {
        let Some(layout) = self.layout else {
            return Vec::new();
        };
        assert!(from.is_multiple_of(layout.block) && from <= to && to <= self.whole);
        assert!(to.is_multiple_of(layout.block) || to == layout.rows);
        (from / layout.block..to.div_ceil(layout.block))
            .map(|block| {
                let at = self.bytes.as_ptr().wrapping_add(layout.block_at(block));
                (at.cast(), layout.block_rows(block))
            })
            .collect()
    }

    /// The rows whose orbit is an ellipse, of those held: the ones the
    /// scene draws.
    pub fn bound(&self) -> usize {
        self.bound.last().copied().unwrap_or(0)
    }

    /// The rows with an ellipse among the first `rows`, which end where a
    /// whole block does.
    pub fn bound_before(&self, rows: usize) -> usize {
        let Some(layout) = self.layout else {
            return 0;
        };
        assert!(rows <= self.whole && (rows.is_multiple_of(layout.block) || rows == layout.rows));
        match rows.div_ceil(layout.block) {
            0 => 0,
            blocks => self.bound[blocks - 1],
        }
    }

    /// Whether a row's orbit is an ellipse. A row whose isn't (e not below
    /// 1, a below 0) keeps its a and e; its mean anomaly is a hyperbola's.
    pub fn is_bound(&self, row: usize) -> bool {
        self.get(Element::E, row) < 1.0 && self.get(Element::A, row) > 0.0
    }
}

#[cfg(test)]
mod tests {
    use super::{EPOCH_JD, Element, Elements, HEADER, ROW};
    use crate::bytes::Bytes;

    /// A file of `rows` rows in blocks of `block`: a row's cell is its
    /// row and its column in one number, and every third row has no ellipse.
    fn file(rows: usize, block: usize) -> Vec<u8> {
        let cell = |column: usize, row: usize| -> f32 {
            match column {
                0 => 2.0 + row as f32,
                1 if row % 3 == 2 => 1.5,
                1 => 0.25,
                _ => (row * 10 + column) as f32,
            }
        };
        let mut bytes = Vec::new();
        bytes.extend(b"KWE2");
        bytes.extend((rows as u32).to_le_bytes());
        bytes.extend(EPOCH_JD.to_le_bytes());
        bytes.extend((block as u32).to_le_bytes());
        for from in (0..rows).step_by(block) {
            for column in 0..Element::COUNT {
                for row in from..rows.min(from + block) {
                    bytes.extend(cell(column, row).to_le_bytes());
                }
            }
        }
        bytes
    }

    #[test]
    fn a_cell_is_read_where_its_block_keeps_it() {
        // Three blocks, the last one short.
        let elements = Elements::new(Bytes::from_bytes(&file(10, 4))).unwrap();
        assert_eq!(elements.rows(), 10);
        assert!(elements.is_whole());
        for row in 0..10 {
            assert_eq!(elements.get(Element::A, row), 2.0 + row as f32);
            assert_eq!(elements.get(Element::I, row), (row * 10 + 2) as f32);
            assert_eq!(elements.get(Element::H, row), (row * 10 + 6) as f32);
            assert_eq!(elements.is_bound(row), row % 3 != 2);
        }
        assert_eq!(elements.bound(), 7);
        assert_eq!(elements.bound_before(4), 3);
        assert_eq!(elements.bound_before(8), 6);
        assert_eq!(elements.bound_before(10), 7);
        let blocks = elements.blocks(4, 10);
        assert_eq!(
            blocks.iter().map(|block| block.1).collect::<Vec<_>>(),
            [4, 2]
        );
        // A block's own bytes: its rows of a, then of e, and on.
        let first = elements.blocks(0, 4)[0].0;
        assert_eq!(blocks[0].0 as usize - first as usize, 4 * ROW);
        assert_eq!(blocks[1].0 as usize - first as usize, 8 * ROW);
    }

    #[test]
    fn rows_are_whole_a_block_at_a_time_as_the_file_arrives() {
        let file = file(10, 4);
        let mut elements = Elements::arriving(file.len());
        // The page writes through `as_mut_ptr`; here the room is swapped
        // for one with the file's first `to` bytes in, the rest still zero.
        let write = |elements: &mut Elements, to: usize| {
            let mut so_far = vec![0; file.len()];
            so_far[..to].copy_from_slice(&file[..to]);
            elements.bytes = Bytes::from_bytes(&so_far);
            elements.arrived(to).unwrap()
        };
        // Short of the header, then short of a block by a byte.
        assert_eq!(write(&mut elements, HEADER - 1), 0);
        assert_eq!(elements.rows(), 0);
        assert_eq!(write(&mut elements, HEADER + 4 * ROW - 1), 0);
        assert_eq!(elements.rows(), 10);
        assert_eq!((elements.whole(), elements.bound()), (0, 0));
        // The first block, and a part of the second.
        assert_eq!(write(&mut elements, HEADER + 4 * ROW + 9), 4);
        assert_eq!((elements.whole(), elements.bound()), (4, 3));
        assert_eq!(elements.get(Element::MeanAnomaly, 3), 35.0);
        assert!(!elements.is_whole());
        // The second, and the short last one a byte from whole.
        assert_eq!(write(&mut elements, file.len() - 1), 8);
        assert_eq!(elements.bound_before(8), 6);
        assert_eq!(write(&mut elements, file.len()), 10);
        assert!(elements.is_whole());
        assert_eq!(elements.bound(), 7);
        assert_eq!(elements.get(Element::H, 9), 96.0);
    }

    #[test]
    fn a_file_that_isnt_one_says_why() {
        let good = file(10, 4);
        let wrong = |change: &dyn Fn(&mut Vec<u8>)| {
            let mut bytes = good.clone();
            change(&mut bytes);
            Elements::new(Bytes::from_bytes(&bytes)).err().unwrap()
        };
        // The file as it was before it was in blocks.
        assert!(wrong(&|bytes| bytes[3] = b'1').contains("KWE2"));
        assert!(
            wrong(&|bytes| bytes[8..16].copy_from_slice(&2_451_545.0f64.to_le_bytes()))
                .contains("epoch")
        );
        assert!(
            wrong(&|bytes| bytes[16..20].copy_from_slice(&0u32.to_le_bytes())).contains("no rows")
        );
        assert!(wrong(&|bytes| bytes.truncate(bytes.len() - 4)).contains("seven columns"));
        // Shorter than a header: not an empty file of no rows.
        assert!(wrong(&|bytes| bytes.truncate(8)).contains("KWE2"));
        // A block past what a 32-bit product holds is the file's one block.
        let mut huge = file(10, 10);
        huge[16..20].copy_from_slice(&(1u32 << 30).to_le_bytes());
        let one = Elements::new(Bytes::from_bytes(&huge)).unwrap();
        assert_eq!((one.whole(), one.get(Element::H, 9)), (10, 96.0));
        // A header that's wrong is found when it arrives, not at the end.
        let mut elements = Elements::arriving(good.len());
        assert!(elements.arrived(HEADER).unwrap_err().contains("KWE2"));
    }
}
