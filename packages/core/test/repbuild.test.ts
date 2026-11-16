import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  buildFromBook,
  gateV4Book,
  lineText,
  playLine,
  positionKey,
  readOutline,
  repliesToPrepare,
  type BookBuildDeps,
  type BookBuildPlan,
  type BookTable,
  type Outline,
  type ReplySource,
} from '../src/index.ts';

// PLAN WP 8.12: a repertoire built from the book, with stand-ins for the masters' games, the owner's
// level and the engine. Every move must be book (25 games here); the outline's moves and replies come first.

const at = (moves: string) => {
  const r = playLine(START_FEN, moves ? moves.split(' ') : []);
  if (!r.ok) throw new Error(moves);
  return positionKey(r.fens.at(-1)!);
};
const t = (rows: [string, string, number][]): BookTable => {
  const moves = rows.map(([uci, san, games]) => ({ uci, san, games }));
  return { games: moves.reduce((a, m) => a + m.games, 0), moves };
};
const BOOK = new Map<string, BookTable>([
  [at(''), t([['g1f3', 'Nf3', 1000], ['e2e4', 'e4', 500]])],
  [at('Nf3'), t([['d7d5', 'd5', 600], ['g8f6', 'Nf6', 300], ['b7b5', 'b5', 30], ['c7c5', 'c5', 20]])],
  // the seed (b3) is played although the masters play d4 more often
  [at('Nf3 d5'), t([['d2d4', 'd4', 400], ['b2b3', 'b3', 100]])],
  [at('Nf3 Nf6'), t([['g2g3', 'g3', 200], ['c2c4', 'c4', 100]])],
  // 2...c5 is in 15 games: not book
  [at('Nf3 d5 b3'), t([['g8f6', 'Nf6', 50], ['c8g4', 'Bg4', 30], ['c7c5', 'c5', 15]])],
  [at('Nf3 Nf6 g3'), t([['g7g6', 'g6', 150], ['d7d5', 'd5', 50]])],
  [at('Nf3 b5'), t([['e2e4', 'e4', 25], ['g2g3', 'g3', 20]])],
  [at('Nf3 b5 e4'), t([['a7a6', 'a6', 25]])],
  [at('Nf3 b5 e4 a6'), t([['d2d4', 'd4', 25]])],
  [at('Nf3 d5 b3 Nf6'), t([['c1b2', 'Bb2', 40]])],
  [at('Nf3 d5 b3 Bg4'), t([['c1b2', 'Bb2', 30]])],
  [at('Nf3 Nf6 g3 g6'), t([['f1g2', 'Bg2', 150]])],
  [at('Nf3 Nf6 g3 d5'), t([['f1g2', 'Bg2', 50]])],
]);
// players at the owner's level: 1...e5 is common there but not book; 1...c5 is book-poor (20 games)
const LEVEL = new Map<string, ReplySource>([[at('Nf3'), { source: 'explorer', games: 5000, replies: [{ uci: 'e7e5', san: 'e5', share: 40, games: 2000 }, { uci: 'd7d5', san: 'd5', share: 30, games: 1500 }, { uci: 'c7c5', san: 'c5', share: 30, games: 1500 }] }]]);
const outline = (() => {
  const r = readOutline({ id: 'test', name: 'Test', colour: 'white', chapters: [{ moves: '1. Nf3 d5 2. b3' }, { moves: '1. Nf3 b5 2. e4' }] });
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.outline;
})();
const plan = (o: Partial<BookBuildPlan> = {}): BookBuildPlan => ({
  colour: 'white',
  depth: 3,
  budget: 100,
  minGames: 25,
  bookRule: { minCovered: 85, flagShare: 5, floor: 1 },
  levelRule: { minCovered: 85, flagShare: 5, floor: 3 },
  outline: outline as Outline,
  outlineReach: 2,
  batch: 4,
  ...o,
});
const deps = (asked: string[] = []): BookBuildDeps => ({
  book: async (fen) => (asked.push(fen), BOOK.get(positionKey(fen)) ?? null),
  level: async (fen) => LEVEL.get(positionKey(fen)) ?? null,
  sound: async () => true,
  // 2...Bg4 is a mistake to punish (in this stand-in)
  punish: async (_fen, _uci, san) => san === 'Bg4',
});
const texts = (r: Awaited<ReturnType<typeof buildFromBook>>) => r.lines.map((l) => lineText(l.startFen, l.moves));

describe('the replies to prepare (one rule for the builder and V4)', () => {
  it('most played first, until the coverage is reached and nothing left is common enough to name; never under the floor', () => {
    const r = repliesToPrepare([{ uci: 'a', san: 'A', share: 60 }, { uci: 'b', san: 'B', share: 30 }, { uci: 'c', san: 'C', share: 6 }, { uci: 'd', san: 'D', share: 3 }, { uci: 'e', san: 'E', share: 1 }], { minCovered: 85, flagShare: 5, floor: 2 });
    expect(r.take.map((x) => x.san)).toEqual(['A', 'B', 'C']);
    expect(r.left.map((x) => [x.san, x.why])).toEqual([['D', 'enough'], ['E', 'floor']]);
  });
});

