// The coach supervisor (ARCHITECTURE §5.4, feature H16): starts, watches, restarts and rotates
// the coach's session, queues events, and tracks usage. Nothing depends on the session's memory.

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CoachStatus } from '@chess-coach/core';
import type { Db } from '../db.ts';
import { composePrompt, loadAgent } from './prompt.ts';
import { HeadlessCliTransport, type CoachTransport, type TransportEvents } from './transport.ts';

/** One event for the coach (ARCHITECTURE §5.2), plus what the server tracks while it is answered. */
export type CoachEvent = {
  seq: number;
  kind: 'owner_move' | 'owner_reply' | 'owner_question' | 'owner_tries' | 'hint_request' | 'tell_me' | 'why' | 'show_me' | 'resume' | 'review_moment' | 'review_end' | 'drill_miss' | 'drill_ask' | 'drill_done' | 'drill_example' | 'drill_end' | 'spar_start' | 'spar_turn' | 'spar_blunder' | 'spar_ask' | 'spar_end' | 'opening_new' | 'opening_miss' | 'opening_why' | 'opening_question' | 'endgame_over' | 'endgame_ask';
  /** the JSON the coach receives */
  payload: Record<string, unknown>;
  /** must the owner get an answer (scripted if need be)? */
  needsReply: boolean;
  canAnswer: boolean;
  ownerText?: string;
  /** an event about one move the engine has just judged (a try on the coach's board): the facts the scripted fallback says if the coach cannot */
  scriptedFacts?: string[];
  /** an event with words of its own for the scripted fallback (a moment of a game review): said as they are when the coach cannot */
  scripted?: { kind: 'question' | 'explain' | 'summary'; text: string; claims?: string[]; expect?: 'move' | 'none'; thenShowBest?: boolean };
};

export type Turn = {
  event: CoachEvent;
  sentAt: number;
  accepted: number;
  rejects: number;
  toolCalls: number;
  fallbackSpoke: boolean;
};

export type SupervisorOptions = {
  db: Db;
  repoRoot: string;
  dataDir: string;
  claudePath: string;
  mcpUrl: string;
  /** which agent to start: its file in .claude/agents (the review has its own) */
  agent: string | (() => string);
  model: () => string;
  idleStopMinutes: () => number;
  turnsPerSession: () => number;
  /** a turn ended (or was given up on): the app decides whether the scripted fallback must speak */
  onTurnEnd: (turn: Turn, how: 'done' | 'error' | 'timeout' | 'crash') => void;
  onStatus: (status: CoachStatus) => void;
  /** tests swap the real CLI for a fake */
  makeTransport?: (events: TransportEvents, files: { promptFile: string; mcpConfigFile: string; model: string }) => CoachTransport;
  log?: (msg: string) => void;
};

const TURN_TIMEOUT_MS = 90_000;

export class CoachSupervisor {
  status: CoachStatus = { state: 'off', usage: { turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }, firstTry: { ok: 0, total: 0 } };
  /** the per-run token the coach's tool calls must carry */
  token = '';
  private transport: CoachTransport | null = null;
  private queue: CoachEvent[] = [];
  private turn: Turn | null = null;
  private runId: number | null = null;
  private turnsThisRun = 0;
  private lastCost = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private turnTimer: NodeJS.Timeout | null = null;
  private crashes: number[] = [];
  private wanted = false; // the owner wants the coach on
  private readonly o: SupervisorOptions;
  private log: (msg: string) => void;

  constructor(opts: SupervisorOptions) {
    this.o = opts;
    this.log = opts.log ?? (() => {});
    const stats = opts.db.messageStats();
    this.status.firstTry = { ok: stats.ok, total: stats.total };
  }

  get currentTurn(): Turn | null {
    return this.turn;
  }

  get currentRun(): number | null {
    return this.runId;
  }

  get isOn(): boolean {
    return this.wanted;
  }

  private setStatus(patch: Partial<CoachStatus>) {
    this.status = { ...this.status, ...patch };
    this.o.onStatus(this.status);
  }

  noteFirstTry(ok: boolean) {
    this.status.firstTry = { ok: this.status.firstTry.ok + (ok ? 1 : 0), total: this.status.firstTry.total + 1 };
  }

