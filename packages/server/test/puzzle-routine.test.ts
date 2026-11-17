// The thinking routine in the drills (A9; PLAN WP 7.5's open item): before the owner's first move of a
// puzzle, the routine's question, as often as the games' overlay asks it; gone once they have moved.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTINE_PROMPTS, anyToMove, describeMove, parsePosition, type Puzzle, type PuzzleView, type RoutineLevel } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { Db } from '../src/db.ts';
import type { FactService } from '../src/facts-service.ts';
import { PuzzleController, loadPuzzleWords } from '../src/puzzles.ts';

const MATE: Puzzle = { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solution: ['Rd8#'], themes: ['backRankMate'], kind: 'mistake' };

function setup(level: RoutineLevel) {
  const db = new Db(':memory:');
  let view!: PuzzleView;
  const player = new PuzzleController({
    db,
    facts: { checkMove: async () => ({ legal: false, reason: '', legalMoves: [] }) } as unknown as FactService,
    words: loadPuzzleWords(path.join(config.repoRoot, 'coach', 'templates', 'puzzle.json')),
    maxMisses: () => 2,
    guard: () => null,
    onChange: () => (view = player.view),
    routine: () => ({ level, top: 'no_safety_check' }),
    noDelay: true,
  });
  for (let n = 1; n <= 4; n++) db.saveContent(`game:${n}#9|mistake`, { type: 'puzzle_game', status: 'live', source: `game:${n}#9`, licence: 'own', level: '400–700', gates: [], body: MATE });
  return { player, view: () => view };
}

describe('the thinking routine before a puzzle (A9 in the drills)', () => {
  it('asks before the first move, works on the habit the owner skips, and says nothing once they have moved', async () => {
    const t = setup('every');
    await t.player.choose({ kind: 'games' });
    const asked = t.view().routine;
    expect(Object.values(ROUTINE_PROMPTS)).toContain(asked);
    const pos = parsePosition(t.view().fen)!;
    const info = describeMove(pos, anyToMove(pos, 'h3')!);
    t.player.move(info.from, info.to); // a miss: a move of the owner's has been made
    expect(t.view().routine).toBeUndefined();
    // the habit the owner skips most comes up every other puzzle: over two puzzles, the blunder check is asked
    await t.player.next();
    expect([asked, t.view().routine]).toContain(ROUTINE_PROMPTS.blunder);
  });

  it('is not asked when the overlay is off', async () => {
    const t = setup('off');
    await t.player.choose({ kind: 'games' });
    expect(t.view().status).toBe('solving');
    expect(t.view().routine).toBeUndefined();
  });
});