describe('a repertoire from the book (WP 8.12)', () => {
  it('every move is book; the outline first; the masters choose the rest; the same answers give the same lines', async () => {
    const r = await buildFromBook(plan(), deps());
    expect(texts(r)).toEqual(['1.Nf3 d5 2.b3 Nf6 3.Bb2', '1.Nf3 d5 2.b3 Bg4 3.Bb2', '1.Nf3 b5 2.e4 a6 3.d4', '1.Nf3 Nf6 2.g3 g6 3.Bg2', '1.Nf3 Nf6 2.g3 d5 3.Bg2']);
    // the grounding: the masters' games for every move
    expect(r.lines[0]!.book).toEqual([1000, 600, 100, 50, 40]);
    // the chapters: the outline's first, then the line off the outline by its moves
    expect(r.lines.map((l) => l.chapter)).toEqual(['1.Nf3 d5 2.b3', '1.Nf3 d5 2.b3', '1.Nf3 b5 2.e4', '1.Nf3 Nf6', '1.Nf3 Nf6']);
    expect(r.lines.map((l) => l.order)).toEqual([0, 1, 2, 3, 4]);
    expect(r.chapters.map((c) => [c.name, c.lines, c.auto, c.moves.join(' ')])).toEqual([['1.Nf3 d5 2.b3', 2, false, 'Nf3 d5 b3'], ['1.Nf3 b5 2.e4', 1, false, 'Nf3 b5 e4'], ['1.Nf3 Nf6', 2, true, 'Nf3 Nf6']]);
    // 2...Bg4 is marked to punish
    expect(r.lines[1]!.punish).toEqual([3]);
    // 1...e5 (common at the owner's level, not book) and 1...c5 (20 games) are not prepared; 2...c5 (15 games) neither
    expect(texts(r).some((l) => /^1\.Nf3 (e5|c5)/.test(l) || l.includes('2.b3 c5'))).toBe(false);
    const root = r.positions.get(at('Nf3'))!;
    expect(root.required!.map((x) => [x.san, x.why])).toEqual([['d5', ['book', 'level', 'outline']], ['Nf6', ['book']], ['b5', ['outline']]]);
    expect(r.cut).toBe(null);
    const again = await buildFromBook(plan({ batch: 1 }), deps());
    expect(texts(again)).toEqual(texts(r));
  });

  it('the budget: the outline is always prepared, then the positions met most often, until the lines number the budget', async () => {
    const r = await buildFromBook(plan({ budget: 3 }), deps());
    expect(texts(r)).toEqual(['1.Nf3 d5 2.b3 Nf6 3.Bb2', '1.Nf3 d5 2.b3 Bg4 3.Bb2', '1.Nf3 b5 2.e4 a6 3.d4', '1.Nf3 Nf6 2.g3']);
    expect(r.cut).toBeCloseTo((300 / 950) * 100, 5);
  });

  it('never past the depth; a move of mine the engine rejects gives way to the next book move; with no book move the reply is not prepared', async () => {
    const shallow = await buildFromBook(plan({ depth: 2 }), deps());
    expect(texts(shallow)).toEqual(['1.Nf3 d5 2.b3', '1.Nf3 b5 2.e4', '1.Nf3 Nf6 2.g3']);
    const d = deps();
    // the engine rejects 2.g3 after 1...Nf6 and 2.Bg2 everywhere
    const strict = await buildFromBook(plan(), { ...d, sound: async (_f, _u, san) => san !== 'g3' && san !== 'Bg2' });
    expect(texts(strict)).toContain('1.Nf3 Nf6 2.c4');
    expect(strict.notes.join(' ')).not.toMatch(/outline/);
  });

  it("gate V4 for a book repertoire: a move that is not book fails the line; a reply left unanswered flags the others", async () => {
    const r = await buildFromBook(plan(), deps());
    const all = r.lines.map(() => true);
    const ok = gateV4Book(r.lines, all, r.positions, { minGames: 25, depth: 3 });
    expect(ok.gates.map((g) => g.result)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
    // a move the masters did not play
    const odd = [...r.lines];
    odd[3] = { ...odd[3]!, moves: ['Nf3', 'Nf6', 'g3', 'g6', 'h3'] };
    const bad = gateV4Book(odd, all, r.positions, { minGames: 25, depth: 3 });
    expect(bad.gates[3]).toMatchObject({ result: 'fail', at: 4 });
    expect(bad.gates[3]!.detail).toMatch(/3\.h3 is not book: the masters played it in 0 games \(the book rule is 25\)/);
    // the 2...Bg4 line left out: the other line through 2.b3 is flagged
    const missing = gateV4Book(r.lines, [true, false, true, true, true], r.positions, { minGames: 25, depth: 3 });
    expect(missing.gates[0]).toMatchObject({ result: 'flag' });
    expect(missing.gates[0]!.detail).toMatch(/after 1\.Nf3 d5 2\.b3: not answered: Bg4/);
  });
});
