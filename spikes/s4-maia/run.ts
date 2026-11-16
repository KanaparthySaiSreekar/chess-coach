// Spike S4: Maia-3 at the low end (docs/PLAN.md, Phase 2).
//
// Question: is Maia-3 human-like at the bottom of the roster, and fast enough?
// Method:   the real sidecar (tools/maia_sidecar.py) and the real sampling code (bots/service.ts).
//           1. time per move through the sidecar: 5M and 23M, on the CPU and on the GPU;
//           2. a match, Maia-600 against Maia-1200, colours alternating;
//           3. self-play at 600, 1000 and 1500, every position checked by Stockfish: blunders per
//              100 live moves and how often free material is taken, beside the published figures
//              for Lichess rapid at 600 and 1000 (chessstats.gg, see docs/LEARNING.md §2).
// Pass:     the stronger bot wins clearly; the weak bot blunders like a beginner; < 1 s per move.
//
// Usage: node spikes/s4-maia/run.ts [--match 200] [--profile 60] [--timing 200] [--nodes 150000]
//        Writes spikes/s4-maia/result.json. Run on AC power.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { START_FEN, capturables, describeMove, isLive, mustPosition, uciToMove, winChance, type Score } from '@chess-coach/core';
import { MaiaSidecar, legalOnly, sampleMove } from '../../packages/server/src/bots/service.ts';
import { EngineService } from '../../packages/server/src/engine/service.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const MATCH_GAMES = arg('match', 200);
const PROFILE_GAMES = arg('profile', 60);
const TIMING_REQUESTS = arg('timing', 200);
const NODES = arg('nodes', 150_000);
const MAX_PLIES = 400;

const PYTHON = 'C:/Tools/Maia3/venv/Scripts/python.exe';
const SCRIPT = path.resolve(here, '..', '..', 'tools', 'maia_sidecar.py');
const MODELS = 'C:/Tools/Maia3/models';
const STOCKFISH = 'C:/Tools/Stockfish/stockfish-windows-x86-64-universal.exe';

const report: Record<string, unknown> = { when: new Date().toISOString(), settings: { MATCH_GAMES, PROFILE_GAMES, TIMING_REQUESTS, NODES, MAX_PLIES } };
const save = () => writeFileSync(path.join(here, 'result.json'), JSON.stringify(report, null, 2));
const say = (msg: string) => console.error(`[s4 ${new Date().toISOString().slice(11, 19)}] ${msg}`);

function onAc(): boolean | null {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus | Select-Object -First 1).PowerOnline'], { encoding: 'utf8' });
    return /true/i.test(out);
  } catch {
    return null;
  }
}
report.onAcPower = onAc();

// a small repeatable random source, so a run can be repeated move for move
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sidecar = (model: '5m' | '23m', device: 'cpu' | 'cuda') =>
  new MaiaSidecar({ python: PYTHON, script: SCRIPT, spec: () => ({ model: `maia3-${model}`, checkpoint: `${MODELS}/maia3-${model}.pt`, device }) });

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------- playing a game

type Game = { white: number; black: number; ucis: string[]; fens: string[]; result: '1-0' | '0-1' | '1/2-1/2'; how: string; dropped: number };

