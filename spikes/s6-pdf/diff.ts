// Two transcriptions of the same pages compared item by item (spike S6's fallback). Wherever they
// differ, at least one of them is wrong.

import type { Example, Line, MoveItem, Transcription } from './check.ts';

const text = (m: MoveItem) => (typeof m === 'string' ? m.replace(/\s+/g, ' ').trim() : `${m.n} [no single move] ${m.vague}`.replace(/\s+/g, ' ').trim());
/** A vague move's wording is free text: two readers phrase it differently, so only its place is compared. */
const comparable = (m: MoveItem) => (typeof m === 'string' ? text(m) : `${m.n} [no single move]`);

/** A line's identity that does not depend on the letter a session gave it: where it departs, and with which move. */
function keyOf(ex: Example, line: Line): string {
  const first = line.moves[0] ? comparable(line.moves[0]) : '';
  if (line.parent === null) return 'main';
  const parent = ex.lines.find((l) => l.id === line.parent);
  return `${parent ? keyOf(ex, parent) : '?'} > ${first}`;
}

const grid = (p: string) => p.split('/').map((row) => row.replace(/\d/g, (d) => '.'.repeat(Number(d))));

export type Difference = { example: string; bookPage: number; what: 'diagram' | 'side to move' | 'move' | 'line only in one' | 'line length' | 'diagram place'; where: string; a: string; b: string };
export type Comparison = { differences: Difference[]; movesCompared: number; squaresCompared: number; diagramsCompared: number; linesCompared: number };

export function compareTranscriptions(a: Transcription, b: Transcription): Comparison {
  const differences: Difference[] = [];
  let movesCompared = 0;
  let squaresCompared = 0;
  let diagramsCompared = 0;
  let linesCompared = 0;
  
  for (const exA of a.examples) {
    const exB = b.examples.find((e) => e.id === exA.id);
    if (!exB) {
      differences.push({ example: exA.id, bookPage: exA.bookPage, what: 'line only in one', where: 'the whole example', a: 'present', b: 'missing' });
      continue;
    }
    if (exA.start !== exB.start) differences.push({ example: exA.id, bookPage: exA.bookPage, what: 'diagram place', where: 'where the example starts', a: exA.start, b: exB.start });
    // diagrams, in order
    const n = Math.max(exA.diagrams.length, exB.diagrams.length);
    for (let i = 0; i < n; i++) {
      const da = exA.diagrams[i];
      const db = exB.diagrams[i];
      if (!da || !db) {
        differences.push({ example: exA.id, bookPage: (da ?? db)!.bookPage, what: 'diagram', where: `diagram ${i + 1}`, a: da ? 'present' : 'missing', b: db ? 'present' : 'missing' });
        continue;
      }
      diagramsCompared++;
      const ga = grid(da.placement);
      const gb = grid(db.placement);
      for (let r = 0; r < 8; r++)
        for (let f = 0; f < 8; f++) {
          squaresCompared++;
          const x = ga[r]?.[f] ?? '?';
          const y = gb[r]?.[f] ?? '?';
          if (x !== y) differences.push({ example: exA.id, bookPage: da.bookPage, what: 'diagram', where: `diagram ${i + 1}, square ${'abcdefgh'[f]}${8 - r}`, a: x === '.' ? 'empty' : x, b: y === '.' ? 'empty' : y });
        }
      if (da.toMove !== db.toMove) differences.push({ example: exA.id, bookPage: da.bookPage, what: 'side to move', where: `diagram ${i + 1}`, a: String(da.toMove), b: String(db.toMove) });
      if ((da.after ?? '') !== (db.after ?? '')) differences.push({ example: exA.id, bookPage: da.bookPage, what: 'diagram place', where: `diagram ${i + 1}: the move it follows`, a: String(da.after), b: String(db.after) });
    }
    // lines, matched by where they depart
    const linesA = new Map(exA.lines.map((l) => [keyOf(exA, l), l]));
    const linesB = new Map(exB.lines.map((l) => [keyOf(exB, l), l]));
    for (const [key, la] of linesA) {
      const lb = linesB.get(key);
      if (!lb) {
        differences.push({ example: exA.id, bookPage: exA.bookPage, what: 'line only in one', where: key, a: la.moves.map(text).join(' '), b: '(no such line)' });
        continue;
      }
      linesCompared++;
      const len = Math.max(la.moves.length, lb.moves.length);
      for (let i = 0; i < len; i++) {
        const ma = la.moves[i];
        const mb = lb.moves[i];
        if (ma === undefined || mb === undefined) {
          differences.push({ example: exA.id, bookPage: exA.bookPage, what: 'line length', where: `${key}, move ${i + 1}`, a: ma === undefined ? '(line ends)' : text(ma), b: mb === undefined ? '(line ends)' : text(mb) });
          break;
        }
        movesCompared++;
        if (comparable(ma) !== comparable(mb)) differences.push({ example: exA.id, bookPage: exA.bookPage, what: 'move', where: `${key}, move ${i + 1}`, a: text(ma), b: text(mb) });
      }
    }
    for (const [key, lb] of linesB) if (!linesA.has(key)) differences.push({ example: exA.id, bookPage: exA.bookPage, what: 'line only in one', where: key, a: '(no such line)', b: lb.moves.map(text).join(' ') });
  }
  for (const exB of b.examples) if (!a.examples.some((e) => e.id === exB.id)) differences.push({ example: exB.id, bookPage: exB.bookPage, what: 'line only in one', where: 'the whole example', a: 'missing', b: 'present' });
  return { differences, movesCompared, squaresCompared, diagramsCompared, linesCompared };
}

/** One line per difference, for telling a changed comparison from the original. */
export const differenceKey = (d: Difference) => [d.example, d.what, d.where, d.a, d.b].join('|');
