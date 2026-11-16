// Endgame training (feature F2; built early at the owner's request, 2026-11-15). Two parts:
//
// The pack (content/endgames.json) goes through the gates like any content:
//   V1  a legal position, the owner to move, five pieces at most (core/endgame.ts)
//   V2  the tablebase verdict is the goal's: a win to mate or to queen, a draw to hold
//   V3  the idea passes the live validator against the position's facts
//   V6  the envelope; V8  a level band, a short idea, a topic with more than one position
// A position is gated again only when its entry, the engine or the budget changes.
//
// The trainer plays the position out against the engine, which defends with the tablebases. After
// each of the owner's moves the same search that finds the reply gives the exact verdict: a move
// that lets the win go (or loses the draw) ends the go at once, with the move that kept it (the
// engine's, D33). Mate, a queened pawn with the win kept, or a draw held for ENDGAME_HOLD_MOVES moves
// reach the goal. Scheduled with FSRS like every drill.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ENDGAME_HOLD_MOVES,
  ENDGAME_MAX_MOVES,
  RANDOM_TOPIC,
  describeMove,
  endgameTask,
  gameStatus,
  gateV6,
  gateV8Endgame,
  keepsGoal,
  legalMoves,
  mustPosition,
  parsePosition,
  plainText,
  positionKey,
  randomStart,
  readEndgame,
  statusAfter,
  uciToMove,
  validateSay,
  verdictOf,
  type Color,
  type ConceptLadder,
  type ContentItem,
  type EndgameFile,
  type EndgameItem,
  type EndgameView,
  type GateResult,
  type MoveInfo,
  type RandomStart,
  type VocabularyLevel,
} from '@chess-coach/core';
import type { Db } from './db.ts';
import { DrillDeck, type Stored } from './drill-deck.ts';
import type { EngineService } from './engine/service.ts';
import type { FactService } from './facts-service.ts';

const EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';
const LEVEL = '400–700';

export class EndgamePack {
  private readonly o: { db: Db; engine: EngineService; facts: FactService; ladder?: ConceptLadder; vocabulary: () => VocabularyLevel; nodes: () => number; autoApprove: () => boolean; file: string; log?: (msg: string) => void };

  constructor(o: EndgamePack['o']) {
    this.o = o;
  }

  read(): EndgameFile {
    return JSON.parse(readFileSync(this.o.file, 'utf8')) as EndgameFile;
  }

  /** Gate every position of the file that is new or changed; one no longer in the file is put aside. */
  async sync(force = false): Promise<{ checked: number; live: number; quarantined: number; skipped: number }> {
    const file = this.read();
    const out = { checked: 0, live: 0, quarantined: 0, skipped: 0 };
    const existing = this.o.db.contentKeys('endgame');
    for (const [order, p] of file.positions.entries()) {
      const key = `endgame:${p.id}`;
      const version = createHash('sha256').update(JSON.stringify([p, file.topics.find((t) => t.id === p.topic), this.o.engine.signature, this.o.nodes()])).digest('hex').slice(0, 16);
      const was = existing.find((e) => e.key === key);
      const before = was ? (this.o.db.getContent(was.id) as unknown as ContentItem<EndgameItem & { version?: string }>) : undefined;
      if (!force && before?.body.version === version) {
        out.skipped++;
        continue;
      }
      const item = await this.gate(p, order, file);
      this.o.db.saveContent(key, { ...item, body: { ...item.body, version } });
      out.checked++;
      if (item.status === 'quarantined') out.quarantined++;
      else if (item.status === 'live') out.live++;
      this.o.log?.(`endgame ${p.id}: ${item.status}`);
    }
    for (const e of existing) if (!file.positions.some((p) => `endgame:${p.id}` === e.key) && e.status !== 'draft') this.o.db.setContentStatus(e.id, 'draft');
    return out;
  }

