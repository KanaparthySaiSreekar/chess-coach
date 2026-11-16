import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileLadder, legalMoves, mustPosition, type ConceptLadderFile, type EndgameFile, type EndgameItem } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { Db } from '../src/db.ts';
import { EndgamePack, EndgameTrainer, type EndgameEvent } from '../src/endgames.ts';
import { EngineService } from '../src/engine/service.ts';
import { FactService } from '../src/facts-service.ts';

// The Endgames tab (F2, built early): every position of content/endgames.json passes its gates
// against the tablebases, and the trainer judges each move exactly. Real Stockfish with Syzygy 3-4-5.
describe('endgame training (F2)', () => {
  let engine: EngineService;
  beforeAll(async () => {
    engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 2, analysisWorkers: 6, expectedBench: config.expectedBench });
    await engine.verify();
  });
  afterAll(async () => {
    await engine?.stop();
  });

  const packFor = (db: Db, file = path.join(config.repoRoot, 'content', 'endgames.json')) => {
    const facts = new FactService(engine, { nodes: 300_000, verdictNodes: 1_000_000 });
    facts.useCloud = false;
    return new EndgamePack({
      db,
      engine,
      facts,
      ladder: compileLadder(JSON.parse(readFileSync(config.ladderFile, 'utf8')) as ConceptLadderFile),
      vocabulary: () => 'beginner',
      nodes: () => 1_000_000,
      autoApprove: () => true,
      file,
    });
  };
  const trainerFor = (db: Db) => new EndgameTrainer({ db, engine, nodes: () => 300_000, schedule: () => ({ reviewCap: 50, maxDays: 365 }), onChange: () => {} });
  /** a repeatable source of chance (mulberry32) */
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const idOf = (db: Db, key: string) => db.contentKeys('endgame').find((k) => k.key === `endgame:${key}`)!.id;
  /** the from and to squares of a move given in SAN */
  const sq = (fen: string, san: string): [string, string] => {
    const m = legalMoves(mustPosition(fen)).find((x) => x.san === san);
    if (!m) throw new Error(`${san} is not legal in ${fen}`);
    return [m.from, m.to];
  };

  let shared: Db;
  it('every position passes every gate: the tablebases agree with its goal, its words are backed by the facts', async () => {
    shared = new Db(':memory:');
    const pack = packFor(shared);
    const r = await pack.sync();
    const items = shared.contentKeys('endgame').map((k) => shared.getContent(k.id)!);
    const report = items.map((i) => `${(i.body as unknown as EndgameItem).id}: ${i.status} ${i.gates.filter((g) => g.result !== 'pass').map((g) => `${g.gate} ${g.detail}`).join(' | ')}`);
    expect(report.filter((x) => !x.endsWith(': live '))).toEqual([]);
    expect(r).toMatchObject({ checked: pack.read().positions.length, quarantined: 0 });
    expect(items.every((i) => i.gates.map((g) => g.gate).join(',') === 'V1,V2,V3,V8,V6')).toBe(true);
    // nothing changed: nothing is checked again
    expect(await pack.sync()).toMatchObject({ checked: 0, skipped: items.length });
  }, 600_000);

  it('a position whose goal the tablebases contradict is quarantined with the reason', async () => {
    const db = new Db(':memory:');
    const real = JSON.parse(readFileSync(path.join(config.repoRoot, 'content', 'endgames.json'), 'utf8')) as EndgameFile;
    // the square: Black catches the pawn, so "queen it" for Black is no task; and a won queen mate called a draw
    const file: EndgameFile = {
      topics: real.topics,
      positions: [
        { id: 'wrong-win', topic: 'square', name: 'x', fen: '8/8/8/P7/8/5k2/8/7K w - - 0 1', goal: 'draw' },
        { id: 'wrong-draw', topic: 'square', name: 'y', fen: '8/8/5k2/1P6/8/8/8/7K b - - 0 1', goal: 'mate' },
      ],
    };
    const f = path.join(mkdtempSync(path.join(tmpdir(), 'eg-')), 'endgames.json');
    writeFileSync(f, JSON.stringify(file));
    const r = await packFor(db, f).sync();
    expect(r).toMatchObject({ checked: 2, quarantined: 2, live: 0 });
    const v2 = db.contentKeys('endgame').map((k) => db.getContent(k.id)!.gates.find((g) => g.gate === 'V2')!);
    expect(v2.map((g) => g.result)).toEqual(['fail', 'fail']);
    expect(v2[0]!.detail).toContain('the goal is a draw, but the tablebases say win');
    expect(v2[1]!.detail).toContain('the goal is a win, but the tablebases say draw');
    db.close();
  }, 120_000);

  it('mate is the goal reached; stalemate throws the win, with the move that kept it', async () => {
    const t = trainerFor(shared);
    const fen = 'k7/8/1K6/2Q5/8/8/8/8 w - - 0 1';
    expect(t.start(idOf(shared, 'qm-corner'))).toEqual({ ok: true });
    expect(t.view).toMatchObject({ status: 'playing', you: 'white', yourTurn: true, position: { key: 'qm-corner', task: 'White to play: give mate.' } });
    // Qc7 leaves their king no move and no check: stalemate
    await t.move(...sq(fen, 'Qc7'));
    expect(t.view.status).toBe('over');
    expect(t.view.result).toMatchObject({ outcome: 'thrown', text: 'Qc7 lets the win go: stalemate.' });
    const better = legalMoves(mustPosition(fen)).find((m) => m.san === t.view.result!.better)!;
    expect(mustPosition(better.fenAfter).isCheckmate()).toBe(true);
    // the idea shows once it is over
    expect(t.view.position?.idea).toBeTruthy();
    // back to before the slip, and this time mate
    t.retryBefore();
    expect(t.view).toMatchObject({ status: 'playing', yourTurn: true, fen, moves: [], movesLeft: 60 });
    expect(t.view.result).toBeUndefined();
    await t.move(...sq(fen, 'Qc8#'));
    expect(t.view.result).toMatchObject({ outcome: 'done', text: 'Checkmate. Well played.' });
    // logged, and solved on the ladder
    const id = idOf(shared, 'qm-corner');
    expect(shared.attemptsOf(id).map((a) => a.result)).toEqual(['shown', 'solved']);
    expect(t.view.ladder.find((x) => x.id === 'queen-mate')!.positions.find((p) => p.id === id)!.solved).toBe(true);
  }, 120_000);

  it('a draw to hold: a king outside the square loses at once; one inside it gets the engine reply and plays on', async () => {
    const t = trainerFor(shared);
    const fen = '8/8/5k2/1P6/8/8/8/7K b - - 0 1';
    t.start(idOf(shared, 'sq-catch'));
    expect(t.view).toMatchObject({ you: 'black', movesLeft: 12, position: { task: 'Black to play: hold the draw.' } });
    await t.move(...sq(fen, 'Kg5'));
    expect(t.view.result).toMatchObject({ outcome: 'lost', text: 'Kg5 loses: the tablebases say they win from here.' });
    expect(['Ke5', 'Ke6', 'Ke7']).toContain(t.view.result!.better);
    t.retry();
    await t.move(...sq(fen, 'Ke6'));
    expect(t.view).toMatchObject({ status: 'playing', yourTurn: true, busy: false, movesLeft: 11 });
    expect(t.view.moves.map((m) => m.by)).toEqual(['black', 'white']);
  }, 120_000);

  it('the coach hears how a go ended: the slip with the position it was played in, or the goal reached; asking it counts as a hint', async () => {
    const events: EndgameEvent[] = [];
    const topics = (JSON.parse(readFileSync(path.join(config.repoRoot, 'content', 'endgames.json'), 'utf8')) as EndgameFile).topics;
    const t = new EndgameTrainer({ db: shared, engine, nodes: () => 300_000, schedule: () => ({ reviewCap: 50, maxDays: 365 }), onChange: () => {}, onEvent: (e) => events.push(e), topics: () => topics });
    const fen = 'k7/8/1K6/2Q5/8/8/8/8 w - - 0 1';
    const id = idOf(shared, 'qm-corner');
    t.start(id);
    // while it is played: the task, the topic's words, no idea (not asked for), no slip
    expect(t.coachState()).toMatchObject({ id, playing: true, you: 'white', fen, moves: [], position: { goal: 'mate', topic: 'Queen and king against king', about: expect.stringContaining('edge') } });
    expect(t.coachState()!.position.idea).toBeUndefined();
    expect(t.coachState()!.slip).toBeUndefined();
    t.noteHelp();
    expect(t.view.asked).toBe(1);
    await t.move(...sq(fen, 'Qc7'));
    expect(events).toEqual([{ kind: 'endgame_over', outcome: 'thrown', text: 'Qc7 lets the win go: stalemate.', better: expect.any(String), slip: { san: 'Qc7', fenBefore: fen, fenAfter: expect.stringMatching(/^k7\/2Q5\/1K6\//) } }]);
    expect(t.coachState()).toMatchObject({ playing: false, slip: { san: 'Qc7', fenBefore: fen }, lastMove: { san: 'Qc7', baseFen: fen } });
    expect(t.coachState()!.position.idea).toBeTruthy();
    // the help asked for counts as a hint
    expect(shared.attemptsOf(id).at(-1)).toMatchObject({ result: 'shown', hints: 1 });
    t.retryBefore();
    await t.move(...sq(fen, 'Qc8#'));
    expect(events.at(-1)).toMatchObject({ kind: 'endgame_over', outcome: 'done' });
    expect(events.at(-1)!.slip).toBeUndefined();
    t.close();
  }, 120_000);

  it('a random start is checked by the tablebases, played out to mate by a correct line, and neither stored nor scheduled (PLAN 9.3)', async () => {
    const db = new Db(':memory:');
    const topics = (JSON.parse(readFileSync(path.join(config.repoRoot, 'content', 'endgames.json'), 'utf8')) as EndgameFile).topics;
    for (const [kind, seed] of [['queen', 7], ['rook', 11]] as const) {
      const t = new EndgameTrainer({ db, engine, nodes: () => 300_000, schedule: () => ({ reviewCap: 50, maxDays: 365 }), onChange: () => {}, topics: () => topics, random: seeded(seed) });
      expect(await t.startRandom(kind)).toEqual({ ok: true });
      expect(t.view).toMatchObject({ status: 'playing', you: 'white', yourTurn: true, position: { random: kind, goal: 'mate', hasIdea: false, topicName: kind === 'queen' ? 'Queen and king against king' : 'Rook and king against king' } });
      expect(t.view.id).toBeLessThan(0);
      // a correct line: the engine's own choice for White at every move
      for (let i = 0; i < 70 && t.view.status === 'playing'; i++) {
        const r = await engine.analyse({ fen: t.view.fen, nodes: 300_000, multipv: 1 });
        const uci = r.lines[0]!.pv[0]!;
        await t.move(uci.slice(0, 2), uci.slice(2, 4));
      }
      expect(t.view.result).toMatchObject({ outcome: 'done', text: 'Checkmate. Well played.' });
    }
    // practice on top of the ladder: nothing stored, nothing scheduled, each go logged
    expect(db.contentKeys('endgame')).toEqual([]);
    expect(db.recentEvents('endgame', 5).map((e) => (JSON.parse(e.data) as { random?: string }).random).sort()).toEqual(['queen', 'rook']);
    db.close();
  }, 300_000);

  it('the idea on request counts as a hint; stopping logs the go', async () => {
    const t = trainerFor(shared);
    t.start(idOf(shared, 'rm-edge'));
    expect(t.view.position?.idea).toBeUndefined();
    t.idea();
    expect(t.view.position?.idea).toContain('kings face each other');
    t.resign();
    await new Promise((r) => setTimeout(r, 50));
    expect(t.view.result).toMatchObject({ outcome: 'gave_up' });
    const id = idOf(shared, 'rm-edge');
    expect(shared.attemptsOf(id)).toMatchObject([{ result: 'shown', hints: 1 }]);
    t.close();
    expect(t.view.status).toBe('idle');
    shared.close();
  }, 60_000);
});
