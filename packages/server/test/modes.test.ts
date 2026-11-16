import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anyToMove, compileLadder, describeMove, parsePosition, roundPace, speedRating, type ConceptLadderFile, type ContentItem, type Puzzle, type PuzzleView, type SpeedView } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { ContentService } from '../src/content.ts';
import { PuzzleDb, installPuzzles } from '../src/datasets/puzzle-db.ts';
import { Db } from '../src/db.ts';
import type { EngineService } from '../src/engine/service.ts';
import type { FactService } from '../src/facts-service.ts';
import { PuzzleController, loadPuzzleWords } from '../src/puzzles.ts';
import { SETTINGS } from '../src/settings.ts';
import { SpeedController } from '../src/speed.ts';

// PLAN WP 6.10: the optional modes. The switches work (off by default), and the coach stays silent
// in speed runs: the speed controller has no engine and no coach to call, and a run gives no hints.
const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(path.join(here, '..', '..', 'core', 'test', 'fixtures', 'puzzles', 'sample.json'), 'utf8')) as { pool: Row[]; tagged: Record<string, Row[]> };
type Row = { id: string; fen: string; moves: string[]; rating: number; themes: string[] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The squares of a move in a position, as the board sends them. */
function squares(fen: string, san: string): { from: string; to: string; promotion?: string } {
  const pos = parsePosition(fen)!;
  const info = describeMove(pos, anyToMove(pos, san)!);
  return { from: info.from, to: info.to, promotion: info.promotion };
}

describe('the optional modes', () => {
  let dir: string;
  let db: Db;
  let puzzleDb: PuzzleDb;
  let content: ContentService;
  let player: PuzzleController;
  let view: PuzzleView;
  const modes = { woodpecker: false, speed: false, woodpeckerSize: 5 };
  const speedRuns = (seconds: number) => {
    let v: SpeedView | undefined;
    const c: SpeedController = new SpeedController({ db, content, puzzleDb: () => puzzleDb, level: () => 900, enabled: () => modes.speed, seconds: () => seconds, guard: () => null, onChange: () => (v = c.view) });
    return { c, view: () => v ?? c.view, item: () => (c as unknown as { item: ContentItem<Puzzle> & { id: number } }).item };
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-modes-'));
    const rows = new Map<string, Row>();
    for (const r of [...sample.pool, ...Object.values(sample.tagged).flat()]) rows.set(r.id, r);
    const csv = ['PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags', ...[...rows.values()].map((r) => [r.id, r.fen, r.moves.join(' '), r.rating, 80, 90, 500, r.themes.join(' '), 'https://lichess.org/x', ''].join(','))].join('\n');
    writeFileSync(path.join(dir, 'sample.csv'), csv);
    installPuzzles(path.join(dir, 'sample.csv'), path.join(dir, 'puzzles.sqlite'));
    puzzleDb = PuzzleDb.open(path.join(dir, 'puzzles.sqlite'))!;
    db = new Db(':memory:');
    const ladder = compileLadder(JSON.parse(readFileSync(config.ladderFile, 'utf8')) as ConceptLadderFile);
    content = new ContentService({ db, engine: {} as EngineService, facts: {} as FactService, ladder, dataDir: dir, dbFile: ':memory:', options: () => ({ nodes: 0, vocabulary: 'core', autoApprove: true }) });
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
      modes: () => modes,
      noDelay: true,
    });
  });
  afterAll(() => {
    puzzleDb.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('both are off by default, with their reason given', () => {
    const def = (key: string) => SETTINGS.find((x) => x.key === key)!;
    for (const key of ['puzzles.woodpecker', 'puzzles.speedModes']) {
      expect(def(key).default).toBe(false);
      expect(def(key).why).toMatch(/at your level/i);
    }
    player.refresh();
    expect(view.modes).toEqual({ woodpecker: false, speed: false });
  });

  it('a streak: harder each time, silent, and over at the first wrong move; it moves neither the level nor the schedule', async () => {
    const run = speedRuns(180);
    // switched off, nothing starts
    expect(await run.c.start('streak')).toEqual({ ok: false, reason: 'Speed runs are off. They can be switched on in Settings, under Puzzles.' });
    modes.speed = true;
    const level = player.level();
    expect(await run.c.start('streak')).toEqual({ ok: true });
    expect(run.view()).toMatchObject({ status: 'running', mode: 'streak', yourTurn: true, solved: 0, silent: true });
    expect(run.c.active).toBe(true);
    const first = run.item();
    expect(Math.abs(first.body.rating! - speedRating('streak', 900, 0))).toBeLessThan(150);
    // solve it: the replies come at once
    for (let i = 0; i < first.body.solution.length; i += 2) {
      const sq = squares(run.view().fen, first.body.solution[i]!);
      run.c.move(sq.from, sq.to, sq.promotion);
    }
    await sleep(50);
    expect(run.view()).toMatchObject({ status: 'running', solved: 1, last: 'solved' });
    const second = run.item();
    expect(second.id).not.toBe(first.id);
    // a wrong move (any legal move that is not the solution) ends the run, with the answer played out
    const pos = parsePosition(run.view().fen)!;
    const wrong = [...pos.allDests()].flatMap(([f, ds]) => [...ds].map((t) => describeMove(pos, { from: f, to: t }))).find((m) => m.san.replace(/[+#]/g, '') !== second.body.solution[0]!.replace(/[+#]/g, ''))!;
    run.c.move(wrong.from, wrong.to);
    expect(run.view()).toMatchObject({ status: 'over', solved: 1, misses: 1, last: 'missed', best: { streak: 1 } });
    expect(run.view().log).toEqual([
      { rating: first.body.rating, solved: true },
      { rating: second.body.rating, solved: false, answer: second.body.solution[0] },
    ]);
    expect(run.c.active).toBe(false);
    // logged as second goes: the level and the schedule do not move
    expect(db.attemptsOf(first.id)).toMatchObject([{ result: 'solved', again: true }]);
    expect(db.attemptsOf(second.id)).toMatchObject([{ result: 'shown', again: true }]);
    expect(player.level()).toBe(level);
    expect(db.getCard(first.id)).toBeUndefined();
    run.c.close();
  });

  it('a timed run: a miss costs ten seconds, and the clock ends it', async () => {
    const long = speedRuns(60);
    await long.c.start('timed');
    const ends = Date.parse(long.view().endsAt!);
    const item = long.item();
    const pos = parsePosition(long.view().fen)!;
    const wrong = [...pos.allDests()].flatMap(([f, ds]) => [...ds].map((t) => describeMove(pos, { from: f, to: t }))).find((m) => m.san.replace(/[+#]/g, '') !== item.body.solution[0]!.replace(/[+#]/g, ''))!;
    long.c.move(wrong.from, wrong.to);
    await sleep(50);
    expect(long.view()).toMatchObject({ status: 'running', misses: 1, last: 'missed' });
    expect(ends - Date.parse(long.view().endsAt!)).toBe(10_000);
    // the next puzzle is on the board
    expect(long.item().id).not.toBe(item.id);
    long.c.stop();
    expect(long.view().status).toBe('over');

    const short = speedRuns(0.3);
    await short.c.start('timed');
    expect(short.view().status).toBe('running');
    await sleep(500);
    expect(short.view()).toMatchObject({ status: 'over', mode: 'timed' });
    expect(db.recentEvents('speed_run', 5).map((e) => JSON.parse(e.data).mode)).toEqual(['timed', 'timed', 'streak']);
  });

  it('Woodpecker: a set of puzzles already met, round after round; each round timed and compared with the last', async () => {
    await player.choose({ kind: 'woodpecker' });
    expect(view).toMatchObject({ status: 'idle', problem: 'Woodpecker rounds are off. They can be switched on in Settings, under Puzzles.' });
    modes.woodpecker = true;
    // the speed runs met two puzzles; five are needed
    await player.choose({ kind: 'woodpecker' });
    expect(view.problem).toBe('A Woodpecker set is made from puzzles you have met: solve at least five first.');
    await player.choose({ kind: 'theme', theme: 'fork' });
    for (let i = 0; i < 3; i++) {
      player.showAnswer();
      await player.next();
    }
    player.close();
    // round 1: the five met most recently, in the set's order; a second go, so the schedule stays
    await player.choose({ kind: 'woodpecker' });
    expect(view).toMatchObject({ status: 'solving', woodpecker: { size: 5, round: 1, done: 0, over: false } });
    const set = db.woodpeckerSet()!;
    expect(view.id).toBe(set.items[0]);
    for (let i = 0; i < 5; i++) {
      player.showAnswer();
      if (i < 4) await player.next();
    }
    expect(view.woodpecker).toMatchObject({ round: 1, done: 5, over: true });
    expect(view.woodpecker!.rounds[0]).toMatchObject({ round: 1, solved: 0, alone: 0, done: 5 });
    expect(view.woodpecker!.rounds[0]!.ms).toBeGreaterThanOrEqual(0);
    // the round is over: the next starts only when asked
    await player.next();
    expect(view).toMatchObject({ status: 'idle', problem: 'Round 1 is done.' });
    expect(player.woodpeckerRound()).toEqual({ ok: true });
    expect(view).toMatchObject({ status: 'solving', woodpecker: { round: 2, done: 0, over: false } });
    expect(view.id).toBe(set.items[0]);
    expect(db.attemptsOf(set.items[0]!).at(-1)).toMatchObject({ again: true });
    expect(roundPace([{ round: 1, ms: 100_000, solved: 3, alone: 2, done: 5 }, { round: 2, ms: 80_000, solved: 4, alone: 4, done: 5 }])).toBe(0.8);
    // switched off again, the set is put away
    modes.woodpecker = false;
    player.refresh();
    expect(view.modes).toEqual({ woodpecker: false, speed: true });
    player.close();
  });
});
