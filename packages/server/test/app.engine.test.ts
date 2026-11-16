// Integration tests against the real Stockfish install, with a fake coach process.
// Run with: npm run test:engine   (on AC power; a few seconds)

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importPgn, legalMoves, mainlineEnd, movesTo, mustPosition, pathTo, playLine, type CoachMessage, type GameView, type Insight, type LibraryView, type ReviewView, type ServerMsg, type SessionState, type TreeNode } from '@chess-coach/core';
import { App, engineBotNodes } from '../src/app.ts';
import type { MoveSource } from '../src/bots/service.ts';
import type { CoachTransport, TransportEvents } from '../src/coach/transport.ts';
import { config } from '../src/config.ts';
import { EngineService } from '../src/engine/service.ts';
import { fakeSites, ongoingCc } from './fake-sites.ts';
import { safetyItems } from '../src/safety.ts';
import { threatItem } from '../src/threat.ts';
import { ConvertTrainer } from '../src/convert.ts';
import { installPuzzles } from '../src/datasets/puzzle-db.ts';
import type { ContentItem, ConvertItem, ConvertView, Puzzle, PuzzleView, RepLine, SafetyView, ThreatView } from '@chess-coach/core';
import { STEP_QUESTION, gateV1Convert, gateV1Safety, gateV1Threat, makeScheduler, quarantineReasons, readEndgame, repertoireLines, review as reviewCard, themeName } from '@chess-coach/core';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('engine service (real Stockfish)', () => {
  let engine: EngineService;
  beforeAll(() => {
    engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 2, analysisWorkers: 2, expectedBench: config.expectedBench });
  });
  afterAll(async () => {
    await engine.stop();
  });

  it('is the expected build (decision D31)', async () => {
    const v = await engine.verify();
    expect(v.bench).toBe(config.expectedBench);
    expect(v.ok).toBe(true);
  });

  it('gives the same answer for the same request, and caches it', async () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
    const a = await engine.analyse({ fen, nodes: 100_000, multipv: 2 });
    const other = new EngineService({ path: config.stockfish, quickWorkers: 1 });
    other.signature = engine.signature;
    const b = await other.analyse({ fen, nodes: 100_000, multipv: 2 });
    await other.stop();
    expect(b.lines).toEqual(a.lines);
    const again = await engine.analyse({ fen, nodes: 100_000, multipv: 2 });
    expect(again.cached).toBe(true);
    expect(a.lines).toHaveLength(2);
  });

  it('finds a mate in one', async () => {
    const r = await engine.analyse({ fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', nodes: 50_000 });
    expect(r.lines[0]!.score).toEqual({ mate: 1 });
    expect(r.lines[0]!.pv[0]).toBe('d1d8');
  });

  it('refuses bad input before the engine sees it', async () => {
    await expect(engine.analyse({ fen: 'nonsense', nodes: 1000 })).rejects.toThrow(/not sent to the engine/);
    await expect(engine.analyse({ fen: '8/8/8/8/8/8/8/8 w - - 0 1', nodes: 1000 })).rejects.toThrow();
    await expect(engine.analyse({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', nodes: 1000, searchmoves: ['e2e5'] })).rejects.toThrow(/illegal move/);
    expect(engine.restarts).toBe(0);
  });

  it('restarts a worker that dies mid-search and still finishes every job', async () => {
    const fens = ['rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'];
    const jobs = fens.map((fen) => engine.analyse({ fen, nodes: 2_500_000, pool: 'analysis' }));
    // wait until a worker is really searching: a fixed pause was sometimes shorter than its start-up
    // (loading the tablebases takes a moment), and then there was no worker to kill yet
    const t0 = Date.now();
    while (!engine.enginesOf('analysis').some((e) => e.searching)) {
      if (Date.now() - t0 > 20_000) throw new Error('no worker started searching');
      await sleep(20);
    }
    await sleep(100);
    const victim = engine.enginesOf('analysis').find((e) => e.searching)!;
    (victim as unknown as { child: { kill: () => void } }).child.kill();
    const results = await Promise.all(jobs);
    expect(results.every((r) => r.lines.length === 1)).toBe(true);
    expect(engine.restarts).toBeGreaterThanOrEqual(1);
  });
});

// A coach process the test scripts: for each event it gets, it calls the tools the test queued.
type Step = (app: App, event: Record<string, any>) => Promise<void>;
class ScriptedCoach implements CoachTransport {
  running = false;
  steps: Step[] = [];
  seen: Record<string, any>[] = [];
  app!: App;
  events: TransportEvents;
  constructor(events: TransportEvents) {
    this.events = events;
  }
  start() {
    this.running = true;
  }
  stop() {
    this.running = false;
  }
  send(text: string) {
    const event = JSON.parse(text);
    this.seen.push(event);
    const step = this.steps.shift();
    void (async () => {
      await sleep(5);
      if (step) await step(this.app, event);
      this.events.result({ isError: false, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, apiMs: 1 });
    })();
  }
}

// Lichess's cloud analysis, stood in for: it knows one position (the quiet Italian) and nothing else
const ITALIAN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
let cloudOn = false;
const lichessStandIn = {
  evaluate: async (fen: string) =>
    cloudOn && fen === ITALIAN
      ? { depth: 45, knodes: 1, lines: [{ pv: ['c2c3', 'g8f6', 'd2d4'], score: { cp: 40 } }, { pv: ['d2d3', 'g8f6'], score: { cp: 35 } }, { pv: ['e1g1', 'g8f6'], score: { cp: 30 } }] }
      : null,
};

describe('the app with a scripted coach (real engine)', () => {
  let dir: string;
  let app: App;
  let coach: ScriptedCoach;
  let msgs: ServerMsg[];
  // the newest insight and game are kept apart from `msgs`, which each test empties
  let insight: Insight | null = null;
  let game: GameView | null = null;
  const client = {
    send: (m: ServerMsg) => {
      if (m.type === 'insight') insight = m.insight;
      if (m.type === 'game') game = m.game;
      msgs.push(m);
    },
  };
  const focusNode = (): TreeNode => {
    const st = app.session.state;
    return st.tree.nodes[st.focus]!;
  };
  // a stand-in for Maia: always the first legal move
  const firstMoveBot: MoveSource = {
    state: 'ready',
    probabilities: async (req) => {
      const r = playLine(req.startFen, req.moves);
      if (!r.ok) throw new Error('bad history');
      return [{ uci: legalMoves(mustPosition(r.fens.at(-1)!))[0]!.uci, p: 1 }];
    },
    stop: () => {},
  };
  const coachMsgs = () => msgs.filter((m): m is Extract<ServerMsg, { type: 'coach_msg' }> => m.type === 'coach_msg').map((m) => m.message);
  const lastState = () => (msgs.filter((m) => m.type === 'state').at(-1) as { state: SessionState }).state;
  const until = async (test: () => boolean, ms = 15_000) => {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 > ms) throw new Error('timed out waiting');
      await sleep(20);
    }
  };
  const fromCoach = (source?: string) => coachMsgs().filter((m: CoachMessage) => m.from === 'coach' && (!source || m.source === source));

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-app-'));
    app = new App({
      repoRoot: config.repoRoot,
      dataDir: dir,
      stockfish: config.stockfish,
      syzygy: config.syzygy,
      claudePath: 'unused',
      openingsDir: config.openingsDir,
      mcpUrl: 'http://127.0.0.1:1/mcp',
      cloud: lichessStandIn,
      botSource: firstMoveBot,
      botNoDelay: true,
      makeTransport: (events) => {
        coach = new ScriptedCoach(events);
        coach.app = app;
        return coach;
      },
    });
    app.engine.signature = 'test';
    app.addClient(client);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const setup = async (moves: string) => {
    msgs = [];
    await app.onClientMessage(client, { type: 'coach', action: 'stop' });
    await app.onClientMessage(client, { type: 'new' });
    await app.onClientMessage(client, { type: 'load', text: moves });
    await app.onClientMessage(client, { type: 'nav', to: 'end' });
    msgs = [];
  };

  it('with the coach off, the chips still work from the scripted fallback (A11)', async () => {
    await setup('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    await app.onClientMessage(client, { type: 'chip', chip: 'hint' });
    await until(() => fromCoach('scripted').length === 1);
    expect(fromCoach('scripted')[0]!.kind).toBe('question');
    await app.onClientMessage(client, { type: 'chip', chip: 'hint' });
    await until(() => fromCoach('scripted').length === 2);
    expect(fromCoach('scripted')[1]!.text).toBe('Look at the knight on e5.');
    await app.onClientMessage(client, { type: 'chip', chip: 'tell_me' });
    await until(() => fromCoach('scripted').length === 3);
    expect(fromCoach('scripted')[2]!.kind).toBe('answer');
    expect(fromCoach('scripted')[2]!.text).toMatch(/^Your strongest move is Ng4/);
    expect(lastState().shapes.coach.length).toBeGreaterThan(0); // and it drew the move
  });

  it('a question starts the coach; a true message reaches the page with clickable tokens', async () => {
    await setup('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    coach.steps.push(async (a, ev) => {
      const hang = ev.facts.facts.find((f: any) => f.type === 'hangs' && f.text.includes('{pc:Ne5}'));
      const r = await a.tools.say({ seq: ev.seq, kind: 'explain', text: `Your knight {pc:Ne5} is hanging: their queen {pc:Qd4} attacks it.`, claims: [hang.id] });
      expect(r.ok).toBe(true);
    });
    await app.onClientMessage(client, { type: 'ask', text: 'why is my knight in danger?' });
    await until(() => fromCoach('coach').length === 1);
    const m = fromCoach('coach')[0]!;
    expect(m.kind).toBe('explain');
    expect(m.segments.filter((s) => s.type === 'token')).toHaveLength(2);
    expect(coach.seen[0]).toMatchObject({ event: 'owner_question', ownerSaid: 'why is my knight in danger?' });
    expect(JSON.stringify(coach.seen[0])).not.toMatch(/"cp"|"score"|"win":/); // no engine numbers reach the coach
  });

  it('an invented claim never reaches the page; after repeated rejects the fallback answers instead', async () => {
    await setup('e4 e5 Nf3 Nc6 Bc4 Bc5');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const results: any[] = [];
    coach.steps.push(async (a, ev) => {
      for (const text of ['{m:Bxf7+} wins their queen for free.', 'Take with Bxf7 and you win a rook.', 'Their {pc:Qd8} is hanging right now.']) {
        results.push(await a.tools.say({ seq: ev.seq, kind: 'explain', text, claims: [] }));
      }
      results.push(await a.tools.say({ seq: ev.seq, kind: 'explain', text: 'Material is level.', claims: [] }));
    });
    await app.onClientMessage(client, { type: 'ask', text: 'can I win something?' });
    await until(() => fromCoach('scripted').length === 1);
    expect(results.slice(0, 3).every((r) => r.ok === false)).toBe(true);
    expect(results[2].attemptsLeft).toBe(0);
    expect(results[3].ok).toBe(false); // the event is closed once the fallback has spoken
    expect(fromCoach('coach')).toHaveLength(0);
    expect(coachMsgs().some((m) => m.from === 'system' && /did not pass the fact check/.test(m.text))).toBe(true);
    const rejected = app.db.sql.prepare("SELECT COUNT(*) AS n FROM coach_messages WHERE verdict = 'rejected'").get() as { n: number };
    expect(rejected.n).toBeGreaterThanOrEqual(3);
  });

  it('a reply to an old board is refused (stale seq)', async () => {
    await setup('e4 e5');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    let result: any;
    coach.steps.push(async (a, ev) => {
      await a.onClientMessage(client, { type: 'move', from: 'g1', to: 'f3' }); // the owner moves on
      result = await a.tools.say({ seq: ev.seq, kind: 'explain', text: 'Material is level.', claims: [] });
    });
    await app.onClientMessage(client, { type: 'ask', text: 'how am I doing?' });
    await until(() => result !== undefined);
    expect(result).toMatchObject({ ok: false, stale: true });
    expect(fromCoach('coach')).toHaveLength(0);
  });

  it('play_line: the engine builds the line; the coach names at most the first move', async () => {
    await setup('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const out: any = {};
    coach.steps.push(async (a, ev) => {
      out.illegal = await a.tools.play_line({ seq: ev.seq, what: 'move', move: 'Qxh8' });
      out.noMove = await a.tools.play_line({ seq: ev.seq, what: 'move' });
      out.line = await a.tools.play_line({ seq: ev.seq, what: 'move', move: 'f4', label: 'If you play f4' });
      out.sub = await a.tools.play_line({ seq: ev.seq, what: 'best', from: `${out.line.line}:1`, label: 'Their best reply' });
      out.say = await a.tools.say({ seq: ev.seq, kind: 'explain', text: `{m:f4} is a mistake: after {m:Qxe4+} you lose a pawn.`, claims: out.line.facts.map((f: any) => f.id) });
      out.best = await a.tools.play_line({ seq: ev.seq, what: 'best', label: 'Best play' });
      out.threat = await a.tools.play_line({ seq: ev.seq, what: 'threat' });
      out.check = await a.tools.check_move({ move: 'Ng4' });
      out.bad = await a.tools.check_move({ move: 'Nxh8' });
    });
    await app.onClientMessage(client, { type: 'ask', text: 'what if I play f4?' });
    await until(() => out.bad !== undefined, 30_000);
    expect(out.illegal.ok).toBe(false);
    expect(out.illegal.problems[0]).toMatch(/Qxh8 is not a legal move there/);
    expect(out.noMove.ok).toBe(false);
    expect(out.line.ok).toBe(true);
    expect(out.line.shown).toMatch(/^f4\?\??\sQxe4\+/); // f4 is marked as the mistake it is; the reply is the engine's
    expect(out.line.result).toMatch(/^ENGINE VERDICT: \{m:f4@[^}]+\} is a (serious )?mistake/);
    expect(out.sub.ok).toBe(true);
    expect(out.say.ok, JSON.stringify(out.say)).toBe(true);
    expect(out.best.shown.startsWith('Ng4')).toBe(true);
    expect(out.threat.ok).toBe(true);
    expect(out.threat.shown).toMatch(/^Qxe5/);
    const st = lastState();
    expect(st.layer).toBe('demo');
    expect(st.demo!.lines.length).toBeGreaterThanOrEqual(4);
    expect(st.demo!.lines[1]!.parent).toEqual({ line: st.demo!.lines[0]!.id, ply: 1 });
    expect(st.demo!.lines[0]!.verdict).toMatch(/^f4 is a (serious )?mistake/); // the engine's verdict is printed beside the line
    expect(st.tree.nodes[st.focus]!.san).toBe('Qd4'); // the owner's own board did not move
    expect(msgs.some((m) => m.type === 'play_demo')).toBe(true);
    expect(out.check).toMatchObject({ ok: true, legal: true, quality: 'the strongest move' });
    expect(out.check.facts[0].text).toMatch(/Why: .*it moves your attacked knight out of danger/);
    expect(out.bad).toMatchObject({ ok: true, legal: false });
  });

  it('annotate draws from facts, never from coordinates the coach supplies', async () => {
    await setup('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const out: any = {};
    coach.steps.push(async (a, ev) => {
      const hang = ev.facts.facts.find((f: any) => f.type === 'hangs' && f.text.includes('{pc:Ne5}'));
      out.none = await a.tools.annotate({ seq: ev.seq });
      out.unknown = await a.tools.annotate({ seq: ev.seq, facts: ['P0.F99'] });
      out.drawn = await a.tools.annotate({ seq: ev.seq, facts: [hang.id] });
      out.say = await a.tools.say({ seq: ev.seq, kind: 'explain', text: 'Your knight {pc:Ne5} is hanging.', claims: [hang.id] });
    });
    await app.onClientMessage(client, { type: 'ask', text: 'what is attacked?' });
    await until(() => out.say !== undefined);
    expect(out.say.ok).toBe(true);
    expect(out.none.ok).toBe(false);
    expect(out.unknown.ok).toBe(false);
    expect(out.drawn.ok).toBe(true);
    expect(lastState().shapes.coach).toEqual([
      { from: 'd4', to: 'e5', style: 'threat' },
      { from: 'e5', style: 'danger' },
    ]);
  });

  // Found live on 2026-11-14: the coach invented a blunder for the opponent (…Bxd1 in Legal's trap),
  // then told the owner not to play the best move "because you lose your queen". Every word was
  // literally true at the end of that line. The line tool now states the real verdict, and the
  // validator refuses a loss drawn from a line that only happens if the opponent slips.
  it("Legal's trap: the engine's verdict stands, and a conclusion that contradicts it is refused", async () => {
    await setup('e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const out: any = {};
    coach.steps.push(async (a, ev) => {
      out.line = await a.tools.play_line({ seq: ev.seq, what: 'move', move: 'Nxe5', label: 'If you take on e5' });
      out.sub = await a.tools.play_line({ seq: ev.seq, what: 'move', move: 'Bxd1', from: `${out.line.line}:1`, label: 'If they take the queen' });
      out.wrong = await a.tools.say({ seq: ev.seq, kind: 'explain', text: 'Not yet. If the knight takes on {sq:e5}, {m:Bxd1} wins your queen.', claims: out.sub.facts.map((f: any) => f.id) });
      out.right = await a.tools.say({ seq: ev.seq, kind: 'explain', text: 'Yes: {m:Nxe5} is the strongest move. If they take your queen with {m:Bxd1}, that is a mistake by them.', claims: [...out.line.facts, ...out.sub.facts].map((f: any) => f.id) });
    });
    await app.onClientMessage(client, { type: 'ask', text: 'can I take the pawn on e5?' });
    await until(() => out.right !== undefined, 30_000);
    // the engine, not the coach, chose the reply to Nxe5
    expect(out.line.shown).toBe('Nxe5 dxe5 Qxg4');
    expect(out.line.result).toMatch(/^ENGINE VERDICT: \{m:Nxe5@[^}]+\} is good: you win/);
    // and when asked about the queen capture, it plays out the punishment itself
    expect(out.sub.shown).toBe('Bxd1?? Bxf7+ Ke7 Nd5#');
    expect(out.sub.result).toMatch(/is a serious mistake by them: it allows checkmate in 2/);
    expect(lastState().demo!.lines[1]!.verdict).toMatch(/^Bxd1 is a serious mistake by them/);
    expect(out.wrong.ok).toBe(false);
    expect(out.wrong.problems.join(' ')).toMatch(/good news for the owner/);
    expect(out.right.ok, JSON.stringify(out.right)).toBe(true);
  });

  it("checks verdicts against Lichess's cloud analysis when Lichess has the position, and says so", async () => {
    cloudOn = true;
    await setup('e4 e5 Nf3 Nc6 Bc4 Bc5');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const out: any = {};
    coach.steps.push(async (a, ev) => {
      out.c3 = await a.tools.check_move({ move: 'c3' });
      out.best = await a.tools.play_line({ seq: ev.seq, what: 'best' });
      out.say = await a.tools.say({ seq: ev.seq, kind: 'answer', text: '{m:c3} is the strongest move here.', claims: [out.c3.cite] });
      out.away = await a.tools.check_move({ move: 'Nc6', from: 'focus' }); // illegal for White: no cloud needed
    });
    await app.onClientMessage(client, { type: 'ask', text: 'is c3 good?' });
    await until(() => out.away !== undefined, 30_000);
    cloudOn = false;
    expect(out.c3).toMatchObject({ ok: true, legal: true, quality: 'the strongest move' });
    expect(out.c3.checkedBy).toContain("Checked against Lichess's cloud analysis (depth 45)");
    expect(out.best.shown.startsWith('c3')).toBe(true); // the line is Lichess's best play
    expect(out.best.checkedBy).toMatch(/Lichess/);
    expect(lastState().demo!.lines.at(-1)!.checkedBy).toMatch(/Lichess/);
    expect(out.say.ok).toBe(true);
    expect(fromCoach('coach').at(-1)!.checked).toContain("Lichess's cloud analysis (depth 45)");
  });

  it('says plainly when only the local engine could check a position', async () => {
    await setup('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const out: any = {};
    coach.steps.push(async (a) => {
      out.check = await a.tools.check_move({ move: 'Ng4' });
    });
    await app.onClientMessage(client, { type: 'ask', text: 'is Ng4 ok?' });
    await until(() => out.check !== undefined, 30_000);
    expect(out.check.checkedBy).toBe('Checked by Stockfish on this computer (Lichess has no analysis of this position)');
  });

  it('wakes the coach when the owner blunders (key moments), with the skipped step named', async () => {
    await setup('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    coach.seen.length = 0;
    await app.onClientMessage(client, { type: 'move', from: 'c4', to: 'b5' }); // the best move: no wake
    await sleep(1500);
    expect(coach.seen).toHaveLength(0);
    await app.onClientMessage(client, { type: 'nav', to: 'prev' });
    await app.onClientMessage(client, { type: 'move', from: 'g5', to: 'e6' }); // drops the knight
    await until(() => coach.seen.length === 1);
    expect(coach.seen[0]).toMatchObject({ event: 'owner_move' });
    expect(coach.seen[0]!.facts.skippedStep).toBe('no_safety_check');
  });

  it('asks first when the owner asks for a move, and allows the answer after "just tell me"', async () => {
    await setup('e4 e5 Nf3 Nc6 Bc4 Bc5');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const out: any = {};
    coach.steps.push(async (a, ev) => {
      out.first = ev;
      const best = ev.facts.facts.find((f: any) => f.type === 'best_move');
      out.tooEarly = await a.tools.say({ seq: ev.seq, kind: 'answer', text: `${best.text}`, claims: [best.id] });
      out.question = await a.tools.say({ seq: ev.seq, kind: 'question', text: 'What are your checks and captures here?', claims: [], expect: 'move' });
    });
    await app.onClientMessage(client, { type: 'ask', text: 'what should I play?' });
    await until(() => out.question !== undefined);
    expect(out.first.youMayGiveTheMove).toBe(false);
    expect(out.tooEarly.ok).toBe(false);
    expect(out.tooEarly.problems.join(' ')).toMatch(/Ask before telling/);
    expect(out.question.ok).toBe(true);
    coach.steps.push(async (a, ev) => {
      out.second = ev;
      const best = ev.facts.facts.find((f: any) => f.type === 'best_move');
      out.answer = await a.tools.say({ seq: ev.seq, kind: 'answer', text: `${best.text}`, claims: [best.id] });
    });
    await app.onClientMessage(client, { type: 'chip', chip: 'tell_me' });
    await until(() => out.answer !== undefined);
    expect(out.second).toMatchObject({ event: 'tell_me', giveNow: 'answer' });
    expect(out.answer.ok).toBe(true);
  });

  // ------------------------------------------------------------ the eval bar, the arrows, the labels (A6, A16, A17)

  it('gives the position on the board its eval-bar reading, a best-move arrow, and a label for the move', async () => {
    await setup('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5');
    await app.onClientMessage(client, { type: 'move', from: 'g5', to: 'e6' }); // drops the knight
    await until(() => !!focusNode().gauge && !!focusNode().judged && insight?.fen === focusNode().fen);
    const node = focusNode();
    expect(['mistake', 'blunder']).toContain(node.judged!.label);
    expect(node.judged!.why).toMatch(/loses a knight/);
    expect(node.judged!.best).toBeTruthy();
    expect(node.gauge!.white).toBeLessThan(45); // White just lost a piece: the bar leans to Black
    expect(insight!.arrows).toHaveLength(1);
    expect(insight!.arrows[0]!.san).toMatch(/xe6/); // the engine's reply: take the knight
    // staying on the position brings the checked analysis in
    await until(() => focusNode().judged?.sure === true);
    expect(['mistake', 'blunder']).toContain(focusNode().judged!.label);
    // the reading and the label are saved with the board, and no number reaches the page unasked
    expect(lastState().tree.nodes[lastState().focus]!.judged).toEqual(focusNode().judged);
    // an opening move is "book", whatever the engine thinks of it
    if (app.book.count > 0) {
      await app.onClientMessage(client, { type: 'nav', to: 'start' });
      await app.onClientMessage(client, { type: 'nav', to: 'next' });
      await until(() => !!focusNode().judged);
      expect(focusNode().judged).toMatchObject({ label: 'book', sure: true });
    }
  });

  it('holds the best-move arrow back while the coach waits for the owner to find a move', async () => {
    await setup('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    await app.onClientMessage(client, { type: 'setting', key: 'display.bestArrowCount', value: 2 });
    await until(() => insight?.fen === focusNode().fen && insight.arrows.length >= 1 && !insight.held);
    expect(insight!.arrows[0]!.san).toBe('Ng4');
    await app.onClientMessage(client, { type: 'chip', chip: 'hint' }); // the scripted coach asks, and expects a move
    await until(() => fromCoach('scripted').length === 1);
    await until(() => !!insight?.held);
    expect(insight!.arrows).toEqual([]);
    await app.onClientMessage(client, { type: 'chip', chip: 'tell_me' }); // the answer is out: the arrow may come back
    await until(() => !!insight && !insight.held && insight.arrows.length >= 1);
    await app.onClientMessage(client, { type: 'setting', key: 'display.bestArrowCount', value: 1 });
    await app.onClientMessage(client, { type: 'setting', key: 'display.bestArrows', value: false });
    await until(() => !!insight && insight.arrows.length === 0);
    await app.onClientMessage(client, { type: 'setting', key: 'display.bestArrows', value: true });
  });

  it('the label on the board is the verdict the coach was given for that move', async () => {
    await setup('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const out: any = {};
    coach.steps.push(async (a) => {
      out.check = await a.tools.check_move({ move: 'f4' });
    });
    await app.onClientMessage(client, { type: 'ask', text: 'is f4 ok?' });
    await until(() => out.check !== undefined, 30_000);
    expect(out.check.quality).toMatch(/mistake/);
    await app.onClientMessage(client, { type: 'coach', action: 'stop' });
    await app.onClientMessage(client, { type: 'move', from: 'f2', to: 'f4' });
    await until(() => !!focusNode().judged);
    expect(focusNode().judged!.sure).toBe(true); // straight from the checked verdict, not from a quick guess
    expect(['mistake', 'blunder']).toContain(focusNode().judged!.label);
  });

  it('labels every move of a game on request', async () => {
    await setup('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Ne6');
    await app.onClientMessage(client, { type: 'label_all' });
    await until(() => msgs.some((m) => m.type === 'busy' && m.text === null), 60_000);
    const moves = Object.values(lastState().tree.nodes).filter((n) => n.san);
    expect(moves).toHaveLength(11);
    expect(moves.every((n) => !!n.judged && !!n.gauge)).toBe(true);
    expect(['mistake', 'blunder']).toContain(moves.find((n) => n.san === 'Ne6')!.judged!.label);
    if (app.book.count > 0) expect(moves.find((n) => n.san === 'e4')!.judged!.label).toBe('book');
  });

  // ------------------------------------------------------------ the coach's board powers (A2, A3, A18)

  it('annotate show: the app works out the threats and draws red boxes and arrows; the coach names no square', async () => {
    await setup('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const out: any = {};
    coach.steps.push(async (a, ev) => {
      out.threats = await a.tools.annotate({ seq: ev.seq, show: 'threats' });
      out.drawn = [...a.session.state.shapes.coach];
      out.targets = await a.tools.annotate({ seq: ev.seq, show: 'targets' });
      const hang = out.threats.facts.find((f: any) => f.type === 'hangs');
      out.say = await a.tools.say({ seq: ev.seq, kind: 'explain', text: 'Your knight {pc:Ne5} is hanging.', claims: [hang.id] });
    });
    await app.onClientMessage(client, { type: 'ask', text: 'show me the threats' });
    await until(() => out.say !== undefined, 30_000);
    expect(out.threats.ok).toBe(true);
    expect(out.drawn).toContainEqual({ from: 'd4', to: 'e5', style: 'threat' }); // the attacking line
    expect(out.drawn).toContainEqual({ from: 'e5', style: 'danger' }); // the red box on the piece in danger
    expect(out.threats.facts.some((f: any) => f.type === 'hangs')).toBe(true);
    expect(out.targets.ok).toBe(true);
    expect(typeof out.targets.drawn).toBe('number');
    expect(out.say.ok, JSON.stringify(out.say)).toBe(true);
  });

  it("a move the owner plays on the coach's board follows the line, or becomes their alternative with the engine's verdict", async () => {
    await setup('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const out: any = {};
    coach.steps.push(async (a, ev) => {
      out.best = await a.tools.play_line({ seq: ev.seq, what: 'best', label: 'Best play' });
      out.at = await a.tools.show_position({ seq: ev.seq, at: `${out.best.line}:1` });
      out.cursorAt = { ...a.session.state.demo!.cursor };
      out.badAt = await a.tools.show_position({ seq: ev.seq, at: 'L99:1' });
      out.base = await a.tools.show_position({ seq: ev.seq, at: 'base' });
    });
    await app.onClientMessage(client, { type: 'ask', text: 'how do I save my knight?' });
    await until(() => out.base !== undefined, 30_000);
    expect(out.best.shown.startsWith('Ng4')).toBe(true);
    expect(out.at.ok).toBe(true);
    expect(out.cursorAt).toEqual({ line: out.best.line, ply: 1 }); // the coach stepped its own board
    expect(out.badAt.ok).toBe(false);
    expect(lastState().demo!.cursor).toEqual({ line: null, ply: 0 });
    await until(() => coach.seen.length === 1 && !app.coach.currentTurn);

    // the line's own move: the board just steps along it, and the coach is not woken
    const seq0 = lastState().seq;
    await app.onClientMessage(client, { type: 'move', from: 'e5', to: 'g4' });
    expect(lastState().demo!.cursor).toEqual({ line: out.best.line, ply: 1 });
    expect(lastState().seq).toBe(seq0);
    await sleep(300);
    expect(coach.seen).toHaveLength(1);

    // a different move: an alternative. The engine judges it and plays the replies; the coach explains it
    await app.onClientMessage(client, { type: 'demo', action: 'goto', line: null, ply: 0 });
    coach.steps.push(async (a, ev) => {
      out.event = ev;
      const main = ev.facts.facts[0];
      out.say = await a.tools.say({ seq: ev.seq, kind: 'explain', text: `{m:f4@${main.id}} is a mistake: after {m:Qxe4+@${main.id}} you lose a pawn.`, claims: ev.facts.facts.map((f: any) => f.id) });
    });
    await app.onClientMessage(client, { type: 'move', from: 'f2', to: 'f4' });
    await until(() => out.say !== undefined, 30_000);
    expect(out.event).toMatchObject({ event: 'owner_tries', tried: { move: 'f4', insteadOf: 'Ng4' } });
    expect(out.event.tried.engineVerdict).toMatch(/^ENGINE VERDICT: \{m:f4@[^}]+\} is a (serious )?mistake/);
    expect(out.say.ok, JSON.stringify(out.say)).toBe(true);
    let st = lastState();
    const alt = st.demo!.lines.at(-1)!;
    expect(alt).toMatchObject({ kind: 'alt', label: 'Your alternative: f4' });
    expect(alt.moves[0]).toMatchObject({ san: 'f4', alt: true });
    expect(['mistake', 'blunder']).toContain(alt.moves[0]!.judged!.label); // labelled like any other move
    expect(alt.moves[1]!.san).toBe('Qxe4+'); // the reply is the engine's
    expect(alt.verdict).toMatch(/^f4 is a (serious )?mistake/);
    expect(st.demo!.cursor).toEqual({ line: alt.id, ply: 1 });
    expect(st.seq).toBe(seq0 + 1); // the owner acted: an answer to the earlier position is stale now
    expect(st.tree.nodes[st.focus]!.san).toBe('Qd4'); // their own board did not move
    // the engine fills in the readings for the line
    await until(() => !!lastState().demo!.lines.at(-1)!.moves[0]!.gauge);

    // with the coach off, the checked verdict is still said
    await until(() => !app.coach.currentTurn);
    await app.onClientMessage(client, { type: 'coach', action: 'stop' });
    await app.onClientMessage(client, { type: 'demo', action: 'goto', line: null, ply: 0 });
    const before = fromCoach('scripted').length;
    await app.onClientMessage(client, { type: 'move', from: 'd2', to: 'd3' });
    await until(() => fromCoach('scripted').length === before + 1, 30_000);
    expect(fromCoach('scripted').at(-1)!.text).toMatch(/^d3 is a (serious )?mistake/);
    st = lastState();
    expect(st.demo!.lines.at(-1)).toMatchObject({ kind: 'alt', label: 'Your alternative: d3' });
    // an illegal move on the coach's board is refused, and nothing changes
    const lines = st.demo!.lines.length;
    await app.onClientMessage(client, { type: 'move', from: 'a1', to: 'a8' });
    expect(lastState().demo!.lines).toHaveLength(lines);
  });

  // Found live on 2026-11-14: the best move here still loses a pawn, the fact says so, and the coach
  // was refused three times for repeating it ("the facts you cite are good news for the owner").
  it('lets the coach say what the strongest move costs when the fact itself says so', async () => {
    await setup('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const out: any = {};
    coach.steps.push(async (a, ev) => {
      out.best = await a.tools.play_line({ seq: ev.seq, what: 'best' });
      const main = out.best.facts[0];
      out.say = await a.tools.say({ seq: ev.seq, kind: 'explain', text: `The strongest move is {m:Ng4@${main.id}}. You lose a pawn after {m:Qxe4+@${out.best.cite}}, but then you are about equal.`, claims: out.best.facts.map((f: any) => f.id) });
    });
    await app.onClientMessage(client, { type: 'ask', text: 'show me the line for my knight' });
    await until(() => out.say !== undefined, 30_000);
    // the strongest move costs a pawn here: the fact says so plainly and does not call it "safe"
    expect(out.best.facts[0].text).toMatch(/strongest move here, even though you lose a pawn/);
    expect(out.best.facts[0].text).not.toMatch(/safe/);
    expect(out.say.ok, JSON.stringify(out.say)).toBe(true);
  });

  it('knows the exact result of a small endgame from the tablebases, on the bar and in the facts (WP 4.3)', async () => {
    msgs = [];
    await app.onClientMessage(client, { type: 'coach', action: 'stop' });
    // king and pawn against king, Black to move: a draw (the king holds the square in front of the pawn)
    await app.onClientMessage(client, { type: 'setup', fen: '4k3/8/8/4P3/4K3/8/8/8 b - - 0 1' });
    await until(() => !!focusNode().gauge);
    expect(focusNode().gauge).toMatchObject({ white: 50, exact: 'draw' });
    const got: any = await app.tools.get_facts({ target: 'board' });
    expect(got.facts.withBestPlay).toBe('draw');
    expect(got.facts.facts.find((f: any) => f.type === 'tablebase').text).toMatch(/this position is a draw\. That is exact/);
    // the same pawn with the king in front of it on the sixth rank: a win
    await app.onClientMessage(client, { type: 'setup', fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1' });
    await until(() => !!focusNode().gauge);
    const won: any = await app.tools.get_facts({ target: 'board' });
    expect(won.facts.withBestPlay).toBe('you win');
  });

  it("the owner's game: a queen hung in a lost position is a mistake on the board, and the coach is given the same verdict (D47)", async () => {
    // Black is already a knight down; 10...Qe6 puts the queen where the bishop on c4 takes it.
    // The winning chances only go from about 7 to 2.5, which used to pass as "good".
    await setup('e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 Re1 Nd6 Bf1 f6 d4 Nc4 Bd3 d6 Bxc4 Qe7 a4');
    await app.onClientMessage(client, { type: 'move', from: 'e7', to: 'e6' });
    await until(() => !!focusNode().judged);
    expect(['mistake', 'blunder']).toContain(focusNode().judged!.label);
    expect(focusNode().judged!.why).toMatch(/loses a queen for a bishop/);
    await until(() => focusNode().judged?.sure === true);
    const judged = focusNode().judged!;
    expect(['mistake', 'blunder']).toContain(judged.label);
    expect(judged.why).toMatch(/loses a queen for a bishop/);
    // the move that should have been played, and where to draw it
    expect(judged.best).toBeTruthy();
    expect(judged.bestAt).toMatchObject({ from: expect.stringMatching(/^[a-h][1-8]$/), to: expect.stringMatching(/^[a-h][1-8]$/) });
    // the coach sees what the board says and the game so far, without asking
    const state: any = await app.tools.get_state({});
    expect(state.boardShows).toMatch(/^Black's Qe6 is a (mistake|blunder): it loses a queen for a bishop\./);
    expect(state.gameSoFar.from).toBe('the starting position');
    expect(state.gameSoFar.moves).toMatch(/^1\.e4 e5 2\.Nf3 Nc6 .*10\.a4 Qe6\?\??$/);
    // and has the verdict as a fact it can cite, though the other side played the move
    const got: any = await app.tools.get_facts({ target: 'board' });
    const verdict = got.facts.facts.find((f: any) => f.id === got.facts.lastMoveVerdict.fact);
    expect(verdict.text).toMatch(/Their last move .*Qe6.* was a mistake by them: you win a queen for a bishop/);
    expect(verdict.text).not.toMatch(/good|safe/);
    expect(got.facts.facts.find((f: any) => f.id === got.facts.lastMoveVerdict.strongerMoveFact).text).toMatch(/Their strongest move would have been/);
  });

  it('with the coach off, "Show me" still plays the engine\'s best line on the coach\'s board', async () => {
    await setup('e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4');
    await app.onClientMessage(client, { type: 'chip', chip: 'show_me' });
    await until(() => fromCoach('scripted').length === 1, 30_000);
    const st = lastState();
    expect(st.layer).toBe('demo');
    expect(st.demo!.lines[0]).toMatchObject({ kind: 'best', label: 'Best play' });
    expect(st.demo!.lines[0]!.moves[0]!.san).toBe('Ng4');
    expect(st.demo!.lines[0]!.verdict).toBeTruthy(); // the engine's verdict is printed beside it
    expect(fromCoach('scripted')[0]!.text).toMatch(/Ng4/);
    expect(msgs.some((m) => m.type === 'play_demo')).toBe(true);
    expect(st.tree.nodes[st.focus]!.san).toBe('Qd4'); // the owner's own board did not move
  });

  // ------------------------------------------------------------ reset, and games against bots (I14, A5)

  it('resets the whole position, to the start or to the first position of what is loaded', async () => {
    await setup('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    await app.onClientMessage(client, { type: 'move', from: 'a1', to: 'b1' });
    await app.onClientMessage(client, { type: 'reset', to: 'root' });
    expect(lastState().tree.rootFen).toBe('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    expect(Object.keys(lastState().tree.nodes)).toHaveLength(1);
    await app.onClientMessage(client, { type: 'reset', to: 'start' });
    expect(lastState().tree.rootFen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(lastState().demo).toBeUndefined();
  });

  it('plays a bot on its own board, and only a finished game goes to the analysis board', async () => {
    await setup('e4 e5 Nf3');
    await app.onClientMessage(client, { type: 'mode', mode: 'play' });
    expect(app.mode).toBe('play');
    await app.onClientMessage(client, { type: 'game', action: 'start', bot: 'maia-600', color: 'white' });
    await app.onClientMessage(client, { type: 'game', action: 'move', from: 'd2', to: 'd4' });
    await until(() => !!game && !game.thinking && Object.keys(game.tree.nodes).length === 3);
    expect(movesTo(lastState().tree, lastState().focus)).toEqual(['e4', 'e5', 'Nf3']); // the analysis board was left alone
    // a game in progress is not analysed
    await app.onClientMessage(client, { type: 'game', action: 'analyse' });
    expect(msgs.some((m) => m.type === 'toast' && /Finish or resign the game first/.test(m.text))).toBe(true);
    expect(app.mode).toBe('play');
    await app.onClientMessage(client, { type: 'game', action: 'resign' });
    expect(game!.status).toBe('over');
    await app.onClientMessage(client, { type: 'game', action: 'analyse' });
    expect(app.mode).toBe('analysis');
    const st = lastState();
    expect(movesTo(st.tree, mainlineEnd(st.tree))[0]).toBe('d4');
    expect(st.tree.headers?.Result).toBe('0-1');
    expect(st.orientation).toBe('white');
  });

  // ------------------------------------------------------------ going through the key moments with the coach (WP 5.6)
  // The plan's test: a scenario for each stop rule. Here with the scripted coach, so every step is exact;
  // the same rules run against the live coach in the playbook harness.

  const SCHOLAR = '[White "x"]\n[Black "y"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
  const BEFORE_NF6 = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4'];
  const here = () => movesTo(app.session.state.tree, app.session.state.focus);
  const send = (m: Parameters<App['onClientMessage']>[1]) => app.onClientMessage(client, m);
  // a pasted game on the board with the owner on one side, gone through by the engine
  const reviewed = async (pgn: string, side: 'white' | 'black') => {
    msgs = [];
    await send({ type: 'coach', action: 'stop' });
    await send({ type: 'setting', key: 'review.ownFirst', value: false });
    await send({ type: 'setting', key: 'review.auto', value: false });
    await send({ type: 'setting', key: 'puzzles.fromGames', value: false });
    await send({ type: 'library', action: 'import', text: pgn });
    if (app.session.state.orientation !== side) await send({ type: 'flip' });
    await send({ type: 'library', action: 'analyse' });
    expect(app.review?.status).toBe('done');
    msgs = [];
    return app.session.state.game!.id;
  };
  const lastEvent = (kind: string) => coach?.seen.filter((e) => e.event === kind).at(-1);

  it('replay: the position before the mistake goes on the board and the question is about the skipped step; two misses give the answer', async () => {
    const id = await reviewed(SCHOLAR, 'black');
    expect(app.review!.moments.map((m) => m.san)).toEqual(['Nf6']);
    await send({ type: 'replay', action: 'start' });
    await until(() => fromCoach('scripted').length === 1);
    // the board shows the position before 3...Nf6, and the best-move arrow is held back
    expect(here()).toEqual(BEFORE_NF6);
    expect(app.review!.replay).toEqual({ index: 0, total: 1, phase: 'asking', mode: 'ask' });
    await until(() => !!insight && insight.fen === focusNode().fen && !!insight.held);
    expect(insight!.arrows).toEqual([]);
    // what the coach was handed: the moment, the step and its first question, and no leave to give the move
    expect(lastEvent('review_moment')).toMatchObject({
      youMayGiveTheMove: false,
      review: { moment: 1, of: 1, youPlayed: 'Nf6', skippedStep: 'missed_threat', askFirst: "What was your opponent's last move trying to do?", mode: 'ask', firstTurningPoint: true, phase: 'asking' },
    });
    expect(lastEvent('review_moment')!.review.whatItCost).toMatch(/checkmate/);
    // the fact that backs what the game move cost travels with the moment, for the coach to cite
    expect(app.facts.fact(lastEvent('review_moment')!.review.citeForWhatItCost)?.text).toMatch(/Nf6/);
    // this coach said nothing, so the scripted one asked: the move played, the question for the step, and no answer
    const asked = fromCoach('scripted')[0]!;
    expect(asked).toMatchObject({ kind: 'question', expect: 'move' });
    expect(asked.text).toMatch(/In the game you played Nf6 here\. What was your opponent's last move trying to do\? Find a better move on the board\./);
    expect(asked.text).not.toMatch(/g6|Qe7/);

    // a wrong try. A coach that names the move, or shows the line, while the owner is still looking is refused
    let early: any;
    let earlyLine: any;
    coach!.steps.push(async (a, e) => {
      early = await a.tools.say({ seq: e.seq, kind: 'nudge', text: 'Try {m:g6} here.', claims: [] });
      earlyLine = await a.tools.play_line({ seq: e.seq, what: 'best' });
    });
    await send({ type: 'move', from: 'd7', to: 'd6' });
    await until(() => !!earlyLine);
    expect(lastEvent('owner_reply')).toMatchObject({ reply: { move: 'd6', correct: false, misses: 1, giveAnswerNow: false }, review: { youPlayed: 'Nf6', phase: 'asking', theOwnerIsBackOnThePositionToTryAgain: true } });
    expect(early.ok).toBe(false);
    expect(early.problems.join(' ')).toMatch(/still looking for the better move/);
    expect(earlyLine.ok).toBe(false);
    // the board went back to the position for another try
    expect(here()).toEqual(BEFORE_NF6);
    expect(app.review!.replay!.phase).toBe('asking');

    // the second miss: now the answer is given, and the line may be shown
    let late: any;
    coach!.steps.push(async (a, e) => {
      late = await a.tools.play_line({ seq: e.seq, what: 'best' });
    });
    await send({ type: 'move', from: 'a7', to: 'a6' });
    await until(() => !!late);
    expect(lastEvent('owner_reply')).toMatchObject({ reply: { move: 'a6', correct: false, misses: 2, giveAnswerNow: true }, review: { phase: 'explained', theOwnerIsBackOnThePositionToTryAgain: false } });
    expect(late.ok).toBe(true);
    expect(app.review!.replay).toMatchObject({ index: 0, phase: 'explained' });

    // on: that was the only moment
    await send({ type: 'replay', action: 'next' });
    await until(() => !!lastEvent('review_end'));
    expect(app.review!.replay!.phase).toBe('finished');
    expect(lastEvent('review_end')!.review).toMatchObject({ moments: 1, foundByTheOwner: 0, howEachWent: [{ ply: 6, how: 'two_misses', misses: 2 }] });
    // the hint log is kept (B4)
    expect(JSON.parse(app.db.recentEvents('replay_done', 1)[0]!.data)).toMatchObject({ game: id, log: [{ ply: 6, how: 'two_misses', misses: 2 }] });
    await send({ type: 'replay', action: 'stop' });
    expect(app.review!.replay).toBeUndefined();
  });

  it('replay: finding the move, and "Just tell me", both end the search', async () => {
    const id = await reviewed(SCHOLAR, 'black');
    await send({ type: 'replay', action: 'start' });
    await until(() => fromCoach('scripted').length === 1);
    // what the game move cost is said from the fact the app handed over with the moment: listed by the coach or not,
    // the sentence is checked against it
    let cost: any;
    let lie: any;
    coach!.steps.push(async (app2, e) => {
      cost = await app2.tools.say({ seq: e.seq, kind: 'explain', text: 'In the game {m:Nf6} allowed checkmate.', claims: [] });
      lie = await app2.tools.say({ seq: e.seq, kind: 'explain', text: 'In the game {m:Nf6} won a queen.', claims: [] });
    });
    await send({ type: 'move', from: 'g7', to: 'g6' });
    await until(() => !!lastEvent('owner_reply') && lastEvent('owner_reply')!.reply.move === 'g6');
    await until(() => !!lie);
    expect(cost.ok).toBe(true);
    expect(lie.ok).toBe(false);
    expect(lastEvent('owner_reply')!.reply.citeForTheirMove).toBeTruthy();
    expect(lastEvent('owner_reply')).toMatchObject({ reply: { correct: true, misses: 0 }, review: { phase: 'explained', whatItCost: expect.stringMatching(/checkmate/) } });
    // a found move stays on the board
    expect(here()).toEqual([...BEFORE_NF6, 'g6']);
    expect(app.review!.replay!.phase).toBe('explained');
    msgs = [];
    await send({ type: 'replay', action: 'next' });
    await until(() => fromCoach('scripted').some((m) => m.kind === 'summary'));
    expect(fromCoach('scripted').find((m) => m.kind === 'summary')!.text).toBe('That was the last one. You found the better move yourself this time. The habit to take into your next game: before you choose a move, ask what their last move was trying to do.');
    // the coach was handed the written report to close with, and the report now knows how the replay went
    expect(lastEvent('review_end')!.review.report).toMatchObject({ takeaways: [expect.stringMatching(/^Before you choose a move, ask what their last move was trying to do\. That step was missing on move 3 \(Nf6\)\.$/)] });
    expect(app.review!.report!.closing).toBe('Going through the key moments, you found the better move yourself when you looked for it.');
    expect(lastEvent('review_end')!.review).toMatchObject({ foundByTheOwner: 1, howEachWent: [{ ply: 6, how: 'found', misses: 0 }] });
    await send({ type: 'replay', action: 'stop' });

    // again, and this time the owner asks for the answer
    msgs = [];
    await send({ type: 'replay', action: 'start' });
    await until(() => app.review?.replay?.phase === 'asking' && fromCoach('scripted').length === 1);
    await send({ type: 'chip', chip: 'tell_me' });
    await until(() => app.review?.replay?.phase === 'explained');
    expect(lastEvent('tell_me')).toMatchObject({ giveNow: 'answer', review: { youPlayed: 'Nf6' } });
    expect(JSON.parse(app.db.recentEvents('replay_answer', 1)[0]!.data)).toMatchObject({ game: id, ply: 6, how: 'told' });
    // a moment that is passed over is logged as that
    await send({ type: 'replay', action: 'stop' });
    await send({ type: 'replay', action: 'start' });
    await until(() => app.review?.replay?.phase === 'asking');
    await send({ type: 'replay', action: 'next' });
    await until(() => app.review?.replay?.phase === 'finished');
    expect(JSON.parse(app.db.recentEvents('replay_done', 1)[0]!.data).log).toMatchObject([{ how: 'skipped' }]);
    await send({ type: 'replay', action: 'stop' });
    await send({ type: 'library', action: 'remove', id });
  });

  it('replay: a tactic that has not come up before is shown as a worked example; the next time it is asked', async () => {
    // 3.e3 lets the queen check on a5 and take the bishop on g5: a fork
    const id = await reviewed('[White "a"]\n[Black "b"]\n[Result "0-1"]\n\n1. d4 Nf6 2. Bg5 c6 3. e3 Qa5+ 4. Nc3 Qxg5 0-1', 'white');
    const first = app.review!.moments[0]!;
    expect(first).toMatchObject({ san: 'e3', first: true });
    expect(first.motifs).toContain('fork');
    await send({ type: 'replay', action: 'start' });
    await until(() => !!lastEvent('review_moment') && lastEvent('review_moment')!.review.youPlayed === 'e3');
    expect(lastEvent('review_moment')).toMatchObject({ youMayGiveTheMove: true, review: { mode: 'worked example', because: 'this tactic has not come up in a review before', phase: 'explained' } });
    expect(app.review!.replay).toMatchObject({ phase: 'explained', mode: 'worked' });
    // the scripted coach says what the move cost and has the engine play the better line
    await until(() => fromCoach('scripted').length >= 1 && msgs.some((m) => m.type === 'play_demo'));
    expect(fromCoach('scripted')[0]!.text).toMatch(/^In the game you played e3 here: it loses a bishop/);
    await send({ type: 'replay', action: 'stop' });
    // the fork has now come up in a review: the same moment is asked
    msgs = [];
    await send({ type: 'replay', action: 'start' });
    await until(() => app.review?.replay?.phase === 'asking');
    expect(lastEvent('review_moment')!.review).toMatchObject({ mode: 'ask', because: null });
    await send({ type: 'replay', action: 'stop' });
    // with the setting off, a new tactic is asked as well; a point deeper than the setting is always shown
    await send({ type: 'setting', key: 'review.maxDepthMoves', value: 1 });
    // 4...Nxe4 leaves the knight to a queen check on a4 that also attacks it; the owner castles instead
    const deep = await reviewed('[White "a"]\n[Black "b"]\n[Result "1/2-1/2"]\n\n1. e4 c5 2. Nf3 d6 3. c3 Nf6 4. Be2 Nxe4 5. O-O Nf6 1/2-1/2', 'white');
    const missed = app.review!.moments[0]!;
    // the check comes first, the knight is taken on the second move: a point two moves deep
    expect(missed).toMatchObject({ san: 'O-O', ply: 9, label: 'miss', best: 'Qa4+', depth: 2, step: 'missed_free_material' });
    await send({ type: 'replay', action: 'start' });
    await until(() => !!lastEvent('review_moment') && lastEvent('review_moment')!.review.youPlayed === 'O-O');
    expect(lastEvent('review_moment')).toMatchObject({ youMayGiveTheMove: true, review: { mode: 'worked example', because: 'the point is too deep to ask the owner to find' } });
    expect(JSON.parse(app.db.recentEvents('replay_moment', 1)[0]!.data)).toMatchObject({ mode: 'worked', because: 'deep' });
    await send({ type: 'replay', action: 'stop' });
    await send({ type: 'setting', key: 'review.maxDepthMoves', value: 2 });
    for (const game of [id, deep]) await send({ type: 'library', action: 'remove', id: game });
    await send({ type: 'setting', key: 'review.auto', value: true });
    await send({ type: 'setting', key: 'review.ownFirst', value: true });
  });

  it('the coach on the Openings tab (D12): it sees the walked position and answers there; on a card being recalled it may not name the move', async () => {
    msgs = [];
    const rep = app.db.addRepertoire({ name: 'Walk test', colour: 'white', source: 'pasted:2026-11-16', licence: 'own', level: '400–700' });
    for (const line of repertoireLines('1. e4 e5 2. Nf3 Nc6 3. Bc4 *', 'white').lines) {
      app.db.saveContent(`rep:${rep}|${line.moves.join(' ')}`, { type: 'repertoire', status: 'live', source: 'pasted:2026-11-16', licence: 'own', level: '400–700', engine: 'test', gates: [], body: { ...line, repertoire: rep } } as ContentItem<RepLine>);
    }
    await app.onClientMessage(client, { type: 'mode', mode: 'openings' });
    await app.onClientMessage(client, { type: 'coach', action: 'stop' });
    // walked to 1.e4 e5: asked with the coach off, the app says so beside the walk
    await app.onClientMessage(client, { type: 'opening', action: 'walk', repertoire: rep, moves: ['e2e4', 'e7e5'] });
    await app.onClientMessage(client, { type: 'ask', text: 'Why is this move played?' });
    await until(() => coachMsgs().some((m) => m.from === 'system'));
    expect(coachMsgs().filter((m) => m.walk).map((m) => m.from)).toEqual(['owner', 'system']);
    expect(coachMsgs().find((m) => m.from === 'system')!.text).toMatch(/The coach is off/);

    // the coach on: the question goes to the opening coach with the walked position, and its answer is shown beside the walk
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const said: any[] = [];
    coach.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'opening_question', ownerSaid: 'Why is this move played?', youMayNameTheRepertoireMove: true, walk: { reachedBy: '1.e4 e5', theRepertoireMove: 'Nf3', toMove: 'the owner', repliesPrepared: [] }, theRepertoireMove: { move: 'Nf3' } });
      expect(await a.tools.get_state({})).toMatchObject({ mode: 'openings', fen: expect.stringMatching(/^rnbqkbnr\/pppp1ppp\/8\/4p3\/4P3\/8\/PPPP1PPP/), walk: { reachedBy: '1.e4 e5' } });
      said.push(await a.tools.say({ seq: ev.seq, kind: 'explain', text: '{m:Nf3} develops your knight.', claims: [ev.theRepertoireMove.cite] }));
    });
    msgs = [];
    await app.onClientMessage(client, { type: 'ask', text: 'Why is this move played?' });
    await until(() => fromCoach('coach').length === 1);
    expect(said[0]).toMatchObject({ ok: true });
    expect(fromCoach('coach')[0]).toMatchObject({ walk: true, text: 'Nf3 develops your knight.' });
    expect(fromCoach('coach')[0]!.drill).toBeUndefined();

    // a card the owner is recalling: the move is hidden from the coach, and naming it is refused
    // (learnt first with the coach off, so its own events do not take the scripted steps; then made due)
    await app.onClientMessage(client, { type: 'coach', action: 'stop' });
    await app.onClientMessage(client, { type: 'opening', action: 'walk', repertoire: null });
    await app.onClientMessage(client, { type: 'opening', action: 'next' });
    await until(() => app.openings.view.status === 'learn');
    const first = app.openings.view;
    await app.onClientMessage(client, { type: 'opening', action: 'move', from: first.move!.from, to: first.move!.to });
    await until(() => app.openings.view.status === 'right');
    app.db.saveCard(first.id!, { ...app.db.getCard(first.id!)!, dueAt: '2000-01-01T00:00:00.000Z' });
    await app.onClientMessage(client, { type: 'opening', action: 'next' });
    await until(() => app.openings.view.status === 'ask' && app.openings.view.id === first.id);
    await app.onClientMessage(client, { type: 'coach', action: 'start' });
    const answer = app.openings.current()!.move.san;
    const tries: any[] = [];
    coach.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'opening_question', youMayNameTheRepertoireMove: false, theRepertoireMove: null, card: { theRepertoireMove: expect.stringMatching(/hidden/) } });
      tries.push(await a.tools.say({ seq: ev.seq, kind: 'nudge', text: `Think about {m:${answer}}.`, claims: [] }));
      tries.push(await a.tools.say({ seq: ev.seq, kind: 'question', text: 'Which of your pieces have not moved yet?', claims: [] }));
    });
    msgs = [];
    await app.onClientMessage(client, { type: 'ask', text: 'What do I play here?' });
    await until(() => tries.length === 2);
    expect(tries[0]).toMatchObject({ ok: false });
    expect(tries[0].problems.join(' ')).toMatch(/recalling the repertoire move/);
    expect(tries[1]).toMatchObject({ ok: true });
    await until(() => fromCoach('coach').length === 1);
    expect(fromCoach('coach')[0]).toMatchObject({ drill: app.openings.view.id, text: 'Which of your pieces have not moved yet?' });
    expect(fromCoach('coach')[0]!.walk).toBeUndefined();

    await app.onClientMessage(client, { type: 'opening', action: 'close' });
    await app.onClientMessage(client, { type: 'coach', action: 'stop' });
    app.db.removeRepertoire(rep);
    await app.onClientMessage(client, { type: 'mode', mode: 'analysis' });
  });
});

// PLAN WP 5.1 and 5.2: the owner's finished games come in from both sites, and a Daily game in
// progress is refused by every route. The sites answer from recorded files.
describe("the owner's games and the fair-play guard (real engine)", () => {
  let dir: string;
  let app: App;
  let msgs: ServerMsg[] = [];
  let insight: Insight | null = null;
  let library: LibraryView | null = null;
  let review: ReviewView | null = null;
  const client = {
    send: (m: ServerMsg) => {
      if (m.type === 'insight') insight = m.insight;
      if (m.type === 'library') library = m.view;
      if (m.type === 'review') review = m.view;
      msgs.push(m);
    },
  };
  const toasts = () => msgs.filter((m): m is Extract<ServerMsg, { type: 'toast' }> => m.type === 'toast').map((m) => m.text);
  const said = () => msgs.filter((m): m is Extract<ServerMsg, { type: 'coach_msg' }> => m.type === 'coach_msg').map((m) => m.message);
  const state = () => app.session.state;
  const send = (m: Parameters<App['onClientMessage']>[1]) => app.onClientMessage(client, m);
  const until = async (test: () => boolean, ms = 15_000) => {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 > ms) throw new Error('timed out waiting');
      await sleep(20);
    }
  };
  // the shorter of the two Daily games in progress: 25 half-moves played, Black to move
  const live = ongoingCc.games[1]!;
  const liveLine = (() => {
    const r = importPgn(live.pgn);
    if (!r.ok) throw new Error(r.reason);
    return pathTo(r.tree, mainlineEnd(r.tree)).slice(1);
  })();
  const GAME_IN_PROGRESS = /game in progress on Chess\.com.*Fair play/;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-games-'));
    app = new App({ repoRoot: config.repoRoot, dataDir: dir, stockfish: config.stockfish, syzygy: config.syzygy, claudePath: 'unused', openingsDir: config.openingsDir, mcpUrl: 'http://127.0.0.1:1/mcp', cloud: null, sites: fakeSites().http });
    app.engine.signature = 'test';
    app.addClient(client);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('says so on the board until the games in progress can be checked', async () => {
    expect(state().notice).toMatch(/Enter your Lichess and Chess\.com names/);
    await send({ type: 'setting', key: 'accounts.lichess', value: 'not a name!' });
    expect(toasts().at(-1)).toMatch(/not a valid value/);
    await send({ type: 'setting', key: 'accounts.lichess', value: 'OwnerLichess' });
    await send({ type: 'setting', key: 'accounts.chesscom', value: 'OwnerChessCom' });
    expect(state().notice).toMatch(/could not be checked yet/);
    // the tests of the importer and the analysis look at the engine's findings straight away; the owner's own review has tests of its own below
    await send({ type: 'setting', key: 'review.ownFirst', value: false });
    // and puzzles from games have a test of their own at the end
    await send({ type: 'setting', key: 'puzzles.fromGames', value: false });
  });

  it('syncs the finished games from both sites and puts one on the board, the owner\'s side facing them', async () => {
    msgs = [];
    await send({ type: 'library', action: 'sync' });
    expect(toasts().at(-1)).toBe('7 new games: 3 from Lichess, 4 from Chess.com.');
    expect(library!.total).toBe(7);
    expect(library!.accounts.map((a) => [a.site, a.state, a.ongoing])).toEqual([['lichess', 'ok', 1], ['chesscom', 'ok', 2]]);
    // the games in progress have been read: the standing notice is gone
    expect(state().notice).toBeUndefined();
    const asBlack = library!.games.find((g) => g.site === 'chesscom' && g.you === 'black' && g.outcome === 'loss')!;
    await send({ type: 'mode', mode: 'games' });
    await send({ type: 'library', action: 'open', id: asBlack.id });
    expect(app.mode).toBe('analysis');
    expect(state().orientation).toBe('black');
    expect(state().game).toMatchObject({ id: asBlack.id, black: 'OwnerChessCom', result: '1-0', you: 'black' });
    expect(Object.keys(state().tree.nodes).length - 1).toBe(asBlack.plies);
    // a finished game is analysed like any other
    await send({ type: 'nav', to: 'end' });
    await send({ type: 'nav', to: 'prev' });
    await until(() => !!insight && insight.fen === state().tree.nodes[state().focus]!.fen && insight.arrows.length > 0);
    expect(insight!.held).toBeUndefined();
    // again: nothing new
    await send({ type: 'library', action: 'sync' });
    expect(toasts().at(-1)).toBe('No new games.');
    expect(library!.total).toBe(7);
  });

  it('a pasted game is added and opened; a game in progress is refused at the door', async () => {
    msgs = [];
    await send({ type: 'library', action: 'import', text: '[White "OwnerLichess"]\n[Black "x"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1' });
    expect(toasts().at(-1)).toBe('1 game added.');
    expect(library!.total).toBe(8);
    expect(state().game).toMatchObject({ white: 'OwnerLichess', result: '0-1', you: 'white' });
    await send({ type: 'library', action: 'import', text: live.pgn });
    expect(toasts().at(-1)).toMatch(/still in progress/);
    await send({ type: 'library', action: 'import', text: live.pgn.replace('[Result "*"]', '[Result "0-1"]') });
    expect(toasts().at(-1)).toMatch(/one of your games in progress/);
    expect(library!.total).toBe(8);
    await send({ type: 'library', action: 'remove', id: state().game!.id });
    expect(library!.total).toBe(7);
  });

  it('the Daily game in progress is refused by every way onto the board', async () => {
    await send({ type: 'new' });
    msgs = [];
    const before = state().seq;
    // pasted as it is: the app knows which game it is
    await send({ type: 'load', text: live.pgn });
    expect(toasts().at(-1)).toMatch(GAME_IN_PROGRESS);
    // with a result written in, and with its headers taken off
    await send({ type: 'load', text: live.pgn.replace('[Result "*"]', '[Result "1-0"]') });
    expect(toasts().at(-1)).toMatch(GAME_IN_PROGRESS);
    await send({ type: 'load', text: liveLine.map((n) => n.san).join(' ') });
    expect(toasts().at(-1)).toMatch(GAME_IN_PROGRESS);
    // its position, pasted or set up in the editor
    await send({ type: 'load', text: live.fen });
    expect(toasts().at(-1)).toMatch(GAME_IN_PROGRESS);
    await send({ type: 'setup', fen: live.fen });
    expect(toasts().at(-1)).toMatch(GAME_IN_PROGRESS);
    // an earlier position of it
    await send({ type: 'setup', fen: liveLine[15]!.fen });
    expect(toasts().at(-1)).toMatch(GAME_IN_PROGRESS);
    expect(state().seq).toBe(before);
    expect(Object.keys(state().tree.nodes)).toHaveLength(1);
    // the coach may not show it either
    const shown = await app.tools.show_position({ seq: state().seq, fen: live.fen });
    expect(shown).toMatchObject({ ok: false, problems: [expect.stringMatching(GAME_IN_PROGRESS)] });
    const byMoves = await app.tools.show_position({ seq: state().seq, moves: liveLine.map((n) => n.san!) });
    expect(byMoves).toMatchObject({ ok: false, problems: [expect.stringMatching(GAME_IN_PROGRESS)] });
    expect(state().demo).toBeUndefined();
  });

  it('played out by hand, the engine and the coach fall silent as soon as the game is recognisable', async () => {
    // the opening moves belong to thousands of games: they load, and the engine speaks
    await send({ type: 'load', text: liveLine.slice(0, 8).map((n) => n.san).join(' ') });
    await send({ type: 'nav', to: 'end' });
    await until(() => !!insight && insight.fen === liveLine[7]!.fen && insight.arrows.length > 0);
    expect(insight!.held).toBeUndefined();
    msgs = [];
    for (const n of liveLine.slice(8, 12)) await send({ type: 'move', from: n.from!, to: n.to!, promotion: undefined });
    await until(() => !!insight && insight.fen === liveLine[11]!.fen);
    expect(insight).toMatchObject({ arrows: [], held: expect.stringMatching(GAME_IN_PROGRESS) });
    const node = state().tree.nodes[state().focus]!;
    expect(node.gauge).toBeUndefined();
    expect(node.judged).toBeUndefined();
    // said once in the coach's panel, not once per move
    expect(said().filter((m) => m.from === 'system' && GAME_IN_PROGRESS.test(m.text))).toHaveLength(1);
    // a question, a chip and every tool of the coach get the same answer
    msgs = [];
    await send({ type: 'ask', text: 'what should I play here?' });
    expect(said().at(-1)).toMatchObject({ from: 'system', text: expect.stringMatching(GAME_IN_PROGRESS) });
    await send({ type: 'chip', chip: 'hint' });
    expect(said().at(-1)).toMatchObject({ from: 'system', text: expect.stringMatching(GAME_IN_PROGRESS) });
    expect(said().some((m) => m.from === 'coach')).toBe(false);
    const seq = state().seq;
    for (const refused of [await app.tools.get_facts({}), await app.tools.check_move({ move: 'Nf6' }), await app.tools.play_line({ seq, what: 'best' }), await app.tools.annotate({ seq, show: 'threats' })]) {
      expect(refused).toMatchObject({ ok: false, problems: [expect.stringMatching(GAME_IN_PROGRESS)] });
    }
    expect((await app.tools.get_state()) as { fairPlay: string }).toMatchObject({ fairPlay: expect.stringMatching(GAME_IN_PROGRESS) });
    // labelling the whole game leaves those positions alone
    await send({ type: 'label_all' });
    await until(() => msgs.some((m) => m.type === 'busy' && m.text === null) || toasts().some((t) => /already labelled/.test(t)), 60_000);
    const line = pathTo(state().tree, state().focus);
    expect(line.slice(1, 9).every((n) => !!n.gauge)).toBe(true);
    expect(line.slice(10).every((n) => !n.gauge && !n.judged)).toBe(true);
  });

  it('where the game stands now, and anything played on from there, stays off limits', async () => {
    for (const n of liveLine.slice(12)) await send({ type: 'move', from: n.from!, to: n.to!, promotion: undefined });
    await until(() => !!insight && insight.fen === live.fen);
    expect(insight!.held).toMatch(/This is the position of your game in progress/);
    // a candidate move from the live position: exactly the help the rule forbids
    const candidate = legalMoves(mustPosition(live.fen))[0]!;
    await send({ type: 'move', from: candidate.from, to: candidate.to });
    await until(() => !!insight && insight.fen === candidate.fenAfter);
    expect(insight).toMatchObject({ arrows: [], held: expect.stringMatching(GAME_IN_PROGRESS) });
    expect(state().tree.nodes[state().focus]!.judged).toBeUndefined();
  });

  // PLAN WP 5.3: known games give the expected moments; the same input gives the same output.
  it('goes through an opened game: a label for every move, and its key moments with the first turning point first', async () => {
    // the owner, as Black, walks into the Scholar's Mate
    await send({ type: 'library', action: 'import', text: '[White "x"]\n[Black "OwnerLichess"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0' });
    const id = state().game!.id;
    expect(state().game).toMatchObject({ you: 'black' });
    // opening a game has the engine go through it
    await until(() => review?.gameId === id && review.status === 'done', 60_000);
    const plain = (r: ReviewView) => JSON.stringify({ ...r, moments: r.moments.map(({ factId: _f, bestFactId: _b, ...m }) => m) });
    expect(review!.moments.map((m) => [m.number, m.san, m.label, m.kind, m.first])).toEqual([['3...', 'Nf6', 'blunder', 'mate', true]]);
    expect(review!.moments[0]!.why).toMatch(/checkmate/);
    // tagged (WP 5.4): the mate was already threatened, so the skipped step is "what does their last move do?"
    expect(review!.moments[0]).toMatchObject({ step: 'missed_threat', stepName: 'Their threat went unanswered', what: 'allowed checkmate' });
    expect(review!.numbers!.steps).toEqual({ missed_threat: 1 });
    // the moment was judged again by the checked analysis: it carries the fact the coach will cite
    expect(app.facts.fact(review!.moments[0]!.factId!)?.text).toMatch(/Nf6/);
    expect(review!.numbers).toMatchObject({ moves: 3, blunders: 1, liveBlunders: 1 });
    expect(review!.chart).toHaveLength(7);
    // every move on the board has its label and its reading
    const line = pathTo(state().tree, mainlineEnd(state().tree)).slice(1);
    expect(line.every((n) => !!n.judged && !!n.gauge)).toBe(true);
    expect(line[5]!.judged).toMatchObject({ label: 'blunder', best: 'g6' });
    // kept in the database
    const saved = app.db.getReview(id)!;
    expect(saved.moments.map((m) => m.ply)).toEqual([6]);
    expect(saved.plies.map((p) => p.san)).toEqual(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
    expect(saved.plies[5]).toMatchObject({ label: 'blunder', step: 'missed_threat', what: 'allowed checkmate' });
    expect(saved.you).toBe('black');
    // again: the same result
    const first = plain(review!);
    await send({ type: 'library', action: 'analyse' });
    expect(review!.status).toBe('done');
    expect(plain(review!)).toBe(first);
    // removing the game removes its analysis
    await send({ type: 'library', action: 'remove', id });
    expect(app.db.getReview(id)).toBeUndefined();
  });

  it('finds the move that hung a piece, not the moves that followed it', async () => {
    await send({ type: 'library', action: 'import', text: '[White "OwnerLichess"]\n[Black "y"]\n[Result "0-1"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Na5 6. Ne6 fxe6 7. dxe6 Nxc4 0-1' });
    const id = state().game!.id;
    await until(() => review?.gameId === id && review.status === 'done', 60_000);
    const first = review!.moments[0]!;
    expect(first).toMatchObject({ number: '6.', san: 'Ne6', by: 'white', first: true });
    expect(['blunder', 'mistake']).toContain(first.label);
    expect(first.why).toMatch(/knight/);
    // the knight attacks the queen from e6, and the engine confirms that threat: the move counted on the queen
    // moving away, and the pawn simply took the knight
    expect(first).toMatchObject({ step: 'assumed_reply', stepName: 'It counted on a reply they did not have to play', what: 'hung a knight' });
    expect(review!.moments.length).toBeLessThanOrEqual(3);
    // the opponent's moves are never the owner's moments
    expect(review!.moments.every((m) => m.by === 'white')).toBe(true);
    await send({ type: 'library', action: 'remove', id });
  });

  // PLAN WP 5.5: the engine's findings stay hidden until the owner's own review is done or skipped.
  it('with "your own review first" on, the engine keeps its findings to itself until the owner is done', async () => {
    await send({ type: 'setting', key: 'review.ownFirst', value: true });
    await send({ type: 'library', action: 'import', text: '[White "x"]\n[Black "OwnerLichess"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0' });
    const id = state().game!.id;
    expect(review).toMatchObject({ gameId: id, own: { state: 'pending', marks: [] }, moments: [] });
    // the engine goes through the game in the background, and nothing of what it found leaves the server
    await until(() => review?.gameId === id && review.status === 'done', 60_000);
    expect(review!.moments).toEqual([]);
    expect(review!.numbers).toBeUndefined();
    expect(review!.chart).toBeUndefined();
    const line = pathTo(state().tree, mainlineEnd(state().tree)).slice(1);
    expect(line.every((n) => !n.judged && !n.gauge)).toBe(true);
    await send({ type: 'nav', to: line[5]!.id });
    await until(() => !!insight && insight.fen === line[5]!.fen);
    expect(insight).toMatchObject({ arrows: [], held: expect.stringMatching(/going through this game yourself first/) });
    // a question, and the coach's tools, get the same answer
    msgs = [];
    await send({ type: 'ask', text: 'where did I go wrong?' });
    expect(said().at(-1)).toMatchObject({ from: 'system', text: expect.stringMatching(/yourself first/) });
    expect(await app.tools.get_facts({})).toMatchObject({ ok: false, problems: [expect.stringMatching(/yourself first/)] });
    await send({ type: 'label_all' });
    expect(line.every((n) => !n.judged)).toBe(true);
    // the owner marks moves, and may change their mind
    await send({ type: 'own_review', action: 'mark', ply: 6 });
    await send({ type: 'own_review', action: 'mark', ply: 2 });
    await send({ type: 'own_review', action: 'mark', ply: 99 }); // not a move of this game
    expect(review!.own).toMatchObject({ state: 'pending', marks: [2, 6] });
    await send({ type: 'own_review', action: 'mark', ply: 2 });
    expect(review!.own!.marks).toEqual([6]);
    expect(library!.games.find((g) => g.id === id)!.reviewed).toBe(false);
    // done: now the engine speaks
    await send({ type: 'own_review', action: 'finish', notes: 'I thought Nf6 attacked the queen.' });
    expect(review).toMatchObject({ gameId: id, status: 'done', own: { state: 'done', marks: [6], notes: 'I thought Nf6 attacked the queen.' } });
    expect(review!.moments.map((m) => m.ply)).toEqual([6]);
    expect(line.every((n) => !!n.judged && !!n.gauge)).toBe(true);
    expect(app.db.getSelfReview(id)).toMatchObject({ skipped: false, marks: [6], notes: 'I thought Nf6 attacked the queen.' });
    expect(library!.games.find((g) => g.id === id)!.reviewed).toBe(true);
    await until(() => !!insight && insight.fen === line[5]!.fen && !insight.held);
    expect((await app.tools.get_facts({})) as { ok: boolean }).toMatchObject({ ok: true });
    // opened again, the game is not asked about a second time
    await send({ type: 'library', action: 'open', id });
    await until(() => review?.gameId === id && review.status === 'done' && review.moments.length === 1, 60_000);
    expect(review!.own).toMatchObject({ state: 'done', marks: [6] });
    await send({ type: 'library', action: 'remove', id });
    expect(app.db.getSelfReview(id)).toBeUndefined();
  });

  it('Skip shows what the engine found, and the game counts as gone through', async () => {
    await send({ type: 'library', action: 'import', text: '[White "OwnerLichess"]\n[Black "y"]\n[Result "0-1"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Na5 6. Ne6 fxe6 7. dxe6 Nxc4 0-1' });
    const id = state().game!.id;
    expect(review!.own).toMatchObject({ state: 'pending' });
    // skipped before the engine has finished: the findings arrive as soon as it has
    await send({ type: 'own_review', action: 'skip' });
    await until(() => review?.gameId === id && review.status === 'done' && review.moments.length > 0, 60_000);
    expect(review!.own).toMatchObject({ state: 'skipped', marks: [] });
    expect(review!.moments[0]).toMatchObject({ san: 'Ne6', first: true });
    expect(app.db.getSelfReview(id)).toMatchObject({ skipped: true });
    // with the setting off, a game opens straight to the engine's view
    await send({ type: 'setting', key: 'review.ownFirst', value: false });
    await send({ type: 'library', action: 'remove', id });
  });

  // PLAN WP 5.7: the report cites only validated facts; takeaways, the journal, the owner's own word for a tag.
  it('writes the report of a game from what the analysis stored, and keeps a journal of the takeaways', async () => {
    await send({ type: 'setting', key: 'review.ownFirst', value: false });
    await send({ type: 'library', action: 'import', text: '[White "x"]\n[Black "OwnerLichess"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0' });
    const first = state().game!.id;
    await until(() => review?.gameId === first && review.status === 'done' && !!review.report, 60_000);
    const report = review!.report!;
    // one slip, one takeaway, and it rests on that slip
    expect(report.takeaways).toEqual([{ step: 'missed_threat', plies: [6], text: 'Before you choose a move, ask what their last move was trying to do. That step was missing on move 3 (Nf6).' }]);
    expect(report.since).toEqual([]);
    for (const line of report.positives) expect(line).toMatch(/^(You played the engine's first choice|You made no blunders|Your first \d+ moves were clean|None of your moves)/);
    expect(app.db.getReport(first)!.report).toEqual(report);
    expect(library!.journal).toEqual([{ step: 'missed_threat', habit: 'Before you choose a move, ask what their last move was trying to do', games: 1, lastAt: expect.any(String) }]);

    // the owner was there: it was the clock, they say. The report and the journal follow, and a new analysis keeps their word
    msgs = [];
    await send({ type: 'review_tag', ply: 6, step: 'time' });
    expect(review!.moments[0]).toMatchObject({ step: 'time', stepName: 'Played too fast', stepBy: 'owner' });
    expect(review!.report!.takeaways.map((t) => t.step)).toEqual(['time']);
    expect(library!.journal.map((j) => j.step)).toEqual(['time']);
    await send({ type: 'review_tag', ply: 5, step: 'time' }); // the opponent's move: not a slip of the owner's
    expect(toasts().at(-1)).toMatch(/not one of your slips/);
    await send({ type: 'library', action: 'analyse' });
    expect(review!.moments[0]).toMatchObject({ step: 'time', stepBy: 'owner' });
    // a note for next time is kept with the game
    await send({ type: 'review_note', text: 'Look at the queen before anything else.' });
    expect(review!.ownerNote).toBe('Look at the queen before anything else.');
    expect(app.db.getReport(first)!.note).toBe('Look at the queen before anything else.');

    // the next game: the report says how the last game's takeaway fared, and the journal counts both
    await send({ type: 'library', action: 'import', text: '[White "OwnerLichess"]\n[Black "y"]\n[Result "0-1"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Na5 6. Ne6 fxe6 7. dxe6 Nxc4 0-1' });
    const second = state().game!.id;
    await until(() => review?.gameId === second && review.status === 'done' && !!review.report, 60_000);
    expect(review!.report!.since).toEqual([{ step: 'time', habit: 'Slow down for the moves that matter: a few more seconds on a capture or a threat', cameUpAgain: false }]);
    expect(review!.report!.takeaways.length).toBeGreaterThanOrEqual(1);
    expect(review!.report!.takeaways.length).toBeLessThanOrEqual(4);
    // every takeaway rests on slips of the owner's that carry its step
    const slips = app.db.ownerSlips(second, 'white');
    for (const t of review!.report!.takeaways) expect(t.plies.every((ply) => slips.some((x) => x.ply === ply && x.step === t.step))).toBe(true);
    expect(library!.journal.map((j) => j.step)).toContain('time');
    expect(library!.journal.length).toBeGreaterThanOrEqual(2);
    // opened again, the first game still has its report, the owner's word and the note
    await send({ type: 'library', action: 'open', id: first });
    await until(() => review?.gameId === first && review.status === 'done' && !!review.report, 60_000);
    expect(review).toMatchObject({ ownerNote: 'Look at the queen before anything else.', moments: [{ step: 'time', stepBy: 'owner' }] });
    // the skill profile (WP 5.8) is counted from the same two games
    const p = library!.profile;
    expect(p.games).toBe(2);
    expect(p.band).toBeNull(); // two games are too few for a band
    expect(p.blunders.value).toBeGreaterThan(0);
    expect(p.blunders.trend).toBeNull();
    // the knight hung on e6 is one piece in two games, at least
    expect(p.hungPieces.value).toBeGreaterThanOrEqual(0.5);
    expect(p.openingLosses.games).toBe(2);
    // the owner's own word for the first game's slip is what the profile counts
    expect(p.steps.map((x) => x.step)).toContain('time');
    expect(p.steps.reduce((n, x) => n + x.count, 0)).toBe(app.db.ownerSlips(first, 'black').length + app.db.ownerSlips(second, 'white').filter((x) => x.step !== 'unknown').length);
    // and the coach can read it, with the owner's notes on the game on the board
    const told = (await app.tools.owner_profile()) as { ok: boolean; profile: string[]; habitsTheReviewsKeepComingBackTo: string[]; thisGame: { ownersNoteForNextTime: string; takeaways: string[] } };
    expect(told.ok).toBe(true);
    expect(told.profile[0]).toBe("From 2 analysed games of the owner's.");
    expect(told.profile.some((line) => line.startsWith('Blunders per 100 live moves: '))).toBe(true);
    expect(told.habitsTheReviewsKeepComingBackTo.length).toBeGreaterThanOrEqual(2);
    expect(told.thisGame).toMatchObject({ ownersNoteForNextTime: 'Look at the queen before anything else.' });
    expect(told.thisGame.takeaways[0]).toMatch(/^Slow down for the moves that matter/);
    for (const id of [first, second]) await send({ type: 'library', action: 'remove', id });
    expect(library!.journal).toEqual([]);
    expect(library!.profile.games).toBe(0);
  });

  // PLAN WP 6.3: known games yield the expected puzzles.
  it('makes puzzles from the slips of a game: the expected ones, through the gates, and never before the owner has looked', async () => {
    app.settings.set('content.gateNodes', 500_000);
    await send({ type: 'setting', key: 'puzzles.fromGames', value: true });
    await send({ type: 'setting', key: 'review.ownFirst', value: true });
    const made = () => JSON.parse(app.db.recentEvents('puzzles_made', 1)[0]!.data) as { game: number; made: { id: number; ply: number; status: string; solution: string[] }[]; skipped: { ply: number; why: string }[] };

    // 1. A missed chance: Black's knight on e4 falls to a queen check, and the owner (White) castled instead
    await send({ type: 'library', action: 'import', text: '[White "OwnerLichess"]\n[Black "y"]\n[Result "1/2-1/2"]\n\n1. e4 c5 2. Nf3 d6 3. c3 Nf6 4. Be2 Nxe4 5. O-O Nf6 1/2-1/2' });
    const fork = state().game!.id;
    // while the owner is still going through the game themselves, nothing is made from it
    await until(() => review?.gameId === fork && review.status === 'done', 60_000);
    expect(review!.puzzles).toBeUndefined();
    expect(app.db.contentFromGame(fork)).toEqual([]);
    await send({ type: 'own_review', action: 'skip' });
    await until(() => review?.gameId === fork && review.puzzles?.state === 'done', 120_000);
    const one = app.db.contentFromGame(fork).filter((x) => x.type === 'puzzle_game');
    // a drawn game White was clearly winning (the knight on e4 was theirs to take): a win-the-won-game drill too (6.8)
    expect(app.db.contentFromGame(fork).filter((x) => x.type === 'convert').map((x) => x.source)).toEqual([`game:${fork}#9`]);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ type: 'puzzle_game', status: 'live', source: `game:${fork}#9`, licence: 'own', level: '400–700' });
    expect(one[0]!.gates.map((g) => [g.gate, g.result])).toEqual([
      ['V1', 'pass'],
      ['V2', 'pass'],
      ['V3', 'pass'],
      ['V6', 'pass'],
    ]);
    const p = one[0]!.body;
    // it starts a move earlier, so the knight's capture is played in front of the owner
    expect(p).toMatchObject({ setup: 'Nxe4', kind: 'punish' });
    expect(p.fen).toMatch(/^rnbqkb1r\/pp2pppp\/3p1n2\/2p5\/4P3\/2P2N2\/PP1PBPPP\/RNBQK2R b /);
    // the check first, the knight on the second move; the line ends on the owner's move
    expect(p.solution[0]).toBe('Qa4+');
    expect(p.solution[2]).toBe('Qxe4');
    expect(p.solution.length % 2).toBe(1);
    expect(p.themes).toContain('fork');
    expect(review!.puzzles).toEqual({ state: 'done', ids: [one[0]!.id] });

    // 2. The teaching tier: a bishop that two pieces can take. Either capture is the answer
    await send({ type: 'setting', key: 'review.ownFirst', value: false });
    await send({ type: 'library', action: 'import', text: '[White "OwnerLichess"]\n[Black "y"]\n[Result "1-0"]\n\n1. d4 e5 2. dxe5 Bb4+ 3. c3 Ba3 4. Nf3 Bf8 5. e4 1-0' });
    const free = state().game!.id;
    await until(() => review?.gameId === free && review.puzzles?.state === 'done', 120_000);
    const two = app.db.contentFromGame(free).filter((x) => x.source === `game:${free}#7`);
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ status: 'live', body: { setup: 'Ba3', kind: 'punish' } });
    expect(two[0]!.body.solution).toHaveLength(1);
    expect([two[0]!.body.solution[0], ...(two[0]!.body.accepted?.[0] ?? [])].sort()).toEqual(['Nxa3', 'bxa3']);
    expect(two[0]!.body.themes).toContain('hangingPiece');

    // 3. No puzzle where several moves are as good: the Scholar's Mate can be met in more than one way
    await send({ type: 'library', action: 'import', text: '[White "x"]\n[Black "OwnerLichess"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0' });
    const scholar = state().game!.id;
    await until(() => review?.gameId === scholar && review.puzzles?.state === 'done', 120_000);
    expect(app.db.contentFromGame(scholar).filter((x) => x.type === 'puzzle_game')).toEqual([]);
    expect(review!.puzzles).toEqual({ state: 'done', ids: [] });
    expect(made()).toMatchObject({ game: scholar, made: [], skipped: [{ ply: 6, why: expect.stringMatching(/^more than one good move \(/) }] });

    // the puzzles are there to be solved, and made again they are the same items
    expect(app.db.puzzleCounts().ready).toBeGreaterThanOrEqual(2);
    await send({ type: 'library', action: 'open', id: fork });
    await until(() => review?.gameId === fork && review.puzzles?.state === 'done', 120_000);
    await send({ type: 'library', action: 'analyse' });
    await until(() => made().game === fork && review?.puzzles?.state === 'done', 120_000);
    expect(app.db.contentFromGame(fork).filter((x) => x.type === 'puzzle_game').map((x) => x.id)).toEqual([one[0]!.id]);
    // the Scholar's Mate slip is a safety check as well (6.6): Nf6 lost the game, g6 did not
    expect(app.db.contentFromGame(scholar).filter((x) => x.type === 'safety')).toHaveLength(3);
    // removing a game removes its puzzles and its safety checks
    for (const id of [fork, free, scholar]) await send({ type: 'library', action: 'remove', id });
    expect(app.db.puzzleCounts().ready).toBe(0);
    expect(app.db.listContent({ type: 'safety', limit: 100 })).toEqual([]);
    expect(app.safety.view.ready).toBe(0);
    await send({ type: 'setting', key: 'puzzles.fromGames', value: false });
  });
});

// PLAN WP 6.1: a puzzle with an illegal move, a second solution, or a false sentence is
// quarantined with the right reason; a sound one goes live.
describe('the content gates (real engine)', () => {
  let dir: string;
  let app: App;
  const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
  // the e-pawn and the knight can both take the knight on d5 for nothing
  const TWO_WAYS = '4k3/8/8/3n4/4P3/2N5/PPP3PP/6K1 w - - 0 1';
  const item = (body: Partial<Puzzle>, over: Partial<ContentItem<Puzzle>> = {}): ContentItem<Puzzle> => ({
    type: 'puzzle_game',
    status: 'draft',
    source: 'game:7#31',
    licence: 'own',
    level: '400–700',
    gates: [],
    body: { fen: BACK_RANK, solution: ['Rd8#'], themes: ['backRankMate'], kind: 'mistake', ...body },
    ...over,
  });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-content-'));
    app = new App({ repoRoot: config.repoRoot, dataDir: dir, stockfish: config.stockfish, syzygy: config.syzygy, claudePath: 'unused', openingsDir: config.openingsDir, mcpUrl: 'http://127.0.0.1:1/mcp', cloud: null, sites: fakeSites().http });
    app.engine.signature = 'test';
    // a lighter check than the app's default keeps the test quick; the rule is the same
    app.settings.set('content.gateNodes', 500_000);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a sound puzzle passes every gate and goes live, with its engine recorded', async () => {
    const out = await app.content.submit(item({ explanation: '{m:Rd8#} is checkmate: their king is shut in by its own pawns.' }));
    expect(out.gates.map((g) => [g.gate, g.result])).toEqual([
      ['V1', 'pass'],
      ['V2', 'pass'],
      ['V3', 'pass'],
      ['V6', 'pass'],
    ]);
    expect(out.status).toBe('live');
    expect(out.engine).toBe('test, 500000 nodes');
    expect(app.db.getContent(out.id)).toMatchObject({ status: 'live', source: 'game:7#31', body: { solution: ['Rd8#'] } });
    // made again, it is the same item
    expect((await app.content.submit(item({ explanation: '{m:Rd8#} is checkmate: their king is shut in by its own pawns.' }))).id).toBe(out.id);
    expect(app.db.listContent({ status: 'live' })).toHaveLength(1);
  });

  it('an illegal move is quarantined by V1, with the move', async () => {
    const out = await app.content.submit(item({ solution: ['Qd8#'] }, { source: 'game:7#33' }));
    expect(out.status).toBe('quarantined');
    expect(quarantineReasons(out)[0]).toBe('V1 Legality: move 1 of the solution (Qd8#) is not legal in the puzzle position');
    // the engine is not asked about a line that is not legal
    expect(out.gates.find((g) => g.gate === 'V2')).toMatchObject({ result: 'fail', detail: 'not run: the line is not legal' });
  });

  it('a second solution is quarantined by V2, with the other move; accepting it lets the puzzle through', async () => {
    const out = await app.content.submit(item({ fen: TWO_WAYS, solution: ['exd5'], themes: ['hangingPiece'], kind: 'punish' }, { source: 'game:7#35' }));
    expect(out.status).toBe('quarantined');
    expect(quarantineReasons(out)).toEqual(['V2 Engine soundness: a second solution at move 1: Nxd5 is about as good as exd5. Accept it as an answer, or drop the puzzle']);
    const both = await app.content.submit(item({ fen: TWO_WAYS, solution: ['exd5'], accepted: { 0: ['Nxd5'] }, themes: ['hangingPiece'], kind: 'punish' }, { source: 'game:7#37' }));
    expect(both.status).toBe('live');
    // a solution that is not a good move at all is caught too
    const wrong = await app.content.validate(item({ fen: TWO_WAYS, solution: ['a3'] }, { source: 'game:7#39' }));
    expect(wrong.gates.find((g) => g.gate === 'V2')!.detail).toMatch(/^move 1 of the solution \(a3\) is not a good move here: the engine plays (exd5|Nxd5)$/);
    // a mate in one accepts any mating move, and other winning moves are no second solution
    expect((await app.content.validate(item({}))).gates.find((g) => g.gate === 'V2')).toEqual({ gate: 'V2', result: 'pass' });
  });

  it('a false sentence is quarantined by V3, with the sentence', async () => {
    const out = await app.content.submit(item({ explanation: '{m:Rd8#} wins their queen.' }, { source: 'game:7#41' }));
    expect(out.status).toBe('quarantined');
    const reason = quarantineReasons(out)[0]!;
    expect(reason).toMatch(/^V3 Text claims: "\{m:Rd8#\} wins their queen\.": /);
    expect(out.gates.find((g) => g.gate === 'V1')!.result).toBe('pass');
    expect(out.gates.find((g) => g.gate === 'V2')!.result).toBe('pass');
  });

  it('with automatic approval off, a puzzle that passes waits for the owner', async () => {
    app.settings.set('content.autoApprovePuzzles', false);
    const out = await app.content.submit(item({}, { source: 'game:8#11' }));
    expect(out.status).toBe('machine-verified');
    expect(app.content.approve(out.id)).toBe(true);
    expect(app.db.getContent(out.id)!.status).toBe('live');
    // a quarantined item cannot be approved
    const bad = await app.content.submit(item({ solution: ['Qd8#'] }, { source: 'game:8#13' }));
    expect(app.content.approve(bad.id)).toBe(false);
    // an item with no source, or no level, fails provenance
    const anon = await app.content.validate(item({}, { source: '', level: undefined }));
    expect(anon.gates.find((g) => g.gate === 'V6')!.detail).toMatch(/does not say where the item came from; the level band is not set/);
    app.settings.set('content.autoApprovePuzzles', true);
  });
});

// PLAN WP 6.2: the puzzle player. Multi-move solutions, accepted answers, retry, the hint ladder,
// and on a miss what the move runs into, from the engine's facts. No coach is involved.
describe('the puzzle player (real engine)', () => {
  let dir: string;
  let app: App;
  let view: PuzzleView | null = null;
  const toasts: string[] = [];
  const client = {
    send: (m: ServerMsg) => {
      if (m.type === 'puzzle') view = m.view;
      if (m.type === 'toast') toasts.push(m.text);
    },
  };
  const send = (m: Parameters<App['onClientMessage']>[1]) => app.onClientMessage(client, m);
  const until = async (test: () => boolean, ms = 20_000) => {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 > ms) throw new Error('timed out waiting');
      await sleep(20);
    }
  };
  const item = (source: string, body: Partial<Puzzle> & Pick<Puzzle, 'fen' | 'solution'>): ContentItem<Puzzle> => ({ type: 'puzzle_game', status: 'draft', source, licence: 'own', level: '400–700', gates: [], body: { themes: [], kind: 'mistake', ...body } });
  // Black's rook steps to a8, and White's doubled rooks break through on the back rank
  const BACK_RANK = { fen: '1r4k1/5ppp/8/8/8/8/3R1PPP/3R2K1 b - - 0 1', setup: 'Ra8', solution: ['Rd8+', 'Rxd8', 'Rxd8#'], themes: ['backRankMate', 'mateIn2'] };
  const TWO_WAYS = { fen: '4k3/8/8/3n4/4P3/2N5/PPP3PP/6K1 w - - 0 1', solution: ['exd5'], accepted: { 0: ['Nxd5'] }, themes: ['hangingPiece'], kind: 'punish' as const };
  const MATE_1 = { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solution: ['Rd8#'], themes: ['backRankMate', 'mateIn1'], explanation: '{m:Rd8#} is checkmate: their king is shut in by its own pawns.' };
  let a = 0;
  let b = 0;
  let c = 0;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-puzzles-'));
    app = new App({ repoRoot: config.repoRoot, dataDir: dir, stockfish: config.stockfish, syzygy: config.syzygy, claudePath: 'unused', openingsDir: config.openingsDir, mcpUrl: 'http://127.0.0.1:1/mcp', cloud: null, sites: fakeSites().http, puzzleNoDelay: true });
    app.engine.signature = 'test';
    app.settings.set('content.gateNodes', 500_000);
    app.addClient(client);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('with no puzzles, the screen says where they come from', async () => {
    await send({ type: 'mode', mode: 'puzzles' });
    expect(app.mode).toBe('puzzles');
    expect(view).toMatchObject({ status: 'idle', ready: 0, fresh: 0, problem: expect.stringMatching(/made from your own games/) });
  });

  it('only puzzles that passed their gates are played', async () => {
    a = (await app.content.submit(item('game:1#11', BACK_RANK))).id;
    b = (await app.content.submit(item('game:1#21', TWO_WAYS))).id;
    c = (await app.content.submit(item('game:1#31', MATE_1))).id;
    const bad = await app.content.submit(item('game:1#41', { fen: MATE_1.fen, solution: ['Qd8#'] }));
    expect([a, b, c].map((id) => app.db.getContent(id)!.status)).toEqual(['live', 'live', 'live']);
    expect(bad.status).toBe('quarantined');
    expect(app.db.puzzleCounts()).toEqual({ ready: 3, fresh: 3 });
    await send({ type: 'puzzle', action: 'start', id: bad.id });
    expect(toasts.at(-1)).toBe('That puzzle is not available.');
  });

  it('a multi-move puzzle: the set-up move is played, hints come a rung at a time, a miss is answered from the facts', async () => {
    await send({ type: 'puzzle', action: 'start' });
    expect(view).toMatchObject({ status: 'solving', id: a, you: 'white', yourTurn: true, from: 'From one of your games, move 6', task: expect.stringMatching(/^From your own game: you went wrong here/) });
    expect(view!.moves.map((m) => `${m.by}:${m.san}`)).toEqual(['them:Ra8']);
    expect(view!.lastMove).toEqual(['b8', 'a8']);
    // the themes would give the idea away
    expect(view!.themes).toBeUndefined();
    expect(view!.nextHint).toBe('question');
    await send({ type: 'puzzle', action: 'hint' });
    expect(view).toMatchObject({ hints: 1, nextHint: 'nudge', feedback: { tone: 'hint', text: expect.stringMatching(/checks, your captures and your threats/) }, shapes: [] });
    await send({ type: 'puzzle', action: 'hint' });
    expect(view!.feedback!.text).toBe('Look at your rook on d2.');
    await send({ type: 'puzzle', action: 'hint' });
    expect(view).toMatchObject({ hints: 3, nextHint: 'answer', shapes: [{ from: 'd2', to: 'd8' }] });
    // a miss: the position stays, and the engine's fact says what the move runs into, without the answer
    await send({ type: 'puzzle', action: 'move', from: 'h2', to: 'h3' });
    expect(view).toMatchObject({ status: 'solving', misses: 1, yourTurn: true });
    expect(view!.moves).toHaveLength(1);
    await until(() => !!view!.feedback && view!.feedback.tone === 'wrong' && !/Checking/.test(view!.feedback.text));
    expect(view!.feedback!.text).toMatch(/^Not that one\. h3 /);
    expect(view!.feedback!.text).not.toMatch(/Rd8/);
    // an illegal move is refused and is no miss
    await send({ type: 'puzzle', action: 'move', from: 'd2', to: 'e3' });
    expect(toasts.at(-1)).toBe('That move is not legal there.');
    expect(view!.misses).toBe(1);
    // the right move: their reply comes by itself, and the second move solves it
    await send({ type: 'puzzle', action: 'move', from: 'd2', to: 'd8' });
    expect(view!.moves.map((m) => `${m.by}:${m.san}`)).toEqual(['them:Ra8', 'you:Rd8+', 'them:Rxd8']);
    expect(view).toMatchObject({ status: 'solving', yourTurn: true, feedback: undefined });
    await send({ type: 'puzzle', action: 'move', from: 'd1', to: 'd8' });
    expect(view).toMatchObject({ status: 'solved', yourTurn: false, themes: ['backRankMate', 'mateIn2'] });
    await until(() => /^Solved\. \S/.test(view!.feedback?.text ?? ''));
    expect(view!.feedback).toMatchObject({ tone: 'good', text: expect.stringMatching(/checkmate/) });
    // the attempt is kept: what it took
    expect(app.db.attemptsOf(a)).toMatchObject([{ result: 'solved', hints: 3, misses: 1, again: false }]);
    expect(app.db.puzzleCounts()).toEqual({ ready: 3, fresh: 2 });
  });

  it('an accepted answer solves it too; trying again is kept apart', async () => {
    await send({ type: 'puzzle', action: 'next' });
    expect(view).toMatchObject({ status: 'solving', id: b, task: expect.stringMatching(/your opponent slipped/) });
    await send({ type: 'puzzle', action: 'move', from: 'c3', to: 'd5' });
    expect(view).toMatchObject({ status: 'solved' });
    await until(() => /^Solved: that move works too\. \S/.test(view!.feedback?.text ?? ''));
    await send({ type: 'puzzle', action: 'retry' });
    expect(view).toMatchObject({ status: 'solving', id: b, hints: 0, misses: 0, feedback: undefined });
    await send({ type: 'puzzle', action: 'move', from: 'e4', to: 'd5' });
    await until(() => (view!.feedback?.text ?? '').startsWith('Solved, first try.'));
    expect(app.db.attemptsOf(b).map((x) => [x.result, x.again])).toEqual([
      ['solved', false],
      ['solved', true],
    ]);
  });

  it('after the misses allowed the answer is given, with the puzzle\'s own checked words; "show the answer" does the same at once', async () => {
    await send({ type: 'puzzle', action: 'next' });
    expect(view).toMatchObject({ status: 'solving', id: c });
    await send({ type: 'puzzle', action: 'move', from: 'h2', to: 'h3' });
    expect(view!.status).toBe('solving');
    await send({ type: 'puzzle', action: 'move', from: 'g2', to: 'g3' });
    expect(view).toMatchObject({ status: 'shown', misses: 2, feedback: { tone: 'answer', text: 'That was the last try: the answer is on the board. Rd8# is checkmate: their king is shut in by its own pawns.' } });
    expect(view!.moves.map((m) => m.san)).toEqual(['Rd8#']);
    expect(app.db.attemptsOf(c)).toMatchObject([{ result: 'shown', misses: 2 }]);
    // every puzzle has been tried once: the least tried comes round again, and its answer can be asked for
    await send({ type: 'puzzle', action: 'next' });
    expect(view).toMatchObject({ status: 'solving', id: a });
    await send({ type: 'puzzle', action: 'show' });
    expect(view!.status).toBe('shown');
    expect(view!.moves.map((m) => m.san)).toEqual(['Ra8', 'Rd8+', 'Rxd8', 'Rxd8#']);
    await until(() => /^The answer is on the board\. \S/.test(view!.feedback?.text ?? ''));
    expect(app.db.puzzleCounts()).toEqual({ ready: 3, fresh: 0 });
  });

  it('fair play: a puzzle on the position of a game still being played is passed over', async () => {
    app.settings.set('accounts.chesscom', 'OwnerChessCom');
    await app.library.refreshOngoing();
    const live = ongoingCc.games[1]!;
    const move = legalMoves(mustPosition(live.fen))[0]!.san;
    const id = app.db.saveContent('fair-play-test', { type: 'puzzle_game', status: 'live', source: 'game:9#25', licence: 'own', level: '400–700', gates: [], body: { fen: live.fen, solution: [move], themes: [], kind: 'mistake' } });
    await send({ type: 'puzzle', action: 'start', id });
    expect(toasts.at(-1)).toMatch(/game in progress on Chess\.com.*Fair play/);
    expect(view!.id).not.toBe(id);
    // it has never been tried, so it would be next: it is skipped
    await send({ type: 'puzzle', action: 'next' });
    expect(view!.status).toBe('solving');
    expect(view!.id).not.toBe(id);
    // closing the player leaves the board empty
    await send({ type: 'puzzle', action: 'close' });
    expect(view).toMatchObject({ status: 'idle', moves: [] });
  });

  it('removing a game removes the puzzles made from it', async () => {
    expect(app.db.listContent({ type: 'puzzle_game' }).filter((x) => x.source.startsWith('game:1#')).length).toBe(4);
    app.db.deleteGame(1);
    expect(app.db.listContent({ type: 'puzzle_game' }).filter((x) => x.source.startsWith('game:1#'))).toEqual([]);
    expect(app.db.attemptsOf(a)).toEqual([]);
  });
});

// PLAN WP 6.6: the safety-check trainer, from fixtures of known slips.
describe('the safety-check trainer (real engine)', () => {
  let dir: string;
  let app: App;
  let view: SafetyView | null = null;
  const client = {
    send: (m: ServerMsg) => {
      if (m.type === 'safety') view = m.view;
    },
  };
  const send = (m: Parameters<App['onClientMessage']>[1]) => app.onClientMessage(client, m);
  const until = async (test: () => boolean, ms = 60_000) => {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 > ms) throw new Error('timed out waiting');
      await sleep(20);
    }
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-safety-'));
    app = new App({ repoRoot: config.repoRoot, dataDir: dir, stockfish: config.stockfish, syzygy: config.syzygy, claudePath: 'unused', openingsDir: config.openingsDir, mcpUrl: 'http://127.0.0.1:1/mcp', cloud: null, sites: fakeSites().http, puzzleNoDelay: true });
    app.engine.signature = 'test';
    app.addClient(client);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a slip makes three items, each verdict and reason the engine\'s: the move played is not safe, the engine\'s choice is', async () => {
    // the Scholar's Mate: 3...Nf6 allows mate, 3...g6 does not
    const items = await safetyItems(app.facts, { fenBefore: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', san: 'Nf6', best: 'g6' });
    expect(items.map((x) => [x.question, x.candidates.map((c) => `${c.san}:${c.safe}`).join(' ')])).toEqual([
      ['is_safe', 'Nf6:false'],
      ['is_safe', 'g6:true'],
      ['which_loses', 'Nf6:false g6:true'],
    ]);
    expect(items[0]!.candidates[0]!.why).toMatch(/checkmate/);
    expect(items[0]!.candidates[0]!.why).not.toMatch(/\{|What it does manage/);
    // a knight put where a pawn takes it: 6.Ne6 against 6.Bb5+
    const knight = await safetyItems(app.facts, { fenBefore: 'r1bqkb1r/ppp2ppp/5n2/n2Pp1N1/2B5/8/PPPP1PPP/RNBQK2R w KQkq - 1 6', san: 'Ne6', best: 'Bb5+' });
    expect(knight).toHaveLength(3);
    expect(knight[0]!.candidates[0]).toMatchObject({ san: 'Ne6', safe: false, why: expect.stringMatching(/knight/) });
    // when the engine's choice is the move played, or the move played was not unsafe, there is no item
    expect(await safetyItems(app.facts, { fenBefore: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', san: 'g6', best: 'g6' })).toEqual([]);
    expect(await safetyItems(app.facts, { fenBefore: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', san: 'Qe7', best: 'g6' })).toEqual([]);
  });

  it('a game gone through brings its safety checks; nothing says which move is safe until the owner answers', async () => {
    // the listing step is tried in the next test
    await send({ type: 'setting', key: 'safety.listFirst', value: false });
    await send({ type: 'setting', key: 'review.ownFirst', value: false });
    await send({ type: 'setting', key: 'puzzles.fromGames', value: true });
    app.settings.set('content.gateNodes', 500_000);
    await send({ type: 'library', action: 'import', text: '[White "x"]\n[Black "Owner"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0' });
    if (app.session.state.orientation !== 'black') await send({ type: 'flip' });
    await send({ type: 'library', action: 'analyse' });
    await until(() => app.db.recentEvents('safety_made', 1).length > 0, 120_000);
    const made = JSON.parse(app.db.recentEvents('safety_made', 1)[0]!.data) as { ids: number[] };
    expect(made.ids).toHaveLength(3);
    for (const id of made.ids) expect(app.db.getContent(id)!.gates.map((g) => `${g.gate}:${g.result}`)).toEqual(['V1:pass', 'V6:pass']);
    await send({ type: 'mode', mode: 'puzzles' });
    await send({ type: 'puzzle', action: 'set', set: { kind: 'safety' } });
    expect(app.puzzles.view.set).toEqual({ kind: 'safety' });
    expect(view).toMatchObject({ status: 'asking', ready: 3, left: 3 });
    expect(view!.result).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/"safe"/);
    // answer every one: the "is it safe?" ones by the truth, the "which" one wrongly
    for (let i = 0; i < 3; i++) {
      const v = view!;
      const truth = app.db.getContent(v.id!)!.body as unknown as { question: string; candidates: { san: string; safe: boolean }[] };
      if (v.question === 'is_safe') await send({ type: 'safety', action: 'answer', safe: truth.candidates[0]!.safe });
      else await send({ type: 'safety', action: 'answer', pick: truth.candidates.find((c) => c.safe)!.san });
      expect(view).toMatchObject({ status: 'answered', result: { right: v.question === 'is_safe', played: 'Nf6' } });
      expect(view!.result!.candidates.every((c) => c.why.length > 0)).toBe(true);
      const card = app.db.getCard(v.id!)!;
      const days = (Date.parse(card.dueAt) - Date.now()) / 86_400_000;
      // right: later; wrong: tomorrow
      if (v.question === 'is_safe') expect(days).toBeGreaterThan(1.5);
      else expect(Math.round(days)).toBe(1);
      await send({ type: 'safety', action: 'next' });
    }
    expect(view).toMatchObject({ status: 'idle', problem: 'Nothing more to check today.', left: 0 });
  });

  it('the listing step: their checks and captures are made first, the ones missed are shown, and a miss makes the grade hard', async () => {
    await send({ type: 'setting', key: 'safety.listFirst', value: true });
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
    const body = { fen, question: 'is_safe' as const, candidates: [{ san: 'Nf6', safe: false, why: 'Nf6 allows checkmate with Qxf7#.' }], played: 'Nf6' };
    const id = app.db.saveContent('game:999#6|safety|is_safe|Nf6', { type: 'safety', status: 'live', source: 'game:999#6', licence: 'own', level: '400–700', gates: [gateV1Safety(body), { gate: 'V6', result: 'pass' }], body } as never);
    await send({ type: 'safety', action: 'next' });
    expect(view).toMatchObject({ status: 'asking', id, list: { stage: 'listing', lastMove: ['g8', 'f6'], found: [], tries: 0 } });
    expect(view!.list!.fen).toMatch(/^r1bqkb1r\/pppp1ppp\/2n2n2\/4p2Q\/2B1P3\/8\/PPPP1PPP\/RNB1K1NR w /);
    // the ruling waits for the listing
    await send({ type: 'safety', action: 'answer', safe: false });
    expect(view!.status).toBe('asking');
    await send({ type: 'safety', action: 'try', from: 'c4', to: 'f7' });
    expect(view!.list).toMatchObject({ found: [{ san: 'Bxf7+', from: 'c4', to: 'f7' }], note: { san: 'Bxf7+', text: 'is a capture with check.', good: true }, tries: 1 });
    await send({ type: 'safety', action: 'try', from: 'c4', to: 'f7' });
    expect(view!.list).toMatchObject({ note: { text: 'is on your list already.' }, tries: 2 });
    expect(view!.list!.found).toHaveLength(1);
    await send({ type: 'safety', action: 'try', from: 'h5', to: 'h6' });
    expect(view!.list!.note).toEqual({ san: 'Qh6', text: 'is neither a check nor a capture.', good: false });
    await send({ type: 'safety', action: 'try', from: 'a1', to: 'a8' });
    expect(view!.list!.note).toEqual({ text: 'That move is not possible.', good: false });
    await send({ type: 'safety', action: 'try', from: 'h5', to: 'h7' });
    await send({ type: 'safety', action: 'listed' });
    expect(view!.list!.stage).toBe('listed');
    expect(view!.list!.missed!.map((r) => r.san).sort()).toEqual(['Qxe5+', 'Qxf7#']);
    expect(view!.result).toBeUndefined();
    // more moves after "that's all" change nothing
    await send({ type: 'safety', action: 'try', from: 'h5', to: 'e5' });
    expect(view!.list!.found).toHaveLength(2);
    await send({ type: 'safety', action: 'answer', safe: false });
    expect(view).toMatchObject({ status: 'answered', result: { right: true } });
    expect(app.db.attemptsOf(id)).toMatchObject([{ result: 'solved', hints: 2, misses: 0 }]);
    expect(JSON.parse(app.db.recentEvents('safety', 1)[0]!.data)).toMatchObject({ id, right: true, found: 2, missed: 2 });
    // right, with two missed: hard, which comes back sooner than good would
    const hard = (Date.parse(app.db.getCard(id)!.dueAt) - Date.now()) / 86_400_000;
    const good = (Date.parse(reviewCard(await makeScheduler(180), null, 'good', new Date()).card.dueAt) - Date.now()) / 86_400_000;
    expect(hard).toBeLessThan(good);
    expect(hard).toBeGreaterThanOrEqual(0.99);
    await send({ type: 'safety', action: 'close' });
  });
});

// PLAN WP 6.7: "what's the threat?", from fixtures of known slips.
describe("what's the threat? (real engine)", () => {
  let dir: string;
  let app: App;
  let view: ThreatView | null = null;
  const client = {
    send: (m: ServerMsg) => {
      if (m.type === 'threat') view = m.view;
    },
  };
  const send = (m: Parameters<App['onClientMessage']>[1]) => app.onClientMessage(client, m);
  const until = async (test: () => boolean, ms = 60_000) => {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 > ms) throw new Error('timed out waiting');
      await sleep(20);
    }
  };
  const SCHOLAR = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
  // after 1.e4 d5 2.exd5 Qxd5 3.Nc3 the knight hits the queen
  const QUEEN = 'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 3';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-threat-'));
    app = new App({ repoRoot: config.repoRoot, dataDir: dir, stockfish: config.stockfish, syzygy: config.syzygy, claudePath: 'unused', openingsDir: config.openingsDir, mcpUrl: 'http://127.0.0.1:1/mcp', cloud: null, sites: fakeSites().http, puzzleNoDelay: true });
    app.engine.signature = 'test';
    app.addClient(client);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a slip that let a threat happen makes an item: the threat and what it wins, the engine's answer, the move played", async () => {
    const mate = await threatItem(app.facts, { fenBefore: SCHOLAR, san: 'Nf6', best: 'g6', lastMove: { san: 'Bc4', from: 'f1', to: 'c4' } });
    expect(mate).toMatchObject({ threat: { san: 'Qxf7#', from: 'h5', to: 'f7', mate: 1, what: 'it would be checkmate' }, accepted: [], best: { san: 'g6' }, played: { san: 'Nf6' } });
    expect(mate!.best.why).toMatch(/^g6 /);
    expect(mate!.played.why).toMatch(/checkmate/);
    expect(gateV1Threat(mate!)).toEqual({ gate: 'V1', result: 'pass' });
    const queen = await threatItem(app.facts, { fenBefore: QUEEN, san: 'Nf6', best: 'Qa5' });
    expect(queen!.threat).toMatchObject({ san: 'Nxd5', from: 'c3', to: 'd5' });
    expect(queen!.threat.what).toMatch(/^you would lose a queen/);
    // no item when the move played dealt with the threat, or when the engine's choice is the move played
    expect(await threatItem(app.facts, { fenBefore: SCHOLAR, san: 'Qe7', best: 'g6' })).toBeNull();
    expect(await threatItem(app.facts, { fenBefore: SCHOLAR, san: 'g6', best: 'g6' })).toBeNull();
    // the engine's view of any move of theirs with the turn passed
    expect(await app.facts.threatOf(SCHOLAR, 'Qxh7')).toMatchObject({ san: 'Qxh7', mate: undefined });
    expect((await app.facts.threatOf(SCHOLAR, 'Qxh7'))!.delta).toBeGreaterThan(0);
  });

  it('names the threat, then deals with it: hints, a wrong naming, a wrong move, and the grade', async () => {
    await send({ type: 'setting', key: 'review.ownFirst', value: false });
    await send({ type: 'setting', key: 'puzzles.fromGames', value: true });
    app.settings.set('content.gateNodes', 500_000);
    await send({ type: 'library', action: 'import', text: '[White "x"]\n[Black "Owner"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0' });
    if (app.session.state.orientation !== 'black') await send({ type: 'flip' });
    await send({ type: 'library', action: 'analyse' });
    await until(() => app.db.recentEvents('threats_made', 1).length > 0, 120_000);
    const made = JSON.parse(app.db.recentEvents('threats_made', 1)[0]!.data) as { ids: number[] };
    expect(made.ids).toHaveLength(1);
    const id = made.ids[0]!;
    expect(app.db.getContent(id)!.gates.map((g) => `${g.gate}:${g.result}`)).toEqual(['V1:pass', 'V6:pass']);
    await send({ type: 'mode', mode: 'puzzles' });
    await send({ type: 'puzzle', action: 'set', set: { kind: 'threat' } });
    // the board has the turn passed: White to move, Black (the owner) at the bottom; nothing says what the threat is
    expect(view).toMatchObject({ status: 'naming', id, you: 'black', lastMove: ['f1', 'c4'], nextHint: 1, shapes: [], ready: 1, left: 1 });
    expect(view!.fen).toMatch(/^r1bqkbnr\/pppp1ppp\/2n5\/4p2Q\/2B1P3\/8\/PPPP1PPP\/RNB1K1NR w /);
    expect(JSON.stringify(view)).not.toMatch(/xf7/);
    await send({ type: 'threat', action: 'hint' });
    expect(view!.feedback).toEqual({ tone: 'hint', text: 'Look at their last move, Bc4. What does it attack now, or what does it make possible?' });
    // a move that wins nothing for them: the engine says so, and the board is put back
    await send({ type: 'threat', action: 'try', from: 'h5', to: 'h7' });
    expect(view).toMatchObject({ status: 'naming', misses: 1, tries: 1, feedback: { tone: 'wrong', san: 'Qxh7', text: 'would not win anything for them.' } });
    await send({ type: 'threat', action: 'hint' });
    expect(view).toMatchObject({ hints: 2, nextHint: 3, shapes: [{ from: 'h5', style: 'target' }] });
    await send({ type: 'threat', action: 'try', from: 'h5', to: 'f7' });
    expect(view).toMatchObject({ status: 'defending', you: 'black', threat: { san: 'Qxf7#', named: true, what: 'it would be checkmate' }, feedback: { tone: 'good', text: 'Yes: that is their threat.' }, shapes: [{ from: 'h5', to: 'f7', style: 'threat' }] });
    expect(view!.fen).toBe(SCHOLAR);
    // a move that does not deal with it
    await send({ type: 'threat', action: 'try', from: 'g8', to: 'f6' });
    expect(view).toMatchObject({ status: 'defending', misses: 2, feedback: { tone: 'wrong' } });
    expect(view!.feedback!.text).toMatch(/^Not that one\. Nf6 .*checkmate/);
    await send({ type: 'threat', action: 'try', from: 'g7', to: 'g6' });
    expect(view).toMatchObject({ status: 'solved', result: { found: { san: 'g6' }, best: { san: 'g6' }, played: { san: 'Nf6' } }, feedback: { tone: 'good' } });
    expect(view!.shapes).toEqual([
      { from: 'h5', to: 'f7', style: 'threat' },
      { from: 'g7', to: 'g6', style: 'good' },
    ]);
    expect(app.db.attemptsOf(id)).toMatchObject([{ result: 'solved', hints: 2, misses: 2 }]);
    expect(JSON.parse(app.db.recentEvents('threat', 1)[0]!.data)).toMatchObject({ id, named: true, found: true, hints: 2, misses: 2 });
    // helped: hard, so it comes back before a clean answer would
    const days = (Date.parse(app.db.getCard(id)!.dueAt) - Date.now()) / 86_400_000;
    const good = (Date.parse(reviewCard(await makeScheduler(180), null, 'good', new Date()).card.dueAt) - Date.now()) / 86_400_000;
    expect(days).toBeLessThan(good);
    await send({ type: 'threat', action: 'next' });
    expect(view).toMatchObject({ status: 'idle', problem: 'Nothing more to look at today.', left: 0 });
  });

  it('the answers when asked: the threat, then a move; shown comes back the next day', async () => {
    const body = (await threatItem(app.facts, { fenBefore: QUEEN, san: 'Nf6', best: 'Qa5', lastMove: { san: 'Nc3', from: 'b1', to: 'c3' } }))!;
    const id = app.db.saveContent('game:998#6|threat', { type: 'threat', status: 'live', source: 'game:998#6', licence: 'own', level: '400–700', gates: [gateV1Threat(body), { gate: 'V6', result: 'pass' }], body } as never);
    await send({ type: 'threat', action: 'next' });
    expect(view).toMatchObject({ status: 'naming', id });
    // their move to name, not the owner's: a black move here is not possible
    await send({ type: 'threat', action: 'try', from: 'd5', to: 'a5' });
    expect(view!.feedback).toEqual({ tone: 'wrong', text: 'That move is not possible.' });
    await send({ type: 'threat', action: 'show' });
    expect(view).toMatchObject({ status: 'defending', threat: { san: 'Nxd5', named: false }, feedback: { tone: 'answer', text: 'This is their threat.' } });
    await send({ type: 'threat', action: 'show' });
    expect(view).toMatchObject({ status: 'shown', feedback: { tone: 'answer', text: body.best.why }, result: { best: { san: 'Qa5' } } });
    expect(view!.result!.found).toBeUndefined();
    expect(view!.shapes).toContainEqual({ from: 'd5', to: 'a5', style: 'good' });
    expect(app.db.attemptsOf(id)).toMatchObject([{ result: 'shown' }]);
    expect(Math.round((Date.parse(app.db.getCard(id)!.dueAt) - Date.now()) / 86_400_000)).toBe(1);
    await send({ type: 'threat', action: 'close' });
  });
});

// PLAN WP 6.8: win-the-won-game drills. A scripted game passes and a thrown one fails.
describe('win the won game (real engine)', () => {
  let dir: string;
  let app: App;
  let view: ConvertView | null = null;
  const client = {
    send: (m: ServerMsg) => {
      if (m.type === 'convert') view = m.view;
    },
  };
  const send = (m: Parameters<App['onClientMessage']>[1]) => app.onClientMessage(client, m);
  const until = async (test: () => boolean, ms = 60_000) => {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 > ms) throw new Error('timed out waiting');
      await sleep(20);
    }
  };
  let n = 0;
  /** A drill stored as live, from a position; returns its id. */
  const drill = (fen: string, game: ConvertItem['game'] = { outcome: 'draw' }) => {
    const body: ConvertItem = { fen, chances: 99, game };
    return app.db.saveContent(`game:997#${++n}|convert`, { type: 'convert', status: 'live', source: `game:997#${n}`, licence: 'own', level: '400–700', gates: [gateV1Convert(body), { gate: 'V6', result: 'pass' }], body } as never);
  };
  const days = (id: number) => (Date.parse(app.db.getCard(id)!.dueAt) - Date.now()) / 86_400_000;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-convert-'));
    app = new App({ repoRoot: config.repoRoot, dataDir: dir, stockfish: config.stockfish, syzygy: config.syzygy, claudePath: 'unused', openingsDir: config.openingsDir, mcpUrl: 'http://127.0.0.1:1/mcp', cloud: null, sites: fakeSites().http, puzzleNoDelay: true });
    app.engine.signature = 'test';
    app.addClient(client);
    app.settings.set('conversion.engineNodes', 200_000);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a mate converts it; a move that gives the win away ends it, with the reason, and can be tried again', async () => {
    // a queen against a bare king: Qa8 is mate
    const mate = drill('7k/8/6K1/8/8/8/Q7/8 w - - 0 1');
    await send({ type: 'convert', action: 'next' });
    expect(view).toMatchObject({ status: 'playing', id: mate, you: 'white', yourTurn: true, moves: [], movesLeft: 40, again: false });
    // a move that is not legal is refused, and the board put back
    await send({ type: 'convert', action: 'move', from: 'a2', to: 'b4' });
    expect(view).toMatchObject({ status: 'playing', tries: 1, moves: [] });
    await send({ type: 'convert', action: 'move', from: 'a2', to: 'a8' });
    expect(view).toMatchObject({ status: 'over', result: { outcome: 'converted', text: 'Checkmate: you won it.' }, moves: [{ san: 'Qa8#', by: 'white' }] });
    expect(app.db.attemptsOf(mate)).toMatchObject([{ result: 'solved', misses: 0, again: false }]);
    expect(days(mate)).toBeGreaterThan(1.5);

    // a queen against a knight: Qd4 walks into the knight's fork square and the win is gone
    const thrown = drill('4k3/8/2n5/8/8/8/8/3QK3 w - - 0 1', { outcome: 'loss', threw: 'Qd4' });
    await send({ type: 'convert', action: 'next' });
    expect(view).toMatchObject({ status: 'playing', id: thrown, game: { outcome: 'loss', threw: 'Qd4' } });
    await send({ type: 'convert', action: 'move', from: 'd1', to: 'd4' });
    expect(view).toMatchObject({ status: 'over', result: { outcome: 'thrown', text: 'That move gave the win away.', throwMove: { san: 'Qd4' } } });
    expect(view!.result!.throwMove!.why).toMatch(/^Qd4 .*queen/);
    expect(app.db.attemptsOf(thrown)).toMatchObject([{ result: 'shown', again: false }]);
    expect(Math.round(days(thrown))).toBe(1);
    // again from before that move: a safe one this time, and the engine replies
    await send({ type: 'convert', action: 'retry_before' });
    expect(view).toMatchObject({ status: 'playing', fen: '4k3/8/2n5/8/8/8/8/3QK3 w - - 0 1', moves: [], again: true });
    await send({ type: 'convert', action: 'move', from: 'd1', to: 'd2' });
    expect(view).toMatchObject({ status: 'playing', yourTurn: true, busy: false, movesLeft: 39 });
    expect(view!.moves).toHaveLength(2);
    expect(view!.moves[1]!.by).toBe('black');
    // stopping ends it; a second go is logged but does not move the schedule
    const due = app.db.getCard(thrown)!.dueAt;
    await send({ type: 'convert', action: 'resign' });
    await until(() => view?.status === 'over');
    expect(view!.result).toMatchObject({ outcome: 'gave_up' });
    expect(app.db.attemptsOf(thrown).map((a) => a.again)).toEqual([false, true]);
    expect(app.db.getCard(thrown)!.dueAt).toBe(due);

    // a stalemate is a draw, and a draw is not a win
    const stale = drill('7k/8/5K2/8/8/8/8/6Q1 w - - 0 1');
    await send({ type: 'convert', action: 'next' });
    expect(view!.id).toBe(stale);
    await send({ type: 'convert', action: 'move', from: 'g1', to: 'g6' });
    expect(view).toMatchObject({ status: 'over', result: { outcome: 'drawn', text: 'A draw (stalemate): the win slipped away.' } });
    await send({ type: 'convert', action: 'close' });
  });

  it('still winning at the move limit: the win was kept, which comes back sooner than a mate', async () => {
    const changes: ConvertView[] = [];
    const trainer = new ConvertTrainer({
      db: app.db,
      facts: app.facts,
      engine: app.engine,
      storedUnderData: true,
      onChange: () => changes.push(trainer.view),
      schedule: () => ({ reviewCap: 30, maxDays: 180 }),
      guard: () => null,
      nodes: () => 200_000,
      maxMoves: () => 1,
    });
    const id = drill('4k3/8/2n5/8/8/8/8/3QK3 w - - 0 1');
    expect(trainer.next()).toEqual({ ok: true });
    await trainer.move('d1', 'd2');
    expect(trainer.view).toMatchObject({ status: 'over', result: { outcome: 'kept', text: 'Still winning after 1 of your moves: you kept the win, but it is not finished yet.' } });
    expect(app.db.attemptsOf(id)).toMatchObject([{ result: 'solved', misses: 1 }]);
    expect(days(id)).toBeGreaterThan(0.99);
  });

  it('a game that was won and then drawn gives a drill from before the move that threw it', async () => {
    await send({ type: 'setting', key: 'review.ownFirst', value: false });
    await send({ type: 'setting', key: 'puzzles.fromGames', value: true });
    app.settings.set('content.gateNodes', 500_000);
    // after 1.f3 e5 2.g4 Black (the owner) has mate with Qh4, and plays 2...d6; after 3.Nc3 it is mate in one again,
    // and 3...Nc6 misses it again. Black stays clearly better after each, so no move threw the win: the drill
    // starts from the last clearly won position, and says what was played there
    await send({ type: 'library', action: 'import', text: '[White "x"]\n[Black "Owner"]\n[Result "1/2-1/2"]\n\n1. f3 e5 2. g4 d6 3. Nc3 Nc6 1/2-1/2' });
    const gameId = app.session.state.game!.id;
    if (app.session.state.orientation !== 'black') await send({ type: 'flip' });
    await send({ type: 'library', action: 'analyse' });
    await until(() => app.db.recentEvents('convert_made', 1).length > 0, 120_000);
    const made = JSON.parse(app.db.recentEvents('convert_made', 1)[0]!.data) as { game: number; ids: number[] };
    expect(made.game).toBe(gameId);
    expect(made.ids).toHaveLength(1);
    const item = app.db.getContent(made.ids[0]!)!;
    expect(item).toMatchObject({ type: 'convert', status: 'live', source: `game:${gameId}#6`, body: { game: { outcome: 'draw', played: 'Nc6' } } });
    expect((item.body as unknown as ConvertItem).game.threw).toBeUndefined();
    expect((item.body as unknown as ConvertItem).fen).toMatch(/^rnbqkbnr\/ppp2ppp\/3p4\/4p3\/6P1\/2N2P2\/PPPPP2P\/R1BQKBNR b /);
    expect((item.body as unknown as ConvertItem).chances).toBeGreaterThanOrEqual(80);
    // removing the game removes its drill
    await send({ type: 'library', action: 'remove', id: gameId });
    expect(app.db.listContent({ type: 'convert', limit: 100 }).filter((x) => x.source.startsWith(`game:${gameId}#`))).toEqual([]);
  });
});

