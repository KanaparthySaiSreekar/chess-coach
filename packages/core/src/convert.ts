// Win-the-won-game drills (feature C9; PLAN WP 6.8): positions from the owner's games where they
// were clearly winning and did not win, played out against the engine. Nearly half of the
// blunders at 400–600 come in positions that were already won (LEARNING §2), so finishing a won
// game is a skill of its own.
//
// Where a drill starts, and when it is over, are decided by code from the engine's numbers: the
// owner's winning chances (Lichess's formula, 0..100) before and after each of their moves.

import type { Color } from './chess.ts';
import { anyToMove, gameStatus, parsePosition } from './chess.ts';
import type { GateResult } from './content.ts';
import type { Outcome } from './games.ts';
import type { GamePly } from './review.ts';

/** The owner's winning chances from which a position counts as clearly won (about a piece up). */
export const WINNING_AT = 80;
/** Below this after one of the owner's moves, the win is gone: the move threw it away. */
export const THROWN_BELOW = 65;

export type ConvertItem = {
  /** the position, with the owner to move and clearly winning */
  fen: string;
  /** the owner's winning chances there when the item was made (0..100) */
  chances: number;
  /** what happened in the game: the move played from here, whether it threw the win away, and the result */
  game: { outcome: 'draw' | 'loss'; played?: string; threw?: string };
};

export type ConvertOutcome = 'converted' | 'kept' | 'thrown' | 'drawn' | 'gave_up';

/**
 * Where to start a drill from a game the owner did not win: the position before the move that took
 * a clearly won position below THROWN_BELOW, or else the last clearly won position they had.
 * Null for a game they won, or one where they were never clearly winning.
 */
export function conversionStart(plies: GamePly[], you: Color, outcome: Outcome | undefined): { ply: GamePly; chances: number; threw?: string } | null {
  if (outcome !== 'draw' && outcome !== 'loss') return null;
  const mine = (p: GamePly | undefined) => (p?.whiteWin === undefined ? undefined : you === 'white' ? p.whiteWin : 100 - p.whiteWin);
  let last: { ply: GamePly; chances: number } | null = null;
  for (let i = 1; i < plies.length; i++) {
    const p = plies[i]!;
    if (p.by !== you) continue;
    const before = mine(plies[i - 1]);
    if (before === undefined || before < WINNING_AT) continue;
    const after = mine(p);
    if (after !== undefined && after < THROWN_BELOW) return { ply: p, chances: before, threw: p.san };
    last = { ply: p, chances: before };
  }
  return last;
}

/** Gate V1 for a drill: a valid position that is not over, and the move that threw the win legal in it. */
export function gateV1Convert(item: ConvertItem): GateResult {
  const fail = (detail: string): GateResult => ({ gate: 'V1', result: 'fail', detail });
  const pos = parsePosition(item.fen);
  if (!pos) return fail('the position is not valid');
  if (gameStatus(pos).over) return fail('the game is already over in the position');
  for (const m of [item.game.played, item.game.threw]) if (m && !anyToMove(pos, m)) return fail(`${m} is not legal in the position`);
  if (!(item.chances >= WINNING_AT)) return fail('the position is not clearly winning');
  return { gate: 'V1', result: 'pass' };
}

/** What the end of a drill says, in words. */
export function convertWords(outcome: ConvertOutcome, o: { moves: number; draw?: string } = { moves: 0 }): string {
  switch (outcome) {
    case 'converted':
      return 'Checkmate: you won it.';
    case 'kept':
      return `Still winning after ${o.moves} of your moves: you kept the win, but it is not finished yet.`;
    case 'thrown':
      return 'That move gave the win away.';
    case 'drawn':
      return `A draw (${o.draw ?? 'the game is drawn'}): the win slipped away.`;
    case 'gave_up':
      return 'You stopped here.';
  }
}
