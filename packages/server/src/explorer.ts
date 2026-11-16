// The Lichess opening explorer (https://lichess.org/api#tag/Opening-Explorer; ARCHITECTURE §12;
// features I3, D6; PLAN WP 8.2).
//
// The explorer needs the owner's Lichess token (no scopes). The rules from spike S5 (D45): one call
// at a time, at least three seconds apart, a full minute's pause after a 429, and every answer kept
// in the database so a position is never asked for twice. When the owner clicks through moves faster
// than that, only the newest position is asked for: a call still waiting for its turn is dropped for
// the newer one ("superseded"). The token goes only to explorer.lichess.org, in the Authorization
// header; it is never logged. Nothing else about the owner is sent: the position and the filters.

import { positionKey, type RawExplorerAnswer } from '@chess-coach/core';
import type { Db } from './db.ts';
import type { Http } from './importers.ts';

export type ExplorerQuery = { db: 'lichess' | 'masters'; fen: string; ratings: readonly number[]; speeds: readonly string[] };
export type ExplorerFailure = 'no-token' | 'bad-token' | 'slow-down' | 'unavailable' | 'superseded';
export type ExplorerAnswer = { ok: true; raw: RawExplorerAnswer; cached: boolean } | { ok: false; why: ExplorerFailure };

/** Lichess marks answers as good for a day; they are counts over millions of games, so a month is kept (D45). */
export const EXPLORER_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
export const EXPLORER_GAP_MS = 3000;
const PAUSE_MS = 60_000;

/** The words the page shows for each way a call can fail. */
export const FAILURE_TEXT: Record<Exclude<ExplorerFailure, 'superseded'>, string> = {
  'no-token': 'Lichess needs your API token for its explorer, and none is set.',
  'bad-token': 'Lichess refused your API token (it may have been revoked).',
  'slow-down': 'Lichess asked for a pause: the explorer is asked again in a minute.',
  unavailable: 'Lichess could not be reached.',
};

export function explorerKey(q: ExplorerQuery): string {
  return q.db === 'masters' ? `masters|${positionKey(q.fen)}` : `lichess|${positionKey(q.fen)}|${[...q.ratings].sort((a, b) => a - b).join(',')}|${[...q.speeds].sort().join(',')}`;
}

export function explorerUrl(q: ExplorerQuery): string {
  if (q.db === 'masters') return `https://explorer.lichess.org/masters?${new URLSearchParams({ fen: q.fen, moves: '12', topGames: '0' })}`;
  const p = new URLSearchParams({ variant: 'standard', fen: q.fen, speeds: q.speeds.join(','), ratings: q.ratings.join(','), moves: '12', topGames: '0', recentGames: '0' });
  return `https://explorer.lichess.org/lichess?${p}`;
}

type Job = { q: ExplorerQuery; key: string; promise: Promise<ExplorerAnswer>; resolve: (a: ExplorerAnswer) => void };

export class LichessExplorer {
  private readonly db: Db;
  private readonly http: Http;
  private readonly token: () => string | undefined;
  private readonly gapMs: number;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private lastSent = -Infinity;
  private pausedUntil = 0;
  private waiting: Job | null = null;
  /** calls for a job that needs every answer (a repertoire's gate V4): in order, never dropped, after the panel's */
  private batch: Job[] = [];
  private inFlight: Job | null = null;
  private timer: NodeJS.Timeout | null = null;
  stats = { requests: 0, cached: 0, refused: 0, errors: 0, superseded: 0 };

