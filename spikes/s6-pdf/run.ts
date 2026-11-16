// Spike S6: a book chapter from page images to checked moves (docs/PLAN.md, Phase 2).
//
// Question: can a book chapter be transcribed and checked exactly?
// Method:   a separate session read the page images of Capablanca's "Chess Fundamentals" (1921,
//           public domain; part of Chapter I) and wrote down the printed moves and diagrams
//           (transcription.json). This script replays them (V1) and compares every diagram with
//           the replayed position (V7): check.ts. Then it plants errors: the three the plan
//           asks for, and after them every single slip it can make (one wrong digit, file or
//           piece letter in a move, a dropped move, two moves swapped, a piece moved, removed or
//           recoloured in a diagram), one at a time, to measure how many the two checks catch.
// Pass:     all planted errors caught by the legality or diagram check.
//
// Usage: node spikes/s6-pdf/run.ts [transcription.json]    (writes result.json and chapter.pgn)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTranscription, problemKey, type MoveItem, type Problem, type Transcription } from './check.ts';
import { compareTranscriptions, differenceKey } from './diff.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.join(here, 'transcription.json');
const original = JSON.parse(readFileSync(file, 'utf8')) as Transcription;
const clone = (t: Transcription) => JSON.parse(JSON.stringify(t)) as Transcription;

// ------------------------------------------------------------ the transcription as it came

const base = checkTranscription(original);
const baseKeys = new Set(base.problems.map(problemKey));
const baseHard = base.problems.filter((p) => p.hard);
const show = (p: Problem) => `p.${p.bookPage} ${p.example}${p.line ? ` [${p.line}]` : ''}${p.move ? ` "${p.move}"` : ''}: ${p.text}`;

writeFileSync(path.join(here, 'chapter.pgn'), base.examples.map((e) => e.pgn ?? '').filter(Boolean).join('\n\n') + '\n');

// ------------------------------------------------------------ planting errors

type Mutant = { kind: string; where: string; apply: (t: Transcription) => void };

const moveText = (m: MoveItem) => (typeof m === 'string' ? m : null);

/** Every single slip in one printed move. */
function moveMutants(t: Transcription): Mutant[] {
  const out: Mutant[] = [];
  t.examples.forEach((ex, e) =>
    ex.lines.forEach((line, l) =>
      line.moves.forEach((item, i) => {
        const text = moveText(item);
        const where = `${ex.id} [${line.id}] move ${i + 1}`;
        const set = (kind: string, changed: string) => {
          if (changed !== text) out.push({ kind, where: `${where}: "${text}" -> "${changed}"`, apply: (x) => (x.examples[e]!.lines[l]!.moves[i] = changed) });
        };
        // a move left out, and two neighbours swapped, also apply to the vague ones
        out.push({ kind: 'move dropped', where: `${where}: "${text ?? 'vague'}" left out`, apply: (x) => void x.examples[e]!.lines[l]!.moves.splice(i, 1) });
        if (!text) return;
        const m = text.match(/^(\d+\s*\.+\s*)(.*)$/);
        if (!m) return;
        const [, prefix, body] = m as unknown as [string, string, string];
        // the destination's rank digit, one up and one down
        const digit = body.match(/^(.*?[-x].*?)([1-8])(.*)$/);
        if (digit) {
          const d = Number(digit[2]);
          if (d < 8) set('rank digit wrong', `${prefix}${digit[1]}${d + 1}${digit[3]}`);
          if (d > 1) set('rank digit wrong', `${prefix}${digit[1]}${d - 1}${digit[3]}`);
        }
        // the destination's file name
        const dest = body.match(/^(.*?-)(QR|QKt|QB|KB|KKt|KR|Q|K|R|Kt|B)([1-8].*)$/);
        if (dest) {
          const swaps: Record<string, string[]> = { K: ['Q', 'B'], Q: ['K', 'B'], B: ['Kt', 'K', 'Q'], Kt: ['B', 'R'], R: ['Kt'], KB: ['QB', 'K'], QB: ['KB', 'Q'], KKt: ['QKt', 'KB'], QKt: ['KKt', 'QB'], KR: ['QR', 'KKt'], QR: ['KR', 'QKt'] };
          for (const other of swaps[dest[2]!] ?? []) set('file name wrong', `${prefix}${dest[1]}${other}${dest[3]}`);
        }
        // the moving piece's letter
        const piece = body.match(/^(Kt|K|Q|R|B|P)([-x].*)$/);
        if (piece) {
          const swaps: Record<string, string[]> = { K: ['Q', 'R'], Q: ['K', 'R'], R: ['K', 'B'], B: ['R', 'Kt'], Kt: ['K', 'B'], P: ['B'] };
          for (const other of swaps[piece[1]!] ?? []) set('piece letter wrong', `${prefix}${other}${piece[2]}`);
        }
        // the captured piece's letter
        const cap = body.match(/^(.*x)(Kt|Q|R|B|P)(\b.*)$/);
        if (cap) {
          const swaps: Record<string, string[]> = { Q: ['R'], R: ['B'], B: ['Kt', 'P'], Kt: ['B', 'P'], P: ['Kt', 'B'] };
          for (const other of swaps[cap[2]!] ?? []) set('captured piece wrong', `${prefix}${cap[1]}${other}${cap[3]}`);
        }
        // a printed "ch" or "mate" lost, or one added
        if (/\s(ch|mate)\b/.test(body)) set('ch / mate lost', `${prefix}${body.replace(/\s+(ch|mate)\b\.?/, '')}`);
        else set('ch added', `${prefix}${body} ch`);
        // this move and the next one swapped (kept under their own numbers)
        const next = line.moves[i + 1];
        const nextText = next ? moveText(next) : null;
        const nm = nextText?.match(/^(\d+\s*\.+\s*)(.*)$/);
        if (nm && nm[2] !== body) {
          out.push({
            kind: 'two moves swapped',
            where: `${where}: "${text}" and "${nextText}" swapped`,
            apply: (x) => {
              const ms = x.examples[e]!.lines[l]!.moves;
              ms[i] = `${prefix}${nm[2]}`;
              ms[i + 1] = `${nm[1]}${body}`;
            },
          });
        }
      }),
    ),
  );
  return out;
}

