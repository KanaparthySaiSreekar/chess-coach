// Installs a downloaded dataset into the local database (CONTENT §12; feature J6).
//
//   npm run content:install -- puzzles             the Lichess puzzle CSV → data/datasets/puzzles/puzzles.sqlite
//   npm run content:install -- puzzles --min-plays 100   leave out puzzles few people have played
//
// The CSV stays where Phase 1 put it (data/datasets/puzzles/lichess_db_puzzle.csv.zst); the
// SQLite file is built beside it and can be rebuilt from it at any time. Both are gitignored.
// The openings list needs no installing: the app reads it as it is.

import path from 'node:path';
import { config } from '../packages/server/src/config.ts';
import { PuzzleDb, installPuzzles } from '../packages/server/src/datasets/puzzle-db.ts';

const args = process.argv.slice(2);
const what = args.find((a) => !a.startsWith('--'));
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (what !== 'puzzles') {
  console.error(`usage: npm run content:install -- puzzles [--min-plays N]${what === 'openings' ? '\n(the openings list needs no installing: the app reads data/datasets/openings as it is)' : ''}`);
  process.exit(1);
}
const dir = path.join(config.dataDir, 'datasets', 'puzzles');
const source = flag('from') ?? path.join(dir, 'lichess_db_puzzle.csv.zst');
const target = path.join(dir, 'puzzles.sqlite');
const t0 = Date.now();
console.log(`installing ${source}\n      into ${target}`);
const r = installPuzzles(source, target, {
  minPlays: Number(flag('min-plays') ?? 0) || undefined,
  onProgress: (rows) => process.stdout.write(`\r  ${rows.toLocaleString('en-US')} rows`),
});
console.log(`\r  ${r.rows.toLocaleString('en-US')} rows read, ${r.kept.toLocaleString('en-US')} kept, ${r.themes} themes, in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
// the query the app makes most: a theme near a rating
const db = PuzzleDb.open(target)!;
for (const [theme, rating] of [['fork', 900], ['backRankMate', 700], ['hangingPiece', 600], [undefined, 1000]] as const) {
  const q0 = performance.now();
  const got = db.near({ theme, rating, count: 10 });
  console.log(`  ${(theme ?? 'any theme').padEnd(13)} near ${rating}: ${got.length} puzzles (${got.map((p) => p.rating).join(', ')}) in ${(performance.now() - q0).toFixed(1)} ms`);
}
const q1 = performance.now();
const themes = db.themesNear(800);
console.log(`  themes near 800: ${themes.length} (${themes.slice(0, 6).map((t) => `${t.theme} ${t.count}`).join(', ')}, …) in ${(performance.now() - q1).toFixed(1)} ms`);
db.close();