// PLAN WP 6.11: the drill coach on the Puzzles tab, with a scripted coach. It is woken by a miss
// and by "Ask the coach", never gives a puzzle away while the owner solves, never names the idea
// of a mixed set, and is never woken during a speed run.
describe('the drill coach (scripted coach, real engine)', () => {
  let dir: string;
  let app: App;
  let coach: ScriptedCoach;
  let transports = 0;
  let puzzle: PuzzleView | null = null;
  const messages: CoachMessage[] = [];
  const client = {
    send: (m: ServerMsg) => {
      if (m.type === 'puzzle') puzzle = m.view;
      if (m.type === 'coach_msg') messages.push(m.message);
    },
  };
  const send = (m: Parameters<App['onClientMessage']>[1]) => app.onClientMessage(client, m);
  const until = async (test: () => boolean, ms = 60_000) => {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 > ms) throw new Error('timed out waiting');
      await sleep(20);
    }
  };
  const seen = (kind: string) => coach.seen.filter((e) => e.event === kind);

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-drill-'));
    // a small puzzle database for the mixed set and the speed run: the fixed sample the motif tests use
    const sample = JSON.parse(readFileSync(path.join(config.repoRoot, 'packages', 'core', 'test', 'fixtures', 'puzzles', 'sample.json'), 'utf8')) as { pool: { id: string; fen: string; moves: string[]; rating: number; themes: string[] }[] };
    const csv = ['PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags', ...sample.pool.map((r) => [r.id, r.fen, r.moves.join(' '), r.rating, 80, 90, 500, r.themes.join(' '), 'https://lichess.org/x', ''].join(','))].join('\n');
    writeFileSync(path.join(dir, 'sample.csv'), csv);
    installPuzzles(path.join(dir, 'sample.csv'), path.join(dir, 'puzzles.sqlite'));
    app = new App({
      repoRoot: config.repoRoot,
      dataDir: dir,
      stockfish: config.stockfish,
      syzygy: config.syzygy,
      claudePath: 'unused',
      openingsDir: config.openingsDir,
      mcpUrl: 'http://127.0.0.1:1/mcp',
      cloud: null,
      puzzleNoDelay: true,
      puzzleDbFile: path.join(dir, 'puzzles.sqlite'),
      makeTransport: (events) => {
        transports++;
        coach = new ScriptedCoach(events);
        coach.app = app;
        return coach;
      },
    });
    app.engine.signature = 'test';
    app.addClient(client);
    app.settings.set('content.gateNodes', 500_000);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a miss and a request wake it; while the owner solves it may not give the moves away; once over, it may', async () => {
    // a back-rank mate from one of the owner's games: their rook comes to a8, and Rd8+ wins
    const id = app.db.saveContent('game:900#11', { type: 'puzzle_game', status: 'live', source: 'game:900#11', licence: 'own', level: '400–700', gates: [], body: { fen: '1r4k1/5ppp/8/8/8/8/3R1PPP/3R2K1 b - - 0 1', setup: 'Ra8', solution: ['Rd8+', 'Rxd8', 'Rxd8#'], themes: ['backRankMate'], kind: 'mistake' } });
    await send({ type: 'coach', action: 'start' });
    expect(transports).toBe(1);
    // on the Puzzles tab the coach that is on becomes the drill coach
    await send({ type: 'mode', mode: 'puzzles' });
    expect(transports).toBe(2);
    await until(() => puzzle?.id === id && puzzle.yourTurn);

    // a miss: the event has the engine's verdict on the move tried, and says the moves are the owner's to find
    coach.steps.push(async (a, ev) => {
      const r = await a.tools.say({ seq: ev.seq, kind: 'question', expect: 'move', text: `After {m:${ev.theMoveTried.move}}, what could they do?`, claims: [ev.theMoveTried.cite] });
      expect(r.ok).toBe(true);
    });
    await send({ type: 'puzzle', action: 'move', from: 'h2', to: 'h3' });
    await until(() => seen('drill_miss').length === 1 && messages.some((m) => m.drill === id));
    expect(seen('drill_miss')[0]).toMatchObject({ mode: 'puzzles', puzzle: { solving: true, youMayNameTheMoves: false, youMayNameTheIdea: true, lastMove: 'Ra8 (theirs)' }, theMoveTried: { move: 'h3' } });
    expect(seen('drill_miss')[0]!.facts.facts.length).toBeGreaterThan(0);
    expect(messages.find((m) => m.drill === id)).toMatchObject({ from: 'coach', kind: 'question' });

    // asking the coach: a hint rung, in its words. The move, the answer, and checking the move are all refused
    const tried: { what: string; ok: boolean; problems?: string[] }[] = [];
    coach.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'drill_ask', giveNow: 'question' });
      for (const [what, call] of [
        ['names the move', () => a.tools.say({ seq: ev.seq, kind: 'nudge', text: 'Try {m:Rd8+}.' })],
        ['gives the answer', () => a.tools.say({ seq: ev.seq, kind: 'answer', text: 'Look at your rooks.' })],
        ['checks the move', () => a.tools.check_move({ move: 'Rd8+' })],
        ['draws on the board', () => a.tools.annotate({ seq: ev.seq, show: 'threats' })],
        ['asks', () => a.tools.say({ seq: ev.seq, kind: 'question', text: 'What are all your checks here?' })],
      ] as const) {
        const r = await call();
        tried.push({ what, ok: r.ok !== false, problems: r.problems });
      }
    });
    await send({ type: 'puzzle', action: 'ask_coach' });
    await until(() => tried.length === 5);
    expect(tried.map((t) => [t.what, t.ok])).toEqual([
      ['names the move', false],
      ['gives the answer', false],
      ['checks the move', false],
      ['draws on the board', false],
      ['asks', true],
    ]);
    expect(tried[0]!.problems!.join(' ')).toMatch(/still solving this puzzle/);
    // asking counts as a hint
    expect(puzzle!.hints).toBe(1);

    // the answer shown: now the coach names the move and the idea, from the solution's fact
    coach.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'drill_done', how: 'the answer was shown', puzzle: { solving: false, youMayNameTheMoves: true }, solution: { firstMove: 'Rd8+' } });
      const r = await a.tools.say({ seq: ev.seq, kind: 'explain', text: `{m:Rd8+} gives check on the back rank: a back-rank mate.`, claims: [ev.solution.cite] });
      expect(r).toMatchObject({ ok: true });
    });
    await send({ type: 'puzzle', action: 'show' });
    await until(() => seen('drill_done').length === 1 && messages.filter((m) => m.drill === id).length === 3);
    expect(messages.filter((m) => m.drill === id).map((m) => m.kind)).toEqual(['question', 'question', 'explain']);
    // the end of the sitting: nothing more to play, and the coach sums it up from counts made by code
    await send({ type: 'puzzle', action: 'next' });
    await until(() => seen('drill_end').length === 1);
    expect(seen('drill_end')[0]).toMatchObject({ sitting: { puzzles: 1, solvedAlone: 0, shown: 1, ideasMet: [{ idea: 'Back-rank mate', cite: expect.stringMatching(/^P\d+\.F1$/) }], comesBack: ['1 comes back tomorrow'] } });
    // back on the analysis board, the analysis coach again
    await send({ type: 'mode', mode: 'analysis' });
    expect(transports).toBe(3);
  });

  it('a mixed set keeps the idea hidden while the owner solves; a speed run never wakes the coach', async () => {
    await send({ type: 'mode', mode: 'puzzles' });
    await send({ type: 'puzzle', action: 'set', set: { kind: 'mixed' } });
    await until(() => puzzle?.set.kind === 'mixed' && puzzle.status === 'solving' && puzzle.yourTurn);
    const item = app.db.getContent(puzzle!.id!)!;
    const idea = item.body.themes.find((t) => !['short', 'long', 'veryLong', 'middlegame', 'endgame', 'opening', 'advantage', 'crushing', 'mate', 'oneMove', 'master', 'masterVsMaster', 'superGM', 'equality'].includes(t))!;
    const said: { ok: boolean; problems?: string[] }[] = [];
    coach.steps.push(async (a, ev) => {
      expect(ev.puzzle).toMatchObject({ youMayNameTheIdea: false, ideas: 'hidden until the owner has answered' });
      said.push(await a.tools.say({ seq: ev.seq, kind: 'question', text: `Can you find the ${themeName(idea).toLowerCase()}?` }));
    });
    await send({ type: 'puzzle', action: 'ask_coach' });
    await until(() => said.length === 1);
    expect(said[0]!.ok).toBe(false);
    expect(said[0]!.problems!.join(' ')).toMatch(/mixed set: the idea is hidden/);
    await send({ type: 'puzzle', action: 'close' });

    // a streak: a wrong move ends it, and the coach hears nothing of it
    await send({ type: 'setting', key: 'puzzles.speedModes', value: true });
    const before = coach.seen.length;
    await send({ type: 'puzzle', action: 'set', set: { kind: 'streak' } });
    await until(() => app.speed.active);
    const fen = app.speed.view.fen;
    const pos = mustPosition(fen);
    const any = legalMoves(pos)[0]!;
    // a few moves, right or wrong, until the run is over
    for (let i = 0; i < 6 && app.speed.active; i++) {
      const m = legalMoves(mustPosition(app.speed.view.fen))[0]!;
      app.speed.move(m.from, m.to);
      await sleep(50);
    }
    app.speed.stop();
    await sleep(300);
    expect(any).toBeTruthy();
    expect(coach.seen.length).toBe(before);
    expect(app.speed.view).toMatchObject({ status: 'over', silent: true });
  });
});

