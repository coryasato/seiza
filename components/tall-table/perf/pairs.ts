// Every feature alone and every pair of features: compiled and clippy-clean
// (wasm32, -D warnings) for the table, the bridge, and the bare host, one
// build a set, as a host builds it (the host's feature turns on the
// table's and the bridge's, so the three share one set). Then the native
// tests on the pairs with code gated on both, which this script finds in
// the sources, then the table's rustdoc at every set (-D warnings: a doc
// that links an item its build doesn't have is a broken link there). `just tall-table test` runs a feature alone and all on, and
// `lint` clippies none and all; a pair that doesn't compile without a
// third (an import gated on one feature, used under two) reaches neither.
//
// About a second a clippy build, 19 s a pair's tests, and a second and a
// half a set's rustdoc: ~47 minutes in all at 17 features (2,810 s on
// 2026-11-24, perf/results/2026-11-24-m25-a.md; ~24 at the API review's
// count, perf/results/2026-11-17-api-review-b.md), a few each for
// `--only clippy` and `--only doc`. Those two run before a code review;
// the whole run is over 20 minutes, so it runs once, after the review's
// fixes, asked about first (root CLAUDE.md, "Working agreements"). A
// recipe of its own, not part of `lint`.
//
// A pair where one feature turns on the other (`follow` and `live`, `copy`
// and `select`) is its single's build: counted, not built again.
//
// Code gated on both: a `cfg` whose expression needs two features at once
// (`all(feature = "a", feature = "b")`), a `cfg` inside an item, block, or
// module another `cfg` gates, and a `cfg` in a module's file whose `mod`
// line is gated, the tests' among them. `any(…)` is each of its arms;
// `not(…)` is nothing. Code that needs exactly those two: what needs a
// third runs in no pair's build (a feature another turns on doesn't count).
//
// Usage: node components/tall-table/perf/pairs.ts [--list] [--only clippy|test|doc] [--from <n>]
//   --list   print the sets and the pairs with code gated on both, run nothing
//   --only   one part
//   --from   start at the nth build of the part --only names (after a failure fixed)

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const componentDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = join(componentDir, '../..');

/// The table's features, in its manifest's order, and what each turns on.
function features(): Map<string, string[]> {
    const manifest = readFileSync(join(componentDir, 'Cargo.toml'), 'utf8');
    const section = manifest.slice(manifest.indexOf('[features]'));
    const found = new Map<string, string[]>();
    for (const line of section.split('\n').slice(1)) {
        if (line.startsWith('[')) {
            break;
        }
        const match = /^([a-z][a-z0-9-]*)\s*=\s*\[(.*)\]/.exec(line);
        if (match) {
            found.set(match[1]!, [...match[2]!.matchAll(/"([^"/]+)"/g)].map((on) => on[1]!));
        }
    }
    return found;
}

/// A `cfg` expression as the feature sets that satisfy it: one set an
/// alternative, each the features it needs on.
function alternatives(expression: string): string[][] {
    const text = expression.trim();
    const call = /^(all|any|not)\s*\(([\s\S]*)\)$/.exec(text);
    if (!call) {
        const feature = /^feature\s*=\s*"([^"]+)"$/.exec(text);
        return [feature ? [feature[1]!] : []];
    }
    const args = split(call[2]!);
    if (call[1] === 'not') {
        return [[]];
    }
    if (call[1] === 'any') {
        return args.flatMap(alternatives);
    }
    // `all`: one alternative from each argument, together.
    return args.map(alternatives).reduce<string[][]>(
        (sets, arg) => sets.flatMap((set) => arg.map((more) => [...new Set([...set, ...more])])),
        [[]],
    );
}

/// `text` split at its top-level commas.
function split(text: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let at = 0; at < text.length; at++) {
        const char = text[at];
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
        } else if (char === ',' && depth === 0) {
            parts.push(text.slice(start, at));
            start = at + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/// The index after the `(…)` opening at `open`.
function closing(source: string, open: number): number {
    let depth = 0;
    for (let at = open; at < source.length; at++) {
        if (source[at] === '(') {
            depth++;
        } else if (source[at] === ')' && --depth === 0) {
            return at + 1;
        }
    }
    return source.length;
}

/// `source` with its comments and string literals' contents blanked (the
/// `cfg`s' own strings kept), so braces and `cfg`s in them aren't read.
function code(source: string): string {
    return source
        .replace(/\/\/[^\n]*/g, (comment) => ' '.repeat(comment.length))
        .replace(/"(?:[^"\\\n]|\\.)*"/g, (literal, at: number) =>
            /feature\s*=\s*$/.test(source.slice(Math.max(0, at - 12), at)) ? literal : `"${' '.repeat(literal.length - 2)}"`,
        );
}

interface Gate {
    /// The feature sets that turn the gated code on.
    sets: string[][];
    /// Where the gated code starts (its attribute) and ends.
    start: number;
    end: number;
}

