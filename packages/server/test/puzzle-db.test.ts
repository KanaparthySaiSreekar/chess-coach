import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DRAW_BELOW, practiceLevel, scoreOf, themeName, type PuzzleView } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { ContentService } from '../src/content.ts';
import { PuzzleDb, installPuzzles } from '../src/datasets/puzzle-db.ts';
import { Db } from '../src/db.ts';
import type { EngineService } from '../src/engine/service.ts';
import type { FactService } from '../src/facts-service.ts';
import { PuzzleController, loadPuzzleWords } from '../src/puzzles.ts';
import { compileLadder, type ConceptLadderFile } from '@chess-coach/core';

// PLAN WP 6.4: themed sets from the Lichess puzzle database. A theme query is quick, and the
// difficulty of a set follows the results. The database here is built from the fixed sample of
// the real one that the motif tests use (645 puzzles); the real file is measured when it is installed.
const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(path.join(here, '..', '..', 'core', 'test', 'fixtures', 'puzzles', 'sample.json'), 'utf8')) as { pool: Row[]; tagged: Record<string, Row[]> };
type Row = { id: string; fen: string; moves: string[]; rating: number; themes: string[] };

describe('the practice level', () => {
  it('goes up with puzzles solved alone, a little with help, and down with answers shown', () => {
    expect(practiceLevel([], 700)).toBe(700);
    const up = practiceLevel(Array.from({ length: 5 }, () => ({ rating: 650, score: 1 })), 700);
    const helped = practiceLevel(Array.from({ length: 5 }, () => ({ rating: 650, score: 0.6 })), 700);
    const down = practiceLevel(Array.from({ length: 5 }, () => ({ rating: 650, score: 0 })), 700);
    expect(up).toBeGreaterThan(helped);
    expect(helped).toBeGreaterThanOrEqual(700);
    expect(down).toBeLessThan(700);
    // a puzzle far above the level, failed, costs little; one far below, failed, costs a lot
    expect(practiceLevel([{ rating: 1500, score: 0 }], 700)).toBeGreaterThan(practiceLevel([{ rating: 400, score: 0 }], 700));
    // bounded
    expect(practiceLevel(Array.from({ length: 200 }, () => ({ rating: 400, score: 0 })), 700)).toBe(400);
  });

  it('scores an answer by how it went', () => {
    expect(scoreOf({ result: 'solved', hints: 0, misses: 0 })).toBe(1);
    expect(scoreOf({ result: 'solved', hints: 1, misses: 0 })).toBe(0.6);
    expect(scoreOf({ result: 'shown', hints: 0, misses: 0 })).toBe(0);
    expect(['fork', 'kingsideAttack', 'mateIn2', 'xRayAttack'].map(themeName)).toEqual(['Fork', 'Kingside attack', 'Mate in 2', 'X-ray attack']);
  });
});

