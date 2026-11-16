// One Stockfish process, spoken to over UCI. One search at a time; the service queues.
// Stockfish ends its process on an invalid position, so callers validate first (service.ts);
// if it dies anyway, the pending search is rejected with EngineCrashed and the service restarts it.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EngineLine, Score } from '@chess-coach/core';

export class EngineCrashed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineCrashed';
  }
}

export type SearchRequest = {
  fen: string;
  nodes: number;
  multipv?: number;
  /** restrict the search to these root moves (UCI) */
  searchmoves?: string[];
};

export type SearchResult = { lines: EngineLine[]; nodes: number; depth: number; ms: number; bestmove: string; /** reads of the endgame tablebases during the search */ tbhits: number };

export type UciOptions = { threads?: number; hashMb?: number; syzygyPath?: string };

type Waiter = { test: (line: string) => boolean; resolve: (line: string) => void; reject: (e: Error) => void };

export class UciEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private waiters: Waiter[] = [];
  private listeners: ((line: string) => void)[] = [];
  private busy = false;
  private multipv = 1;
  name = '';
  alive = false;

  private readonly path: string;
  private readonly options: UciOptions;

  constructor(path: string, options: UciOptions = {}) {
    this.path = path;
    this.options = options;
  }

  async start(): Promise<void> {
    const child = spawn(this.path, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    this.alive = true;
    this.buffer = '';
    this.multipv = 1;
    child.stdout.on('data', (d: Buffer) => this.onData(d.toString('utf8')));
    // Stockfish writes the `bench` summary to stderr
    child.stderr.on('data', (d: Buffer) => this.onData(d.toString('utf8')));
    child.on('error', (e) => this.onExit(`engine failed to start: ${e.message}`));
    child.on('exit', (code) => this.onExit(`engine exited (code ${code})`));
    child.stdin.on('error', () => {});
    this.send('uci');
    const lines: string[] = [];
    const off = this.listen((l) => lines.push(l));
    await this.waitFor((l) => l === 'uciok', 10_000);
    off();
    this.name = lines.find((l) => l.startsWith('id name '))?.slice(8) ?? 'unknown';
    this.send(`setoption name Threads value ${this.options.threads ?? 1}`);
    this.send(`setoption name Hash value ${this.options.hashMb ?? 64}`);
    if (this.options.syzygyPath) this.send(`setoption name SyzygyPath value ${this.options.syzygyPath}`);
    await this.ready();
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      for (const l of this.listeners) l(line);
      const idx = this.waiters.findIndex((w) => w.test(line));
      if (idx >= 0) this.waiters.splice(idx, 1)[0]!.resolve(line);
    }
  }

  private onExit(reason: string) {
    if (!this.alive) return;
    this.alive = false;
    this.busy = false;
    const pending = this.waiters;
    this.waiters = [];
    this.listeners = [];
    for (const w of pending) w.reject(new EngineCrashed(reason));
  }

  private listen(fn: (line: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private waitFor(test: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.alive) return reject(new EngineCrashed('engine is not running'));
      const waiter: Waiter = {
        test,
        resolve: (l) => {
          clearTimeout(timer);
          resolve(l);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new EngineCrashed(`engine did not answer within ${timeoutMs} ms`));
        this.kill();
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Is a search (or a bench) running on this process right now? */
  get searching(): boolean {
    return this.busy;
  }

  /** Raw command. Only the service and the crash test use this directly. */
  send(command: string) {
    if (!this.child || !this.alive) throw new EngineCrashed('engine is not running');
    this.child.stdin.write(command + '\n');
  }

  async ready(timeoutMs = 20_000): Promise<void> {
    this.send('isready');
    await this.waitFor((l) => l === 'readyok', timeoutMs);
  }

  /** The node count of `bench`: the engine build's fingerprint (decision D31). */
  async bench(): Promise<number> {
    if (this.busy) throw new Error('engine is busy');
    this.busy = true;
    try {
      this.send('bench');
      const line = await this.waitFor((l) => /^Nodes searched\s*:/.test(l), 120_000);
      return Number(line.split(':')[1]!.trim());
    } finally {
      this.busy = false;
    }
  }

  /** A node-limited search from a clean hash, so the same request always gives the same answer on one thread. */
  async search(req: SearchRequest): Promise<SearchResult> {
    if (this.busy) throw new Error('engine is busy');
    this.busy = true;
    const started = Date.now();
    const multipv = Math.max(1, req.multipv ?? 1);
    const exact = new Map<number, { line: EngineLine; depth: number }>();
    const bound = new Map<number, { line: EngineLine; depth: number }>();
    let nodes = 0;
    let depth = 0;
    let tbhits = 0;
    const off = this.listen((l) => {
      if (!l.startsWith('info ') || !l.includes(' pv ')) return;
      const parsed = parseInfo(l);
      if (!parsed) return;
      nodes = parsed.nodes || nodes;
      tbhits = Math.max(tbhits, parsed.tbhits);
      depth = Math.max(depth, parsed.depth);
      (parsed.bound ? bound : exact).set(parsed.multipv, { line: { pv: parsed.pv, score: parsed.score }, depth: parsed.depth });
    });
    try {
      if (multipv !== this.multipv) {
        this.send(`setoption name MultiPV value ${multipv}`);
        this.multipv = multipv;
      }
      this.send('ucinewgame');
      await this.ready();
      this.send(`position fen ${req.fen}`);
      const sm = req.searchmoves?.length ? ` searchmoves ${req.searchmoves.join(' ')}` : '';
      this.send(`go nodes ${Math.max(1, Math.floor(req.nodes))}${sm}`);
      const best = await this.waitFor((l) => l.startsWith('bestmove'), 120_000);
      const lines: EngineLine[] = [];
      for (let k = 1; k <= multipv; k++) {
        const hit = exact.get(k) ?? bound.get(k);
        if (hit) lines.push(hit.line);
      }
      return { lines, nodes, depth, ms: Date.now() - started, bestmove: best.split(/\s+/)[1] ?? '', tbhits };
    } finally {
      off();
      this.busy = false;
    }
  }

  kill() {
    const child = this.child;
    this.onExit('engine was stopped');
    this.child = null;
    try {
      child?.kill();
    } catch {
      /* already gone */
    }
  }

  async quit(): Promise<void> {
    if (!this.child || !this.alive) return;
    const child = this.child;
    try {
      this.send('quit');
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.kill();
        resolve();
      }, 1500);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.alive = false;
    this.child = null;
  }
}

function parseInfo(line: string): { depth: number; multipv: number; score: Score; nodes: number; tbhits: number; pv: string[]; bound: boolean } | null {
  const parts = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let nodes = 0;
  let tbhits = 0;
  let score: Score | null = null;
  let bound = false;
  let pv: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p === 'depth') depth = Number(parts[++i]);
    else if (p === 'multipv') multipv = Number(parts[++i]);
    else if (p === 'nodes') nodes = Number(parts[++i]);
    else if (p === 'tbhits') tbhits = Number(parts[++i]);
    else if (p === 'score') {
      const kind = parts[++i];
      const value = Number(parts[++i]);
      score = kind === 'mate' ? { mate: value } : { cp: value };
      if (parts[i + 1] === 'lowerbound' || parts[i + 1] === 'upperbound') {
        bound = true;
        i++;
      }
    } else if (p === 'pv') {
      pv = parts.slice(i + 1);
      break;
    }
  }
  if (!score || !pv.length) return null;
  // "mate 0" never appears with a pv; a mate score of 0 would mean the side to move is mated
  return { depth, multipv, score, nodes, tbhits, pv, bound };
}
