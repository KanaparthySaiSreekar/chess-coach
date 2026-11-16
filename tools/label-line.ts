// Label every move of a line the way the page does, and show the numbers behind each label.
// For comparing this app's labels with another site's review of the same game.
//
//   node tools/label-line.ts "1.e4 e5 2.Nf3 Nc6 ..." [--nodes 1000000] [--fen "<start fen>"] [--json]
//
// Uses the same code as the page (core's labelMove) on Stockfish alone: no Lichess cloud, no
// database, so the output depends only on the moves and the node budget.

import { START_FEN, describeMove, labelMove, mustPosition, sanToMove, winChance, LABEL_NAME, type EngineEval, type EngineLine } from '@chess-coach/core';
import { EngineService } from '../packages/server/src/engine/service.ts';
import { config } from '../packages/server/src/config.ts';
import { OpeningBook } from '../packages/server/src/openings.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const nodes = Number(flag('nodes') ?? 1_000_000);
const startFen = flag('fen') ?? START_FEN;
const asJson = args.includes('--json');
const text = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--') && args[i - 1] !== '--json')) ?? '';
const sans = text
  .replace(/\{[^}]*\}/g, ' ')
  .replace(/\d+\.(\.\.)?/g, ' ')
  .split(/\s+/)
  .map((s) => s.replace(/[!?]+$/, ''))
  .filter((s) => s && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(s));

const engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 1, analysisWorkers: 6 });
engine.signature = 'label-line';
const book = OpeningBook.load(config.openingsDir);

const pos = mustPosition(startFen);
const steps: { fenBefore: string; san: string; uci: string; fenAfter: string; by: string; n: string }[] = [];
for (const raw of sans) {
  const move = sanToMove(pos, raw);
  if (!move) {
    console.error(`illegal move in the line: ${raw} (after ${steps.map((s) => s.san).join(' ')})`);
    process.exit(1);
  }
  const fenBefore = pos.toSetup ? (await import('@chess-coach/core')).fenOf(pos) : '';
  const info = describeMove(pos, move);
  steps.push({ fenBefore, san: info.san, uci: info.uci, fenAfter: info.fenAfter, by: pos.turn, n: `${pos.fullmoves}${pos.turn === 'white' ? '.' : '...'}` });
  pos.play(move);
}

const cp = (l: EngineLine | undefined) => (!l ? '?' : l.score.mate !== undefined ? `#${l.score.mate}` : ((l.score.cp ?? 0) / 100).toFixed(2));
const rows = await Promise.all(
  steps.map(async (s) => {
    const before = await engine.analyse({ fen: s.fenBefore, nodes, multipv: 3, pool: 'analysis' });
    const ev: EngineEval = { fen: before.fen, lines: before.lines };
    const played = ev.lines.find((l) => l.pv[0] === s.uci) ?? (await engine.analyse({ fen: s.fenBefore, nodes, multipv: 1, searchmoves: [s.uci], pool: 'analysis' })).lines[0];
    const r = played ? labelMove({ fenBefore: s.fenBefore, san: s.san, evalBefore: ev, playedLine: played, book: book.at(s.fenAfter) }) : null;
    const best = ev.lines[0];
    return {
      move: `${s.n}${s.san}`,
      by: s.by,
      label: r ? r.judged.label : '?',
      why: r?.judged.why,
      best: r?.judged.best,
      bestEval: cp(best),
      playedEval: cp(played),
      winBefore: best ? Math.round(winChance(best.score) * 10) / 10 : null,
      winAfter: played ? Math.round(winChance(played.score) * 10) / 10 : null,
      drop: r?.grade ? Math.round(r.grade.drop * 10) / 10 : null,
      material: r?.grade ? r.grade.playedDelta : null,
      bestMaterial: r?.grade ? r.grade.bestDelta : null,
      outcome: r?.grade?.playedOutcome,
    };
  }),
);
await engine.stop();

if (asJson) console.log(JSON.stringify(rows, null, 2));
else {
  console.log(`${nodes.toLocaleString('en-US')} nodes a position. Evaluations are from the mover's side, in pawns; "win" is the mover's winning chances.`);
  for (const r of rows) {
    const label = r.label === '?' ? '?' : LABEL_NAME[r.label as keyof typeof LABEL_NAME];
    console.log(
      `${r.move.padEnd(11)} ${label.padEnd(11)} best ${String(r.bestEval).padStart(6)} played ${String(r.playedEval).padStart(6)}  win ${String(r.winBefore).padStart(5)} -> ${String(r.winAfter).padStart(5)}  drop ${String(r.drop ?? '-').padStart(5)}  material ${String(r.material ?? '-').padStart(3)}${r.best ? `  best: ${r.best}` : ''}${r.why ? `  (${r.why})` : ''}`,
    );
  }
}
process.exit(0);
