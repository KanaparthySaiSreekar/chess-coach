// Spike S6, the fallback: two transcriptions of the same pages, made independently, compared
// item by item. Wherever they differ, at least one of them is wrong, and the spot goes to the
// owner's doubts list with its page. A slip survives only if both sessions make the same one.
//
// Usage: node spikes/s6-pdf/compare.ts [a.json] [b.json]     (writes compare.json)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTranscription, type Transcription } from './check.ts';
import { compareTranscriptions } from './diff.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Transcription;
const a = read(process.argv[2] ?? path.join(here, 'transcription.json'));
const b = read(process.argv[3] ?? path.join(here, 'transcription-b.json'));

const { differences, movesCompared, squaresCompared, diagramsCompared, linesCompared } = compareTranscriptions(a, b);

const checkA = checkTranscription(a);
const checkB = checkTranscription(b);
const hard = (c: typeof checkA) => c.problems.filter((p) => p.hard).map((p) => `p.${p.bookPage} ${p.example}${p.line ? ` [${p.line}]` : ''}${p.move ? ` "${p.move}"` : ''}: ${p.text}`);

const report = {
  when: new Date().toISOString(),
  compared: { examples: a.examples.length, lines: linesCompared, moves: movesCompared, diagrams: diagramsCompared, diagramSquares: squaresCompared },
  differences,
  byKind: differences.reduce<Record<string, number>>((m, d) => ((m[d.what] = (m[d.what] ?? 0) + 1), m), {}),
  checksOnA: hard(checkA),
  checksOnB: hard(checkB),
};
writeFileSync(path.join(here, 'compare.json'), JSON.stringify(report, null, 2));

console.log(`compared: ${movesCompared} moves in ${linesCompared} lines, ${diagramsCompared} diagrams (${squaresCompared} squares)`);
console.log(`differences: ${differences.length} ${JSON.stringify(report.byKind)}`);
for (const d of differences) console.log(`  p.${d.bookPage} ${d.example} ${d.what}: ${d.where}\n      first:  ${d.a}\n      second: ${d.b}`);
console.log(`replay and diagram checks on the first: ${report.checksOnA.length} problem(s)`);
for (const p of report.checksOnA) console.log(`  ${p}`);
console.log(`replay and diagram checks on the second: ${report.checksOnB.length} problem(s)`);
for (const p of report.checksOnB) console.log(`  ${p}`);
