// "What's the threat?" (feature C8; PLAN WP 6.7): positions from the owner's games where their
// opponent had a threat and the owner's move let it happen. The owner first names the threat, by
// making the move the opponent would play if it were their turn, then finds a move that deals with
// it. It trains the first step of the thinking routine: "what does their last move want?"
//
// The threat, every move that does as much, and the verdicts are the engine's; what a threat wins
// is worked out by code from the line the engine gives (D33).

import { anyToMove, describeMove, parsePosition, passPosition } from './chess.ts';
import type { GateResult } from './content.ts';

/** What one of their moves would do with the turn passed: a mate, or material won. */
export type ThreatResult = {
  san: string;
  from: string;
  to: string;
  /** mate in this many of their moves, when it mates */
  mate?: number;
  /** material from the owner's side once the captures have run their course (negative: the owner loses) */
  delta: number;
  /** in words, from the owner's side: "it would be checkmate", "you would lose a knight" */
  what: string;
};

/** A mate further away than this is not a threat a beginner can be asked to name. */
export const THREAT_MATE_MAX = 3;

/** Does the move win something: a mate a beginner can see, or at least a pawn? */
export function isThreat(r: ThreatResult): boolean {
  return (r.mate !== undefined && r.mate <= THREAT_MATE_MAX) || (r.mate === undefined && r.delta <= -1);
}

/** Is `r` as strong a threat as `main`? A near mate always is; material counts when it wins as much. */
export function asStrongAs(r: ThreatResult, main: ThreatResult): boolean {
  if (!isThreat(r)) return false;
  if (r.mate !== undefined) return true;
  return main.mate === undefined && r.delta <= main.delta;
}

/** The words for what a threat wins, from the line's result. */
export function threatWords(mate: number | undefined, change: { delta: number; text: string } | null): string {
  if (mate !== undefined) return mate <= 1 ? 'it would be checkmate' : `it would lead to checkmate in ${mate}`;
  if (!change) return 'nothing changes hands';
  return change.text.replace(/^you (lose|end up|win|come out)\b/, 'you would $1');
}

export type ThreatItem = {
  /** the position, with the owner to move */
  fen: string;
  /** their move that led here, when it is known */
  lastMove?: { san: string; from: string; to: string };
  /** their strongest threat */
  threat: ThreatResult;
  /** their other moves that threaten as much (each counts as naming the threat) */
  accepted: string[];
  /** the engine's first choice for the owner, which deals with it, and why */
  best: { san: string; why: string };
  /** the move played in the game, and what it ran into */
  played: { san: string; why: string };
};

/** Gate V1 for a threat item: a valid position and every move legal where it is played. */
export function gateV1Threat(item: ThreatItem): GateResult {
  const fail = (detail: string): GateResult => ({ gate: 'V1', result: 'fail', detail });
  const pos = parsePosition(item.fen);
  if (!pos) return fail('the position is not valid');
  const passFen = passPosition(item.fen);
  const pass = passFen ? parsePosition(passFen) : null;
  if (!pass) return fail('the position cannot be looked at with the turn passed (the owner is in check)');
  const threat = anyToMove(pass, item.threat.san);
  if (!threat) return fail(`their threat ${item.threat.san} is not legal with the turn passed`);
  const info = describeMove(pass, threat);
  if (info.from !== item.threat.from || info.to !== item.threat.to) return fail(`the squares of ${item.threat.san} are wrong`);
  if (!isThreat(item.threat)) return fail(`${item.threat.san} wins nothing`);
  for (const san of item.accepted) if (!anyToMove(pass, san)) return fail(`${san} is not legal with the turn passed`);
  for (const m of [item.best.san, item.played.san]) if (!anyToMove(pos, m)) return fail(`${m} is not legal in the position`);
  if (item.best.san === item.played.san) return fail('the engine chose the move that was played');
  if (!item.threat.what.trim() || !item.best.why.trim() || !item.played.why.trim()) return fail('every move needs its reason');
  return { gate: 'V1', result: 'pass' };
}

/** The hint for naming the threat, a rung at a time: a question, then the piece, then the threat itself. */
export function threatHint(item: ThreatItem, rung: 1 | 2): string {
  if (rung === 1) return item.lastMove ? `Look at their last move, ${item.lastMove.san}. What does it attack now, or what does it make possible?` : 'If it were their move, what could they capture, or where could they give check?';
  return 'The piece with the circle is the one that makes the threat.';
}