// Found while testing WP 7.3: a game opened while another game's analysis was still stopping was never analysed.
describe('a second game opened while the first is being analysed (real engine)', () => {
  let dir: string;
  let app: App;
  let review: ReviewView | null = null;
  const client = {
    send: (m: ServerMsg) => {
      if (m.type === 'review') review = m.view;
    },
  };
  const send = (m: Parameters<App['onClientMessage']>[1]) => app.onClientMessage(client, m);

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-twogames-'));
    app = new App({ repoRoot: config.repoRoot, dataDir: dir, stockfish: config.stockfish, syzygy: config.syzygy, claudePath: 'unused', openingsDir: config.openingsDir, mcpUrl: 'http://127.0.0.1:1/mcp', cloud: null, sites: fakeSites().http, puzzleNoDelay: true, powerProbe: async () => true });
    app.engine.signature = 'test';
    app.addClient(client);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('is analysed once the first analysis has stopped', async () => {
    await send({ type: 'setting', key: 'review.ownFirst', value: false });
    await send({ type: 'setting', key: 'review.auto', value: true });
    await send({ type: 'setting', key: 'puzzles.fromGames', value: false });
    await send({ type: 'library', action: 'import', text: '[White "You"]\n[Black "x"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 1-0' });
    const first = app.session.state.game!.id;
    // the first game's analysis is under way: open another before it ends
    for (let i = 0; i < 100 && review?.status !== 'running'; i++) await sleep(10);
    await send({ type: 'library', action: 'import', text: '[White "You"]\n[Black "y"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1' });
    const second = app.session.state.game!.id;
    expect(second).not.toBe(first);
    const t0 = Date.now();
    while (!(review?.gameId === second && review.status === 'done') && Date.now() - t0 < 60_000) await sleep(50);
    expect(review).toMatchObject({ gameId: second, status: 'done' });
  });
});

