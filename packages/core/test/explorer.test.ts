import { describe, expect, it } from 'vitest';
import { START_FEN, bucketsText, explorerCovers, guessTable, indexMyGames, levelBuckets, myGamesTable, percents, readExplorer, speedsText, type MyGame } from '../src/index.ts';

// PLAN WP 8.2: the opening explorer. Counting only: no verdicts.
const AFTER_E4_E5_NF3_NC6 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
const CASTLE_READY = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

describe('the opening explorer (I3, D6; WP 8.2)', () => {
  it('splits results into whole percentages that add up to 100', () => {
    expect(percents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percents([107689066, 11368534, 110379824])).toEqual([47, 5, 48]);
    expect(percents([0, 0, 0])).toEqual([0, 0, 0]);
    expect(percents([5, 0, 0])).toEqual([100, 0, 0]);
  });

  it("reads Lichess's answer: legal moves only, castling as the king's move, sorted by games, shares of the position's games", () => {
    const t = readExplorer(CASTLE_READY, {
      white: 60,
      draws: 10,
      black: 30,
      opening: { eco: 'C50', name: 'Italian Game' },
      moves: [
        { uci: 'd2d3', san: 'd3', white: 10, draws: 2, black: 8 },
        { uci: 'e1h1', san: 'O-O', white: 40, draws: 6, black: 14, averageRating: 940 },
        { uci: 'e2e4', san: 'e4', white: 5, draws: 0, black: 5 }, // not legal here: left out
        { uci: 'c2c3', san: 'c3', white: 0, draws: 0, black: 0 }, // no games: left out
      ],
    })!;
    expect(t.games).toBe(100);
    expect(t.opening).toEqual({ eco: 'C50', name: 'Italian Game' });
    expect(t.rows.map((r) => [r.san, r.uci, r.games, r.share])).toEqual([
      ['O-O', 'e1g1', 60, 60],
      ['d3', 'd2d3', 20, 20],
    ]);
    expect(t.rows[0]!.result).toEqual({ white: 67, draws: 10, black: 23 });
    expect(t.rows[0]!.averageRating).toBe(940);
    expect(readExplorer('not a position', { white: 0, draws: 0, black: 0, moves: [] })).toBeNull();
  });

  it("Maia's guess: a table marked as a guess, the long tail left out, no games counted", () => {
    const t = guessTable(START_FEN, [
      { uci: 'e2e4', p: 0.55 },
      { uci: 'd2d4', p: 0.3 },
      { uci: 'g1f3', p: 0.14 },
      { uci: 'a2a3', p: 0.01 },
      { uci: 'e2e5', p: 0.5 }, // illegal: left out
    ])!;
    expect(t.guess).toBe(true);
    expect(t.games).toBe(0);
    expect(t.rows.map((r) => [r.san, r.share])).toEqual([
      ['e4', 55],
      ['d4', 30],
      ['Nf3', 14],
    ]);
    expect(t.rows.every((r) => r.result === undefined && r.games === 0)).toBe(true);
  });

  it("the owner's own games: per colour, two move orders to the same position merge, their moves and their opponents'", () => {
    const games: MyGame[] = [
      { id: 1, you: 'white', result: '1-0', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
      { id: 2, you: 'white', result: '0-1', sans: ['Nf3', 'Nc6', 'e4', 'e5', 'Bb5'] }, // the same position by another order
      { id: 3, you: 'white', result: '1/2-1/2', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
      { id: 4, you: 'black', result: '0-1', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] }, // as Black: counted apart
      { id: 5, you: 'white', result: '*', sans: ['e4'] }, // unfinished: not counted
    ];
    const index = indexMyGames(games);
    expect(index.games).toBe(4);
    const mine = myGamesTable(index, AFTER_E4_E5_NF3_NC6, 'white')!;
    expect(mine.games).toBe(3);
    expect(mine.rows.map((r) => [r.san, r.games])).toEqual([
      ['Bc4', 2],
      ['Bb5', 1],
    ]);
    expect(mine.rows[0]!.result).toEqual({ white: 50, draws: 50, black: 0 });
    // the start as White: what the owner played first
    expect(myGamesTable(index, START_FEN, 'white')!.rows.map((r) => [r.san, r.games])).toEqual([
      ['e4', 2],
      ['Nf3', 1],
    ]);
    // as Black, after 1.e4: the owner's replies
    expect(myGamesTable(index, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'black')!.rows.map((r) => r.san)).toEqual(['e5']);
    // a position none of their games reached
    expect(myGamesTable(index, '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1', 'white')).toEqual({ games: 0, rows: [] });
  });

  it('works out what to ask for: the rating band and the one above it, in words', () => {
    expect(levelBuckets(undefined)).toEqual([0, 1000]);
    expect(levelBuckets(550)).toEqual([0, 1000]);
    expect(levelBuckets(1250)).toEqual([1200, 1400]);
    expect(levelBuckets(2600)).toEqual([2500]);
    expect(bucketsText([0, 1000])).toBe('rated under 1200');
    expect(bucketsText([1400])).toBe('rated 1400–1599');
    expect(bucketsText([2200, 2500])).toBe('rated 2200 and up');
    expect(speedsText(['rapid', 'classical', 'correspondence'])).toBe('rapid, classical and daily');
    expect(explorerCovers(START_FEN)).toBe(true);
    expect(explorerCovers('8/8/8/4k3/8/4K3/4P3/8 w - - 0 31')).toBe(false); // past move 30
    expect(explorerCovers('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBe(false); // the game is over
  });
});
