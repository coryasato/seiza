// Fetches every known asteroid from the JPL Small-Body Database Query API
// into data/raw/asteroids/ as raw JSON pages. prep.sql turns them into Parquet.
//
// Usage: node apps/tycho/data/fetch_asteroids.ts [--refresh] [--page-size 100000]
//
// Pages already on disk are kept, so an interrupted fetch resumes, and a rerun
// reuses the same data: the fetch date is part of the dataset (it's in the UI
// credit and MANIFEST.json). --refresh deletes the pages and fetches again.
//
// JPL asks for one request at a time, so pages are fetched in order. The
// catalog can change between pages (new discoveries, newly numbered objects
// moving up the spkid order), so prep dedupes on spkid, and this script checks
// that every page reported the same total: if the count moved mid-fetch, rows
// may have shifted between pages, and it fails and asks for --refresh.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';
/** The columns PLAN.md's Sample datasets section names, `spkid` first (the key). */
export const FIELDS = [
  'spkid', 'full_name', 'pdes', 'name', 'neo', 'pha', 'class', 'H', 'diameter', 'albedo',
  'a', 'e', 'i', 'q', 'per_y', 'first_obs', 'last_obs', 'n_obs_used',
];

const dataDir = dirname(fileURLToPath(import.meta.url));
export const rawDir = join(dataDir, 'raw/asteroids');
/** Written last, so its presence means the fetch completed. */
export const fetchInfoPath = join(rawDir, 'fetch.json');

export interface FetchInfo {
  source: string;
  /** UTC date (YYYY-MM-DD) the first page was fetched. */
  fetched: string;
  /** Rows the API reported, identical on every page. */
  count: number;
  pages: number;
  pageSize: number;
}

interface Page {
  fields: string[];
  data: unknown[][];
  count: number;
  /** Added by this script. */
  fetchedAt?: string;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const pagePath = (index: number) => join(rawDir, `page-${String(index).padStart(4, '0')}.json`);

async function fetchPage(offset: number, limit: number): Promise<Page> {
  const url = new URL(API);
  url.searchParams.set('fields', FIELDS.join(','));
  url.searchParams.set('sb-kind', 'a');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('limit-from', String(offset));
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'seiza-tycho-data-prep' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const page = (await response.json()) as Page;
      if (page.fields?.join(',') !== FIELDS.join(',')) throw new Error(`unexpected fields: ${page.fields?.join(',')}`);
      return { ...page, fetchedAt: new Date().toISOString() };
    } catch (error) {
      if (attempt >= 5) throw error;
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
  let fetched: string | null = null;
  for (let index = 0; ; index++) {
    const path = pagePath(index);
    let page: Page;
    if (existing.has(`page-${String(index).padStart(4, '0')}.json`)) {
      page = JSON.parse(readFileSync(path, 'utf8')) as Page;
    } else {
      const started = performance.now();
      page = await fetchPage(index * pageSize, pageSize);
      writeAtomic(path, JSON.stringify(page));
      console.log(`  page ${index}: ${page.data.length} rows in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    }
    fetched ??= page.fetchedAt?.slice(0, 10) ?? null;
    counts.add(page.count);
    if (page.data.length < pageSize || (index + 1) * pageSize >= page.count) {
      if (counts.size !== 1) {
        throw new Error(`the catalog changed during the fetch (counts ${[...counts].join(', ')}); run again with --refresh`);
      }
      const info: FetchInfo = { source: API, fetched: fetched ?? new Date().toISOString().slice(0, 10), count: page.count, pages: index + 1, pageSize };
      writeAtomic(fetchInfoPath, `${JSON.stringify(info, null, 2)}\n`);
      console.log(`asteroids: ${info.count} rows in ${info.pages} pages, fetched ${info.fetched}`);
      return info;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await fetchAsteroids({ refresh: process.argv.includes('--refresh'), pageSize: Number(option('page-size') ?? 100_000) });
}
