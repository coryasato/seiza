// Fills contenders/fonts/faces/ (gitignored) with the admin table's script
// faces as faces.ts pins them: each fetched from notofonts' release site at
// NOTO_COMMIT when missing or changed, checked against its byte count and
// SHA-256, and its name table's copyright line found in OFL.txt (the
// license served beside them); then OFL.txt itself. It owns faces/: anything
// else there (an older pin's face, a fetch's leftover .tmp) is removed,
// since all of it is served. A no-op once they're in.
//
// Usage: node apps/observatory/contenders/fonts/fetch.ts   (`just observatory script-fonts`)

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FONTS_LICENSE, SCRIPT_FACES, faceFile, faceSource } from './faces.ts';
import { FACES_DIR, FACES_FILES, LICENSE_SOURCE, facesProblem, sha256 } from './files.ts';

/** A face's name table entry `id` (Windows, Unicode), or undefined. */
function nameOf(font: Buffer, id: number): string | undefined {
  const tables = font.readUInt16BE(4);
  let name = -1;
  for (let i = 0; i < tables; i++) if (font.toString('latin1', 12 + i * 16, 16 + i * 16) === 'name') name = font.readUInt32BE(12 + i * 16 + 8);
  if (name < 0) return undefined;
  const count = font.readUInt16BE(name + 2);
  const strings = name + font.readUInt16BE(name + 4);
  for (let i = 0; i < count; i++) {
    const record = name + 6 + i * 12;
    if (font.readUInt16BE(record) !== 3 || font.readUInt16BE(record + 6) !== id) continue;
    const start = strings + font.readUInt16BE(record + 10);
    return font.subarray(start, start + font.readUInt16BE(record + 8)).swap16().toString('utf16le');
  }
  return undefined;
}

mkdirSync(FACES_DIR, { recursive: true });
for (const name of readdirSync(FACES_DIR).filter((name) => !FACES_FILES.includes(name))) {
  rmSync(join(FACES_DIR, name), { recursive: true, force: true });
  console.log(`fonts: removed ${name}, which no pin names`);
}
const license = readFileSync(LICENSE_SOURCE, 'utf8');
for (const face of SCRIPT_FACES) {
  const path = join(FACES_DIR, faceFile(face));
  let bytes = existsSync(path) ? readFileSync(path) : null;
  if (!bytes || sha256(bytes) !== face.sha256) {
    const response = await fetch(faceSource(face));
    if (!response.ok) throw new Error(`${faceSource(face)}: ${response.status} ${response.statusText}`);
    bytes = Buffer.from(await response.arrayBuffer());
    const found = sha256(bytes);
    if (bytes.length !== face.bytes || found !== face.sha256) throw new Error(`${faceFile(face)}: ${bytes.length} bytes, SHA-256 ${found}; pinned ${face.bytes}, ${face.sha256}`);
    writeFileSync(`${path}.tmp`, bytes);
    renameSync(`${path}.tmp`, path);
    console.log(`fonts: ${faceFile(face)} (${(bytes.length / 1024).toFixed(1)} KiB)`);
  }
  const version = nameOf(Buffer.from(bytes), 5);
  if (version !== `Version ${face.version}`) throw new Error(`${faceFile(face)}: its name table says ${version}, faces.ts ${face.version}`);
  const copyright = nameOf(Buffer.from(bytes), 0);
  if (!copyright || !license.includes(copyright)) throw new Error(`${faceFile(face)}: its copyright line (${copyright}) isn't in ${FONTS_LICENSE}`);
}
copyFileSync(LICENSE_SOURCE, join(FACES_DIR, FONTS_LICENSE));
const problem = facesProblem();
if (problem) throw new Error(problem);
