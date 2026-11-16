// The attack code checked against positions whose answer is known from the Lichess puzzle
// database (PLAN WP 4.1: position fixtures for exchanges, hanging pieces and the checks /
// captures / threats lists). 100 positions, none of them made up here:
//   - 50 puzzles tagged "hangingPiece": the piece the solution takes has no defender, so the
//     exchange on its square must come out as the whole piece for the side to move;
//   - 50 puzzles tagged "mateIn1": the mating move must be in the list of mates.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROLE_VALUE, capturables, cctOf, describeMove, makeSquare, mustPosition, uciToMove } from '../src/index.ts';

type Row = { id: string; fen: string; moves: string[]; rating: number; themes: string[] };
const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(path.join(here, 'fixtures', 'puzzles', 'sample.json'), 'utf8')) as { tagged: Record<string, Row[]>; pool: Row[] };

/** The position the solver faces: after the puzzle's first move. */
const solverPosition = (row: Row) => {
  const pos = mustPosition(row.fen);
  pos.play(uciToMove(pos, row.moves[0]!)!);
  return pos;
};

describe('attacks, on positions from the Lichess puzzle database', () => {
  it('a piece with no defender is worth its full value to the side that can take it (50 hanging-piece puzzles)', () => {
    const wrong: string[] = [];
    for (const row of sample.tagged.hangingPiece!) {
      const pos = solverPosition(row);
      const move = uciToMove(pos, row.moves[1]!)!;
      if (!('from' in move)) throw new Error(row.id);
      const taken = pos.board.get(move.to)!;
      const hit = capturables(pos).find((c) => c.piece.square === makeSquare(move.to));
      if (!hit || hit.net !== ROLE_VALUE[taken.role]) wrong.push(`${row.id}: ${taken.role} on ${makeSquare(move.to)} came out as ${hit ? hit.net : 'not capturable'}`);
      // and the capture that wins it is a legal move here
      else expect(hit.attackers.length, row.id).toBeGreaterThan(0);
    }
    expect(wrong).toEqual([]);
  });

  it('finds the mating move (50 mate-in-one puzzles)', () => {
    const wrong: string[] = [];
    for (const row of sample.tagged.mateIn1!) {
      const pos = solverPosition(row);
      const san = describeMove(pos, uciToMove(pos, row.moves[1]!)!).san;
      const cct = cctOf(pos, 60);
      if (!cct.mates.includes(san)) wrong.push(`${row.id}: ${san} is not in the mates (${cct.mates.join(' ') || 'none'})`);
      if (!cct.checks.includes(san) && !cct.mates.includes(san)) wrong.push(`${row.id}: ${san} is not among the checks`);
    }
    expect(wrong).toEqual([]);
  });

  it('never calls a capture a win when the database line shows the piece being taken back for more (the other 300 puzzles)', () => {
    // When the solver's first move is a capture and the other side takes back on that square,
    // the trade on that square cannot have won more than the piece taken.
    let checked = 0;
    for (const row of sample.pool) {
      if (row.moves.length < 3) continue;
      const pos = solverPosition(row);
      const first = uciToMove(pos, row.moves[1]!)!;
      if (!('from' in first)) continue;
      const taken = pos.board.get(first.to);
      if (!taken) continue;
      const hit = capturables(pos).find((c) => c.piece.square === makeSquare(first.to));
      expect(hit, row.id).toBeTruthy();
      expect(hit!.net, row.id).toBeLessThanOrEqual(ROLE_VALUE[taken.role]);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });
});
