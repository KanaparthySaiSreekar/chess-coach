// Setting up a position by hand (feature I2, the board editor). The editor only places pieces;
// whether the result is a position chess allows is decided here, with the same rules as everything
// else, and the reason is given in plain words when it is not.

import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSquare } from 'chessops/util';
import type { Color } from './chess.ts';

export type CastlingRights = { K: boolean; Q: boolean; k: boolean; q: boolean };
export const NO_CASTLING: CastlingRights = { K: false, Q: false, k: false, q: false };

export type SetupCheck = { ok: true; fen: string; over?: 'checkmate' | 'stalemate' | 'not enough material to mate' } | { ok: false; reason: string };

const WHY: Record<string, string> = {
  ERR_BOARD: 'The piece placement is not readable: eight ranks of eight squares are needed.',
  ERR_POCKETS: 'This FEN is for another kind of chess.',
  ERR_TURN: 'The side to move must be "w" or "b".',
  ERR_CASTLING: 'The castling part is not readable (it is some of K, Q, k, q, or "-").',
  ERR_EP_SQUARE: 'The en passant square is not readable.',
  ERR_HALFMOVES: 'The move counters at the end are not readable.',
  ERR_FULLMOVES: 'The move counters at the end are not readable.',
  ERR_FEN: 'This is not a readable FEN.',
  ERR_EMPTY: 'The board is empty.',
  ERR_KINGS: 'Each side needs exactly one king.',
  ERR_OPPOSITE_CHECK: 'The side that is not to move is in check, which cannot happen in a game. Change who is to move, or move a piece.',
  ERR_PAWNS_ON_BACKRANK: 'A pawn cannot stand on the first or the last rank.',
};

/** Is this FEN a position chess allows? The FEN comes back tidied (castling and en passant that cannot be are dropped). */
export function checkSetup(fen: string): SetupCheck {
  const setup = parseFen(fen.trim());
  if (setup.isErr) return { ok: false, reason: WHY[setup.error.message] ?? 'This is not a readable FEN.' };
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return { ok: false, reason: WHY[pos.error.message] ?? 'This is not a position chess allows.' };
  const p = pos.value;
  const over = p.isCheckmate() ? 'checkmate' : p.isStalemate() ? 'stalemate' : p.isInsufficientMaterial() ? 'not enough material to mate' : undefined;
  return { ok: true, fen: standardCastling(makeFen(p.toSetup())), over };
}

/**
 * Castling as standard chess has it: only with the king on e1 / e8 and the rook in its corner.
 * The rules library also knows Chess960, where a king on f1 may castle; this app and its engine
 * play standard chess only, so such rights are dropped from a FEN that claims them.
 */
export function standardCastling(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 3) return fen;
  const can = castlingOptions(parts[0]!);
  parts[2] = (['K', 'Q', 'k', 'q'] as const).filter((c) => parts[2]!.includes(c) && can[c]).join('') || '-';
  return parts.join(' ');
}

const rows = (placement: string): string[] | null => {
  const out = placement.split('/').map((row) => row.replace(/\d/g, (d) => '.'.repeat(Number(d))));
  return out.length === 8 && out.every((r) => r.length === 8) ? out : null;
};

/** Which castling moves the placement still allows: the king and that rook on their first squares. */
export function castlingOptions(placement: string): CastlingRights {
  const r = rows(placement);
  if (!r) return { ...NO_CASTLING };
  const white = r[7]!;
  const black = r[0]!;
  return { K: white[4] === 'K' && white[7] === 'R', Q: white[4] === 'K' && white[0] === 'R', k: black[4] === 'k' && black[7] === 'r', q: black[4] === 'k' && black[0] === 'r' };
}

/** Squares on which an en passant capture is possible for the side to move: the rules decide, by trying each. */
export function epOptions(placement: string, turn: Color): string[] {
  const out: string[] = [];
  const rank = turn === 'white' ? '6' : '3';
  for (const file of 'abcdefgh') {
    const setup = parseFen(`${placement} ${turn === 'white' ? 'w' : 'b'} - ${file}${rank} 0 1`);
    if (setup.isErr) continue;
    const pos = Chess.fromSetup(setup.value);
    // the rules keep an en passant square only when a pawn really could be taken there
    if (pos.isOk && pos.value.epSquare !== undefined && makeSquare(pos.value.epSquare) === `${file}${rank}`) out.push(`${file}${rank}`);
  }
  return out;
}

/** The FEN for what the editor shows. Rights the placement does not allow are left out. */
export function setupFen(placement: string, turn: Color, castling: CastlingRights, ep?: string): string {
  const can = castlingOptions(placement);
  const rights = (['K', 'Q', 'k', 'q'] as const).filter((c) => castling[c] && can[c]).join('') || '-';
  const epOk = ep && epOptions(placement, turn).includes(ep) ? ep : '-';
  return `${placement} ${turn === 'white' ? 'w' : 'b'} ${rights} ${epOk} 0 1`;
}

/** The parts of a FEN the editor edits. Null when the placement is not eight ranks of eight squares. */
export function setupParts(fen: string): { placement: string; turn: Color; castling: CastlingRights; ep?: string } | null {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0] ?? '';
  if (!rows(placement) || /[^pnbrqkPNBRQK1-8/]/.test(placement)) return null;
  const turn: Color = parts[1] === 'b' ? 'black' : 'white';
  const c = parts[2] ?? '-';
  const ep = /^[a-h][36]$/.test(parts[3] ?? '') ? parts[3] : undefined;
  return { placement, turn, castling: { K: c.includes('K'), Q: c.includes('Q'), k: c.includes('k'), q: c.includes('q') }, ep };
}