  private agentName(): string {
    return typeof this.o.agent === 'function' ? this.o.agent() : this.o.agent;
  }

  /** The owner pressed "Start coach" (or asked a question with the coach off). */
  start(): void {
    this.wanted = true;
    if (this.transport) return;
    this.spawn();
  }

  private spawn() {
    const model = this.o.model();
    let promptFile: string;
    let mcpConfigFile: string;
    try {
      const runDir = path.join(this.o.dataDir, 'coach-run');
      mkdirSync(runDir, { recursive: true });
      const agent = loadAgent(this.o.repoRoot, this.agentName());
      promptFile = path.join(runDir, `${agent.name}.prompt.md`);
      writeFileSync(promptFile, composePrompt(this.o.repoRoot, agent));
      this.token = randomBytes(24).toString('hex');
      mcpConfigFile = path.join(runDir, 'mcp.json');
      writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers: { chess: { type: 'http', url: this.o.mcpUrl, headers: { Authorization: `Bearer ${this.token}` } } } }));
    } catch (e) {
      this.wanted = false;
      this.setStatus({ state: 'error', detail: `could not prepare the coach: ${(e as Error).message}` });
      return;
    }
    // a process that has been replaced must not be able to end the new one's turn
    let mine: CoachTransport | null = null;
    const current = () => mine !== null && this.transport === mine;
    const events: TransportEvents = {
      init: (info) => {
        if (!current()) return;
        if (!info.mcpConnected) {
          this.setStatus({ state: 'error', model: info.model, detail: 'the coach started but could not reach its chess tools' });
          return;
        }
        this.log(`coach ready: ${info.model}, ${info.tools.length} tools`);
        this.setStatus({ state: this.turn ? 'thinking' : 'ready', model: info.model, detail: undefined });
      },
      retry: (detail) => {
        if (current()) this.setStatus({ state: 'retrying', detail });
      },
      text: (text) => this.log(`coach said outside a tool (not shown): ${text.slice(0, 200)}`),
      toolUse: () => {
        if (current() && this.turn) this.turn.toolCalls++;
      },
      result: (r) => {
        if (current()) this.onResult(r);
      },
      exit: (info) => {
        if (current()) this.onExit(info);
      },
    };
    this.setStatus({ state: 'starting', model, detail: undefined });
    this.runId = this.o.db.startRun(this.agentName(), model);
    this.turnsThisRun = 0;
    this.lastCost = 0;
    this.transport = this.o.makeTransport
      ? this.o.makeTransport(events, { promptFile, mcpConfigFile, model })
      : new HeadlessCliTransport({ claudePath: this.o.claudePath, cwd: this.o.repoRoot, model, systemPromptFile: promptFile, mcpConfigFile, events });
    mine = this.transport;
    try {
      this.transport.start();
    } catch (e) {
      this.transport = null;
      this.wanted = false;
      this.setStatus({ state: 'error', detail: `could not start the coach: ${(e as Error).message}` });
      return;
    }
    this.armIdle();
    this.pump();
    // the CLI reports "init" only when its first message arrives, so a coach that was started
    // without a question would sit on "starting": if the process is up, it is ready
    const started = this.transport;
    setTimeout(() => {
      if (this.transport === started && started.running && this.status.state === 'starting' && !this.turn) this.setStatus({ state: 'ready', model, detail: undefined });
    }, 900).unref?.();
  }

  /** The owner pressed "Stop coach", or the session is being rotated or has idled out. */
  stop(reason: 'owner' | 'idle' | 'rotate' | 'model' = 'owner') {
    if (reason === 'owner') this.wanted = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    const t = this.transport;
    this.transport = null;
    if (this.runId !== null) this.o.db.endRun(this.runId, reason);
    this.runId = null;
    const open = this.turn;
    this.turn = null;
    if (reason === 'owner') this.queue = [];
    t?.stop();
    if (open) this.o.onTurnEnd(open, 'crash');
    if (reason === 'idle') {
      this.wanted = false;
      this.setStatus({ state: 'off', detail: 'Stopped after a quiet spell. It starts again when you ask something.' });
    } else if (reason === 'owner') this.setStatus({ state: 'off', detail: undefined });
  }

  /** Restart with the current settings (used when the model setting changes). */
  restart() {
    if (!this.transport) return;
    this.stop('model');
    this.spawn();
  }

  private armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop('idle'), this.o.idleStopMinutes() * 60_000);
    this.idleTimer.unref?.();
  }

  /** Hand an event to the coach. Starts it if the owner wants it on. Newer board moves replace older unsent ones. */
  submit(event: CoachEvent) {
    if (event.kind === 'owner_move') this.queue = this.queue.filter((e) => e.kind !== 'owner_move');
    this.queue.push(event);
    if (!this.transport && this.wanted) this.spawn();
    else this.pump();
  }

  private pump() {
    if (!this.transport || this.turn || !this.queue.length) return;
    if (this.turnsThisRun >= this.o.turnsPerSession()) {
      // rotation: a fresh session before the next event
      this.log('rotating the coach session');
      this.stop('rotate');
      this.spawn();
      return;
    }
    const event = this.queue.shift()!;
    this.turn = { event, sentAt: Date.now(), accepted: 0, rejects: 0, toolCalls: 0, fallbackSpoke: false };
    try {
      this.transport.send(JSON.stringify(event.payload));
    } catch {
      const turn = this.turn;
      this.turn = null;
      this.o.onTurnEnd(turn, 'crash');
      return;
    }
    if (this.status.state !== 'starting') this.setStatus({ state: 'thinking', detail: undefined });
    this.armIdle();
    this.turnTimer = setTimeout(() => this.onTimeout(), TURN_TIMEOUT_MS);
    this.turnTimer.unref?.();
  }

  private endTurn(how: 'done' | 'error' | 'timeout' | 'crash') {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    const turn = this.turn;
    this.turn = null;
    if (turn) this.o.onTurnEnd(turn, how);
  }

  private onResult(r: Parameters<TransportEvents['result']>[0]) {
    this.turnsThisRun++;
    const u = this.status.usage;
    const costDelta = Math.max(0, r.costUsd - this.lastCost);
    this.lastCost = r.costUsd;
    this.status.usage = {
      turns: u.turns + 1,
      inputTokens: u.inputTokens + r.inputTokens + r.cacheWriteTokens,
      outputTokens: u.outputTokens + r.outputTokens,
      cacheReadTokens: u.cacheReadTokens + r.cacheReadTokens,
      costUsd: u.costUsd + costDelta,
    };
    if (this.runId !== null) this.o.db.addRunUsage(this.runId, { input: r.inputTokens + r.cacheWriteTokens, output: r.outputTokens, cacheRead: r.cacheReadTokens, cost: r.costUsd });
    this.endTurn(r.isError ? 'error' : 'done');
    this.setStatus({ state: 'ready', detail: r.isError ? 'the last turn ended with an error' : undefined });
    this.pump();
  }

  private onTimeout() {
    this.log('coach turn timed out; restarting the session');
    const t = this.transport;
    this.transport = null;
    if (this.runId !== null) this.o.db.endRun(this.runId, 'timeout');
    this.runId = null;
    this.endTurn('timeout');
    t?.stop();
    if (this.wanted) this.spawn();
  }

  private onExit(info: { code: number | null; expected: boolean; stderr: string }) {
    if (info.expected || !this.transport) return; // we stopped it ourselves
    this.transport = null;
    if (this.runId !== null) this.o.db.endRun(this.runId, 'crash');
    this.runId = null;
    const hadTurn = this.turn?.event;
    this.endTurn('crash');
    const now = Date.now();
    this.crashes = [...this.crashes.filter((t) => now - t < 60_000), now];
    const detail = info.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300) || `exit code ${info.code}`;
    this.log(`coach process ended unexpectedly: ${detail}`);
    if (!this.wanted) return;
    if (this.crashes.length >= 3) {
      this.wanted = false;
      this.setStatus({ state: 'error', detail: `The coach stopped three times in a minute and was left off. Last error: ${detail}` });
      return;
    }
    this.setStatus({ state: 'retrying', detail: 'the coach stopped; starting it again' });
    const delay = this.crashes.length === 1 ? 500 : 3000;
    setTimeout(() => {
      if (!this.wanted || this.transport) return;
      // the event that was being answered already got the scripted fallback; carry on with the queue
      void hadTurn;
      this.spawn();
    }, delay).unref?.();
  }
}
