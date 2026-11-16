// Motif mastery (feature G7; PLAN WP 6.9): accuracy, solve time and hint level per motif, from the
// owner's own puzzle attempts, and the stage that sets how much guidance a puzzle on that motif
// gets: a worked example for a new idea, the idea named while it is still new, nothing once it is
// known, and mixed in with the others (its name hidden) once it is mastered. LEARNING §3 (worked
// examples first, expertise reversal; mixing once known) and principles DP3 and DP9.
//
// Counted from the attempts each time, never stored, so it always agrees with the history.

export type MotifStage = 'example' | 'partial' | 'full' | 'mixed';
export const STAGES: MotifStage[] = ['example', 'partial', 'full', 'mixed'];

/** One answer to a puzzle, with the puzzle's themes. Only first goes count (a second go is remembered, not retrieved). */
export type MotifAttempt = { themes: string[]; result: 'solved' | 'shown'; hints: number; misses: number; ms: number; at: string; again?: boolean };

export type MotifMastery = {
  motif: string;
  /** first goes on puzzles with this motif, all time */
  attempts: number;
  /** how many of the latest (up to RULES.window) the numbers below are from */
  recent: number;
  /** of those: solved at all, and solved alone (no hint, no miss) */
  solved: number;
  alone: number;
  /** alone / recent, 0..1 */
  accuracy: number;
  /** the hints a puzzle needed, on average */
  meanHints: number;
  /** the middle solve time of the ones solved alone, in milliseconds */
  medianMs?: number;
  stage: MotifStage;
};

/** The thresholds of the stages (TRACKER D67). */
export const RULES = {
  /** the latest first goes that count */
  window: 10,
  /** full: at least this many tries, and at least this share solved alone */
  full: { attempts: 3, accuracy: 0.5 },
  /** mixed: at least this many tries, this share solved alone, and solved alone in this time or less (the middle one) */
  mixed: { attempts: 6, accuracy: 0.8, medianMs: 60_000 },
};

/** The stage for a motif's numbers. No tries yet: a worked example comes first. */
export function stageOf(m: Pick<MotifMastery, 'attempts' | 'accuracy' | 'medianMs'>): MotifStage {
  if (m.attempts === 0) return 'example';
  if (m.attempts < RULES.full.attempts || m.accuracy < RULES.full.accuracy) return 'partial';
  if (m.attempts >= RULES.mixed.attempts && m.accuracy >= RULES.mixed.accuracy && m.medianMs !== undefined && m.medianMs <= RULES.mixed.medianMs) return 'mixed';
  return 'full';
}

/** Mastery for every motif in the history, the most practised first. `notMotif` drops tags that are not ideas (length, phase, rating band). */
export function motifMastery(history: MotifAttempt[], notMotif: ReadonlySet<string> = new Set()): MotifMastery[] {
  const by = new Map<string, MotifAttempt[]>();
  for (const a of [...history].filter((x) => !x.again).sort((x, y) => x.at.localeCompare(y.at))) {
    for (const t of new Set(a.themes)) {
      if (notMotif.has(t)) continue;
      by.set(t, [...(by.get(t) ?? []), a]);
    }
  }
  const out: MotifMastery[] = [];
  for (const [motif, all] of by) {
    const recent = all.slice(-RULES.window);
    const alone = recent.filter((a) => a.result === 'solved' && a.hints === 0 && a.misses === 0);
    const times = alone.map((a) => a.ms).sort((x, y) => x - y);
    const m = {
      motif,
      attempts: all.length,
      recent: recent.length,
      solved: recent.filter((a) => a.result === 'solved').length,
      alone: alone.length,
      accuracy: recent.length ? alone.length / recent.length : 0,
      meanHints: recent.length ? recent.reduce((s, a) => s + a.hints, 0) / recent.length : 0,
      medianMs: times.length ? times[Math.floor((times.length - 1) / 2)] : undefined,
    };
    out.push({ ...m, stage: stageOf(m) });
  }
  return out.sort((x, y) => y.attempts - x.attempts || x.motif.localeCompare(y.motif));
}

/**
 * A puzzle's stage: that of the least mastered of its motifs (it gets the most guidance any of them
 * needs). Motifs never tried are at 'example'. Null when the puzzle has no motif at all.
 */
export function puzzleStage(themes: string[], mastery: ReadonlyMap<string, MotifMastery>, notMotif: ReadonlySet<string> = new Set()): { motif: string; stage: MotifStage } | null {
  let pick: { motif: string; stage: MotifStage } | null = null;
  for (const t of themes) {
    if (notMotif.has(t)) continue;
    const stage = mastery.get(t)?.stage ?? 'example';
    if (!pick || STAGES.indexOf(stage) < STAGES.indexOf(pick.stage)) pick = { motif: t, stage };
  }
  return pick;
}

/** What a stage gives: the offer of a worked example, the idea named, and whether it may be mixed in with its name hidden. */
export function guidanceFor(stage: MotifStage): { offerExample: boolean; nameIt: boolean; mixable: boolean } {
  return { offerExample: stage === 'example', nameIt: stage === 'example' || stage === 'partial', mixable: stage === 'full' || stage === 'mixed' };
}
