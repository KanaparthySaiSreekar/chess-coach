import { describe, expect, it } from 'vitest';
import { START_FEN, materialBeside, playLine } from '../src/index.ts';

// Feature I17: the material beside the board, counted from the position.
const after = (moves: string) => {
  const r = playLine(START_FEN, moves.split(' '));
  if (!r.ok) throw new Error(moves);
  return r.fens.at(-1)!;
};

describe('the material beside the board (I17)', () => {
  it('nothing taken, nobody ahead, at the start', () => {
    expect(materialBeside(START_FEN)).toEqual({ white: { pieces: [], plus: 0 }, black: { pieces: [], plus: 0 } });
  });

  it('the pieces each side has taken, and +N for the side ahead, the cheapest first', () => {
    // 1.e4 d5 2.exd5 Qxd5 3.Nc3 Qxd2+?? 4.Bxd2: White took a pawn and the queen, Black two pawns: White is 8 up
    const m = materialBeside(after('e4 d5 exd5 Qxd5 Nc3 Qxd2+ Bxd2'))!;
    expect(m.white).toEqual({ pieces: ['pawn', 'queen'], plus: 8 });
    expect(m.black).toEqual({ pieces: ['pawn', 'pawn'], plus: 0 });
    // a knight for a pawn: +2
    const k = materialBeside(after('e4 e5 Nf3 Nc6 Nxe5 Nxe5'))!;
    expect(k.black).toEqual({ pieces: ['knight'], plus: 2 });
    expect(k.white).toEqual({ pieces: ['pawn'], plus: 0 });
  });

  it("Lichess's way: only what one side is up", () => {
    const m = materialBeside(after('e4 d5 exd5 Qxd5 Nc3 Qxd2+ Bxd2'), 'difference')!;
    expect(m.white).toEqual({ pieces: ['queen'], plus: 8 });
    expect(m.black).toEqual({ pieces: ['pawn'], plus: 0 });
  });

  it('a promoted queen counts as the pawn that made it, not as a queen taken', () => {
    // White has promoted (two queens, seven pawns), Black has lost a pawn and its queen
    const m = materialBeside('4k3/pppppp2/8/8/8/8/PPPPPPP1/Q2QK3 w - - 0 1')!;
    expect(m.black.pieces).toEqual(['knight', 'knight', 'bishop', 'bishop', 'rook', 'rook']); // what Black has taken: White's lost pieces; the pawn that promoted is not one of them
    expect(m.white.pieces).toEqual(['pawn', 'pawn', 'knight', 'knight', 'bishop', 'bishop', 'rook', 'rook', 'queen']);
    expect(m.white.plus).toBe(25 - 6 + 0);
    expect(materialBeside('not a position')).toBeNull();
  });
});
