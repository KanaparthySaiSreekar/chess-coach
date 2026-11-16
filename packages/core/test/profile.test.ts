import { describe, expect, it } from 'vitest';
import { bandFor, buildProfile, profileInWords, type GameNumbers, type Outcome, type ProfileGame, type SkippedStep } from '../src/index.ts';

// PLAN WP 5.8: fixture games give known numbers. Each game here is written out by hand, so every
// number of the profile can be worked out on paper.
const numbers = (over: Partial<GameNumbers>): GameNumbers => ({ moves: 30, liveMoves: 20, blunders: 0, mistakes: 0, inaccuracies: 0, misses: 0, liveBlunders: 0, piecesLost: 0, strong: 10, steps: {}, ...over });
let id = 0;
const game = (day: number, outcome: Outcome, over: Partial<GameNumbers>, winAfter: number[], steps: SkippedStep[] = []): ProfileGame => ({
  id: ++id,
  playedAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`,
  outcome,
  you: 'white',
  numbers: numbers(over),
  winAfter,
  steps,
});
// the owner's winning chances after each half-move: `opening` for the first 24, then `rest`
const chances = (opening: number, rest: number[] = []) => [...Array.from({ length: 24 }, () => opening), ...rest];

describe('the skill profile, from fixture games', () => {
  const games = [
    // lost the opening (20 after move 12), two live blunders in 20 live moves, a piece hung
    game(1, 'loss', { liveMoves: 20, liveBlunders: 2, blunders: 2, piecesLost: 1 }, chances(20, [10, 5]), ['no_safety_check', 'missed_threat']),
    // fine out of the opening, reached a won position (95) and threw it away
    game(2, 'loss', { liveMoves: 30, liveBlunders: 3, blunders: 3, piecesLost: 2 }, chances(55, [95, 40, 10]), ['no_safety_check', 'no_safety_check', 'time']),
    // fine out of the opening, won position, converted
    game(3, 'win', { liveMoves: 25, liveBlunders: 1, blunders: 1, piecesLost: 0 }, chances(60, [92, 97, 100]), ['missed_free_material']),
    // a short game that ended in 10 half-moves: its last reading counts as "after the opening"
    game(4, 'win', { liveMoves: 5, liveBlunders: 0 }, [50, 60, 70, 80, 90, 100, 100, 100, 100, 100]),
  ];
  const p = buildProfile(games);

  it('counts the four process measures', () => {
    expect(p.games).toBe(4);
    // 6 live blunders in 80 live moves
    expect(p.blunders).toMatchObject({ value: 7.5, games: 4 });
    // 3 pieces in 4 games
    expect(p.hungPieces).toMatchObject({ value: 0.8, games: 4 });
    // one of the four was under 30 after the opening
    expect(p.openingLosses).toMatchObject({ value: 25, games: 4 });
    // three games reached 90 or more; two of them were won
    expect(p.conversion).toMatchObject({ value: 67, games: 3 });
  });

  it('counts the skipped steps, the most frequent first', () => {
    expect(p.steps.map((s) => [s.step, s.count, s.perGame])).toEqual([
      ['no_safety_check', 3, 0.8],
      ['missed_free_material', 1, 0.3],
      ['missed_threat', 1, 0.3],
      ['time', 1, 0.3],
    ]);
    expect(p.steps[0]!.name).toBe('No safety check on your own move');
  });

  it('gives no trend and no band on a handful of games', () => {
    expect(p.blunders.trend).toBeNull();
    expect(p.steps.every((s) => s.trend === null)).toBe(true);
    expect(p.band).toBeNull();
  });

  it('compares the newest games with the ones before them once there are enough', () => {
    const old = [1, 2, 3].map((d) => game(d, 'loss', { liveMoves: 20, liveBlunders: 6, piecesLost: 2 }, chances(20), ['no_safety_check', 'no_safety_check']));
    const fresh = [10, 11, 12].map((d) => game(d, 'win', { liveMoves: 20, liveBlunders: 2, piecesLost: 0 }, chances(60, [95]), ['no_safety_check']));
    const q = buildProfile([...fresh, ...old], { window: 3 });
    // 24 blunders in 120 live moves overall; 10 per 100 lately against 30 before
    expect(q.blunders).toEqual({ value: 20, recent: 10, before: 30, trend: 'better', games: 6 });
    expect(q.hungPieces).toMatchObject({ value: 1, recent: 0, before: 2, trend: 'better' });
    expect(q.openingLosses).toMatchObject({ value: 50, recent: 0, before: 100, trend: 'better' });
    // higher is better for conversion: no won position before, all converted lately
    expect(q.conversion).toMatchObject({ value: 100, recent: 100, before: null, trend: null, games: 3 });
    expect(q.steps[0]).toMatchObject({ step: 'no_safety_check', count: 9, trend: 'better' });
    // and the other way round is worse
    const worse = buildProfile([...old.map((g) => ({ ...g, playedAt: g.playedAt.replace('-10-', '-11-') })), ...fresh], { window: 3 });
    expect(worse.blunders.trend).toBe('worse');
    expect(buildProfile([...fresh, ...fresh.map((g) => ({ ...g, id: g.id + 100, playedAt: g.playedAt.replace('-10-', '-09-') }))], { window: 3 }).blunders.trend).toBe('same');
  });

  it('places a blunder rate among the published figures, as a band and never as a promise', () => {
    expect(bandFor(38.7)).toEqual({ band: '400–700', about: 600 });
    expect(bandFor(23.3)).toEqual({ band: '1000–1300', about: 1000 });
    expect(bandFor(31)).toEqual({ band: '700–1000', about: 800 });
    expect(bandFor(17.1)).toEqual({ band: '1300 and up', about: 1300 });
    expect(bandFor(80).about).toBe(300);
    expect(bandFor(2).about).toBe(1600);
    const five = [1, 2, 3, 4, 5].map((d) => game(d, 'loss', { liveMoves: 20, liveBlunders: 7 }, chances(40)));
    // 35 per 100: a little under the 600 figure of 38.7, which comes out at 700 to the nearest 50
    expect(buildProfile(five).band).toEqual({ band: '700–1000', about: 700 });
    expect(buildProfile(five.slice(1)).band).toBeNull(); // four games are too few for a band
  });

  it('says the profile in plain lines for the coach, and says so when there is nothing yet', () => {
    expect(profileInWords(buildProfile([]))).toEqual(['No analysed games yet: nothing is known about the owner from their play.']);
    const words = profileInWords(p);
    expect(words[0]).toBe("From 4 analysed games of the owner's.");
    expect(words).toContain('Blunders per 100 live moves: 7.5.');
    expect(words).toContain('Games already lost after the opening: 25%.');
    expect(words).toContain('Won positions converted: 67%.');
    expect(words.at(-1)).toBe('The step skipped most often: no safety check on your own move (3 times).');
  });
});
