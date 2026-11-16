// The puzzle player (PLAN WP 6.2): one puzzle at a time on a board of its own. Multi-move
// solutions, accepted answers, the hint ladder, and on a miss what the move runs into, from the
// engine's checked facts. It needs no coach: the sentences are in coach/templates/puzzle.json.
//
// Only `live` items are ever played (CONTENT §1). The engine is a silent checker here: it speaks
// when a move was wrong and when the puzzle is over, never before.

import { readFileSync } from 'node:fs';
import {
  DRAW_BELOW,
  anyToMove,
  gradeOf,
  makeScheduler,
  review,
  spreadBacklog,
  type Scheduler,
  answer,
  describeMove,
  parsePosition,
  practiceLevel,
  scoreOf,
  themeName,
  attemptOf,
  expectedMove,
  nextRung,
  plainText,
  playReply,
  playSetup,
  reveal,
  runFen,
  solverStart,
  startRun,
  yourTurn,
  guidanceFor,
  motifMastery,
  puzzleStage,
  type MotifMastery,
  type MotifStage,
  type Color,
  type ContentItem,
  type Puzzle,
  type PuzzleRun,
  type PracticeSet,
  type PuzzleView,
} from '@chess-coach/core';
import type { ContentService } from './content.ts';
import { NOT_A_THEME, type DbPuzzle, type PuzzleDb } from './datasets/puzzle-db.ts';
import type { Db } from './db.ts';
import type { FactService } from './facts-service.ts';

const WORD_KEYS = ['task.mistake', 'task.punish', 'task.threat', 'task.theme', 'hint.question', 'hint.nudge', 'hint.arrow', 'wrong', 'wrong.checking', 'solved.clean', 'solved', 'solved.also', 'shown', 'shown.misses', 'none', 'none.left', 'example', 'guide.example', 'guide.partial'] as const;
export type PuzzleWords = Record<(typeof WORD_KEYS)[number], string>;

/** The player's sentences. A file with one missing stops the start, with the reason. */
export function loadPuzzleWords(file: string): PuzzleWords {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const out = {} as PuzzleWords;
  for (const key of WORD_KEYS) {
    const text = raw[key];
    if (typeof text !== 'string' || !text.trim()) throw new Error(`the puzzle player's sentences (${file}) have none for "${key}"`);
    out[key] = text;
  }
  return out;
}

export type PuzzleOptions = {
  db: Db;
  facts: FactService;
  words: PuzzleWords;
  /** misses before the answer is given (the stop rule of the hint ladder) */
  maxMisses: () => number;
  /** fair play: is this position off limits? The refusal in words, or null */
  guard: (fens: string[]) => string | null;
  onChange: () => void;
  /** the gate runner: a puzzle drawn from the database is checked before it is played */
  content?: ContentService;
  /** the installed Lichess puzzle database, or null when it is not installed */
  puzzleDb?: () => PuzzleDb | null;
  /** where the puzzle level starts */
  startLevel?: () => number;
  /** the schedule's settings */
  schedule?: () => { newPerDay: number; reviewCap: number; maxDays: number; afterNudge: 'hard' | 'good' };
  /** motif mastery (G7): does the guidance fade with it, and do mixed sets use only known ideas? */
  guidance?: () => { fade: boolean; mixedKnownOnly: boolean };
  /** the optional modes (C6, I4): switched on, and the size of a Woodpecker set */
  modes?: () => { woodpecker: boolean; speed: boolean; woodpeckerSize: number };
  /** what the drill coach may speak to (6.11): a miss, the end of a puzzle, the end of a sitting */
  onDrill?: (e: DrillEvent) => void;
  /** tests: the clock */
  now?: () => Date;
  /** tests: no pause before the opponent's moves */
  noDelay?: boolean;
  log?: (msg: string) => void;
};

type Stored = ContentItem<Puzzle> & { id: number };

/** Something that happened in the puzzle player that the drill coach may speak to (WP 6.11). */
export type DrillEvent =
  | { kind: 'miss'; fenBefore: string; san: string }
  | { kind: 'done'; how: 'solved' | 'shown'; clean: boolean; example: boolean }
  | { kind: 'end'; attempts: number[] };

