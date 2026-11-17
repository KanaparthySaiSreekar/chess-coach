import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { START_FEN, describeMove, gradeMove, mustPosition, sanToMove, type RepLine, type ReplySource } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { Db } from '../src/db.ts';
import { EngineService } from '../src/engine/service.ts';
import { RepertoireService, type RepertoireOptions } from '../src/repertoire.ts';
import { basisChanges, becauseText, type GateBasis } from '../src/revalidate.ts';

// PLAN WP 8.11, the test that says it is done: a changed threshold quarantines a known borderline line.
// "Known borderline": a first move the engine itself rates between 2 and 4 points of winning chances
// below its best at the test's budget: sound at the default 4, not at 2.
describe('re-validation (WP 8.11)', () => {
  let engine: EngineService;
  beforeAll(async () => {
    engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 1, analysisWorkers: 4, expectedBench: config.expectedBench });
    await engine.verify();
  });
  afterAll(async () => {
    await engine?.stop();
  });

  it('a stricter "a move may lose at most" quarantines the borderline line, says what changed, keeps its id; set back, the line passes again', async () => {
    const nodes = 1_000_000;
    // find the borderline first move the way V2 grades it
    const best = (await engine.analyse({ fen: START_FEN, nodes, multipv: 1, pool: 'analysis' })).lines[0]!;
    let borderline: { san: string; drop: number } | null = null;
    for (const san of ['Nc3', 'g3', 'b3', 'c4', 'f4', 'e3', 'd3', 'Nf3', 'b4', 'a3', 'h3']) {
      const pos = mustPosition(START_FEN);
      const uci = describeMove(pos, sanToMove(pos, san)!).uci;
      const line = (await engine.analyse({ fen: START_FEN, nodes, multipv: 1, searchmoves: [uci], pool: 'analysis' })).lines[0]!;
      const g = gradeMove({ fenBefore: START_FEN, san, evalBefore: { fen: START_FEN, lines: [best] }, playedLine: line, you: 'white' })!;
      if (g.drop > 2.2 && g.drop < 3.8 && !g.floor && g.cls !== 'mistake' && g.cls !== 'blunder') {
        borderline = { san, drop: g.drop };
        break;
      }
    }
    expect(borderline, 'no first move between 2 and 4 points below the best at this budget').not.toBeNull();

    const db = new Db(':memory:');
    const options: RepertoireOptions = { nodes, secondNodes: 2_000_000, maxDrop: 4, minCovered: 85, flagShare: 5, depthMoves: 9, autoApprove: false };
    const replies = async (): Promise<ReplySource | null> => ({ source: 'explorer', games: 1000, replies: [] });
    const service = new RepertoireService({ db, engine, replies, options: () => options, dataDir: '.', dbFile: ':memory:' });
    const report = await service.importPgn(`1. ${borderline!.san} *`, { name: 'Borderline', colour: 'white', source: 'pasted:2026-11-15', licence: 'own', level: '400–700' });
    expect(report.quarantined).toBe(0);
    const [item] = db.repertoireItems<RepLine>(report.id);
    expect(item!.status).toBe('machine-verified');
    db.setContentStatus(item!.id, 'live'); // the owner approved it

    // the threshold is made stricter: the same line, checked again
    const before: GateBasis = { engine: engine.signature, nodes, secondNodes: 2_000_000, maxDrop: 4, thresholds: { inaccuracy: 10, mistake: 20, blunder: 30 } };
    options.maxDrop = 2;
    const because = becauseText(basisChanges(before, { ...before, maxDrop: 2 }))!;
    expect(because).toBe('re-checked after a change of the most a repertoire move may lose (4 → 2 points of winning chances)');
    const again = await service.revalidate(report.id, because);
    expect(again!.quarantined).toBe(1);
    const [after] = db.repertoireItems<RepLine>(report.id);
    expect(after!.id).toBe(item!.id); // the same item: its history stays with it
    expect(after!.status).toBe('quarantined');
    expect(after!.gates.find((g) => g.gate === 'V2')!.detail).toMatch(new RegExp(`^1\\.${borderline!.san}: ${borderline!.san} is not sound \\(.+\\); the engine plays \\S+ here \\(1,000,000 nodes\\) \\(re-checked after a change of the most a repertoire move may lose \\(4 → 2 points of winning chances\\)\\)$`));

    expect(after!.body.approvedBefore).toBe(true); // the owner's approval is remembered

    // set back: it passes again, and is live again without being approved a second time
    options.maxDrop = 4;
    const back = await service.revalidate(report.id, becauseText(basisChanges({ ...before, maxDrop: 2 }, before)));
    expect(back!.quarantined).toBe(0);
    const [restored] = db.repertoireItems<RepLine>(report.id);
    expect(restored!.status).toBe('live');
    expect(restored!.body.approvedBefore).toBeUndefined();

    // a line never approved that passes again only waits for the owner, as before
    const fresh = await service.importPgn(`1. ${borderline!.san} *`, { name: 'Never approved', colour: 'white', source: 'pasted:2026-11-17', licence: 'own', level: '400–700' });
    options.maxDrop = 2;
    await service.revalidate(fresh.id, because);
    options.maxDrop = 4;
    await service.revalidate(fresh.id);
    expect(db.repertoireItems<RepLine>(fresh.id)[0]!.status).toBe('machine-verified');
    db.close();
  }, 300_000);
});
