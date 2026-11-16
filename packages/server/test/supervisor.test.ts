import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CoachStatus } from '@chess-coach/core';
import { wakeOnMove, asksForMove } from '../src/coach/director.ts';
import { composePrompt, loadAgent } from '../src/coach/prompt.ts';
import { CoachSupervisor, type CoachEvent, type Turn } from '../src/coach/supervisor.ts';
import type { CoachTransport, TransportEvents } from '../src/coach/transport.ts';
import { Db } from '../src/db.ts';

// a coach process that does what the test tells it to
class FakeTransport implements CoachTransport {
  sent: string[] = [];
  running = false;
  events: TransportEvents;
  constructor(events: TransportEvents) {
    this.events = events;
  }
  start() {
    this.running = true;
  }
  send(text: string) {
    this.sent.push(text);
  }
  stop() {
    this.running = false;
  }
  finishTurn(isError = false) {
    this.events.result({ isError, inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0, costUsd: 0.001, apiMs: 1 });
  }
  crash() {
    this.running = false;
    this.events.exit({ code: 1, expected: false, stderr: 'boom' });
  }
}

let dir: string;
let db: Db;
let transports: FakeTransport[];
let ended: { turn: Turn; how: string }[];
let statuses: CoachStatus[];
let turnsPerSession = 40;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cc-sup-'));
  mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  mkdirSync(path.join(dir, '.claude', 'skills', 'coach-core'), { recursive: true });
  writeFileSync(path.join(dir, '.claude', 'agents', 'coach-analysis.md'), '---\nname: coach-analysis\nmodel: haiku\nskills:\n  - coach-core\n---\nYou are the coach.\n');
  writeFileSync(path.join(dir, '.claude', 'skills', 'coach-core', 'SKILL.md'), '---\nname: coach-core\ndescription: rules\n---\n# Rules\nCheck before you say it.\n');
  db = new Db(':memory:');
  transports = [];
  ended = [];
  statuses = [];
  turnsPerSession = 40;
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const make = () =>
  new CoachSupervisor({
    db,
    repoRoot: dir,
    dataDir: path.join(dir, 'data'),
    claudePath: 'unused',
    mcpUrl: 'http://127.0.0.1:1/mcp',
    agent: 'coach-analysis',
    model: () => 'haiku',
    idleStopMinutes: () => 10,
    turnsPerSession: () => turnsPerSession,
    onTurnEnd: (turn, how) => ended.push({ turn, how }),
    onStatus: (s) => statuses.push(s),
    makeTransport: (events) => {
      const t = new FakeTransport(events);
      transports.push(t);
      return t;
    },
  });
