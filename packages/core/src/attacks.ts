// Attack maps, exchanges on a square, hanging pieces, and the checks / captures / threats lists.
// Pure board logic: no engine. Captures are always generated with the real rules, so a pinned
// piece is never counted as a capturer.

import type { NormalMove } from 'chessops/types';
import {
  Chess,
  ROLE_VALUE,
  describeMove,
  fenOf,
  legalMoves,
  makeSquare,
  opposite,
  parsePosition,
  passPosition,
  type Color,
  type MoveInfo,
  type Role,
  type Square,
} from './chess.ts';

export type PieceRef = { square: string; role: Role; color: Color };

const ORDER: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3.1, rook: 5, queen: 9, king: 100 };

function refAt(pos: Chess, sq: Square): PieceRef | null {
  const p = pos.board.get(sq);
  return p ? { square: makeSquare(sq), role: p.role, color: p.color } : null;
}

/** Every piece on the board. */
export function allPieces(pos: Chess): PieceRef[] {
  const out: PieceRef[] = [];
  for (const [sq, p] of pos.board) out.push({ square: makeSquare(sq), role: p.role, color: p.color });
  return out;
}

/** Pieces of `color` that attack `sq` geometrically (pins not considered). */
export function attackersOf(pos: Chess, sq: Square, color: Color): PieceRef[] {
  const out: PieceRef[] = [];
  for (const from of pos.kingAttackers(sq, color, pos.board.occupied)) {
    const r = refAt(pos, from);
    if (r) out.push(r);
  }
  return out.sort((a, b) => ORDER[a.role] - ORDER[b.role]);
}

/** Legal captures by the side to move that land on `sq` (en passant excluded), cheapest attacker first. */
function capturesOnto(pos: Chess, sq: Square): NormalMove[] {
  const target = pos.board.get(sq);
  if (!target || target.color === pos.turn) return [];
  const out: { move: NormalMove; order: number }[] = [];
  for (const [from, dests] of pos.allDests()) {
    if (!dests.has(sq)) continue;
    const piece = pos.board.get(from);
    if (!piece) continue;
    const promotes = piece.role === 'pawn' && (sq >= 56 || sq <= 7);
    out.push({ move: promotes ? { from, to: sq, promotion: 'queen' } : { from, to: sq }, order: ORDER[piece.role] });
  }
  return out.sort((a, b) => a.order - b.order).map((x) => x.move);
}

/** Best material result for the side to move from capturing on `sq` (it may decline: never below 0). */
function exchangeBest(pos: Chess, sq: Square): number {
  const target = pos.board.get(sq);
  if (!target) return 0;
  const caps = capturesOnto(pos, sq);
  if (!caps.length) return 0;
  const move = caps[0]!;
  const after = pos.clone();
  after.play(move);
  const gain = ROLE_VALUE[target.role] + (move.promotion ? 8 : 0) - exchangeBest(after, sq);
  return Math.max(0, gain);
}

/** Material result (in pawns) for the side to move if it plays this capture and both sides then trade sensibly on that square. */
export function captureGain(pos: Chess, move: NormalMove): number {
  const target = pos.board.get(move.to);
  const mover = pos.board.get(move.from);
  let value = target ? ROLE_VALUE[target.role] : 0;
  if (!target && mover?.role === 'pawn' && move.to === pos.epSquare) value = 1;
  const after = pos.clone();
  after.play(move);
  return value + (move.promotion ? ROLE_VALUE[move.promotion] - 1 : 0) - exchangeBest(after, move.to);
}

export type Capturable = {
  piece: PieceRef;
  /** legal capturers, cheapest first */
  attackers: PieceRef[];
  /** own pieces that guard the square (geometric) */
  defenders: PieceRef[];
  /** best material result for the capturing side, in pawns: > 0 means the piece is lost */
  net: number;
  /** the SAN of the capture that gets that result */
  bestCapture: string;
};

/**
 * Every enemy piece the side to move can legally capture, with the exchange result.
 * `net > 0` = "hanging": capturing wins material in the trade on that square.
 */