  /** Every gate over one position. Nothing is stored. */
  async gate(p: EndgameFile['positions'][number], order: number, file: EndgameFile): Promise<ContentItem<EndgameItem>> {
    const read = readEndgame(p, file.topics, order);
    const base: ContentItem<EndgameItem> = { type: 'endgame', status: 'draft', source: `file:content/endgames.json#${p.id}`, licence: 'project', level: LEVEL, engine: `${this.o.engine.signature}, Syzygy 3-4-5, ${this.o.nodes()} nodes`, gates: [], body: read.ok ? read.item : ({ ...p } as EndgameItem) };
    if (!read.ok) {
      const gates: GateResult[] = [{ gate: 'V1', result: 'fail', detail: read.reason }, { gate: 'V2', result: 'n/a', detail: 'not run: the position is not usable' }];
      gates.push(gateV6(base, { storedUnderData: true, engineRan: true }));
      return { ...base, gates, status: 'quarantined' };
    }
    const item = read.item;
    const r = await this.o.engine.analyse({ fen: item.fen, nodes: this.o.nodes(), multipv: 1, pool: 'analysis' });
    const verdict = r.lines[0] ? verdictOf(r.lines[0].score) : 'unclear';
    const wants = item.goal === 'draw' ? 'draw' : 'win';
    const v2: GateResult = verdict === wants ? { gate: 'V2', result: 'pass', detail: `the tablebases say ${verdict}` } : { gate: 'V2', result: 'fail', detail: `the goal is a ${wants}, but the tablebases say ${verdict} for the side to move` };
    const v3 = await this.idea(item);
    const v8 = gateV8Endgame(item, LEVEL, file);
    const checked: ContentItem<EndgameItem> = { ...base, body: item, gates: [{ gate: 'V1', result: 'pass' }, v2, v3, v8] };
    checked.gates.push(gateV6(checked, { storedUnderData: true, engineRan: true }));
    const status = statusAfter('endgame', checked.gates) === 'quarantined' ? 'quarantined' : this.o.autoApprove() ? 'live' : 'machine-verified';
    return { ...checked, status };
  }

  /** V3: the idea through the live validator, against the facts of the position. */
  private async idea(item: EndgameItem): Promise<GateResult> {
    if (!item.idea?.trim()) return { gate: 'V3', result: 'pass', detail: 'no words to check' };
    const packet = await this.o.facts.packet({ fen: item.fen, you: item.side, deep: true });
    const v = validateSay({ kind: 'explain', text: item.idea, claims: packet.facts.map((f) => f.id) }, { fen: item.fen, you: item.side, fact: this.o.facts.fact, budgetSentences: 3, canAnswer: true, vocabulary: this.o.vocabulary(), ladder: this.o.ladder });
    return v.ok ? { gate: 'V3', result: 'pass' } : { gate: 'V3', result: 'fail', detail: `"${item.idea}": ${v.problems.map((x) => x.message).join(' ')}` };
  }
}

type Step = { fen: string; san?: string; by?: Color; lastMove?: [string, string] };

/** What the endgame coach is woken by when a go ends (COACH §6.9): the goal reached, or the owner's move that let it go. */
export type EndgameEvent = {
  kind: 'endgame_over';
  outcome: 'done' | 'thrown' | 'lost';
  text: string;
  /** the owner's move that let the goal go, and the position it was played in */
  slip?: { san: string; fenBefore: string; fenAfter: string };
  /** the engine's move that kept the goal (D33) */
  better?: string;
};

/** The go as the coach may see it: the position, the task, the moves so far, never the engine's move while the owner plays. */
export type EndgameCoachState = {
  id: number;
  fen: string;
  you: Color;
  playing: boolean;
  position: { name: string; topic: string; goal: EndgameItem['goal']; task: string; about: string; idea?: string; random?: RandomStart };
  moves: string[];
  movesLeft: number;
  result?: EndgameView['result'];
  /** the move that led to the position on the board: the coach may name it */
  lastMove?: { san: string; baseFen: string };
  /** the owner's move that let the goal go, once the go is over */
  slip?: { san: string; fenBefore: string };
  /** the owner's last move, with the position it was played in (the move that reached the goal, when it is reached) */
  ownersLast?: { san: string; fenBefore: string };
};

