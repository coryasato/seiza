// Fetches every known asteroid from the JPL Small-Body Database Query API
// into data/raw/asteroids/ as raw JSON pages, at full precision: the columns
// of Tycho's asteroid sample and the orbit's other elements (docs/data.md).
//
// Usage: node apps/kirkwood/data/fetch.ts [--refresh] [--page-size 100000]
//
// Pages already on disk are kept, so an interrupted fetch resumes, and a rerun
// reuses the same data: the fetch date is part of the dataset (it's in the
// credit and MANIFEST.json). --refresh deletes the pages and fetches again.
//
// JPL asks for one request at a time, so pages are fetched in order. The
// catalog can change between pages (new discoveries, newly numbered objects
// moving up the spkid order), so readers dedupe on spkid, and this script
// checks that every page reported the same total: if the count moved
// mid-fetch, rows may have shifted between pages, and it fails and asks for
// --refresh.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';
/** Tycho's sample's columns, `spkid` first (the key), in its order. */
export const SAMPLE_FIELDS = [
  'spkid', 'full_name', 'pdes', 'name', 'neo', 'pha', 'class', 'H', 'diameter', 'albedo',
  'a', 'e', 'i', 'q', 'per_y', 'first_obs', 'last_obs', 'n_obs_used',
];
/**
 * What a place in space needs beside a, e, and i: the node, the argument of
 * perihelion, the mean anomaly, and the epoch they hold at (a Julian day,
 * TDB), with the equinox of their frame. `n` (mean motion, degrees a day)
 * and `tp` (the perihelion passage, a Julian day) are JPL's own, to check a
 * computed one against; `orbit_id` names the solution.
 */
export const ORBIT_FIELDS = ['om', 'w', 'ma', 'epoch', 'equinox', 'n', 'tp', 'orbit_id'];
export const FIELDS = [...SAMPLE_FIELDS, ...ORBIT_FIELDS];

const dataDir = dirname(fileURLToPath(import.meta.url));
export const rawDir = join(dataDir, 'raw/asteroids');
/** Written last, so its presence means the fetch completed. */
export const fetchInfoPath = join(rawDir, 'fetch.json');

export interface FetchInfo {
  source: string;
  /** The query beside the paging: what was asked of the API. */
  query: Record<string, string>;
  /** The fields the API returned, in order. */
  fields: string[];
  /** UTC date (YYYY-MM-DD) the first page was fetched. */
  fetched: string;
  /** Rows the API reported, identical on every page. */
  count: number;
  pages: number;
  pageSize: number;
}

export interface Page {
  fields: string[];
  data: (string | number | null)[][];
  count: number;
  /** Added by this script. */
  fetchedAt?: string;
}

/** `full-prec`: without it the API rounds every number for display. */
const QUERY = { fields: FIELDS.join(','), 'sb-kind': 'a', 'full-prec': '1' };

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const pageName = (index: number) => `page-${String(index).padStart(4, '0')}.json`;

async function fetchPage(offset: number, limit: number): Promise<Page> {
  const url = new URL(API);
  for (const [name, value] of Object.entries(QUERY)) url.searchParams.set(name, value);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('limit-from', String(offset));
  for (let attempt = 1; ; attempt++) {
    // An answer the same request would get again (a refused query, other
    // fields than asked for) ends the fetch; only a failure in transit or at
    // the server is tried again.
    let final = false;
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'data-prep' } });
      if (!response.ok) {
        final = response.status < 500 && response.status !== 429;
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const page = (await response.json()) as Page;
      if (page.fields?.join(',') !== FIELDS.join(',')) {
        final = true;
        throw new Error(`unexpected fields: ${page.fields?.join(',')}`);
      }
      return { ...page, fetchedAt: new Date().toISOString() };
    } catch (error) {
      if (final || attempt >= 5) throw error;
      const wait = 2 ** attempt * 1000;
      console.warn(`  page at ${offset} failed (${(error as Error).message}); retrying in ${wait / 1000} s`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

function writeAtomic(path: string, text: string): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

export async function fetchAsteroids(options: { refresh?: boolean; pageSize?: number } = {}): Promise<FetchInfo> {
  const pageSize = options.pageSize ?? 100_000;
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error(`--page-size must be a whole number above zero, not ${pageSize}`);
  if (options.refresh) rmSync(rawDir, { recursive: true, force: true });
  mkdirSync(rawDir, { recursive: true });
  try {
    const info = JSON.parse(readFileSync(fetchInfoPath, 'utf8')) as FetchInfo;
    console.log(`asteroids: using the fetch from ${info.fetched} (${info.count} rows, ${info.pages} pages); --refresh to fetch again`);
    return info;
  } catch {
    // Not fetched yet, or interrupted: fetch the missing pages.
  }
  const existing = new Set(readdirSync(rawDir).filter((name) => /^page-\d{4}\.json$/.test(name)));
  const counts = new Set<number>();
  const keys = new Set<number>();
  const times: number[] = [];
  let fetched: string | null = null;
  for (let index = 0; ; index++) {
    const path = join(rawDir, pageName(index));
    let page: Page;
    if (existing.has(pageName(index))) {
      page = JSON.parse(readFileSync(path, 'utf8')) as Page;
    } else {
      const started = performance.now();
      page = await fetchPage(index * pageSize, pageSize);
      writeAtomic(path, JSON.stringify(page));
      console.log(`  page ${index}: ${page.data.length} rows in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    }
    fetched ??= page.fetchedAt?.slice(0, 10) ?? null;
    counts.add(page.count);
    for (const row of page.data) keys.add(Number(row[0]));
    if (page.fetchedAt) times.push(Date.parse(page.fetchedAt));
    const last = page.data.length < pageSize || (index + 1) * pageSize >= page.count;
    // A page kept from a run with another page size would leave a hole or an overlap.
    if (page.data.length > pageSize || (!last && page.data.length !== pageSize)) {
      throw new Error(`${pageName(index)} holds ${page.data.length} rows, not a page of ${pageSize}: fetched with another --page-size; run again with it, or with --refresh`);
    }
    if (last) {
      if (counts.size !== 1) {
        throw new Error(`the catalog changed during the fetch (counts ${[...counts].join(', ')}); run again with --refresh`);
      }
      // The same count can hide a row that moved across a page boundary: one fetched twice, another never.
      if (keys.size !== page.count) {
        throw new Error(`${keys.size} distinct spkids, but the API reported ${page.count}: rows shifted between pages; run again with --refresh`);
      }
      // One date names the dataset, so its pages are from one sitting.
      const hours = (Math.max(...times) - Math.min(...times)) / 3_600_000;
      if (hours > 6) throw new Error(`the pages were fetched ${hours.toFixed(1)} h apart (a resumed fetch): one date can't name them; run again with --refresh`);
      const info: FetchInfo = {
        source: API,
        query: QUERY,
        fields: page.fields,
        fetched: fetched ?? new Date().toISOString().slice(0, 10),
        count: page.count,
        pages: index + 1,
        pageSize,
      };
      writeAtomic(fetchInfoPath, `${JSON.stringify(info, null, 2)}\n`);
      console.log(`asteroids: ${info.count} rows in ${info.pages} pages, fetched ${info.fetched}`);
      return info;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await fetchAsteroids({ refresh: process.argv.includes('--refresh'), pageSize: Number(option('page-size') ?? 100_000) });
}
