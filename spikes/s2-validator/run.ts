// Spike S2: validator (docs/PLAN.md, Phase 2).
//
// Question: do the rules catch invented chess without blocking true sentences?
// Method:   40 hand-written coach messages on real positions: 20 true, 20 with a planted error.
// Pass:     >= 19 of 20 false caught; <= 1 of 20 true blocked.
//
// Usage: node spikes/s2-validator/dump.ts   (once: builds packets.json with the engine)
//        node spikes/s2-validator/run.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSay, type Fact, type FactPacket } from '@chess-coach/core';
import { MESSAGES } from './messages.ts';
import { POSITIONS } from './positions.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const packets = JSON.parse(readFileSync(path.join(here, 'packets.json'), 'utf8')) as { key: string; packet: FactPacket }[];
const facts = new Map<string, Fact>();
for (const p of packets) for (const f of p.packet.facts) facts.set(f.id, f);

let falseCaught = 0;
let trueBlocked = 0;
const rows: string[] = [];
MESSAGES.forEach((m, i) => {
  const pos = POSITIONS.find((p) => p.key === m.pos)!;
  const verdict = validateSay(
    { kind: m.kind, text: m.text, claims: m.claims },
    { fen: pos.fen, you: pos.you, fact: (id) => facts.get(id), budgetSentences: 2, canAnswer: true, vocabulary: 'core' },
  );
  const rejected = !verdict.ok;
  if (!m.truth && rejected) falseCaught++;
  if (m.truth && rejected) trueBlocked++;
  const status = m.truth ? (rejected ? 'TRUE BLOCKED  ' : 'true passed   ') : rejected ? 'false caught  ' : 'FALSE MISSED  ';
  rows.push(`${String(i + 1).padStart(2)} ${status} [${m.pos}] ${m.text}${rejected ? `\n      → ${verdict.problems.map((p) => `${p.rule}: ${p.message}`).join('\n      → ')}` : ''}`);
});
console.log(rows.join('\n'));
const nFalse = MESSAGES.filter((m) => !m.truth).length;
const nTrue = MESSAGES.length - nFalse;
console.log(`\nfalse caught: ${falseCaught} / ${nFalse}    true blocked: ${trueBlocked} / ${nTrue}`);
console.log(`PASS: ${falseCaught >= 19 && trueBlocked <= 1}`);
