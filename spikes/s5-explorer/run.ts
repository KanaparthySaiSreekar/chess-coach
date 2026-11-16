// Spike S5: the Lichess opening explorer at beginner ratings (docs/PLAN.md, Phase 2).
//
// Question: does the explorer answer for the beginner rating buckets with a token, and what are
//           its limits?
// Method:   the start position and common beginner positions at ratings=0,1000 (rapid and
//           classical); walk down the most played line to see how deep the data goes; the same
//           position at other buckets; a call without the token; timings and any 429.
//           The first run sent its calls back to back and was refused (429) after 28 calls in
//           about six seconds, so this version leaves a gap between calls (--gap, default 1000 ms)
//           and, when refused, waits a full minute before one retry, as Lichess asks.
// Pass:     data returned; a caching plan that stays inside the limits.
//
// One request at a time, as Lichess asks. The token is read from .env and only ever sent to
// explorer.lichess.org in the Authorization header; it is never printed.
//
// Usage: node spikes/s5-explorer/run.ts     (writes spikes/s5-explorer/result.json)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { START_FEN, describeMove, mustPosition, playLine, uciToMove } from '@chess-coach/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

function token(): string {
  if (process.env.LICHESS_TOKEN) return process.env.LICHESS_TOKEN;
  const env = readFileSync(path.join(root, '.env'), 'utf8');
  const m = env.match(/^LICHESS_TOKEN=(.+)$/m);
  if (!m) throw new Error('LICHESS_TOKEN is not in .env');
  return m[1]!.trim().replace(/^["']|["']$/g, '');
}
const TOKEN = token();

type ExplorerMove = { uci: string; san: string; white: number; draws: number; black: number; averageRating?: number };
type ExplorerAnswer = { white: number; draws: number; black: number; moves: ExplorerMove[]; opening?: { eco: string; name: string } | null };
type Call = { status: number; ms: number; body?: ExplorerAnswer; headers: Record<string, string>; error?: string };

const calls: { what: string; status: number; ms: number; at: number }[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gapArg = process.argv.indexOf('--gap');
const GAP_MS = gapArg > 0 ? Number(process.argv[gapArg + 1]) : 1000;
const started = Date.now();
let lastCall = 0;
const refusals: { afterCalls: number; atSecond: number; what: string }[] = [];

async function explorer(what: string, fen: string, opts: { ratings?: string; speeds?: string; auth?: boolean; moves?: number } = {}): Promise<Call> {
  let r = await once(what, fen, opts);
  if (r.status === 429) {
    refusals.push({ afterCalls: calls.length, atSecond: Math.round((Date.now() - started) / 1000), what });
    console.error(`refused (429) at "${what}": waiting a minute`);
    await sleep(61_000);
    r = await once(`${what} (after the wait)`, fen, opts);
  }
  return r;
}

async function once(what: string, fen: string, opts: { ratings?: string; speeds?: string; auth?: boolean; moves?: number } = {}): Promise<Call> {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const q = new URLSearchParams({ variant: 'standard', fen, speeds: opts.speeds ?? 'rapid,classical', ratings: opts.ratings ?? '0,1000', moves: String(opts.moves ?? 12), topGames: '0', recentGames: '0' });
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'chess-coach-local/0.1' };
  if (opts.auth !== false) headers.Authorization = `Bearer ${TOKEN}`;
  const t = performance.now();
  try {
    const res = await fetch(`https://explorer.lichess.org/lichess?${q}`, { headers, signal: AbortSignal.timeout(20_000) });
    const ms = Math.round(performance.now() - t);
    const keep: Record<string, string> = {};
    for (const [k, v] of res.headers) if (/rate|retry|cache|age|expires|etag/i.test(k)) keep[k] = v;
    calls.push({ what, status: res.status, ms, at: Date.now() - started });
    if (res.status !== 200) return { status: res.status, ms, headers: keep, error: (await res.text()).slice(0, 200) };
    return { status: 200, ms, headers: keep, body: (await res.json()) as ExplorerAnswer };
  } catch (e) {
    const ms = Math.round(performance.now() - t);
    calls.push({ what, status: 0, ms, at: Date.now() - started });
    return { status: 0, ms, headers: {}, error: (e as Error).message };
  }
}

const total = (a: { white: number; draws: number; black: number }) => a.white + a.draws + a.black;
const pct = (n: number, of: number) => (of ? Math.round((1000 * n) / of) / 10 : 0);
const top = (a: ExplorerAnswer, n = 5) => a.moves.slice(0, n).map((m) => ({ san: m.san, games: total(m), sharePct: pct(total(m), total(a)), whiteScorePct: pct(m.white + m.draws / 2, total(m)) }));

const report: Record<string, unknown> = { when: new Date().toISOString(), endpoint: 'https://explorer.lichess.org/lichess', speeds: 'rapid,classical' };
const save = () => writeFileSync(path.join(here, 'result.json'), JSON.stringify(report, null, 2));

// 1. without the token
{
  const r = await explorer('no token', START_FEN, { auth: false });
  report.withoutToken = { status: r.status, ms: r.ms, says: r.error };
}

// 2. the start position and common beginner positions at ratings 0 and 1000
const POSITIONS: [string, string[]][] = [
  ['start position', []],
  ['1.e4', ['e4']],
  ['1.e4 e5', ['e4', 'e5']],
  ['1.e4 e5 2.Nf3 Nc6', ['e4', 'e5', 'Nf3', 'Nc6']],
  ['Italian: 1.e4 e5 2.Nf3 Nc6 3.Bc4', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']],
  ["early queen raid: 1.e4 e5 2.Qh5", ['e4', 'e5', 'Qh5']],
  ['1.d4 d5', ['d4', 'd5']],
];
const positions: Record<string, unknown>[] = [];
let sawHeaders: Record<string, string> = {};
for (const [name, sans] of POSITIONS) {
  const line = playLine(START_FEN, sans);
  if (!line.ok) throw new Error(`bad line: ${name}`);
  const fen = line.fens.at(-1)!;
  const r = await explorer(name, fen);
  if (r.body) {
    sawHeaders = { ...sawHeaders, ...r.headers };
    positions.push({ name, status: r.status, ms: r.ms, games: total(r.body), opening: r.body.opening?.name ?? null, moves: r.body.moves.length, top: top(r.body) });
  } else positions.push({ name, status: r.status, ms: r.ms, error: r.error });
  // the same call again: is it answered faster the second time (a cache on their side)?
  const again = await explorer(`${name} (repeat)`, fen);
  (positions.at(-1) as Record<string, unknown>).repeatMs = again.ms;
}
report.positions = positions;
report.headersSeen = sawHeaders;
save();

// 3. how deep does the beginner data go? Follow the most played move until the games run out
{
  const pos = mustPosition(START_FEN);
  let fen = START_FEN;
  const depth: Record<string, unknown>[] = [];
  for (let ply = 0; ply < 30; ply++) {
    const r = await explorer(`depth ply ${ply}`, fen);
    if (!r.body) {
      depth.push({ ply, status: r.status, error: r.error });
      break;
    }
    const games = total(r.body);
    const first = r.body.moves[0];
    depth.push({ ply, games, ms: r.ms, mostPlayed: first?.san ?? null, sharePct: first ? pct(total(first), games) : 0, opening: r.body.opening?.name ?? null });
    if (!first || games < 200) break;
    const move = uciToMove(pos, first.uci);
    if (!move) {
      depth.push({ ply, problem: `the explorer's move ${first.uci} is not legal here` });
      break;
    }
    const info = describeMove(pos, move);
    pos.play(move);
    fen = info.fenAfter;
  }
  report.depthAlongTheMostPlayedLine = depth;
  save();
}

// 4. one position across the buckets: do beginners really play differently?
{
  const line = playLine(START_FEN, ['e4', 'e5', 'Nf3']);
  if (!line.ok) throw new Error('bad line');
  const fen = line.fens.at(-1)!;
  const buckets: Record<string, unknown> = {};
  for (const ratings of ['0', '1000', '0,1000', '1600,1800', '2200,2500']) {
    const r = await explorer(`buckets ${ratings}`, fen, { ratings });
    buckets[ratings] = r.body ? { games: total(r.body), ms: r.ms, top: top(r.body, 4) } : { status: r.status, error: r.error };
  }
  report.afterE4E5Nf3ByBucket = buckets;
  save();
}

// 5. a longer walk at the same pace, on positions not asked before: does the pace hold?
{
  const line = playLine(START_FEN, ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'O-O', 'Bd3', 'd5', 'Nf3', 'c5', 'O-O', 'Nc6', 'a3', 'Bxc3', 'bxc3', 'dxc4', 'Bxc4', 'Qc7']);
  if (!line.ok) throw new Error('bad line');
  const times: number[] = [];
  const statuses: Record<string, number> = {};
  for (const fen of line.fens) {
    const r = await explorer('paced walk', fen);
    times.push(r.ms);
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  }
  times.sort((x, y) => x - y);
  report.pacedWalk = { requests: times.length, statuses, medianMs: times[Math.floor(times.length / 2)], maxMs: times.at(-1) };
}

const ok = calls.filter((c) => c.status === 200).map((c) => c.ms).sort((a, b) => a - b);
report.pace = { gapMs: GAP_MS, seconds: Math.round((Date.now() - started) / 1000), refusals, earlierRuns: {
    backToBack: 'refused (429) after 28 calls sent back to back in about 6 s; one call got through a few seconds later, then refused again',
    onePerSecond: 'refused (429) after 47 calls in 49 s; after the one-minute wait the remaining 13 calls were answered',
  },
};
report.summary = {
  calls: calls.length,
  ok: ok.length,
  refused: calls.filter((c) => c.status === 429).length,
  otherStatuses: calls.filter((c) => c.status !== 200 && c.status !== 429).map((c) => `${c.what}: ${c.status}`),
  medianMs: ok[Math.floor(ok.length / 2)],
  p95Ms: ok[Math.floor(ok.length * 0.95)],
  maxMs: ok.at(-1),
};
save();
console.log(JSON.stringify(report, null, 2));