/// Where each pair of features is needed at once: `a+b` (in the
/// manifest's order) → the places, `file:line`.
function gatedPairs(order: string[], turnsOn: Map<string, string[]>): Map<string, string[]> {
    const pairs = new Map<string, string[]>();
    const note = (sets: string[][], place: string) => {
        for (const set of sets) {
            // Exactly two, a feature another turns on aside: code that
            // needs three runs in no pair's build.
            const on = order.filter((feature) => set.includes(feature) && !set.some((other) => turnsOn.get(other)!.includes(feature)));
            if (on.length === 2) {
                const key = `${on[0]}+${on[1]}`;
                pairs.set(key, [...(pairs.get(key) ?? []), place]);
            }
        }
    };
    /// A file's code under `outer` (its `mod` line's gates, and its
    /// parents'), and the files of the modules it declares.
    const read = (file: string, outer: string[][]) => {
        const source = code(readFileSync(file, 'utf8'));
        const gates: Gate[] = [];
        const within = (at: number) => {
            let sets = outer;
            for (const gate of gates.filter((gate) => gate.start <= at && at < gate.end)) {
                sets = sets.flatMap((set) => gate.sets.map((more) => [...new Set([...set, ...more])]));
            }
            return sets;
        };
        const cfg = /#!?\[\s*cfg(_attr)?\s*\(|\bcfg!\s*\(/g;
        for (let match = cfg.exec(source); match; match = cfg.exec(source)) {
            const open = match.index + match[0].length - 1;
            const close = closing(source, open);
            const inner = source.slice(open + 1, close - 1);
            // `cfg_attr`'s first argument is its condition.
            const sets = alternatives(match[1] ? (split(inner)[0] ?? '') : inner);
            const together = within(match.index).flatMap((set) => sets.map((more) => [...new Set([...set, ...more])]));
            const line = source.slice(0, match.index).split('\n').length;
            note(together, `${relative(componentDir, file)}:${line}`);
            if (match[1] || match[0].startsWith('cfg') || /^\bcfg!/.test(match[0])) {
                continue;
            }
            // An inner attribute gates the rest of its file.
            if (match[0].startsWith('#!')) {
                gates.push({ sets, start: match.index, end: source.length });
                continue;
            }
            // The item the attribute is on: past its other attributes, to
            // its `;` or `,`, or the end of its first `{…}` (a match arm's
            // body, not its pattern's braces). In a signature or a field,
            // a `<…>` before the first `{` is generics, whose commas end
            // nothing; in a statement or an arm, `<` compares.
            let at = source.indexOf(']', close) + 1;
            for (;;) {
                const rest = /^\s*#\[/.exec(source.slice(at));
                if (!rest) {
                    break;
                }
                let depth = 0;
                at += rest[0].length - 1;
                for (; at < source.length; at++) {
                    if (source[at] === '[') {
                        depth++;
                    } else if (source[at] === ']' && --depth === 0) {
                        at++;
                        break;
                    }
                }
            }
            const typed = /^\s*(?:pub(?:\([a-z]+\))?\s+)?(?:(?:fn|impl|struct|enum|type|trait|const|static|unsafe|async)\b|[a-z_0-9]+\s*:[^:])/.test(
                source.slice(at),
            );
            let depth = 0;
            let angles = 0;
            let braced = !typed;
            let end = source.length;
            for (; at < source.length; at++) {
                const char = source[at];
                if (char === '{' || char === '(' || char === '[') {
                    depth++;
                    braced ||= char === '{';
                } else if (char === '}' || char === ')' || char === ']') {
                    if (--depth < 0) {
                        end = at;
                        break;
                    }
                    if (depth === 0 && char === '}' && !/^\s*(=>|if\b|\|)/.test(source.slice(at + 1))) {
                        end = at + 1;
                        break;
                    }
                } else if (char === '<' && !braced && depth === 0) {
                    angles++;
                } else if (char === '>' && !braced && depth === 0 && angles > 0 && source[at - 1] !== '-' && source[at - 1] !== '=') {
                    angles--;
                } else if ((char === ';' || char === ',') && depth === 0 && angles === 0) {
                    end = at + 1;
                    break;
                }
            }
            gates.push({ sets, start: match.index, end });
        }
        // Its modules in files of their own, each under the gates its `mod`
        // line stands in (its own attribute's among them).
        const module = /(?:^|\n)[ \t]*(?:pub(?:\([a-z]+\))?\s+)?mod\s+([a-z_0-9]+)\s*;/g;
        for (let match = module.exec(source); match; match = module.exec(source)) {
            const stem = file.replace(/\.rs$/, '');
            const parent = /(?:lib|main|mod)\.rs$/.test(file) ? dirname(file) : stem;
            for (const child of [join(parent, `${match[1]}.rs`), join(parent, match[1]!, 'mod.rs')]) {
                if (existsSync(child) && !seen.has(child)) {
                    seen.add(child);
                    read(child, within(match.index + match[0].length - 1));
                }
            }
        }
    };
    const seen = new Set<string>();
    const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
            const path = join(dir, name);
            return statSync(path).isDirectory() ? walk(path) : path.endsWith('.rs') ? [path] : [];
        });
    for (const crate of ['src', 'bridge/src', 'host/crate/src']) {
        // Each crate from its root, down its `mod` lines, so a file is read
        // once, under its module's gates; then whatever no `mod` line named.
        const files = [join(componentDir, crate, 'lib.rs'), ...walk(join(componentDir, crate))];
        for (const file of files) {
            if (!seen.has(file)) {
                seen.add(file);
                read(file, [[]]);
            }
        }
    }
    return pairs;
}

