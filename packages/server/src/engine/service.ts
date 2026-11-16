// The engine service (ARCHITECTURE §10): pools of single-threaded Stockfish processes, a queue,
// a cache, validate-before-send, and restart-and-retry when a process dies.
//
// Why single-threaded workers: a node-limited search on one thread from a clean hash gives the
// same answer every time (decision D25). Speed comes from running several workers side by side.

import { parsePosition, fenOf, positionKey, uciToMove, type EngineLine } from '@chess-coach/core';
import { EngineCrashed, UciEngine, type SearchResult } from './uci.ts';

export type PoolName = 'quick' | 'analysis';

export type AnalyseRequest = {
  fen: string;
  nodes: number;
  multipv?: number;
  searchmoves?: string[];
  pool?: PoolName;
};

export type AnalyseResult = { fen: string; lines: EngineLine[]; nodes: number; depth: number; ms: number; cached: boolean; /** reads of the endgame tablebases during the search */ tbhits?: number };

export type EngineCacheStore = {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
};

export type EngineServiceOptions = {
  path: string;
  syzygyPath?: string;
  quickWorkers?: number;
  analysisWorkers?: number;
  hashMb?: number;
  expectedBench?: number;
  cache?: EngineCacheStore;
  log?: (msg: string) => void;
};

type Job = { req: AnalyseRequest & { fen: string }; resolve: (r: SearchResult) => void; reject: (e: Error) => void; tries: number };

class Pool {
  private workers: UciEngine[] = [];
  private idle: UciEngine[] = [];
  private queue: Job[] = [];
  private starting = 0;
  restarts = 0;

  private readonly size: number;
  private readonly make: () => UciEngine;
  private readonly log: (msg: string) => void;

  constructor(size: number, make: () => UciEngine, log: (msg: string) => void) {
    this.size = size;
    this.make = make;
    this.log = log;
  }

  private async spawnWorker(): Promise<void> {
    this.starting++;
    const engine = this.make();
    try {
      await engine.start();
      this.workers.push(engine);
      this.idle.push(engine);
    } finally {
      this.starting--;
    }
    this.pump();
  }

