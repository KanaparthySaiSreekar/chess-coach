// How the real Maia plays the mini-games (PLAN WP 7.6; the question spike S4 left open for them).
//
// Maia-3 learned from whole games; the mini-games start it from positions no real game reaches
// (eight pawns each and no pieces, a queen against eight pawns, a lone king). This plays each
// mini-game with Maia on the bot's side at a few ratings, and on the owner's side either Stockfish
// (an owner who plays perfectly) or Maia at 600 (an owner at about the owner's level). Every bot
// move is labelled exactly as the page labels it, and the same is done for Maia in ordinary games
// from the start position, so the two can be compared on one measure.
//
// It prints, per mini-game and rating: how the games ended (by the goal, as `miniVerdict` decides
// it), how many moves the owner's side needed, the bot's mistakes and blunders per 100 moves, and
// how sure Maia was of its first choice (the share of its top move: a flat spread is a sign of a
// position it does not know). Each mini-game is also played engine against engine: what perfect
// play does from its start (for a mate, the fastest there is).
//
//   node tools/minigame-maia.ts [--games 6] [--base 3] [--elos 600,1000,1500] [--nodes 150000] [--seed 1] [--only <mini-game id>] [--json <file>]

import { writeFileSync } from 'node:fs';
import { START_FEN, describeMove, gameStatus, labelMove, miniVerdict, mustPosition, positionKey, uciToMove, type Color, type EngineEval, type MiniGame } from '@chess-coach/core';
import { MaiaSidecar, legalOnly, sampleMove } from '../packages/server/src/bots/service.ts';
import { config } from '../packages/server/src/config.ts';
import { EngineService } from '../packages/server/src/engine/service.ts';
import { OpeningBook } from '../packages/server/src/openings.ts';
import { loadMinis } from '../packages/server/src/play.ts';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const GAMES = Number(arg('games', '6'));
const BASE = Number(arg('base', '3'));
const ELOS = arg('elos', '600,1000,1500').split(',').map(Number);
const NODES = Number(arg('nodes', '150000'));
const SEED = Number(arg('seed', '1'));
const JSON_OUT = arg('json', '');
const ONLY = arg('only', '');
const OWNER_ELO = 600;
const MAX_PLIES = 240;

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

type Owner = 'engine' | 'maia600';
type BotStep = { fenBefore: string; san: string; uci: string; fenAfter: string; top: number };
type Played = { botSteps: BotStep[]; ownerMoves: number; plies: number; end: string; winner: Color | 'draw' | null };

const maia = new MaiaSidecar({ python: config.maiaPython, script: config.maiaSidecar, spec: () => ({ model: 'maia3-5m', checkpoint: `${config.maiaModels}/maia3-5m.pt`, device: 'cpu' }) });
const engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 1, analysisWorkers: 6 });
engine.signature = 'minigame-maia';
const book = OpeningBook.load(config.openingsDir);

async function maiaMove(rootFen: string, ucis: string[], fen: string, elo: number, rng: () => number): Promise<{ uci: string; top: number } | null> {
  const probs = legalOnly(fen, await maia.probabilities({ startFen: rootFen, moves: ucis, selfElo: elo, oppoElo: elo }));
  const pick = sampleMove(probs, { temperature: 1, topP: 1, rng });
  return pick ? { uci: pick.uci, top: Math.max(...probs.map((p) => p.p)) } : null;
}

async function engineMove(fen: string): Promise<string | null> {
  const r = await engine.analyse({ fen, nodes: NODES, multipv: 1, pool: 'analysis' });
  return r.lines[0]?.pv[0] ?? null;
}

/** One game from `rootFen`. `bot` plays the side that is not `you`; `you` is played by `owner`. */
async function play(rootFen: string, you: Color, mini: MiniGame | null, botElo: number | 'engine', owner: Owner, rng: () => number): Promise<Played> {
  const pos = mustPosition(rootFen);
  const ucis: string[] = [];
  const botSteps: BotStep[] = [];
  let fen = rootFen;
  let ownerMoves = 0;
  // the app ends a game at the third time a position comes up (play.ts); Maia's side (python-chess) would refuse to move at the fifth
  const seen = new Map<string, number>([[positionKey(rootFen), 1]]);
  while (ucis.length < MAX_PLIES) {
    const status = gameStatus(pos);
    if (status.over) return { botSteps, ownerMoves, plies: ucis.length, end: status.text ?? 'over', winner: status.winner ?? 'draw' };
    if (pos.halfmoves >= 100) return { botSteps, ownerMoves, plies: ucis.length, end: 'fifty moves', winner: 'draw' };
    if ((seen.get(positionKey(fen)) ?? 0) >= 3) return { botSteps, ownerMoves, plies: ucis.length, end: 'repetition', winner: 'draw' };
    const by = pos.turn;
    let uci: string | null = null;
    let top = 1;
    if (by === you) uci = owner === 'engine' ? await engineMove(fen) : ((await maiaMove(rootFen, ucis, fen, OWNER_ELO, rng))?.uci ?? null);
    else if (botElo === 'engine') uci = await engineMove(fen);
    else {
      const m = await maiaMove(rootFen, ucis, fen, botElo, rng);
      uci = m?.uci ?? null;
      top = m?.top ?? 1;
    }
    const move = uci ? uciToMove(pos, uci) : null;
    if (!move) {
      console.error(`no move from ${by === you ? 'the owner side' : 'the bot'} in ${fen} after ${ucis.join(' ')}`);
      return { botSteps, ownerMoves, plies: ucis.length, end: 'no move', winner: null };
    }
    const info = describeMove(pos, move);
    if (by !== you) botSteps.push({ fenBefore: fen, san: info.san, uci: info.uci, fenAfter: info.fenAfter, top });
    else ownerMoves++;
    pos.play(move);
    ucis.push(info.uci);
    fen = info.fenAfter;
    seen.set(positionKey(fen), (seen.get(positionKey(fen)) ?? 0) + 1);
    const verdict = mini ? miniVerdict(mini, { san: info.san, by, fenAfter: info.fenAfter }, ownerMoves) : null;
    if (verdict) return { botSteps, ownerMoves, plies: ucis.length, end: verdict.text, winner: verdict.winner ?? 'draw' };
  }
  return { botSteps, ownerMoves, plies: ucis.length, end: 'move cap', winner: null };
}