const expand = (placement: string) => placement.split('/').map((row) => [...row.replace(/\d/g, (d) => '.'.repeat(Number(d)))]);
const compress = (grid: string[][]) => grid.map((row) => row.join('').replace(/\.+/g, (dots) => String(dots.length))).join('/');

/** Every single slip in one diagram. */
function diagramMutants(t: Transcription): Mutant[] {
  const out: Mutant[] = [];
  t.examples.forEach((ex, e) =>
    ex.diagrams.forEach((d, di) => {
      const grid = expand(d.placement);
      if (grid.length !== 8 || grid.some((row) => row.length !== 8)) return;
      const set = (kind: string, what: string, change: (g: string[][]) => void) => {
        const g = expand(d.placement);
        change(g);
        const placement = compress(g);
        if (placement !== d.placement) out.push({ kind, where: `${ex.id} diagram ${di + 1} (p.${d.bookPage}): ${what}`, apply: (x) => (x.examples[e]!.diagrams[di]!.placement = placement) });
      };
      for (let r = 0; r < 8; r++)
        for (let f = 0; f < 8; f++) {
          const piece = grid[r]![f]!;
          if (piece === '.') continue;
          const sq = `${'abcdefgh'[f]}${8 - r}`;
          for (const [dr, df, name] of [[0, 1, 'one file right'], [0, -1, 'one file left'], [-1, 0, 'one rank up'], [1, 0, 'one rank down']] as const) {
            const r2 = r + dr;
            const f2 = f + df;
            if (r2 < 0 || r2 > 7 || f2 < 0 || f2 > 7 || grid[r2]![f2] !== '.') continue;
            set('diagram: piece on the next square', `${piece} on ${sq} moved ${name}`, (g) => {
              g[r]![f] = '.';
              g[r2]![f2] = piece;
            });
          }
          set('diagram: piece left out', `${piece} on ${sq} removed`, (g) => (g[r]![f] = '.'));
          set('diagram: wrong colour', `${piece} on ${sq} recoloured`, (g) => (g[r]![f] = piece === piece.toUpperCase() ? piece.toLowerCase() : piece.toUpperCase()));
          const other: Record<string, string> = { n: 'b', b: 'n', r: 'q', q: 'r', p: 'b', k: 'q' };
          const swapped = other[piece.toLowerCase()]!;
          set('diagram: wrong piece', `${piece} on ${sq} read as ${piece === piece.toUpperCase() ? swapped.toUpperCase() : swapped}`, (g) => (g[r]![f] = piece === piece.toUpperCase() ? swapped.toUpperCase() : swapped));
        }
      if (d.toMove) out.push({ kind: 'diagram: wrong side to move', where: `${ex.id} diagram ${di + 1} (p.${d.bookPage}): side to move flipped`, apply: (x) => (x.examples[e]!.diagrams[di]!.toMove = d.toMove === 'white' ? 'black' : 'white') });
    }),
  );
  return out;
}

