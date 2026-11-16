// The two checks of the PDF route (docs/CONTENT.md §9) on a transcription:
//   V1  every printed move is replayed: it must be exactly one legal move, its number must follow
//       the one before, and a printed "ch" or "mate" must be true on the board;
//   V7  every diagram must equal the position reached by replaying the moves to that point.
// Whatever fails is listed with its page, for the owner to settle on the review screen.

import { START_FEN, addMove, exportPgn, importPgn, newTree, parsePosition, type MoveInfo, type MoveTree, type NodeId } from '@chess-coach/core';
import { resolveDescriptive } from './descriptive.ts';

export type MoveItem = string | { n: string; vague: string };
export type Line = { id: string; parent: string | null; moves: MoveItem[] };
export type Diagram = { bookPage: number; placement: string; toMove: 'white' | 'black' | null; line: string | null; after: string | null };
export type Comment = { line: string; after: string | null; text: string };
export type Example = { id: string; section: string; bookPage: number; start: 'diagram' | 'initial'; diagrams: Diagram[]; lines: Line[]; comments?: Comment[]; doubts?: { bookPage: number; what: string }[] };
export type Transcription = { source: Record<string, unknown>; examples: Example[] };

export type Problem = {
  example: string;
  bookPage: number;
  gate: 'V1' | 'V7' | 'format';
  /** hard = the transcription cannot be right as it stands; soft = worth a look */
  hard: boolean;
  kind: string;
  line?: string;
  move?: string;
  text: string;
};

type Step = { n: number; side: 'w' | 'b'; text: string; fenBefore: string; fenAfter: string; info: MoveInfo; node: NodeId };
type Played = { steps: Step[]; startFen: string; startNode: NodeId; stopped?: string };

export type ExampleResult = { id: string; bookPage: number; startFen: string | null; moves: number; replayed: number; vague: number; resolvedByMark: number; resolvedByWing: number; diagrams: number; diagramsChecked: number; pgn: string | null; roundTrip: boolean | null };
export type CheckResult = { problems: Problem[]; examples: ExampleResult[] };

const placementOf = (fen: string) => fen.split(' ')[0]!;

/** Castling is not printed in a diagram: allow it wherever king and rook stand on their first squares. */
function castlingFor(placement: string): string {
  const rows = placement.split('/');
  const expand = (row: string) => row.replace(/\d/g, (d) => '.'.repeat(Number(d)));
  const r8 = expand(rows[0] ?? '');
  const r1 = expand(rows[7] ?? '');
  let rights = '';
  if (r1[4] === 'K' && r1[7] === 'R') rights += 'K';
  if (r1[4] === 'K' && r1[0] === 'R') rights += 'Q';
  if (r8[4] === 'k' && r8[7] === 'r') rights += 'k';
  if (r8[4] === 'k' && r8[0] === 'r') rights += 'q';
  return rights || '-';
}

function parseNumbered(item: MoveItem): { n: number; side: 'w' | 'b'; text: string; vague: boolean; raw: string } | null {
  const raw = typeof item === 'string' ? item : `${item.n} ${item.vague}`;
  const m = (typeof item === 'string' ? item : item.n).match(/^\s*(\d+)\s*(\.\.\.|\.)\s*(.*)$/);
  if (!m) return null;
  return { n: Number(m[1]), side: m[2] === '.' ? 'w' : 'b', text: typeof item === 'string' ? m[3]!.trim() : item.vague, vague: typeof item !== 'string', raw };
}

const squaresThatDiffer = (a: string, b: string): string[] => {
  const grid = (p: string) => p.split('/').map((row) => row.replace(/\d/g, (d) => '.'.repeat(Number(d))));
  const ga = grid(a);
  const gb = grid(b);
  const out: string[] = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if ((ga[r]?.[f] ?? '?') !== (gb[r]?.[f] ?? '?')) out.push(`${'abcdefgh'[f]}${8 - r}: printed ${gb[r]?.[f] === '.' ? 'empty' : (gb[r]?.[f] ?? '?')}, replayed ${ga[r]?.[f] === '.' ? 'empty' : (ga[r]?.[f] ?? '?')}`);
  return out;
};

