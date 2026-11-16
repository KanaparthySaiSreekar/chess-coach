import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { START_FEN, lineText, playLine, positionKey, type RepLine, type ReplySource } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { Db } from '../src/db.ts';
import { EngineService } from '../src/engine/service.ts';
import { RepertoireService, type RepertoireOptions } from '../src/repertoire.ts';

// PLAN WP 8.5, the test that says it is done: the same seeds, settings and cached answers give the
// same starter repertoire. Real Stockfish at small budgets; stand-ins for the explorer and for Maia.
const at = (moves: string) => {
  const r = playLine(START_FEN, moves.split(' '));
  if (!r.ok) throw new Error(moves);
  return positionKey(r.fens.at(-1)!);
};
const sans = (pairs: [string, string, number][]) => pairs.map(([uci, san, share]) => ({ uci, san, share }));
// what players at the owner's level reply (as the explorer would count it)
const REPLIES = new Map<string, ReplySource>([
  [at('e4'), { source: 'explorer', games: 100_000, replies: sans([['e7e5', 'e5', 60], ['c7c5', 'c5', 20], ['d7d5', 'd5', 8], ['e7e6', 'e6', 6], ['b8c6', 'Nc6', 4], ['a7a6', 'a6', 2]]) }],
  [at('e4 e5 Nf3'), { source: 'explorer', games: 60_000, replies: sans([['b8c6', 'Nc6', 55], ['d7d6', 'd6', 15], ['g8f6', 'Nf6', 12], ['f7f6', 'f6', 10], ['d8e7', 'Qe7', 5], ['f8c5', 'Bc5', 3]]) }],
]);
// Maia's probabilities at the owner's level: after 1...c5, most players at this level answer 2.Nc3
const HUMAN = new Map<string, { uci: string; p: number }[]>([[at('e4 c5'), [{ uci: 'b1c3', p: 0.5 }, { uci: 'g1f3', p: 0.3 }, { uci: 'd2d4', p: 0.2 }]]]);

describe('the starter builder (WP 8.5)', () => {
  let engine: EngineService;
  beforeAll(async () => {
    engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 1, analysisWorkers: 4, expectedBench: config.expectedBench });
    await engine.verify();
  });
  afterAll(async () => {
    await engine?.stop();
  });

  it('builds the same repertoire from the same seeds and answers: the seeds, the replies people play until 85% are covered, the moves people find, the mistakes to punish', async () => {
    const db = new Db(':memory:');
    const asked: string[] = [];
    const options: RepertoireOptions = { nodes: 1_000_000, secondNodes: 2_000_000, maxDrop: 4, minCovered: 85, flagShare: 5, depthMoves: 5, autoApprove: false };
    const service = new RepertoireService({
      db,
      engine,
      replies: async (fen) => (asked.push(fen), REPLIES.get(positionKey(fen)) ?? null),
      human: async (fen) => HUMAN.get(positionKey(fen)) ?? null,
      options: () => options,
      dataDir: '.',
      dbFile: ':memory:',
    });
    const request = { colour: 'white' as const, seeds: '1. e4 e5 2. Nf3 Nc6 3. Bc4', name: 'Starter for White', minReach: 2, level: '400–700', date: '2026-11-15' };
    const first = await service.buildStarter(request);
    const second = await service.buildStarter(request);
    const lines = (id: number) => db.repertoireItems<RepLine>(id).map((i) => ({ line: lineText(i.body.startFen, i.body.moves), punish: i.body.punish, status: i.status }));
    // the same answers twice: the same repertoire
    expect(lines(second.id)).toEqual(lines(first.id));
    const built = lines(first.id);
    const text = built.map((l) => l.line);
    // the seeds are followed while the opponent stays on them
    expect(text).toContain('1.e4 e5 2.Nf3 Nc6 3.Bc4');
    // after 1.e4: e5, c5 and d5 cover 88% of games, and e6 (6%) is common enough to need an answer too; Nc6 (4%) is not
    expect(text.filter((l) => /^1\.e4 (e5|c5|d5|e6) /.test(l)).length).toBe(text.length);
    expect(text.some((l) => l.startsWith('1.e4 e6 2.'))).toBe(true);
    expect(text.some((l) => l.startsWith('1.e4 Nc6'))).toBe(false);
    // after 2.Nf3: Nc6, d6, Nf6, f6 and Qe7 (5%); Bc5 (3%) is not needed
    for (const reply of ['Nc6', 'd6', 'Nf6', 'f6', 'Qe7']) expect(text.some((l) => l.startsWith(`1.e4 e5 2.Nf3 ${reply} 3.`))).toBe(true);
    expect(text.some((l) => l.startsWith('1.e4 e5 2.Nf3 Bc5'))).toBe(false);
    // where the seeds stop, the sound move players at the owner's level choose most (Maia: 2.Nc3 after 1...c5)
    expect(text).toContain('1.e4 c5 2.Nc3');
    // 2...f6 is a mistake to punish; every line ends on a move of mine
    expect(built.find((l) => l.line.startsWith('1.e4 e5 2.Nf3 f6'))!.punish).toEqual([3]);
    expect(built.filter((l) => l.punish).length).toBe(1);
    for (const l of db.repertoireItems<RepLine>(first.id)) expect(l.body.moves.length % 2).toBe(1);
    // through the gates like any repertoire: none quarantined, nothing flagged, all waiting for the owner
    expect(first.quarantined).toBe(0);
    expect(first.flagged).toBe(0);
    expect(built.every((l) => l.status === 'machine-verified')).toBe(true);
    expect(db.repertoire(first.id)!.source).toMatch(/^generated:[^:]+:2026-11-15:starter-builder$/);
    db.close();
  }, 240_000);
});