  submit(req: Job['req']): Promise<SearchResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ req, resolve, reject, tries: 0 });
      this.pump();
    });
  }

  get pending(): number {
    return this.queue.length;
  }

  private pump() {
    while (this.queue.length && this.idle.length) {
      const engine = this.idle.pop()!;
      const job = this.queue.shift()!;
      void this.run(engine, job);
    }
    const wanted = Math.min(this.size, this.queue.length + this.workers.length - this.idle.length);
    while (this.queue.length && this.workers.length + this.starting < Math.max(1, wanted)) {
      this.spawnWorker().catch((e) => {
        const job = this.queue.shift();
        job?.reject(e instanceof Error ? e : new Error(String(e)));
      });
    }
  }

  private async run(engine: UciEngine, job: Job) {
    try {
      const result = await engine.search(job.req);
      this.idle.push(engine);
      job.resolve(result);
    } catch (e) {
      if (e instanceof EngineCrashed) {
        // the process is gone: drop it, start a fresh one, retry this job once
        this.workers = this.workers.filter((w) => w !== engine);
        engine.kill();
        this.restarts++;
        this.log(`engine worker died (${e.message}); restarting`);
        if (job.tries < 1) {
          job.tries++;
          this.queue.unshift(job);
        } else {
          job.reject(e);
        }
      } else {
        this.idle.push(engine);
        job.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
    this.pump();
  }

  /** For the crash test: the raw engines. */
  get engines(): UciEngine[] {
    return this.workers;
  }

  async stop() {
    const all = this.workers;
    this.workers = [];
    this.idle = [];
    for (const job of this.queue) job.reject(new Error('engine service stopped'));
    this.queue = [];
    await Promise.all(all.map((w) => w.quit()));
  }
}

export class EngineService {
  private pools: Record<PoolName, Pool>;
  private memory = new Map<string, string>();
  private inflight = new Map<string, Promise<AnalyseResult>>();
  private log: (msg: string) => void;
  /** the engine build's fingerprint; part of every cache key (decision D31) */
  signature = 'unchecked';
  stats = { searches: 0, cacheHits: 0, nodes: 0 };

  private readonly opts: EngineServiceOptions;

  constructor(opts: EngineServiceOptions) {
    this.opts = opts;
    this.log = opts.log ?? (() => {});
    const make = () => new UciEngine(opts.path, { threads: 1, hashMb: opts.hashMb ?? 64, syzygyPath: opts.syzygyPath });
    this.pools = {
      quick: new Pool(opts.quickWorkers ?? 2, make, this.log),
      analysis: new Pool(opts.analysisWorkers ?? 6, make, this.log),
    };
  }

  /** Run `bench` once and compare it with the expected fingerprint. */
  async verify(): Promise<{ ok: boolean; bench: number; name: string }> {
    const engine = new UciEngine(this.opts.path, { threads: 1, hashMb: 16 });
    await engine.start();
    try {
      const bench = await engine.bench();
      this.signature = `${engine.name}#${bench}`;
      const ok = this.opts.expectedBench === undefined || bench === this.opts.expectedBench;
      if (!ok) this.log(`engine bench is ${bench}, expected ${this.opts.expectedBench}: this is a different build; cached answers from the old build are not reused`);
      return { ok, bench, name: engine.name };
    } finally {
      await engine.quit();
    }
  }

  private key(req: AnalyseRequest, fen: string): string {
    return [this.signature, positionKey(fen), req.nodes, req.multipv ?? 1, (req.searchmoves ?? []).join(',')].join('|');
  }

  /** Analyse a position. The position and any restricted moves are checked with the rules first. */
  analyse(req: AnalyseRequest): Promise<AnalyseResult> {
    const pos = parsePosition(req.fen);
    if (!pos) return Promise.reject(new Error(`invalid position, not sent to the engine: ${req.fen}`));
    if (pos.isEnd()) return Promise.resolve({ fen: fenOf(pos), lines: [], nodes: 0, depth: 0, ms: 0, cached: true });
    for (const uci of req.searchmoves ?? []) {
      if (!uciToMove(pos, uci)) return Promise.reject(new Error(`illegal move, not sent to the engine: ${uci}`));
    }
    const fen = fenOf(pos);
    const key = this.key(req, fen);
    const hit = this.memory.get(key) ?? this.opts.cache?.get(key);
    if (hit) {
      this.stats.cacheHits++;
      this.memory.set(key, hit);
      return Promise.resolve({ ...(JSON.parse(hit) as Omit<AnalyseResult, 'cached' | 'fen'>), fen, cached: true });
    }
    const running = this.inflight.get(key);
    if (running) return running;
    const promise = this.pools[req.pool ?? 'quick']
      .submit({ ...req, fen })
      .then((r) => {
        this.stats.searches++;
        this.stats.nodes += r.nodes;
        const value = { lines: r.lines, nodes: r.nodes, depth: r.depth, ms: r.ms, tbhits: r.tbhits };
        const json = JSON.stringify(value);
        this.memory.set(key, json);
        if (this.memory.size > 20_000) this.memory.delete(this.memory.keys().next().value!);
        this.opts.cache?.set(key, json);
        return { ...value, fen, cached: false };
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  /** The answer to a request if it has already been worked out (memory or database); never searches. */
  cached(req: AnalyseRequest): AnalyseResult | undefined {
    const pos = parsePosition(req.fen);
    if (!pos) return undefined;
    const fen = fenOf(pos);
    const key = this.key(req, fen);
    const hit = this.memory.get(key) ?? this.opts.cache?.get(key);
    if (!hit) return undefined;
    this.memory.set(key, hit);
    return { ...(JSON.parse(hit) as Omit<AnalyseResult, 'cached' | 'fen'>), fen, cached: true };
  }

  get restarts(): number {
    return this.pools.quick.restarts + this.pools.analysis.restarts;
  }

  /** Test hook: the live engine processes of a pool. */
  enginesOf(pool: PoolName): UciEngine[] {
    return this.pools[pool].engines;
  }

  async stop() {
    await Promise.all([this.pools.quick.stop(), this.pools.analysis.stop()]);
  }
}
