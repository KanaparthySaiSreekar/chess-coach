import { describe, expect, it } from 'vitest';
import { STEP_HABIT, buildReport, type GameNumbers, type ReportSlip, type SkippedStep } from '../src/index.ts';

const numbers = (over: Partial<GameNumbers> = {}): GameNumbers => ({ moves: 27, liveMoves: 25, blunders: 2, mistakes: 2, inaccuracies: 1, misses: 0, liveBlunders: 2, piecesLost: 1, strong: 9, steps: {}, ...over });
const slip = (ply: number, san: string, step: SkippedStep, label = 'blunder'): ReportSlip => ({ ply, san, step, label });

// PLAN WP 5.7: the report cites only validated facts. Here that means: every line is a count the
// analysis stored or a tag on one of the owner's slips, and nothing is said that the game does not show.
describe('the review report', () => {
  const slips = [slip(46, 'Rb3', 'missed_threat'), slip(52, 'Rb7', 'assumed_reply'), slip(38, 'Rb2', 'missed_threat', 'mistake'), slip(30, 'Qb6', 'no_safety_check', 'mistake')];

  it('has a takeaway for each skipped step the game shows, the most frequent first, each resting on its moves', () => {
    const r = buildReport({ numbers: numbers(), slips });
    expect(r.takeaways.map((t) => [t.step, t.plies])).toEqual([
      ['missed_threat', [38, 46]],
      ['no_safety_check', [30]],
      ['assumed_reply', [52]],
    ]);
    expect(r.takeaways[0]!.text).toBe('Before you choose a move, ask what their last move was trying to do. That step was missing on moves 19 (Rb2) and 23 (Rb3).');
    expect(r.takeaways[1]!.text).toBe(`${STEP_HABIT.no_safety_check}. That step was missing on move 15 (Qb6).`);
    // every takeaway rests on slips that carry its step, and on nothing else
    for (const t of r.takeaways) expect(t.plies.every((ply) => slips.some((s) => s.ply === ply && s.step === t.step))).toBe(true);
  });

  it('never has more than four takeaways, and none for a slip no step explains', () => {
    const many = (['missed_threat', 'no_safety_check', 'seemed_safe', 'missed_tactic', 'assumed_reply', 'time'] as SkippedStep[]).map((step, i) => slip(10 + i * 2, `m${i}`, step));
    expect(buildReport({ numbers: numbers(), slips: many }).takeaways).toHaveLength(4);
    expect(buildReport({ numbers: numbers(), slips: many, max: 2 }).takeaways).toHaveLength(2);
    expect(buildReport({ numbers: numbers(), slips: [slip(12, 'a3', 'unknown')] }).takeaways).toEqual([]);
    expect(buildReport({ numbers: numbers(), slips: [slip(12, 'a3', 'unknown')] }).closing).toBe('Nothing here to fix: play the next one the same way.');
  });

  it('opens with counts from the game, and says nothing it cannot count', () => {
    const r = buildReport({ numbers: numbers(), slips });
    expect(r.positives).toEqual(["You played the engine's first choice, or a move just as good, on 9 of your 27 moves.", 'Your first 14 moves were clean: the first slip came on move 15.']);
    expect(buildReport({ numbers: numbers({ strong: 0, blunders: 1 }), slips: [slip(6, 'Nf6', 'missed_threat')] }).positives).toEqual([]);
    expect(buildReport({ numbers: numbers({ blunders: 0 }), slips: [slip(6, 'Nf6', 'missed_threat', 'mistake')] }).positives[1]).toBe('You made no blunders in this game.');
    expect(buildReport({ numbers: numbers({ blunders: 0, mistakes: 0 }), slips: [] }).positives[1]).toBe('None of your moves was a mistake, a blunder or a missed chance.');
    expect(buildReport({ numbers: numbers({ moves: 1, strong: 1 }), slips: [] }).positives[0]).toMatch(/on 1 of your 1 move\./);
  });

  it('closes on the best true thing left: the replay, a habit that held, or the one to take along', () => {
    expect(buildReport({ numbers: numbers(), slips, replay: { found: 1, total: 2 } }).closing).toBe('Going through the key moments, you found the better move yourself in 1 of 2.');
    expect(buildReport({ numbers: numbers(), slips, replay: { found: 2, total: 2 } }).closing).toMatch(/every time\.$/);
    expect(buildReport({ numbers: numbers(), slips, replay: { found: 0, total: 2 } }).closing).toBe('One habit at a time: the first takeaway is the one to take into your next game.');
    const held = buildReport({ numbers: numbers(), slips, earlier: ['seemed_safe', 'missed_threat'] });
    expect(held.since).toEqual([
      { step: 'seemed_safe', habit: STEP_HABIT.seemed_safe, cameUpAgain: false },
      { step: 'missed_threat', habit: STEP_HABIT.missed_threat, cameUpAgain: true },
    ]);
    expect(held.closing).toBe('A takeaway from your last game did not come up this time: before you put a piece on a square, count what attacks it there and what defends it.');
  });

  it('marks a habit that has been a takeaway before', () => {
    const r = buildReport({ numbers: numbers(), slips, known: new Set<SkippedStep>(['no_safety_check']) });
    expect(r.takeaways.map((t) => [t.step, t.again ?? false])).toEqual([
      ['missed_threat', false],
      ['no_safety_check', true],
      ['assumed_reply', false],
    ]);
  });
});
