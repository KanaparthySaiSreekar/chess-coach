import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileLadder, lineSteps, positionKey, repertoireLines, type ConceptLadderFile, type RepLine, type ReplySource } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { Db } from '../src/db.ts';
import { EngineService } from '../src/engine/service.ts';
import { FactService } from '../src/facts-service.ts';
import { RepertoireService, type RepertoireOptions } from '../src/repertoire.ts';
import { TEST_REPERTOIRE } from '../../core/test/fixtures/repertoire.ts';

// PLAN WP 8.6, the test that says it is done: every sentence passes V3. The words in the fixture were
// written from the worksheet's facts (tools/author.ts sheet), as the author-repertoire skill asks.
const WORDS = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repertoire-words.json'), 'utf8')) as { line: string; why: string; idea: string }[];

describe("a repertoire's words (WP 8.6)", () => {
  let engine: EngineService;
  beforeAll(async () => {
    engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 2, analysisWorkers: 4, expectedBench: config.expectedBench });
    await engine.verify();
  });
  afterAll(async () => {
    await engine?.stop();
  });

  it('the worksheet lists each position of mine once with its facts; written words that keep to them pass V3, a claim the facts do not back quarantines the lines through that position', async () => {
    const db = new Db(':memory:');
    const facts = new FactService(engine, { nodes: 300_000, verdictNodes: 1_000_000 });
    facts.useCloud = false;
    const ladder = compileLadder(JSON.parse(readFileSync(config.ladderFile, 'utf8')) as ConceptLadderFile);
    const options: RepertoireOptions = { nodes: 1_000_000, secondNodes: 2_000_000, maxDrop: 4, minCovered: 85, flagShare: 5, depthMoves: 9, autoApprove: false };
    // what players reply: exactly the replies the lines prepare (this test is about the words, not about V4)
    const played = new Map<string, { uci: string; san: string; share: number }[]>();
    for (const line of repertoireLines(TEST_REPERTOIRE, 'white').lines)
      for (const s of lineSteps(line).steps)
        if (!s.mine) {
          const k = positionKey(s.fenBefore);
          const list = played.get(k) ?? [];
          if (!list.some((x) => x.uci === s.uci)) list.push({ uci: s.uci, san: s.san, share: 10 });
          played.set(k, list);
        }
    const replies = async (fen: string): Promise<ReplySource | null> => ({ source: 'explorer', games: 1000, replies: played.get(positionKey(fen)) ?? [] });
    const service = new RepertoireService({ db, engine, replies, words: { facts, ladder, vocabulary: () => 'beginner' }, options: () => options, dataDir: '.', dbFile: ':memory:' });
    const report = await service.importPgn(TEST_REPERTOIRE, { name: 'Test White', colour: 'white', source: 'file:test-repertoire.pgn#1', licence: 'own', level: '400–700' });
    expect(report.quarantined).toBe(3);

    // the worksheet: the seven positions of mine on the three sound lines, once each, with facts that say why
    const sheet = await service.worksheet(report.id);
    expect(sheet.map((x) => x.line)).toEqual(WORDS.map((w) => w.line));
    const nf3 = sheet.find((x) => x.line === '1.e4 e5 2.Nf3')!;
    expect(nf3.last).toBe('e5');
    expect(nf3.facts.some((f) => /Why: it attacks their pawn on \{sq:e5\}; it develops your knight/.test(f))).toBe(true);
    expect(nf3.facts.every((f) => !/@P\d/.test(f))).toBe(true);

    // the words, written from those facts: every sentence passes V3
    const keyOf = (line: string) => sheet.find((x) => x.line === line)!.key;
    const ok = await service.setWords(report.id, WORDS.map((w) => ({ key: keyOf(w.line), why: w.why, idea: w.idea })));
    if (!ok.ok) throw new Error(ok.reason);
    expect(ok.unknown).toEqual([]);
    expect(ok.report.quarantined).toBe(3); // the same three bad lines, nothing more
    const sound = db.repertoireItems<RepLine>(report.id).filter((i) => i.status !== 'quarantined');
    expect(sound).toHaveLength(3);
    for (const item of sound) expect(item.gates.find((g) => g.gate === 'V3')).toEqual({ gate: 'V3', result: 'pass' });
    expect((await service.worksheet(report.id)).find((x) => x.line === '1.e4 e5 2.Nf3')!.why).toBe(WORDS[1]!.why);

    // a claim the facts do not back: the lines through that position are quarantined, with the sentence
    const bad = await service.setWords(report.id, [{ key: keyOf('1.e4 e5 2.Nf3'), why: '{m:Nf3} forks the king and the queen.', idea: '' }]);
    if (!bad.ok) throw new Error(bad.reason);
    expect(bad.report.quarantined).toBe(5);
    const v3 = bad.report.quarantine.filter((q) => q.reasons.some((r) => r.startsWith('V3')));
    expect(v3.map((q) => q.line)).toEqual(['1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4', '1.e4 e5 2.Nf3 d6 3.d4']);
    expect(v3[0]!.reasons[0]).toMatch(/^V3 Text claims: at 1\.e4 e5 2\.Nf3: the why "\{m:Nf3\} forks the king and the queen\.": .*fork/);
    // written again from the facts: back through the gate
    const fixed = await service.setWords(report.id, [{ key: keyOf('1.e4 e5 2.Nf3'), why: WORDS[1]!.why, idea: WORDS[1]!.idea }]);
    expect(fixed.ok && fixed.report.quarantined).toBe(3);
    db.close();
  }, 300_000);
});
