// Why a move is not legal, from the board (D33: the coach repeats code's reason, it does not make one up).

import { describe, expect, it } from 'vitest';
import { START_FEN, mustPosition, playLine, whyIllegal } from '../src/index.ts';

const after = (moves: string) => {
  const r = playLine(START_FEN, moves.split(' '));
  if (!r.ok) throw new Error(`illegal: ${r.move}`);
  return mustPosition(r.fens.at(-1)!);
};
const italian = () => after('e4 e5 Nf3 Nc6 Bc4 Bc5');

describe('why a move is not legal', () => {
  it('the square is not within the piece\'s reach (the case the coach got wrong: no knight blocks anything here)', () => {
    expect(whyIllegal(italian(), 'Qh7')).toBe('your queen on d1 cannot get to h7: a queen moves along ranks, files and diagonals, and h7 is not within its reach from d1');
    expect(whyIllegal(italian(), 'Ne4')).toMatch(/^your knight on (b1|f3) cannot get to e4|your own pawn is on e4/);
    expect(whyIllegal(italian(), 'Kd3')).toMatch(/your king on e1 cannot get to d3: a king moves one square/);
  });

  it('a piece is in the way, and it is named', () => {
    // the queen's diagonal to h5 runs through f3, where the knight stands
    expect(whyIllegal(italian(), 'Qh5')).toBe('your own knight on f3 is in the way of your queen on d1');
    expect(whyIllegal(italian(), 'Rh3')).toBe('your own pawn on h2 is in the way of your rook on h1');
    expect(whyIllegal(after('e4 e5'), 'Bh6')).toBe('your own pawn on d2 is in the way of your bishop on c1');
  });

  it('the target square holds one of the mover\'s own pieces', () => {
    expect(whyIllegal(italian(), 'Nd2')).toBe('your own pawn is on d2');
    expect(whyIllegal(italian(), 'Qe2')).toBeTruthy(); // legal in fact: the caller only asks about moves that are not
  });

  it('the king\'s safety: a pinned piece, and a check that must be answered', () => {
    // the knight on c6 is pinned to the king by the bishop on b5
    const pinned = after('e4 e5 Nf3 d6 Bb5+ Nc6 O-O a6 d4');
    expect(whyIllegal(pinned, 'Nxd4')).toBe('it would leave your king in check: your knight on c6 is pinned');
    const inCheck = after('e4 e5 Nf3 d6 Bb5+');
    expect(whyIllegal(inCheck, 'Nf6')).toBe('you are in check, and this move does not deal with it');
    expect(whyIllegal(after('e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7+'), 'Ke7')).toBe('e7 is attacked, and a king may not move into check');
  });

  it('pawns: straight ahead to an empty square, diagonally only to take', () => {
    const pos = after('e4 e5');
    expect(whyIllegal(pos, 'e5')).toBe('your pawn on e4 cannot move onto an occupied square: a pawn only takes diagonally');
    expect(whyIllegal(pos, 'exd5')).toMatch(/there is nothing on d5 for your pawn on e4 to take/);
    expect(whyIllegal(pos, 'a5')).toMatch(/your pawn on a2 cannot get to a5/);
    expect(whyIllegal(after('e4 e5 Nf3 Nc6 Nc3 Nf6'), 'c4')).toBe('the knight on c3 is in the way of your pawn on c2');
  });

  it('the "x" in the wrong place: the move exists, written the other way', () => {
    const pos = after('e4 d5');
    expect(whyIllegal(pos, 'ed5')).toBeTruthy();
    expect(whyIllegal(pos, 'Qxh5')).toBe('there is nothing to take on h5: the move is written Qh5');
    expect(whyIllegal(after('e4 e5 Nf3 Nc6'), 'Ne5')).toBe('that move takes a piece, so it is written Nxe5');
  });

  it('pieces that are not there, moves by square, and text that is not a move', () => {
    expect(whyIllegal(mustPosition('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), 'Qd4')).toBe('you have no queen');
    expect(whyIllegal(italian(), 'Rcd1')).toBe('you have no rook there');
    expect(whyIllegal(italian(), 'd1h7')).toMatch(/^your queen on d1 cannot get to h7/);
    expect(whyIllegal(italian(), 'e5e4')).toBe('the piece on e5 is not yours to move');
    expect(whyIllegal(italian(), 'a3a4')).toBe('there is no piece on a3');
    expect(whyIllegal(italian(), 'castle')).toBe('that is not a move in chess notation');
    expect(whyIllegal(after('e4 e5 Nf3 Nc6'), 'O-O')).toBe('you cannot castle that way in this position');
  });
});