describe('themed sets from the puzzle database', () => {
  let dir: string;
  let db: Db;
  let puzzleDb: PuzzleDb;
  let player: PuzzleController;
  let view: PuzzleView;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-pdb-'));
    const rows = new Map<string, Row>();
    for (const r of [...sample.pool, ...Object.values(sample.tagged).flat()]) rows.set(r.id, r);
    const csv = ['PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags', ...[...rows.values()].map((r) => [r.id, r.fen, r.moves.join(' '), r.rating, 80, 90, 500, r.themes.join(' '), 'https://lichess.org/x', ''].join(','))].join('\n');
    writeFileSync(path.join(dir, 'sample.csv'), csv);
    const installed = installPuzzles(path.join(dir, 'sample.csv'), path.join(dir, 'puzzles.sqlite'));
    expect(installed).toMatchObject({ rows: rows.size, kept: rows.size });
    puzzleDb = PuzzleDb.open(path.join(dir, 'puzzles.sqlite'))!;
    db = new Db(':memory:');
    const ladder = compileLadder(JSON.parse(readFileSync(config.ladderFile, 'utf8')) as ConceptLadderFile);
    // database puzzles go through gates V1 and V6 only: no engine is needed here
    const content = new ContentService({ db, engine: {} as EngineService, facts: {} as FactService, ladder, dataDir: dir, dbFile: ':memory:', options: () => ({ nodes: 0, vocabulary: 'core', autoApprove: true }) });
    player = new PuzzleController({
      db,
      facts: { checkMove: async () => ({ legal: false, reason: '', legalMoves: [] }) } as unknown as FactService,
      words: loadPuzzleWords(path.join(config.repoRoot, 'coach', 'templates', 'puzzle.json')),
      maxMisses: () => 2,
      guard: () => null,
      onChange: () => (view = player.view),
      content,
      puzzleDb: () => puzzleDb,
      startLevel: () => 900,
      noDelay: true,
    });
  });
  afterAll(() => {
    puzzleDb.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a theme near a rating is one quick query, the nearest first, never a puzzle twice', () => {
    const t0 = performance.now();
    const forks = puzzleDb.near({ theme: 'fork', rating: 900, count: 8 });
    expect(performance.now() - t0).toBeLessThan(100);
    expect(forks).toHaveLength(8);
    expect(forks.every((p) => p.themes.includes('fork'))).toBe(true);
    const gaps = forks.map((p) => Math.abs(p.rating - 900));
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
    const next = puzzleDb.near({ theme: 'fork', rating: 900, count: 8, exclude: new Set(forks.map((p) => p.id)) });
    expect(next.some((p) => forks.some((f) => f.id === p.id))).toBe(false);
    expect(puzzleDb.near({ theme: 'noSuchTheme', rating: 900, count: 3 })).toEqual([]);
    expect(puzzleDb.near({ rating: 900, count: 3 })).toHaveLength(3);
    // the themes on offer leave out the tags that only say how long a puzzle is
    const themes = puzzleDb.themesNear(900).map((t) => t.theme);
    expect(themes).toContain('fork');
    expect(themes).not.toContain('short');
  });

  it('a themed set: the theme is named, the puzzle is near the level, it went through the gates', async () => {
    expect(view?.catalogue ?? player.view.catalogue).toBeTruthy();
    expect(player.view.level).toBe(900);
    const r = await player.choose({ kind: 'theme', theme: 'fork' });
    expect(r).toEqual({ ok: true });
    expect(view).toMatchObject({ status: 'solving', set: { kind: 'theme', theme: 'fork' }, task: 'Fork. Find the best move.', from: expect.stringMatching(/^From the Lichess puzzle database, rated \d+$/) });
    const item = db.getContent(view.id!)!;
    expect(item).toMatchObject({ type: 'puzzle_db', status: 'live', licence: 'cc0', source: expect.stringMatching(/^puzzle:/) });
    expect(item.gates.map((g) => [g.gate, g.result])).toEqual([
      ['V1', 'pass'],
      ['V6', 'pass'],
    ]);
    expect(item.body.themes).toContain('fork');
    expect(Math.abs(item.body.rating! - (900 - DRAW_BELOW))).toBeLessThan(150);
  });

  it('the level follows the results: solved alone it rises, shown it falls, and a set never repeats a puzzle', async () => {
    const solve = () => {
      // play the solution: the replies come by themselves
      const item = db.getContent(view.id!)!;
      for (let i = 0; i < item.body.solution.length; i += 2) {
        const pos = view.fen;
        const move = item.body.solution[i]!;
        // the player takes moves by their squares; find them from the position on the board
        const sq = squaresOf(pos, move);
        expect(player.move(sq.from, sq.to, sq.promotion).ok).toBe(true);
      }
    };
    // the set-up move has been played already (no delay in tests)
    const first = view.id!;
    solve();
    expect(view.status).toBe('solved');
    const after1 = player.level();
    expect(after1).toBeGreaterThan(900);
    await player.next();
    expect(view.id).not.toBe(first);
    player.showAnswer();
    expect(view.status).toBe('shown');
    expect(player.level()).toBeLessThan(after1);
    // a mixed set does not name the theme
    await player.choose({ kind: 'mixed' });
    expect(view).toMatchObject({ status: 'solving', set: { kind: 'mixed' }, task: 'Find the best move.' });
    expect(view.themes).toBeUndefined();
    const drawn = db.drawnPuzzleIds();
    expect(drawn.size).toBe(3);
    // back to the owner's games: there are none, and the screen says so
    await player.choose({ kind: 'games' });
    expect(view).toMatchObject({ status: 'idle', set: { kind: 'games' }, problem: expect.stringMatching(/made from your own games/) });
  });
});

// the real database, when it is installed: the query the app makes most stays quick
const real = path.join(config.dataDir, 'datasets', 'puzzles', 'puzzles.sqlite');
describe.skipIf(!PuzzleDb.open(real))('the installed Lichess puzzle database', () => {
  it('answers a theme near a rating in under 100 ms', () => {
    const pdb = PuzzleDb.open(real)!;
    for (const [theme, rating] of [['fork', 900], ['backRankMate', 700], ['hangingPiece', 600], ['skewer', 1200]] as const) {
      const t0 = performance.now();
      const got = pdb.near({ theme, rating, count: 5, minPopularity: 50 });
      expect(performance.now() - t0).toBeLessThan(100);
      expect(got).toHaveLength(5);
    }
    const t1 = performance.now();
    expect(pdb.themesNear(800).length).toBeGreaterThan(20);
    expect(performance.now() - t1).toBeLessThan(100);
    pdb.close();
  });
});

import { anyToMove, describeMove, parsePosition } from '@chess-coach/core';
function squaresOf(fen: string, move: string): { from: string; to: string; promotion?: 'queen' | 'rook' | 'bishop' | 'knight' } {
  const pos = parsePosition(fen)!;
  const m = anyToMove(pos, move)!;
  const info = describeMove(pos, m);
  return { from: info.from, to: info.uci.slice(2, 4), promotion: info.promotion as 'queen' | undefined };
}