// PLAN WP 7.4: the judge behind the undo offer, with the real engine.
describe("the undo offer's judge (real engine)", () => {
  let dir: string;
  let app: App;
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-undo-'));
    app = new App({ repoRoot: config.repoRoot, dataDir: dir, stockfish: config.stockfish, syzygy: config.syzygy, claudePath: 'unused', openingsDir: config.openingsDir, mcpUrl: 'http://127.0.0.1:1/mcp', cloud: null, sites: fakeSites().http });
    app.engine.signature = 'test';
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('calls a hung queen a blunder, says what it did, and asks about the step that was skipped', async () => {
    const judgeMove = (app.play as unknown as { o: { judgeMove: (fen: string, san: string, you: 'white' | 'black') => Promise<{ blunder: boolean; what: string; question: string }> } }).o.judgeMove;
    // after 1.e4 d5 the bishop on c8 sees g4: 2.Qg4 gives the queen away
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
    const bad = await judgeMove(fen, 'Qg4', 'white');
    expect(bad.blunder).toBe(true);
    expect(bad.what).toMatch(/queen/);
    expect(Object.values(STEP_QUESTION)).toContain(bad.question);
    expect(await judgeMove(fen, 'exd5', 'white')).toEqual({ blunder: false, what: '', question: '' });
  });
});

