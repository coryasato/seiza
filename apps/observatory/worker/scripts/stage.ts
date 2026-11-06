// Stages what the Worker serves into worker/dist/ (gitignored), at the paths
// production serves them (contenders/paths.ts):
//
// - the page's build at /observatory/, each contender's at its base, and
//   each level a side builds (`scenarios.ts`'s `BUILT`) at its own
//   (`gpui/wide/`, `tanstack/market/`, …);
// - the engine at /observatory/duckdb/, one copy: the GPUI build's, after
//   checking every other build's is the same files and bytes;
// - the data at /observatory/data/: every file data/MANIFEST.json names,
//   each checked against its SHA-256 there;
// - the UI font at /fonts/, shared by every build on the apex.
//
// Beside each build file a quality-11 `<file>.br` (shared-web's brotli,
// cached by content: the bytes the budgets measure), which the Worker serves
// to browsers that take br. A file over the 25 MiB asset limit (DuckDB's wasm
// bundles) gets a `<file>.gz` too and is named in .assetsignore, so it's left
// out of the upload; its `.br` and `.gz` fit. The builds' `_headers` and
// `.vite/` aren't staged: the Worker sets every header itself.
//
// Usage: node apps/observatory/worker/scripts/stage.ts   (`just observatory deploy` runs it,
// after building every build). Other scripts read the result through `staged.ts`.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, gzipSync } from 'node:zlib';
import { walk } from '../../../../shared-web/scripts/walk.ts';
import { brotli } from '../../../../shared-web/src/brotli.ts';
import { levelOutDir } from '../../contenders/level.ts';
import { DATA, ENGINE, ENGINE_DIR, OBSERVATORY, UI_FONT, contenderBase } from '../../contenders/paths.ts';
import { BUILT } from '../../contenders/scenarios.ts';
import { PRECOMPRESSED } from '../src/files.ts';
import { ASSET_LIMIT, dataFiles, dist } from './staged.ts';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const root = join(appDir, '../..');
/** DuckDB-Wasm's own files, which the builds emit under hashed names. */
const duckdbDist = join(root, 'node_modules/@duckdb/duckdb-wasm/dist');

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

stage();

function stage(): void {
  /** Every contender build: each level each side builds, the GPUI base first. */
  const contenders = (['gpui', 'tanstack'] as const).flatMap((side) =>
    BUILT[side].map((level) => ({
      name: level === 'base' ? side : `${side}-${level}`,
      dir: join(appDir, `contenders/tall-table/${side}/web/${levelOutDir(level)}`),
      at: contenderBase('tall-table', side, level),
      /** The recipe that builds it. */
      recipe: `${side}-build${level === 'base' ? '' : ` ${level}`}`,
    })),
  );
  const page = join(appDir, 'web/dist');
  for (const { name, dir, recipe } of [{ name: 'page', dir: page, recipe: 'build' }, ...contenders])
    if (!existsSync(join(dir, 'index.html'))) throw new Error(`no ${name} build in ${relative(root, dir)}: run \`just observatory ${recipe}\``);
  const [gpui, ...others] = contenders;

  // Every file data/MANIFEST.json names, each as it pins it.
  const data = Object.entries(dataFiles()).map(([name, pinned]) => {
    const path = join(appDir, 'data', name);
    if (!existsSync(path)) throw new Error(`${path} is missing: build it with \`just observatory data\``);
    const found = sha256(readFileSync(path));
    if (found !== pinned) throw new Error(`${name}: SHA-256 ${found}, but data/MANIFEST.json says ${pinned}`);
    return { name, path };
  });

  // The engine: both builds emit the same files (`engine-files` checks it
  // too); one copy is served.
  const engineFiles = (build: string) =>
    Object.fromEntries(walk(join(build, ENGINE_DIR)).map((file) => [relative(join(build, ENGINE_DIR), file), sha256(readFileSync(file))]));
  const gpuiEngine = engineFiles(gpui!.dir);
  for (const other of others)
    if (JSON.stringify(gpuiEngine) !== JSON.stringify(engineFiles(other.dir))) throw new Error(`the GPUI build's ${ENGINE_DIR}/ and the ${other.name} build's differ: rebuild them (\`just observatory engine-files\` says how)`);
  // Its bundles directly in duckdb/ are served immutable (src/files.ts), so each name must carry its content hash.
  // A name passes only as `<DuckDB's own name>-<8-char hash><ext>`, so an
  // unhashed name ending in eight word characters (`-bindings.js`) can't.
  if (!existsSync(duckdbDist)) throw new Error(`${duckdbDist} is missing: run \`npm install\``);
  for (const name of Object.keys(gpuiEngine).filter((name) => !name.includes('/'))) {
    const [, base, ext] = /^(.+)-[\w-]{8}(\.[^.]+)$/.exec(name) ?? [];
    if (!base || existsSync(join(duckdbDist, name)) || !existsSync(join(duckdbDist, `${base}${ext}`)))
      throw new Error(`${ENGINE_DIR}/${name} isn't DuckDB-Wasm's file under a content hash, but is served immutable`);
  }

  rmSync(dist, { recursive: true, force: true });
  /** `from`'s files (but `skip`) at the URL path `at`. */
  const place = (from: string, at: string, skip: (path: string) => boolean = () => false) => {
    for (const file of walk(from)) {
      const path = relative(from, file);
      if (skip(path)) continue;
      const to = join(dist, at, path);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(file, to);
    }
  };
  const notServed = (path: string) => path === '_headers' || path.startsWith('.vite/') || path.startsWith(`${ENGINE_DIR}/`);
  place(page, OBSERVATORY, notServed);
  for (const { dir, at } of contenders) place(dir, at, notServed);
  place(join(gpui!.dir, ENGINE_DIR), ENGINE);
  mkdirSync(join(dist, DATA), { recursive: true });
  for (const { name, path } of data) copyFileSync(path, join(dist, DATA, name));
  mkdirSync(join(dist, dirname(UI_FONT)), { recursive: true });
  copyFileSync(join(root, 'shared-web/fonts', UI_FONT.slice(UI_FONT.lastIndexOf('/') + 1)), join(dist, UI_FONT));

  const oversize: string[] = [];
  let files = 0;
  for (const file of walk(dist)) {
    files++;
    const path = relative(dist, file);
    const big = statSync(file).size > ASSET_LIMIT;
    if (big) oversize.push(path);
    if (!PRECOMPRESSED.includes(path.slice(path.lastIndexOf('.') + 1))) {
      if (big) throw new Error(`${path} is over the 25 MiB asset limit and isn't a type the Worker serves compressed`);
      continue;
    }
    const bytes = readFileSync(file);
    const encoded: [string, Buffer][] = [['.br', brotli(bytes)]];
    // Only a file the upload leaves out needs a copy for browsers without br.
    if (big) encoded.push(['.gz', gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION })]);
    for (const [suffix, body] of encoded) {
      if (body.length > ASSET_LIMIT) throw new Error(`${path}${suffix} is over the 25 MiB asset limit`);
      writeFileSync(`${file}${suffix}`, body);
    }
  }
  writeFileSync(join(dist, '.assetsignore'), `# Over the 25 MiB asset limit: served as their .br and .gz (worker/scripts/stage.ts)\n${oversize.map((path) => `/${path}`).join('\n')}\n`);
  console.log(`staged worker/dist/: ${files} files, a .br beside each build file; left out (served as .br and .gz): ${oversize.join(', ')}`);
}