async function playGame(source: MaiaSidecar, white: number, black: number, seed: number): Promise<Game> {
  const rng = mulberry32(seed);
  const pos = mustPosition(START_FEN);
  const ucis: string[] = [];
  const fens: string[] = [START_FEN];
  const seen = new Map<string, number>();
  let dropped = 0;
  const key = (fen: string) => fen.split(' ').slice(0, 4).join(' ');
  seen.set(key(START_FEN), 1);
  for (;;) {
    if (pos.isCheckmate()) return { white, black, ucis, fens, result: pos.turn === 'white' ? '0-1' : '1-0', how: 'checkmate', dropped };
    if (pos.isStalemate()) return { white, black, ucis, fens, result: '1/2-1/2', how: 'stalemate', dropped };
    if (pos.isInsufficientMaterial()) return { white, black, ucis, fens, result: '1/2-1/2', how: 'insufficient material', dropped };
    if (pos.halfmoves >= 100) return { white, black, ucis, fens, result: '1/2-1/2', how: 'fifty moves', dropped };
    if ((seen.get(key(fens.at(-1)!)) ?? 0) >= 3) return { white, black, ucis, fens, result: '1/2-1/2', how: 'repetition', dropped };
    if (ucis.length >= MAX_PLIES) return { white, black, ucis, fens, result: '1/2-1/2', how: 'move limit', dropped };
    const self = pos.turn === 'white' ? white : black;
    const oppo = pos.turn === 'white' ? black : white;
    const raw = await source.probabilities({ startFen: START_FEN, moves: ucis, selfElo: self, oppoElo: oppo });
    const probs = legalOnly(fens.at(-1)!, raw);
    dropped += raw.length - probs.length;
    // the roster's own sampling: temperature 1, top-p 1 (each move as often as people of that rating play it)
    const pick = sampleMove(probs, { temperature: 1, topP: 1, rng });
    if (!pick) throw new Error(`Maia gave no move at ${fens.at(-1)}`);
    const move = uciToMove(pos, pick.uci);
    if (!move) throw new Error(`illegal move got through: ${pick.uci}`);
    const info = describeMove(pos, move);
    pos.play(move);
    ucis.push(info.uci);
    fens.push(info.fenAfter);
    seen.set(key(info.fenAfter), (seen.get(key(info.fenAfter)) ?? 0) + 1);
  }
}

/** Play `count` games side by side on `sources.length` sidecars. `pairing(i)` says who has White in game i. */
async function playMany(sources: MaiaSidecar[], count: number, pairing: (i: number) => [number, number], seedBase: number, label: string): Promise<Game[]> {
  const games: Game[] = Array.from<Game>({ length: count });
  let next = 0;
  let done = 0;
  await Promise.all(
    sources.map(async (source) => {
      for (;;) {
        const i = next++;
        if (i >= count) return;
        const [white, black] = pairing(i);
        games[i] = await playGame(source, white, black, seedBase + i);
        if (++done % 20 === 0) say(`${label}: ${done} of ${count} games`);
      }
    }),
  );
  return games;
}

// ---------------------------------------------------------------- 1. speed through the sidecar