// PLAN WP 7.7: the sparring coach beside a game against a bot, with a scripted coach. It never
// suggests a move during the game, and at "silent" it is woken only when asked.
describe('the sparring coach (scripted coach, real engine)', () => {
  let dir: string;
  let app: App;
  let coach: ScriptedCoach;
  let transports = 0;
  const messages: CoachMessage[] = [];
  const client = {
    send: (m: ServerMsg) => {
      if (m.type === 'coach_msg') messages.push(m.message);
    },
  };
  const send = (m: Parameters<App['onClientMessage']>[1]) => app.onClientMessage(client, m);
  const until = async (test: () => boolean, ms = 60_000) => {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 > ms) throw new Error('timed out waiting');
      await sleep(20);
    }
  };
  const seen = (kind: string) => coach.seen.filter((e) => e.event === kind);
  // the bot plays its first legal move
  const firstMoveBot: MoveSource = {
    state: 'ready',
    probabilities: async (req) => {
      const r = playLine(req.startFen, req.moves);
      if (!r.ok) throw new Error('bad history');
      return [{ uci: legalMoves(mustPosition(r.fens.at(-1)!))[0]!.uci, p: 1 }];
    },
    stop: () => {},
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-spar-'));
    app = new App({
      repoRoot: config.repoRoot,
      dataDir: dir,
      stockfish: config.stockfish,
      syzygy: config.syzygy,
      claudePath: 'unused',
      openingsDir: config.openingsDir,
      mcpUrl: 'http://127.0.0.1:1/mcp',
      cloud: null,
      botSource: firstMoveBot,
      botNoDelay: true,
      makeTransport: (events) => {
        transports++;
        coach = new ScriptedCoach(events);
        coach.app = app;
        return coach;
      },
    });
    app.engine.signature = 'test';
    app.addClient(client);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('agrees a focus, voices the routine, may not suggest a move, helps when asked, and sums up', async () => {
    await send({ type: 'setting', key: 'play.routineOverlay', value: 'always' });
    await send({ type: 'coach', action: 'start' });
    await send({ type: 'mode', mode: 'play' });
    // on the Play tab the coach that is on becomes the sparring coach
    expect(transports).toBe(2);
    const focus: { ok: boolean }[] = [];
    coach.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'spar_start', mode: 'play', game: { ownerPlays: 'white', youMayNameTheOwnersMoves: false }, focus: { askBeforeEachMove: expect.any(String) } });
      focus.push(await a.tools.say({ seq: ev.seq, kind: 'idea', text: 'For this game, before each move, ask yourself what their last move threatens.' }));
    });
    await send({ type: 'game', action: 'start', bot: app.play.botsView().bots[0]!.id, color: 'white' });
    const gameNo = app.play.game.gameNo!;
    await until(() => focus.length === 1);
    expect(focus[0]!.ok).toBe(true);
    expect(messages.at(-1)).toMatchObject({ from: 'coach', kind: 'idea', spar: gameNo });

    // the owner's turn after the bot's reply: a move suggested is refused, the routine question is not
    const tried: { what: string; ok: boolean; problems?: string[] }[] = [];
    coach.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'spar_turn', routineQuestion: expect.any(String), game: { ownersTurn: true } });
      expect(ev.facts.facts.length).toBeGreaterThan(0);
      for (const [what, call] of [
        ['suggests a move', () => a.tools.say({ seq: ev.seq, kind: 'nudge', text: 'Try {m:Nf3} here.' })],
        ['gives an answer', () => a.tools.say({ seq: ev.seq, kind: 'answer', text: 'Develop your pieces.' })],
        ['judges a move', () => a.tools.check_move({ move: 'Nf3' })],
        ['draws on the board', () => a.tools.annotate({ seq: ev.seq, show: 'threats' })],
        ['asks', () => a.tools.say({ seq: ev.seq, kind: 'question', text: 'What are all your checks, captures and threats now?' })],
      ] as const) {
        const r = await call();
        tried.push({ what, ok: r.ok !== false, problems: r.problems });
      }
    });
    await send({ type: 'game', action: 'move', from: 'e2', to: 'e4' });
    await until(() => tried.length === 5);
    expect(tried.map((t) => [t.what, t.ok])).toEqual([
      ['suggests a move', false],
      ['gives an answer', false],
      ['judges a move', false],
      ['draws on the board', false],
      ['asks', true],
    ]);
    expect(tried[0]!.problems!.join(' ')).toMatch(/do not name or suggest a move they could play/);

    // asking: counted like a hint
    coach.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'spar_ask', giveNow: 'question', game: { helpsAsked: 1 } });
      await a.tools.say({ seq: ev.seq, kind: 'question', text: 'Which of your pieces is not protected?' });
    });
    await send({ type: 'game', action: 'ask_coach' });
    await until(() => seen('spar_ask').length === 1 && messages.filter((m) => m.spar === gameNo).length === 3);
    expect(app.play.game.helps).toBe(1);

    // the end: one line, and the review
    coach.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'spar_end', game: { playing: false, result: 'You resigned.' } });
      await a.tools.say({ seq: ev.seq, kind: 'summary', text: 'Go through it with me in the review.' });
    });
    await send({ type: 'game', action: 'resign' });
    await until(() => seen('spar_end').length === 1 && messages.filter((m) => m.spar === gameNo).length === 4);
    // none of it in the analysis thread's messages
    expect(messages.filter((m) => m.from === 'coach' && m.spar === undefined)).toEqual([]);
  });

  it('at "silent" it is woken only when asked', async () => {
    await send({ type: 'setting', key: 'coach.verbosity.spar', value: 'silent' });
    const before = coach.seen.length;
    await send({ type: 'game', action: 'start', bot: app.play.botsView().bots[0]!.id, color: 'white' });
    await send({ type: 'game', action: 'move', from: 'd2', to: 'd4' });
    await until(() => Object.keys(app.play.game.tree.nodes).length >= 3);
    await sleep(300);
    expect(coach.seen.length).toBe(before);
    coach.steps.push(async (a, ev) => {
      await a.tools.say({ seq: ev.seq, kind: 'question', text: 'What does their last move do?' });
    });
    await send({ type: 'game', action: 'ask_coach' });
    await until(() => seen('spar_ask').length === 2);
    await send({ type: 'game', action: 'resign' });
    await sleep(200);
    expect(seen('spar_end')).toHaveLength(1);
  });
});

