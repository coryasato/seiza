//! A small Arrow IPC stream reader for the column types the table shows.
//!
//! DuckDB's query results cross the bridge as Arrow IPC stream bytes. This
//! reads them without the arrow-rs crates, which cost more wasm than the app
//! can afford before first paint (see `PLAN.md`, M2 decisions). It reads the
//! flatbuffer metadata by hand and keeps the body where it is: a column is a
//! set of byte ranges into the one shared buffer, and cells are decoded on
//! access.
//!
//! Supported: null, bool, signed and unsigned ints, float32/64, decimal128,
//! utf8 and binary (regular and large), date32/64, time32/64, and timestamps
//! in every unit. Any other type (lists, structs, dictionaries, views, …)
//! still decodes, as an unsupported column that shows its type name, so one
//! odd column never hides the rest.
//!
//! Format references: `format/Message.fbs` and `format/Schema.fbs` in
//! apache/arrow, and the columnar format spec's IPC section.

use std::fmt;
use std::ops::Range;
use std::rc::Rc;

/// Why a buffer couldn't be read as an Arrow IPC stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeError(String);

impl DecodeError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Arrow IPC: {}", self.0)
    }
}

impl std::error::Error for DecodeError {}

type Result<T> = std::result::Result<T, DecodeError>;

fn truncated() -> DecodeError {
    DecodeError::new("truncated buffer")
}

// --- Little-endian reads, bounds-checked ---

fn bytes<const N: usize>(buf: &[u8], at: usize) -> Result<[u8; N]> {
    buf.get(at..at.checked_add(N).ok_or_else(truncated)?)
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(truncated)
}
fn read_u16(buf: &[u8], at: usize) -> Result<u16> {
    bytes(buf, at).map(u16::from_le_bytes)
}
fn read_u32(buf: &[u8], at: usize) -> Result<u32> {
    bytes(buf, at).map(u32::from_le_bytes)
}
fn read_i32(buf: &[u8], at: usize) -> Result<i32> {
    bytes(buf, at).map(i32::from_le_bytes)
}
fn read_i64(buf: &[u8], at: usize) -> Result<i64> {
    bytes(buf, at).map(i64::from_le_bytes)
}

/// Offsets and lengths come from the stream, and `usize` is 32 bits on wasm32,
/// so every sum or product that involves one is checked: a wrap would read
/// the wrong bytes in release, or panic (and abort the app) in debug.
fn add(a: usize, b: usize) -> Result<usize> {
    a.checked_add(b).ok_or_else(truncated)
}
fn mul(a: usize, b: usize) -> Result<usize> {
    a.checked_mul(b).ok_or_else(truncated)
}

fn to_usize(value: i64) -> Result<usize> {
    usize::try_from(value)
        .map_err(|_| DecodeError::new(format!("negative or oversized length {value}")))
}

// --- Flatbuffers, just enough to walk Message.fbs and Schema.fbs ---

/// A flatbuffer table: `pos` is where the table starts in `buf`.
#[derive(Clone, Copy)]
struct Table<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Table<'a> {
    fn root(buf: &'a [u8]) -> Result<Self> {
        Ok(Self {
            buf,
            pos: read_u32(buf, 0)? as usize,
        })
    }

    /// Where field `id` is stored, or `None` when it's absent (default).
    fn field(&self, id: usize) -> Result<Option<usize>> {
        let vtable = (self.pos as i64)
            .checked_sub(read_i32(self.buf, self.pos)? as i64)
            .and_then(|at| usize::try_from(at).ok())
            .ok_or_else(truncated)?;
        let vtable_len = read_u16(self.buf, vtable)? as usize;
        let slot = 4 + 2 * id;
        if slot + 2 > vtable_len {
            return Ok(None);
        }
        let offset = read_u16(self.buf, vtable + slot)? as usize;
        Ok(if offset == 0 {
            None
        } else {
            Some(add(self.pos, offset)?)
        })
    }

    fn u8(&self, id: usize, default: u8) -> Result<u8> {
        match self.field(id)? {
            Some(at) => self.buf.get(at).copied().ok_or_else(truncated),
            None => Ok(default),
        }
    }
    fn bool(&self, id: usize) -> Result<bool> {
        Ok(self.u8(id, 0)? != 0)
    }
    fn i16(&self, id: usize, default: i16) -> Result<i16> {
        match self.field(id)? {
            Some(at) => bytes(self.buf, at).map(i16::from_le_bytes),
            None => Ok(default),
        }
    }
    fn i32(&self, id: usize, default: i32) -> Result<i32> {
        match self.field(id)? {
            Some(at) => read_i32(self.buf, at),
            None => Ok(default),
        }
    }
    fn i64(&self, id: usize, default: i64) -> Result<i64> {
        match self.field(id)? {
            Some(at) => read_i64(self.buf, at),
            None => Ok(default),
        }
    }

    /// Follows the offset stored at `at` to what it points to.
    fn indirect(&self, at: usize) -> Result<usize> {
        at.checked_add(read_u32(self.buf, at)? as usize)
            .ok_or_else(truncated)
    }

    fn table(&self, id: usize) -> Result<Option<Table<'a>>> {
        let Some(at) = self.field(id)? else {
            return Ok(None);
        };
        Ok(Some(Table {
            buf: self.buf,
            pos: self.indirect(at)?,
        }))
    }

    fn string(&self, id: usize) -> Result<Option<&'a str>> {
        let Some((start, len)) = self.vector(id)? else {
            return Ok(None);
        };
        let slice = self
            .buf
            .get(start..add(start, len)?)
            .ok_or_else(truncated)?;
        std::str::from_utf8(slice)
            .map(Some)
            .map_err(|_| DecodeError::new("metadata string isn't UTF-8"))
    }

    /// A vector field: where its first element starts, and its length.
    fn vector(&self, id: usize) -> Result<Option<(usize, usize)>> {
        let Some(at) = self.field(id)? else {
            return Ok(None);
        };
        let at = self.indirect(at)?;
        Ok(Some((add(at, 4)?, read_u32(self.buf, at)? as usize)))
    }

    /// The tables in a vector-of-tables field.
    fn tables(&self, id: usize) -> Result<Vec<Table<'a>>> {
        let Some((start, len)) = self.vector(id)? else {
            return Ok(Vec::new());
        };
        (0..len)
            .map(|i| {
                let at = add(start, mul(4, i)?)?;
                Ok(Table {
                    buf: self.buf,
                    pos: self.indirect(at)?,
                })
            })
            .collect()
    }
}

