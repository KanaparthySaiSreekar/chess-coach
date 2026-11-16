import { describe, expect, it } from 'vitest';
import { GATES_FOR, gateV1Puzzle, gateV6, puzzleKey, quarantineReasons, solverStart, statusAfter, type ContentItem, type Puzzle } from '../src/index.ts';

const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
const puzzle = (over: Partial<Puzzle> = {}): Puzzle => ({ fen: BACK_RANK, solution: ['Rd8#'], themes: ['backRankMate', 'mateIn1'], kind: 'mistake', ...over });
const item = (over: Partial<ContentItem<Puzzle>> = {}): ContentItem<Puzzle> => ({ type: 'puzzle_game', status: 'draft', source: 'game:12#23', licence: 'own', level: '400–700', engine: 'Stockfish 19, 5M nodes', gates: [], body: puzzle(), ...over });

describe('gate V1 for a puzzle: legality', () => {
  it('passes a line that is legal from start to end and ends on the solver', () => {
    expect(gateV1Puzzle(puzzle())).toEqual({ gate: 'V1', result: 'pass' });
    // a set-up move first, then three moves with a reply in between
    const fork = puzzle({ fen: 'r3k3/ppp5/8/8/1n6/8/PP3PPP/R2BK3 w Qq - 0 1', setup: 'Bf3', solution: ['Nc2+', 'Kd2', 'Nxa1'], themes: ['fork'] });
    expect(gateV1Puzzle(fork).result).toBe('pass');
    expect(solverStart(fork)).toMatchObject({ ok: true, fen: expect.stringMatching(/ b /) });
  });

  it('fails with the exact move that is not legal', () => {
    expect(gateV1Puzzle(puzzle({ solution: ['Qd8#'] }))).toEqual({ gate: 'V1', result: 'fail', detail: 'move 1 of the solution (Qd8#) is not legal in the puzzle position' });
    const fork = puzzle({ fen: 'r3k3/ppp5/8/8/1n6/8/PP3PPP/R2BK3 w Qq - 0 1', setup: 'Bf3', solution: ['Nc2+', 'Kd2', 'Nxh1'] });
    expect(gateV1Puzzle(fork).detail).toBe('move 3 of the solution (Nxh1) is not legal after Nc2+ Kd2');
    expect(gateV1Puzzle(puzzle({ setup: 'Ke2' })).detail).toBe('the set-up move (Ke2) is not legal in the starting position');
    expect(gateV1Puzzle(puzzle({ fen: 'not a position' })).detail).toMatch(/not a valid position/);
    expect(gateV1Puzzle(puzzle({ accepted: { 0: ['Rd7', 'Rd9'] } })).detail).toMatch(/the accepted answer Rd9 .* is not legal/);
  });

  it('fails a line that is empty, ends on the other side, or lists answers for a move that is not the solver\'s', () => {
    expect(gateV1Puzzle(puzzle({ solution: [] })).detail).toBe('the puzzle has no solution');
    const fork = puzzle({ fen: 'r3k3/ppp5/8/8/1n6/5B2/PP3PPP/R3K3 b Qq - 1 1', solution: ['Nc2+', 'Kd2'] });
    expect(gateV1Puzzle(fork).detail).toMatch(/ends on the other side's move \(Kd2\)/);
    expect(gateV1Puzzle(puzzle({ accepted: { 1: ['Kh8'] } })).detail).toMatch(/not a move of the solver's/);
  });
});

describe('gate V6: provenance, and the status the gates give', () => {
  it('wants the source, the licence, the level and the engine', () => {
    expect(gateV6(item(), { storedUnderData: true, engineRan: true })).toEqual({ gate: 'V6', result: 'pass' });
    for (const source of ['puzzle:00sHx', 'file:data/courses/book.pdf#12', 'https://lichess.org/study/abc', 'generated:sonnet:2026-11-15:build-lesson']) {
      expect(gateV6(item({ source }), { storedUnderData: true, engineRan: true }).result).toBe('pass');
    }
    expect(gateV6(item({ source: 'somewhere' }), { storedUnderData: true, engineRan: true }).detail).toMatch(/does not say where the item came from/);
    expect(gateV6(item({ licence: 'gpl' as never }), { storedUnderData: true, engineRan: true }).detail).toMatch(/licence/);
    expect(gateV6(item({ level: undefined }), { storedUnderData: true, engineRan: true }).detail).toMatch(/level band/);
    expect(gateV6(item({ engine: undefined }), { storedUnderData: true, engineRan: true }).detail).toMatch(/engine and node budget/);
    expect(gateV6(item({ engine: undefined }), { storedUnderData: true, engineRan: false }).result).toBe('pass');
  });

  it('keeps private material under the data folder', () => {
    expect(gateV6(item({ licence: 'private' }), { storedUnderData: false, engineRan: true }).detail).toMatch(/only under the data folder/);
    expect(gateV6(item({ licence: 'private' }), { storedUnderData: true, engineRan: true }).result).toBe('pass');
  });

  it('quarantines on any failure, and when a gate that applies has not run', () => {
    const pass = GATES_FOR.puzzle_game.map((gate) => ({ gate, result: 'pass' as const }));
    expect(statusAfter('puzzle_game', pass)).toBe('machine-verified');
    expect(statusAfter('puzzle_game', [...pass.slice(0, 3), { gate: 'V6', result: 'fail', detail: 'x' }])).toBe('quarantined');
    expect(statusAfter('puzzle_game', pass.slice(0, 2))).toBe('quarantined');
    expect(statusAfter('puzzle_db', [{ gate: 'V1', result: 'pass' }, { gate: 'V6', result: 'pass' }])).toBe('machine-verified');
    const bad = item({ gates: [{ gate: 'V1', result: 'pass' }, { gate: 'V2', result: 'fail', detail: 'a second solution: Nxd5 is as good as exd5' }] });
    expect(quarantineReasons(bad)).toEqual(['V2 Engine soundness: a second solution: Nxd5 is as good as exd5', 'V3 Text claims: has not run', 'V6 Provenance: has not run']);
  });

  it('gives the same puzzle the same key', () => {
    expect(puzzleKey(puzzle(), 'game:1#5')).toBe(puzzleKey(puzzle({ themes: [] }), 'game:1#5'));
    expect(puzzleKey(puzzle(), 'game:1#5')).not.toBe(puzzleKey(puzzle(), 'game:2#5'));
    // the move counters of the position do not matter
    expect(puzzleKey(puzzle({ fen: BACK_RANK.replace('0 1', '7 31') }), 'game:1#5')).toBe(puzzleKey(puzzle(), 'game:1#5'));
  });
});
