/**
 * The admin table's scripts as GPUI draws them with the fonts toggle's
 * faces, for its panel (`numbers.ts`). Pure, so the build (`cold.ts`) and
 * `perf/page.ts` check every face has a verdict before the page says it.
 */

import { SCRIPT_FACES } from '../../contenders/fonts/faces.ts';

/** The scripts in the countries file that IBM Plex Sans lacks: a Noto face
 *  each (`contenders/fonts/faces.ts`), then Han and Hangul, which the
 *  browser draws into the canvas (`EmojiAndCjk`). */
export const SCRIPTS = [...SCRIPT_FACES.map((face) => face.script), 'Chinese, Japanese', 'Korean'];

/**
 * Each script with fonts loaded, against the DOM's drawing of the same
 * names in the same faces (`perf/results/2026-11-09-m12-a2.md`, "Each
 * script's shaping against the DOM's"): a name from the file, right or
 * drawn wrong, and why. The faces' scripts in `faces.ts`'s order, then the
 * two the browser draws.
 */
export const SCRIPT_VERDICTS: Record<string, { name: string; right: boolean; why?: string }> = {
  Arabic: { name: 'مصر', right: false, why: 'Joined, right to left. 25 of 26 names lose a mark offset; in 3 a dot sits visibly off its letter, and Palestinian Territories’ last letter reads as another.' },
  Armenian: { name: 'Հայաստան', right: true },
  Bengali: { name: 'বাংলাদেশ', right: true, why: 'Conjuncts formed.' },
  Devanagari: { name: 'भारत', right: true, why: 'Conjuncts formed.' },
  Ethiopic: { name: 'ኢትዮጵያ', right: true },
  Georgian: { name: 'საქართველო', right: true },
  Hebrew: { name: 'ישראל', right: true, why: 'Right to left; one mark 0.1 px off, unseen.' },
  Khmer: { name: 'កម្ពុជា', right: false, why: 'A vowel under its subscript sits 4 px too high.' },
  Lao: { name: 'ລາວ', right: true },
  Myanmar: { name: 'မြန်မာ', right: true, why: 'Medials formed; one mark 0.6 px off.' },
  Sinhala: { name: 'ශ්‍රී ලංකාව', right: false, why: 'Sri Lanka’s ශ්‍රී isn’t formed: two marks draw 12 px right of their letter.' },
  Thai: { name: 'ไทย', right: true, why: 'Stacked marks in place.' },
  Tibetan: { name: 'འབྲུག', right: true, why: 'Stacks formed.' },
  'Chinese, Japanese': { name: '中国 · 日本', right: true, why: 'Drawn by the browser into the canvas, a character at a time.' },
  Korean: { name: '대한민국', right: true, why: 'Drawn by the browser into the canvas.' },
};

/** The scripts without a verdict: the build fails on any (`cold.ts`). */
export const unjudged = (): string[] => SCRIPTS.filter((script) => !SCRIPT_VERDICTS[script]);

/** The verdicts' rows, in order: every face's script, then Han's and
 *  Hangul's. A script without one is left out here; the build refuses it. */
export const SCRIPT_ROWS = SCRIPTS.flatMap((script) => {
  const verdict = SCRIPT_VERDICTS[script];
  return verdict ? [{ script, ...verdict }] : [];
});