// --- Schema ---

/// How the time values in a column are counted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeUnit {
    Second,
    Millisecond,
    Microsecond,
    Nanosecond,
}

impl TimeUnit {
    fn from_fb(value: i16) -> Result<Self> {
        Ok(match value {
            0 => Self::Second,
            1 => Self::Millisecond,
            2 => Self::Microsecond,
            3 => Self::Nanosecond,
            other => return Err(DecodeError::new(format!("unknown time unit {other}"))),
        })
    }

    fn per_second(self) -> i64 {
        match self {
            Self::Second => 1,
            Self::Millisecond => 1_000,
            Self::Microsecond => 1_000_000,
            Self::Nanosecond => 1_000_000_000,
        }
    }

    /// Fraction digits shown for this unit.
    fn digits(self) -> usize {
        match self {
            Self::Second => 0,
            Self::Millisecond => 3,
            Self::Microsecond => 6,
            Self::Nanosecond => 9,
        }
    }

    fn suffix(self) -> &'static str {
        match self {
            Self::Second => "s",
            Self::Millisecond => "ms",
            Self::Microsecond => "us",
            Self::Nanosecond => "ns",
        }
    }
}

/// A column's type, as far as the table needs to know it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DataType {
    Null,
    Bool,
    Int {
        bits: u8,
        signed: bool,
    },
    Float {
        bits: u8,
    },
    Decimal {
        precision: u8,
        scale: i8,
    },
    Utf8 {
        large: bool,
    },
    Binary {
        large: bool,
    },
    /// `millis`: date64 (milliseconds) rather than date32 (days).
    Date {
        millis: bool,
    },
    Time {
        unit: TimeUnit,
    },
    Timestamp {
        unit: TimeUnit,
        timezone: Option<String>,
    },
    /// Decoded as an unsupported column. The name is Arrow's type name.
    Other(&'static str),
}

impl fmt::Display for DataType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Null => f.write_str("null"),
            Self::Bool => f.write_str("bool"),
            Self::Int { bits, signed } => write!(f, "{}int{bits}", if *signed { "" } else { "u" }),
            Self::Float { bits } => write!(f, "float{bits}"),
            Self::Decimal { precision, scale } => write!(f, "decimal({precision}, {scale})"),
            Self::Utf8 { large } => f.write_str(if *large { "large_utf8" } else { "utf8" }),
            Self::Binary { large } => f.write_str(if *large { "large_binary" } else { "binary" }),
            Self::Date { millis } => f.write_str(if *millis { "date64" } else { "date32" }),
            Self::Time { unit } => write!(f, "time[{}]", unit.suffix()),
            Self::Timestamp { unit, timezone } => match timezone {
                Some(tz) => write!(f, "timestamp[{}, {tz}]", unit.suffix()),
                None => write!(f, "timestamp[{}]", unit.suffix()),
            },
            Self::Other(name) => f.write_str(name),
        }
    }
}

/// Which buffers and child nodes a field takes up in a record batch, so an
/// unsupported column can be skipped exactly.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Layout {
    buffers: usize,
    /// Utf8View/BinaryView: also takes the next `variadicBufferCounts` entry.
    variadic: bool,
    children: Vec<Layout>,
}

/// One column of the result schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Field {
    pub name: String,
    pub data_type: DataType,
    pub nullable: bool,
    layout: Layout,
}

