// Spike: the draft countries file, served beside the others in data/.
import { readFileSync } from 'node:fs';
const D = new URL('../../data', import.meta.url).pathname.replace(/\/$/, '');
const { countries } = await import(`${D}/countries.ts`);
const { DuckDBInstance } = await import(`${D}/node_modules/@duckdb/node-api/lib/index.js`);
const raw = `${D}/raw/countries`;
const rows = countries(readFileSync(`${raw}/cldr-core-49.0.0.tgz`), readFileSync(`${raw}/cldr-localenames-full-49.0.0.tgz`), readFileSync(`${raw}/wikidata-capitals.json`, 'utf8'));
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const values = rows.map((c: any) => `(${q(c.code)}, ${q(c.flag)}, ${q(c.name)}, ${q(c.english)}, ${q(c.capital)}, ${q(c.populationText)})`).join(',\n');
const sql = readFileSync(`${D}/prep-countries.sql`, 'utf8').replace('${values}', values).replace('${out}', `${D}/countries.parquet`).replace('${credit}', 'spike').replace('${source}', 'spike');
const conn = await (await DuckDBInstance.create()).connect();
await conn.run(sql);
const r = await conn.runAndReadAll(`select count(*) from '${D}/countries.parquet'`);
console.log(r.getRows());
