// Tactical motifs of a line of play (PLAN WP 4.2; features B5, C3, H12): fork, pin, skewer,
// discovered attack, double check, back-rank mate, hanging piece, removed defender, trapped piece,
// mate in N. Pure board logic: no engine.
//
// The definitions follow Lichess's own puzzle tagger (lichess-puzzler, `tagger/cook.py` and
// `util.py`, AGPL-3.0), so that a theme means here what it means in the Lichess puzzle database:
// the detectors are tested against the tags of sampled puzzles from that database.
//
// A line is seen from one side, the *solver*: in a puzzle the first move is the other side's
// (the move that sets the puzzle up) and the solver's moves follow in turn; in a line from the
// engine there may be no set-up move.

import { attacks, between, ray } from 'chessops/attacks';
import type { Piece, Role, Square } from 'chessops/types';
import { squareFile, squareRank } from 'chessops/util';
import { SquareSet } from 'chessops/squareSet';
import { type Chess, type Color, opposite, parsePosition, uciToMove } from './chess.ts';

export type Motif = 'fork' | 'pin' | 'skewer' | 'discoveredAttack' | 'doubleCheck' | 'backRankMate' | 'hangingPiece' | 'capturingDefender' | 'trappedPiece' | 'mateIn1' | 'mateIn2' | 'mateIn3' | 'mateIn4' | 'mateIn5';

/** What a motif is called in the Lichess puzzle database's `Themes` column. */
export const LICHESS_THEME: Record<Motif, string> = {
  fork: 'fork',
  pin: 'pin',
  skewer: 'skewer',
  discoveredAttack: 'discoveredAttack',
  doubleCheck: 'doubleCheck',
  backRankMate: 'backRankMate',
  hangingPiece: 'hangingPiece',
  capturingDefender: 'capturingDefender',
  trappedPiece: 'trappedPiece',
  mateIn1: 'mateIn1',
  mateIn2: 'mateIn2',
  mateIn3: 'mateIn3',
  mateIn4: 'mateIn4',
  mateIn5: 'mateIn5',
};

const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 99 };
const RAY: ReadonlySet<Role> = new Set(['queen', 'rook', 'bishop']);

type Ply = {
  before: Chess;
  after: Chess;
  from: Square;
  to: Square;
  by: Color;
  /** the piece standing on the target square after the move (the promoted piece, for a promotion) */
  moved: Role;
  /** what stood on the target square before the move (not set for en passant) */
  taken?: Piece;
  capture: boolean;
  castle: boolean;
};

// ---------------------------------------------------------------- board questions (the tagger's util.py)

const attackersOf = (pos: Chess, color: Color, sq: Square): SquareSet => pos.kingAttackers(sq, color, pos.board.occupied);
const attacksFrom = (pos: Chess, sq: Square): SquareSet => {
  const piece = pos.board.get(sq);
  return piece ? attacks(piece, sq, pos.board.occupied) : SquareSet.empty();
};

/** Guarded by one of its own, also "through" an attacker on the same line (a defender behind the attacker's back). */
function isDefended(pos: Chess, piece: Piece, sq: Square): boolean {
  if (attackersOf(pos, piece.color, sq).nonEmpty()) return true;
  for (const attacker of attackersOf(pos, opposite(piece.color), sq)) {
    const a = pos.board.get(attacker);
    if (!a || !RAY.has(a.role)) continue;
    const without = pos.clone();
    without.board.take(attacker);
    if (without.kingAttackers(sq, piece.color, without.board.occupied).nonEmpty()) return true;
  }
  return false;
}
const isHanging = (pos: Chess, piece: Piece, sq: Square) => !isDefended(pos, piece, sq);

function canBeTakenByLowerPiece(pos: Chess, piece: Piece, sq: Square): boolean {
  for (const attacker of attackersOf(pos, opposite(piece.color), sq)) {
    const a = pos.board.get(attacker);
    if (a && a.role !== 'king' && VALUE[a.role] < VALUE[piece.role]) return true;
  }
  return false;
}

/** Attacked, and either unguarded or attacked by something cheaper. */
function isInBadSpot(pos: Chess, sq: Square): boolean {
  const piece = pos.board.get(sq);
  if (!piece) return false;
  return attackersOf(pos, opposite(piece.color), sq).nonEmpty() && (isHanging(pos, piece, sq) || canBeTakenByLowerPiece(pos, piece, sq));
}

