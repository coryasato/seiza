import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every file under `dir`, recursively. */
export const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