fn parse_field(field: Table<'_>) -> Result<Field> {
    let name = field.string(0)?.unwrap_or_default().to_owned();
    let nullable = field.bool(1)?;
    let type_id = field.u8(2, 0)?;
    let ty = field.table(3)?;
    let children = field
        .tables(5)?
        .into_iter()
        .map(parse_field)
        .collect::<Result<Vec<_>>>()?;
    let child_layouts = || children.iter().map(|child| child.layout.clone()).collect();

    // A dictionary-encoded column holds indices; its values come in
    // dictionary batches, which this reader doesn't keep.
    if field.table(4)?.is_some() {
        return Ok(Field {
            name,
            data_type: DataType::Other("dictionary"),
            nullable,
            layout: leaf(2),
        });
    }

    let int = |what: &str| -> Result<Table<'_>> {
        ty.ok_or_else(|| DecodeError::new(format!("{what} type without parameters")))
    };
    let (data_type, layout) = match type_id {
        1 => (DataType::Null, leaf(0)),
        2 => {
            let ty = int("int")?;
            let bits = ty.i32(0, 0)?;
            if !matches!(bits, 8 | 16 | 32 | 64) {
                return Err(DecodeError::new(format!("int bit width {bits}")));
            }
            let data_type = DataType::Int {
                bits: bits as u8,
                signed: ty.bool(1)?,
            };
            (data_type, leaf(2))
        }
        3 => match int("float")?.i16(0, 0)? {
            1 => (DataType::Float { bits: 32 }, leaf(2)),
            2 => (DataType::Float { bits: 64 }, leaf(2)),
            _ => (DataType::Other("float16"), leaf(2)),
        },
        4 => (DataType::Binary { large: false }, leaf(3)),
        5 => (DataType::Utf8 { large: false }, leaf(3)),
        6 => (DataType::Bool, leaf(2)),
        7 => {
            let ty = int("decimal")?;
            match ty.i32(2, 128)? {
                128 => {
                    let precision = ty.i32(0, 0)?;
                    let scale = ty.i32(1, 0)?;
                    let data_type = DataType::Decimal {
                        precision: u8::try_from(precision)
                            .map_err(|_| DecodeError::new("decimal precision"))?,
                        scale: i8::try_from(scale)
                            .map_err(|_| DecodeError::new("decimal scale"))?,
                    };
                    (data_type, leaf(2))
                }
                _ => (DataType::Other("decimal"), leaf(2)),
            }
        }
        // DateUnit defaults to MILLISECOND in Schema.fbs.
        8 => (
            DataType::Date {
                millis: ty.map_or(Ok(1), |ty| ty.i16(0, 1))? == 1,
            },
            leaf(2),
        ),
        9 => {
            let unit = TimeUnit::from_fb(ty.map_or(Ok(1), |ty| ty.i16(0, 1))?)?;
            (DataType::Time { unit }, leaf(2))
        }
        10 => {
            let ty = int("timestamp")?;
            let data_type = DataType::Timestamp {
                unit: TimeUnit::from_fb(ty.i16(0, 0)?)?,
                timezone: ty.string(1)?.map(str::to_owned),
            };
            (data_type, leaf(2))
        }
        11 => (DataType::Other("interval"), leaf(2)),
        12 => (DataType::Other("list"), nested(2, child_layouts())),
        13 => (DataType::Other("struct"), nested(1, child_layouts())),
        14 => {
            // UnionMode: Sparse = 0 (type ids), Dense = 1 (type ids + offsets).
            let dense = ty.map_or(Ok(0), |ty| ty.i16(0, 0))? == 1;
            let buffers = if dense { 2 } else { 1 };
            (DataType::Other("union"), nested(buffers, child_layouts()))
        }
        15 => (DataType::Other("fixed_size_binary"), leaf(2)),
        16 => (
            DataType::Other("fixed_size_list"),
            nested(1, child_layouts()),
        ),
        17 => (DataType::Other("map"), nested(2, child_layouts())),
        18 => (DataType::Other("duration"), leaf(2)),
        19 => (DataType::Binary { large: true }, leaf(3)),
        20 => (DataType::Utf8 { large: true }, leaf(3)),
        21 => (DataType::Other("large_list"), nested(2, child_layouts())),
        22 => (
            DataType::Other("run_end_encoded"),
            nested(0, child_layouts()),
        ),
        23 | 24 => {
            let name = if type_id == 23 {
                "binary_view"
            } else {
                "utf8_view"
            };
            let layout = Layout {
                buffers: 2,
                variadic: true,
                children: Vec::new(),
            };
            (DataType::Other(name), layout)
        }
        25 => (DataType::Other("list_view"), nested(3, child_layouts())),
        26 => (
            DataType::Other("large_list_view"),
            nested(3, child_layouts()),
        ),
        other => return Err(DecodeError::new(format!("unknown type id {other}"))),
    };
    Ok(Field {
        name,
        data_type,
        nullable,
        layout,
    })
}

fn leaf(buffers: usize) -> Layout {
    nested(buffers, Vec::new())
}

fn nested(buffers: usize, children: Vec<Layout>) -> Layout {
    Layout {
        buffers,
        variadic: false,
        children,
    }
}

// --- Record batches ---

/// How a column's cells are stored. Ranges point into the shared buffer.
#[derive(Debug, Clone)]
enum Values {
    Null,
    Bool(Range<usize>),
    Int {
        bits: u8,
        signed: bool,
        values: Range<usize>,
    },
    Float {
        bits: u8,
        values: Range<usize>,
    },
    Decimal {
        scale: i8,
        values: Range<usize>,
    },
    /// Strings and binary: offsets (i32, or i64 when `large`) into `data`.
    Bytes {
        utf8: bool,
        large: bool,
        offsets: Range<usize>,
        data: Range<usize>,
    },
    Date {
        millis: bool,
        values: Range<usize>,
    },
    /// Time of day: time32 (s, ms) or time64 (us, ns).
    Time {
        unit: TimeUnit,
        values: Range<usize>,
    },
    Timestamp {
        unit: TimeUnit,
        utc: bool,
        values: Range<usize>,
    },
    Unsupported(&'static str),
}

/// One column of a record batch.
#[derive(Clone)]
pub struct Column {
    buf: Rc<Vec<u8>>,
    len: usize,
    /// Validity bitmap (1 = valid), or `None` when every cell is valid.
    validity: Option<Range<usize>>,
    values: Values,
}

impl fmt::Debug for Column {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Column")
            .field("len", &self.len)
            .field("values", &self.values)
            .finish()
    }
}

