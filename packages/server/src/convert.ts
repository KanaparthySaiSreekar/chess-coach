// Win-the-won-game drills (feature C9; PLAN WP 6.8). One drill a game the owner did not win but
// was clearly winning in: the position before the move that threw the win away (or their last
// clearly won position), checked again by the engine when it is made. The owner plays it out
// against Stockfish. Every move of theirs is searched: the same search that finds the engine's
// reply says whether the win is still there. Checkmate converts it; a draw, or a move that takes
// their chances below THROWN_BELOW, ends it (with check_move's verdict on that move); still winning
// after `conversion.maxMoves` of their moves, the win was kept but not finished.

import {
  conversionStart,
  convertWords,
  describeMove,
  gameStatus,
  gateV1Convert,
  gateV6,
  legalMoves,
  mustPosition,
  parsePosition,
  positionKey,
  THROWN_BELOW,
  uciToMove,
  winChance,
  type Color,
  type ContentItem,
  type ConvertItem,
  type ConvertView,
  type GamePly,
  type MoveInfo,
  type Outcome,
} from '@chess-coach/core';
import type { Db } from './db.ts';
import { DrillDeck, type Stored } from './drill-deck.ts';
import type { EngineService } from './engine/service.ts';
import type { FactService } from './facts-service.ts';
import { moveVerdict } from './safety.ts';

const EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';

type Step = { fen: string; san?: string; by?: Color; lastMove?: [string, string] };
type Ending = NonNullable<ConvertView['result']>['outcome'];

export type ConvertOptions = {
  db: Db;
  facts: FactService;
  engine: Pick<EngineService, 'analyse'>;
  storedUnderData: boolean;
  onChange: () => void;
  schedule: () => { reviewCap: number; maxDays: number };
  /** fair play: is this position off limits? */
  guard: (fens: string[]) => string | null;
  /** how hard the engine defends: nodes a move (`conversion.engineNodes`) */
  nodes: () => number;
  /** the owner's moves before a drill stops (`conversion.maxMoves`) */
  maxMoves: () => number;
  /**
   * Who defends (`conversion.defender`, WP 6.8's open item): the engine (null), or a human-like defender,
   * Maia at the owner's level, whose move (UCI) is asked for here. The engine's search still says whether
   * the win is there after every move; only the reply comes from the defender.
   */
  defender?: () => ((fen: string) => Promise<string | null>) | null;
  now?: () => Date;
};

export class ConvertTrainer {
  view: ConvertView;
  private item: Stored<ConvertItem> | null = null;
  /** the start, then the position after each move of the drill */
  private steps: Step[] = [];
  /** the first go at a drill moves its schedule; a second go is logged only */
  private graded = false;
  private startedAt = 0;
  /** goes up on every start, retry and close, so a search that comes back late is dropped */
  private run = 0;
  private readonly deck: DrillDeck<ConvertItem>;
  private readonly o: ConvertOptions;

  constructor(o: ConvertOptions) {
    this.o = o;
    this.deck = new DrillDeck<ConvertItem>({ db: o.db, type: 'convert', schedule: o.schedule, guard: o.guard, now: o.now });
    this.view = this.idle();
  }

  private idle(problem?: string): ConvertView {
    return { status: 'idle', fen: EMPTY, you: 'white', yourTurn: false, moves: [], movesLeft: 0, tries: 0, again: false, ...this.deck.counts(), problem };
  }

  private set(view: Partial<ConvertView>) {
    this.view = { ...this.view, ...view };
    this.o.onChange();
  }

