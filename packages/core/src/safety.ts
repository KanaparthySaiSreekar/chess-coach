// The safety check (feature C7; PLAN WP 6.6): "Is this move safe?" and "Which of these two moves
// is not safe?", from positions of the owner's own games. Not safe means it loses material by
// force or allows a mate. It trains the last step of the
// thinking routine, the blunder check, on its own: no move has to be found, only judged.
//
// The verdicts and the reasons are the engine's checked facts (D33). Each item asks about moves
// from one position: the move the owner played (which lost something) and a move that was safe.
//
// Before ruling on one move, the owner can first be asked to make each of the opponent's checks and
// captures after it (setting safety.listFirst): the habit itself. Those are worked out by code,
// exactly. Their threats too (safety.listThreats, 2026-11-17): D64 left them out for want of an exact
// definition; the app's own one is used now, the one its reasons say "it attacks your …" with: a quiet
// reply after which something of the owner's can be won that could not before (`moveReasons`).

import { anyToMove, describeMove, legalMoves, mustPosition, parsePosition } from './chess.ts';
import type { GateResult } from './content.ts';
import { moveReasons } from './facts.ts';

export type SafetyCandidate = {
  san: string;
  /** safe: it loses nothing by force and allows no mate */
  safe: boolean;
  /** what the engine's fact says the move does or runs into, in plain words */
  why: string;
};

export type SafetyItem = {
  /** the position, with the side to move the owner's */
  fen: string;
  /** one move to judge, or two to tell apart */
  question: 'is_safe' | 'which_loses';
  candidates: SafetyCandidate[];
  /** the move the owner played in the game: shown once it is over */
  played?: string;
};

/**
 * One of the opponent's checks, captures or threats after the move being judged; `attacks` says what a
 * threat goes after, in the app's words ("your knight on {sq:c3}").
 */
export type SafetyReply = { san: string; from: string; to: string; check: boolean; capture: boolean; threat?: boolean; attacks?: string };

/**
 * The position after the move being judged, and every check and capture the opponent then has
 * (a promotion counted once); with `threats`, also every quiet move of theirs that attacks something of
 * the owner's it could then win (the app's "it attacks your …"). Null when the move is not legal.
 */
export function forcingReplies(fen: string, san: string, opts: { threats?: boolean } = {}): { fen: string; lastMove: [string, string]; replies: SafetyReply[] } | null {
  const pos = parsePosition(fen);
  const move = pos ? anyToMove(pos, san) : null;
  if (!pos || !move) return null;
  const info = describeMove(pos, move);
  const seen = new Set<string>();
  const replies: SafetyReply[] = [];
  for (const m of legalMoves(mustPosition(info.fenAfter))) {
    if (seen.has(m.from + m.to)) continue;
    if (m.check || m.captured) {
      seen.add(m.from + m.to);
      replies.push({ san: m.san, from: m.from, to: m.to, check: m.check, capture: !!m.captured });
      continue;
    }
    if (!opts.threats) continue;
    const attack = moveReasons(info.fenAfter, m.san, pos.turn).find((r) => r.tag === 'attacks');
    if (!attack) continue;
    seen.add(m.from + m.to);
    replies.push({ san: m.san, from: m.from, to: m.to, check: false, capture: false, threat: true, attacks: attack.text.replace(/^it attacks /, '') });
  }
  return { fen: info.fenAfter, lastMove: [info.from, info.to], replies };
}

/** Gate V1 for a safety item: a valid position, legal moves, and a question that has one answer. */
export function gateV1Safety(item: SafetyItem): GateResult {
  const fail = (detail: string): GateResult => ({ gate: 'V1', result: 'fail', detail });
  const pos = parsePosition(item.fen);
  if (!pos) return fail('the position is not valid');
  for (const c of item.candidates) if (!anyToMove(pos, c.san)) return fail(`${c.san} is not legal in the position`);
  if (item.question === 'is_safe' && item.candidates.length !== 1) return fail('"is this move safe?" asks about exactly one move');
  if (item.question === 'which_loses') {
    if (item.candidates.length !== 2) return fail('"which of these two is not safe?" needs two moves');
    if (item.candidates.filter((c) => !c.safe).length !== 1) return fail('exactly one of the two moves must be unsafe');
    if (item.candidates[0]!.san === item.candidates[1]!.san) return fail('the two moves are the same');
  }
  if (item.candidates.some((c) => !c.why.trim())) return fail('every move needs its reason');
  return { gate: 'V1', result: 'pass' };
}

/**
 * The reason shown for a move: the engine's fact about it, without the sentence on what an unsafe
 * move "does manage" (true, but beside the point when the question is whether the move is safe).
 */
export function safetyReason(text: string): string {
  return text.replace(/ What it does manage: [^.]*\./, '').trim();
}

/** Where a candidate move goes, for the arrow on the board. */
export function candidateArrow(fen: string, san: string): { from: string; to: string } | null {
  const pos = parsePosition(fen);
  const move = pos ? anyToMove(pos, san) : null;
  if (!pos || !move) return null;
  const info = describeMove(pos, move);
  return { from: info.from, to: info.to };
}

/** Is the owner's answer right? For "is it safe?" a yes or a no; for "which is not safe?" the move they picked. */
export function judgeSafety(item: SafetyItem, answer: { safe?: boolean; pick?: string }): boolean {
  if (item.question === 'is_safe') return answer.safe === item.candidates[0]!.safe;
  const loser = item.candidates.find((c) => !c.safe)!;
  return answer.pick === loser.san;
}