/// One cell, borrowed from its column.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Value<'a> {
    Null,
    Bool(bool),
    Int(i64),
    UInt(u64),
    Float32(f32),
    Float(f64),
    /// An unscaled decimal: `value × 10^-scale`.
    Decimal {
        value: i128,
        scale: i8,
    },
    Str(&'a str),
    Bytes(&'a [u8]),
    /// Days since 1970-01-01.
    Date(i64),
    /// Time of day, in `unit`s since midnight.
    Time {
        value: i64,
        unit: TimeUnit,
    },
    /// `unit`s since the Unix epoch. `utc` means the column has a time zone:
    /// the value is UTC, and it's shown in UTC.
    Timestamp {
        value: i64,
        unit: TimeUnit,
        utc: bool,
    },
    /// A type this reader doesn't show; the name is Arrow's type name.
    Unsupported(&'static str),
}

impl Column {
    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    fn bit(&self, range: &Range<usize>, index: usize) -> bool {
        self.buf
            .get(range.start + index / 8)
            .is_some_and(|byte| byte & (1 << (index % 8)) != 0)
    }

    fn fixed<const N: usize>(&self, range: &Range<usize>, index: usize) -> Option<[u8; N]> {
        bytes(&self.buf, range.start.checked_add(index.checked_mul(N)?)?).ok()
    }

    fn offset(&self, range: &Range<usize>, large: bool, index: usize) -> Option<usize> {
        if large {
            usize::try_from(i64::from_le_bytes(self.fixed(range, index)?)).ok()
        } else {
            usize::try_from(i32::from_le_bytes(self.fixed(range, index)?)).ok()
        }
    }

    /// The cell at `row`. Out-of-range rows and malformed cells read as null,
    /// so drawing a cell can never panic.
    pub fn value(&self, row: usize) -> Value<'_> {
        if row >= self.len || self.validity.as_ref().is_some_and(|v| !self.bit(v, row)) {
            return Value::Null;
        }
        self.read(row).unwrap_or(Value::Null)
    }

    fn read(&self, row: usize) -> Option<Value<'_>> {
        Some(match &self.values {
            Values::Null => Value::Null,
            Values::Bool(values) => Value::Bool(self.bit(values, row)),
            Values::Int {
                bits,
                signed,
                values,
            } => match (bits, signed) {
                (8, true) => Value::Int(i8::from_le_bytes(self.fixed(values, row)?).into()),
                (16, true) => Value::Int(i16::from_le_bytes(self.fixed(values, row)?).into()),
                (32, true) => Value::Int(i32::from_le_bytes(self.fixed(values, row)?).into()),
                (64, true) => Value::Int(i64::from_le_bytes(self.fixed(values, row)?)),
                (8, false) => Value::UInt(u8::from_le_bytes(self.fixed(values, row)?).into()),
                (16, false) => Value::UInt(u16::from_le_bytes(self.fixed(values, row)?).into()),
                (32, false) => Value::UInt(u32::from_le_bytes(self.fixed(values, row)?).into()),
                (_, false) => Value::UInt(u64::from_le_bytes(self.fixed(values, row)?)),
                (_, true) => return None,
            },
            Values::Float { bits: 32, values } => {
                Value::Float32(f32::from_le_bytes(self.fixed(values, row)?))
            }
            Values::Float { values, .. } => {
                Value::Float(f64::from_le_bytes(self.fixed(values, row)?))
            }
            Values::Decimal { scale, values } => Value::Decimal {
                value: i128::from_le_bytes(self.fixed(values, row)?),
                scale: *scale,
            },
            Values::Bytes {
                utf8,
                large,
                offsets,
                data,
            } => {
                let start = self.offset(offsets, *large, row)?;
                let end = self.offset(offsets, *large, row + 1)?;
                let end = data.start.checked_add(end)?;
                if end > data.end {
                    return None;
                }
                let slice = self.buf.get(data.start.checked_add(start)?..end)?;
                if *utf8 {
                    Value::Str(std::str::from_utf8(slice).ok()?)
                } else {
                    Value::Bytes(slice)
                }
            }
            Values::Date {
                millis: false,
                values,
            } => Value::Date(i32::from_le_bytes(self.fixed(values, row)?).into()),
            Values::Date { values, .. } => {
                Value::Date(i64::from_le_bytes(self.fixed(values, row)?).div_euclid(86_400_000))
            }
            Values::Time { unit, values } => Value::Time {
                value: match unit {
                    TimeUnit::Second | TimeUnit::Millisecond => {
                        i32::from_le_bytes(self.fixed(values, row)?).into()
                    }
                    _ => i64::from_le_bytes(self.fixed(values, row)?),
                },
                unit: *unit,
            },
            Values::Timestamp { unit, utc, values } => Value::Timestamp {
                value: i64::from_le_bytes(self.fixed(values, row)?),
                unit: *unit,
                utc: *utc,
            },
            Values::Unsupported(name) => Value::Unsupported(name),
        })
    }
}

/// One record batch: equal-length columns, in schema order.
#[derive(Debug, Clone)]
pub struct Batch {
    pub num_rows: usize,
    pub columns: Vec<Column>,
}

/// A whole query result: the schema and every batch in the stream.
#[derive(Debug, Clone)]
pub struct QueryResult {
    pub fields: Vec<Field>,
    pub batches: Vec<Batch>,
}

impl QueryResult {
    pub fn num_rows(&self) -> usize {
        self.batches.iter().map(|batch| batch.num_rows).sum()
    }

    /// Bytes this result keeps alive: every column points into the one IPC
    /// buffer it was decoded from.
    pub fn heap_bytes(&self) -> usize {
        self.batches
            .iter()
            .flat_map(|batch| batch.columns.first())
            .map(|column| column.buf.len())
            .next()
            .unwrap_or(0)
    }

    /// The cell at (`row`, `column`) across all batches, or `None` when
    /// either is out of range.
    pub fn value(&self, mut row: usize, column: usize) -> Option<Value<'_>> {
        for batch in &self.batches {
            if row < batch.num_rows {
                return batch.columns.get(column).map(|c| c.value(row));
            }
            row -= batch.num_rows;
        }
        None
    }
}

/// Reads record batches' field nodes and buffers in order.
struct BatchReader<'a> {
    nodes: (usize, usize),
    buffers: (usize, usize),
    variadic: (usize, usize),
    next_node: usize,
    next_buffer: usize,
    next_variadic: usize,
    meta: &'a [u8],
    body: Range<usize>,
}

