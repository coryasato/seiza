/** Where DuckDB loads extensions from: the host's origin, its
 *  `public/duckdb-ext/`, filled by `scripts/extensions.ts` from the pins in
 *  `duckdb-extensions.json`. Shared by the engine and the Vite plugin, and
 *  imports nothing, so neither pulls in the other. */
export const EXTENSION_REPOSITORY = '/duckdb-ext';
