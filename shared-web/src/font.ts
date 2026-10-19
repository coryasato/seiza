/**
 * Where `fonts/`' files are served on an origin whose builds share them (the
 * apex site: its pages and the observatory's contenders), so one download
 * is cached across every build: `/fonts/<file>`. `serveFonts()`
 * (`vite.ts`) serves them there in dev and preview; a deploy stages them
 * there. Browser-safe: a page's code reads it too. A stylesheet's
 * `@font-face` spells the URL out.
 */

/** The path `fonts/` is served at. */
export const FONTS = '/fonts/';
/** The UI face (IBM Plex Sans Regular), at {@link FONTS}. */
export const UI_FONT = `${FONTS}IBMPlexSans-Regular.ttf`;