impl BatchReader<'_> {
    /// The next field node: (length, null count).
    fn node(&mut self) -> Result<(usize, usize)> {
        if self.next_node >= self.nodes.1 {
            return Err(DecodeError::new("fewer field nodes than columns"));
        }
        let at = add(self.nodes.0, mul(16, self.next_node)?)?;
        self.next_node += 1;
        Ok((
            to_usize(read_i64(self.meta, at)?)?,
            to_usize(read_i64(self.meta, add(at, 8)?)?)?,
        ))
    }

    /// The next buffer, as a range in the whole IPC buffer.
    fn buffer(&mut self) -> Result<Range<usize>> {
        if self.next_buffer >= self.buffers.1 {
            return Err(DecodeError::new("fewer buffers than columns need"));
        }
        let at = add(self.buffers.0, mul(16, self.next_buffer)?)?;
        self.next_buffer += 1;
        let offset = to_usize(read_i64(self.meta, at)?)?;
        let len = to_usize(read_i64(self.meta, add(at, 8)?)?)?;
        let start = self.body.start.checked_add(offset).ok_or_else(truncated)?;
        let end = start.checked_add(len).ok_or_else(truncated)?;
        if end > self.body.end {
            return Err(DecodeError::new("buffer runs past the message body"));
        }
        Ok(start..end)
    }

    /// Consumes the nodes and buffers of a field this reader doesn't show.
    fn skip(&mut self, layout: &Layout) -> Result<()> {
        self.node()?;
        for _ in 0..layout.buffers {
            self.buffer()?;
        }
        if layout.variadic {
            let count = if self.next_variadic < self.variadic.1 {
                let at = add(self.variadic.0, mul(8, self.next_variadic)?)?;
                self.next_variadic += 1;
                to_usize(read_i64(self.meta, at)?)?
            } else {
                0
            };
            for _ in 0..count {
                self.buffer()?;
            }
        }
        layout
            .children
            .iter()
            .try_for_each(|child| self.skip(child))
    }

    fn column(&mut self, field: &Field, buf: &Rc<Vec<u8>>) -> Result<Column> {
        if let DataType::Other(name) = &field.data_type {
            let (len, _) = self.peek_node()?;
            self.skip(&field.layout)?;
            return Ok(Column {
                buf: buf.clone(),
                len,
                validity: None,
                values: Values::Unsupported(name),
            });
        }

        let (len, null_count) = self.node()?;
        if field.data_type == DataType::Null {
            return Ok(Column {
                buf: buf.clone(),
                len,
                validity: None,
                values: Values::Null,
            });
        }
        let validity = self.buffer()?;
        let validity = (null_count > 0 && !validity.is_empty()).then_some(validity);
        if let Some(validity) = &validity
            && validity.len() < len.div_ceil(8)
        {
            return Err(DecodeError::new(format!(
                "validity bitmap too short for {}",
                field.name
            )));
        }

        let mut fixed = |width_bits: usize| -> Result<Range<usize>> {
            let values = self.buffer()?;
            if len
                .checked_mul(width_bits)
                .is_none_or(|bits| values.len() < bits.div_ceil(8))
            {
                return Err(DecodeError::new(format!(
                    "values buffer too short for {}",
                    field.name
                )));
            }
            Ok(values)
        };
        let values = match &field.data_type {
            DataType::Bool => Values::Bool(fixed(1)?),
            DataType::Int { bits, signed } => Values::Int {
                bits: *bits,
                signed: *signed,
                values: fixed(*bits as usize)?,
            },
            DataType::Float { bits } => Values::Float {
                bits: *bits,
                values: fixed(*bits as usize)?,
            },
            DataType::Decimal { scale, .. } => Values::Decimal {
                scale: *scale,
                values: fixed(128)?,
            },
            DataType::Date { millis } => Values::Date {
                millis: *millis,
                values: fixed(if *millis { 64 } else { 32 })?,
            },
            DataType::Time { unit } => {
                let bits = match unit {
                    TimeUnit::Second | TimeUnit::Millisecond => 32,
                    _ => 64,
                };
                Values::Time {
                    unit: *unit,
                    values: fixed(bits)?,
                }
            }
            DataType::Timestamp { unit, timezone } => Values::Timestamp {
                unit: *unit,
                utc: timezone.is_some(),
                values: fixed(64)?,
            },
            DataType::Utf8 { large } | DataType::Binary { large } => {
                let offsets = fixed(if *large { 64 } else { 32 })?;
                let width = if *large { 8 } else { 4 };
                if len > 0
                    && len
                        .checked_add(1)
                        .and_then(|count| count.checked_mul(width))
                        .is_none_or(|need| offsets.len() < need)
                {
                    return Err(DecodeError::new(format!(
                        "offsets too short for {}",
                        field.name
                    )));
                }
                Values::Bytes {
                    utf8: matches!(field.data_type, DataType::Utf8 { .. }),
                    large: *large,
                    offsets,
                    data: self.buffer()?,
                }
            }
            DataType::Null | DataType::Other(_) => unreachable!("handled above"),
        };
        Ok(Column {
            buf: buf.clone(),
            len,
            validity,
            values,
        })
    }

    fn peek_node(&self) -> Result<(usize, usize)> {
        if self.next_node >= self.nodes.1 {
            return Err(DecodeError::new("fewer field nodes than columns"));
        }
        let at = add(self.nodes.0, mul(16, self.next_node)?)?;
        Ok((
            to_usize(read_i64(self.meta, at)?)?,
            to_usize(read_i64(self.meta, add(at, 8)?)?)?,
        ))
    }
}

// Message header types (MessageHeader union in Message.fbs).
const SCHEMA: u8 = 1;
const DICTIONARY_BATCH: u8 = 2;
const RECORD_BATCH: u8 = 3;

