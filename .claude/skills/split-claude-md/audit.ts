// Audits a CLAUDE.md split: the original (from git) against every CLAUDE.md
// now under the same directory.
//
//   node .claude/skills/split-claude-md/audit.ts <dir> [--base <git-ref>]
//
// <dir> is the app or component (apps/tycho, components/tall-table, …);
// --base is the commit holding the unsplit file (default HEAD).
//
// It prints, and never fixes:
// 1. Each sentence of the original found in no new file (expected only for
//    what you moved up, rewrote, or dropped on purpose: say which in the
//    session) or in more than one (a duplicate: pick one home).
// 2. Each 14-word passage two new files share, past the header every nested
//    file carries and its `just …` command lines (a duplicate).
// 3. Every imperative in the nested files ("never", "don't", "must",
//    "always", "regenerate", "byte-identical", …), to read one by one: a rule
//    whose trigger is outside its folder moves up to the top file's
//    "When something outside a folder changes it".
// Exits 1 if 1 or 2 found anything, so a clean run is a check.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((arg) => !arg.startsWith('--'));
const baseAt = args.indexOf('--base');
const base = baseAt >= 0 ? args[baseAt + 1] : 'HEAD';
if (!dir) {
  console.error('usage: audit.ts <dir> [--base <git-ref>]');
  process.exit(2);
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const top = join(dir, 'CLAUDE.md');
const original = execFileSync('git', ['show', `${base}:${relative(root, join(process.cwd(), top))}`], { cwd: root, encoding: 'utf8' });

const SKIP = new Set(['node_modules', 'target', 'dist', 'pkg', '.git']);
function claudeFiles(at: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    if (entry.isDirectory() && !SKIP.has(entry.name) && !entry.name.startsWith('dist-') && !entry.name.startsWith('pkg-')) found.push(...claudeFiles(join(at, entry.name)));
    else if (entry.name === 'CLAUDE.md') found.push(join(at, entry.name));
  }
  return found;
}
const files = claudeFiles(dir).sort();
const text = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
const nested = files.filter((file) => file !== top);
let problems = 0;

// 1. Sentences, line by line so none runs into the next heading.
const missing: string[] = [];
const doubled: string[] = [];
for (const line of original.split('\n')) {
  for (let sentence of line.split(/(?<=[.;])\s+(?=[A-Z`(*])/)) {
    sentence = sentence.trim().replace(/^(- |\d+\. )/, '');
    if (sentence.split(/\s+/).length < 5) continue;
    const hits = files.filter((file) => text.get(file)!.includes(sentence));
    if (hits.length === 0) missing.push(sentence);
    else if (hits.length > 1) doubled.push(`${sentence.slice(0, 120)}  [${hits.join(', ')}]`);
  }
}
console.log(`\n1. The original's sentences: ${missing.length} in no file, ${doubled.length} in more than one`);
for (const sentence of missing) console.log(`   not found: ${sentence.slice(0, 160)}`);
for (const sentence of doubled) console.log(`   in two:    ${sentence}`);
problems += doubled.length;

// 2. Passages two new files share: each nested file's body past its header
// (which every one carries), command lines apart (`just …` lines read alike
// by nature: a dev server per contender).
const grams = (body: string, n = 14) => {
  const words = body.split(/\s+/);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i += 1) out.add(words.slice(i, i + n).join(' '));
  return out;
};
const bodyOf = (file: string) => {
  const body = text.get(file)!;
  const past = file === top ? body : body.slice(body.indexOf('\n## ') + 1);
  return past.split('\n').filter((line) => !line.startsWith('just ')).join('\n');
};
const sets = new Map(files.map((file) => [file, grams(bodyOf(file))]));
console.log('\n2. Passages shared by two files (headers and command lines apart)');
let shared = 0;
for (let i = 0; i < files.length; i += 1) {
  for (let j = i + 1; j < files.length; j += 1) {
    const both = [...sets.get(files[i])!].filter((gram) => sets.get(files[j])!.has(gram));
    if (both.length === 0) continue;
    shared += 1;
    console.log(`   ${files[i]} and ${files[j]}: ${both.length}, e.g. "${both[0].slice(0, 110)}"`);
  }
}
if (shared === 0) console.log('   none');
problems += shared;

// 3. The nested files' imperatives, for a reader to judge.
const RULE = /[^.;(]{0,90}\b(never|don't|do not|must|always|regenerate|before it|first:|only in|byte-identical|fails? the build)\b[^.;)]{0,90}/gi;
console.log("\n3. The nested files' imperatives: does each one's trigger lie inside its folder?");
for (const file of nested) {
  const rules = text.get(file)!.match(RULE) ?? [];
  console.log(`   ${file} (${rules.length})`);
  for (const rule of rules) console.log(`     - ${rule.trim().slice(0, 170)}`);
}

console.log(`\nwords: ${files.map((file) => `${file} ${text.get(file)!.split(/\s+/).length}`).join(', ')}`);
process.exit(problems ? 1 : 0);
