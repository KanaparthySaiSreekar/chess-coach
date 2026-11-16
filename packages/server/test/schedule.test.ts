import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { anyToMove, describeMove, parsePosition, type Puzzle, type PuzzleView } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { Db } from '../src/db.ts';
import type { FactService } from '../src/facts-service.ts';
import { PuzzleController, loadPuzzleWords } from '../src/puzzles.ts';

// PLAN WP 6.5, in the player: answers make cards, a puzzle comes back when it is due, new puzzles
// come a few a day, and the day's reviews never pass the cap.
const DAY = 24 * 60 * 60 * 1000;
const MATE: Puzzle = { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solution: ['Rd8#'], themes: ['backRankMate'], kind: 'mistake' };

function setup(opts: { newPerDay?: number; reviewCap?: number } = {}) {
  const db = new Db(':memory:');
  // the real clock: answers are stamped with it, so "the next day" must be the real one's
  let now = new Date();
  let view!: PuzzleView;
  const player = new PuzzleController({
    db,
    facts: { checkMove: async () => ({ legal: false, reason: '', legalMoves: [] }) } as unknown as FactService,
    words: loadPuzzleWords(path.join(config.repoRoot, 'coach', 'templates', 'puzzle.json')),
    maxMisses: () => 2,
    guard: () => null,
    onChange: () => (view = player.view),
    schedule: () => ({ newPerDay: opts.newPerDay ?? 10, reviewCap: opts.reviewCap ?? 30, maxDays: 180, afterNudge: 'hard' }),
    now: () => now,
    noDelay: true,
  });
  // puzzles from the owner's games, live (the gates have their own tests)
  const add = (n: number) => db.saveContent(`game:${n}#9|mistake`, { type: 'puzzle_game', status: 'live', source: `game:${n}#9`, licence: 'own', level: '400–700', gates: [], body: MATE });
  const solve = () => {
    const pos = parsePosition(view.fen)!;
    const info = describeMove(pos, anyToMove(pos, 'Rd8#')!);
    return player.move(info.from, info.to);
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return { db, player, add, solve, settle, view: () => view, at: (d: Date) => (now = d), now: () => now };
}

describe('the schedule in the puzzle player', () => {
  it('a solved puzzle comes back later; a missed one comes back the next day', async () => {
    const t = setup();
    const a = t.add(1);
    const b = t.add(2);
    await t.player.choose({ kind: 'games' });
    expect(t.view().id).toBe(a);
    t.solve();
    await t.settle();
    const solvedDue = Date.parse(t.db.getCard(a)!.dueAt);
    expect(solvedDue - t.now().getTime()).toBeGreaterThan(2 * DAY);
    expect(t.view().comesBack).toBe(t.db.getCard(a)!.dueAt);
    await t.player.next();
    expect(t.view().id).toBe(b);
    t.player.showAnswer();
    await t.settle();
    expect(Date.parse(t.db.getCard(b)!.dueAt) - t.now().getTime()).toBe(DAY);
    // nothing is due today; tomorrow the missed one is, and the solved one is not
    expect(t.view().due).toBe(0);
    t.at(new Date(t.now().getTime() + DAY + 60_000));
    await t.player.open();
    expect(t.view()).toMatchObject({ set: { kind: 'due' }, id: b, due: 1, status: 'solving' });
    t.solve();
    await t.settle();
    // just after a miss, FSRS keeps the next gap short: a day at least
    expect(Date.parse(t.db.getCard(b)!.dueAt)).toBeGreaterThanOrEqual(t.now().getTime() + DAY);
    // a second go is kept apart and does not move the card
    const card = t.db.getCard(b)!.dueAt;
    await t.player.retry();
    t.solve();
    await t.settle();
    expect(t.db.getCard(b)!.dueAt).toBe(card);
    await t.player.next();
    expect(t.view()).toMatchObject({ status: 'idle', problem: 'Nothing is due again today.' });
  });

  it('new puzzles from the games come a few a day', async () => {
    const t = setup({ newPerDay: 2 });
    for (let n = 1; n <= 4; n++) t.add(n);
    await t.player.choose({ kind: 'games' });
    t.solve();
    await t.player.next();
    t.solve();
    await t.player.next();
    expect(t.view()).toMatchObject({ status: 'idle', problem: expect.stringMatching(/^That is today's 2 new puzzles from your games/) });
    expect(t.view().fresh).toBe(2);
    // the next day, two more
    t.at(new Date(t.now().getTime() + DAY));
    await t.player.choose({ kind: 'games' });
    expect(t.view().status).toBe('solving');
  });

  it('the day\'s reviews never pass the cap: the rest move to the following days', async () => {
    const t = setup({ reviewCap: 3 });
    const ids = Array.from({ length: 8 }, (_, i) => t.add(i + 1));
    // all eight answered wrongly once: all due tomorrow
    for (const id of ids) {
      t.player.start(id);
      t.player.showAnswer();
      await t.settle();
    }
    t.at(new Date(t.now().getTime() + DAY + 60_000));
    await t.player.open();
    expect(t.view().due).toBe(3);
    const due = t.db.dueCards(t.now().toISOString());
    expect(due).toHaveLength(3);
    // the other five are spread over the next two days, three and two
    const later = ids.filter((id) => !due.some((d) => d.id === id)).map((id) => t.db.getCard(id)!.dueAt.slice(0, 10));
    expect(later).toHaveLength(5);
    expect(new Set(later).size).toBe(2);
    expect(later.every((d) => Date.parse(d) > Date.parse(t.now().toISOString().slice(0, 10)))).toBe(true);
  });
});