export function capturables(pos: Chess): Capturable[] {
  const out: Capturable[] = [];
  const them = opposite(pos.turn);
  for (const [sq, p] of pos.board) {
    if (p.color !== them || p.role === 'king') continue;
    const caps = capturesOnto(pos, sq);
    if (!caps.length) continue;
    let best = -Infinity;
    let bestMove = caps[0]!;
    for (const m of caps) {
      const g = captureGain(pos, m);
      if (g > best) {
        best = g;
        bestMove = m;
      }
    }
    out.push({
      piece: { square: makeSquare(sq), role: p.role, color: p.color },
      attackers: caps.map((m) => refAt(pos, m.from)!).filter(Boolean),
      defenders: attackersOf(pos, sq, them),
      net: best,
      bestCapture: describeMove(pos, bestMove).san,
    });
  }
  return out.sort((a, b) => b.net - a.net || ROLE_VALUE[b.piece.role] - ROLE_VALUE[a.piece.role]);
}

export type Cct = { checks: string[]; captures: string[]; threats: string[]; mates: string[] };

const hangingKeys = (pos: Chess): Set<string> =>
  new Set(
    capturables(pos)
      .filter((c) => c.net > 0)
      .map((c) => `${c.piece.square}:${c.net}`),
  );

/**
 * Checks, captures and threats for the side to move, as SAN lists.
 * A "threat" is a quiet move after which the mover could win material next turn that it could
 * not win before, while the piece that moved cannot simply be taken for free.
 */
export function cctOf(pos: Chess, limit = 8): Cct {
  const moves = legalMoves(pos);
  const checks = moves.filter((m) => m.check && !m.mate).map((m) => m.san);
  const mates = moves.filter((m) => m.mate).map((m) => m.san);
  const captures = moves
    .filter((m) => m.captured)
    .sort((a, b) => ROLE_VALUE[b.captured!] - ROLE_VALUE[a.captured!] || ROLE_VALUE[a.role] - ROLE_VALUE[b.role])
    .map((m) => m.san);
  const before = hangingKeys(pos);
  const threats: string[] = [];
  for (const m of moves) {
    if (m.captured || m.check) continue;
    if (threatensAfter(m, before, pos.turn)) threats.push(m.san);
    if (threats.length >= limit) break;
  }
  return { checks: checks.slice(0, limit), captures: captures.slice(0, limit), threats, mates };
}

function threatensAfter(m: MoveInfo, before: Set<string>, mover: Color): boolean {
  const after = parsePosition(m.fenAfter);
  if (!after) return false;
  // is the moved piece simply lost on its new square?
  const lost = capturables(after).some((c) => c.piece.square === m.to && c.net > 0);
  if (lost) return false;
  const passed = passPosition(m.fenAfter);
  if (!passed) return false;
  const again = parsePosition(passed);
  if (!again || again.turn !== mover) return false;
  for (const key of hangingKeys(again)) if (!before.has(key)) return true;
  return false;
}

/** Enemy pieces attacked by a given piece (geometric), used for "what does this piece attack?". */
export function attackedBy(pos: Chess, from: Square): PieceRef[] {
  const piece = pos.board.get(from);
  if (!piece) return [];
  const out: PieceRef[] = [];
  for (const [sq, p] of pos.board) {
    if (p.color === piece.color) continue;
    if (pos.kingAttackers(sq, piece.color, pos.board.occupied).has(from)) out.push({ square: makeSquare(sq), role: p.role, color: p.color });
  }
  return out;
}

/** Does the piece on `from` geometrically attack / guard the square `to`? */
export function attacksSquare(pos: Chess, from: Square, to: Square): boolean {
  const piece = pos.board.get(from);
  if (!piece) return false;
  return pos.kingAttackers(to, piece.color, pos.board.occupied).has(from);
}

export type Material = { white: number; black: number; diff: number; whitePieces: Record<Role, number>; blackPieces: Record<Role, number> };

export function materialOf(pos: Chess): Material {
  const count = (color: Color): Record<Role, number> => ({
    pawn: pos.board.pieces(color, 'pawn').size(),
    knight: pos.board.pieces(color, 'knight').size(),
    bishop: pos.board.pieces(color, 'bishop').size(),
    rook: pos.board.pieces(color, 'rook').size(),
    queen: pos.board.pieces(color, 'queen').size(),
    king: 1,
  });
  const sum = (c: Record<Role, number>) => c.pawn + 3 * c.knight + 3 * c.bishop + 5 * c.rook + 9 * c.queen;
  const whitePieces = count('white');
  const blackPieces = count('black');
  const white = sum(whitePieces);
  const black = sum(blackPieces);
  return { white, black, diff: white - black, whitePieces, blackPieces };
}