function run(what: string, args: string[], env: Record<string, string> = {}): boolean {
    const started = Date.now();
    const result = spawnSync('cargo', args, {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
        env: { ...process.env, ...env },
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (result.status === 0) {
        console.log(`  ok    ${what} (${seconds} s)`);
        return true;
    }
    console.log(`  FAIL  ${what} (${seconds} s)\n${result.stdout}\n${result.stderr}`);
    console.log(`  cargo ${args.join(' ')}`);
    return false;
}

const args = process.argv.slice(2);
const fail = (message: string): never => {
    console.error(`pairs: ${message}`);
    process.exit(2);
};
for (const [index, arg] of args.entries()) {
    const value = ['--only', '--from'].includes(args[index - 1] ?? '');
    if (!value && !['--list', '--only', '--from'].includes(arg)) {
        fail(`unknown argument ${arg}`);
    }
}
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
if (args.includes('--only') && only !== 'clippy' && only !== 'test' && only !== 'doc') {
    fail(`--only takes clippy, test, or doc, not ${only}`);
}
const from = args.includes('--from') ? Number(args[args.indexOf('--from') + 1]) : 1;
if (!Number.isInteger(from) || from < 1) {
    fail('--from takes the number of a build, from 1');
}
// A build's number is its part's: one part must be named.
if (from > 1 && only === undefined) {
    fail('--from needs --only clippy, test, or doc');
}

const turnsOn = features();
const order = [...turnsOn.keys()];
const implies = (a: string, b: string) => turnsOn.get(a)!.includes(b) || turnsOn.get(b)!.includes(a);
const sets: string[][] = order.map((feature) => [feature]);
let same = 0;
for (let a = 0; a < order.length; a++) {
    for (let b = a + 1; b < order.length; b++) {
        if (implies(order[a]!, order[b]!)) {
            same++;
        } else {
            sets.push([order[a]!, order[b]!]);
        }
    }
}
const gated = gatedPairs(order, turnsOn);
const tested = [...gated.keys()].map((key) => key.split('+')).filter(([a, b]) => !implies(a!, b!));
const pairCount = sets.length - order.length + same;
console.log(
    `${order.length} features, ${pairCount} pairs (${same} a single's build: one feature turns on the other); ` +
        `${tested.length} pairs with code gated on both`,
);

if (args.includes('--list')) {
    for (const pair of tested) {
        const places = gated.get(pair.join('+'))!;
        console.log(`  ${pair.join(' + ')}: ${places.length} (${places.slice(0, 3).join(', ')}${places.length > 3 ? ', …' : ''})`);
    }
    process.exit(0);
}

const hostFeatures = (set: string[]) => set.map((feature) => `tall-table-host/${feature}`).join(',');
const started = Date.now();
let failed = 0;
if (only === undefined || only === 'clippy') {
    console.log(`clippy, wasm32, the table, the bridge, and the host: ${sets.length} builds`);
    for (const [index, set] of sets.entries()) {
        if (index + 1 < from) {
            continue;
        }
        const packages = ['-p', 'tall-table-host', '-p', 'tall-table-bridge', '-p', 'seiza-tall-table'];
        const target = ['--target', 'wasm32-unknown-unknown', '--features', hostFeatures(set)];
        if (!run(`${index + 1}/${sets.length} ${set.join(' + ')}`, ['clippy', ...packages, ...target, '--', '-D', 'warnings'])) {
            failed++;
        }
    }
}
if (only === undefined || only === 'test') {
    console.log(`the native tests, the pairs with code gated on both: ${tested.length} builds`);
    for (const [index, pair] of tested.entries()) {
        if (index + 1 < from) {
            continue;
        }
        const packages = ['-p', 'seiza-tall-table', '-p', 'tall-table-host'];
        if (!run(`${index + 1}/${tested.length} ${pair.join(' + ')}`, ['test', ...packages, '--features', hostFeatures(pair)])) {
            failed++;
        }
    }
}
if (only === undefined || only === 'doc') {
    console.log(`rustdoc, the table, links checked: ${sets.length} builds`);
    for (const [index, set] of sets.entries()) {
        if (index + 1 < from) {
            continue;
        }
        const doc = ['doc', '-p', 'seiza-tall-table', '--no-deps', '--features', set.join(',')];
        if (!run(`${index + 1}/${sets.length} ${set.join(' + ')}`, doc, { RUSTDOCFLAGS: '-D warnings' })) {
            failed++;
        }
    }
}
console.log(`${failed === 0 ? 'passed' : `${failed} failed`} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
process.exit(failed === 0 ? 0 : 1);