/** The puzzle on the board as the drill coach sees it. */
export type DrillState = {
  id: number;
  /** the board now */
  fen: string;
  /** the solver's first position (after the set-up move) */
  solverFen: string;
  you: Color;
  solving: boolean;
  set: PracticeSet;
  task: string;
  themes: string[];
  solution: string[];
  /** other moves accepted at a step of the solution (by its index) */
  accepted: Record<number, string[]>;
  hints: number;
  misses: number;
  stage: { motif: string; stage: MotifStage } | null;
  /** their move that led to the board, so the coach may name it */
  lastMove?: { fenBefore: string; san: string };
};

/** A Lichess database puzzle as one of ours: the first move is the opponent's set-up move. Null when a move does not fit. */
export function puzzleFromDb(p: DbPuzzle): Puzzle | null {
  const pos = parsePosition(p.fen);
  if (!pos) return null;
  const sans: string[] = [];
  for (const uci of p.moves) {
    const move = anyToMove(pos, uci);
    if (!move) return null;
    sans.push(describeMove(pos, move).san);
    pos.play(move);
  }
  if (sans.length < 2) return null;
  return { fen: p.fen, setup: sans[0], solution: sans.slice(1), themes: p.themes, rating: p.rating, kind: 'theme' };
}

/** The level band a database puzzle's rating falls in. */
export function bandOf(rating: number): string {
  return rating < 700 ? '400–700' : rating < 1000 ? '700–1000' : rating < 1300 ? '1000–1300' : '1300 and up';
}