/** The line a piece is pinned along to its own king, or null when it is not pinned. */
function pinLine(pos: Chess, color: Color, sq: Square): SquareSet | null {
  const king = pos.board.kingOf(color);
  if (king === undefined || king === sq) return null;
  const line = ray(king, sq);
  if (line.isEmpty()) return null;
  // nothing may stand between the king and the piece
  if (between(king, sq).intersect(pos.board.occupied).nonEmpty()) return null;
  for (const sniper of line.intersect(pos.board[opposite(color)])) {
    const p = pos.board.get(sniper);
    if (!p || !RAY.has(p.role)) continue;
    if (!attacks(p, sniper, SquareSet.empty()).has(sq)) continue; // the piece must move along this kind of line
    if (!between(sniper, king).has(sq)) continue; // the pinned piece is between the sniper and the king
    if (between(sniper, sq).intersect(pos.board.occupied).isEmpty()) return line;
  }
  return null;
}

/** A piece (not a pawn or the king) that is under attack and has no move to a square where it is safe. The side to move must own it. */
function isTrapped(pos: Chess, sq: Square): boolean {
  const piece = pos.board.get(sq);
  if (!piece || piece.color !== pos.turn) return false;
  if (pos.isCheck() || pinLine(pos, piece.color, sq)) return false;
  if (piece.role === 'pawn' || piece.role === 'king') return false;
  if (!isInBadSpot(pos, sq)) return false;
  for (const to of pos.dests(sq)) {
    const target = pos.board.get(to);
    if (target && VALUE[target.role] >= VALUE[piece.role]) return false;
    const next = pos.clone();
    next.play({ from: sq, to });
    if (!isInBadSpot(next, to)) return false;
  }
  return true;
}

const materialDiff = (pos: Chess, side: Color): number => {
  let diff = 0;
  for (const [, p] of pos.board) if (p.role !== 'king') diff += (p.color === side ? 1 : -1) * VALUE[p.role];
  return diff;
};

const checkersOf = (pos: Chess): SquareSet => {
  const king = pos.board.kingOf(pos.turn);
  return king === undefined ? SquareSet.empty() : attackersOf(pos, opposite(pos.turn), king);
};

// ---------------------------------------------------------------- the themes (the tagger's cook.py)

function fork(solver: Ply[], pov: Color): boolean {
  for (const ply of solver.slice(0, -1)) {
    const board = ply.after;
    if (isInBadSpot(board, ply.to)) continue;
    let n = 0;
    for (const sq of attacksFrom(board, ply.to)) {
      const piece = board.board.get(sq);
      if (!piece || piece.color === pov || piece.role === 'pawn') continue;
      if (VALUE[piece.role] > VALUE[ply.moved] || (isHanging(board, piece, sq) && !attackersOf(board, opposite(pov), ply.to).has(sq))) n++;
    }
    if (n > 1) return true;
  }
  return false;
}

/** The set-up move left a piece to be taken, and taking it is the solution. Needs the set-up move. */
function hangingPiece(plies: Ply[], pov: Color): boolean {
  const setup = plies[0];
  const first = plies[1];
  if (!setup || !first || setup.by === pov) return false;
  const captured = setup.after.board.get(first.to);
  if (setup.after.isCheck() && (!captured || captured.role === 'pawn')) return false;
  if (!captured || captured.role === 'pawn') return false;
  if (!isHanging(setup.after, captured, first.to)) return false;
  // the set-up move was itself a capture of something as valuable on that square: a trade, not a hung piece
  if (setup.taken && VALUE[setup.taken.role] >= VALUE[captured.role] && setup.to === first.to) return false;
  if (plies.length < 4) return true;
  return materialDiff(plies[3]!.after, pov) >= materialDiff(first.after, pov);
}

function trappedPiece(plies: Ply[], pov: Color): boolean {
  for (let i = 0; i < plies.length; i++) {
    const ply = plies[i]!;
    if (ply.by !== pov) continue;
    const prev = plies[i - 1];
    if (!prev || !solverIndex(plies, pov, i)) continue; // not the solver's first move
    let sq = ply.to;
    const captured = ply.before.board.get(sq);
    if (!captured || captured.role === 'pawn') continue;
    if (prev.to === sq) sq = prev.from;
    if (isTrapped(prev.before, sq)) return true;
  }
  return false;
}