const PLURAL: Record<Role, string> = { pawn: 'pawns', knight: 'knights', bishop: 'bishops', rook: 'rooks', queen: 'queens', king: 'kings' };

/** "a knight", "two pawns", "a rook for a bishop"… what `color` has that the other side does not. */
function surplus(mine: Record<Role, number>, theirs: Record<Role, number>): string[] {
  const out: string[] = [];
  for (const role of ['queen', 'rook', 'bishop', 'knight', 'pawn'] as const) {
    const d = mine[role] - theirs[role];
    if (d === 1) out.push(`a ${role}`);
    else if (d === 2) out.push(`two ${PLURAL[role]}`);
    else if (d > 2) out.push(`${d} ${PLURAL[role]}`);
  }
  return out;
}

const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** Material balance in plain words, from `you`'s point of view. */
export function materialInWords(m: Material, you: Color): string {
  const mine = you === 'white' ? m.whitePieces : m.blackPieces;
  const theirs = you === 'white' ? m.blackPieces : m.whitePieces;
  const up = surplus(mine, theirs);
  const down = surplus(theirs, mine);
  const diff = you === 'white' ? m.diff : -m.diff;
  if (!up.length && !down.length) return 'Material is level.';
  if (up.length && !down.length) return `You are up ${joinList(up)}.`;
  if (!up.length && down.length) return `You are down ${joinList(down)}.`;
  const verdict = diff > 0 ? 'you are ahead in material' : diff < 0 ? 'you are behind in material' : 'material is about level';
  return `You have ${joinList(up)} for ${joinList(down)}: ${verdict}.`;
}

const ROLES = ['queen', 'rook', 'bishop', 'knight', 'pawn'] as const;

function countList(counts: Record<string, number>): string[] {
  const out: string[] = [];
  for (const role of ROLES) {
    const d = counts[role] ?? 0;
    if (d === 1) out.push(`a ${role}`);
    else if (d === 2) out.push(`two ${PLURAL[role]}`);
    else if (d > 2) out.push(`${d} ${PLURAL[role]}`);
  }
  return out;
}

/**
 * What changed in material between two positions, from `you`'s point of view, in plain words.
 * Like-for-like trades are left out: a beginner needs "you lose a knight", not the whole ledger.
 */
export function materialChangeInWords(beforeFen: string, afterFen: string, you: Color): { delta: number; text: string } | null {
  const a = parsePosition(beforeFen);
  const b = parsePosition(afterFen);
  if (!a || !b) return null;
  const ma = materialOf(a);
  const mb = materialOf(b);
  const mineA = you === 'white' ? ma.whitePieces : ma.blackPieces;
  const mineB = you === 'white' ? mb.whitePieces : mb.blackPieces;
  const theirsA = you === 'white' ? ma.blackPieces : ma.whitePieces;
  const theirsB = you === 'white' ? mb.blackPieces : mb.whitePieces;
  const delta = (you === 'white' ? mb.diff : -mb.diff) - (you === 'white' ? ma.diff : -ma.diff);
  const netMe: Record<string, number> = {};
  const netThem: Record<string, number> = {};
  let traded = 0;
  let promoted = false;
  for (const role of ROLES) {
    const lostMe = mineA[role] - mineB[role];
    const lostThem = theirsA[role] - theirsB[role];
    if (lostMe < 0 || lostThem < 0) promoted = true;
    const common = Math.max(0, Math.min(lostMe, lostThem));
    traded += common;
    netMe[role] = Math.max(0, lostMe) - common;
    netThem[role] = Math.max(0, lostThem) - common;
  }
  if (promoted) {
    const text = delta > 0 ? 'you come out well ahead in material after a pawn promotes' : delta < 0 ? 'you end up well behind in material after a pawn promotes' : 'material stays level';
    return { delta, text };
  }
  const me = countList(netMe);
  const them = countList(netThem);
  let text: string;
  if (!me.length && !them.length) text = traded ? 'pieces are traded evenly' : 'no material changes hands';
  else if (them.length && !me.length) text = `you win ${joinList(them)}`;
  else if (me.length && !them.length) text = `you lose ${joinList(me)}`;
  else if (delta === 0) text = `an even trade (${joinList(me)} for ${joinList(them)})`;
  else if (delta > 0) text = `you win ${joinList(them)} for ${joinList(me)}`;
  else text = `you lose ${joinList(me)} for ${joinList(them)}`;
  return { delta, text };
}

export { fenOf };