// PLAN WP 7.8: the move to teach, from a model of human play when it runs; the engine-style bots' search.
describe('the move to teach, by people (real engine)', () => {
  let dir: string;
  let app: App;
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-people-'));
    app = new App({ repoRoot: config.repoRoot, dataDir: dir, stockfish: config.stockfish, syzygy: config.syzygy, claudePath: 'unused', openingsDir: config.openingsDir, mcpUrl: 'http://127.0.0.1:1/mcp', cloud: null, sites: fakeSites().http });
    app.engine.signature = 'test';
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('check_move asks the model, and teaches its likeliest move among the close ones', async () => {
    const asked: string[] = [];
    app.facts.humanProbs = async (fen) => {
      asked.push(fen);
      return new Map([['d2d4', 0.9], ['e2e4', 0.05]]);
    };
    const r = await app.facts.checkMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'a3', 'white');
    expect(asked).toHaveLength(1);
    expect(r.legal).toBe(true);
    if (!r.legal) return;
    // d4 when the engine counts it among its close moves; else the rule of thumb's choice
    expect(r.findable!.move === 'd4' ? r.findable!.reason : 'fallback').toMatch(/^(likely|best|fallback)$/);
    // the model is not running: the rule of thumb, as before
    app.facts.humanProbs = async () => null;
    const r2 = await app.facts.checkMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'a3', 'white');
    expect(r2.legal && r2.findable?.reason).not.toBe('likely');
  });

  it('an engine-style bot searches ten times more for every 300 points, and replies from that search', async () => {
    expect([1400, 1700, 2000].map(engineBotNodes)).toEqual([1000, 10_000, 100_000]);
    app.settings.set('play.engineBots', true);
    app.settings.set('play.thinkTime', false);
    expect(app.play.start('engine-1400', 'white')).toEqual({ ok: true });
    app.play.move('e2', 'e4');
    const t0 = Date.now();
    while (Object.keys(app.play.game.tree.nodes).length < 3 && Date.now() - t0 < 20_000) await sleep(50);
    expect(Object.keys(app.play.game.tree.nodes).length).toBe(3);
    expect(app.play.game.problem).toBeUndefined();
    app.play.fresh();
  });
});

