/**
 * Where the script faces are kept (Node only): `faces/` (gitignored), the 13
 * faces and their license, exactly what's served at `SCRIPT_FONTS` in the
 * GPUI base build's dev and preview (`contenders/engine.ts`) and production
 * (`worker/scripts/stage.ts`). `fetch.ts` fills it.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONTS_LICENSE, SCRIPT_FACES, faceFile } from './faces.ts';

export const FACES_DIR = fileURLToPath(new URL('./faces/', import.meta.url));
/** The license as committed: each face's copyright line, then the OFL 1.1. */
export const LICENSE_SOURCE = fileURLToPath(new URL(`./${FONTS_LICENSE}`, import.meta.url));

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Every file `faces/` should hold, and nothing else: each face and the license. */
export const FACES_FILES: readonly string[] = [...SCRIPT_FACES.map(faceFile), FONTS_LICENSE];

/** Why `faces/` isn't what `faces.ts` pins, or null: every face present at
 *  its SHA-256, the license the committed one, and nothing else (all of
 *  `faces/` is served). */
export function facesProblem(): string | null {
  if (!existsSync(FACES_DIR)) return 'faces/ is missing';
  const extra = readdirSync(FACES_DIR).filter((name) => !FACES_FILES.includes(name));
  if (extra.length) return `faces/ holds files no pin names: ${extra.join(', ')}`;
  for (const face of SCRIPT_FACES) {
    const path = join(FACES_DIR, faceFile(face));
    if (!existsSync(path)) return `${faceFile(face)} is missing`;
    const found = sha256(readFileSync(path));
    if (found !== face.sha256) return `${faceFile(face)}: SHA-256 ${found}, pinned ${face.sha256}`;
  }
  const license = join(FACES_DIR, FONTS_LICENSE);
  if (!existsSync(license) || !readFileSync(license).equals(readFileSync(LICENSE_SOURCE))) return `${FONTS_LICENSE} isn't the committed one`;
  return null;
}
