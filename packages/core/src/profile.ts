// The owner's level as a profile, not a number (features G2, G5, H5; LEARNING §8).
//
// Four process measures from the analysed games, how often each step of the thinking routine is
// skipped, whether those are getting rarer, and a rough band. All of it is counted from what the
// analysis stored; nothing is estimated by a model.
//
// The definitions are this app's own (LEARNING §8 names the measures, nobody publishes exact
// rules for them):
//   - blunders per 100 live moves: the owner's blunders among their live moves (isLiveMove), times 100;
//   - hung pieces per game: slips that cost a piece or more, per analysed game;
//   - opening losses: games in which the owner's winning chances were under OPENING_LOST after
//     move OPENING_MOVES (or at the end of a shorter game);
//   - conversion: of the games in which the owner's winning chances reached WON, the share they won.

import type { Color } from './chess.ts';
import type { SkippedStep } from './facts.ts';
import type { Outcome } from './games.ts';
import type { GameNumbers } from './review.ts';
import { STEP_NAME } from './tags.ts';

export const OPENING_MOVES = 12;
export const OPENING_LOST = 30;
export const WON = 90;

/** One analysed game, as the profile needs it. */
export type ProfileGame = {
  id: number;
  playedAt: string;
  outcome?: Outcome;
  you: Color;
  numbers: GameNumbers;
  /** the owner's winning chances after each half-move, 0 to 100 (null where the engine was not asked) */
  winAfter: (number | null)[];
  /** the skipped step of each of the owner's slips (their own word for it where they gave one) */
  steps: SkippedStep[];
};

export type Trend = 'better' | 'worse' | 'same';

/** One measure: over all the games, over the newest ones, over the ones before, and which way it is going. */
export type Measure = {
  value: number | null;
  recent: number | null;
  before: number | null;
  trend: Trend | null;
  /** how many games the value rests on */
  games: number;
};

export type StepCount = { step: SkippedStep; name: string; count: number; perGame: number; trend: Trend | null };

export type SkillProfile = {
  /** analysed games in which the owner's side is known */
  games: number;
  blunders: Measure;
  hungPieces: Measure;
  openingLosses: Measure;
  conversion: Measure;
  /** the skipped steps, the most frequent first */
  steps: StepCount[];
  /** a rough band, from the blunder rate against published figures: a cross-check, never the goal */
  band: { band: string; about: number } | null;
};