/// Decodes an Arrow IPC stream: one schema message, then record batches.
/// Streams that were concatenated with end-of-stream markers between them
/// are read through. Dictionary batches are skipped (their columns decode as
/// unsupported). Compressed bodies and the IPC file format aren't supported.
pub fn decode(bytes: Vec<u8>) -> Result<QueryResult> {
    let buf = Rc::new(bytes);
    if buf.starts_with(b"ARROW1") {
        return Err(DecodeError::new("IPC file format; expected a stream"));
    }
    let mut fields: Option<Vec<Field>> = None;
    let mut batches = Vec::new();
    let mut pos = 0;
    while pos + 4 <= buf.len() {
        // Each message: [0xFFFFFFFF] i32 metadata length, metadata (padded),
        // then the body. Streams older than Arrow 0.15 omit the marker.
        let mut meta_len = read_u32(&buf, pos)?;
        pos += 4;
        if meta_len == u32::MAX {
            meta_len = read_u32(&buf, pos)?;
            pos += 4;
        }
        if meta_len == 0 {
            continue; // end-of-stream marker
        }
        let meta_range = pos..pos.checked_add(meta_len as usize).ok_or_else(truncated)?;
        let meta = buf.get(meta_range.clone()).ok_or_else(truncated)?;
        pos = meta_range.end;

        let message = Table::root(meta)?;
        let header_type = message.u8(1, 0)?;
        let body_len = to_usize(message.i64(3, 0)?)?;
        let body = pos..pos.checked_add(body_len).ok_or_else(truncated)?;
        if body.end > buf.len() {
            return Err(truncated());
        }
        pos = body.end;
        let header = message
            .table(2)?
            .ok_or_else(|| DecodeError::new("message without a header"))?;

        match header_type {
            SCHEMA => {
                let parsed = header
                    .tables(1)?
                    .into_iter()
                    .map(parse_field)
                    .collect::<Result<Vec<_>>>()?;
                fields = Some(parsed);
            }
            RECORD_BATCH => {
                let fields = fields
                    .as_ref()
                    .ok_or_else(|| DecodeError::new("record batch before the schema"))?;
                batches.push(read_batch(header, meta, body, fields, &buf)?);
            }
            DICTIONARY_BATCH => {}
            other => return Err(DecodeError::new(format!("unexpected message type {other}"))),
        }
    }
    Ok(QueryResult {
        fields: fields.ok_or_else(|| DecodeError::new("no schema message"))?,
        batches,
    })
}

fn read_batch(
    header: Table<'_>,
    meta: &[u8],
    body: Range<usize>,
    fields: &[Field],
    buf: &Rc<Vec<u8>>,
) -> Result<Batch> {
    if header.table(3)?.is_some() {
        return Err(DecodeError::new(
            "compressed record batches aren't supported",
        ));
    }
    let num_rows = to_usize(header.i64(0, 0)?)?;
    let mut reader = BatchReader {
        nodes: header.vector(1)?.unwrap_or((0, 0)),
        buffers: header.vector(2)?.unwrap_or((0, 0)),
        variadic: header.vector(4)?.unwrap_or((0, 0)),
        next_node: 0,
        next_buffer: 0,
        next_variadic: 0,
        meta,
        body,
    };
    let columns = fields
        .iter()
        .map(|field| reader.column(field, buf))
        .collect::<Result<Vec<_>>>()?;
    if let Some(short) = columns.iter().find(|column| column.len < num_rows) {
        return Err(DecodeError::new(format!(
            "column has {} rows, batch has {num_rows}",
            short.len
        )));
    }
    Ok(Batch { num_rows, columns })
}

// --- Display ---

/// (year, month, day) for a count of days since 1970-01-01, proleptic
/// Gregorian. Howard Hinnant's `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn write_date(f: &mut fmt::Formatter<'_>, days: i64) -> fmt::Result {
    let (year, month, day) = civil_from_days(days);
    write!(f, "{year:04}-{month:02}-{day:02}")
}

/// `HH:MM:SS`, plus a fraction in `unit`'s digits when it isn't zero.
fn write_time_of_day(f: &mut fmt::Formatter<'_>, value: i64, unit: TimeUnit) -> fmt::Result {
    let per_second = unit.per_second();
    let seconds = value.div_euclid(per_second);
    let fraction = value.rem_euclid(per_second);
    write!(
        f,
        "{:02}:{:02}:{:02}",
        seconds / 3600,
        seconds / 60 % 60,
        seconds % 60
    )?;
    if fraction != 0 {
        write!(f, ".{fraction:0width$}", width = unit.digits())?;
    }
    Ok(())
}

fn write_decimal(f: &mut fmt::Formatter<'_>, value: i128, scale: i8) -> fmt::Result {
    if scale <= 0 {
        if value == 0 {
            return f.write_str("0");
        }
        return write!(f, "{value}{}", "0".repeat(scale.unsigned_abs() as usize));
    }
    let scale = scale as usize;
    let digits = value.unsigned_abs().to_string();
    let digits = format!("{digits:0>width$}", width = scale + 1);
    let (int, frac) = digits.split_at(digits.len() - scale);
    write!(f, "{}{int}.{frac}", if value < 0 { "-" } else { "" })
}

impl fmt::Display for Value<'_> {
    /// How a cell reads in the table. Null is `NULL`, like DuckDB's shell.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {
            Self::Null => f.write_str("NULL"),
            Self::Bool(value) => write!(f, "{value}"),
            Self::Int(value) => write!(f, "{value}"),
            Self::UInt(value) => write!(f, "{value}"),
            // Debug is the shortest text that reads back as the same float,
            // with an exponent for very large or small values (Display
            // writes 1e300 as 301 digits).
            Self::Float32(value) => write!(f, "{value:?}"),
            Self::Float(value) => write!(f, "{value:?}"),
            Self::Decimal { value, scale } => write_decimal(f, value, scale),
            Self::Str(value) => f.write_str(value),
            Self::Bytes(value) => value.iter().try_for_each(|byte| write!(f, "\\x{byte:02X}")),
            Self::Date(days) => write_date(f, days),
            Self::Time { value, unit } => write_time_of_day(f, value, unit),
            Self::Timestamp { value, unit, utc } => {
                let per_day = 86_400 * unit.per_second();
                write_date(f, value.div_euclid(per_day))?;
                f.write_str(" ")?;
                write_time_of_day(f, value.rem_euclid(per_day), unit)?;
                if utc {
                    f.write_str(" UTC")?;
                }
                Ok(())
            }
            Self::Unsupported(name) => write!(f, "<{name}>"),
        }
    }
}

#[cfg(test)]
mod tests {
    //! Streams written by arrow-rs (a dev-dependency only), read back here.
    use std::sync::Arc;

