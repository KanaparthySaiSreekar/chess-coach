// Step 1 of spike S2: build the real fact packets for the eight positions and save them.
// Node-limited searches make this repeatable, so the hand-written messages can cite fact ids.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineService } from '../../packages/server/src/engine/service.ts';
import { FactService } from '../../packages/server/src/facts-service.ts';
import { OpeningBook } from '../../packages/server/src/openings.ts';
import { config } from '../../packages/server/src/config.ts';
import { POSITIONS } from './positions.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 4 });
engine.signature = 'sf19';
const facts = new FactService(engine, { nodes: 250_000 });
const book = OpeningBook.load(config.openingsDir);
const out = [];
const t0 = Date.now();
for (const p of POSITIONS) {
  const t = Date.now();
  const packet = await facts.packet({ fen: p.fen, you: p.you, lastMove: p.lastMove, opening: book.lookup([p.fen]) });
  out.push({ key: p.key, about: p.about, ms: Date.now() - t, packet });
}
await engine.stop();
writeFileSync(path.join(here, 'packets.json'), JSON.stringify(out, null, 1));
console.log(`openings loaded: ${book.count}; ${out.length} packets in ${Date.now() - t0} ms`);
for (const o of out) {
  console.log(`\n=== ${o.packet.id} ${o.key}: ${o.about} (${o.ms} ms)\n${o.packet.fen}`);
  for (const f of o.packet.facts) console.log(`  ${f.id} [${f.type}] ${f.text}`);
  console.log(`  cct mine: ${JSON.stringify(o.packet.cct.mine)}\n  cct theirs: ${JSON.stringify(o.packet.cct.theirs)}`);
  console.log(`  graded: ${JSON.stringify(o.packet.graded)} skipped: ${o.packet.skippedStep} findable: ${JSON.stringify(o.packet.findable)}`);
}