const event = (seq: number, kind: CoachEvent['kind'] = 'owner_question', needsReply = true): CoachEvent => ({ seq, kind, payload: { event: kind, seq }, needsReply, canAnswer: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the coach supervisor', () => {
  it('composes the prompt from the agent file and its skills, and writes a per-run tool token', () => {
    const agent = loadAgent(dir, 'coach-analysis');
    expect(agent).toMatchObject({ name: 'coach-analysis', model: 'haiku', skills: ['coach-core'] });
    const prompt = composePrompt(dir, agent);
    expect(prompt).toContain('You are the coach.');
    expect(prompt).toContain('Check before you say it.');
    expect(prompt).not.toContain('description: rules'); // frontmatter is not part of the instructions
    const sup = make();
    sup.start();
    expect(sup.token).toMatch(/^[0-9a-f]{48}$/);
    sup.stop();
  });

  it('sends one event at a time, in order, and loses none', () => {
    const sup = make();
    sup.start();
    sup.submit(event(1));
    sup.submit(event(2));
    sup.submit(event(3));
    const t = transports[0]!;
    expect(t.sent).toHaveLength(1);
    t.finishTurn();
    expect(t.sent).toHaveLength(2);
    t.finishTurn();
    t.finishTurn();
    expect(t.sent.map((s) => JSON.parse(s).seq)).toEqual([1, 2, 3]);
    expect(ended.map((e) => e.how)).toEqual(['done', 'done', 'done']);
    expect(sup.status.usage.turns).toBe(3);
    sup.stop();
  });

  it('lets a newer board move replace an older one that was not sent yet, but never drops a question', () => {
    const sup = make();
    sup.start();
    sup.submit(event(1, 'owner_question'));
    sup.submit(event(2, 'owner_move', false));
    sup.submit(event(3, 'owner_question'));
    sup.submit(event(4, 'owner_move', false));
    const t = transports[0]!;
    t.finishTurn();
    t.finishTurn();
    t.finishTurn();
    expect(t.sent.map((s) => JSON.parse(s).seq)).toEqual([1, 3, 4]);
    sup.stop();
  });

  it('does not start by itself: the owner starts the coach', () => {
    const sup = make();
    sup.submit(event(1));
    expect(transports).toHaveLength(0);
    expect(sup.isOn).toBe(false);
  });

  it('restarts after a crash, reports the open turn, and carries on with the queue', async () => {
    const sup = make();
    sup.start();
    sup.submit(event(1));
    sup.submit(event(2));
    transports[0]!.crash();
    expect(ended).toHaveLength(1);
    expect(ended[0]!.how).toBe('crash');
    expect(ended[0]!.turn.event.seq).toBe(1);
    expect(statuses.at(-1)!.state).toBe('retrying');
    await sleep(700);
    expect(transports).toHaveLength(2);
    expect(transports[1]!.sent.map((s) => JSON.parse(s).seq)).toEqual([2]);
    sup.stop();
  });

  it('gives up after three crashes in a minute and says so', async () => {
    const sup = make();
    sup.start();
    transports[0]!.crash();
    await sleep(700);
    transports[1]!.crash();
    await sleep(3200);
    transports[2]!.crash();
    expect(sup.isOn).toBe(false);
    expect(statuses.at(-1)!.state).toBe('error');
    expect(statuses.at(-1)!.detail).toMatch(/three times/);
  }, 10_000);

  it('rotates to a fresh session after the set number of turns', () => {
    turnsPerSession = 2;
    const sup = make();
    sup.start();
    sup.submit(event(1));
    transports[0]!.finishTurn();
    sup.submit(event(2));
    transports[0]!.finishTurn();
    sup.submit(event(3));
    expect(transports).toHaveLength(2);
    expect(transports[0]!.running).toBe(false);
    expect(transports[1]!.sent.map((s) => JSON.parse(s).seq)).toEqual([3]);
    sup.stop();
  });

  it('records each run and its usage', () => {
    const sup = make();
    sup.start();
    sup.submit(event(1));
    transports[0]!.finishTurn();
    sup.stop();
    const run = db.sql.prepare('SELECT agent, model, turns, end_reason FROM coach_runs').get() as Record<string, unknown>;
    expect(run).toMatchObject({ agent: 'coach-analysis', model: 'haiku', turns: 1, end_reason: 'owner' });
  });
});

describe('the director', () => {
  const packet = (cls: string, live = true, over?: string) => ({ over, graded: { cls, live } }) as never;
  it('stays quiet unless it is a key moment', () => {
    expect(wakeOnMove('silent', packet('blunder')).wake).toBe(false);
    expect(wakeOnMove('key_moments', packet('ok')).wake).toBe(false);
    expect(wakeOnMove('key_moments', packet('inaccuracy')).wake).toBe(false);
    expect(wakeOnMove('key_moments', packet('mistake')).wake).toBe(true);
    expect(wakeOnMove('key_moments', packet('blunder', false)).wake).toBe(false); // the game was already decided
    expect(wakeOnMove('key_moments', packet('ok', true, 'checkmate')).wake).toBe(true);
    expect(wakeOnMove('every_move', packet('ok')).wake).toBe(true);
  });
  it('recognises a request for a move, so ask-first applies', () => {
    expect(asksForMove('what should I play here?')).toBe(true);
    expect(asksForMove("what's the best move")).toBe(true);
    expect(asksForMove('why is my knight in danger?')).toBe(false);
    expect(asksForMove('what if I take the pawn?')).toBe(false);
  });
});
