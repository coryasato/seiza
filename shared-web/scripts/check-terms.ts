// Fails if milestone vocabulary appears in a file that describes the current
// state (root CLAUDE.md, "Docs: one home per fact"). Milestone IDs (M<n>,
// "part <A-G>") belong only in planning and history files; code, CLAUDE.md,
// READMEs, justfiles, and budgets text say what a thing is, not which
// milestone built it.
//
// Usage: node shared-web/scripts/check-terms.ts   (from anywhere in the repo)
// Checks every tracked file of these kinds: *.rs, *.ts, *.sql, *.toml, *.py,
// *.html, *.css, justfiles, CLAUDE.md, README.md, apps/<app>/perf/
// budgets.json, and the reference docs in apps/<app>/docs/ (data.md, …). Skips docs/templates/ (their M<n> placeholders are on purpose)
// and apps/<app>/docs/private/. PLAN.md, milestones.md, LESSONS.md,
// DECISIONS.md, and perf/results/ are never checked: they are history.
// Exceptions: CPU names ("Apple M1") and SVG path data (d="M12 2v2").
// Prints each hit as file:line: text and exits 1.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const CODE_EXTENSIONS = new Set(['.rs', '.ts', '.sql', '.toml', '.py', '.html', '.css']);
/** An app's docs/ files that are history or planning; the rest are reference docs. */
const HISTORY_DOCS = new Set(['milestones.md', 'LESSONS.md', 'DECISIONS.md']);
const SKIPPED = [/(^|\/)docs\/templates\//, /(^|\/)docs\/private\//, /(^|\/)node_modules\//];

function isChecked(file: string): boolean {
  if (SKIPPED.some((pattern) => pattern.test(file))) return false;
  const name = basename(file);
  if (name === 'CLAUDE.md' || name === 'README.md') return true;
  if (/^apps\/[^/]+\/perf\/budgets\.json$/.test(file)) return true;
  if (/^apps\/[^/]+\/docs\/[^/]+\.md$/.test(file)) return !HISTORY_DOCS.has(name);
  if (name === 'justfile' || name.endsWith('.justfile')) return true;
  return CODE_EXTENSIONS.has(extname(name));
}

const MILESTONE = /\bM\d+\b|\bpart [A-G]\b/;
// Text that looks like a milestone but isn't, removed before matching.
const EXCEPTIONS = [/\bApple M\d+\b/g, /\bd="[^"]*"/g];

const hits: string[] = [];
for (const file of files.filter(isChecked)) {
  let text: string;
  try {
    text = readFileSync(`${root}/${file}`, 'utf8');
  } catch {
    continue; // tracked but missing from the working tree
  }
  text.split('\n').forEach((line, index) => {
    let rest = line;
    for (const exception of EXCEPTIONS) rest = rest.replace(exception, '');
    if (MILESTONE.test(rest)) hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
  });
}

if (hits.length > 0) {
  console.error(hits.join('\n'));
  console.error(
    `\n${hits.length} milestone reference(s) outside the history files. ` +
      'Say what the thing is instead (root CLAUDE.md, "Docs: one home per fact").',
  );
  process.exit(1);
}
console.log('check-terms: no milestone references outside the history files');