/** Is `i` the index of a solver move other than the solver's first? */
function solverIndex(plies: Ply[], pov: Color, i: number): boolean {
  for (let k = 0; k < i; k++) if (plies[k]!.by === pov) return true;
  return false;
}

function discoveredCheck(solver: Ply[]): boolean {
  for (const ply of solver) {
    const checkers = checkersOf(ply.after);
    if (checkers.nonEmpty() && !checkers.has(ply.to)) return true;
  }
  return false;
}

function discoveredAttack(plies: Ply[], solver: Ply[], pov: Color): boolean {
  if (discoveredCheck(solver)) return true;
  for (let i = 0; i < plies.length; i++) {
    const ply = plies[i]!;
    if (ply.by !== pov || !solverIndex(plies, pov, i) || !ply.capture) continue;
    const reply = plies[i - 1];
    const prev = plies[i - 2];
    if (!reply || !prev) continue;
    if (reply.to === ply.to) return false;
    if (between(ply.from, ply.to).has(prev.from) && ply.to !== prev.to && ply.from !== prev.to && !prev.castle) return true;
  }
  return false;
}

function doubleCheck(solver: Ply[]): boolean {
  return solver.some((ply) => checkersOf(ply.after).size() > 1);
}

function skewer(plies: Ply[], pov: Color): boolean {
  for (let i = 0; i < plies.length; i++) {
    const ply = plies[i]!;
    if (ply.by !== pov || !solverIndex(plies, pov, i)) continue;
    const prev = plies[i - 1];
    if (!prev) continue;
    const capture = prev.after.board.get(ply.to);
    if (!capture || !RAY.has(ply.moved) || ply.after.isCheckmate()) continue;
    if (prev.to === ply.to || !between(ply.from, ply.to).has(prev.from)) continue;
    if (VALUE[prev.moved] > VALUE[capture.role] && isInBadSpot(prev.after, ply.to)) return true;
  }
  return false;
}

/** A pinned enemy piece cannot take what it attacks. */
function pinPreventsAttack(solver: Ply[], pov: Color): boolean {
  for (const ply of solver) {
    const board = ply.after;
    for (const [sq, piece] of board.board) {
      if (piece.color === pov) continue;
      const line = pinLine(board, piece.color, sq);
      if (!line) continue;
      for (const target of attacksFrom(board, sq)) {
        const attacked = board.board.get(target);
        if (attacked && attacked.color === pov && !line.has(target) && (VALUE[attacked.role] > VALUE[piece.role] || isHanging(board, attacked, target))) return true;
      }
    }
  }
  return false;
}

/** A pinned enemy piece is attacked and cannot move away. */
function pinPreventsEscape(solver: Ply[], pov: Color): boolean {
  for (const ply of solver) {
    const board = ply.after;
    for (const [sq, pinned] of board.board) {
      if (pinned.color === pov) continue;
      const line = pinLine(board, pinned.color, sq);
      if (!line) continue;
      for (const attackerSq of attackersOf(board, pov, sq)) {
        if (!line.has(attackerSq)) continue;
        const attacker = board.board.get(attackerSq)!;
        if (VALUE[pinned.role] > VALUE[attacker.role]) return true;
        // it could have moved off the line, were it not pinned
        const offLine = attacksFrom(board, sq).diff(board.board[pinned.color]).diff(line).nonEmpty();
        if (isHanging(board, pinned, sq) && !attackersOf(board, opposite(pov), attackerSq).has(sq) && offLine) return true;
      }
    }
  }
  return false;
}

function capturingDefender(plies: Ply[], pov: Color): boolean {
  for (let i = 0; i < plies.length; i++) {
    const ply = plies[i]!;
    if (ply.by !== pov || !solverIndex(plies, pov, i)) continue;
    const reply = plies[i - 1];
    const prev = plies[i - 2];
    if (!reply || !prev) continue;
    const capture = ply.before.board.get(ply.to);
    const winsLoosePiece = !!capture && ply.moved !== 'king' && VALUE[capture.role] <= VALUE[ply.moved] && isHanging(ply.before, capture, ply.to) && reply.to !== ply.to;
    if (!ply.after.isCheckmate() && !winsLoosePiece) continue;
    if (prev.after.isCheck() || prev.to === ply.from) continue;
    const init = prev.before;
    const defender = init.board.get(prev.to);
    if (defender && attackersOf(init, defender.color, ply.to).has(prev.to) && !init.isCheck()) return true;
  }
  return false;
}

