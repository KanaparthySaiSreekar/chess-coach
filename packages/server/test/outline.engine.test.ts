import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { START_FEN, lineText, playLine, positionKey, readOutline, type BookTable, type BuildPosition, type Outline, type RepLine } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { ContentDesk } from '../src/content-desk.ts';
import { Db } from '../src/db.ts';
import { EngineService } from '../src/engine/service.ts';
import { RepertoireService, type BookPlan, type BookRequest, type RepertoireOptions } from '../src/repertoire.ts';

// PLAN WP 8.12, the test that says it is done: a repertoire built from the book around an outline,
// with real Stockfish at small budgets and a stand-in for the masters' games. The same answers give the
// same repertoire, built again in place; every move is book; the gates find the engine's work done.

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
  [at('Nf3 d5'), t([['d2d4', 'd4', 400], ['b2b3', 'b3', 100]])],
  [at('Nf3 Nf6'), t([['g2g3', 'g3', 200], ['c2c4', 'c4', 100]])],
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
const outline = (() => {
  const r = readOutline({ id: 'test-reti', name: 'Test Réti', colour: 'white', chapters: [{ moves: '1. Nf3 d5 2. b3' }, { moves: '1. Nf3 b5 2. e4' }] });
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.outline as Outline;
})();
const request: BookRequest = { hash: 'h1', level: '400–700', depth: 3, budget: 100, minGames: 25, outlineReach: 2, bookRule: { minCovered: 85, flagShare: 5, floor: 1 }, levelRule: { minCovered: 85, flagShare: 5, floor: 3 }, batch: 4, date: '2026-11-16' };

describe('a repertoire from the book (WP 8.12)', () => {
  let engine: EngineService;
  beforeAll(async () => {
    engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 1, analysisWorkers: 4, expectedBench: config.expectedBench });
    await engine.verify();
  });
  afterAll(async () => {
    await engine?.stop();
  });

  it('builds the lines the book holds, gates them against the same book, and builds them again in place', async () => {
    const db = new Db(':memory:');
    const options: RepertoireOptions = { nodes: 1_000_000, secondNodes: 2_000_000, maxDrop: 4, minCovered: 85, flagShare: 5, depthMoves: 2, autoApprove: false };
    let searchesAtGates = -1;
    const service = new RepertoireService({
      db,
      engine,
      replies: async () => null,
      book: async (fen) => BOOK.get(positionKey(fen)) ?? { games: 0, moves: [] },
      options: () => options,
      dataDir: '.',
      dbFile: ':memory:',
      // the gates start (V1) once the lines are built: from then on every search must be one already made
      onProgress: (p) => {
        if (p.step === 'V1' && searchesAtGates < 0) searchesAtGates = engine.stats.searches;
      },
    });
    const first = await service.buildFromOutline(outline, request);
    if (first.stopped) throw new Error('stopped');
    expect(engine.stats.searches).toBe(searchesAtGates);
    const id = first.report.id;
    const lines = () => db.repertoireItems<RepLine>(id).map((i) => ({ line: lineText(i.body.startFen, i.body.moves), chapter: i.body.chapter, book: i.body.book, status: i.status, v4: i.gates.find((g) => g.gate === 'V4')?.result }));
    const built = lines();
    expect(built.map((l) => l.line)).toEqual(['1.Nf3 d5 2.b3 Nf6 3.Bb2', '1.Nf3 d5 2.b3 Bg4 3.Bb2', '1.Nf3 b5 2.e4 a6 3.d4', '1.Nf3 Nf6 2.g3 g6 3.Bg2', '1.Nf3 Nf6 2.g3 d5 3.Bg2']);
    expect(built.map((l) => l.chapter)).toEqual(['1.Nf3 d5 2.b3', '1.Nf3 d5 2.b3', '1.Nf3 b5 2.e4', '1.Nf3 Nf6', '1.Nf3 Nf6']);
    expect(built[0]!.book).toEqual([1000, 600, 100, 50, 40]);
    // every move is book, every reply the rule asks for is answered: all waiting for the owner
    expect(built.every((l) => l.v4 === 'pass' && l.status === 'machine-verified')).toBe(true);
    expect(first.report.quarantined).toBe(0);
    expect(first.report.flagged).toBe(0);
    const rep = db.repertoire(id)!;
    expect(rep.source).toBe('generated:' + engine.signature.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') + ':2026-11-16:outline-test-reti');
    expect((rep.plan as BookPlan).kind).toBe('book');
    expect(db.repBook<BuildPosition>(id).get(at('Nf3'))!.required!.map((r) => r.san)).toEqual(['d5', 'Nf6', 'b5']);
    // the review screen: chapters in teaching order, with the build's rule
    const view = new ContentDesk(db).view().repertoires.find((r) => r.id === id)!;
    expect(view.chapters!.map((c) => [c.name, c.lines, c.waiting])).toEqual([['1.Nf3 d5 2.b3', 2, 2], ['1.Nf3 b5 2.e4', 1, 1], ['1.Nf3 Nf6', 2, 2]]);
    expect(view.built).toMatchObject({ outline: 'test-reti', minGames: 25, depth: 3 });

    // the owner approves one chapter; the build runs again with a smaller budget: the same id, the
    // approved lines that are still built stay live, the ones no longer built are removed
    expect(new ContentDesk(db).approveChapter(id, '1.Nf3 d5 2.b3')).toBe(2);
    const second = await service.buildFromOutline(outline, { ...request, budget: 3 });
    if (second.stopped) throw new Error('stopped');
    expect(second.report.id).toBe(id);
    const again = lines();
    expect(again.map((l) => l.line)).toEqual(['1.Nf3 d5 2.b3 Nf6 3.Bb2', '1.Nf3 d5 2.b3 Bg4 3.Bb2', '1.Nf3 b5 2.e4 a6 3.d4', '1.Nf3 Nf6 2.g3']);
    expect(again.slice(0, 2).every((l) => l.status === 'live')).toBe(true);
    expect(db.repertoires().length).toBe(1);

    // removed for good: lines, book, plan
    const removed = new ContentDesk(db).removeRepertoire(id);
    expect(removed).toMatchObject({ ok: true, lines: 4 });
    expect(db.repertoire(id)).toBeUndefined();
    expect(db.repBook(id).size).toBe(0);
    db.close();
  }, 240_000);
});