  /** Make the drill of a game, if the owner was clearly winning in it and did not win. Returns the id when it went live. */
  async fromGame(gameId: number, plies: GamePly[], you: Color, outcome: Outcome | undefined): Promise<number[]> {
    const start = conversionStart(plies, you, outcome);
    if (!start || (outcome !== 'draw' && outcome !== 'loss')) return [];
    // checked again at the drill's own search: is it still clearly winning?
    const r = await this.o.engine.analyse({ fen: start.ply.fenBefore, nodes: this.o.nodes(), multipv: 1 });
    const line = r.lines[0];
    if (!line) return [];
    const body: ConvertItem = { fen: start.ply.fenBefore, chances: Math.round(winChance(line.score) * 10) / 10, game: { outcome, played: start.ply.san, threw: start.threw } };
    const item: ContentItem<ConvertItem> = { type: 'convert', status: 'draft', source: `game:${gameId}#${start.ply.ply}`, licence: 'own', level: '400–700', engine: 'Stockfish: the start checked as clearly winning; the play judged move by move', gates: [], body };
    const gates = [gateV1Convert(body), gateV6(item, { storedUnderData: this.o.storedUnderData, engineRan: true })];
    const saved = this.deck.save(`game:${gameId}#${start.ply.ply}|convert`, item, gates);
    this.refresh();
    return saved.status === 'live' ? [saved.id] : [];
  }

  /** The next drill: what is due again first, then one never played. */
  next(): { ok: true } | { ok: false; reason: string } {
    const item = this.deck.pick();
    if (!item) {
      this.run++;
      this.item = null;
      this.view = this.idle(this.deck.counts().ready ? 'Nothing more to play today.' : 'These come from your own games that you were clearly winning and did not win: go through one of your games first.');
      this.o.onChange();
      return { ok: false, reason: this.view.problem! };
    }
    this.item = item;
    this.graded = false;
    this.begin([{ fen: item.body.fen }], false);
    return { ok: true };
  }

  private ownerMoves(steps = this.steps): number {
    const you = parsePosition(steps[0]!.fen)!.turn;
    return steps.filter((s) => s.by === you).length;
  }

  private begin(steps: Step[], again: boolean) {
    const item = this.item!;
    this.run++;
    this.startedAt = Date.now();
    this.steps = steps;
    const last = steps[steps.length - 1]!;
    this.view = {
      status: 'playing',
      id: item.id,
      fen: last.fen,
      lastMove: last.lastMove,
      you: parsePosition(item.body.fen)!.turn,
      yourTurn: true,
      moves: this.moves(),
      movesLeft: Math.max(0, this.o.maxMoves() - this.ownerMoves(steps)),
      tries: 0,
      game: item.body.game,
      again,
      ...this.deck.counts(),
    };
    this.o.onChange();
  }

  private moves(): ConvertView['moves'] {
    return this.steps.slice(1).map((s) => ({ san: s.san!, by: s.by! }));
  }

  /** The same position a third time, or fifty moves of each side without a capture or a pawn move. */
  private drawnBy(fen: string): string | undefined {
    const pos = mustPosition(fen);
    const status = gameStatus(pos);
    if (status.over && !pos.isCheckmate()) return status.text;
    const key = positionKey(fen);
    if (this.steps.filter((s) => positionKey(s.fen) === key).length >= 3) return 'the same position three times';
    if (pos.halfmoves >= 100) return 'fifty moves without a capture or a pawn move';
    return undefined;
  }

  private push(info: MoveInfo) {
    this.steps = [...this.steps, { fen: info.fenAfter, san: info.san, by: info.color, lastMove: [info.from, info.to] }];
  }