  constructor(opts: { db: Db; http: Http; token: () => string | undefined; gapMs?: number; now?: () => number; log?: (msg: string) => void }) {
    this.db = opts.db;
    this.http = opts.http;
    this.token = opts.token;
    this.gapMs = opts.gapMs ?? EXPLORER_GAP_MS;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  /** The kept answer, if there is one still fresh: no call. */
  cached(q: ExplorerQuery): RawExplorerAnswer | undefined {
    const hit = this.db.cacheGet('explorer_cache', explorerKey(q));
    if (!hit || this.now() - Date.parse(hit.at) > EXPLORER_KEEP_MS) return undefined;
    return JSON.parse(hit.value) as RawExplorerAnswer;
  }

  /** Is a call possible at all now (a token, no pause)? */
  get ready(): boolean {
    return !!this.token() && this.now() >= this.pausedUntil;
  }

  /**
   * The answer for a position. The panel's asks (the default) keep only the newest waiting; a
   * `batch` ask (a repertoire's gates) waits its turn in order, through a pause too, and is never dropped.
   */
  async ask(q: ExplorerQuery, opts: { batch?: boolean } = {}): Promise<ExplorerAnswer> {
    const key = explorerKey(q);
    const fresh = this.cached(q);
    if (fresh) {
      this.stats.cached++;
      return { ok: true, raw: fresh, cached: true };
    }
    if (!this.token()) return this.stale(key) ?? { ok: false, why: 'no-token' };
    if (!opts.batch && this.now() < this.pausedUntil) return this.stale(key) ?? { ok: false, why: 'slow-down' };
    // the same position already on its way, or waiting: share it
    if (this.inFlight?.key === key) return this.inFlight.promise;
    if (this.waiting?.key === key) return this.waiting.promise;
    const queued = this.batch.find((j) => j.key === key);
    if (queued) return queued.promise;
    let resolve!: (a: ExplorerAnswer) => void;
    const promise = new Promise<ExplorerAnswer>((r) => (resolve = r));
    const job = { q, key, promise, resolve };
    if (opts.batch) this.batch.push(job);
    else {
      // only the newest position waits for its turn
      if (this.waiting) {
        this.stats.superseded++;
        this.waiting.resolve({ ok: false, why: 'superseded' });
      }
      this.waiting = job;
    }
    this.pump();
    return promise;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.waiting?.resolve({ ok: false, why: 'superseded' });
    this.waiting = null;
    for (const j of this.batch) j.resolve({ ok: false, why: 'superseded' });
    this.batch = [];
  }

  private pump() {
    if (this.inFlight || (!this.waiting && !this.batch.length) || this.timer) return;
    const wait = Math.max(this.lastSent + this.gapMs, this.pausedUntil) - this.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, wait);
      this.timer.unref?.();
      return;
    }
    const job = this.waiting ?? this.batch.shift()!;
    if (job === this.waiting) this.waiting = null;
    this.inFlight = job;
    this.lastSent = this.now();
    void this.send(job)
      .then(job.resolve)
      .finally(() => {
        this.inFlight = null;
        this.pump();
      });
  }

  private async send(job: Job): Promise<ExplorerAnswer> {
    const token = this.token();
    if (!token) return { ok: false, why: 'no-token' };
    this.stats.requests++;
    try {
      const res = await this.http(explorerUrl(job.q), { Accept: 'application/json', Authorization: `Bearer ${token}` }, 15_000);
      if (res.status === 429) {
        this.stats.refused++;
        this.pausedUntil = this.now() + PAUSE_MS;
        this.log('the Lichess explorer asked for a pause: not asked again for a minute');
        return this.stale(job.key) ?? { ok: false, why: 'slow-down' };
      }
      if (res.status === 401 || res.status === 403) {
        this.stats.errors++;
        return this.stale(job.key) ?? { ok: false, why: 'bad-token' };
      }
      if (res.status !== 200) {
        this.stats.errors++;
        return this.stale(job.key) ?? { ok: false, why: 'unavailable' };
      }
      const raw = JSON.parse(await res.text()) as RawExplorerAnswer;
      if (!raw || !Array.isArray(raw.moves)) {
        this.stats.errors++;
        return { ok: false, why: 'unavailable' };
      }
      this.db.cacheSet('explorer_cache', job.key, JSON.stringify(raw));
      return { ok: true, raw, cached: false };
    } catch (e) {
      this.stats.errors++;
      this.log(`the Lichess explorer could not be reached: ${(e as Error).message}`);
      return this.stale(job.key) ?? { ok: false, why: 'unavailable' };
    }
  }

  /** An answer older than a month is still better than none when Lichess cannot be asked. */
  private stale(key: string): ExplorerAnswer | null {
    const hit = this.db.cacheGet('explorer_cache', key);
    return hit ? { ok: true, raw: JSON.parse(hit.value) as RawExplorerAnswer, cached: true } : null;
  }
}
