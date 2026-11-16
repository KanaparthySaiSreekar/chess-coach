// The board editor's rules (feature I2): which set-up positions chess allows, and why not.

import { describe, expect, it } from 'vitest';
import { NO_CASTLING, START_FEN, castlingOptions, checkSetup, epOptions, setupFen, setupParts } from '../src/index.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const ALL = { K: true, Q: true, k: true, q: true };

describe('checking a set-up position', () => {
  it('accepts the starting position and an ordinary endgame', () => {
    expect(checkSetup(START_FEN)).toEqual({ ok: true, fen: START_FEN, over: undefined });
    const r = checkSetup('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1');
    expect(r.ok).toBe(true);
  });

  it('says in plain words what is wrong', () => {
    const why = (fen: string) => {
      const r = checkSetup(fen);
      return r.ok ? 'ok' : r.reason;
    };
    expect(why('8/8/8/8/8/8/8/8 w - - 0 1')).toMatch(/board is empty/);
    expect(why('8/8/8/8/8/8/4P3/4K3 w - - 0 1')).toMatch(/exactly one king/);
    expect(why('4k3/8/8/8/8/8/8/2K1K3 w - - 0 1')).toMatch(/exactly one king/);
    expect(why('4k3/8/8/8/8/8/8/P3K3 w - - 0 1')).toMatch(/pawn cannot stand on the first or the last rank/);
    // White has just "moved" and left Black's king in check from the rook: Black to move is fine, White to move is not
    expect(why('4k3/8/8/8/8/8/8/4RK2 b - - 0 1')).toBe('ok');
    expect(why('4k3/8/8/8/8/8/8/4RK2 w - - 0 1')).toMatch(/not to move is in check/);
    expect(why('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPP/RNBQKBNR w KQkq - 0 1')).toMatch(/eight ranks of eight squares/);
    expect(why('hello')).toMatch(/eight ranks|readable/);
  });

  it('notes when the position set up is already over', () => {
    expect(checkSetup('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toMatchObject({ ok: true, over: 'stalemate' });
    expect(checkSetup('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1')).toMatchObject({ ok: true, over: 'checkmate' });
    expect(checkSetup('7k/8/6K1/8/8/8/8/8 w - - 0 1')).toMatchObject({ ok: true, over: 'not enough material to mate' });
  });

  it('drops castling rights and en passant squares that cannot be', () => {
    // the king has left e1, so the "KQ" in the FEN means nothing
    const r = checkSetup('r3k2r/8/8/8/8/8/8/R4K1R w KQkq - 0 1');
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.fen.split(' ')[2]).toBe('kq');
  });
});

describe('what the editor offers', () => {
  it('offers castling only where the king and that rook are on their first squares', () => {
    expect(castlingOptions(START)).toEqual(ALL);
    expect(castlingOptions('r3k3/8/8/8/8/8/8/4K2R')).toEqual({ K: true, Q: false, k: false, q: true });
    expect(castlingOptions('4k3/8/8/8/8/8/8/R3K2R')).toEqual({ K: true, Q: true, k: false, q: false });
    expect(castlingOptions('not a board')).toEqual(NO_CASTLING);
  });

  it('offers en passant only where a pawn could really be taken', () => {
    // Black has just played d7-d5 beside the white pawn on e5
    expect(epOptions('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR', 'white')).toEqual(['d6']);
    expect(epOptions('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR', 'black')).toEqual([]);
    expect(epOptions(START, 'white')).toEqual([]);
  });

  it('writes the FEN from the parts and reads the parts back', () => {
    expect(setupFen(START, 'white', ALL)).toBe(START_FEN);
    // rights the placement does not allow are left out, whatever the boxes say
    expect(setupFen('4k3/8/8/8/8/8/8/4K2R', 'black', ALL)).toBe('4k3/8/8/8/8/8/8/4K2R b K - 0 1');
    expect(setupFen('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR', 'white', ALL, 'd6')).toBe('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 1');
    expect(setupFen(START, 'white', ALL, 'd6')).toBe(START_FEN); // not possible here: dropped
    expect(setupParts('4k3/8/8/8/8/8/8/4K2R b K - 0 1')).toEqual({ placement: '4k3/8/8/8/8/8/8/4K2R', turn: 'black', castling: { K: true, Q: false, k: false, q: false }, ep: undefined });
    expect(setupParts('8/8/8 w')).toBeNull();
    expect(setupParts('4k3/8/8/8/8/8/8/4K2X w - - 0 1')).toBeNull();
  });
});
