// The eight positions spike S2 writes its 40 messages about. Each is reached by legal moves from
// the start (or is a tiny hand-set endgame), so nothing here depends on anyone's memory of a FEN.

import { START_FEN, playLine, type Color } from '@chess-coach/core';

export type S2Position = { key: string; about: string; fen: string; you: Color; lastMove?: { san: string; by: 'owner' | 'opponent'; fenBefore: string } };

function fromMoves(key: string, about: string, you: Color, moves: string, lastBy: 'owner' | 'opponent'): S2Position {
  const list = moves.split(/\s+/).filter(Boolean);
  const r = playLine(START_FEN, list);
  if (!r.ok) throw new Error(`${key}: illegal move ${r.move} at ${r.at}`);
  return { key, about, you, fen: r.fens.at(-1)!, lastMove: { san: r.infos.at(-1)!.san, by: lastBy, fenBefore: r.fens.at(-2)! } };
}

export const POSITIONS: S2Position[] = [
  fromMoves('scholar', "Scholar's Mate threat: Black (the owner) to move", 'black', 'e4 e5 Bc4 Nc6 Qh5', 'opponent'),
  fromMoves('legal', "Legal's trap: White (the owner) to move, the knight can take on e5", 'white', 'e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6', 'opponent'),
  fromMoves('queenfork', 'Black queen attacks the knight on e5 and the pawn on e4: White (the owner) to move', 'white', 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4', 'opponent'),
  fromMoves('pin', 'Ruy Lopez: the knight on c6 is pinned: White to move, the owner is Black', 'black', 'e4 e5 Nf3 Nc6 Bb5 d6', 'owner'),
  fromMoves('italian', 'A quiet Italian Game: White (the owner) to move', 'white', 'e4 e5 Nf3 Nc6 Bc4 Bc5', 'opponent'),
  fromMoves('hung', 'The owner (White) just put a knight where a pawn takes it', 'white', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Ne6', 'owner'),
  { key: 'backrank', about: 'A back-rank mate in one: White (the owner) to move', you: 'white', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1' },
  { key: 'knightfork', about: 'A knight fork of king and rook: White (the owner) to move', you: 'white', fen: 'r3k3/8/8/1N6/8/8/PPP5/2K5 w - - 0 1' },
];
