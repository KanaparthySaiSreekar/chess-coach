// When a puzzle comes back (feature C4; CONTENT §6 "Scheduling"; PLAN WP 6.5). FSRS, through
// ts-fsrs, decides the gap from how each answer went; this file maps an answer to FSRS's four
// grades, keeps every gap at a day or more (a missed puzzle comes back the next day, not the
// next minute), and keeps the day's reviews under a cap so a backlog never piles up (LEARNING DP13).

import { DefaultScheduler, Rating } from 'ts-fsrs';

export type Grade = 'again' | 'hard' | 'good' | 'easy';

export type PracticeAnswer = { result: 'solved' | 'shown'; hints: number; misses: number; ms: number };

/** A puzzle solved alone within this many seconds counts as fast. */
export const FAST_MS = 20_000;
const DAY = 24 * 60 * 60 * 1000;

/**
 * The grade of an answer (CONTENT §6): wrong or shown → again; right after the arrow, or after a
 * miss → hard; right after a nudge → hard or good (a setting); right alone → good; right alone and
 * fast twice running → easy. The first rung of the ladder ("run the routine") names nothing on the
 * board, so it does not count as help.
 */
export function gradeOf(a: PracticeAnswer, opts: { afterNudge: 'hard' | 'good'; previousFastAndClean: boolean }): Grade {
  if (a.result === 'shown') return 'again';
  if (a.hints >= 3 || a.misses > 0) return 'hard';
  if (a.hints === 2) return opts.afterNudge;
  const fast = a.ms <= FAST_MS;
  return fast && opts.previousFastAndClean ? 'easy' : 'good';
}

/** The card as it is stored: FSRS's own state, with its dates as text. */
export type StoredCard = Record<string, unknown> & { dueAt: string; lastReviewAt: string | null; reps: number; lapses: number };

export type Scheduler = Awaited<ReturnType<typeof DefaultScheduler>>;

/** The scheduler, with the longest gap a setting: a beginner's puzzle should not vanish for years. */
export function makeScheduler(maxDays: number): Promise<Scheduler> {
  return DefaultScheduler({ enableFuzz: false, enableShortTerm: false, maximumInterval: maxDays });
}

const RATING = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const;

/** One review: the card after it, and when it is due. A new card is made on its first answer. */
export function review(s: Scheduler, stored: StoredCard | null, grade: Grade, now: Date): { card: StoredCard; due: Date } {
  const card = stored ? { ...stored, dueAt: new Date(stored.dueAt), lastReviewAt: stored.lastReviewAt ? new Date(stored.lastReviewAt) : null } : s.newCard({ now });
  const next = s.review({ card: card as never, grade: RATING[grade], now }).card as unknown as Record<string, unknown> & { dueAt: Date; lastReviewAt: Date | null; reps: number; lapses: number };
  const model = next.dueAt.getTime();
  // a miss comes back the next day; nothing comes back sooner than a day
  const due = new Date(grade === 'again' ? now.getTime() + DAY : Math.max(model, now.getTime() + DAY));
  return { card: { ...next, dueAt: due.toISOString(), lastReviewAt: next.lastReviewAt ? next.lastReviewAt.toISOString() : now.toISOString() }, due };
}

/**
 * Keep the day's reviews under the cap (LEARNING DP13: "cap the drill backlog"). The cards due
 * longest ago stay; the rest are moved to the following days, `cap` a day, in the order they were
 * due. Returns the new due dates of the cards that move.
 */
export function spreadBacklog(due: { id: number; dueAt: string }[], cap: number, now: Date): { id: number; dueAt: string }[] {
  const ordered = [...due].sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id - b.id);
  const startOfTomorrow = new Date(now.getTime() + DAY);
  return ordered.slice(Math.max(0, cap)).map((c, i) => ({ id: c.id, dueAt: new Date(startOfTomorrow.getTime() + Math.floor(i / Math.max(1, cap)) * DAY).toISOString() }));
}
