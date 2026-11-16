// The material beside the board (feature I17; the owner's request of 2026-11-15): the pieces each
// side has taken and, for the side ahead in material, "+2" or "+3", as on Chess.com; or, as on
// Lichess, only the pieces one side is up. Counted from the position alone: no engine.

import { parsePosition, type Color, type Role } from './chess.ts';

export type MaterialMode = 'captured' | 'difference';
export type MaterialSide = {
  /** the opponent's pieces shown beside this side, the cheapest first (pawns, knights, bishops, rooks, queens) */
  pieces: Role[];
  /** how many points of material this side is ahead (pawn 1, knight and bishop 3, rook 5, queen 9); 0 when it is not */
  plus: number;
};

const ORDER: Role[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
const START: Record<Role, number> = { pawn: 8, knight: 2, bishop: 2, rook: 2, queen: 1, king: 1 };
const POINTS: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

function counts(fen: string): Record<Color, Record<Role, number>> | null {
  const pos = parsePosition(fen);
  if (!pos) return null;
  const out = { white: { pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0, king: 0 }, black: { pawn: 0, knight: 0, bishop: 0, rook: 0, queen: 0, king: 0 } } as Record<Color, Record<Role, number>>;
  for (const sq of pos.board.occupied) {
    const p = pos.board.get(sq);
    if (p) out[p.color][p.role]++;
  }
  return out;
}

/** The pieces a side has lost since the start: a promoted piece is counted as the pawn that made it. */
function lost(c: Record<Role, number>): Record<Role, number> {
  const promoted = ORDER.slice(1).reduce((n, r) => n + Math.max(0, c[r] - START[r]), 0);
  const out = { pawn: Math.max(0, START.pawn - c.pawn - promoted), knight: 0, bishop: 0, rook: 0, queen: 0, king: 0 } as Record<Role, number>;
  for (const r of ORDER.slice(1)) out[r] = Math.max(0, START[r] - c[r]);
  return out;
}

/** What to show beside each side of the board, or null for a position that cannot be read. */
export function materialBeside(fen: string, mode: MaterialMode = 'captured'): Record<Color, MaterialSide> | null {
  const c = counts(fen);
  if (!c) return null;
  const points = (side: Color) => ORDER.reduce((n, r) => n + c[side][r] * POINTS[r], 0);
  const diff = points('white') - points('black');
  const side = (me: Color): MaterialSide => {
    const them: Color = me === 'white' ? 'black' : 'white';
    const pieces: Role[] = [];
    if (mode === 'captured') {
      // what this side has taken: what the other side has lost
      const gone = lost(c[them]);
      for (const r of ORDER) for (let i = 0; i < gone[r]; i++) pieces.push(r);
    } else {
      // only what this side is up, piece for piece
      for (const r of ORDER) for (let i = 0; i < c[me][r] - c[them][r]; i++) pieces.push(r);
    }
    const plus = me === 'white' ? Math.max(0, diff) : Math.max(0, -diff);
    return { pieces, plus };
  };
  return { white: side('white'), black: side('black') };
}
