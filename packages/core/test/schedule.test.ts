import { describe, expect, it } from 'vitest';
import { gradeOf, makeScheduler, review, spreadBacklog, type Grade, type StoredCard } from '../src/index.ts';

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2026-11-15T10:00:00Z');
const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY;

/** Answer a card at each due date with the grades given; the gaps between reviews. */
async function simulate(grades: Grade[], maxDays = 180) {
  const s = await makeScheduler(maxDays);
  let card: StoredCard | null = null;
  let now = start;
  const gaps: number[] = [];
  for (const g of grades) {
    const r = review(s, card, g, now);
    gaps.push(Math.round(daysBetween(now, r.due) * 10) / 10);
    card = r.card;
    now = r.due;
  }
  return { gaps, card: card! };
}

// PLAN WP 6.5: simulated histories. Intervals grow on success, shrink on a miss; the cap holds.
describe('the schedule', () => {
  it('grows the gap with every success, up to the longest gap allowed', async () => {
    const { gaps, card } = await simulate(['good', 'good', 'good', 'good', 'good', 'good']);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThanOrEqual(gaps[i - 1]!);
    expect(gaps[1]!).toBeGreaterThan(gaps[0]!);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(180);
    expect(gaps.at(-1)).toBe(180);
    expect(card.reps).toBe(6);
    // the longest gap is a setting
    expect(Math.max(...(await simulate(['good', 'good', 'good', 'good', 'good'], 60)).gaps)).toBeLessThanOrEqual(60);
  });

  it('brings a missed puzzle back the next day, and shrinks the gap after it', async () => {
    const before = await simulate(['good', 'good', 'good']);
    const missed = await simulate(['good', 'good', 'good', 'again', 'good']);
    expect(missed.gaps[3]).toBe(1);
    expect(missed.gaps[4]!).toBeLessThan(before.gaps[2]!);
    expect(missed.card.lapses).toBe(1);
    // a first answer that was a miss: tomorrow too, never within the minute
    expect((await simulate(['again'])).gaps).toEqual([1]);
  });

  it('easy beats good, good beats hard, and nothing comes back in under a day', async () => {
    const first = (g: Grade) => simulate(['good', g]).then((x) => x.gaps[1]!);
    const [hard, good, easy] = await Promise.all([first('hard'), first('good'), first('easy')]);
    expect(easy).toBeGreaterThan(good);
    expect(good).toBeGreaterThan(hard);
    expect(hard).toBeGreaterThanOrEqual(1);
  });

  it('a stored card survives being written down and read back', async () => {
    const s = await makeScheduler(180);
    const r1 = review(s, null, 'good', start);
    const stored = JSON.parse(JSON.stringify(r1.card)) as StoredCard;
    const r2 = review(s, stored, 'good', r1.due);
    expect(daysBetween(r1.due, r2.due)).toBeGreaterThan(daysBetween(start, r1.due));
  });

  it("keeps the day's reviews under the cap, the longest overdue first", () => {
    const now = new Date('2026-11-20T09:00:00Z');
    const due = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, dueAt: new Date(now.getTime() - (23 - i) * 3600_000).toISOString() }));
    const moved = spreadBacklog(due, 10, now);
    // 23 due, 10 a day: 13 move, ten of them to tomorrow and three to the day after
    expect(moved).toHaveLength(13);
    expect(moved.map((m) => m.id)).toEqual(Array.from({ length: 13 }, (_, i) => i + 11));
    const byDay = new Map<string, number>();
    for (const m of moved) byDay.set(m.dueAt.slice(0, 10), (byDay.get(m.dueAt.slice(0, 10)) ?? 0) + 1);
    expect([...byDay.values()]).toEqual([10, 3]);
    expect(moved.every((m) => new Date(m.dueAt) > now)).toBe(true);
    expect(spreadBacklog(due.slice(0, 5), 10, now)).toEqual([]);
  });
});

describe('the grade of an answer', () => {
  const g = (result: 'solved' | 'shown', hints: number, misses: number, ms = 30_000, previous = false, afterNudge: 'hard' | 'good' = 'hard') => gradeOf({ result, hints, misses, ms }, { afterNudge, previousFastAndClean: previous });
  it('follows CONTENT §6', () => {
    expect(g('shown', 0, 0)).toBe('again');
    expect(g('shown', 3, 2)).toBe('again');
    expect(g('solved', 3, 0)).toBe('hard'); // after the arrow
    expect(g('solved', 0, 1)).toBe('hard'); // after a miss
    expect(g('solved', 2, 0)).toBe('hard'); // after a nudge: a setting
    expect(g('solved', 2, 0, 30_000, false, 'good')).toBe('good');
    expect(g('solved', 1, 0)).toBe('good'); // "run the routine" names nothing on the board
    expect(g('solved', 0, 0)).toBe('good');
    expect(g('solved', 0, 0, 8_000)).toBe('good'); // fast once
    expect(g('solved', 0, 0, 8_000, true)).toBe('easy'); // fast twice running
  });
});
