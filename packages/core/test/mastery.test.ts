import { describe, expect, it } from 'vitest';
import { guidanceFor, motifMastery, puzzleStage, stageOf, type MotifAttempt } from '../src/index.ts';

let clock = 0;
/** One first go: solved alone in `ms`, solved with help, or shown. */
const go = (themes: string[], how: 'alone' | 'hint' | 'miss' | 'shown', ms = 30_000, again = false): MotifAttempt => ({
  themes,
  result: how === 'shown' ? 'shown' : 'solved',
  hints: how === 'hint' ? 2 : how === 'shown' ? 3 : 0,
  misses: how === 'miss' ? 1 : 0,
  ms,
  at: new Date(Date.UTC(2026, 10, 1) + ++clock * 60_000).toISOString(),
  again,
});
const times = (n: number, a: () => MotifAttempt) => Array.from({ length: n }, a);
const stageFor = (history: MotifAttempt[], motif: string) => motifMastery(history, new Set(['short', 'middlegame'])).find((m) => m.motif === motif)?.stage ?? 'example';

describe('motif mastery', () => {
  it('fixture histories give the expected stage', () => {
    // never tried: a worked example first
    expect(stageFor([], 'fork')).toBe('example');
    // two tries, both alone: still new
    expect(stageFor(times(2, () => go(['fork', 'short'], 'alone')), 'fork')).toBe('partial');
    // four tries, one alone: leaning on help
    expect(stageFor([go(['fork'], 'alone'), go(['fork'], 'hint'), go(['fork'], 'shown'), go(['fork'], 'miss')], 'fork')).toBe('partial');
    // four tries, three alone: known
    expect(stageFor([go(['fork'], 'alone'), go(['fork'], 'alone'), go(['fork'], 'hint'), go(['fork'], 'alone')], 'fork')).toBe('full');
    // eight tries, seven alone and quick: mastered, mixed in with the others
    expect(stageFor([...times(7, () => go(['pin'], 'alone', 20_000)), go(['pin'], 'shown')], 'pin')).toBe('mixed');
    // as accurate, but slow: known, not yet mixed
    expect(stageFor(times(8, () => go(['pin'], 'alone', 95_000)), 'pin')).toBe('full');
    // mastered once, then a run of misses: the latest ten count, and it drops back
    expect(stageFor([...times(10, () => go(['skewer'], 'alone', 20_000)), ...times(6, () => go(['skewer'], 'shown'))], 'skewer')).toBe('partial');
    // a second go is not retrieval: it does not count
    expect(stageFor([go(['fork'], 'alone'), ...times(5, () => go(['fork'], 'alone', 10_000, true))], 'fork')).toBe('partial');
    // tags that are not ideas are not motifs
    expect(motifMastery(times(3, () => go(['fork', 'short', 'middlegame'], 'alone')), new Set(['short', 'middlegame'])).map((m) => m.motif)).toEqual(['fork']);
  });

  it('counts accuracy, time and hints over the latest ten', () => {
    const history = [go(['fork'], 'alone', 40_000), go(['fork'], 'hint'), go(['fork'], 'alone', 10_000), go(['fork'], 'shown'), go(['fork'], 'alone', 25_000)];
    expect(motifMastery(history)[0]).toEqual({ motif: 'fork', attempts: 5, recent: 5, solved: 4, alone: 3, accuracy: 0.6, meanHints: 1, medianMs: 25_000, stage: 'full' });
    expect(motifMastery(times(14, () => go(['pin'], 'alone')))[0]).toMatchObject({ attempts: 14, recent: 10 });
    expect(stageOf({ attempts: 0, accuracy: 0 })).toBe('example');
  });

  it("a puzzle's stage is its least mastered motif's, and the stage sets the guidance", () => {
    const mastery = new Map(motifMastery([...times(8, () => go(['pin'], 'alone', 20_000)), ...times(3, () => go(['fork'], 'alone'))]).map((m) => [m.motif, m]));
    expect(puzzleStage(['pin', 'short'], mastery, new Set(['short']))).toEqual({ motif: 'pin', stage: 'mixed' });
    expect(puzzleStage(['pin', 'fork'], mastery)).toEqual({ motif: 'fork', stage: 'full' });
    expect(puzzleStage(['pin', 'skewer'], mastery)).toEqual({ motif: 'skewer', stage: 'example' });
    expect(puzzleStage(['short'], mastery, new Set(['short']))).toBeNull();
    expect(guidanceFor('example')).toEqual({ offerExample: true, nameIt: true, mixable: false });
    expect(guidanceFor('partial')).toEqual({ offerExample: false, nameIt: true, mixable: false });
    expect(guidanceFor('full')).toEqual({ offerExample: false, nameIt: false, mixable: true });
    expect(guidanceFor('mixed')).toEqual({ offerExample: false, nameIt: false, mixable: true });
  });
});