    use arrow::array::*;
    use arrow::datatypes::{DataType as A, Field as AField, Int32Type, Schema};
    use arrow::ipc::writer::StreamWriter;
    use arrow::record_batch::RecordBatch;

    use super::*;

    fn stream(batches: &[RecordBatch]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut writer = StreamWriter::try_new(&mut out, &batches[0].schema()).unwrap();
        for batch in batches {
            writer.write(batch).unwrap();
        }
        writer.finish().unwrap();
        drop(writer);
        out
    }

    fn batch(columns: Vec<(&str, ArrayRef)>) -> RecordBatch {
        RecordBatch::try_from_iter(columns).unwrap()
    }

    fn cells(result: &QueryResult, column: usize) -> Vec<String> {
        (0..result.num_rows())
            .map(|row| result.value(row, column).unwrap().to_string())
            .collect()
    }

    #[test]
    fn select_42() {
        let result = decode(stream(&[batch(vec![(
            "x",
            Arc::new(Int32Array::from(vec![42])) as ArrayRef,
        )])]))
        .unwrap();
        assert_eq!(result.fields[0].name, "x");
        assert_eq!(
            result.fields[0].data_type,
            DataType::Int {
                bits: 32,
                signed: true
            }
        );
        assert_eq!(result.num_rows(), 1);
        assert_eq!(result.value(0, 0), Some(Value::Int(42)));
    }

    #[test]
    fn primitives_and_nulls() {
        let result = decode(stream(&[batch(vec![
            (
                "i8",
                Arc::new(Int8Array::from(vec![Some(-8), None, Some(127)])) as ArrayRef,
            ),
            (
                "u16",
                Arc::new(UInt16Array::from(vec![Some(1), Some(65535), None])),
            ),
            (
                "i64",
                Arc::new(Int64Array::from(vec![i64::MIN, 0, i64::MAX])),
            ),
            ("u64", Arc::new(UInt64Array::from(vec![0, 1, u64::MAX]))),
            (
                "f32",
                Arc::new(Float32Array::from(vec![Some(1.5), None, Some(0.1)])),
            ),
            (
                "f64",
                Arc::new(Float64Array::from(vec![0.1, f64::NAN, 1e300])),
            ),
            (
                "b",
                Arc::new(BooleanArray::from(vec![Some(true), Some(false), None])),
            ),
            ("n", Arc::new(NullArray::new(3))),
        ])]))
        .unwrap();
        assert_eq!(cells(&result, 0), ["-8", "NULL", "127"]);
        assert_eq!(cells(&result, 1), ["1", "65535", "NULL"]);
        assert_eq!(
            cells(&result, 2),
            [i64::MIN.to_string(), "0".into(), i64::MAX.to_string()]
        );
        assert_eq!(
            cells(&result, 3),
            ["0".to_string(), "1".into(), u64::MAX.to_string()]
        );
        assert_eq!(cells(&result, 4), ["1.5", "NULL", "0.1"]);
        assert_eq!(cells(&result, 5), ["0.1", "NaN", "1e300"]);
        assert_eq!(cells(&result, 6), ["true", "false", "NULL"]);
        assert_eq!(cells(&result, 7), ["NULL", "NULL", "NULL"]);
        assert_eq!(result.fields[7].data_type, DataType::Null);
    }

    #[test]
    fn strings_and_binary() {
        let result = decode(stream(&[batch(vec![
            (
                "s",
                Arc::new(StringArray::from(vec![
                    Some("(1) Ceres"),
                    None,
                    Some(""),
                    Some("héllo, \"x\"\n"),
                ])) as ArrayRef,
            ),
            (
                "ls",
                Arc::new(LargeStringArray::from(vec!["a", "bb", "ccc", "Δ"])),
            ),
            (
                "bin",
                Arc::new(BinaryArray::from(vec![&b"\x00\xff"[..], b"", b"A", b"z"])),
            ),
        ])]))
        .unwrap();
        assert_eq!(
            cells(&result, 0),
            ["(1) Ceres", "NULL", "", "héllo, \"x\"\n"]
        );
        assert_eq!(cells(&result, 1), ["a", "bb", "ccc", "Δ"]);
        assert_eq!(result.fields[1].data_type, DataType::Utf8 { large: true });
        assert_eq!(cells(&result, 2), ["\\x00\\xFF", "", "\\x41", "\\x7A"]);
    }

    #[test]
    fn temporal_and_decimal() {
        let decimals = Decimal128Array::from(vec![Some(12345), Some(-5), None, Some(0)])
            .with_precision_and_scale(10, 3)
            .unwrap();
        let result = decode(stream(&[batch(vec![
            (
                "d32",
                Arc::new(Date32Array::from(vec![0, 19_782, -1, 11_016])) as ArrayRef,
            ),
            (
                "d64",
                Arc::new(Date64Array::from(vec![0, 86_400_000, -1, 951_782_400_000])),
            ),
            (
                "ts_us",
                Arc::new(TimestampMicrosecondArray::from(vec![
                    0,
                    1_709_210_096_123_456,
                    -1,
                    1_000_000,
                ])),
            ),
            (
                "ts_s_utc",
                Arc::new(TimestampSecondArray::from(vec![0, 1, 2, 3]).with_timezone("UTC")),
            ),
            (
                "t64",
                Arc::new(Time64MicrosecondArray::from(vec![
                    0,
                    45_296_000_001,
                    1,
                    86_399_999_999,
                ])),
            ),
            (
                "t32",
                Arc::new(Time32MillisecondArray::from(vec![
                    0, 1_500, 61_000, 3_600_000,
                ])),
            ),
            ("dec", Arc::new(decimals)),
        ])]))
        .unwrap();
        assert_eq!(
            cells(&result, 0),
            ["1970-01-01", "2024-02-29", "1969-12-31", "2000-02-29"]
        );
        assert_eq!(
            cells(&result, 1),
            ["1970-01-01", "1970-01-02", "1969-12-31", "2000-02-29"]
        );
        assert_eq!(
            cells(&result, 2),
            [
                "1970-01-01 00:00:00",
                "2024-02-29 12:34:56.123456",
                "1969-12-31 23:59:59.999999",
                "1970-01-01 00:00:01"
            ]
        );
        assert_eq!(cells(&result, 3)[1], "1970-01-01 00:00:01 UTC");
        assert_eq!(result.fields[3].data_type.to_string(), "timestamp[s, UTC]");
        assert_eq!(
            cells(&result, 4),
            [
                "00:00:00",
                "12:34:56.000001",
                "00:00:00.000001",
                "23:59:59.999999"
            ]
        );
        assert_eq!(
            cells(&result, 5),
            ["00:00:00", "00:00:01.500", "00:01:01", "01:00:00"]
        );
        assert_eq!(cells(&result, 6), ["12.345", "-0.005", "NULL", "0.000"]);
        assert_eq!(
            result.fields[6].data_type,
            DataType::Decimal {
                precision: 10,
                scale: 3
            }
        );
    }

