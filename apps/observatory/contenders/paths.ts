/**
 * Where the observatory's builds live on seiza.io (its `CLAUDE.md`, rule 2;
 * the URL map in root `docs/DECISIONS.md`, "Repo structure"). The page, the
 * contenders, their Vite configs, and the perf scripts read these; the
 * deploy stages each build at its path. Nothing here touches the browser,
 * so a Vite config imports it.
 */

import type { Side } from './contract.ts';
import type { Level } from './scenarios.ts';

/** The site's font path and the UI face there, `@seiza/web`'s. */
export { FONTS, UI_FONT } from '../../../shared-web/src/font.ts';

/** The page's base: `/observatory/` and `/observatory/<component>/`. */
export const OBSERVATORY = '/observatory/';
/** The engine both contenders load (DuckDB-Wasm's bundles and
 *  extensions), one copy at one path, outside either contender's base. */
export const ENGINE = '/observatory/duckdb/';
/** The engine's directory name under {@link OBSERVATORY}, as
 *  `@seiza/duckdb`'s `extensionDir` takes it. */
export const ENGINE_DIR = 'duckdb';
/** The data, served by range (`worker/src/index.ts`, `contenders/data.ts`). */
export const DATA = '/observatory/data/';

/** A contender's bare page: its build's base. A feature level's build sits
 *  under the base level's (`/observatory/contenders/tall-table/gpui/wide/`),
 *  each a build of its own (`scenarios.ts`, `Level`). */
export const contenderBase = (component: string, side: Side, level: Level = 'base'): string =>
  `${OBSERVATORY}contenders/${component}/${side}/${level === 'base' ? '' : `${level}/`}`;
