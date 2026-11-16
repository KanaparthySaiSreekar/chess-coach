// Speed runs (feature I4; PLAN WP 6.10): streak and timed. Off by default (\`puzzles.speedModes\`):
// at the owner's level speed is secondary. Puzzles come from the Lichess database through the
// gates, starting below the practice level and getting harder with each one solved. A run is
// silent: there are no hints, nothing is explained, and this controller has no access to the
// engine or the coach at all. Its answers are logged as second goes, so they move neither the
// schedule, nor the practice level, nor motif mastery (TRACKER D68).

import {
  SPEED,
  answer,
  playReply,
  playSetup,
  reveal,
  runFen,
  speedRating,
  startRun,
  yourTurn,
  type ContentItem,
  type Puzzle,
  type PuzzleRun,
  type SpeedMode,
  type SpeedView,
} from '@chess-coach/core';
import type { ContentService } from './content.ts';
import type { PuzzleDb } from './datasets/puzzle-db.ts';
import type { Db } from './db.ts';
import { bandOf, puzzleFromDb } from './puzzles.ts';

const EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';

export type SpeedOptions = {
  db: Db;
  content: ContentService;
  puzzleDb: () => PuzzleDb | null;
  /** the owner's practice level: a run starts below it */
  level: () => number;
  /** \`puzzles.speedModes\` */
  enabled: () => boolean;
  /** how long a timed run lasts */
  seconds: () => number;
  /** fair play: is this position off limits? */
  guard: (fens: string[]) => string | null;
  onChange: () => void;
};

export class SpeedController {
  view: SpeedView;
  private run: PuzzleRun | null = null;
  private item: (ContentItem<Puzzle> & { id: number }) | null = null;
  private mode: SpeedMode = 'streak';
  private level = 0;
  private startedAt = 0;
  private deadline = 0;
  private timer: NodeJS.Timeout | null = null;
  /** goes up on every start, stop and close, so a draw that comes back late is dropped */
  private token = 0;
  private log: NonNullable<SpeedView['log']> = [];
  private readonly o: SpeedOptions;

  constructor(o: SpeedOptions) {
    this.o = o;
    this.view = this.idle();
  }

  /** Is a run under way? The coach is not woken while one is. */
  get active(): boolean {
    return this.view.status === 'running';
  }

  private best(): SpeedView['best'] {
    const best = { streak: 0, timed: 0 };
    for (const row of this.o.db.recentEvents('speed_run', 10_000)) {
      try {
        const d = JSON.parse(row.data) as { mode: SpeedMode; solved: number };
        if (d.mode === 'streak' || d.mode === 'timed') best[d.mode] = Math.max(best[d.mode], d.solved);
      } catch {
        /* a row that cannot be read counts for nothing */
      }
    }
    return best;
  }

  private idle(problem?: string): SpeedView {
    return { status: 'idle', fen: EMPTY, you: 'white', yourTurn: false, tries: 0, solved: 0, misses: 0, best: this.best(), silent: true, enabled: this.o.enabled(), problem };
  }

  private set(view: Partial<SpeedView>) {
    this.view = { ...this.view, ...view };
    this.o.onChange();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Start a run. */
  async start(mode: SpeedMode): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.token++;
    this.clearTimer();
    if (!this.o.enabled()) {
      this.view = this.idle('Speed runs are off. They can be switched on in Settings, under Puzzles.');
      this.o.onChange();
      return { ok: false, reason: this.view.problem! };
    }
    if (!this.o.puzzleDb()) {
      this.view = this.idle('Speed runs use the Lichess puzzle database. Install it once with: npm run content:install -- puzzles');
      this.o.onChange();
      return { ok: false, reason: this.view.problem! };
    }
    this.mode = mode;
    this.level = this.o.level();
    this.log = [];
    this.view = { ...this.idle(), status: 'running', mode, solved: 0, misses: 0 };
    if (mode === 'timed') {
      this.deadline = Date.now() + this.o.seconds() * 1000;
      this.arm();
    } else this.deadline = 0;
    return this.next();
  }

  /** A timed run ends when its time is up. */
  private arm() {
    this.clearTimer();
    const token = this.token;
    this.view = { ...this.view, endsAt: new Date(this.deadline).toISOString() };
    this.timer = setTimeout(() => {
      if (token === this.token && this.active) this.end();
    }, Math.max(0, this.deadline - Date.now()));
    this.timer.unref?.();
  }