const round1 = (x: number) => Math.round(x * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Published blunders per 100 live moves by rating (chessstats.gg, blitz; its definitions are not published, so this is a rough guide). */
export const BLUNDER_REFERENCE: readonly { rating: number; per100: number }[] = [
  { rating: 600, per100: 38.7 },
  { rating: 1000, per100: 23.3 },
  { rating: 1300, per100: 17.1 },
];

/** Where a blunder rate falls among the published figures: the curriculum band (LEARNING §7) and a rating to the nearest 50. */
export function bandFor(per100: number): { band: string; about: number } {
  const ref = BLUNDER_REFERENCE;
  // the line through the two nearest points, also beyond the ends
  const [a, b] = per100 >= ref[1]!.per100 ? [ref[0]!, ref[1]!] : [ref[1]!, ref[2]!];
  const raw = a.rating + ((per100 - a.per100) / (b.per100 - a.per100)) * (b.rating - a.rating);
  const about = Math.round(Math.max(300, Math.min(1600, raw)) / 50) * 50;
  const band = about < 700 ? '400–700' : about < 1000 ? '700–1000' : about < 1300 ? '1000–1300' : '1300 and up';
  return { band, about };
}

type Calc = (games: ProfileGame[]) => { value: number | null; games: number };

const blunderRate: Calc = (games) => {
  const live = sum(games.map((g) => g.numbers.liveMoves));
  return { value: live > 0 ? round1((sum(games.map((g) => g.numbers.liveBlunders)) / live) * 100) : null, games: games.length };
};
const hungRate: Calc = (games) => ({ value: games.length ? round1(sum(games.map((g) => g.numbers.piecesLost)) / games.length) : null, games: games.length });

/** The owner's winning chances once the opening is over: after move OPENING_MOVES, or at the end of a shorter game. */
function afterOpening(g: ProfileGame): number | null {
  const last = Math.min(OPENING_MOVES * 2, g.winAfter.length) - 1;
  for (let i = last; i >= 0; i--) if (g.winAfter[i] !== null && g.winAfter[i] !== undefined) return g.winAfter[i]!;
  return null;
}
const openingLossRate: Calc = (games) => {
  const known = games.map(afterOpening).filter((w): w is number => w !== null);
  return { value: known.length ? Math.round((known.filter((w) => w < OPENING_LOST).length / known.length) * 100) : null, games: known.length };
};
const conversionRate: Calc = (games) => {
  const won = games.filter((g) => g.outcome && g.winAfter.some((w) => w !== null && w >= WON));
  return { value: won.length ? Math.round((won.filter((g) => g.outcome === 'win').length / won.length) * 100) : null, games: won.length };
};

/** Which way a measure is going: a change of less than a tenth is "the same". */
function trendOf(recent: number | null, before: number | null, lowerIsBetter: boolean): Trend | null {
  if (recent === null || before === null) return null;
  const change = recent - before;
  if (Math.abs(change) <= Math.max(Math.abs(before) * 0.1, 0.05)) return 'same';
  return change < 0 === lowerIsBetter ? 'better' : 'worse';
}

/**
 * The profile over the analysed games. Trends compare the newest `window` games with the `window`
 * before them, and are only given once there are at least `minForTrend` games on each side.
 */
export function buildProfile(all: ProfileGame[], opts: { window?: number; minForTrend?: number; minForBand?: number } = {}): SkillProfile {
  const games = [...all].sort((a, b) => a.playedAt.localeCompare(b.playedAt) || a.id - b.id);
  const window = opts.window ?? 10;
  const min = opts.minForTrend ?? 3;
  const recent = games.slice(-window);
  const before = games.slice(-2 * window, -window);
  const enough = recent.length >= min && before.length >= min;
  const measure = (calc: Calc, lowerIsBetter: boolean): Measure => {
    const total = calc(games);
    const r = enough ? calc(recent).value : null;
    const b = enough ? calc(before).value : null;
    return { value: total.value, recent: r, before: b, trend: trendOf(r, b, lowerIsBetter), games: total.games };
  };
  const perGame = (list: ProfileGame[], step: SkippedStep) => (list.length ? list.reduce((n, g) => n + g.steps.filter((s) => s === step).length, 0) / list.length : 0);
  const counts = new Map<SkippedStep, number>();
  for (const g of games) for (const s of g.steps) if (s !== 'unknown') counts.set(s, (counts.get(s) ?? 0) + 1);
  const steps: StepCount[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([step, count]) => ({ step, name: STEP_NAME[step], count, perGame: round1(count / games.length), trend: enough ? trendOf(perGame(recent, step), perGame(before, step), true) : null }));
  const blunders = measure(blunderRate, true);
  return {
    games: games.length,
    blunders,
    hungPieces: measure(hungRate, true),
    openingLosses: measure(openingLossRate, true),
    conversion: measure(conversionRate, false),
    steps,
    band: blunders.value !== null && games.length >= (opts.minForBand ?? 5) ? bandFor(blunders.value) : null,
  };
}

const TREND_WORDS: Record<Trend, string> = { better: 'better than in your earlier games', worse: 'worse than in your earlier games', same: 'about the same as in your earlier games' };

/** The profile in a few plain lines: what the coach is handed about the owner (H5). */
export function profileInWords(p: SkillProfile): string[] {
  if (!p.games) return ['No analysed games yet: nothing is known about the owner from their play.'];
  const out: string[] = [`From ${p.games} analysed ${p.games === 1 ? 'game' : 'games'} of the owner's.`];
  const add = (label: string, m: Measure, unit: string) => {
    if (m.value !== null) out.push(`${label}: ${m.value}${unit}${m.trend ? `, ${TREND_WORDS[m.trend]}` : ''}.`);
  };
  add('Blunders per 100 live moves', p.blunders, '');
  add('Pieces hung per game', p.hungPieces, '');
  add('Games already lost after the opening', p.openingLosses, '%');
  add('Won positions converted', p.conversion, '%');
  if (p.steps.length) out.push(`The step skipped most often: ${p.steps[0]!.name.toLowerCase()} (${p.steps[0]!.count} times).`);
  if (p.band) out.push(`By their blunder rate the owner plays like the ${p.band.band} band: a rough guide, not a rating.`);
  return out;
}
