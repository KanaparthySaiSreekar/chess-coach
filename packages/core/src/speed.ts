// The optional puzzle modes (features C6, I4; PLAN WP 6.10). Both are off by default: speed is
// secondary at the owner's level, and Woodpecker rounds were built for stronger players (FEATURES
// §7). Speed runs use database puzzles that get harder as the run goes on; they are silent (no
// hints, no explanations: the coach stays out of a run), and their answers move neither the
// schedule, nor the practice level, nor motif mastery (they are logged as second goes, D68).

export type SpeedMode = 'streak' | 'timed';

export const SPEED = {
  /** a run starts this far below the owner's practice level */
  startBelow: 300,
  /** the lowest rating a run starts at */
  floor: 400,
  /** how much harder each puzzle solved makes the next */
  step: { streak: 60, timed: 40 } as Record<SpeedMode, number>,
  /** a wrong move in a timed run costs this much time */
  penaltyMs: 10_000,
};

/** The rating of the next puzzle in a run, after `solved` puzzles solved. */
export function speedRating(mode: SpeedMode, level: number, solved: number): number {
  return Math.max(SPEED.floor, level - SPEED.startBelow) + SPEED.step[mode] * solved;
}

/** A Woodpecker round, as the page shows it: how long it took, and how many were solved, alone. */
export type WoodpeckerRound = { round: number; ms?: number; solved: number; alone: number; done: number };

/** How a finished round compares with the one before: the time it took, as a share of the last. */
export function roundPace(rounds: WoodpeckerRound[]): number | undefined {
  const done = rounds.filter((r) => r.ms !== undefined);
  if (done.length < 2) return undefined;
  const [prev, last] = done.slice(-2) as [WoodpeckerRound, WoodpeckerRound];
  return prev.ms! > 0 ? last.ms! / prev.ms! : undefined;
}