  /** The next puzzle of the run, a little harder than the last. */
  private async next(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const token = this.token;
    const db = this.o.puzzleDb();
    const rating = speedRating(this.mode, this.level, this.view.solved);
    const found = db ? db.near({ rating, count: 6, exclude: this.o.db.drawnPuzzleIds(), minPopularity: 50 }) : [];
    for (const p of found) {
      const puzzle = puzzleFromDb(p);
      if (!puzzle) continue;
      const item = await this.o.content.submit({ type: 'puzzle_db', status: 'draft', source: `puzzle:${p.id}`, licence: 'cc0', level: bandOf(p.rating), gates: [], body: puzzle });
      if (token !== this.token) return { ok: false, reason: 'The run was stopped.' };
      if (item.status !== 'live') continue;
      const started = startRun(item.body);
      if (!started.ok) continue;
      // no pause in a run: the opponent's set-up move is played at once, and shown as the last move
      const run = playSetup(started.run);
      if (this.o.guard([runFen(run)])) continue;
      this.item = item as ContentItem<Puzzle> & { id: number };
      this.run = run;
      this.startedAt = Date.now();
      this.show();
      return { ok: true };
    }
    this.end();
    return { ok: false, reason: 'No more puzzles near this rating.' };
  }

  private show(extra: Partial<SpeedView> = {}) {
    const run = this.run;
    if (!run) return;
    const last = run.moves.at(-1);
    this.set({ fen: runFen(run), lastMove: last ? [last.from, last.to] : undefined, you: run.you, yourTurn: this.active && yourTurn(run), ...extra });
  }

  /** A move on the board. A wrong one ends a streak, or costs time in a timed run. */
  move(from: string, to: string, promotion?: string) {
    const run = this.run;
    const item = this.item;
    if (!this.active || !run || !item || !yourTurn(run)) return;
    const a = answer(run, `${from}${to}${promotion ? (promotion[0] === 'k' ? 'n' : promotion[0]) : ''}`);
    if (a.result === 'illegal' || a.result === 'not-now') return this.set({ tries: this.view.tries + 1 });
    const rating = item.body.rating ?? 0;
    if (a.result === 'wrong') {
      this.o.db.addAttempt({ contentId: item.id, result: 'shown', hints: 0, misses: 1, ms: Date.now() - this.startedAt, again: true });
      this.log.push({ rating, solved: false, answer: item.body.solution[0] });
      if (this.mode === 'streak') {
        // the answer is played out on the board, and the run is over
        this.run = reveal(run);
        this.show({ misses: this.view.misses + 1, last: 'missed', tries: this.view.tries + 1 });
        return this.end();
      }
      this.deadline -= SPEED.penaltyMs;
      if (this.deadline <= Date.now()) {
        this.set({ misses: this.view.misses + 1, last: 'missed' });
        return this.end();
      }
      this.arm();
      this.set({ misses: this.view.misses + 1, last: 'missed', tries: this.view.tries + 1 });
      void this.next();
      return;
    }
    if (a.run.status === 'solved') {
      this.o.db.addAttempt({ contentId: item.id, result: 'solved', hints: 0, misses: 0, ms: Date.now() - this.startedAt, again: true });
      this.log.push({ rating, solved: true });
      this.run = a.run;
      this.set({ solved: this.view.solved + 1, last: 'solved' });
      void this.next();
      return;
    }
    // right so far: their reply comes at once
    this.run = playReply(a.run);
    this.show();
  }

  /** The run is over: its score is kept, and the puzzles of the run are listed. */
  private end() {
    if (!this.active) return;
    this.token++;
    this.clearTimer();
    this.o.db.logEvent('speed_run', { mode: this.mode, solved: this.view.solved, misses: this.view.misses });
    this.set({ status: 'over', yourTurn: false, log: this.log, best: this.best(), endsAt: undefined });
  }

  /** The owner stops the run. */
  stop() {
    this.end();
  }

  close() {
    this.token++;
    this.clearTimer();
    this.run = null;
    this.item = null;
    this.view = this.idle();
    this.o.onChange();
  }

  refresh() {
    this.set({ enabled: this.o.enabled(), best: this.best() });
  }
}
