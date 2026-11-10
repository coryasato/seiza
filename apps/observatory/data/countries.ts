// The admin table's rows: the world's regions from CLDR, each named in its
// own language and in English, with its flag, capital, and population.
// Pure: prep.ts hands it the pinned sources' bytes (two CLDR npm tarballs and
// a Wikidata query's result) and writes what it returns with
// prep-countries.sql. The rules are in docs/DECISIONS.md, "Scenarios".

import { gunzipSync } from 'node:zlib';

export interface Country {
  /** The ISO 3166-1 alpha-2 code (Kosovo's user-assigned XK too). */
  code: string;
  /** Two regional indicators: the flag emoji. */
  flag: string;
  /** The region's name in its likely language, else an official one's, else English. */
  name: string;
  /** The CLDR locale `name` came from. */
  locale: string;
  english: string;
  /** Every best-rank capital, alphabetical, `, `-joined; empty for none. */
  capital: string;
  /** CLDR's population figure. */
  population: number;
  /** `population` as the canvas writes it (`populationText`). */
  populationText: string;
}

/**
 * CLDR's regions that aren't countries or territories: the macro-regions
 * (EU, EZ, UN, QO), the unknown region (ZZ), the pseudo-locales' (XA, XB),
 * and ISO 3166's exceptional reservations (AC, CP, CQ, DG, EA, IC, TA).
 */
export const NOT_A_COUNTRY = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB', 'AC', 'CP', 'CQ', 'DG', 'EA', 'IC', 'TA']);

/** A tarball's regular files by path. */
export function untar(tgz: Uint8Array): Map<string, Buffer> {
  const tar = gunzipSync(tgz);
  const files = new Map<string, Buffer>();
  const text = (from: number, length: number) => tar.subarray(from, from + length).toString('utf8').replace(/\0.*$/s, '');
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = text(at, 100);
    if (name === '') break;
    const size = parseInt(text(at + 124, 12).trim() || '0', 8);
    const type = text(at + 156, 1);
    const prefix = text(at + 345, 155);
    if (type === '0' || type === '') files.set(prefix ? `${prefix}/${name}` : name, tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** The flag emoji of a region code: its letters as regional indicators. */
export function flagOf(code: string): string {
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * A population as the canvas writes it, in B or M: two decimals in B
 * (`1.41 B`), whole M from 100 M (`173 M`), one decimal below it (`17.6 M`,
 * `3.0 M`), two under a million (`0.39 M`), and `< 0.01 M` under 5,000,
 * where two decimals would round to nothing. Each band starts where the one
 * below would round into it (99.96 M is `100 M`, not `100.0 M`). Rounded
 * half up on the integer, so no float's tie decides it.
 */
export function populationText(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`population ${n} isn't a count`);
  const fixed = (scale: number, decimals: number, unit: string) => {
    const rounded = Math.floor((n + scale / 2) / scale);
    return `${(rounded / 10 ** decimals).toFixed(decimals)} ${unit}`;
  };
  if (n >= 999_500_000) return fixed(1e7, 2, 'B');
  if (n >= 99_950_000) return fixed(1e6, 0, 'M');
  if (n >= 995_000) return fixed(1e5, 1, 'M');
  if (n >= 5_000) return fixed(1e4, 2, 'M');
  return '< 0.01 M';
}

type Json = Record<string, any>;

/** The rows, in no particular order: prep-countries.sql sorts them. */
export function countries(cldrCore: Uint8Array, cldrNames: Uint8Array, wikidata: string): Country[] {
  const core = untar(cldrCore);
  const names = untar(cldrNames);
  const json = (files: Map<string, Buffer>, path: string): Json => {
    const file = files.get(path);
    if (!file) throw new Error(`CLDR: no ${path}`);
    return JSON.parse(file.toString('utf8'));
  };
  const likely: Record<string, string> = json(core, 'package/supplemental/likelySubtags.json').supplemental.likelySubtags;
  const info: Json = json(core, 'package/supplemental/territoryInfo.json').supplemental.territoryInfo;
  const parsed = new Map<string, Record<string, string> | undefined>();
  const territories = (locale: string): Record<string, string> | undefined => {
    if (!parsed.has(locale)) {
      const file = names.get(`package/main/${locale}/territories.json`);
      parsed.set(locale, file && (Object.values(JSON.parse(file.toString('utf8')).main)[0] as Json).localeDisplayNames.territories);
    }
    return parsed.get(locale);
  };
  // A language's likely script: `und` → en-Latn when CLDR lists none.
  const scriptOf = (language: string) => (likely[language] ?? 'en-Latn').split('-')[1] ?? 'Latn';
  // The locale holding a language's names in a script: `<lang>-<Script>`, or
  // the bare language when that's its own likely script.
  const localeOf = (language: string, script: string) =>
    [`${language}-${script}`, language].find((locale) => territories(locale) && (locale.includes('-') || scriptOf(language) === script));

  const english = territories('en')!;
  const capitals = capitalsOf(wikidata);
  const rows: Country[] = [];
  for (const code of Object.keys(english).filter((key) => /^[A-Z]{2}$/.test(key) && !NOT_A_COUNTRY.has(key))) {
    // The likely-subtags algorithm: und-<region>, else und's own (en-Latn), the region kept.
    const [language = '', script = ''] = (likely[`und-${code}`] ?? `en-Latn-${code}`).split('-');
    let locale = localeOf(language, script);
    if (!locale) {
      // CLDR has no region names in that language: its most-spoken official language that has them, else English.
      // `official` alone: not `official_regional` or `de_facto_official`.
      const official = Object.entries((info[code]?.languagePopulation ?? {}) as Json)
        .filter(([, value]) => value._officialStatus === 'official')
        .sort((a, b) => Number(b[1]._populationPercent) - Number(a[1]._populationPercent));
      for (const [tag] of official) {
        const [lang = '', tagScript] = tag.split('_');
        locale = localeOf(lang, tagScript ?? scriptOf(lang));
        if (locale) break;
      }
      locale ??= 'en';
    }
    const population = Number(info[code]?._population);
    if (!Number.isFinite(population)) throw new Error(`CLDR: no population for ${code}`);
    const capital = capitals.get(code);
    const name = territories(locale)?.[code];
    const inEnglish = english[code];
    if (name === undefined || inEnglish === undefined) throw new Error(`CLDR: no name for ${code} in ${locale} or en`);
    rows.push({
      code,
      flag: flagOf(code),
      name,
      locale,
      english: inEnglish,
      capital: capital?.join(', ') ?? '',
      population,
      populationText: populationText(population),
    });
  }
  return rows;
}

/** Each code's capitals: every best-rank P36 of every item carrying the code, English labels, alphabetical. */
function capitalsOf(wikidata: string): Map<string, string[]> {
  const bindings: Json[] = JSON.parse(wikidata).results.bindings;
  const capitals = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const code: string = binding.code.value;
    const set = capitals.get(code) ?? new Set<string>();
    capitals.set(code, set);
    if (!binding.capital) continue;
    // The label service answers an item without an English label with its bare Q-id.
    const label: unknown = binding.capitalLabel?.value;
    if (typeof label !== 'string' || /^Q\d+$/.test(label)) throw new Error(`Wikidata: ${code}'s capital ${binding.capital.value} has no English label`);
    set.add(label);
  }
  return new Map([...capitals].map(([code, set]) => [code, [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))]));
}