/** The page's label for every bot move. */
async function labels(steps: BotStep[], useBook: boolean): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(
    steps.map(async (s) => {
      const before = await engine.analyse({ fen: s.fenBefore, nodes: NODES, multipv: 3, pool: 'analysis' });
      const ev: EngineEval = { fen: before.fen, lines: before.lines };
      const played = ev.lines.find((l) => l.pv[0] === s.uci) ?? (await engine.analyse({ fen: s.fenBefore, nodes: NODES, multipv: 1, searchmoves: [s.uci], pool: 'analysis' })).lines[0];
      if (!played) return;
      const r = labelMove({ fenBefore: s.fenBefore, san: s.san, evalBefore: ev, playedLine: played, book: useBook ? book.at(s.fenAfter) : undefined });
      if (!r) return;
      counts[r.judged.label] = (counts[r.judged.label] ?? 0) + 1;
    }),
  );
  return counts;
}

type Row = { game: string; owner: Owner | 'engine (defender too)'; elo: number | 'engine'; games: number; outcomes: Record<string, number>; ownerMovesAvg: number; botMoves: number; labels: Record<string, number>; badPer100: number; blundersPer100: number; topShareAvg: number };

function summarise(game: string, owner: Row['owner'], elo: Row['elo'], played: Played[], counts: Record<string, number>): Row {
  const outcomes: Record<string, number> = {};
  for (const p of played) outcomes[p.end] = (outcomes[p.end] ?? 0) + 1;
  const steps = played.flatMap((p) => p.botSteps);
  const judged = Object.entries(counts).filter(([k]) => k !== 'forced' && k !== 'book').reduce((a, [, v]) => a + v, 0);
  const per100 = (n: number) => (judged ? Math.round((1000 * n) / judged) / 10 : 0);
  return {
    game,
    owner,
    elo,
    games: played.length,
    outcomes,
    ownerMovesAvg: Math.round((10 * played.reduce((a, p) => a + p.ownerMoves, 0)) / Math.max(1, played.length)) / 10,
    botMoves: steps.length,
    labels: counts,
    badPer100: per100((counts.mistake ?? 0) + (counts.blunder ?? 0)),
    blundersPer100: per100(counts.blunder ?? 0),
    topShareAvg: steps.length ? Math.round((100 * steps.reduce((a, s) => a + s.top, 0)) / steps.length) : 0,
  };
}

const minis = loadMinis(`${config.repoRoot}/content/minigames.json`, (m) => console.error(m)).filter((m) => !ONLY || m.id === ONLY);
const rows: Row[] = [];
const started = Date.now();
for (const elo of ELOS) {
  // the baseline: Maia against Maia at the same rating, a whole game from the start
  const base: Played[] = [];
  for (let i = 0; i < BASE; i++) base.push(await play(START_FEN, 'white', null, elo, 'maia600', mulberry32(SEED * 7919 + elo + i)));
  rows.push(summarise('ordinary game (baseline)', 'maia600', elo, base, await labels(base.flatMap((p) => p.botSteps), true)));
  console.error(`${Math.round((Date.now() - started) / 1000)} s: baseline at ${elo}`);
  for (const m of minis) {
    for (const owner of ['engine', 'maia600'] as Owner[]) {
      const games: Played[] = [];
      for (let i = 0; i < GAMES; i++) games.push(await play(m.fen, m.you, m, elo, owner, mulberry32(SEED * 1000 + elo * 10 + i + (owner === 'engine' ? 0 : 500))));
      rows.push(summarise(m.id, owner, elo, games, await labels(games.flatMap((p) => p.botSteps), false)));
      console.error(`${Math.round((Date.now() - started) / 1000)} s: ${m.id} at ${elo} against ${owner}`);
    }
  }
}
// every mini-game with the engine on both sides: what perfect play does from the start (the shortest mate there is)
for (const m of minis) {
  const p = await play(m.fen, m.you, m, 'engine', 'engine', mulberry32(SEED));
  rows.push(summarise(m.id, 'engine (defender too)', 'engine', [p], {}));
}
maia.stop();
await engine.stop();

for (const r of rows) {
  const out = Object.entries(r.outcomes).map(([k, v]) => `${v}× ${k}`).join('; ');
  console.log(`${r.game.padEnd(26)} bot ${String(r.elo).padEnd(6)} owner ${r.owner.padEnd(8)} ${String(r.games).padStart(2)} games  owner moves ${String(r.ownerMovesAvg).padStart(5)}  bot moves ${String(r.botMoves).padStart(4)}  mistakes+blunders/100 ${String(r.badPer100).padStart(5)} (blunders ${String(r.blundersPer100).padStart(5)})  top share ${String(r.topShareAvg).padStart(3)}%  | ${out}`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, `${JSON.stringify({ when: new Date().toISOString(), settings: { GAMES, BASE, ELOS, NODES, SEED, OWNER_ELO, MAX_PLIES }, seconds: Math.round((Date.now() - started) / 1000), rows }, null, 2)}\n`);
process.exit(0);