export class EndgameTrainer {
  view: EndgameView;
  private item: Stored<EndgameItem> | null = null;
  private steps: Step[] = [];
  private graded = false;
  private showIdea = false;
  private startedAt = 0;
  private run = 0;
  private readonly deck: DrillDeck<EndgameItem>;
  /** the random start being played (PLAN 9.3), when it is one: not a stored position, not scheduled */
  private randomKind: RandomStart | null = null;
  private randomGo = 0;
  /** times the coach was asked for help in this go (each counts as a hint) */
  private asked = 0;
  private readonly o: {
    db: Db;
    engine: Pick<EngineService, 'analyse'>;
    nodes: () => number;
    schedule: () => { reviewCap: number; maxDays: number };
    onChange: () => void;
    topics?: () => { id: string; name: string; about: string }[];
    /** the endgame coach's events */
    onEvent?: (e: EndgameEvent) => void;
    /** the chance behind random starts (seeded in tests) */
    random?: () => number;
    now?: () => Date;
  };

  constructor(o: EndgameTrainer['o']) {
    this.o = o;
    this.deck = new DrillDeck<EndgameItem>({ db: o.db, type: 'endgame', schedule: o.schedule, guard: () => null, now: o.now });
    this.view = this.idle();
  }

  /** The ladder: the topics in order, each with its positions, solved or not, due or not. */
  private ladder(): EndgameView['ladder'] {
    const items = this.o.db.listContent({ status: 'live', type: 'endgame', limit: 1000 }) as unknown as Stored<EndgameItem>[];
    const due = new Set(this.o.db.dueCards((this.o.now?.() ?? new Date()).toISOString(), ['endgame']).map((d) => d.id));
    const topics = new Map<string, EndgameView['ladder'][number]>();
    let about = new Map<string, string>();
    try {
      about = new Map((this.o.topics?.() ?? []).map((t) => [t.id, t.about]));
    } catch {
      /* the pack's file cannot be read: no descriptions */
    }
    for (const it of [...items].sort((a, b) => a.body.order - b.body.order)) {
      let t = topics.get(it.body.topic);
      if (!t) topics.set(it.body.topic, (t = { id: it.body.topic, name: it.body.topicName, about: about.get(it.body.topic) ?? '', random: RANDOM_TOPIC[it.body.topic], positions: [] }));
      t.positions.push({ id: it.id, key: it.body.id, name: it.body.name, goal: it.body.goal, solved: this.o.db.attemptsOf(it.id).some((a) => a.result === 'solved'), due: due.has(it.id) });
    }
    return [...topics.values()];
  }

  private idle(problem?: string): EndgameView {
    const counts = this.deck.counts();
    return { status: 'idle', fen: EMPTY, you: 'white', yourTurn: false, moves: [], movesLeft: 0, tries: 0, ladder: this.ladder(), ready: counts.ready, due: counts.due, problem };
  }

  private set(v: Partial<EndgameView>) {
    this.view = { ...this.view, ...v };
    this.o.onChange();
  }

  refresh() {
    this.set({ ladder: this.ladder(), ...(({ ready, due }) => ({ ready, due }))(this.deck.counts()) });
  }

  /** The next position: one due again first, then the first one not yet played, in the ladder's order. */
  next(): { ok: true } | { ok: false; reason: string } {
    const item = this.deck.pick();
    if (!item) {
      const reason = this.deck.counts().ready ? 'Nothing more today: the positions come back when they are due. Pick one from the ladder to play it again.' : 'The endgame positions are being checked: they appear here in a moment.';
      this.item = null;
      this.view = this.idle(reason);
      this.o.onChange();
      return { ok: false, reason };
    }
    return this.start(item.id);
  }

  start(id: number): { ok: true } | { ok: false; reason: string } {
    const item = this.o.db.getContent(id) as unknown as Stored<EndgameItem> | undefined;
    if (!item || item.type !== 'endgame' || item.status !== 'live') return { ok: false, reason: 'That position is not available.' };
    this.item = item;
    this.randomKind = null;
    this.graded = false;
    this.showIdea = false;
    this.begin();
    return { ok: true };
  }

