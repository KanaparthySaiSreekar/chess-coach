// Takes a fixed sample out of the Lichess puzzle database (CC0) for the motif detectors' test
// (PLAN WP 4.2: agreement with the database's own tags on 50 sampled puzzles per theme).
//
//   node tools/sample-puzzles.ts            writes packages/core/test/fixtures/puzzles/sample.json
//
// For each theme: the first 50 puzzles tagged with it, taking every 97th row of the file so the
// sample is spread over it. Plus a pool of 300 puzzles taken the same way whatever their tags,
// from which the test draws puzzles that do NOT have a theme. The file is read as a stream; it
// is never unpacked to disk (packages/server/src/datasets/zst-lines.ts).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstLines } from '../packages/server/src/datasets/zst-lines.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'data', 'datasets', 'puzzles', 'lichess_db_puzzle.csv.zst');
const out = path.join(root, 'packages', 'core', 'test', 'fixtures', 'puzzles', 'sample.json');

const THEMES = ['fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'backRankMate', 'hangingPiece', 'capturingDefender', 'trappedPiece', 'mateIn1', 'mateIn2'];
const PER_THEME = 50;
const POOL = 300;
const STRIDE = 97;

type Row = { id: string; fen: string; moves: string[]; rating: number; themes: string[] };
const tagged: Record<string, Row[]> = Object.fromEntries(THEMES.map((t) => [t, []]));
const pool: Row[] = [];

let n = 0;
let header: string[] | null = null;
for (const line of zstLines(source)) {
  if (!header) {
    header = line.split(',');
    continue;
  }
  if (n++ % STRIDE !== 0) continue;
  // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags[,DailyDate]: no quoted commas in the first eight
  const c = line.split(',');
  const row: Row = { id: c[0]!, fen: c[1]!, moves: c[2]!.split(' '), rating: Number(c[3]), themes: c[7]!.split(' ') };
  if (pool.length < POOL) pool.push(row);
  let wanted = pool.length < POOL;
  for (const theme of THEMES) {
    if (tagged[theme]!.length < PER_THEME && row.themes.includes(theme)) tagged[theme]!.push(row);
    if (tagged[theme]!.length < PER_THEME) wanted = true;
  }
  if (!wanted) break;
}

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({
    source: 'database.lichess.org lichess_db_puzzle.csv.zst (CC0), as installed in Phase 1: 6,193,530 puzzles',
    how: `every ${STRIDE}th row, in file order: the first ${PER_THEME} puzzles tagged with each theme, and the first ${POOL} whatever their tags`,
    columns: header,
    tagged,
    pool,
  }),
);
console.log(`read ${n.toLocaleString('en-US')} rows; pool ${pool.length}; ${THEMES.map((t) => `${t} ${tagged[t]!.length}`).join(', ')}`);
process.exit(0);
