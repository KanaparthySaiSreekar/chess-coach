// Games against the bots (features A5, F4, F9; PLAN Phase 7, WP 7.2–7.3, built early: D42).
//
// A game has its own board, kept apart from the analysis board, so starting a game never touches
// what the owner was analysing. While a game is being played nothing from the engine is shown
// and the coach stays quiet: the owner thinks for themselves. When it ends, the game can be sent
// to the analysis board, where the eval bar, the labels and the coach take over.

import { existsSync, readFileSync } from 'node:fs';
import {
  START_FEN,
  addMove,
  clockAfterMove,
  clockLeft,
  clockStopped,
  newClock,
  miniGoalText,
  miniProblem,
  miniVerdict,
  promptAt,
  routinePrompt,
  deleteNode,
  exportPgn,
  mainlineEnd,
  mustPosition,
  newTree,
  opposite,
  pathTo,
  positionKey,
  type BotView,
  type BotsView,
  type Color,
  type GameResult,
  type GameView,
  type NodeId,
  type MiniGame,
  type RoutineLevel,
  type SkippedStep,
  type TimeControl,
} from '@chess-coach/core';
import { legalOnly, sampleMove, type MoveSource, type Sampling } from './bots/service.ts';
import type { Db } from './db.ts';
import type { Settings } from './settings.ts';

export type BotDef = BotView & { temperature: number; topP: number };

/** The mini-games (content/minigames.json): only the ones with a legal position and a goal that can be reached. */
export function loadMinis(file: string, log: (msg: string) => void = () => {}): MiniGame[] {
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { games?: MiniGame[] };
  return (raw.games ?? []).filter((m) => {
    const problem = miniProblem(m);
    if (problem) log(`mini-game left out: ${problem}`);
    return !problem;
  });
}

/** The roster file (content/bots.json): the bots, each with its band's note. */
export function loadRoster(file: string): BotDef[] {
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { bands?: Record<string, string>; bots?: (Omit<BotDef, 'about'> & { about?: string })[] };
  const out: BotDef[] = [];
  for (const b of raw.bots ?? []) {
    if (!b.id || !b.name || !Number.isFinite(b.elo)) continue;
    out.push({ id: b.id, name: b.name, elo: b.elo, band: b.band ?? '', about: b.about ?? raw.bands?.[b.band ?? ''] ?? '', temperature: b.temperature ?? 1, topP: b.topP ?? 1, ...(b.kind === 'engine' ? { kind: 'engine' as const } : {}) });
  }
  return out.sort((a, b) => a.elo - b.elo);
}

const VARIETY: Record<string, { temperature: number; topP: number }> = {
  steady: { temperature: 0.7, topP: 0.9 },
  human: { temperature: 1, topP: 1 },
  wild: { temperature: 1.3, topP: 1 },
};

/** Something in a game against a bot that the sparring coach may speak to (WP 7.7). */
export type SparEvent = { kind: 'start' } | { kind: 'turn' } | { kind: 'blunder'; what: string; question: string } | { kind: 'end' };

/** A draw offer is not taken before this many moves of each side: too early to settle for half a point. */
export const DRAW_FROM_PLY = 20;
/** The bot takes a draw when its winning chances are at most this (it is not better). */
export const DRAW_ACCEPT_AT = 55;

export type PlayOptions = {
  db: Db;
  /** the engine's winning chances (0..100) for the side to move: whether the bot takes a draw */
  assess?: (fen: string) => Promise<number>;
  /** the engine on one of the owner's moves (A8): a blunder? what it did, and the question about the skipped step */
  judgeMove?: (fenBefore: string, san: string, you: Color) => Promise<{ blunder: boolean; what: string; question: string } | null>;
  /** the engine-style bots' moves (WP 7.8): Stockfish held back to a short search */
  engineSource?: MoveSource;
  /** the mini-games with few pieces (F6) */
  minis?: MiniGame[];
  /** what the sparring coach may speak to (WP 7.7): the start, the owner's turn, a blunder offered back, the end */
  onSpar?: (e: SparEvent) => void;
  /** the routine overlay (A9): how often to prompt, and the step the owner skips most */
  routine?: () => { level: RoutineLevel; top?: SkippedStep };
  /** a game is over: it goes into the owner's library; returns its id there */
  onFinished?: (pgn: string, you: Color) => number | undefined;
  /** tests: the clock */
  now?: () => number;
  settings: Settings;
  roster: BotDef[];
  source: MoveSource;
  /** the game changed: tell the page */
  onChange: () => void;
  onProblem?: (text: string) => void;
  log?: (msg: string) => void;
  /** tests: a fixed random source, and no waiting */
  rng?: () => number;
  noDelay?: boolean;
};

