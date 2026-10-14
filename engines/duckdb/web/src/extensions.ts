/** The directory under the host's base that DuckDB loads extensions from,
 *  unless the host names another (`extensionDir`, the same name for
 *  `createBridge`, `duckdb()`, and `scripts/extensions.ts`): the host's
 *  `public/duckdb-ext/`, filled by `scripts/extensions.ts` from the pins in
 *  `duckdb-extensions.json`. Shared by the engine, the Vite plugin, and the
 *  script, and imports nothing, so none pulls in another. */
export const EXTENSION_DIR = 'duckdb-ext';

/** `dir`, if it's one bare path segment; throws otherwise. The full path is
 *  always the host's base plus this, so a slash would put the files, the
 *  requests, and the plugin's 404 rule in three different places. */
export function extensionDir(dir: string = EXTENSION_DIR): string {
  if (!/^[\w.-]+$/.test(dir) || dir === '.' || dir === '..')
    throw new Error(`extensionDir must be one directory name under the host's base, like "${EXTENSION_DIR}"; got "${dir}"`);
  return dir;
}