function backRankMate(plies: Ply[], pov: Color): boolean {
  const end = plies.at(-1)?.after;
  if (!end || !end.isCheckmate()) return false;
  const king = end.board.kingOf(opposite(pov));
  if (king === undefined) return false;
  const backRank = pov === 'white' ? 7 : 0;
  if (squareRank(king) !== backRank) return false;
  const step = pov === 'white' ? -8 : 8;
  const front: Square[] = [king + step];
  if (squareFile(king) < 7) front.push(king + step + 1);
  if (squareFile(king) > 0) front.push(king + step - 1);
  for (const sq of front) {
    const piece = end.board.get(sq);
    // the king is shut in by its own men, not by the attacker's control of those squares
    if (!piece || piece.color === pov || attackersOf(end, pov, sq).nonEmpty()) return false;
  }
  for (const checker of checkersOf(end)) if (squareRank(checker) === backRank) return true;
  return false;
}

/** The mate is given by a knight to a king hemmed in on every side by its own men: Lichess tags that instead of a back-rank mate. */
function smotheredMate(plies: Ply[], pov: Color): boolean {
  const end = plies.at(-1)?.after;
  if (!end || !end.isCheckmate()) return false;
  const king = end.board.kingOf(opposite(pov));
  if (king === undefined) return false;
  for (const checker of checkersOf(end)) {
    if (end.board.get(checker)?.role !== 'knight') continue;
    let shutIn = true;
    for (const sq of attacks({ role: 'king', color: opposite(pov) }, king, SquareSet.empty())) {
      const piece = end.board.get(sq);
      if (!piece || piece.color === pov) shutIn = false;
    }
    if (shutIn) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the line

/**
 * The motifs of a line. `moves` are UCI, from `fen`. `solver` is the side whose tactics are
 * looked for; left out, it is the side that plays the **second** move (a puzzle: the first move
 * sets it up). Returns [] when a move is not legal.
 */
export function motifsOf(fen: string, moves: string[], solver?: Color): Motif[] {
  const pos = parsePosition(fen);
  if (!pos || !moves.length) return [];
  const plies: Ply[] = [];
  for (const uci of moves) {
    const move = uciToMove(pos, uci);
    if (!move || !('from' in move)) return [];
    const before = pos.clone();
    const piece = before.board.get(move.from)!;
    const target = before.board.get(move.to);
    const castle = piece.role === 'king' && (Math.abs(squareFile(move.from) - squareFile(move.to)) > 1 || (!!target && target.color === piece.color));
    const enPassant = piece.role === 'pawn' && !target && squareFile(move.from) !== squareFile(move.to);
    pos.play(move);
    plies.push({ before, after: pos.clone(), from: move.from, to: move.to, by: before.turn, moved: move.promotion ?? piece.role, taken: castle ? undefined : target, capture: (!!target && !castle) || enPassant, castle });
  }
  const pov = solver ?? opposite(plies[0]!.by);
  const mine = plies.filter((p) => p.by === pov);
  if (!mine.length) return [];
  const out: Motif[] = [];
  const end = plies.at(-1)!;
  if (end.after.isCheckmate() && end.by === pov) {
    const n = Math.min(5, mine.length);
    out.push(`mateIn${n}` as Motif);
    if (!smotheredMate(plies, pov) && backRankMate(plies, pov)) out.push('backRankMate');
  }
  if (fork(mine, pov)) out.push('fork');
  if (hangingPiece(plies, pov)) out.push('hangingPiece');
  if (trappedPiece(plies, pov)) out.push('trappedPiece');
  if (discoveredAttack(plies, mine, pov)) out.push('discoveredAttack');
  if (doubleCheck(mine)) out.push('doubleCheck');
  if (skewer(plies, pov)) out.push('skewer');
  if (pinPreventsAttack(mine, pov) || pinPreventsEscape(mine, pov)) out.push('pin');
  if (capturingDefender(plies, pov)) out.push('capturingDefender');
  return out;
}