/** The ideas of a mixed set in a random order, so each draw mixes them. */
function shuffle<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export class PuzzleController {
  view: PuzzleView;
  private run: PuzzleRun | null = null;
  private item: Stored | null = null;
  private startedAt = 0;
  /** this attempt is a second go at the same puzzle: logged, but not counted */
  private again = false;
  private logged = false;
  /** goes up with every new attempt, so a late answer from the engine cannot land on another puzzle */
  private token = 0;
  private timer: NodeJS.Timeout | null = null;
  /** what is being practised */
  private set: PracticeSet = { kind: 'games' };
  private scheduler: Scheduler | null = null;
  private schedulerDays = 0;
  /** the owner's motifs, counted when a puzzle starts or ends (G7) */
  private mastery: MotifMastery[] = [];
  /** the motif and stage of the puzzle on the board, when the guidance fades */
  private stage: { motif: string; stage: MotifStage } | null = null;
  /** the puzzles answered since the set was chosen: the sitting the drill coach sums up (6.11) */
  private sitting: number[] = [];
  private sittingSummed = false;
  /** the answer being played out is a worked example (6.9) */
  private exampling = false;
  /** the Woodpecker round under way (C6) */
  private round: { id: number; round: number; items: number[]; done: { id: number; solved: boolean; alone: boolean; ms: number }[] } | null = null;
  private readonly o: PuzzleOptions;

  constructor(opts: PuzzleOptions) {
    this.o = opts;
    this.countMastery();
    this.view = this.idle();
  }

  private guidance() {
    return this.o.guidance?.() ?? { fade: true, mixedKnownOnly: true };
  }

  private modes() {
    return this.o.modes?.() ?? { woodpecker: false, speed: false, woodpeckerSize: 20 };
  }

  /** The Woodpecker set as the page shows it: its size, the round, and every round so far. */
  private woodpeckerView(): PuzzleView['woodpecker'] {
    if (this.set.kind !== 'woodpecker') return undefined;
    const set = this.o.db.woodpeckerSet();
    if (!set) return undefined;
    const rounds = this.o.db.woodpeckerRounds(set.id).map((r) => ({ round: r.round, ms: r.ms, solved: r.done.filter((d) => d.solved).length, alone: r.done.filter((d) => d.alone).length, done: r.done.length }));
    const last = rounds.at(-1);
    return { size: set.items.length, round: last?.round ?? 0, done: last?.done ?? 0, over: !last || last.ms !== undefined, rounds };
  }

  /** Count the owner's motifs again from the attempts (G7). */
  private countMastery() {
    this.mastery = motifMastery(this.o.db.motifHistory(), NOT_A_THEME);
  }

  private counts() {
    const motifs = this.mastery.slice(0, 8).map((m) => ({ motif: m.motif, name: themeName(m.motif), stage: m.stage, alone: m.alone, recent: m.recent }));
    const m = this.modes();
    return { ...this.o.db.puzzleCounts(), due: this.dueIds().length, set: this.set, level: this.level(), catalogue: this.catalogue(), motifs, modes: { woodpecker: m.woodpecker, speed: m.speed }, woodpecker: this.woodpeckerView() };
  }

  /** The guidance for the puzzle on the board: a mixed set names nothing; a themed set has named its theme already. */
  private guide(run: PuzzleRun): PuzzleView['guide'] {
    const s = this.stage;
    if (!s || run.status !== 'solving' || this.set.kind === 'mixed') return undefined;
    const g = guidanceFor(s.stage);
    const offerExample = g.offerExample && run.hints === 0 && run.misses === 0;
    if (!offerExample && (!g.nameIt || this.set.kind === 'theme')) return undefined;
    const name = themeName(s.motif);
    const w = this.o.words;
    return { motif: s.motif, name, stage: s.stage, offerExample, text: (offerExample ? w['guide.example'] : w['guide.partial']).replace('{motif}', name) };
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private settings() {
    return this.o.schedule?.() ?? { newPerDay: 10, reviewCap: 30, maxDays: 180, afterNudge: 'hard' as const };
  }

  /** The cards due now, under the day's cap: anything beyond the cap is moved to the following days first. */
  private dueIds(): number[] {
    const now = this.now();
    const due = this.o.db.dueCards(now.toISOString());
    const cap = this.settings().reviewCap;
    if (due.length > cap) for (const m of spreadBacklog(due, cap, now)) this.o.db.moveCard(m.id, m.dueAt);
    return due.slice(0, cap).map((c) => c.id);
  }

  /** The start of today, for the count of new puzzles. */
  private today(): string {
    const d = this.now();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }

  /**
   * Schedule the puzzle that was just answered (C4). Every puzzle from the owner's games gets a
   * card; a database puzzle gets one only when it went wrong, so a themed set does not fill the
   * reviews with puzzles that were already easy. A second go changes nothing.
   */
  private async schedule(itemId: number, kind: 'puzzle_game' | 'puzzle_db', a: { result: 'solved' | 'shown'; hints: number; misses: number; ms: number }): Promise<string | undefined> {
    const s = this.settings();
    if (!this.scheduler || this.schedulerDays !== s.maxDays) {
      this.scheduler = await makeScheduler(s.maxDays);
      this.schedulerDays = s.maxDays;
    }
    const before = this.o.db.getCard(itemId);
    const earlier = this.o.db.attemptsOf(itemId).filter((x) => !x.again).slice(0, -1).at(-1);
    const grade = gradeOf(a, { afterNudge: s.afterNudge, previousFastAndClean: !!earlier && earlier.result === 'solved' && earlier.hints <= 1 && earlier.misses === 0 && earlier.ms <= 20_000 });
    if (!before && kind === 'puzzle_db' && grade !== 'again' && grade !== 'hard') return undefined;
    const next = review(this.scheduler, before ?? null, grade, this.now());
    this.o.db.saveCard(itemId, next.card);
    return next.card.dueAt;
  }

  /** The owner's puzzle level: replayed from their answers to database puzzles. */
  level(): number {
    return practiceLevel(this.o.db.databaseHistory().map((h) => ({ rating: h.rating, score: scoreOf(h) })), this.o.startLevel?.() ?? 700);
  }

  private catalogue(): PuzzleView['catalogue'] {
    const db = this.o.puzzleDb?.();
    if (!db) return null;
    return db
      .themesNear(this.level() - DRAW_BELOW)
      .filter((t) => t.count >= 20)
      .map((t) => ({ theme: t.theme, name: themeName(t.theme), count: t.count }));
  }

  /** Choose what to practise, and put its first puzzle on the board. */
  async choose(set: PracticeSet): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (set.kind === 'theme' && (typeof set.theme !== 'string' || !/^[A-Za-z0-9]{2,40}$/.test(set.theme))) return { ok: false, reason: 'There is no such theme.' };
    this.set = set.kind === 'theme' ? { kind: 'theme', theme: set.theme } : { kind: set.kind === 'mixed' ? 'mixed' : set.kind === 'due' ? 'due' : set.kind === 'safety' ? 'safety' : set.kind === 'threat' ? 'threat' : set.kind === 'convert' ? 'convert' : set.kind === 'openings' ? 'openings' : set.kind === 'woodpecker' ? 'woodpecker' : set.kind === 'streak' ? 'streak' : set.kind === 'timed' ? 'timed' : 'games' };
    this.o.db.logEvent('puzzle_set', this.set);
    this.sitting = [];
    this.sittingSummed = false;
    return this.next();
  }

  /** A puzzle of the database as one of the app's: its moves in notation, the set-up move apart. */
  /** The next puzzle of a themed or mixed set: drawn near the level, checked by the gates, then played. */
  private async draw(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const db = this.o.puzzleDb?.();
    const content = this.o.content;
    if (!db || !content) return { ok: false, reason: 'Themed puzzles need the Lichess puzzle database. Install it once with: npm run content:install -- puzzles' };
    const set = this.set;
    const target = this.level() - DRAW_BELOW;
    const exclude = this.o.db.drawnPuzzleIds();
    // a mixed set mixes the ideas already known (G7), once there are three of them; until then, every theme
    const known = this.mastery.filter((m) => guidanceFor(m.stage).mixable).map((m) => m.motif);
    const themes = set.kind === 'theme' ? [set.theme] : set.kind === 'mixed' && this.guidance().mixedKnownOnly && known.length >= 3 ? shuffle(known) : [undefined];
    const found = themes.flatMap((theme) => db.near({ theme, rating: target, count: 5, exclude, minPopularity: 50 }));
    for (const p of found) {
      const puzzle = puzzleFromDb(p);
      if (!puzzle) continue;
      const item = await content.submit({ type: 'puzzle_db', status: 'draft', source: `puzzle:${p.id}`, licence: 'cc0', level: bandOf(p.rating), gates: [], body: puzzle });
      if (item.status !== 'live') continue;
      const r = this.start(item.id);
      if (r.ok) return r;
    }
    return { ok: false, reason: set.kind === 'theme' ? `No more ${themeName(set.theme).toLowerCase()} puzzles near your level.` : 'No more puzzles near your level.' };
  }

  private idle(problem?: string): PuzzleView {
    return { status: 'idle', fen: '8/8/8/8/8/8/8/8 w - - 0 1', you: 'white', yourTurn: false, moves: [], hints: 0, misses: 0, shapes: [], task: '', ...this.counts(), problem };
  }

  private where(item: Stored): string {
    const game = /^game:(\d+)#(\d+)$/.exec(item.source);
    if (game) {
      const g = this.o.db.getGame(Number(game[1]));
      const move = Math.ceil(Number(game[2]) / 2);
      if (!g) return `From one of your games, move ${move}`;
      const opponent = g.you === 'white' ? g.black : g.you === 'black' ? g.white : `${g.white} – ${g.black}`;
      return `From your game against ${opponent}, move ${move}`;
    }
    return item.source.startsWith('puzzle:') ? `From the Lichess puzzle database, rated ${item.body.rating ?? '?'}` : 'A puzzle';
  }

  /** Put the run on the page. `feedback` stays until the next thing is said. */
  private show(feedback?: PuzzleView['feedback'], shapes: PuzzleView['shapes'] = []) {
    const run = this.run;
    const item = this.item;
    if (!run || !item) return;
    const last = run.moves.at(-1);
    const kind = run.puzzle.kind;
    const w = this.o.words;
    this.view = {
      status: run.status,
      id: item.id,
      kind,
      from: this.where(item),
      fen: runFen(run),
      lastMove: last ? [last.from, last.to] : undefined,
      you: run.you,
      yourTurn: yourTurn(run),
      moves: run.moves,
      hints: run.hints,
      misses: run.misses,
      nextHint: run.status === 'solving' ? nextRung(run) : undefined,
      shapes,
      // a themed set names its theme; a mixed set does not, so the idea is found on the board
      task: kind === 'mistake' ? w['task.mistake'] : kind === 'punish' ? w['task.punish'] : kind === 'threat' ? w['task.threat'] : this.set.kind === 'theme' && item.type === 'puzzle_db' ? `${themeName(this.set.theme)}. ${w['task.theme']}` : w['task.theme'],
      feedback: feedback ?? this.view.feedback,
      guide: this.guide(run),
      // the themes would give the idea away: they are shown once the puzzle is over
      themes: run.status === 'solving' ? undefined : run.puzzle.themes.filter((t) => !NOT_A_THEME.has(t)),
      ...this.counts(),
    };
    this.o.onChange();
  }

  private later(ms: number, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    if (this.o.noDelay) return fn();
    this.timer = setTimeout(fn, ms);
    this.timer.unref?.();
  }

  /** Begin a puzzle: the one asked for, or the next one that is waiting. */
  start(id?: number, again = false): { ok: true } | { ok: false; reason: string } {
    const w = this.o.words;
    let item: Stored | undefined;
    let run: PuzzleRun | undefined;
    const skipped: number[] = [];
    // the next live puzzle whose position is not off limits (fair play) and that can be played
    for (let tries = 0; tries < 50 && !run; tries++) {
      const candidate = id !== undefined && tries === 0 ? this.o.db.getContent(id) : this.o.db.nextPuzzle([...skipped, ...(this.item && !again && id === undefined ? [this.item.id] : [])]);
      if (!candidate || candidate.status !== 'live' || (candidate.type !== 'puzzle_game' && candidate.type !== 'puzzle_db')) {
        if (id !== undefined && tries === 0) return { ok: false, reason: 'That puzzle is not available.' };
        break;
      }
      const started = startRun(candidate.body);
      const solver = solverStart(candidate.body);
      if (started.ok && solver.ok && !this.o.guard([solver.fen])) {
        item = candidate;
        run = started.run;
      } else if (id !== undefined && tries === 0) return { ok: false, reason: (solver.ok && this.o.guard([solver.fen])) || 'That puzzle cannot be played.' };
      else skipped.push(candidate.id);
    }
    if (!item || !run) {
      // nothing else is waiting: the one just played may be played again, but it is not started by itself
      const left = this.counts().ready > 0;
      if (this.sitting.length && !this.sittingSummed) {
        this.sittingSummed = true;
        this.o.onDrill?.({ kind: 'end', attempts: [...this.sitting] });
      }
      this.run = null;
      this.item = null;
      this.view = this.idle(left ? w['none.left'] : w.none);
      this.o.onChange();
      return { ok: false, reason: this.view.problem! };
    }
    this.token++;
    this.item = item;
    this.run = run;
    this.again = again;
    this.countMastery();
    // a themed set is about its theme; any other puzzle gets the guidance of its least known idea
    const ideas = this.set.kind === 'theme' && item.type === 'puzzle_db' ? [this.set.theme] : run.puzzle.themes;
    this.stage = this.guidance().fade ? puzzleStage(ideas, new Map(this.mastery.map((m) => [m.motif, m])), NOT_A_THEME) : null;
    this.logged = false;
    this.startedAt = Date.now();
    this.view = { ...this.view, feedback: undefined, comesBack: undefined };
    this.show(undefined);
    // the opponent's move that makes the puzzle is played in front of the owner
    if (!run.ready) {
      const token = this.token;
      this.later(700, () => {
        if (token !== this.token || !this.run) return;
        this.run = playSetup(this.run);
        this.show();
      });
    }
    return { ok: true };
  }

  next(): Promise<{ ok: true } | { ok: false; reason: string }> {
    // the safety checks, "what's the threat?", the won games and the speed runs have controllers of their own: the puzzle board is put away
    if (this.set.kind === 'safety' || this.set.kind === 'threat' || this.set.kind === 'convert' || this.set.kind === 'openings' || this.set.kind === 'streak' || this.set.kind === 'timed') {
      this.close();
      return Promise.resolve({ ok: true });
    }
    if (this.set.kind === 'due') return Promise.resolve(this.startDue());
    if (this.set.kind === 'woodpecker') return Promise.resolve(this.woodpeckerNext());
    if (this.set.kind === 'games') {
      // new puzzles come a few a day; puzzles already tried come back through the schedule
      const fresh = this.o.db.puzzleCounts().fresh;
      if (fresh > 0 && this.o.db.newPuzzlesSince(this.today()) >= this.settings().newPerDay) {
        const reason = `That is today's ${this.settings().newPerDay} new puzzles from your games. The rest wait for tomorrow${this.dueIds().length ? '; your puzzles due again are under "Due today"' : ''}.`;
        this.run = null;
        this.item = null;
        this.view = this.idle(reason);
        this.o.onChange();
        return Promise.resolve({ ok: false, reason });
      }
      return Promise.resolve(this.start(undefined, false));
    }
    return this.draw();
  }

  /** The next puzzle due again, the longest overdue first. */
  private startDue(): { ok: true } | { ok: false; reason: string } {
    // a card answered today is due on another day, so the puzzle just played never comes straight back
    const ids = this.dueIds();
    for (const id of ids) {
      const r = this.start(id);
      if (r.ok) return r;
    }
    const reason = 'Nothing is due again today.';
    this.run = null;
    this.item = null;
    this.view = this.idle(reason);
    this.o.onChange();
    return { ok: false, reason };
  }

  async retry(): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.item ? this.start(this.item.id, true) : this.next();
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.token++;
    this.run = null;
    this.item = null;
    this.view = { ...this.idle(), set: this.set };
    this.o.onChange();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** When the Puzzles tab opens: puzzles due again come first, else the next new one. */
  open(): Promise<{ ok: true } | { ok: false; reason: string }> {
    // a puzzle still being solved stays; one that is over makes way for what is due
    if (this.view.status === 'solving') return Promise.resolve({ ok: true });
    if (this.dueIds().length) this.set = { kind: 'due' };
    else if (this.set.kind === 'due') this.set = { kind: 'games' };
    return this.next();
  }

  /** Puzzles were added or removed: the counts on the page follow. */
  refresh() {
    this.countMastery();
    this.view = { ...this.view, ...this.counts() };
    this.o.onChange();
  }

  /** What the engine's checked facts say about a move from a position, as plain words. */
  private async verdictOn(fen: string, move: string, you: PuzzleRun['you']): Promise<string | undefined> {
    try {
      const r = await this.o.facts.checkMove(fen, move, you);
      if (!r.legal) return undefined;
      const main = r.facts.find((f) => f.id === r.factId);
      return main ? plainText(main.text) : undefined;
    } catch (e) {
      this.o.log?.(`puzzle: the engine could not judge ${move}: ${(e as Error).message}`);
      return undefined;
    }
  }

  /** The puzzle is over: log the attempt, and say why the solution works (the puzzle's own checked words, or the engine's fact). */
  private finish(headline: string) {
    const run = this.run;
    const item = this.item;
    if (!run || !item) return;
    const result = attemptOf(run);
    if (result && !this.logged) {
      this.logged = true;
      const ms = Date.now() - this.startedAt;
      this.o.db.addAttempt({ contentId: item.id, result: result.result, hints: result.hints, misses: result.misses, ms, again: this.again });
      this.countMastery();
      if (this.set.kind === 'woodpecker') this.woodpeckerDone(item.id, { solved: result.result === 'solved', alone: result.clean, ms });
      if (!this.sitting.includes(item.id)) this.sitting.push(item.id);
      this.o.onDrill?.({ kind: 'done', how: result.result, clean: result.clean, example: this.exampling });
      this.o.db.logEvent('puzzle', { id: item.id, ...result, again: this.again });
      if (!this.again && (item.type === 'puzzle_game' || item.type === 'puzzle_db')) {
        const token = this.token;
        void this.schedule(item.id, item.type, { result: result.result, hints: result.hints, misses: result.misses, ms })
          .then((due) => {
            if (token === this.token && due) {
              this.view = { ...this.view, comesBack: due, ...this.counts() };
              this.o.onChange();
            }
          })
          .catch((e) => this.o.log?.(`puzzle: could not schedule ${item.id}: ${(e as Error).message}`));
      }
    }
    const tone = run.status === 'solved' ? 'good' : 'answer';
    const own = run.puzzle.explanation?.trim();
    this.show({ tone, text: own ? `${headline} ${plainText(own)}` : headline });
    if (own) return;
    const token = this.token;
    const start = solverStart(run.puzzle);
    if (!start.ok) return;
    void this.verdictOn(start.fen, run.puzzle.solution[0]!, run.you).then((why) => {
      if (why && token === this.token) this.show({ tone, text: `${headline} ${why}` });
    });
  }

  /** The owner plays a move on the puzzle's board. */
  move(from: string, to: string, promotion?: string): { ok: true } | { ok: false; reason: string } {
    const run = this.run;
    const w = this.o.words;
    if (!run || !yourTurn(run)) return { ok: false, reason: 'It is not your move in the puzzle.' };
    const text = `${from}${to}${promotion ? (promotion[0] === 'k' ? 'n' : promotion[0]) : ''}`;
    const fen = runFen(run);
    const a = answer(run, text);
    if (a.result === 'illegal' || a.result === 'not-now') return { ok: false, reason: 'That move is not legal there.' };
    this.run = a.run;
    if (a.result === 'wrong') {
      // the stop rule: after the misses allowed, the answer is given
      if (a.run.misses >= this.o.maxMisses()) {
        this.run = reveal(a.run);
        this.finish(w['shown.misses']);
        return { ok: true };
      }
      // what the move runs into, from the engine's facts: said as soon as the engine has looked
      this.show({ tone: 'wrong', text: w['wrong.checking'] });
      if (a.san) this.o.onDrill?.({ kind: 'miss', fenBefore: fen, san: a.san });
      const token = this.token;
      const misses = a.run.misses;
      void this.verdictOn(fen, a.san!, run.you).then((why) => {
        if (token !== this.token || !this.run || this.run.status !== 'solving' || this.run.misses !== misses) return;
        this.show({ tone: 'wrong', text: why ? `${w.wrong} ${why}` : w.wrong });
      });
      return { ok: true };
    }
    if (a.run.status === 'solved') {
      this.finish(a.result === 'also' ? w['solved.also'] : a.run.hints === 0 && a.run.misses === 0 ? w['solved.clean'] : w.solved);
      return { ok: true };
    }
    // right so far: the reply comes, and the owner goes on
    this.view = { ...this.view, feedback: undefined };
    this.show();
    const token = this.token;
    this.later(500, () => {
      if (token !== this.token || !this.run) return;
      this.run = playReply(this.run);
      this.show();
    });
    return { ok: true };
  }

  /** The next rung of the hint ladder: a question, a nudge at the piece, the move as an arrow, then the answer. */
  hint() {
    const run = this.run;
    const w = this.o.words;
    if (!run || !yourTurn(run)) return;
    const rung = nextRung(run);
    if (rung === 'answer') return this.showAnswer();
    const move = expectedMove(run);
    this.run = { ...run, hints: run.hints + 1 };
    if (rung === 'question') return this.show({ tone: 'hint', text: w['hint.question'] });
    if (rung === 'nudge') return this.show({ tone: 'hint', text: move ? w['hint.nudge'].replace('{role}', move.role).replace('{square}', move.from) : w['hint.question'] });
    this.show({ tone: 'hint', text: w['hint.arrow'] }, move ? [{ from: move.from, to: move.to, style: 'idea' }] : []);
  }

  /** "Show me": the rest of the solution is played out. */
  showAnswer() {
    const run = this.run;
    if (!run || run.status !== 'solving') return;
    this.run = reveal(run);
    this.finish(this.o.words.shown);
  }

  /** The puzzle on the board as the drill coach sees it, or null when none is. */
  drillState(): DrillState | null {
    const run = this.run;
    const item = this.item;
    if (!run || !item || this.view.status === 'idle') return null;
    const start = solverStart(run.puzzle);
    const last = run.moves.at(-1);
    const before = run.moves.length >= 2 ? run.moves.at(-2)!.fen : run.puzzle.fen;
    return {
      id: item.id,
      fen: runFen(run),
      solverFen: start.ok ? start.fen : run.puzzle.fen,
      you: run.you,
      solving: run.status === 'solving',
      set: this.set,
      task: this.view.task,
      themes: run.puzzle.themes.filter((t) => !NOT_A_THEME.has(t)),
      solution: run.puzzle.solution,
      accepted: run.puzzle.accepted ?? {},
      hints: run.hints,
      misses: run.misses,
      stage: this.stage,
      lastMove: last && last.by === 'them' ? { fenBefore: before, san: last.san } : undefined,
    };
  }

  /** The coach gave help on the puzzle (the owner asked it): it counts as a rung of the hint ladder. */
  noteHelp() {
    const run = this.run;
    if (!run || run.status !== 'solving') return;
    this.run = { ...run, hints: run.hints + 1 };
    this.show();
  }

  /** Stop with a reason on the page. */
  private stopWith(problem: string): { ok: false; reason: string } {
    this.run = null;
    this.item = null;
    this.view = this.idle(problem);
    this.o.onChange();
    return { ok: false, reason: problem };
  }

  /**
   * Woodpecker (C6): the next puzzle of the round under way, in the set's order. With no set yet, one
   * is made from the puzzles the owner has met; a round that is over is followed by the next only
   * when the owner asks (`woodpeckerRound`).
   */
  private woodpeckerNext(): { ok: true } | { ok: false; reason: string } {
    const m = this.modes();
    if (!m.woodpecker) return this.stopWith('Woodpecker rounds are off. They can be switched on in Settings, under Puzzles.');
    let set = this.o.db.woodpeckerSet();
    if (!set) {
      const items = this.o.db.woodpeckerPool(m.woodpeckerSize);
      if (items.length < 5) return this.stopWith('A Woodpecker set is made from puzzles you have met: solve at least five first.');
      set = this.o.db.newWoodpeckerSet(items);
    }
    const rounds = this.o.db.woodpeckerRounds(set.id);
    const last = rounds.at(-1);
    if (!last) return this.woodpeckerRound();
    if (last.ms !== undefined) return this.stopWith(`Round ${last.round} is done.`);
    this.round = { id: last.id, round: last.round, items: set.items, done: last.done.map((d) => ({ ms: 0, ...d })) };
    for (const id of set.items) {
      if (this.round.done.some((d) => d.id === id)) continue;
      // a second go when the puzzle has been met before: it does not move the schedule
      const r = this.start(id, this.o.db.attemptsOf(id).length > 0);
      if (r.ok) return r;
      // a puzzle that cannot be played any more (removed, or off limits) counts as not solved
      this.woodpeckerDone(id, { solved: false, alone: false, ms: 0 });
      if (this.view.woodpecker?.over) return { ok: false, reason: this.view.problem ?? 'The round is over.' };
    }
    return this.stopWith(`Round ${last.round} is done.`);
  }

  /** Start the next Woodpecker round on the same set. */
  woodpeckerRound(): { ok: true } | { ok: false; reason: string } {
    const set = this.o.db.woodpeckerSet();
    if (!set || !this.modes().woodpecker) return this.woodpeckerNext();
    const rounds = this.o.db.woodpeckerRounds(set.id);
    if (rounds.at(-1) && rounds.at(-1)!.ms === undefined) return this.woodpeckerNext();
    this.o.db.startWoodpeckerRound(set.id, (rounds.at(-1)?.round ?? 0) + 1);
    this.set = { kind: 'woodpecker' };
    return this.woodpeckerNext();
  }

  /** A new Woodpecker set, from the puzzles met most recently. */
  woodpeckerNew(): { ok: true } | { ok: false; reason: string } {
    const m = this.modes();
    if (!m.woodpecker) return this.woodpeckerNext();
    const items = this.o.db.woodpeckerPool(m.woodpeckerSize);
    if (items.length < 5) return this.stopWith('A Woodpecker set is made from puzzles you have met: solve at least five first.');
    this.o.db.newWoodpeckerSet(items);
    this.set = { kind: 'woodpecker' };
    return this.woodpeckerRound();
  }

  /** One puzzle of the round is done; the last one ends the round, its time the sum of the puzzles' times. */
  private woodpeckerDone(id: number, d: { solved: boolean; alone: boolean; ms: number }) {
    const round = this.round;
    if (!round || round.done.some((x) => x.id === id)) return;
    round.done.push({ id, ...d });
    const over = round.done.length >= round.items.length;
    this.o.db.woodpeckerDone(round.id, round.done, over ? round.done.reduce((s, x) => s + x.ms, 0) : undefined);
    if (over) this.round = null;
    this.view = { ...this.view, woodpecker: this.woodpeckerView() };
  }

  /** A worked example for a new idea (G7, DP3): the solution played out before the owner has tried. It counts as shown, so the puzzle comes back soon. */
  example() {
    const run = this.run;
    if (!run || run.status !== 'solving' || !this.guide(run)?.offerExample) return;
    this.o.db.logEvent('worked_example', { id: this.item?.id, motif: this.stage?.motif });
    this.run = reveal(run);
    this.exampling = true;
    try {
      this.finish(this.o.words.example);
    } finally {
      this.exampling = false;
    }
  }
}
