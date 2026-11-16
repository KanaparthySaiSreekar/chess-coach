// The trap pack (feature D8; CONTENT §7; PLAN WP 8.9): opening traps drilled as recognition cards in
// the opening drill. Each trap is a position the opponent's last move set up: either a trap to avoid
// (they hope for a natural-looking move that loses) or one the owner springs (their last move was a
// mistake). The pack is authored in content/traps.json and goes through the gates like any content
// (V1, V2, V3, V4, V6, V7): the defence is checked by the engine, and so is the move they hope for.

import { describeMove, fenOf, mustPosition, sanToMove, START_FEN, type Color } from './chess.ts';
import type { GateResult } from './content.ts';

/** One trap as authored (content/traps.json). */
export type TrapFile = {
  id: string;
  name: string;
  side: Color;
  /** avoid: they hope for `hope`; punish: their last move was a mistake and `move` takes advantage of it */
  kind: 'avoid' | 'punish';
  /** SAN from the start, up to and including the opponent's move that sets the trap */
  moves: string;
  hope?: string;
  /** the owner's move here (the engine checks it in V2) */
  move: string;
  /** the move's why, and what the opponent hopes for (or what their mistake allows): checked by V3 */
  why?: string;
  idea?: string;
  themes: string[];
};

/** A trap as stored (a content item of type `trap`). */
export type TrapItem = {
  id: string;
  name: string;
  colour: Color;
  kind: 'avoid' | 'punish';
  startFen: string;
  /** SAN from the start to the trap position */
  line: string[];
  /** the trap position, the owner to move */
  fen: string;
  hope?: { san: string; uci: string };
  move: { san: string; uci: string };
  /** other moves the engine finds as sound here (engine style), filled in by V2 */
  accepted: string[];
  why?: string;
  idea?: string;
  themes: string[];
};

/** A trap is drilled only when players at the owner's level really reach its position this often (V4). */
export const TRAP_MIN_GAMES = 100;

export function trapKey(id: string): string {
  return `trap:${id}`;
}

/** The authored trap → the stored one, with V1: a legal line ending with the owner to move, legal moves in it. */
export function readTrap(t: TrapFile): { ok: true; item: TrapItem } | { ok: false; reason: string } {
  if (!/^[a-z0-9-]{2,40}$/.test(t.id ?? '')) return { ok: false, reason: `"${t.id}" is not a usable id` };
  if (t.side !== 'white' && t.side !== 'black') return { ok: false, reason: 'the side must be white or black' };
  if (t.kind !== 'avoid' && t.kind !== 'punish') return { ok: false, reason: 'the kind must be avoid or punish' };
  const pos = mustPosition(START_FEN);
  const line: string[] = [];
  for (const san of (t.moves ?? '').split(/\s+/).filter(Boolean)) {
    const m = sanToMove(pos, san);
    if (!m) return { ok: false, reason: `${san} is not a legal move after ${line.join(' ') || 'the start'}` };
    line.push(describeMove(pos, m).san);
    pos.play(m);
  }
  if (!line.length) return { ok: false, reason: 'the trap has no moves' };
  if (pos.turn !== t.side) return { ok: false, reason: `after the moves it is not ${t.side === 'white' ? 'White' : 'Black'} to move` };
  const fen = fenOf(pos);
  const at = (san: string | undefined) => {
    if (!san) return undefined;
    const p = mustPosition(fen);
    const m = sanToMove(p, san);
    return m ? { san: describeMove(p, m).san, uci: describeMove(p, m).uci } : null;
  };
  const move = at(t.move);
  if (!move) return { ok: false, reason: `${t.move} is not a legal move in the trap position` };
  const hope = at(t.hope);
  if (hope === null) return { ok: false, reason: `${t.hope} is not a legal move in the trap position` };
  if (t.kind === 'avoid' && !hope) return { ok: false, reason: 'a trap to avoid needs the move they hope for' };
  return { ok: true, item: { id: t.id, name: t.name, colour: t.side, kind: t.kind, startFen: START_FEN, line, fen, hope, move, accepted: [], why: t.why?.trim() || undefined, idea: t.idea?.trim() || undefined, themes: t.themes ?? [] } };
}

export function gateV1Trap(t: TrapFile): GateResult {
  const r = readTrap(t);
  return r.ok ? { gate: 'V1', result: 'pass' } : { gate: 'V1', result: 'fail', detail: r.reason };
}