// The endgame coach (COACH §6.9), with a scripted coach: woken by "Ask the coach" and by the end of a
// go; while the owner plays it may name none of their moves; once the go is over it explains the slip
// from the facts it was handed. Its lines carry the go's id, so the Endgames tab shows them beside it.
describe('the endgame coach (scripted coach, real engine)', () => {
  let dir: string;
  let app: App;
  let coach: ScriptedCoach;
  let transports = 0;
  const messages: CoachMessage[] = [];
  const client = {
    send: (m: ServerMsg) => {
      if (m.type === 'coach_msg') messages.push(m.message);
    },
  };
  const send = (m: Parameters<App['onClientMessage']>[1]) => app.onClientMessage(client, m);
  const until = async (test: () => boolean, ms = 60_000) => {
    const t0 = Date.now();
    while (!test()) {
      if (Date.now() - t0 > ms) throw new Error('timed out waiting');
      await sleep(20);
    }
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-endgame-'));
    app = new App({
      repoRoot: config.repoRoot,
      dataDir: dir,
      stockfish: config.stockfish,
      syzygy: config.syzygy,
      claudePath: 'unused',
      openingsDir: config.openingsDir,
      mcpUrl: 'http://127.0.0.1:1/mcp',
      cloud: null,
      makeTransport: (events) => {
        transports++;
        coach = new ScriptedCoach(events);
        coach.app = app;
        return coach;
      },
    });
    app.engine.signature = 'test';
    app.addClient(client);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('asks without naming a move while the owner plays, then explains the stalemate from the facts once it is over', async () => {
    // the position live, as the pack's gates would leave it (their test is endgames.engine.test.ts)
    const file = app.endgamePack.read();
    const p = file.positions.find((x) => x.id === 'qm-corner')!;
    const read = readEndgame(p, file.topics, 1);
    if (!read.ok) throw new Error(read.reason);
    const id = app.db.saveContent('endgame:qm-corner', { type: 'endgame', status: 'live', source: 'file:content/endgames.json#qm-corner', licence: 'project', level: '400–700', engine: 'test', gates: [], body: read.item } as ContentItem<unknown>);
    await send({ type: 'coach', action: 'start' });
    await send({ type: 'mode', mode: 'endgames' });
    // on the Endgames tab the coach that is on becomes the endgame coach
    expect(transports).toBe(2);
    await send({ type: 'endgame', action: 'start', id });
    expect(app.endgames.view).toMatchObject({ status: 'playing', id });

    // asked for help: a move named or an answer is refused; a question is accepted and shown with the go
    const tried: { what: string; ok: boolean; problems?: string[] }[] = [];
    coach.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'endgame_ask', mode: 'endgames', giveNow: 'question', go: { ending: 'Queen and king against king', goal: 'give mate', theTopic: expect.stringContaining('edge'), theIdea: null } });
      for (const [what, call] of [
        ['names a move', () => a.tools.say({ seq: ev.seq, kind: 'nudge', text: 'Play {m:Qc8#} now.' })],
        ['gives an answer', () => a.tools.say({ seq: ev.seq, kind: 'answer', text: 'Give check on the back rank.' })],
        ['asks', () => a.tools.say({ seq: ev.seq, kind: 'question', expect: 'move', text: 'Which squares can their king still go to?' })],
      ] as const) {
        const r = await call();
        tried.push({ what, ok: r.ok !== false, problems: r.problems });
      }
    });
    await send({ type: 'endgame', action: 'ask' });
    await until(() => tried.length === 3);
    expect(tried.map((t) => [t.what, t.ok])).toEqual([
      ['names a move', false],
      ['gives an answer', false],
      ['asks', true],
    ]);
    expect(tried[0]!.problems!.join(' ')).toMatch(/do not name or suggest a move they could play/);
    expect(messages.at(-1)).toMatchObject({ from: 'coach', kind: 'question', drill: id });
    expect(app.endgames.view.asked).toBe(1);

    // the slip: the coach is handed the verdicts and the facts of the stalemate, and explains from them
    const said: { ok: boolean; problems?: string[] }[] = [];
    coach.steps.push(async (a, ev) => {
      expect(ev).toMatchObject({ event: 'endgame_over', outcome: 'thrown', theSlip: { move: 'Qc7', verdict: expect.stringMatching(/miss a forced checkmate in 1/) }, theMoveThatKeptIt: { move: expect.stringMatching(/#$/) } });
      const over = (ev.afterTheSlip.facts as { id: string; type: string; text: string }[]).find((f) => f.type === 'game_over')!;
      expect(over.text).toMatch(/stalemate/);
      const kept = ev.theMoveThatKeptIt.move as string;
      said.push(await a.tools.say({ seq: ev.seq, kind: 'explain', text: `{m:Qc7} misses a forced checkmate in 1: it leaves their king no move without giving check, and that is stalemate. {m:${kept}} was checkmate.`, claims: [ev.theSlip.cite, over.id, ev.theMoveThatKeptIt.cite] }));
    });
    await send({ type: 'endgame', action: 'move', from: 'c5', to: 'c7' });
    await until(() => said.length === 1);
    expect(said[0], said[0]!.problems?.join(' | ')).toMatchObject({ ok: true });
    expect(messages.at(-1)).toMatchObject({ from: 'coach', kind: 'explain', drill: id });
    // the help asked for was counted as a hint
    expect(app.db.attemptsOf(id).at(-1)).toMatchObject({ result: 'shown', hints: 1 });
    await send({ type: 'endgame', action: 'close' });
    await send({ type: 'coach', action: 'stop' });
  }, 120_000);
});
