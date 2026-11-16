// Spike S3: engine wrapper (docs/PLAN.md, Phase 2).
//
// Question: is the UCI wrapper fast and crash-proof on this laptop?
// Method:   analyse a 60-move game with the node budgets from ARCHITECTURE §10; feed an invalid
//           position on purpose; kill a worker mid-search.
// Pass:     < 90 s on AC; the process restarts and the queue continues.
//
// Usage: node spikes/s3-engine/run.ts

import { execFileSync } from 'node:child_process';
import { START_FEN, describeMove, mustPosition, uciToMove } from '@chess-coach/core';
import { EngineService } from '../../packages/server/src/engine/service.ts';

const PATH = process.env.STOCKFISH ?? 'C:\\Tools\\Stockfish\\stockfish-windows-x86-64-universal.exe';
const SYZYGY = 'C:\\Tools\\Syzygy';
const EXPECTED_BENCH = 2497913;
const report: Record<string, unknown> = { when: new Date().toISOString() };

function onAc(): boolean | null {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus | Select-Object -First 1).PowerOnline'], { encoding: 'utf8' });
    return /true/i.test(out);
  } catch {
    return null;
  }
}
report.onAcPower = onAc();

const make = (analysisWorkers: number) =>
  new EngineService({ path: PATH, syzygyPath: SYZYGY, quickWorkers: 2, analysisWorkers, expectedBench: EXPECTED_BENCH, log: (m) => console.error('[engine]', m) });

// 1. fingerprint
let svc = make(6);
const t0 = Date.now();
report.verify = { ...(await svc.verify()), ms: Date.now() - t0 };

// 2. a 60-move game by self-play (legal by construction; the timing only depends on node counts)
const fens: string[] = [START_FEN];
const sans: string[] = [];
{
  const pos = mustPosition(START_FEN);
  for (let ply = 0; ply < 120; ply++) {
    // a weak, varied game: few nodes, and the 2nd or 3rd choice now and then, like a real game with mistakes
    const r = await svc.analyse({ fen: fens.at(-1)!, nodes: 20_000, multipv: 3, pool: 'quick' });
    if (!r.lines.length) break;
    const pick = ply % 7 === 3 && r.lines[2] ? 2 : ply % 5 === 4 && r.lines[1] ? 1 : 0;
    const move = uciToMove(pos, r.lines[pick]!.pv[0]!)!;
    const info = describeMove(pos, move);
    pos.play(move);
    sans.push(info.san);
    fens.push(info.fenAfter);
  }
}
report.game = { plies: sans.length, moves: sans.join(' ') };
await svc.stop();

// 3. first pass: every position, 400k nodes, one line — with different numbers of workers
const pass1: Record<string, unknown>[] = [];
for (const workers of [1, 4, 6, 8]) {
  svc = make(workers);
  svc.signature = 'sf19'; // skip bench here; it is not what is being timed
  const t = Date.now();
  const results = await Promise.all(fens.slice(0, -1).map((fen) => svc.analyse({ fen, nodes: 400_000, multipv: 1, pool: 'analysis' })));
  const ms = Date.now() - t;
  pass1.push({ workers, positions: results.length, ms, nodesTotal: svc.stats.nodes, perPositionMs: Math.round(ms / results.length) });
  if (workers === 6) {
    // 4. second pass on 8 candidate moments: 2M nodes, three lines
    const moments = fens.filter((_, i) => i % 15 === 7).slice(0, 8);
    const t2 = Date.now();
    await Promise.all(moments.map((fen) => svc.analyse({ fen, nodes: 2_000_000, multipv: 3, pool: 'analysis' })));
    report.pass2 = { workers, moments: moments.length, ms: Date.now() - t2 };
    report.twoPassTotalMs = ms + (Date.now() - t2);
  }
  await svc.stop();
}
report.pass1 = pass1;

// 5. the same request twice, in two separate engine processes, must give the same answer
{
  const sample = [fens[10]!, fens[33]!, fens[61]!, fens[90]!];
  const run = async () => {
    const s = make(2);
    s.signature = 'sf19';
    const out = await Promise.all(sample.map((fen) => s.analyse({ fen, nodes: 300_000, multipv: 3, pool: 'analysis' })));
    await s.stop();
    return JSON.stringify(out.map((r) => r.lines));
  };
  const [a, b] = [await run(), await run()];
  report.deterministic = a === b;
}