type Outcome = { kind: string; where: string; caught: 'hard' | 'soft' | 'no'; by: string[]; second: boolean };

// the fallback: a second transcription of the same pages, made independently (transcription-b.json)
const secondFile = path.join(here, 'transcription-b.json');
const second = existsSync(secondFile) ? (JSON.parse(readFileSync(secondFile, 'utf8')) as Transcription) : null;
const baseDiff = second ? compareTranscriptions(original, second) : null;
const baseDiffKeys = new Set((baseDiff?.differences ?? []).map(differenceKey));

function run(m: Mutant): Outcome {
  const t = clone(original);
  m.apply(t);
  const r = checkTranscription(t);
  const fresh = r.problems.filter((p) => !baseKeys.has(problemKey(p)));
  // a soft note that was there before and is gone (a "ch" that should have been printed) also shows something changed
  const hard = fresh.filter((p) => p.hard);
  const soft = fresh.filter((p) => !p.hard);
  // does the second transcription disagree with the slip?
  const disagrees = second ? compareTranscriptions(t, second).differences.some((d) => !baseDiffKeys.has(differenceKey(d))) : false;
  return { kind: m.kind, where: m.where, caught: hard.length ? 'hard' : soft.length ? 'soft' : 'no', by: [...new Set((hard.length ? hard : soft).map((p) => `${p.gate}:${p.kind}`))], second: disagrees };
}

// 1. the plan's three planted errors: a wrong square in a move, a piece on the wrong square in a
//    diagram, and a move left out of a line
const moves = moveMutants(original);
const diagrams = diagramMutants(original);
const pick = (list: Mutant[], kind: string, nth: number) => list.filter((m) => m.kind === kind)[nth];
const three = [pick(moves, 'rank digit wrong', 5), pick(diagrams, 'diagram: piece on the next square', 3), pick(moves, 'move dropped', 40)].filter((m): m is Mutant => Boolean(m)).map(run);

// 2. every single slip, one at a time
const all = [...moves, ...diagrams].map(run);
const byKind: Record<string, { planted: number; caughtHard: number; caughtSoftOnly: number; missed: number; caughtBy: Record<string, number> }> = {};
for (const o of all) {
  const k = (byKind[o.kind] ??= { planted: 0, caughtHard: 0, caughtSoftOnly: 0, missed: 0, caughtBy: {} });
  k.planted++;
  if (o.caught === 'hard') k.caughtHard++;
  else if (o.caught === 'soft') k.caughtSoftOnly++;
  else k.missed++;
  for (const b of o.by) k.caughtBy[b] = (k.caughtBy[b] ?? 0) + 1;
}
const total = { planted: all.length, caughtHard: all.filter((o) => o.caught === 'hard').length, caughtSoftOnly: all.filter((o) => o.caught === 'soft').length, missed: all.filter((o) => o.caught === 'no').length };
const pct = (n: number, of: number) => (of ? Math.round((1000 * n) / of) / 10 : 0);

