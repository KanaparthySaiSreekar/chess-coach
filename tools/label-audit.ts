// An audit of the move labels on beginner-level games (decision D47).
//
// Plays games between two Maia bots (people-like mistakes at a chosen rating), labels every move
// exactly as the page does, and looks for labels that common sense would not accept:
//   A. a move labelled best / excellent / good / great / brilliant that, by the engine's own line,
//      ends up losing two points of material or more;
//   B. a move with one of those labels after which a piece of the mover's can simply be taken
//      (worth three points or more, by the exchange on that square) and the engine's reply takes it;
//   C. a move labelled blunder / mistake that neither loses material, nor allows mate, nor misses
//      anything, in a game that was already decided.
// It prints the count of each label and every case found, so they can be read one by one.
//
//   node tools/label-audit.ts [--games 12] [--elo 700] [--nodes 250000] [--seed 1]

import { START_FEN, capturables, describeMove, labelMove, mustPosition, uciToMove, winChance, type EngineEval, type MoveLabel } from '@chess-coach/core';
import { MaiaSidecar, legalOnly, sampleMove } from '../packages/server/src/bots/service.ts';
import { config } from '../packages/server/src/config.ts';
import { EngineService } from '../packages/server/src/engine/service.ts';
import { OpeningBook } from '../packages/server/src/openings.ts';

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const GAMES = arg('games', 12);
const ELO = arg('elo', 700);
const NODES = arg('nodes', 250_000);
const SEED = arg('seed', 1);

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

type Step = { game: number; n: string; fenBefore: string; san: string; uci: string; fenAfter: string };

const maia = new MaiaSidecar({ python: config.maiaPython, script: config.maiaSidecar, spec: () => ({ model: 'maia3-5m', checkpoint: `${config.maiaModels}/maia3-5m.pt`, device: 'cpu' }) });
const steps: Step[] = [];
for (let game = 0; game < GAMES; game++) {
  const rng = mulberry32(SEED * 1000 + game);
  const pos = mustPosition(START_FEN);
  const ucis: string[] = [];
  let fen = START_FEN;
  while (!pos.isEnd() && ucis.length < 160 && pos.halfmoves < 100) {
    const probs = legalOnly(fen, await maia.probabilities({ startFen: START_FEN, moves: ucis, selfElo: ELO, oppoElo: ELO }));
    const pick = sampleMove(probs, { temperature: 1, topP: 1, rng });
    const move = pick ? uciToMove(pos, pick.uci) : null;
    if (!move) break;
    const info = describeMove(pos, move);
    steps.push({ game, n: `${pos.fullmoves}${pos.turn === 'white' ? '.' : '...'}`, fenBefore: fen, san: info.san, uci: info.uci, fenAfter: info.fenAfter });
    pos.play(move);
    ucis.push(info.uci);
    fen = info.fenAfter;
  }
}
maia.stop();
console.error(`${GAMES} games at ${ELO}: ${steps.length} moves; labelling with ${NODES} nodes…`);

const engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 1, analysisWorkers: 8 });
engine.signature = 'label-audit';
const book = OpeningBook.load(config.openingsDir);
const POSITIVE = new Set<MoveLabel>(['best', 'excellent', 'good', 'great', 'brilliant']);
const counts: Record<string, number> = {};
const byFloor: Record<string, number> = {};
const cases: string[] = [];

await Promise.all(
  steps.map(async (s) => {
    const before = await engine.analyse({ fen: s.fenBefore, nodes: NODES, multipv: 3, pool: 'analysis' });
    const ev: EngineEval = { fen: before.fen, lines: before.lines };
    const played = ev.lines.find((l) => l.pv[0] === s.uci) ?? (await engine.analyse({ fen: s.fenBefore, nodes: NODES, multipv: 1, searchmoves: [s.uci], pool: 'analysis' })).lines[0];
    if (!played) return;
    const r = labelMove({ fenBefore: s.fenBefore, san: s.san, evalBefore: ev, playedLine: played, book: book.at(s.fenAfter) });
    if (!r) return;
    const label = r.judged.label;
    counts[label] = (counts[label] ?? 0) + 1;
    const g = r.grade;
    if (!g) return;
    if (g.floor) byFloor[`${g.floor}${g.decided ? ` (${g.decided})` : ''} -> ${label}`] = (byFloor[`${g.floor}${g.decided ? ` (${g.decided})` : ''} -> ${label}`] ?? 0) + 1;
    const pawns = (x: { cp?: number; mate?: number }) => (x.mate !== undefined ? `#${x.mate}` : ((x.cp ?? 0) / 100).toFixed(1));
    const where = `game ${s.game + 1} ${s.n}${s.san} [${label}${r.judged.why ? `: ${r.judged.why}` : ''}] eval ${pawns(g.bestScore)}->${pawns(g.playedScore)} win ${winChance(g.bestScore).toFixed(0)}->${winChance(g.playedScore).toFixed(0)} material ${g.playedDelta} (best ${g.best} ${g.bestDelta}) line ${g.line.join(' ')}`;
    const explained = !!r.judged.why;
    if (POSITIVE.has(label) && !g.isBest && g.playedDelta <= -2 && !explained) cases.push(`A  ${where}\n     ${s.fenBefore}`);
    if (POSITIVE.has(label) && !g.isBest) {
      const after = mustPosition(s.fenAfter);
      const loose = capturables(after).find((c) => c.net >= 3 && c.piece.role !== 'pawn');
      const reply = played.pv[1] ? uciToMove(after, played.pv[1]) : null;
      const replyInfo = reply ? describeMove(after, reply) : null;
      if (loose && replyInfo?.captured && replyInfo.to === loose.piece.square && g.playedDelta < 0 && !explained) cases.push(`B  ${where}\n     leaves the ${loose.piece.role} on ${loose.piece.square} to ${replyInfo.san}\n     ${s.fenBefore}`);
    }
    if ((label === 'blunder' || label === 'mistake') && g.decided && !g.floor && g.playedDelta >= 0 && g.mateAllowed === undefined && !g.missed) cases.push(`C  ${where}\n     ${s.fenBefore}`);
  }),
);
await engine.stop();

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`labels over ${total} moves:`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(11)} ${String(v).padStart(5)}  ${((100 * v) / total).toFixed(1)}%`);
console.log('labels made worse by what the move gives away (the new rule):');
for (const [k, v] of Object.entries(byFloor).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${v}`);
console.log(`cases to read: ${cases.length}`);
for (const c of cases.sort()) console.log(c);
process.exit(0);
