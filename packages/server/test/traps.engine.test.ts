import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileLadder, isCardMove, positionKey, readExplorer, trapCard, type ConceptLadderFile, type RawExplorerAnswer, type TrapFile, type TrapItem } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { Db } from '../src/db.ts';
import { EngineService } from '../src/engine/service.ts';
import { FactService } from '../src/facts-service.ts';
import { TrapPack, type TrapOptions } from '../src/traps.ts';

// PLAN WP 8.9, the test that says it is done: every trap of the pack passes the gates. Real Stockfish;
// how often players at the owner's level reach each position comes from the explorer's answers,
// recorded once (explorer.lichess.org, players under 1200, rapid, classical and daily, 2026-11-15).
const here = path.dirname(fileURLToPath(import.meta.url));
const recorded = new Map(
  readdirSync(path.join(here, 'fixtures', 'explorer', 'traps')).map((f) => {
    const r = JSON.parse(readFileSync(path.join(here, 'fixtures', 'explorer', 'traps', f), 'utf8')) as { fen: string; answer: RawExplorerAnswer };
    return [positionKey(r.fen), readExplorer(r.fen, r.answer)!.games] as const;
  }),
);

describe('the trap pack (WP 8.9)', () => {
  let engine: EngineService;
  beforeAll(async () => {
    engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 2, analysisWorkers: 6, expectedBench: config.expectedBench });
    await engine.verify();
  });
  afterAll(async () => {
    await engine?.stop();
  });

  const pack = (db: Db, file = path.join(config.repoRoot, 'content', 'traps.json'), options?: Partial<TrapOptions>) => {
    const facts = new FactService(engine, { nodes: 300_000, verdictNodes: 1_000_000 });
    facts.useCloud = false;
    return new TrapPack({
      db,
      engine,
      facts,
      ladder: compileLadder(JSON.parse(readFileSync(config.ladderFile, 'utf8')) as ConceptLadderFile),
      vocabulary: () => 'beginner',
      games: async (fen) => recorded.get(positionKey(fen)) ?? null,
      options: () => ({ nodes: 2_000_000, secondNodes: 6_000_000, maxDrop: 4, autoApprove: true, ...options }),
      file,
    });
  };

  it('every trap passes every gate: the defence sound, the trap real, the words backed by the facts, the position met at the owner level', async () => {
    const db = new Db(':memory:');
    const p = pack(db);
    const r = await p.sync();
    const items = db.contentKeys('trap').map((k) => db.getContent(k.id)!);
    const report = items.map((i) => `${(i.body as unknown as TrapItem).id}: ${i.status} ${i.gates.filter((g) => g.result !== 'pass').map((g) => `${g.gate} ${g.detail}`).join(' | ')}`);
    expect(report.filter((x) => !x.endsWith(': live '))).toEqual([]);
    expect(r).toMatchObject({ checked: 6, live: 6, quarantined: 0 });
    expect(items.every((i) => i.gates.map((g) => g.gate).join(',') === 'V1,V2,V3,V4,V7,V6')).toBe(true);
    // the other sound defences count as right on the card; the move they hope for does not
    const scholar = items.find((i) => (i.body as unknown as TrapItem).id === 'scholar-bc4-qh5')!.body as unknown as TrapItem;
    const card = trapCard(scholar);
    expect(isCardMove(card, 'g6')).toBe(true);
    expect(isCardMove(card, 'Nf6')).toBe(false);
    expect(scholar.accepted.length).toBeGreaterThan(0);
    // nothing changed: nothing is checked again
    expect(await p.sync()).toMatchObject({ checked: 0, skipped: 6 });
    db.close();
  }, 600_000);

  it('a trap that is no trap, words the facts do not back, or a position nobody reaches are each quarantined with the reason', async () => {
    const db = new Db(':memory:');
    const p = pack(db);
    const traps = p.read();
    const scholar = traps.find((t) => t.id === 'scholar-bc4-qh5')!;
    const noTrap: TrapFile = { ...scholar, id: 'no-trap', hope: 'Qe7' }; // a good move, not a blunder
    const badWords: TrapFile = { ...scholar, id: 'bad-words', why: '{m:g6} forks their queen and their king.' };
    const rare: TrapFile = { ...scholar, id: 'rare', moves: 'e4 e5 Bc4 Nc6 Qh5 Nf6 Qe2' , hope: 'Bc5', move: 'd5', why: '', idea: '' };
    const [a, b, c] = await Promise.all([p.gate(noTrap), p.gate(badWords), p.gate(rare)]);
    expect(a.status).toBe('quarantined');
    expect(a.gates.find((g) => g.gate === 'V2')!.detail).toMatch(/the move they hope for, Qe7, does not lose here/);
    expect(b.status).toBe('quarantined');
    expect(b.gates.find((g) => g.gate === 'V3')!.detail).toMatch(/^the why "\{m:g6\} forks their queen and their king\.":.*fork/);
    expect(c.status).toBe('quarantined');
    expect(c.gates.find((g) => g.gate === 'V4')).toMatchObject({ result: 'n/a' }); // no recorded answer: not checked, so not live
    db.close();
  }, 600_000);
});