  /**
   * A new start for a basic mate (PLAN 9.3): made at random, then checked like any content before it
   * is played: V1 (a legal position the tablebases cover, by construction and read back) and V2 (the
   * tablebases say White wins). Not stored and not scheduled: it is practice on top of the ladder.
   */
  async startRandom(kind: RandomStart): Promise<{ ok: true } | { ok: false; reason: string }> {
    const topicId = Object.entries(RANDOM_TOPIC).find(([, k]) => k === kind)?.[0];
    const topic = topicId ? (this.o.topics?.() ?? []).find((t) => t.id === topicId) : undefined;
    if (!topicId || !topic) return { ok: false, reason: 'There is no such ending to start.' };
    const run = ++this.run;
    this.set({ busy: true });
    for (let tries = 0; tries < 5; tries++) {
      const fen = randomStart(kind, this.o.random);
      const read = readEndgame({ id: `random-${kind}`, topic: topicId, name: 'A new position', fen, goal: 'mate' }, [topic], -1);
      if (!read.ok) continue;
      const r = await this.o.engine.analyse({ fen, nodes: this.o.nodes(), multipv: 1 });
      if (run !== this.run) return { ok: true };
      if (!r.lines[0] || verdictOf(r.lines[0].score) !== 'win') continue;
      this.randomKind = kind;
      this.randomGo++;
      this.item = { id: -this.randomGo, type: 'endgame', status: 'live', body: read.item } as unknown as Stored<EndgameItem>;
      this.graded = false;
      this.showIdea = false;
      this.begin();
      return { ok: true };
    }
    this.set({ busy: false });
    return { ok: false, reason: 'No new position could be checked just now. Try again.' };
  }

  /** The owner asked the coach for help: it counts as a hint, like the idea. */
  noteHelp() {
    if (!this.item || this.view.status !== 'playing') return;
    this.asked++;
    this.set({ asked: this.asked });
  }

  /** The go as the coach may see it (COACH §6.9). */
  coachState(): EndgameCoachState | null {
    const item = this.item;
    if (!item || this.view.status === 'idle') return null;
    const b = item.body;
    const last = this.steps[this.steps.length - 1]!;
    const prev = this.steps[this.steps.length - 2];
    const over = this.view.status === 'over';
    const lostIt = over && (this.view.result?.outcome === 'thrown' || this.view.result?.outcome === 'lost');
    const slip = lostIt ? this.lastOwnerStep() : undefined;
    const about = (() => {
      try {
        return (this.o.topics?.() ?? []).find((t) => t.id === b.topic)?.about ?? '';
      } catch {
        return '';
      }
    })();
    return {
      id: item.id,
      fen: last.fen,
      you: b.side,
      playing: this.view.status === 'playing',
      position: { name: b.name, topic: b.topicName, goal: b.goal, task: endgameTask(b.goal, b.side), about, idea: this.showIdea || over ? (b.idea ? plainText(b.idea) : undefined) : undefined, random: this.randomKind ?? undefined },
      moves: this.moves().map((m) => m.san),
      movesLeft: this.view.movesLeft,
      result: this.view.result,
      lastMove: last.san && prev ? { san: last.san, baseFen: prev.fen } : undefined,
      slip: slip ? { san: slip.san, fenBefore: slip.fenBefore } : undefined,
      ownersLast: (({ san, fenBefore }) => ({ san, fenBefore }))(this.lastOwnerStep() ?? { san: '', fenBefore: '' }),
    };
  }

  /** The owner's last move in the go, with the position it was played in. */
  private lastOwnerStep(): { san: string; fenBefore: string; fenAfter: string } | undefined {
    const side = this.item?.body.side;
    for (let i = this.steps.length - 1; i > 0; i--) {
      const st = this.steps[i]!;
      if (st.by === side && st.san) return { san: st.san, fenBefore: this.steps[i - 1]!.fen, fenAfter: st.fen };
    }
    return undefined;
  }

  private begin() {
    const item = this.item!;
    this.run++;
    this.startedAt = Date.now();
    this.asked = 0;
    this.steps = [{ fen: item.body.fen }];
    const counts = this.deck.counts();
    this.view = {
      status: 'playing',
      id: item.id,
      position: this.positionView(),
      fen: item.body.fen,
      you: item.body.side,
      yourTurn: true,
      moves: [],
      movesLeft: item.body.goal === 'draw' ? ENDGAME_HOLD_MOVES : ENDGAME_MAX_MOVES,
      tries: this.view.tries,
      ladder: this.ladder(),
      ready: counts.ready,
      due: counts.due,
      asked: 0,
    };
    this.o.onChange();
  }

