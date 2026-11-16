import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContentItem, RepLine, ReplySource } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { Db } from '../src/db.ts';
import { EngineService } from '../src/engine/service.ts';
import { RepertoireService, type RepertoireOptions } from '../src/repertoire.ts';
import { TEST_REPERTOIRE } from '../../core/test/fixtures/repertoire.ts';

// PLAN WP 8.3, the test that says it is done: a PGN with one illegal move, one unsound move and one
// transposition conflict: exactly those three lines are quarantined. Real Stockfish, smaller budgets
// than the app's (V2 at 1M nodes, V7 at 2M) so the test stays short; the gates are the app's.
describe('a repertoire through its gates (WP 8.3)', () => {
  let engine: EngineService;
  let db: Db;
  beforeAll(async () => {
    engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 1, analysisWorkers: 4, expectedBench: config.expectedBench });
    await engine.verify();
    db = new Db(':memory:');
  });
  afterAll(async () => {
    await engine?.stop();
    db?.close();
  });

  it('quarantines exactly the illegal, the unsound and the conflicting line, with the reason and the move; a gap in coverage only flags', async () => {
    const asked: string[] = [];
    // what players at the owner's level reply (a stand-in for the explorer): after 1.e4, d5 is common and not prepared
    const replies = async (fen: string): Promise<ReplySource | null> => {
      asked.push(fen);
      if (fen.startsWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b')) {
        return { source: 'explorer', games: 5000, replies: [{ uci: 'e7e5', san: 'e5', share: 60 }, { uci: 'c7c5', san: 'c5', share: 20 }, { uci: 'd7d5', san: 'd5', share: 12 }, { uci: 'g8f6', san: 'Nf6', share: 3 }] };
      }
      return { source: 'maia', replies: [] }; // nothing known: covered by default
    };
    const options: RepertoireOptions = { nodes: 1_000_000, secondNodes: 2_000_000, maxDrop: 4, minCovered: 85, flagShare: 5, depthMoves: 9, autoApprove: false };
    const service = new RepertoireService({ db, engine, replies, options: () => options, dataDir: '.', dbFile: ':memory:' });
    const report = await service.importPgn(TEST_REPERTOIRE, { name: 'Test White', colour: 'white', source: 'file:test-repertoire.pgn#1', licence: 'own', level: '400–700' });

    expect(report.lines).toBe(6);
    expect(report.quarantined).toBe(3);
    expect(report.quarantine.map((q) => q.line)).toEqual(['1.e4 Nc6 2.Ke3', '1.e4 a6 2.Bxa6 bxa6 3.d4', '1.e4 d6 2.Nf3 e5 3.Bc4']);
    const [illegal, unsound, conflict] = report.quarantine;
    expect(illegal!.reasons[0]).toBe('V1 Legality: 2.Ke3 is not a legal move after 1.e4 Nc6');
    expect(unsound!.reasons[0]).toMatch(/^V2 Engine soundness: 1\.e4 a6 2\.Bxa6: Bxa6 is not sound \(.+\); the engine plays \S+ here \(1,000,000 nodes\)$/);
    expect(conflict!.reasons[0]).toBe('V5 Consistency: after 1.e4 d6 2.Nf3 e5 this line plays 3.Bc4, but the repertoire already plays d4 in that position (reached by 1.e4 e5 2.Nf3 d6)');

    // the three sound lines passed every gate and wait for the owner's yes; the gap after 1.e4 flags them
    const items = db.repertoireItems<RepLine>(report.id);
    const passed = items.filter((i) => i.status !== 'quarantined');
    expect(passed.map((i) => i.body.moves.join(' '))).toEqual(['e4 e5 Nf3 Nc6 Bb5 a6 Ba4', 'e4 e5 Nf3 d6 d4', 'e4 c5 Nf3 d6 d4']);
    expect(passed.every((i) => i.status === 'machine-verified')).toBe(true);
    for (const item of passed as ContentItem<RepLine>[]) {
      expect(item.gates.map((g) => `${g.gate}:${g.result}`)).toEqual(['V1:pass', 'V2:pass', 'V3:pass', 'V4:flag', 'V5:pass', 'V7:pass', 'V6:pass']);
      expect(item.gates.find((g) => g.gate === 'V4')!.detail).toBe('after 1.e4: 84.2% of the games at your level covered; not covered: d5 (12.6%)');
    }
    expect(report.flagged).toBe(3);
    expect(report.coverage.find((c) => c.at === '1.e4')).toMatchObject({ covered: 84.2, missing: [{ san: 'd5', share: 12.6 }] });
    // the explorer was asked once per opponent position of the lines still in, none of the quarantined lines' positions
    expect(asked.length).toBe(new Set(asked).size);
    expect(asked.some((f) => f.startsWith('rnbqkbnr/1ppppppp/p7'))).toBe(false); // after 1...a6: the unsound line's
    // one line in ten (at least one) for the owner's spot check
    expect(report.sample).toHaveLength(1);
    expect(passed.map((i) => i.id)).toContain(report.sample[0]!.id);
    expect(report.gates.V1).toEqual({ pass: 5, fail: 1, flag: 0, na: 0 });
    expect(report.engine).toMatch(/1000000 nodes \(V2\), 2000000 nodes \(V7\)/);

    // run again (a changed engine or threshold, WP 8.11): the same items, the same verdicts
    const again = await service.revalidate(report.id);
    expect(again!.quarantine.map((q) => q.id)).toEqual(report.quarantine.map((q) => q.id));
    expect(db.repertoireItems(report.id)).toHaveLength(6);
  });
});
