// Winning chances instead of centipawns (decision D25, ARCHITECTURE §8).

/** An engine score from one side's point of view. Exactly one of cp / mate is set. */
export type Score = { cp?: number; mate?: number };

/** Lichess's formula: centipawns → winning chances in 0..100. */
export function winChanceFromCp(cp: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** Winning chances (0..100) for the side the score belongs to. A forced mate is 100 or 0. */
export function winChance(score: Score): number {
  if (score.mate !== undefined) return score.mate > 0 ? 100 : 0;
  return winChanceFromCp(score.cp ?? 0);
}

export function flipScore(score: Score): Score {
  return score.mate !== undefined ? { mate: -score.mate } : { cp: -(score.cp ?? 0) };
}

export type MoveClass = 'ok' | 'inaccuracy' | 'mistake' | 'blunder';
export type Thresholds = { inaccuracy: number; mistake: number; blunder: number };
export const DEFAULT_THRESHOLDS: Thresholds = { inaccuracy: 5, mistake: 10, blunder: 15 };

/** Drop in winning chances (mover's side): best move vs the move played. Never negative. */
export function dropOf(bestForMover: Score, playedForMover: Score): number {
  return Math.max(0, winChance(bestForMover) - winChance(playedForMover));
}

export function classifyDrop(drop: number, t: Thresholds = DEFAULT_THRESHOLDS): MoveClass {
  if (drop >= t.blunder) return 'blunder';
  if (drop >= t.mistake) return 'mistake';
  if (drop >= t.inaccuracy) return 'inaccuracy';
  return 'ok';
}

/** A live position is one that is still undecided for the mover (between 10 and 90). */
export function isLive(moverScore: Score): boolean {
  const w = winChance(moverScore);
  return w > 10 && w < 90;
}

/**
 * A live move: one played while the game was still undecided for the mover, or one that made a
 * won game undecided again (or lost). A move that throws a win away is the turning point of the
 * game, although the position before it was "decided"; a move in a won game that keeps it won,
 * and any move in a lost game, is not live.
 */
export function isLiveMove(bestForMover: Score, playedForMover: Score): boolean {
  return isLive(bestForMover) || (winChance(bestForMover) >= 90 && winChance(playedForMover) < 90);
}

/** Plain words for a position's balance, from the given side's point of view. No numbers. */
export function balanceInWords(score: Score): string {
  if (score.mate !== undefined) return score.mate > 0 ? `winning: you have a forced checkmate in ${score.mate}` : `losing: they have a forced checkmate in ${-score.mate}`;
  const w = winChance(score);
  if (w >= 90) return 'winning';
  if (w >= 70) return 'clearly better';
  if (w >= 58) return 'a bit better';
  if (w > 42) return 'about equal';
  if (w > 30) return 'a bit worse';
  if (w > 10) return 'clearly worse';
  return 'losing';
}
