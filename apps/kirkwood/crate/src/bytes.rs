//! A file's bytes, held once, as they arrived, and read where they lie.
//!
//! Both of Kirkwood's files are little-endian, a column at a time, every
//! section on a 4-byte boundary (`docs/data.md`). So the bytes are kept as
//! 32-bit words: the allocation is aligned for a view of any column (the
//! scene's vertex attributes are views over it), and a cell is read without
//! a copy and without `unsafe`: a float is a word's bits.

/// A file's bytes as little-endian 32-bit words.
pub struct Bytes {
    words: Vec<u32>,
    /// The file's length in bytes: the last word may be padded.
    len: usize,
}

impl Bytes {
    /// Room for a file of `len` bytes, to be filled through [`Self::as_mut_ptr`].
    pub fn zeroed(len: usize) -> Self {
        Self {
            words: vec![0; len.div_ceil(4)],
            len,
        }
    }

    /// A file read whole (the tests': the page fills a [`Self::zeroed`] as
    /// the response arrives).
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let (whole, rest) = bytes.as_chunks::<4>();
        let mut words: Vec<u32> = whole.iter().map(|word| u32::from_le_bytes(*word)).collect();
        if !rest.is_empty() {
            let mut last = [0; 4];
            last[..rest.len()].copy_from_slice(rest);
            words.push(u32::from_le_bytes(last));
        }
        Self {
            words,
            len: bytes.len(),
        }
    }

    /// Where the bytes are, for the page to write the response into. Only
    /// on a little-endian machine (wasm is one) are bytes written here the
    /// words the readers expect.
    pub fn as_mut_ptr(&mut self) -> *mut u8 {
        self.words.as_mut_ptr().cast()
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// The u32 at byte `at`, a multiple of 4.
    #[inline]
    pub fn u32_at(&self, at: usize) -> u32 {
        debug_assert!(at.is_multiple_of(4));
        self.words[at / 4]
    }

    #[inline]
    pub fn i32_at(&self, at: usize) -> i32 {
        self.u32_at(at).cast_signed()
    }

    #[inline]
    pub fn f32_at(&self, at: usize) -> f32 {
        f32::from_bits(self.u32_at(at))
    }

    /// The f64 at byte `at`, a multiple of 4.
    pub fn f64_at(&self, at: usize) -> f64 {
        f64::from_bits(u64::from(self.u32_at(at)) | u64::from(self.u32_at(at + 4)) << 32)
    }

    /// The u16 at byte `at`, a multiple of 2.
    #[inline]
    pub fn u16_at(&self, at: usize) -> u16 {
        debug_assert!(at.is_multiple_of(2));
        (self.words[at / 4] >> (8 * (at % 4))) as u16
    }

    #[inline]
    pub fn u8_at(&self, at: usize) -> u8 {
        (self.words[at / 4] >> (8 * (at % 4))) as u8
    }

    /// The bytes `from..to` as text (UTF-8; anything else shows as U+FFFD).
    pub fn text(&self, from: usize, to: usize) -> String {
        let bytes: Vec<u8> = (from..to).map(|at| self.u8_at(at)).collect();
        String::from_utf8(bytes)
            .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::Bytes;

    #[test]
    fn cells_are_read_where_they_lie() {
        let mut file = Vec::new();
        file.extend(b"KWE1");
        file.extend(7u32.to_le_bytes());
        file.extend(2_461_200.5f64.to_le_bytes());
        file.extend((-1.5f32).to_le_bytes());
        file.extend(i32::MIN.to_le_bytes());
        file.extend(513u16.to_le_bytes());
        file.extend(b"Ce");
        file.extend(b"res");
        let bytes = Bytes::from_bytes(&file);
        assert_eq!(bytes.len(), 31);
        assert_eq!(bytes.u32_at(0), u32::from_le_bytes(*b"KWE1"));
        assert_eq!(bytes.u32_at(4), 7);
        assert_eq!(bytes.f64_at(8), 2_461_200.5);
        assert_eq!(bytes.f32_at(16), -1.5);
        assert_eq!(bytes.i32_at(20), i32::MIN);
        assert_eq!(bytes.u16_at(24), 513);
        assert_eq!(bytes.u8_at(24), 1);
        assert_eq!(bytes.u8_at(25), 2);
        assert_eq!(bytes.text(26, 31), "Ceres");
    }
}