export function checkExample(ex: Example): { problems: Problem[]; result: ExampleResult } {
  const problems: Problem[] = [];
  const add = (p: Omit<Problem, 'example' | 'bookPage'> & { bookPage?: number }) => problems.push({ example: ex.id, bookPage: p.bookPage ?? ex.bookPage, ...p });
  const result: ExampleResult = { id: ex.id, bookPage: ex.bookPage, startFen: null, moves: 0, replayed: 0, vague: 0, resolvedByMark: 0, resolvedByWing: 0, diagrams: ex.diagrams.length, diagramsChecked: 0, pgn: null, roundTrip: null };
  for (const l of ex.lines) result.moves += l.moves.length;

  // ---- where the example starts
  const main = ex.lines.find((l) => l.id === 'main') ?? ex.lines[0];
  const first = main?.moves[0] ? parseNumbered(main.moves[0]) : null;
  let startFen: string | null = null;
  if (ex.start === 'initial') startFen = START_FEN;
  else {
    const d = ex.diagrams.find((x) => x.after === null);
    if (!d) add({ gate: 'format', hard: true, kind: 'no-start-diagram', text: 'the example starts from a diagram, but none is marked as the start' });
    else {
      const rows = d.placement.split('/');
      const widths = rows.map((row) => [...row].reduce((s, c) => s + (/\d/.test(c) ? Number(c) : 1), 0));
      if (rows.length !== 8 || widths.some((w) => w !== 8)) add({ gate: 'V7', hard: true, kind: 'diagram-shape', bookPage: d.bookPage, text: `the diagram is not an 8 by 8 board (ranks are ${widths.join(', ')} squares wide)` });
      else {
        const turn = d.toMove ?? (first?.side === 'b' ? 'black' : 'white');
        const fen = `${d.placement} ${turn === 'white' ? 'w' : 'b'} ${castlingFor(d.placement)} - 0 1`;
        if (parsePosition(fen)) startFen = fen;
        else add({ gate: 'V7', hard: true, kind: 'diagram-illegal', bookPage: d.bookPage, text: `the diagram is not a legal position with ${turn} to move (a king missing, or the side that is not to move is in check)` });
        if (d.toMove && first && (first.side === 'w') !== (d.toMove === 'white')) add({ gate: 'V1', hard: true, kind: 'side-to-move', bookPage: d.bookPage, line: main?.id, move: first.raw, text: `the diagram says ${d.toMove} is to move, but the first move is ${first.side === 'w' ? "White's" : "Black's"}` });
      }
    }
  }
  result.startFen = startFen;
  if (!startFen) return { problems, result };

  // ---- V1: replay every line, parents first
  const tree: MoveTree = newTree(startFen);
  const played = new Map<string, Played>();
  const pending = [...ex.lines];
  let guard = 0;
  while (pending.length && guard++ < 1000) {
    const line = pending.shift()!;
    if (line.parent !== null && !played.has(line.parent)) {
      if (!ex.lines.some((l) => l.id === line.parent)) {
        add({ gate: 'format', hard: true, kind: 'no-parent', line: line.id, text: `line "${line.id}" departs from "${line.parent}", which does not exist` });
        continue;
      }
      pending.push(line);
      continue;
    }
    const firstMove = line.moves[0] ? parseNumbered(line.moves[0]) : null;
    if (!firstMove) {
      add({ gate: 'format', hard: true, kind: 'unreadable-number', line: line.id, move: String(line.moves[0] ?? ''), text: 'the first move has no readable move number' });
      continue;
    }
    // where the line starts
    let fen = startFen;
    let node: NodeId = tree.root;
    if (line.parent !== null) {
      const parent = played.get(line.parent)!;
      const at = parent.steps.findIndex((s) => s.n === firstMove.n && s.side === firstMove.side);
      const last = parent.steps.at(-1);
      const followsEnd = last && !parent.stopped && ((last.side === 'w' && firstMove.side === 'b' && firstMove.n === last.n) || (last.side === 'b' && firstMove.side === 'w' && firstMove.n === last.n + 1));
      if (at >= 0) {
        fen = parent.steps[at]!.fenBefore;
        node = at === 0 ? parent.startNode : parent.steps[at - 1]!.node;
      } else if (followsEnd) {
        fen = last.fenAfter;
        node = last.node;
      } else {
        add({ gate: 'V1', hard: true, kind: 'no-branch-point', line: line.id, move: firstMove.raw, text: `"${firstMove.raw}" departs from line "${line.parent}", which has no move ${firstMove.n}${firstMove.side === 'w' ? '.' : '...'} that was replayed` });
        continue;
      }
    }
    const run: Played = { steps: [], startFen: fen, startNode: node };
    played.set(line.id, run);
    let expect: { n: number; side: 'w' | 'b' } = { n: firstMove.n, side: firstMove.side };
    for (const item of line.moves) {
      const mv = parseNumbered(item);
      if (!mv) {
        add({ gate: 'format', hard: true, kind: 'unreadable-number', line: line.id, move: typeof item === 'string' ? item : item.n, text: 'this move has no readable move number' });
        run.stopped = 'unreadable';
        break;
      }
      if (mv.n !== expect.n || mv.side !== expect.side) {
        add({ gate: 'V1', hard: true, kind: 'numbering', line: line.id, move: mv.raw, text: `expected move ${expect.n}${expect.side === 'w' ? '.' : '...'} here: a move is missing or a number is wrong` });
        run.stopped = 'numbering';
        break;
      }
      const pos = parsePosition(fen)!;
      if ((pos.turn === 'white') !== (mv.side === 'w')) {
        add({ gate: 'V1', hard: true, kind: 'side-to-move', line: line.id, move: mv.raw, text: `it is ${pos.turn}'s turn here, but the move is written as ${mv.side === 'w' ? "White's" : "Black's"}` });
        run.stopped = 'side';
        break;
      }
      if (mv.vague) {
        result.vague++;
        add({ gate: 'V1', hard: false, kind: 'no-single-move', line: line.id, move: mv.raw, text: 'the book gives no single move here; the owner chooses one, or the line ends here' });
        run.stopped = 'vague';
        break;
      }
      const r = resolveDescriptive(pos, mv.text);
      if (!r.ok) {
        const text = r.reason === 'illegal' ? 'no legal move fits this' : r.reason === 'ambiguous' ? `more than one legal move fits this (${r.candidates.join(', ')})` : 'this is not readable as a move';
        add({ gate: 'V1', hard: true, kind: r.reason, line: line.id, move: mv.raw, text });
        run.stopped = r.reason;
        break;
      }
      if (r.via === 'mark') result.resolvedByMark++;
      if (r.via === 'wing') result.resolvedByWing++;
      const printed = r.parsed.mark;
      if (printed === 'mate' && !r.info.mate) add({ gate: 'V1', hard: true, kind: 'not-mate', line: line.id, move: mv.raw, text: `printed as mate, but ${r.info.san} is not checkmate on the board` });
      else if (printed === 'check' && !r.info.check) add({ gate: 'V1', hard: true, kind: 'not-check', line: line.id, move: mv.raw, text: `printed as check, but ${r.info.san} does not give check on the board` });
      else if (!printed && r.info.mate) add({ gate: 'V1', hard: false, kind: 'unmarked-mate', line: line.id, move: mv.raw, text: `${r.info.san} is checkmate on the board, but the book does not say so` });
      else if (!printed && r.info.check) add({ gate: 'V1', hard: false, kind: 'unmarked-check', line: line.id, move: mv.raw, text: `${r.info.san} gives check on the board, but the book does not say so` });
      const added = addMove(tree, node, r.info.san);
      if (!added.ok) throw new Error(`a resolved move was refused by the tree: ${r.info.san}`);
      node = added.id;
      run.steps.push({ n: mv.n, side: mv.side, text: mv.raw, fenBefore: fen, fenAfter: r.info.fenAfter, info: r.info, node });
      fen = r.info.fenAfter;
      result.replayed++;
      expect = mv.side === 'w' ? { n: mv.n, side: 'b' } : { n: mv.n + 1, side: 'w' };
    }
  }
  for (const line of pending) add({ gate: 'format', hard: true, kind: 'no-parent', line: line.id, text: `line "${line.id}" could not be placed` });

  // ---- V7: every other diagram against the replayed position
  for (const d of ex.diagrams) {
    if (d.after === null) continue;
    const run = played.get(d.line ?? 'main');
    const wanted = parseNumbered(d.after);
    const step = run?.steps.find((s) => s.text === d.after) ?? run?.steps.find((s) => wanted && s.n === wanted.n && s.side === wanted.side);
    if (!step) {
      add({ gate: 'V7', hard: true, kind: 'diagram-unreached', bookPage: d.bookPage, line: d.line ?? 'main', move: d.after, text: 'the moves could not be replayed as far as this diagram, so it could not be compared' });
      continue;
    }
    result.diagramsChecked++;
    const replayed = placementOf(step.fenAfter);
    if (replayed !== d.placement) {
      const diff = squaresThatDiffer(replayed, d.placement);
      add({ gate: 'V7', hard: true, kind: 'diagram-mismatch', bookPage: d.bookPage, line: d.line ?? 'main', move: d.after, text: `the diagram differs from the position reached by the moves on ${diff.length} square${diff.length === 1 ? '' : 's'}: ${diff.slice(0, 6).join('; ')}` });
    }
    const turnAfter = step.side === 'w' ? 'black' : 'white';
    if (d.toMove && d.toMove !== turnAfter) add({ gate: 'V7', hard: true, kind: 'diagram-turn', bookPage: d.bookPage, line: d.line ?? 'main', move: d.after, text: `the text says ${d.toMove} is to move in this diagram, but after ${d.after} it is ${turnAfter}'s turn` });
  }

  // ---- the author's words, then the PGN and its round trip (V1: export and re-import unchanged)
  for (const c of ex.comments ?? []) {
    const run = played.get(c.line);
    const step = c.after === null ? null : run?.steps.find((s) => s.text === c.after);
    const target = c.after === null ? null : step?.node;
    if (target) {
      const n = tree.nodes[target]!;
      n.comment = n.comment ? `${n.comment} ${c.text}` : c.text;
    }
  }
  const pgn = exportPgn(tree, { Event: `${ex.section}: ${ex.id}`, Site: `book page ${ex.bookPage}`, Result: '*' });
  result.pgn = pgn;
  const back = importPgn(pgn);
  result.roundTrip = back.ok && exportPgn(back.tree) === pgn;
  if (!result.roundTrip) add({ gate: 'V1', hard: true, kind: 'round-trip', text: 'the PGN did not survive export and re-import unchanged' });
  return { problems, result };
}

export function checkTranscription(t: Transcription): CheckResult {
  const problems: Problem[] = [];
  const examples: ExampleResult[] = [];
  for (const ex of t.examples) {
    const r = checkExample(ex);
    problems.push(...r.problems);
    examples.push(r.result);
  }
  return { problems, examples };
}

/** One line per problem, stable, for comparing a changed transcription with the original. */
export const problemKey = (p: Problem) => [p.example, p.gate, p.kind, p.line ?? '', p.move ?? ''].join('|');
