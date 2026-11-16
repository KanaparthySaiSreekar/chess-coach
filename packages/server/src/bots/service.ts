// The bots service (ARCHITECTURE §11, feature H7): Maia-3 in a Python sidecar that says how
// likely a human of a given rating is to play each legal move. This side samples the move and
// checks it with the rules, so a bot can never play an illegal move.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describeMove, parsePosition, uciToMove } from '@chess-coach/core';

export type MoveProbability = { uci: string; p: number };
export type ProbabilityRequest = { startFen: string; moves: string[]; selfElo: number; oppoElo: number };
export type SourceState = 'idle' | 'starting' | 'ready' | 'error';

/** Where move probabilities come from. Tests swap in a fake. */
export interface MoveSource {
  readonly state: SourceState;
  readonly problem?: string;
  probabilities(req: ProbabilityRequest): Promise<MoveProbability[]>;
  /** start loading now, so the first move does not wait for it */
  warm?(): void;
  stop(): void;
}

export type SidecarOptions = {
  python: string;
  script: string;
  /** which model to load, read each time the process starts: Maia's name for it (maia3-5m, maia3-23m) and its weights file */
  spec: () => { model: string; checkpoint: string; device?: 'cpu' | 'cuda' };
  log?: (msg: string) => void;
  onState?: (state: SourceState, problem?: string) => void;
};

type Pending = { resolve: (moves: MoveProbability[]) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class MaiaSidecar implements MoveSource {
  state: SourceState = 'idle';
  problem?: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private stderrTail = '';
  private readonly o: SidecarOptions;
  private log: (msg: string) => void;

  constructor(opts: SidecarOptions) {
    this.o = opts;
    this.log = opts.log ?? (() => {});
  }

  private setState(state: SourceState, problem?: string) {
    this.state = state;
    this.problem = problem;
    this.o.onState?.(state, problem);
  }

  /** Start the process if it is not running, and wait until the model is loaded. */
  ensure(): Promise<void> {
    if (this.child && this.state === 'ready') return Promise.resolve();
    if (this.starting) return this.starting;
    const spec = this.o.spec();
    for (const [what, file] of [['Python', this.o.python], ['the Maia sidecar script', this.o.script], ['the Maia model file', spec.checkpoint]] as const) {
      if (!existsSync(file)) {
        this.setState('error', `${what} was not found at ${file}`);
        return Promise.reject(new Error(this.problem));
      }
    }
    this.setState('starting');
    this.starting = new Promise<void>((resolve, reject) => {
      const child = spawn(this.o.python, [this.o.script, '--model', spec.model, '--checkpoint-path', spec.checkpoint, '--device', spec.device ?? 'cpu'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // the weights are pinned local files: starting a bot never touches the network (decision D30)
        env: { ...process.env, HF_HUB_OFFLINE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      });
      this.child = child;
      this.buffer = '';
      this.stderrTail = '';
      const timer = setTimeout(() => fail(new Error('Maia did not start within 90 seconds')), 90_000);
      timer.unref?.();
      let settled = false;
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.starting = null;
        this.kill();
        this.setState('error', e.message);
        reject(e);
      };
      child.stdout.on('data', (d: Buffer) => {
        this.buffer += d.toString('utf8');
        let i: number;
        while ((i = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, i).trim();
          this.buffer = this.buffer.slice(i + 1);
          if (!line) continue;
          let msg: { ready?: boolean; id?: number; moves?: MoveProbability[]; error?: string };
          try {
            msg = JSON.parse(line);
          } catch {
            continue; // not ours: a stray print from a library
          }
          if (msg.ready && !settled) {
            settled = true;
            clearTimeout(timer);
            this.starting = null;
            this.setState('ready');
            this.log(`Maia ready (${spec.model}, ${spec.device ?? 'cpu'})`);
            resolve();
          } else if (typeof msg.id === 'number') {
            const p = this.pending.get(msg.id);
            if (!p) continue;
            this.pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve(msg.moves ?? []);
          }
        }
      });
      child.stderr.on('data', (d: Buffer) => {
        this.stderrTail = (this.stderrTail + d.toString('utf8')).slice(-600);
      });
      child.stdin.on('error', () => {});
      child.on('error', (e) => fail(new Error(`Maia could not be started: ${e.message}`)));
      child.on('exit', (code) => {
        if (this.child !== child) return; // we stopped it ourselves
        this.child = null;
        const why = this.stderrTail.trim().split('\n').slice(-2).join(' ') || `exit code ${code}`;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error(`Maia stopped: ${why}`));
        }
        this.pending.clear();
        if (!settled) fail(new Error(`Maia stopped while starting: ${why}`));
        else {
          this.log(`Maia stopped unexpectedly: ${why}`);
          this.setState('idle'); // the next request starts it again
        }
      });
    });
    return this.starting;
  }

  warm() {
    void this.ensure().catch(() => {});
  }

  async probabilities(req: ProbabilityRequest): Promise<MoveProbability[]> {
    await this.ensure();
    const child = this.child;
    if (!child) throw new Error('Maia is not running');
    const id = this.nextId++;
    return new Promise<MoveProbability[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Maia did not answer within 20 seconds'));
        this.kill(); // a hung process is replaced on the next request
        this.setState('idle');
      }, 20_000);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, fen: req.startFen, moves: req.moves, self_elo: req.selfElo, oppo_elo: req.oppoElo })}\n`);
    });
  }

  private kill() {
    const child = this.child;
    this.child = null;
    try {
      child?.kill();
    } catch {
      /* already gone */
    }
  }

  stop() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('the bots service was stopped'));
    }
    this.pending.clear();
    this.starting = null;
    this.kill();
    if (this.state !== 'error') this.setState('idle');
  }
}

// ---------------------------------------------------------------- choosing a move

export type Sampling = { temperature: number; topP: number; rng?: () => number };

/**
 * Pick one move from Maia's probabilities. Temperature 1 and top-p 1 play each move exactly as
 * often as people of that rating do; a lower temperature sticks to the common moves, top-p cuts
 * off the rare tail. Temperature 0 always plays the most likely move.
 */
export function sampleMove(probs: MoveProbability[], s: Sampling): MoveProbability | null {
  const usable = probs.filter((m) => m.p > 0 && Number.isFinite(m.p)).sort((a, b) => b.p - a.p);
  if (!usable.length) return probs[0] ?? null;
  if (s.temperature <= 0) return usable[0]!;
  let weighted = usable.map((m) => ({ m, w: Math.pow(m.p, 1 / s.temperature) }));
  let total = weighted.reduce((sum, x) => sum + x.w, 0);
  if (s.topP < 1) {
    const kept: typeof weighted = [];
    let cumulative = 0;
    for (const x of weighted) {
      // always keep the first; then keep while the moves so far cover less than top-p
      if (kept.length && cumulative / total >= s.topP) break;
      kept.push(x);
      cumulative += x.w;
    }
    weighted = kept;
    total = weighted.reduce((sum, x) => sum + x.w, 0);
  }
  let r = (s.rng ?? Math.random)() * total;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return x.m;
  }
  return weighted.at(-1)!.m;
}

/** Keep only moves that are legal in the position (checked with the rules here, not trusted from Python). */
export function legalOnly(fen: string, probs: MoveProbability[]): MoveProbability[] {
  const pos = parsePosition(fen);
  if (!pos) return [];
  const out: MoveProbability[] = [];
  for (const m of probs) {
    const move = uciToMove(pos, m.uci);
    if (move) out.push({ uci: describeMove(pos, move).uci, p: m.p });
  }
  return out;
}