type Outcome = 'win' | 'loss' | 'draw';
type Logged = { bot: string; name: string; elo: number; outcome: Outcome; at: string };

const SESSION_ID = 'play';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PlayController {
  game: GameView;
  /** goes up whenever the game changes under a bot that is still choosing, so a late answer is dropped */
  private epoch = 0;
  private readonly o: PlayOptions;
  private log: (msg: string) => void;
  private rng: () => number;
  /** falls when the owner's time runs out */
  private flagTimer: NodeJS.Timeout | null = null;

  constructor(opts: PlayOptions) {
    this.o = opts;
    this.log = opts.log ?? (() => {});
    this.rng = opts.rng ?? Math.random;
    this.game = this.idle();
    const saved = opts.db.loadSession(SESSION_ID);
    if (saved) {
      try {
        const g = JSON.parse(saved) as GameView;
        if (g.tree?.nodes?.[g.focus] && (g.status === 'idle' || opts.roster.some((b) => b.id === g.bot?.id))) this.game = { ...g, thinking: false, problem: undefined };
      } catch {
        /* start fresh */
      }
    }
  }

  private idle(): GameView {
    const tree = newTree(START_FEN);
    return { status: 'idle', you: 'white', tree, focus: tree.root, thinking: false, takebacks: 0 };
  }

  private save() {
    this.o.db.saveSession(SESSION_ID, JSON.stringify(this.game));
  }

  private changed() {
    this.save();
    this.o.onChange();
  }

  /** After a restart: if a game was waiting for the bot's move, let it move. The clock goes on from where it stopped. */
  resume() {
    const g = this.game;
    if (g.status === 'playing' && g.clock?.running) g.clock = { ...g.clock, at: this.now() };
    this.armFlag();
    if (g.status === 'playing' && this.turn() !== g.you) void this.botTurn();
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  // ------------------------------------------------------------ the clock (I10)

  private clearFlag() {
    if (this.flagTimer) clearTimeout(this.flagTimer);
    this.flagTimer = null;
  }

  /** While the owner's clock runs, a timer waits for their flag. */
  private armFlag() {
    this.clearFlag();
    const g = this.game;
    const c = g.clock;
    if (!c || g.status !== 'playing' || c.running !== g.you) return;
    this.flagTimer = setTimeout(() => this.flagIfOut(), Math.max(0, clockLeft(c, g.you, this.now())) + 25);
    this.flagTimer.unref?.();
  }

  /** The routine before the owner's move (A9), when the level says this move gets one. */
  private setPrompt() {
    const g = this.game;
    g.prompt = undefined;
    if (!this.o.routine || g.status !== 'playing' || g.thinking || this.turn() !== g.you) return;
    const { level, top } = this.o.routine();
    // the owner's next move, counted from 1
    const n = Math.floor(this.ucis().length / 2) + 1;
    if (promptAt(level, n)) g.prompt = routinePrompt(n, top);
  }

  /** Has the side whose clock runs run out of time? Then the game is over. */
  flagIfOut(): boolean {
    const g = this.game;
    const c = g.clock;
    if (!c || g.status !== 'playing' || !c.running) return false;
    if (clockLeft(c, c.running, this.now()) > 0) {
      this.armFlag();
      return false;
    }
    this.flag(c.running);
    this.changed();
    return true;
  }

  /** A flag fell: the other side wins, unless it has too little left to checkmate (then a draw). */
  private flag(side: Color) {
    const g = this.game;
    this.epoch++;
    const other = opposite(side);
    const canMate = !mustPosition(this.endFen()).hasInsufficientMaterial(other);
    const botName = g.bot?.name ?? 'The bot';
    const who = side === g.you ? 'Your time ran out' : `${botName}'s time ran out`;
    if (g.clock) g.clock = { ...g.clock, [side]: 0 };
    this.finish(canMate ? { winner: other, reason: 'time', text: `${who}. ${other === g.you ? 'You win' : `${botName} wins`} on time.` } : { reason: 'time', text: `${who}, but ${other === g.you ? 'you have' : `${botName} has`} too little left to checkmate: a draw.` });
  }

  // ------------------------------------------------------------ reading

  private end(): NodeId {
    return mainlineEnd(this.game.tree);
  }

  private endFen(): string {
    return this.game.tree.nodes[this.end()]!.fen;
  }

  private turn(): Color {
    return mustPosition(this.endFen()).turn;
  }

  private bot(): BotDef | undefined {
    return this.o.roster.find((b) => b.id === this.game.bot?.id);
  }

  /** The game so far as engine-style moves, for Maia's history. */
  private ucis(): string[] {
    return pathTo(this.game.tree, this.end())
      .slice(1)
      .map((n) => n.uci!);
  }

  pgn(): string {
    const g = this.game;
    const bot = g.bot ? `${g.bot.name} (bot, ${g.bot.elo})` : 'Bot';
    const result = !g.result ? '*' : !g.result.winner ? '1/2-1/2' : g.result.winner === 'white' ? '1-0' : '0-1';
    const started = new Date(this.startedAt());
    const date = `${started.getUTCFullYear()}.${String(started.getUTCMonth() + 1).padStart(2, '0')}.${String(started.getUTCDate()).padStart(2, '0')}`;
    const time = `${String(started.getUTCHours()).padStart(2, '0')}:${String(started.getUTCMinutes()).padStart(2, '0')}:${String(started.getUTCSeconds()).padStart(2, '0')}`;
    return exportPgn(g.tree, { Event: 'Chess Coach: game against a bot', Site: 'Chess Coach', Date: date, UTCDate: date, UTCTime: time, White: g.you === 'white' ? 'You' : bot, Black: g.you === 'black' ? 'You' : bot, Result: result, TimeControl: g.time ? `${g.time.base}+${g.time.inc}` : '-' });
  }

  /** When the game began: from its start in the events log, or now. */
  private startedAt(): number {
    const row = this.o.db.recentEvents('bot_game_start', 1)[0];
    return row ? Date.parse(row.at) : this.now();
  }

  /** The roster, how Maia is doing, the next bot to try, and the recent results. */
  botsView(): BotsView {
    const record = this.record();
    const minis = (this.o.minis ?? []).map((m) => ({ id: m.id, name: m.name, idea: m.idea, about: m.about, you: m.you, goal: miniGoalText(m.goal), fen: m.fen }));
    // the engine-style bots only when the owner wants them (`play.engineBots`)
    const shown = this.o.roster.filter((b) => b.kind !== 'engine' || (this.o.engineSource && this.o.settings.get<boolean>('play.engineBots')));
    return { bots: shown.map(({ temperature: _t, topP: _p, ...view }) => view), state: this.o.source.state, problem: this.o.source.problem, suggested: this.suggest(record), record: record.slice(0, 8), minis };
  }

  private record(): Logged[] {
    const out: Logged[] = [];
    for (const row of this.o.db.recentEvents('bot_game', 30)) {
      try {
        const d = JSON.parse(row.data) as Partial<Logged> & { mini?: string };
        if (d.bot && d.outcome && typeof d.elo === 'number' && !d.mini) out.push({ bot: d.bot, name: d.name ?? d.bot, elo: d.elo, outcome: d.outcome, at: row.at });
      } catch {
        /* skip a damaged row */
      }
    }
    return out;
  }

  /**
   * The level-matched suggestion: start at the lowest bot; two wins in the last three games at a
   * level move it one step up, three losses in a row one step down.
   */
  private suggest(record: Logged[]): string {
    const roster = this.o.roster;
    if (!roster.length) return '';
    const last = record[0];
    let i = last ? roster.findIndex((b) => b.id === last.bot) : 0;
    if (i < 0) i = 0;
    if (last) {
      const recent = record.filter((r) => r.bot === last.bot).slice(0, 3);
      const wins = recent.filter((r) => r.outcome === 'win').length;
      if (wins >= 2) i = Math.min(roster.length - 1, i + 1);
      else if (recent.length === 3 && recent.every((r) => r.outcome === 'loss')) i = Math.max(0, i - 1);
    }
    return roster[i]!.id;
  }

  // ------------------------------------------------------------ the owner's actions

  start(botId: string, color: 'white' | 'black' | 'random', time?: TimeControl | null): { ok: true } | { ok: false; reason: string } {
    const bot = this.o.roster.find((b) => b.id === botId);
    if (!bot) return { ok: false, reason: 'That bot is not on the roster.' };
    if (time && !(time.base >= 60 && time.base <= 10_800 && time.inc >= 0 && time.inc <= 180)) return { ok: false, reason: 'That time control is not one the page offers.' };
    this.epoch++;
    const tree = newTree(START_FEN);
    const { temperature: _t, topP: _p, ...view } = bot;
    this.game = { status: 'playing', bot: view, you: color === 'random' ? (this.rng() < 0.5 ? 'white' : 'black') : color, tree, focus: tree.root, thinking: false, takebacks: 0, gameNo: this.now(), helps: 0, ...(time ? { time, clock: newClock(time, this.now()) } : {}) };
    this.o.db.logEvent('bot_game_start', { bot: bot.id, elo: bot.elo, you: this.game.you, time: time ? `${time.base}+${time.inc}` : 'untimed' });
    this.armFlag();
    this.setPrompt();
    this.changed();
    this.o.onSpar?.({ kind: 'start' });
    if (this.game.you === 'black') void this.botTurn();
    return { ok: true };
  }

  /** A mini-game (F6): its position, its side, its goal; against the bot given, or the one suggested. */
  startMini(id: string, botId?: string): { ok: true } | { ok: false; reason: string } {
    const m = this.o.minis?.find((x) => x.id === id);
    if (!m) return { ok: false, reason: 'There is no such mini-game.' };
    const bot = this.o.roster.find((b) => b.id === (botId ?? this.suggest(this.record()))) ?? this.o.roster[0];
    if (!bot) return { ok: false, reason: 'The bot roster did not load.' };
    this.epoch++;
    const tree = newTree(m.fen);
    const { temperature: _t, topP: _p, ...view } = bot;
    this.game = { status: 'playing', bot: view, you: m.you, tree, focus: tree.root, thinking: false, takebacks: 0, gameNo: this.now(), helps: 0, mini: { id: m.id, name: m.name, goal: miniGoalText(m.goal) } };
    this.o.db.logEvent('bot_game_start', { bot: bot.id, elo: bot.elo, you: m.you, mini: m.id });
    this.setPrompt();
    this.changed();
    this.o.onSpar?.({ kind: 'start' });
    if (this.turn() !== m.you) void this.botTurn();
    return { ok: true };
  }

  move(from: string, to: string, promotion?: string): { ok: true } | { ok: false; reason: string } {
    const g = this.game;
    if (g.status !== 'playing') return { ok: false, reason: 'There is no game in progress.' };
    if (g.thinking || this.turn() !== g.you) return { ok: false, reason: 'It is not your move.' };
    // a move made after the flag fell does not count
    const clock = g.clock ? clockAfterMove(g.clock, g.you, this.now()) : undefined;
    if (clock === null) {
      this.flag(g.you);
      this.changed();
      return { ok: true };
    }
    const end = this.end();
    const fenBefore = g.tree.nodes[end]!.fen;
    const r = addMove(g.tree, end, `${from}${to}${promotion ? (promotion[0] === 'k' ? 'n' : promotion[0]) : ''}`);
    if (!r.ok) return { ok: false, reason: 'That move is not legal.' };
    if (clock) g.clock = clock;
    this.clearFlag();
    g.focus = r.id;
    g.problem = undefined;
    g.offer = undefined;
    g.prompt = undefined;
    void this.blunderCheck(fenBefore, g.tree.nodes[r.id]!.san!, this.ucis().length);
    if (!this.finishIfOver()) void this.botTurn();
    else this.changed();
    return { ok: true };
  }

  nav(to: NodeId | 'start' | 'end' | 'prev' | 'next') {
    const g = this.game;
    const cur = g.tree.nodes[g.focus]!;
    const target = to === 'start' ? g.tree.root : to === 'end' ? this.end() : to === 'prev' ? (cur.parent ?? undefined) : to === 'next' ? cur.children[0] : g.tree.nodes[to] ? to : undefined;
    if (!target || target === g.focus) return;
    g.focus = target;
    this.changed();
  }

  resign() {
    const g = this.game;
    if (g.status !== 'playing') return;
    this.epoch++;
    this.clearFlag();
    g.thinking = false;
    this.finish({ winner: opposite(g.you), reason: 'resigned', text: 'You resigned.' });
    this.changed();
  }

  /**
   * A8: while the bot answers, the engine judges the owner's move. A blunder brings the offer to take
   * it back, with the question about the step that was skipped; the page shows it once the bot has
   * moved, so what the mistake costs is on the board. Nothing else of the engine reaches the page.
   */
  private async blunderCheck(fenBefore: string, san: string, ply: number) {
    if (!this.o.judgeMove || !this.o.settings.get<boolean>('play.undoOffer')) return;
    const g = this.game;
    const r = await this.o.judgeMove(fenBefore, san, g.you).catch(() => null);
    if (!r?.blunder || this.game !== g || g.status !== 'playing') return;
    // the owner has not moved again (or taken this one back) since
    const path = pathTo(g.tree, this.end());
    if (path.length - 1 < ply || path.length - 1 > ply + 1 || path[ply]!.san !== san) return;
    g.offer = { ply, what: r.what, question: r.question };
    this.o.db.logEvent('bot_game_undo_offer', { bot: g.bot?.id, ply, what: r.what });
    this.changed();
    this.o.onSpar?.({ kind: 'blunder', what: r.what, question: r.question });
  }

  /** The game as the sparring coach sees it, or null when none is being played or just ended. */
  sparState() {
    const g = this.game;
    if (g.status === 'idle' || !g.gameNo) return null;
    const path = pathTo(g.tree, this.end());
    const last = path.at(-1);
    const before = path.at(-2);
    return {
      gameNo: g.gameNo,
      fen: this.endFen(),
      you: g.you,
      yourTurn: g.status === 'playing' && !g.thinking && this.turn() === g.you,
      playing: g.status === 'playing',
      bot: g.bot ? `${g.bot.name} (${g.bot.elo})` : 'the bot',
      moves: path.length - 1,
      ownerMoveNo: Math.floor((path.length - 1) / 2) + 1,
      prompt: g.prompt,
      offer: g.offer,
      mini: g.mini,
      result: g.result,
      takebacks: g.takebacks,
      helps: g.helps ?? 0,
      // their last move, which the coach may name
      lastMove: last?.san && before && mustPosition(before.fen).turn !== g.you ? { san: last.san, fenBefore: before.fen } : undefined,
    };
  }

  /** The owner asked the coach for help during the game: counted like a hint. */
  noteHelp() {
    const g = this.game;
    if (g.status !== 'playing') return;
    g.helps = (g.helps ?? 0) + 1;
    this.changed();
  }

  /** The owner takes the offer: the blunder and the bot's reply go back, counted like any takeback (a hint). */
  takeOffer(): boolean {
    const g = this.game;
    if (!g.offer || g.status !== 'playing') return false;
    this.o.db.logEvent('bot_game_offer_taken', { bot: g.bot?.id, ply: g.offer.ply });
    return this.takeback();
  }

  /** The owner plays on. */
  playOn() {
    const g = this.game;
    if (!g.offer) return;
    this.o.db.logEvent('bot_game_offer_declined', { bot: g.bot?.id, ply: g.offer.ply });
    g.offer = undefined;
    this.changed();
  }

  /** Take back the owner's last move (and the bot's reply to it). Counted, because an undo is a kind of hint (A8). */
  takeback(): boolean {
    const g = this.game;
    if (g.status !== 'playing') return false;
    const path = pathTo(g.tree, this.end());
    // back to the last position where it was the owner's move
    let cut = path.length - 1;
    while (cut > 0 && mustPosition(path[cut - 1]!.fen).turn !== g.you) cut--;
    if (cut <= 0) return false;
    this.epoch++;
    g.thinking = false;
    g.problem = undefined;
    deleteNode(g.tree, path[cut]!.id);
    g.focus = this.end();
    g.takebacks++;
    g.offer = undefined;
    this.setPrompt();
    // the clock does not go back: the owner's runs again from what it has left
    if (g.clock) g.clock = { ...g.clock, ...(g.clock.running ? { [g.clock.running]: Math.max(1, clockLeft(g.clock, g.clock.running, this.now())) } : {}), running: g.you, at: this.now() };
    this.armFlag();
    this.o.db.logEvent('bot_game_takeback', { bot: g.bot?.id, ply: cut });
    this.changed();
    return true;
  }

  /** Back to the bot picker. A game in progress is dropped without a result. */
  fresh() {
    this.epoch++;
    this.clearFlag();
    this.game = this.idle();
    this.changed();
  }

  /** Maia did not answer: try the bot's move again. */
  retry() {
    if (this.game.status === 'playing' && !this.game.thinking && this.turn() !== this.game.you) void this.botTurn();
  }

  stop() {
    this.epoch++;
    this.clearFlag();
    this.o.source.stop();
  }

  /**
   * The owner offers a draw. The bot takes it when the engine says it is not better, and not before
   * DRAW_FROM_PLY: what is said is only yes or no, so nothing from the engine shows during the game.
   */
  async draw(): Promise<{ accepted: boolean; text: string }> {
    const g = this.game;
    const name = g.bot?.name ?? 'The bot';
    if (g.status !== 'playing') return { accepted: false, text: 'There is no game in progress.' };
    const plies = this.ucis().length;
    if (plies < DRAW_FROM_PLY) return { accepted: false, text: `${name} declines: it is too early in the game for a draw.` };
    if (!this.o.assess) return { accepted: false, text: `${name} declines the draw.` };
    const fen = this.endFen();
    const chances = await this.o.assess(fen);
    if (this.game !== g || g.status !== 'playing' || this.endFen() !== fen) return { accepted: false, text: 'The game moved on.' };
    const botChances = mustPosition(fen).turn === g.you ? 100 - chances : chances;
    const accepted = botChances <= DRAW_ACCEPT_AT;
    this.o.db.logEvent('bot_game_draw_offer', { bot: g.bot?.id, ply: plies, accepted });
    if (!accepted) return { accepted, text: `${name} declines the draw and plays on.` };
    this.epoch++;
    this.clearFlag();
    this.finish({ reason: 'agreed', text: 'A draw by agreement.' });
    this.changed();
    return { accepted, text: `${name} accepts the draw.` };
  }

  // ------------------------------------------------------------ the bot's move

  private sampling(bot: BotDef): Sampling {
    const v = VARIETY[this.o.settings.get<string>('play.variety')] ?? VARIETY.human!;
    return { temperature: bot.temperature * v.temperature, topP: Math.min(bot.topP, v.topP), rng: this.rng };
  }

  /** A short, uneven pause, longer when the choice is not obvious: an instant reply feels like a machine. */
  private thinkMs(topShare: number, ply: number): number {
    if (this.o.noDelay || !this.o.settings.get<boolean>('play.thinkTime')) return 0;
    const base = 450 + this.rng() * 900;
    const unsure = topShare < 0.5 ? (0.5 - topShare) * 2400 * this.rng() : 0;
    return Math.round((base + unsure) * (ply < 8 ? 0.6 : 1));
  }

  private async botTurn(): Promise<void> {
    const g = this.game;
    const bot = this.bot();
    if (g.status !== 'playing' || !bot) return;
    const epoch = ++this.epoch;
    g.thinking = true;
    g.problem = undefined;
    this.changed();
    const fen = this.endFen();
    const started = Date.now();
    try {
      const source = bot.kind === 'engine' && this.o.engineSource ? this.o.engineSource : this.o.source;
      const probs = legalOnly(fen, await source.probabilities({ startFen: g.tree.rootFen, moves: this.ucis(), selfElo: bot.elo, oppoElo: bot.elo }));
      const pick = sampleMove(probs, this.sampling(bot));
      if (!pick) throw new Error('Maia returned no legal move');
      const wait = this.thinkMs(probs[0]?.p ?? 1, this.ucis().length) - (Date.now() - started);
      if (wait > 0) await sleep(wait);
      if (epoch !== this.epoch || this.game !== g) return; // the owner took a move back, resigned or started again
      const clock = g.clock ? clockAfterMove(g.clock, opposite(g.you), this.now()) : undefined;
      if (clock === null) {
        g.thinking = false;
        this.flag(opposite(g.you));
        this.changed();
        return;
      }
      const r = addMove(g.tree, this.end(), pick.uci);
      if (!r.ok) throw new Error(`the move ${pick.uci} was refused by the rules`);
      if (clock) g.clock = clock;
      // keep the owner's view on the latest position unless they stepped back to look at something
      if (g.tree.nodes[g.focus]?.children[0] === r.id || g.focus === r.id) g.focus = r.id;
      g.thinking = false;
      this.finishIfOver();
      this.armFlag();
      this.setPrompt();
      this.changed();
      if (g.status === 'playing') this.o.onSpar?.({ kind: 'turn' });
    } catch (e) {
      if (epoch !== this.epoch || this.game !== g) return;
      const message = (e as Error).message;
      this.log(`bot move failed: ${message}`);
      g.thinking = false;
      g.problem = `${bot.name} could not move: ${message}`;
      this.changed();
      this.o.onProblem?.(g.problem);
    }
  }

  // ------------------------------------------------------------ the end of the game

  private finishIfOver(): boolean {
    const g = this.game;
    const fen = this.endFen();
    const pos = mustPosition(fen);
    const botName = g.bot?.name ?? 'The bot';
    if (pos.isCheckmate()) {
      const winner = opposite(pos.turn);
      this.finish({ winner, reason: 'checkmate', text: winner === g.you ? 'Checkmate. You won.' : `Checkmate. ${botName} won.` });
    } else if (pos.isStalemate()) this.finish({ reason: 'stalemate', text: 'Stalemate: the side to move has no legal move, so the game is a draw.' });
    else if (pos.isInsufficientMaterial()) this.finish({ reason: 'material', text: 'A draw: neither side has enough left to checkmate.' });
    else if (pos.halfmoves >= 100) this.finish({ reason: 'fifty', text: 'A draw: fifty moves without a capture or a pawn move.' });
    else {
      const key = positionKey(fen);
      const seen = pathTo(g.tree, this.end()).filter((n) => positionKey(n.fen) === key).length;
      if (seen >= 3) this.finish({ reason: 'repetition', text: 'A draw: the same position came up three times.' });
    }
    // a mini-game's goal (F6)
    const mini = g.mini ? this.o.minis?.find((m) => m.id === g.mini!.id) : undefined;
    if (g.status !== 'over' && mini) {
      const path = pathTo(g.tree, this.end());
      const last = path.at(-1)!;
      if (last.san) {
        const by = opposite(pos.turn);
        const ownerMoves = path.slice(1).filter((n) => mustPosition(g.tree.nodes[n.parent!]!.fen).turn === g.you).length;
        const verdict = miniVerdict(mini, { san: last.san, by, fenAfter: fen }, ownerMoves);
        if (verdict) this.finish({ winner: verdict.winner, reason: 'goal', text: verdict.text });
      }
    }
    return g.status === 'over';
  }

  private finish(result: GameResult) {
    const g = this.game;
    this.clearFlag();
    g.offer = undefined;
    g.prompt = undefined;
    g.status = 'over';
    g.result = result;
    g.thinking = false;
    g.focus = this.end();
    if (g.clock) g.clock = clockStopped(g.clock, this.now());
    // into the owner's library, where it is reviewed like any other game
    try {
      if (!g.mini) g.libraryId = this.o.onFinished?.(this.pgn(), g.you);
    } catch (e) {
      this.log(`the finished game could not be added to the library: ${(e as Error).message}`);
    }
    const outcome: Outcome = !result.winner ? 'draw' : result.winner === g.you ? 'win' : 'loss';
    // kept in the events log, so the game history exists before the game library does (Phase 5)
    this.o.db.logEvent('bot_game', { bot: g.bot?.id, name: g.bot?.name, elo: g.bot?.elo, you: g.you, outcome, reason: result.reason, plies: this.ucis().length, takebacks: g.takebacks, helps: g.helps ?? 0, pgn: this.pgn(), ...(g.mini ? { mini: g.mini.id } : {}) });
    this.o.onSpar?.({ kind: 'end' });
  }
}