  /** The owner's move; then the engine's search, which says whether the win is still there and gives the reply. */
  async move(from: string, to: string, promotion?: MoveInfo['promotion']) {
    const item = this.item;
    if (!item || this.view.status !== 'playing' || this.view.busy || !this.view.yourTurn) return;
    const cur = this.steps[this.steps.length - 1]!;
    const pos = parsePosition(cur.fen)!;
    const options = legalMoves(pos).filter((m) => m.from === from && m.to === to);
    const mine = options.find((m) => m.promotion === (promotion ?? 'queen')) ?? options[0];
    if (!mine) return this.set({ tries: this.view.tries + 1 });
    this.push(mine);
    const after = mustPosition(mine.fenAfter);
    if (after.isCheckmate()) return this.finish('converted');
    const draw = this.drawnBy(mine.fenAfter);
    if (draw) return this.finish('drawn', { draw });
    const run = this.run;
    this.set({ busy: true, yourTurn: false, fen: mine.fenAfter, lastMove: [mine.from, mine.to], moves: this.moves() });
    const r = await this.o.engine.analyse({ fen: mine.fenAfter, nodes: this.o.nodes(), multipv: 1 });
    if (run !== this.run) return;
    const line = r.lines[0];
    // the score is the engine's side's: the owner's chances are the rest
    const chances = line ? 100 - winChance(line.score) : 100;
    if (chances < THROWN_BELOW) {
      const verdict = await moveVerdict(this.o.facts, cur.fen, mine.san);
      if (run !== this.run) return;
      return this.finish('thrown', { throwMove: { san: mine.san, why: verdict?.why ?? '' } });
    }
    // the reply: the human-like defender's when it is chosen (falling back on the engine's), else the engine's
    const human = this.o.defender?.();
    const humanUci = human ? await human(mine.fenAfter).catch(() => null) : null;
    if (run !== this.run) return;
    const reply = (humanUci ? uciToMove(after, humanUci) : null) ?? (line?.pv[0] ? uciToMove(after, line.pv[0]) : null);
    if (!reply) return this.finish('drawn', { draw: 'no reply was found' });
    const theirs = describeMove(after, reply);
    this.push(theirs);
    const next = mustPosition(theirs.fenAfter);
    if (next.isCheckmate()) return this.finish('thrown', { throwMove: { san: mine.san, why: `${theirs.san} is checkmate.` } });
    const drawn = this.drawnBy(theirs.fenAfter);
    if (drawn) return this.finish('drawn', { draw: drawn });
    const left = this.o.maxMoves() - this.ownerMoves();
    if (left <= 0) return this.finish('kept');
    this.set({ busy: false, yourTurn: true, fen: theirs.fenAfter, lastMove: [theirs.from, theirs.to], moves: this.moves(), movesLeft: left });
  }

  /** The owner stops. */
  resign() {
    if (!this.item || this.view.status !== 'playing') return;
    this.run++;
    void this.finish('gave_up');
  }

  /** Over: record the go and, the first time, move the drill on its schedule (converted → good, kept → hard, else again). */
  private async finish(outcome: Ending, extra: { draw?: string; throwMove?: { san: string; why: string } } = {}) {
    const item = this.item!;
    const moves = this.ownerMoves();
    const result = { outcome, text: convertWords(outcome, { moves, draw: extra.draw }), throwMove: extra.throwMove };
    const won = outcome === 'converted' || outcome === 'kept';
    this.o.db.addAttempt({ contentId: item.id, result: won ? 'solved' : 'shown', hints: 0, misses: outcome === 'converted' ? 0 : 1, ms: Date.now() - this.startedAt, again: this.graded });
    this.o.db.logEvent('convert', { id: item.id, outcome, moves, again: this.graded });
    let comesBack = this.view.comesBack;
    if (!this.graded) {
      this.graded = true;
      comesBack = (await this.deck.grade(item.id, outcome === 'converted' ? 'good' : outcome === 'kept' ? 'hard' : 'again')).dueAt;
      if (this.item !== item) return;
    }
    const last = this.steps[this.steps.length - 1]!;
    this.set({ status: 'over', busy: false, yourTurn: false, fen: last.fen, lastMove: last.lastMove, moves: this.moves(), result, comesBack, ...this.deck.counts() });
  }

  /** Again from the start. */
  retryStart() {
    if (!this.item || this.view.status !== 'over') return;
    this.begin([{ fen: this.item.body.fen }], true);
  }

  /** Again from just before the move that threw the win away. */
  retryBefore() {
    if (!this.item || this.view.status !== 'over' || this.view.result?.outcome !== 'thrown') return;
    const you = this.view.you;
    // back to the last position with the owner to move, before their throwing move
    let i = this.steps.length - 1;
    while (i > 0 && this.steps[i]!.by !== you) i--;
    this.begin(this.steps.slice(0, Math.max(1, i)), true);
  }

  close() {
    this.run++;
    this.item = null;
    this.view = this.idle();
    this.o.onChange();
  }

  refresh() {
    this.view = { ...this.view, ...this.deck.counts() };
    this.o.onChange();
  }
}

