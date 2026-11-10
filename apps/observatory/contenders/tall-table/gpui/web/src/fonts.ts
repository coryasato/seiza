/**
 * The admin table's fonts toggle's faces on the GPUI side, a chunk
 * `base.ts` loads once the rows are in. Fetches every script face
 * (`contenders/fonts/faces.ts`) at once and checks each against its pin
 * (its byte count and SHA-256: the wasm's `add_fonts` skips a face it can't
 * parse without an error, so a bad one would mark the faces drawn while
 * its script shows boxes; outside a secure context, a LAN check from a
 * phone, `crypto.subtle` is missing and the count alone is checked), then
 * hands them to the wasm in one call (`crate/src/fonts.rs`).
 * `contender:fonts-in` is the moment right before that call, set once the
 * wasm has taken them; the wasm marks `contender:fonts` right after the
 * first frame drawn with them. A face that doesn't load or match, or the
 * wasm refusing them, marks `contender:fonts-failed` alone.
 */

import * as pkg from '../pkg/tall_table_gpui.js';
import { MARKS } from '../../../../contract.ts';
import { SCRIPT_FACES, faceFile, type ScriptFace } from '../../../../fonts/faces.ts';
import { SCRIPT_FONTS } from '../../../../paths.ts';
import type { FontsExports } from './base.ts';

const hex = (digest: ArrayBuffer) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const fetchFace = async (face: ScriptFace): Promise<Uint8Array> => {
  const url = `${SCRIPT_FONTS}${faceFile(face)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = crypto.subtle ? hex(await crypto.subtle.digest('SHA-256', bytes)) : face.sha256;
  if (bytes.length !== face.bytes || sha256 !== face.sha256) throw new Error(`${url}: ${bytes.length} bytes, SHA-256 ${sha256}; pinned ${face.bytes}, ${face.sha256}`);
  return bytes;
};

export async function loadScriptFonts(): Promise<void> {
  try {
    const faces = await Promise.all(SCRIPT_FACES.map(fetchFace));
    const at = performance.now();
    (pkg as unknown as FontsExports).addFonts(faces);
    performance.mark(MARKS.fontsIn, { startTime: at });
  } catch (error) {
    console.error('the script fonts failed:', error);
    performance.mark(MARKS.fontsFailed);
  }
}