const report = {
  when: new Date().toISOString(),
  source: original.source,
  transcription: {
    examples: base.examples.map(({ pgn: _pgn, ...rest }) => rest),
    totals: {
      examples: base.examples.length,
      moves: base.examples.reduce((s, e) => s + e.moves, 0),
      replayed: base.examples.reduce((s, e) => s + e.replayed, 0),
      diagrams: base.examples.reduce((s, e) => s + e.diagrams, 0),
      diagramsCheckedAgainstMoves: base.examples.reduce((s, e) => s + e.diagramsChecked, 0),
      settledByChOrMate: base.examples.reduce((s, e) => s + e.resolvedByMark, 0),
      settledByWing: base.examples.reduce((s, e) => s + e.resolvedByWing, 0),
      pgnRoundTrips: base.examples.filter((e) => e.roundTrip).length,
    },
    hardProblems: baseHard.map(show),
    softNotes: base.problems.filter((p) => !p.hard).map(show),
    transcriberDoubts: original.examples.flatMap((ex) => (ex.doubts ?? []).map((d) => `p.${d.bookPage} ${ex.id}: ${d.what}`)),
  },
  plantedThree: three,
  // the fallback measured: the same slips, with a second independent transcription to compare against
  withSecondTranscription: second
    ? {
        agreement: { movesCompared: baseDiff!.movesCompared, diagramSquaresCompared: baseDiff!.squaresCompared, differences: baseDiff!.differences },
        plantedThreeCaught: three.filter((o) => o.caught === 'hard' || o.second).length,
        everySingleSlip: {
          planted: all.length,
          caughtByTheChecksAlone: all.filter((o) => o.caught === 'hard').length,
          caughtByTheComparisonAlone: all.filter((o) => o.second).length,
          caughtByEither: all.filter((o) => o.caught === 'hard' || o.second).length,
          missedByBoth: all.filter((o) => o.caught !== 'hard' && !o.second).map((o) => `${o.kind}: ${o.where}`),
        },
      }
    : null,
  everySingleSlip: {
    total: { ...total, caughtHardPct: pct(total.caughtHard, total.planted), caughtAtAllPct: pct(total.caughtHard + total.caughtSoftOnly, total.planted) },
    byKind,
    missed: all.filter((o) => o.caught === 'no').map((o) => `${o.kind}: ${o.where}`),
    softOnly: all.filter((o) => o.caught === 'soft').map((o) => `${o.kind}: ${o.where} (${o.by.join(', ')})`),
  },
};
writeFileSync(path.join(here, 'result.json'), JSON.stringify(report, null, 2));

console.log(`transcription: ${report.transcription.totals.examples} examples, ${report.transcription.totals.moves} moves (${report.transcription.totals.replayed} replayed), ${report.transcription.totals.diagrams} diagrams (${report.transcription.totals.diagramsCheckedAgainstMoves} compared with replayed positions)`);
console.log(`hard problems in the transcription as it came: ${baseHard.length}`);
for (const p of baseHard) console.log(`  ${show(p)}`);
console.log(`soft notes: ${report.transcription.softNotes.length}`);
for (const s of report.transcription.softNotes) console.log(`  ${s}`);
console.log('the three planted errors:');
for (const o of three) console.log(`  ${o.caught === 'no' ? 'MISSED' : `caught (${o.by.join(', ')})`}: ${o.kind}: ${o.where}`);
console.log(`every single slip: ${total.planted} planted, ${total.caughtHard} caught (${pct(total.caughtHard, total.planted)}%), ${total.caughtSoftOnly} flagged only as a note, ${total.missed} missed`);
for (const [k, v] of Object.entries(byKind)) console.log(`  ${k}: ${v.caughtHard}/${v.planted} caught, ${v.caughtSoftOnly} note only, ${v.missed} missed`);
if (report.withSecondTranscription) {
  const w = report.withSecondTranscription;
  console.log(`with a second, independent transcription (${w.agreement.movesCompared} moves and ${w.agreement.diagramSquaresCompared} diagram squares compared, ${w.agreement.differences.length} difference(s) as they came):`);
  console.log(`  the three planted errors caught: ${w.plantedThreeCaught} of ${three.length}`);
  console.log(`  every single slip: ${w.everySingleSlip.caughtByEither} of ${w.everySingleSlip.planted} caught (checks alone ${w.everySingleSlip.caughtByTheChecksAlone}, comparison alone ${w.everySingleSlip.caughtByTheComparisonAlone}), ${w.everySingleSlip.missedByBoth.length} missed by both`);
  for (const m of w.everySingleSlip.missedByBoth.slice(0, 20)) console.log(`    missed: ${m}`);
}