// 6. quick-facts budget: 300k nodes, three lines, one position at a time
{
  svc = make(6);
  svc.signature = 'sf19';
  await svc.analyse({ fen: fens[5]!, nodes: 1000 }); // warm the worker
  const times: number[] = [];
  for (const fen of [fens[20]!, fens[40]!, fens[60]!, fens[80]!, fens[100]!]) {
    const t = Date.now();
    await svc.analyse({ fen, nodes: 300_000, multipv: 3, pool: 'quick' });
    times.push(Date.now() - t);
  }
  const t = Date.now();
  await svc.analyse({ fen: fens[20]!, nodes: 300_000, multipv: 3, pool: 'quick' });
  report.quickFacts = { ms: times, cachedMs: Date.now() - t };

  // 7. invalid input is stopped before the engine sees it
  const refused: string[] = [];
  for (const bad of ['not a fen', '8/8/8/8/8/8/8/8 w - - 0 1', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 extra junk here', 'k7/8/8/8/8/8/8/K6R b - - 0 1'.replace('k7', 'kk6')]) {
    try {
      await svc.analyse({ fen: bad, nodes: 1000 });
      refused.push(`NOT refused: ${bad}`);
    } catch {
      refused.push('refused');
    }
  }
  try {
    await svc.analyse({ fen: START_FEN, nodes: 1000, searchmoves: ['e2e5'] });
    refused.push('NOT refused: illegal searchmove');
  } catch {
    refused.push('refused');
  }
  report.validation = { refused, restartsSoFar: svc.restarts };

  // 8a. what Stockfish does with an invalid position sent raw (bypassing the check on purpose)
  const victim = svc.enginesOf('quick')[0]!;
  let diedOnBadFen = false;
  try {
    victim.send('position fen 8/8/8/8/8/8/8/8 w - - 0 1');
    victim.send('go nodes 1000');
    await new Promise((r) => setTimeout(r, 1500));
    diedOnBadFen = !victim.alive;
  } catch {
    diedOnBadFen = true;
  }
  // the queue must carry on either way
  const afterBad = await Promise.all([fens[11]!, fens[12]!, fens[13]!].map((fen) => svc.analyse({ fen, nodes: 100_000, pool: 'quick' })));

  // 8b. kill a worker in the middle of a search: the job is retried on a fresh process
  const restartsBefore = svc.restarts;
  const jobs = [fens[50]!, fens[51]!, fens[52]!, fens[53]!, fens[54]!, fens[55]!].map((fen) => svc.analyse({ fen, nodes: 3_000_000, multipv: 1, pool: 'analysis' }));
  await new Promise((r) => setTimeout(r, 400));
  const target = svc.enginesOf('analysis')[0]!;
  (target as unknown as { child: { kill: () => void } }).child.kill();
  const tk = Date.now();
  const done = await Promise.allSettled(jobs);
  report.crash = {
    stockfishDiedOnInvalidFen: diedOnBadFen,
    queueContinuedAfterInvalidFen: afterBad.every((r) => r.lines.length > 0),
    killedMidSearch: true,
    jobsFinished: done.filter((d) => d.status === 'fulfilled').length,
    jobsFailed: done.filter((d) => d.status === 'rejected').length,
    restarts: svc.restarts - restartsBefore,
    msToFinishAfterKill: Date.now() - tk,
  };
  await svc.stop();
}

const best = pass1.find((p) => p.workers === 6) as { ms: number };
report.pass = {
  under90s: (report.twoPassTotalMs as number) < 90_000,
  benchMatches: (report.verify as { ok: boolean }).ok,
  deterministic: report.deterministic,
  invalidRefused: (report.validation as { refused: string[] }).refused.every((r) => r === 'refused'),
  recovered: (report.crash as { jobsFailed: number; restarts: number }).jobsFailed === 0 && (report.crash as { restarts: number }).restarts >= 1,
  firstPassMsAt6Workers: best.ms,
};
console.log(JSON.stringify(report, null, 2));
