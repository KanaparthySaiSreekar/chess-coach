// Thin wrappers over chessops (Lichess's rules library). Everything in core that needs the rules
// goes through here, so legality is decided in exactly one place.

import { Chess, castlingSide } from 'chessops/chess';
import { parseFen, makeFen, INITIAL_FEN } from 'chessops/fen';
import { parseSan, makeSan } from 'chessops/san';
import { parseUci, makeUci, makeSquare, parseSquare, opposite, kingCastlesTo } from 'chessops/util';
import type { Color, Move, NormalMove, Role, Square } from 'chessops/types';

export type { Color, Move, NormalMove, Role, Square };
export { Chess, makeSquare, parseSquare, opposite };

export const START_FEN: string = INITIAL_FEN;

export const ROLE_VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
export const ROLE_LETTER: Record<Role, string> = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };
export const LETTER_ROLE: Record<string, Role> = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };

/** A position from a FEN, or null when the FEN is not a legal chess position. */
export function parsePosition(fen: string): Chess | null {
  const setup = parseFen(fen.trim());
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? null : pos.value;
}

/** Like parsePosition, but throws. For FENs the app made itself. */
export function mustPosition(fen: string): Chess {
  const pos = parsePosition(fen);
  if (!pos) throw new Error(`invalid FEN: ${fen}`);
  return pos;
}

export function fenOf(pos: Chess): string {
  return makeFen(pos.toSetup());
}

/** Position identity for transpositions and caches: placement, turn, castling, en passant. */
export function positionKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ');
}

const cleanSan = (san: string): string =>
  san
    .trim()
    .replace(/^\d+\.(\.\.)?\s*/, '')
    .replace(/[!?]+$/g, '')
    .replace(/0-0-0/g, 'O-O-O')
    .replace(/0-0/g, 'O-O');

/** SAN → move, only when it is legal in this position. Tolerates "+", "#", "!?" and "0-0". */
export function sanToMove(pos: Chess, san: string): Move | null {
  const cleaned = cleanSan(san);
  if (!cleaned) return null;
  const move = parseSan(pos, cleaned) ?? parseSan(pos, cleaned.replace(/[+#]$/g, ''));
  if (!move || !pos.isLegal(move)) return null;
  // "Qxe4" must really be a capture and "Qe4" must not be: otherwise a move written for one
  // position can silently match a different move in another
  if (cleaned.includes('x') !== makeSan(pos, move).includes('x')) return null;
  return move;
}

/** UCI → move, only when it is legal in this position. Accepts both e1g1 and e1h1 for castling. */
export function uciToMove(pos: Chess, uci: string): Move | null {
  const move = parseUci(uci.trim().toLowerCase());
  return move && pos.isLegal(move) ? move : null;
}

/** Accepts SAN or UCI. */
export function anyToMove(pos: Chess, text: string): Move | null {
  return sanToMove(pos, text) ?? (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(text.trim()) ? uciToMove(pos, text) : null);
}

/** UCI the way Stockfish writes it (castling as the king's two-square move). */
export function engineUci(pos: Chess, move: Move): string {
  if ('from' in move) {
    const side = castlingSide(pos, move);
    if (side) return makeSquare(move.from) + makeSquare(kingCastlesTo(pos.turn, side));
  }
  return makeUci(move);
}

export type MoveInfo = {
  san: string;
  uci: string; // engine style
  from: string;
  to: string; // where the moving piece lands (for castling: the king's square)
  color: Color;
  role: Role;
  captured?: Role;
  promotion?: Role;
  castle?: 'kingside' | 'queenside';
  enPassant: boolean;
  check: boolean;
  mate: boolean;
  fenAfter: string;
};

/** Everything about one legal move. The position itself is not changed. */
export function describeMove(pos: Chess, move: Move): MoveInfo {
  if (!('from' in move)) throw new Error('drops are not part of standard chess');
  const piece = pos.board.get(move.from);
  if (!piece) throw new Error('no piece on the from-square');
  const side = castlingSide(pos, move);
  const uci = engineUci(pos, move);
  const to = uci.slice(2, 4);
  let captured: Role | undefined;
  let enPassant = false;
  if (!side) {
    const target = pos.board.get(move.to);
    if (target) captured = target.role;
    else if (piece.role === 'pawn' && move.to === pos.epSquare) {
      captured = 'pawn';
      enPassant = true;
    }
  }
  const san = makeSan(pos, move);
  const after = pos.clone();
  after.play(move);
  return {
    san,
    uci,
    from: makeSquare(move.from),
    to,
    color: pos.turn,
    role: piece.role,
    captured,
    promotion: move.promotion,
    castle: side === 'h' ? 'kingside' : side === 'a' ? 'queenside' : undefined,
    enPassant,
    check: after.isCheck(),
    mate: after.isCheckmate(),
    fenAfter: fenOf(after),
  };
}

/** Every legal move in the position, described. */
export function legalMoves(pos: Chess): MoveInfo[] {
  const out: MoveInfo[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const piece = pos.board.get(from);
      const promotes = piece?.role === 'pawn' && (to >= 56 || to <= 7);
      if (promotes) {
        for (const promotion of ['queen', 'rook', 'bishop', 'knight'] as const) out.push(describeMove(pos, { from, to, promotion }));
      } else {
        out.push(describeMove(pos, { from, to }));
      }
    }
  }
  // castling appears once in allDests (king takes rook), which is what we want
  return out;
}

/** Play SAN or UCI moves from a FEN. Stops at the first illegal move and says which. */
export function playLine(
  fen: string,
  moves: string[],
): { ok: true; infos: MoveInfo[]; fens: string[] } | { ok: false; at: number; move: string; infos: MoveInfo[]; fens: string[]; legal: string[] } {
  const pos = parsePosition(fen);
  if (!pos) return { ok: false, at: -1, move: '', infos: [], fens: [], legal: [] };
  const infos: MoveInfo[] = [];
  const fens: string[] = [fenOf(pos)];
  for (let i = 0; i < moves.length; i++) {
    const move = anyToMove(pos, moves[i]!);
    if (!move) {
      return { ok: false, at: i, move: moves[i]!, infos, fens, legal: legalMoves(pos).map((m) => m.san) };
    }
    const info = describeMove(pos, move);
    infos.push(info);
    pos.play(move);
    fens.push(info.fenAfter);
  }
  return { ok: true, infos, fens };
}

/**
 * The same position with the other side to move ("what would they do with a free move?").
 * Null when that is not a legal position: the side to move is in check, so it cannot pass.
 */
export function passPosition(fen: string): string | null {
  const pos = parsePosition(fen);
  if (!pos || pos.isCheck()) return null;
  const parts = fen.trim().split(/\s+/);
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const flipped = parts.join(' ');
  return parsePosition(flipped) ? flipped : null;
}

export function gameStatus(pos: Chess): { over: boolean; text?: string; winner?: Color } {
  if (pos.isCheckmate()) return { over: true, text: 'checkmate', winner: opposite(pos.turn) };
  if (pos.isStalemate()) return { over: true, text: 'stalemate' };
  if (pos.isInsufficientMaterial()) return { over: true, text: 'draw: not enough material to mate' };
  return { over: false };
}

/** Full-move number and ply prefix for display: "12." for White, "12..." for Black. */
export function movePrefix(fenBefore: string): string {
  const parts = fenBefore.trim().split(/\s+/);
  const n = Number(parts[5] ?? 1) || 1;
  return parts[1] === 'b' ? `${n}...` : `${n}.`;
}
