// The pre-commit guard (PLAN, WP 3.1 and 10.6): refuses a commit that contains the owner's data,
// course files or secrets, even when they were added with `git add -f`.
//
// The copyright rule is a hard rule (CLAUDE.md): purchased course files and books are never
// committed. `.gitignore` keeps them out by default; this stops a forced add.
//
// Run by tools/git-hooks/pre-commit. `npm install` points git at that folder (the "prepare" script).

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES = [
  { test: /^data\//, why: "the owner's data (games, progress, datasets, course files)" },
  { test: /(^|\/)courses\//, why: 'course files and books (copyright: never committed)' },
  { test: /(^|\/)\.env(\.[^/]*)?$/, why: 'secrets (the Lichess token lives in .env)' },
  { test: /\.(cbh|cbv|cbg|cba|cbf)$/i, why: 'a ChessBase file (purchased material)' },
  { test: /\.sqlite(-shm|-wal)?$/i, why: "a database file (the owner's data)" },
];

/** The staged paths that must not be committed, each with the reason. `.env.example` is allowed. */
export function blocked(paths) {
  const out = [];
  for (const raw of paths) {
    const p = raw.replaceAll('\\', '/').replace(/^\.\//, '');
    if (/(^|\/)\.env\.example$/.test(p)) continue;
    const rule = RULES.find((r) => r.test.test(p));
    if (rule) out.push({ path: p, why: rule.why });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // added, copied, modified or renamed files in the index; -z keeps odd file names intact
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const bad = blocked(staged);
  if (bad.length) {
    console.error('Commit refused: these files must stay out of git.');
    for (const b of bad) console.error(`  ${b.path}: ${b.why}`);
    console.error('Take them out of the commit with: git restore --staged <file>');
    process.exit(1);
  }
}