  private positionView(): EndgameView['position'] {
    const b = this.item!.body;
    return { key: b.id, name: b.name, topicName: b.topicName, goal: b.goal, task: endgameTask(b.goal, b.side), idea: this.showIdea || this.view.status === 'over' ? (b.idea ? plainText(b.idea) : undefined) : undefined, hasIdea: !!b.idea, random: this.randomKind ?? undefined };
  }

  /** The idea of the position, on request (a hint). */
  idea() {
    if (!this.item) return;
    this.showIdea = true;
    this.set({ position: this.positionView() });
  }

  private moves(): EndgameView['moves'] {
    return this.steps.slice(1).map((s) => ({ san: s.san!, by: s.by! }));
  }

  private ownerMoves(): number {
    return this.steps.filter((s) => s.by === this.item!.body.side).length;
  }

  private push(info: MoveInfo) {
    this.steps = [...this.steps, { fen: info.fenAfter, san: info.san, by: info.color, lastMove: [info.from, info.to] }];
  }

  private drawnBy(fen: string): string | undefined {
    const pos = mustPosition(fen);
    const status = gameStatus(pos);
    if (status.over && !pos.isCheckmate()) return status.text;
    const key = positionKey(fen);
    if (this.steps.filter((s) => positionKey(s.fen) === key).length >= 3) return 'the same position three times';
    if (pos.halfmoves >= 100) return 'fifty moves without a capture or a pawn move';
    return undefined;
  }

  /** The owner's move; the engine's search then says whether the goal is still there, and gives the reply. */
  async move(from: string, to: string, promotion?: MoveInfo['promotion']) {
    const item = this.item;
    if (!item || this.view.status !== 'playing' || this.view.busy || !this.view.yourTurn) return;
    const b = item.body;
    const cur = this.steps[this.steps.length - 1]!;
    const pos = parsePosition(cur.fen)!;
    const options = legalMoves(pos).filter((m) => m.from === from && m.to === to);
    const mine = options.find((m) => m.promotion === (promotion ?? 'queen')) ?? options[0];
    if (!mine) return this.set({ tries: this.view.tries + 1 });
    this.push(mine);
    const after = mustPosition(mine.fenAfter);
    if (after.isCheckmate()) return this.finish('done', b.goal === 'mate' ? 'Checkmate. Well played.' : 'Checkmate: even better than the goal.');
    const run = this.run;
    this.set({ busy: true, yourTurn: false, fen: mine.fenAfter, lastMove: [mine.from, mine.to], moves: this.moves() });
    // the move that kept the goal, when the owner's did not: the engine's best from the position before (D33)
    const keptBy = async (): Promise<string | undefined> => {
      const before = await this.o.engine.analyse({ fen: cur.fen, nodes: this.o.nodes(), multipv: 1 });
      const best = before.lines[0]?.pv[0] ? uciToMove(pos, before.lines[0].pv[0]) : null;
      const san = best ? describeMove(pos, best).san : undefined;
      return san === mine.san ? undefined : san;
    };
    // a draw by the rules (stalemate, the same position three times, fifty moves) is known without a search
    const drawnNow = this.drawnBy(mine.fenAfter);
    if (drawnNow) {
      if (b.goal === 'draw') return this.finish('done', `A draw: ${drawnNow}. Held.`);
      const better = await keptBy();
      if (run !== this.run) return;
      return this.finish('thrown', `${mine.san} lets the win go: ${drawnNow}.`, better);
    }
    const r = await this.o.engine.analyse({ fen: mine.fenAfter, nodes: this.o.nodes(), multipv: 1 });
    if (run !== this.run) return;
    const line = r.lines[0];
    const theirs = line ? verdictOf(line.score) : 'unclear';
    if (!keepsGoal(b.goal, theirs)) {
      const better = await keptBy();
      if (run !== this.run) return;
      const text = b.goal === 'draw' ? `${mine.san} loses: the tablebases say they win from here.` : `${mine.san} lets the win go: the tablebases say it is a draw now.`;
      return this.finish(b.goal === 'draw' ? 'lost' : 'thrown', text, better);
    }
    if (b.goal === 'promote' && mine.promotion) return this.finish('done', `${mine.san}: the pawn is queened and the win is kept.`);
    const reply = line?.pv[0] ? uciToMove(after, line.pv[0]) : null;
    if (!reply) return this.finish('drawn', 'No reply was found.');
    const info = describeMove(after, reply);
    this.push(info);
    const next = mustPosition(info.fenAfter);
    if (next.isCheckmate()) return this.finish('lost', `${info.san} is checkmate.`);
    const drawn = this.drawnBy(info.fenAfter);
    if (drawn) return b.goal === 'draw' ? this.finish('done', `A draw: ${drawn}. Held.`) : this.finish('drawn', `A draw: ${drawn}.`);
    const made = this.ownerMoves();
    if (b.goal === 'draw' && made >= ENDGAME_HOLD_MOVES) return this.finish('done', `Held for ${made} moves: the draw is safe.`);
    if (b.goal !== 'draw' && made >= ENDGAME_MAX_MOVES) return this.finish('kept', `Still winning after ${made} moves, but not finished.`);
    this.set({ busy: false, yourTurn: true, fen: info.fenAfter, lastMove: [info.from, info.to], moves: this.moves(), movesLeft: (b.goal === 'draw' ? ENDGAME_HOLD_MOVES : ENDGAME_MAX_MOVES) - made });
  }

