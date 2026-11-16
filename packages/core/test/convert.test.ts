import { describe, expect, it } from 'vitest';
import { conversionStart, convertWords, gateV1Convert, type ConvertItem, type GamePly } from '../src/index.ts';

/** Plies with only what the start rule reads: who moved, the move, and White's chances after it. */
const plies = (rows: [string, number][]): GamePly[] =>
  rows.map(([san, whiteWin], i) => ({ ply: i + 1, san, by: i % 2 === 0 ? 'white' : 'black', fenBefore: `fen${i}`, fenAfter: `fen${i + 1}`, whiteWin }) as GamePly);

// 2...Qh4 leaves the queen to the knight: White is clearly winning, and 3.Nc3 lets it go
const THROWN = plies([
  ['e4', 55],
  ['e5', 54],
  ['Nf3', 56],
  ['Qh4', 97],
  ['Nc3', 50],
  ['Nc6', 50],
]);

describe('win the won game', () => {
  it('starts before the move that threw the win away, or at the last clearly won position', () => {
    expect(conversionStart(THROWN, 'white', 'draw')).toMatchObject({ ply: { ply: 5, fenBefore: 'fen4' }, chances: 97, threw: 'Nc3' });
    expect(conversionStart(THROWN, 'white', 'loss')?.threw).toBe('Nc3');
    // a game the owner won, or whose result is not known, makes no drill
    expect(conversionStart(THROWN, 'white', 'win')).toBeNull();
    expect(conversionStart(THROWN, 'white', undefined)).toBeNull();
    // never clearly winning: nothing
    expect(conversionStart(THROWN, 'black', 'draw')).toBeNull();
    // still winning at the end (a draw agreed, or the clock): the last clearly won position
    const kept = plies([
      ['e4', 55],
      ['e5', 54],
      ['Nf3', 56],
      ['Qh4', 97],
      ['Nxh4', 98],
      ['Nf6', 98],
      ['d3', 97],
      ['d6', 97],
    ]);
    expect(conversionStart(kept, 'white', 'draw')).toEqual({ ply: kept[6], chances: 98 });
    // a slow slide (97 → 70 → 55) has no single throw: the last clearly won position is where it starts
    const slide = plies([
      ['e4', 55],
      ['e5', 97],
      ['a3', 70],
      ['a6', 70],
      ['b3', 55],
    ]);
    expect(conversionStart(slide, 'white', 'draw')).toEqual({ ply: slide[2], chances: 97 });
    // the owner as Black: their chances are the rest
    const black = plies([
      ['e4', 50],
      ['e5', 50],
      ['Qh5', 10],
      ['g6', 52],
    ]);
    expect(conversionStart(black, 'black', 'loss')).toMatchObject({ ply: { ply: 4 }, chances: 90, threw: 'g6' });
  });

  it('gate V1: a clearly won position that is not over, and the move played legal in it', () => {
    const item = (over: Partial<ConvertItem> = {}): ConvertItem => ({ fen: 'rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', chances: 97, game: { outcome: 'draw', threw: 'Nc3' }, ...over });
    expect(gateV1Convert(item())).toEqual({ gate: 'V1', result: 'pass' });
    expect(gateV1Convert(item({ game: { outcome: 'loss' } })).result).toBe('pass');
    expect(gateV1Convert(item({ game: { outcome: 'draw', threw: 'Nc6' } })).detail).toBe('Nc6 is not legal in the position');
    expect(gateV1Convert(item({ game: { outcome: 'draw', played: 'Kd2' } })).detail).toBe('Kd2 is not legal in the position');
    expect(gateV1Convert(item({ chances: 70 })).detail).toBe('the position is not clearly winning');
    expect(gateV1Convert(item({ fen: '7k/7Q/6K1/8/8/8/8/8 b - - 0 1' })).detail).toBe('the game is already over in the position');
    expect(gateV1Convert(item({ fen: 'x' })).detail).toBe('the position is not valid');
  });

  it('says how a drill ended', () => {
    expect(convertWords('converted')).toBe('Checkmate: you won it.');
    expect(convertWords('kept', { moves: 40 })).toBe('Still winning after 40 of your moves: you kept the win, but it is not finished yet.');
    expect(convertWords('drawn', { moves: 3, draw: 'stalemate' })).toBe('A draw (stalemate): the win slipped away.');
    expect(convertWords('thrown')).toBe('That move gave the win away.');
  });
});
