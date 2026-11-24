//! Files from the visitor's device, and the sample's download. The page
//! takes a drop or the file dialog's choice (`web/src/frame/core.ts`: GPUI
//! can't deliver a browser drop, `.claude/rules/gpui-web.md`) and hands the
//! `File`, a handle to the bytes on disk, to `crate::frame`; DuckDB then
//! reads it by range (`registerFile`). [`sniff`] reads 8 bytes; a CSV's
//! chunks are cut by `crate::csv`, which reads it through [`read`].

use js_sys::Uint8Array;
use wasm_bindgen::JsCast as _;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

/// What a file's first and last bytes, and its name, say it is.
#[derive(Debug, Clone, PartialEq)]
pub enum Kind {
    Parquet,
    /// `PARE` at both ends: the columns and footer are encrypted, and DuckDB
    /// needs the key.
    EncryptedParquet,
    /// Named or typed as CSV (or TSV). The name decides: CSV has no magic
    /// bytes, and DuckDB's sniffer says whether it reads as one.
    Csv,
    /// A gzipped CSV. Chunks are cut at record boundaries in the raw bytes,
    /// which a compressed file doesn't have.
    CompressedCsv,
    /// Zero bytes.
    Empty,
    Other,
}

/// Reads the 4 bytes at each end of `file`: a Parquet file starts and ends
/// with `PAR1`. Takes well under a millisecond on any size, and needs no
/// engine, so a wrong file is answered at once, even while DuckDB loads.
pub async fn sniff(file: &web_sys::File) -> Result<Kind, String> {
    const MAGIC: &[u8] = b"PAR1";
    const ENCRYPTED: &[u8] = b"PARE";
    let size = file.size();
    if size == 0.0 {
        return Ok(Kind::Empty);
    }
    // Too short to hold a Parquet header and footer (12 bytes): not Parquet.
    if size >= 12.0 {
        let head = read(file, 0.0, 4.0).await?;
        let tail = read(file, size - 4.0, size).await?;
        match (head.as_slice(), tail.as_slice()) {
            (MAGIC, MAGIC) => return Ok(Kind::Parquet),
            (ENCRYPTED, ENCRYPTED) => return Ok(Kind::EncryptedParquet),
            _ => {}
        }
    }
    Ok(csv_kind(&file.name(), &file.type_()).unwrap_or(Kind::Other))
}

pub(crate) async fn read(file: &web_sys::File, start: f64, end: f64) -> Result<Vec<u8>, String> {
    let error = |error: JsValue| {
        error
            .dyn_ref::<js_sys::Error>()
            .map(|error| String::from(error.message()))
            .or_else(|| error.as_string())
            .unwrap_or_else(|| "the browser couldn't read it".into())
    };
    let slice = file.slice_with_f64_and_f64(start, end).map_err(error)?;
    let buffer = JsFuture::from(slice.array_buffer()).await.map_err(error)?;
    Ok(Uint8Array::new(&buffer).to_vec())
}

/// Downloads `url` whole and hands it back as a `File` named `name`, held in
/// memory, so it opens as a file from this device does: the sample is read
/// from memory, never by range over the network (`docs/DECISIONS.md`,
/// "Sample data", 2026-11-17).
pub(crate) async fn download(url: &str, name: &str) -> Result<web_sys::File, String> {
    let error = |error: JsValue| {
        error
            .dyn_ref::<js_sys::Error>()
            .map(|error| String::from(error.message()))
            .or_else(|| error.as_string())
            .unwrap_or_else(|| "the download failed".into())
    };
    let window = web_sys::window().ok_or("no window")?;
    let response: web_sys::Response = JsFuture::from(window.fetch_with_str(url))
        .await
        .map_err(error)?
        .dyn_into()
        .map_err(error)?;
    if !response.ok() {
        return Err(format!("the server answered {}", response.status()));
    }
    let blob = JsFuture::from(response.blob().map_err(error)?)
        .await
        .map_err(error)?;
    web_sys::File::new_with_blob_sequence(&js_sys::Array::of1(&blob), name).map_err(error)
}

/// A CSV by name or MIME type, compressed or not.
pub fn csv_kind(name: &str, mime: &str) -> Option<Kind> {
    let name = name.to_ascii_lowercase();
    if [".csv.gz", ".tsv.gz"].iter().any(|ext| name.ends_with(ext)) {
        return Some(Kind::CompressedCsv);
    }
    let csv = [".csv", ".tsv"].iter().any(|ext| name.ends_with(ext))
        || mime == "text/csv"
        || mime == "text/tab-separated-values";
    csv.then_some(Kind::Csv)
}