say('1. speed through the sidecar');
// positions to time on: two games' worth of real histories, played once on the CPU
const seedSource = sidecar('5m', 'cpu');
const seedGames = [await playGame(seedSource, 600, 600, 1), await playGame(seedSource, 1500, 1500, 2)];
seedSource.stop();
const timingRequests: { moves: string[]; elo: number }[] = [];
for (let i = 0; timingRequests.length < TIMING_REQUESTS; i++) {
  const g = seedGames[i % 2]!;
  const ply = (i * 7) % g.ucis.length;
  timingRequests.push({ moves: g.ucis.slice(0, ply), elo: g.white });
}
const speed: Record<string, unknown>[] = [];
for (const [model, device] of [['5m', 'cpu'], ['23m', 'cpu'], ['5m', 'cuda'], ['23m', 'cuda']] as const) {
  const s = sidecar(model, device);
  try {
    const t0 = performance.now();
    await s.ensure();
    const loadMs = performance.now() - t0;
    const t1 = performance.now();
    await s.probabilities({ startFen: START_FEN, moves: [], selfElo: 600, oppoElo: 600 });
    const firstMs = performance.now() - t1;
    const times: number[] = [];
    for (const r of timingRequests) {
      const t = performance.now();
      await s.probabilities({ startFen: START_FEN, moves: r.moves, selfElo: r.elo, oppoElo: r.elo });
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const row = { model, device, loadMs: Math.round(loadMs), firstRequestMs: round(firstMs), requests: times.length, medianMs: round(quantile(times, 0.5)), p95Ms: round(quantile(times, 0.95)), maxMs: round(times.at(-1)!) };
    speed.push(row);
    say(`   ${model} on ${device}: load ${row.loadMs} ms, first ${row.firstRequestMs} ms, median ${row.medianMs} ms, p95 ${row.p95Ms} ms, max ${row.maxMs} ms`);
  } catch (e) {
    speed.push({ model, device, error: (e as Error).message });
    say(`   ${model} on ${device}: FAILED ${(e as Error).message}`);
  } finally {
    s.stop();
  }
}
report.speed = speed;
save();

// ---------------------------------------------------------------- 2. the match: 600 against 1200

say(`2. match: Maia-600 against Maia-1200, ${MATCH_GAMES} games`);
const players = [sidecar('5m', 'cpu'), sidecar('5m', 'cpu'), sidecar('5m', 'cpu')];
await Promise.all(players.map((p) => p.ensure()));
const tMatch = Date.now();
const match = await playMany(players, MATCH_GAMES, (i) => (i % 2 === 0 ? [600, 1200] : [1200, 600]), 10_000, 'match');
{
  let strong = 0;
  let weak = 0;
  let draws = 0;
  const how: Record<string, number> = {};
  for (const g of match) {
    how[g.how] = (how[g.how] ?? 0) + 1;
    if (g.result === '1/2-1/2') draws++;
    else if ((g.result === '1-0') === (g.white === 1200)) strong++;
    else weak++;
  }
  const score = (strong + draws / 2) / match.length;
  // the rating gap a score stands for (the Elo formula turned round); a rough guide with so few games
  const impliedGap = score > 0 && score < 1 ? Math.round(-400 * Math.log10(1 / score - 1)) : null;
  report.match = {
    games: match.length,
    stronger: { wins: strong, draws, losses: weak, scorePct: round(score * 100) },
    expectedScorePctForA600PointGap: round(100 / (1 + 10 ** (-600 / 400))),
    impliedRatingGap: impliedGap,
    endings: how,
    averagePlies: Math.round(match.reduce((s, g) => s + g.ucis.length, 0) / match.length),
    illegalMovesFromMaia: match.reduce((s, g) => s + g.dropped, 0),
    seconds: Math.round((Date.now() - tMatch) / 1000),
  };
  say(`   1200 scored ${round(score * 100)}% (+${strong} =${draws} -${weak}); endings ${JSON.stringify(how)}`);
}
save();

// ---------------------------------------------------------------- 3. how each level plays

say(`3. self-play at 600, 1000 and 1500, ${PROFILE_GAMES} games each`);
const LEVELS = [600, 1000, 1500];
const selfPlay: Record<number, Game[]> = {};
for (const elo of LEVELS) selfPlay[elo] = await playMany(players, PROFILE_GAMES, () => [elo, elo], 50_000 + elo, `self-play ${elo}`);
for (const p of players) p.stop();

say(`   checking every position with Stockfish (${NODES} nodes)`);
const engine = new EngineService({ path: STOCKFISH, quickWorkers: 1, analysisWorkers: 8, log: (m) => console.error('[engine]', m) });
engine.signature = 'sf19-s4';
const cpOf = (s: Score): number => (s.mate !== undefined ? (s.mate > 0 ? 10_000 : -10_000) : (s.cp ?? 0));

type Phase = 'opening' | 'middlegame' | 'endgame';
/** A simple split (the published figures' own split is not public): few pieces left = endgame; the first ten moves with most pieces on = opening. */
function phaseOf(fen: string, ply: number): Phase {
  const board = fen.split(' ')[0]!;
  const pieces = (board.match(/[nbrqNBRQ]/g) ?? []).length;
  if (pieces <= 6) return 'endgame';
  if (ply < 20 && pieces > 10) return 'opening';
  return 'middlegame';
}

type Tally = { moves: number; live: number; blunders150: number; liveBlunders150: number; lichessBlunders: number; freeChances: number; freeTaken: number; pieceChances: number; pieceTaken: number };
const emptyTally = (): Tally => ({ moves: 0, live: 0, blunders150: 0, liveBlunders150: 0, lichessBlunders: 0, freeChances: 0, freeTaken: 0, pieceChances: 0, pieceTaken: 0 });

const profile: Record<string, unknown> = {};
for (const elo of LEVELS) {
  const games = selfPlay[elo]!;
  const t = Date.now();
  const all = emptyTally();
  const byPhase: Record<Phase, Tally> = { opening: emptyTally(), middlegame: emptyTally(), endgame: emptyTally() };
  const perGameBlunders: number[] = [];
  let decisiveByBlunderInOpening = 0;
  await Promise.all(
    games.map(async (g) => {
      const scores = await Promise.all(g.fens.map((fen) => engine.analyse({ fen, nodes: NODES, multipv: 1, pool: 'analysis' }).then((r) => r.lines[0]?.score ?? null)));
      let gameBlunders = 0;
      let lostInOpening = false;
      for (let i = 0; i < g.ucis.length; i++) {
        const before = scores[i];
        if (!before) continue;
        const afterRaw = scores[i + 1];
        const pos = mustPosition(g.fens[i]!);
        // the position after, from the mover's side: a finished game is a win (they mated) or a draw
        const after: Score = afterRaw ? (afterRaw.mate !== undefined ? { mate: -afterRaw.mate } : { cp: -(afterRaw.cp ?? 0) }) : mustPosition(g.fens[i + 1]!).isCheckmate() ? { mate: 1 } : { cp: 0 };
        const lossCp = cpOf(before) - cpOf(after);
        const live = isLive(before);
        const drop = winChance(before) - winChance(after);
        const phase = phaseOf(g.fens[i]!, i);
        for (const tally of [all, byPhase[phase]]) {
          tally.moves++;
          if (live) tally.live++;
          if (lossCp >= 150) tally.blunders150++;
          if (live && lossCp >= 150) tally.liveBlunders150++;
          if (drop >= 15) tally.lichessBlunders++;
        }
        if (live && lossCp >= 150) {
          gameBlunders++;
          if (phase === 'opening' && winChance(after) <= 10) lostInOpening = true;
        }
        // free material: something can be captured and the trade on that square wins material
        const loose = capturables(pos).filter((c) => c.net >= 1);
        if (loose.length) {
          const move = uciToMove(pos, g.ucis[i]!)!;
          const info = describeMove(pos, move);
          const took = Boolean(info.captured) && loose.some((c) => c.piece.square === info.to);
          const piece = loose.filter((c) => c.net >= 3);
          const tookPiece = Boolean(info.captured) && piece.some((c) => c.piece.square === info.to);
          for (const tally of [all, byPhase[phase]]) {
            tally.freeChances++;
            if (took) tally.freeTaken++;
            if (piece.length) {
              tally.pieceChances++;
              if (tookPiece) tally.pieceTaken++;
            }
          }
        }
      }
      perGameBlunders.push(gameBlunders);
      if (lostInOpening) decisiveByBlunderInOpening++;
    }),
  );
  const per100 = (t2: Tally) => (t2.live ? round((100 * t2.liveBlunders150) / t2.live) : null);
  const pct = (a: number, b: number) => (b ? round((100 * a) / b) : null);
  const row = {
    games: games.length,
    averagePlies: Math.round(games.reduce((s, g) => s + g.ucis.length, 0) / games.length),
    endings: games.reduce<Record<string, number>>((m, g) => ((m[g.how] = (m[g.how] ?? 0) + 1), m), {}),
    moves: all.moves,
    liveMoves: all.live,
    blundersPer100LiveMoves: { all: per100(all), opening: per100(byPhase.opening), middlegame: per100(byPhase.middlegame), endgame: per100(byPhase.endgame) },
    blundersPerGamePerSide: round(perGameBlunders.reduce((s, n) => s + n, 0) / games.length / 2, 2),
    lichessStyleBlundersPer100Moves: pct(all.lichessBlunders, all.moves),
    freeMaterialTakenPct: pct(all.freeTaken, all.freeChances),
    freeMaterialChances: all.freeChances,
    freePieceTakenPct: pct(all.pieceTaken, all.pieceChances),
    freePieceChances: all.pieceChances,
    gamesDecidedByAnOpeningBlunderPct: pct(decisiveByBlunderInOpening, games.length),
    seconds: Math.round((Date.now() - t) / 1000),
  };
  profile[elo] = row;
  say(`   ${elo}: ${JSON.stringify(row.blundersPer100LiveMoves)} per 100 live moves; free material taken ${row.freeMaterialTakenPct}% (a piece: ${row.freePieceTakenPct}%)`);
  report.profile = profile;
  save();
}
await engine.stop();

report.published = {
  source: 'chessstats.gg/stats/lichess-rating-guide (Lichess rapid; blunder = a loss of 150 centipawns or more on a live move; method not public)',
  '600': { openingBlundersPer100LiveMoves: 32.1, endgameBlundersPer100LiveMoves: 33.6, freeMaterialTakenPct: 62, lostInTheOpeningPct: 19.7 },
  '1000': { openingBlundersPer100LiveMoves: 17.5, endgameBlundersPer100LiveMoves: 22.0, freeMaterialTakenPct: 77, lostInTheOpeningPct: 10.8 },
};
save();
console.log(JSON.stringify(report, null, 2));
process.exit(0);
