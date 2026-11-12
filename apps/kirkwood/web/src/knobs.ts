// The page's query knobs, for the checks and for looking: the scene's
// modules read them here.
const query = new URLSearchParams(location.search);

/** A number from the page's query, or `otherwise`; anything else there is
 *  the page's error, not a default taken without a word. */
export function knob(name: string, otherwise: number): number {
  const given = query.get(name);
  if (given === null) return otherwise;
  const value = Number(given);
  if (given === '' || !Number.isFinite(value)) throw new Error(`?${name} wants a number; got "${given}"`);
  return value;
}

/** Whether a part is on: off only at `?name=0`. */
export const on = (name: string): boolean => query.get(name) !== '0';
/** Whether the query names a knob at all. */
export const has = (name: string): boolean => query.has(name);
/** A knob's text, as given. */
export const text = (name: string): string | null => query.get(name);
/** A list from the page's query, as numbers. An empty entry is no number
 *  (`Number('')` is 0, which would pass for row 0 or 0 au). */
export const numbers = (given: string): number[] => given.split(',').map((entry) => (entry.trim() === '' ? NaN : Number(entry)));
