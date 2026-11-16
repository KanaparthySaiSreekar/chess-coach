import { describe, expect, it } from 'vitest';
import { START_FEN, findableByPeople, findableMove, type EngineLine } from '../src/index.ts';

// four opening moves the engine rates within a hair of each other, and one it does not
const lines: EngineLine[] = [
  { pv: ['e2e4'], score: { cp: 30 } },
  { pv: ['d2d4'], score: { cp: 28 } },
  { pv: ['g1f3'], score: { cp: 26 } },
  { pv: ['a2a3'], score: { cp: -40 } },
];

describe('the findable move by people (WP 7.8, H12)', () => {
  it('teaches the close move players at the level play most often', () => {
    expect(findableByPeople(START_FEN, lines, new Map([['d2d4', 0.5], ['e2e4', 0.3]]))).toEqual({ move: 'd4', reason: 'likely' });
    expect(findableByPeople(START_FEN, lines, new Map([['e2e4', 0.6], ['d2d4', 0.3]]))).toEqual({ move: 'e4', reason: 'best' });
    // a move that is not about as good as the best is never taught, however often it is played
    expect(findableByPeople(START_FEN, lines, new Map([['a2a3', 0.9], ['g1f3', 0.05]]))).toEqual({ move: 'Nf3', reason: 'likely' });
    // nothing to go on: no answer, and the rule of thumb takes over
    expect(findableByPeople(START_FEN, lines, new Map())).toBeNull();
    expect(findableByPeople(START_FEN, lines, new Map([['a2a3', 1]]))).toBeNull();
    expect(findableMove(START_FEN, lines)).toEqual({ move: 'e4', reason: 'best' });
  });
});