    #[test]
    fn unsupported_columns_are_skipped_exactly() {
        let list = ListArray::from_iter_primitive::<Int32Type, _, _>(vec![
            Some(vec![Some(1), Some(2)]),
            None,
            Some(vec![]),
        ]);
        let strukt = StructArray::from(vec![
            (
                Arc::new(AField::new("a", A::Utf8, true)),
                Arc::new(StringArray::from(vec!["p", "q", "r"])) as ArrayRef,
            ),
            (
                Arc::new(AField::new("b", A::Int64, true)),
                Arc::new(Int64Array::from(vec![1, 2, 3])) as ArrayRef,
            ),
        ]);
        let dict: DictionaryArray<Int32Type> = vec!["x", "y", "x"].into_iter().collect();
        let view = StringViewArray::from(vec!["a string longer than twelve bytes", "b", "c"]);
        let result = decode(stream(&[batch(vec![
            (
                "before",
                Arc::new(Int32Array::from(vec![1, 2, 3])) as ArrayRef,
            ),
            ("list", Arc::new(list)),
            ("struct", Arc::new(strukt)),
            ("dict", Arc::new(dict)),
            ("view", Arc::new(view)),
            ("after", Arc::new(StringArray::from(vec!["x", "y", "z"]))),
        ])]))
        .unwrap();
        assert_eq!(cells(&result, 0), ["1", "2", "3"]);
        assert_eq!(cells(&result, 1), ["<list>", "<list>", "<list>"]);
        assert_eq!(cells(&result, 2)[0], "<struct>");
        assert_eq!(cells(&result, 3)[0], "<dictionary>");
        assert_eq!(cells(&result, 4)[0], "<utf8_view>");
        assert_eq!(cells(&result, 5), ["x", "y", "z"]);
    }

    #[test]
    fn several_batches_and_concatenated_streams() {
        let schema = Arc::new(Schema::new(vec![AField::new("x", A::Int64, false)]));
        let one =
            RecordBatch::try_new(schema.clone(), vec![Arc::new(Int64Array::from(vec![1, 2]))])
                .unwrap();
        let two = RecordBatch::try_new(schema, vec![Arc::new(Int64Array::from(vec![3]))]).unwrap();
        let mut bytes = stream(&[one.clone(), two]);
        // DuckDB's chunks arrive as separate messages; a trailing marker and
        // garbage-free concatenation must still read.
        bytes.extend_from_slice(&stream(&[one])[..]);
        let result = decode(bytes).unwrap();
        assert_eq!(cells(&result, 0), ["1", "2", "3", "1", "2"]);
        assert_eq!(result.batches.len(), 3);
        assert_eq!(result.value(5, 0), None);
    }

    #[test]
    fn empty_result_has_schema() {
        let schema = Arc::new(Schema::new(vec![AField::new("x", A::Utf8, true)]));
        let mut out = Vec::new();
        let mut writer = StreamWriter::try_new(&mut out, &schema).unwrap();
        writer.finish().unwrap();
        drop(writer);
        let result = decode(out).unwrap();
        assert_eq!(result.fields[0].name, "x");
        assert_eq!(result.num_rows(), 0);
    }

    #[test]
    fn garbage_is_an_error_not_a_panic() {
        let good = stream(&[batch(vec![(
            "x",
            Arc::new(Int32Array::from(vec![1, 2, 3])) as ArrayRef,
        )])]);
        for len in 0..good.len() {
            let _ = decode(good[..len].to_vec());
        }
        for i in 0..good.len() {
            let mut bad = good.clone();
            bad[i] ^= 0xA5;
            if let Ok(result) = decode(bad) {
                for row in 0..result.num_rows() + 1 {
                    let _ = result.value(row, 0).map(|v| v.to_string());
                }
            }
        }
        assert!(decode(b"ARROW1\0\0".to_vec()).is_err());
        assert!(decode(Vec::new()).is_err());
    }

    #[test]
    fn decimal_display() {
        let show = |value, scale| Value::Decimal { value, scale }.to_string();
        assert_eq!(show(0, 2), "0.00");
        assert_eq!(show(-1, 2), "-0.01");
        assert_eq!(show(123, 0), "123");
        assert_eq!(show(123, -2), "12300");
        assert_eq!(show(0, -2), "0");
        assert_eq!(show(-5, -1), "-50");
        assert_eq!(show(i128::MIN + 1, 38).len(), 41); // sign, "1.", 38 digits
    }

    #[test]
    fn heap_bytes_is_the_ipc_buffer() {
        let bytes = stream(&[batch(vec![(
            "x",
            Arc::new(Int64Array::from(vec![1, 2, 3])) as ArrayRef,
        )])]);
        let len = bytes.len();
        assert_eq!(decode(bytes).unwrap().heap_bytes(), len);
    }
}
