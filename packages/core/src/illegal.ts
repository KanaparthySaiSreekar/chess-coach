// Why a move is not legal, worked out from the board (decision D33: reasons come from code).
// Asked "what if I play Qh7?" about a move that cannot be played, the coach used to be told only
// "not legal" and then made a reason up. This gives it the real one to repeat.

import { attacks, between } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import type { Role, Square } from 'chessops/types';
import { squareFile, squareRank } from 'chessops/util';
import { LETTER_ROLE, type Chess, makeSquare, parseSquare, sanToMove } from './chess.ts';

const HOW: Record<Role, string> = {
  king: 'a king moves one square in any direction',
  queen: 'a queen moves along ranks, files and diagonals',
  rook: 'a rook moves along ranks and files',
  bishop: 'a bishop moves along diagonals',
  knight: 'a knight moves two squares one way and one square to the side',
  pawn: 'a pawn moves straight ahead and takes one square diagonally ahead',
};

/** One sentence, without a full stop: why the side to move cannot play this (SAN like "Qh7", or UCI like "d1h7"). */
export function whyIllegal(pos: Chess, text: string): string {
  const raw = text.trim().replace(/[!?]+$/, '');
  const me = pos.turn;
  if (/^(O-O|0-0)/i.test(raw)) return 'you cannot castle that way in this position';

  let role: Role;
  let dest: Square | undefined;
  let fromFile: number | undefined;
  let fromRank: number | undefined;
  let from: Square | undefined;
  let wantsCapture = false;
  const uci = raw.toLowerCase().match(/^([a-h][1-8])([a-h][1-8])[qrbn]?$/);
  const san = raw.match(/^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=?[QRBN])?[+#]?$/);
  // "d1h7" is a move by its two squares; a move in notation never names both squares of a pawn
  if (uci) {
    from = parseSquare(uci[1]!);
    dest = parseSquare(uci[2]!);
    const piece = from === undefined ? undefined : pos.board.get(from);
    if (!piece) return `there is no piece on ${uci[1]}`;
    if (piece.color !== me) return `the piece on ${uci[1]} is not yours to move`;
    role = piece.role;
  } else if (san) {
    role = san[1] ? LETTER_ROLE[san[1]]! : 'pawn';
    if (san[2]) fromFile = san[2].charCodeAt(0) - 97;
    if (san[3]) fromRank = Number(san[3]) - 1;
    wantsCapture = !!san[4];
    dest = parseSquare(san[5]!);
  } else return 'that is not a move in chess notation';
  if (dest === undefined) return 'that is not a square on the board';
  const destName = makeSquare(dest);

  // the same move written with or without the "x" is legal: say how it is written
  if (san) {
    const flipped = wantsCapture ? raw.replace('x', '') : raw.replace(/([a-h][1-8])/, 'x$1');
    const other = sanToMove(pos, flipped);
    if (other) return wantsCapture ? `there is nothing to take on ${destName}: the move is written ${flipped}` : `that move takes a piece, so it is written ${flipped}`;
  }

  let candidates: Square[] = from !== undefined ? [from] : [...pos.board.pieces(me, role)];
  if (fromFile !== undefined) candidates = candidates.filter((sq) => squareFile(sq) === fromFile);
  if (fromRank !== undefined) candidates = candidates.filter((sq) => squareRank(sq) === fromRank);
  if (!candidates.length) return from === undefined && (fromFile !== undefined || fromRank !== undefined) ? `you have no ${role} there` : `you have no ${role}`;

  const target = pos.board.get(dest);
  if (target?.color === me) return `your own ${target.role} is on ${destName}`;

  // for each piece that could be meant: how close does it get? the closest one gives the reason
  let best: { rank: number; text: string } | null = null;
  const consider = (rank: number, reason: string) => {
    if (!best || rank > best.rank) best = { rank, text: reason };
  };
  for (const sq of candidates) {
    const piece = pos.board.get(sq)!;
    const name = `your ${role} on ${makeSquare(sq)}`;
    if (role === 'pawn') {
      const dir = me === 'white' ? 1 : -1;
      const df = squareFile(dest) - squareFile(sq);
      const dr = (squareRank(dest) - squareRank(sq)) * dir;
      const startRank = me === 'white' ? 1 : 6;
      if (df === 0 && (dr === 1 || (dr === 2 && squareRank(sq) === startRank))) {
        if (target) consider(2, `${name} cannot move onto an occupied square: a pawn only takes diagonally`);
        else if (dr === 2 && pos.board.get(sq + 8 * dir)) consider(2, `the ${pos.board.get(sq + 8 * dir)!.role} on ${makeSquare(sq + 8 * dir)} is in the way of ${name}`);
        else consider(3, pos.isCheck() ? 'you are in check, and this move does not deal with it' : `it would leave your king in check: ${name} is pinned`);
      } else if (Math.abs(df) === 1 && dr === 1) {
        if (!target && dest !== pos.epSquare) consider(2, `there is nothing on ${destName} for ${name} to take: a pawn only moves diagonally when it takes`);
        else consider(3, pos.isCheck() ? 'you are in check, and this move does not deal with it' : `it would leave your king in check: ${name} is pinned`);
      } else consider(1, `${name} cannot get to ${destName}: ${HOW.pawn}`);
      continue;
    }
    if (!attacks(piece, sq, SquareSet.empty()).has(dest)) {
      consider(1, `${name} cannot get to ${destName}: ${HOW[role]}, and ${destName} is not within its reach from ${makeSquare(sq)}`);
      continue;
    }
    if (!attacks(piece, sq, pos.board.occupied).has(dest)) {
      // something stands between: name the nearest piece in the way
      let nearest: Square | undefined;
      let nearestDistance = 99;
      for (const b of between(sq, dest).intersect(pos.board.occupied)) {
        const d = Math.max(Math.abs(squareFile(b) - squareFile(sq)), Math.abs(squareRank(b) - squareRank(sq)));
        if (d < nearestDistance) {
          nearest = b;
          nearestDistance = d;
        }
      }
      const blocker = nearest === undefined ? undefined : pos.board.get(nearest);
      consider(2, blocker ? `${blocker.color === me ? 'your own' : 'their'} ${blocker.role} on ${makeSquare(nearest!)} is in the way of ${name}` : `the way to ${destName} is blocked for ${name}`);
      continue;
    }
    // the piece can make the move as far as its own movement goes: the king's safety forbids it
    if (role === 'king') consider(3, `${destName} is attacked, and a king may not move into check`);
    else consider(3, pos.isCheck() ? 'you are in check, and this move does not deal with it' : `it would leave your king in check: ${name} is pinned`);
  }
  return best ? (best as { rank: number; text: string }).text : 'it is not a legal move in this position';
}