  resign() {
    if (!this.item || this.view.status !== 'playing') return;
    this.run++;
    void this.finish('gave_up', 'Stopped.');
  }

  retry() {
    if (!this.item) return;
    this.begin();
  }

  /** Back to the position before the owner's last move, to find the move that keeps the goal (the go is already logged and graded). */
  retryBefore() {
    const item = this.item;
    if (!item || this.view.status !== 'over') return;
    let i = this.steps.length - 1;
    while (i > 0 && this.steps[i]!.by !== item.body.side) i--;
    if (i <= 0) return this.begin();
    this.run++;
    this.startedAt = Date.now();
    this.steps = this.steps.slice(0, i);
    // the idea was shown when the go ended: it stays
    this.showIdea = true;
    const at = this.steps[this.steps.length - 1]!;
    const left = (item.body.goal === 'draw' ? ENDGAME_HOLD_MOVES : ENDGAME_MAX_MOVES) - this.ownerMoves();
    this.view = { ...this.view, status: 'playing', busy: false, yourTurn: true, fen: at.fen, lastMove: at.lastMove, moves: this.moves(), movesLeft: left, result: undefined, tries: this.view.tries + 1 };
    this.view.position = this.positionView();
    this.o.onChange();
  }

  close() {
    this.run++;
    this.item = null;
    this.randomKind = null;
    this.view = this.idle();
    this.o.onChange();
  }

  /** Over: the go is logged; the first go of a sitting moves the position on its schedule. */
  private async finish(outcome: NonNullable<EndgameView['result']>['outcome'], text: string, better?: string) {
    const item = this.item!;
    const ok = outcome === 'done';
    const hints = (this.showIdea ? 1 : 0) + this.asked;
    if (this.randomKind) {
      // a random start is practice on top of the ladder: logged, never scheduled
      this.o.db.logEvent('endgame', { random: this.randomKind, fen: item.body.fen, outcome, moves: this.ownerMoves(), hints });
    } else {
      this.o.db.addAttempt({ contentId: item.id, result: ok ? 'solved' : 'shown', hints, misses: ok ? 0 : 1, ms: Date.now() - this.startedAt, again: this.graded });
      this.o.db.logEvent('endgame', { id: item.id, key: item.body.id, outcome, moves: this.ownerMoves(), again: this.graded, hints });
      if (!this.graded) {
        this.graded = true;
        await this.deck.grade(item.id, ok ? (hints ? 'hard' : 'good') : outcome === 'kept' ? 'hard' : 'again');
        if (this.item !== item) return;
      }
    }
    const last = this.steps[this.steps.length - 1]!;
    const counts = this.deck.counts();
    this.view = { ...this.view, status: 'over', busy: false, yourTurn: false, fen: last.fen, lastMove: last.lastMove, moves: this.moves(), result: { outcome, text, better }, ladder: this.ladder(), ready: counts.ready, due: counts.due };
    this.view.position = this.positionView();
    this.o.onChange();
    // the coach (when it is on) says why the goal went, or a word for reaching it
    if (outcome === 'done' || outcome === 'thrown' || outcome === 'lost') this.o.onEvent?.({ kind: 'endgame_over', outcome, text, better, slip: outcome === 'done' ? undefined : this.lastOwnerStep() });
  }
}
