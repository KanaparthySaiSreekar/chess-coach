// Lichess's cloud analysis (https://lichess.org/api/cloud-eval): deep Stockfish analysis that
// Lichess keeps for positions people have analysed. The owner's rule (decision D33): every verdict
// the coach states is checked against Lichess's best moves when Lichess has the position, and the
// deeper analysis wins.
//
// One request at a time, a short timeout, a pause of a minute after a 429, and every answer cached
// in the database (Lichess's API guidelines). No token: this endpoint needs none. A generic client
// name, no personal details (ARCHITECTURE §12, §15).

import { engineUci, mustPosition, parsePosition, positionKey, uciToMove, type EngineLine } from '@chess-coach/core';
import type { Db } from './db.ts';

export type CloudEval = { depth: number; knodes: number; lines: EngineLine[] };

export interface CloudSource {
  evaluate(fen: string, multiPv: number): Promise<CloudEval | null>;
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

const MISS_TTL_MS = 24 * 60 * 60 * 1000;

/** Lichess's lines → the engine's own conventions: side-to-move scores, castling as the king's move. */
export function normaliseCloud(fen: string, raw: { depth?: number; knodes?: number; pvs?: { moves?: string; cp?: number; mate?: number }[] }): CloudEval | null {
  const pos = parsePosition(fen);
  if (!pos || !Array.isArray(raw.pvs)) return null;
  const sign = pos.turn === 'white' ? 1 : -1; // Lichess scores are from White's side
  const lines: EngineLine[] = [];
  for (const pv of raw.pvs) {
    const walk = mustPosition(fen);
    const moves: string[] = [];
    for (const uci of (pv.moves ?? '').split(' ').filter(Boolean)) {
      const move = uciToMove(walk, uci);
      if (!move) break;
      moves.push(engineUci(walk, move));
      walk.play(move);
    }
    if (!moves.length) continue;
    const score = typeof pv.mate === 'number' ? { mate: sign * pv.mate } : { cp: sign * (pv.cp ?? 0) };
    lines.push({ pv: moves, score });
  }
  return lines.length ? { depth: Number(raw.depth ?? 0), knodes: Number(raw.knodes ?? 0), lines } : null;
}

export class LichessCloud implements CloudSource {
  private chain: Promise<unknown> = Promise.resolve();
  private pausedUntil = 0;
  private readonly db: Db;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly log: (msg: string) => void;
  stats = { requests: 0, hits: 0, misses: 0, cached: 0, errors: 0 };

  constructor(db: Db, opts: { fetch?: FetchLike; timeoutMs?: number; log?: (msg: string) => void } = {}) {
    this.db = db;
    this.fetchFn = opts.fetch ?? (fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 2500;
    this.log = opts.log ?? (() => {});
  }

  async evaluate(fen: string, multiPv: number): Promise<CloudEval | null> {
    const pos = parsePosition(fen);
    if (!pos || pos.isEnd()) return null;
    const key = `${positionKey(fen)}|${multiPv}`;
    const hit = this.db.cacheGet('lichess_cache', key);
    if (hit) {
      const age = Date.now() - Date.parse(hit.at);
      if (hit.value !== 'none') {
        this.stats.cached++;
        return JSON.parse(hit.value) as CloudEval;
      }
      if (age < MISS_TTL_MS) return null;
    }
    if (Date.now() < this.pausedUntil) return null;
    // one request at a time
    const run = this.chain.then(() => this.request(fen, multiPv, key));
    this.chain = run.catch(() => {});
    return run;
  }

  private async request(fen: string, multiPv: number, key: string): Promise<CloudEval | null> {
    this.stats.requests++;
    const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`;
    try {
      const res = await this.fetchFn(url, { headers: { Accept: 'application/json', 'User-Agent': 'chess-coach-local/0.1' }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (res.status === 429) {
        this.pausedUntil = Date.now() + 60_000;
        this.log('Lichess cloud analysis asked us to slow down: pausing it for a minute');
        return null;
      }
      if (res.status === 404) {
        this.stats.misses++;
        this.db.cacheSet('lichess_cache', key, 'none');
        return null;
      }
      if (res.status !== 200) {
        this.stats.errors++;
        return null;
      }
      const value = normaliseCloud(fen, (await res.json()) as Parameters<typeof normaliseCloud>[1]);
      if (!value) {
        this.db.cacheSet('lichess_cache', key, 'none');
        return null;
      }
      this.stats.hits++;
      this.db.cacheSet('lichess_cache', key, JSON.stringify(value));
      return value;
    } catch (e) {
      this.stats.errors++;
      this.log(`Lichess cloud analysis unavailable: ${(e as Error).message}`);
      return null;
    }
  }
}
