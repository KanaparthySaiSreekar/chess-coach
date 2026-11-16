// Development aid: what the engine reports for an endgame position, and the exact result read from
// it (five pieces or fewer: the Syzygy tablebases in C:\Tools\Syzygy).
//   node tools/tb-probe.ts "<fen>" ["<fen>" …]

import { gaugeOf, gaugeWords, tablebaseResult } from '@chess-coach/core';
import { config } from '../packages/server/src/config.ts';
import { EngineService } from '../packages/server/src/engine/service.ts';

const engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 1, analysisWorkers: 1 });
engine.signature = 'tb-probe';
for (const fen of process.argv.slice(2)) {
  const r = await engine.analyse({ fen, nodes: 250_000, multipv: 1 });
  const ev = { fen: r.fen, lines: r.lines, tbhits: r.tbhits };
  const g = gaugeOf(r.fen, r.lines[0], r.tbhits);
  console.log(`${fen}\n  score ${JSON.stringify(r.lines[0]?.score)} · tbhits ${r.tbhits} · nodes ${r.nodes} · for the side to move: ${tablebaseResult(r.fen, ev) ?? 'not exact'} · bar: ${g ? gaugeWords(g) : '-'}`);
}
await engine.stop();
process.exit(0);
