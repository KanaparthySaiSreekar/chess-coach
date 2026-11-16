// The motif detectors against the Lichess puzzle database's own tags (PLAN WP 4.2: "at least 90%
// agreement on 50 sampled puzzles per theme"). The sample is a fixed file taken once from the
// database (tools/sample-puzzles.ts), so this test needs neither the database nor an engine.
//
// For each theme: 50 puzzles the database tags with it (does the detector find it?) and 50 it
// does not (does the detector stay quiet?). Agreement is the share of those 100 it gets right.
// The database's tags come from Lichess's tagger and from players' votes, so they are not the
// last word either: the bar is 90%, not 100%.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LICHESS_THEME, motifsOf, type Motif } from '../src/index.ts';

type Row = { id: string; fen: string; moves: string[]; rating: number; themes: string[] };
const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(path.join(here, 'fixtures', 'puzzles', 'sample.json'), 'utf8')) as { tagged: Record<string, Row[]>; pool: Row[] };

const THEMES: Motif[] = ['fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'backRankMate', 'hangingPiece', 'capturingDefender', 'trappedPiece', 'mateIn1', 'mateIn2'];
const found = (row: Row, motif: Motif) => motifsOf(row.fen, row.moves).includes(motif);

export function measure(motif: Motif) {
  const theme = LICHESS_THEME[motif];
  const withIt = sample.tagged[theme]!;
  const without = sample.pool.filter((r) => !r.themes.includes(theme)).slice(0, 50);
  const hits = withIt.filter((r) => found(r, motif));
  const falseAlarms = without.filter((r) => found(r, motif));
  return { motif, tagged: withIt.length, found: hits.length, untagged: without.length, falseAlarms: falseAlarms.length, agreement: (hits.length + without.length - falseAlarms.length) / (withIt.length + without.length), missed: withIt.filter((r) => !found(r, motif)).map((r) => r.id), wrong: falseAlarms.map((r) => r.id) };
}

describe('motif detectors against the Lichess puzzle database', () => {
  it('reads every sampled puzzle: all moves legal', () => {
    for (const row of [...sample.pool, ...Object.values(sample.tagged).flat()]) {
      // a line that could not be replayed gives no motifs at all; a mate-tagged one must at least be seen as a mate
      if (row.themes.some((t) => t.startsWith('mateIn'))) expect(motifsOf(row.fen, row.moves).some((m) => m.startsWith('mateIn')), row.id).toBe(true);
    }
  });

  for (const motif of THEMES) {
    it(`${motif}: agrees with the database on at least 90 of 100 puzzles`, () => {
      const r = measure(motif);
      expect(r.tagged).toBe(50);
      expect(r.untagged).toBe(50);
      expect(r.agreement, `found ${r.found} of ${r.tagged} tagged, ${r.falseAlarms} false alarms in ${r.untagged}; missed ${r.missed.join(' ')}; wrong ${r.wrong.join(' ')}`).toBeGreaterThanOrEqual(0.9);
    });
  }
});

describe('motif detectors on small examples', () => {
  it('a knight fork of king and rook', () => {
    // 1...Kb8?? walks into Nd7+ forking king and rook; the solver is White
    expect(motifsOf('k4r2/8/8/4N3/8/8/8/4K3 b - - 0 1', ['a8b8', 'e5d7', 'b8c7', 'd7f8'])).toContain('fork');
  });

  it('a back-rank mate, and not when the king has a square', () => {
    expect(motifsOf('6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1', ['h7h6', 'd1d8'])).toEqual([]);
    expect(motifsOf('6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1', ['a7a6', 'd1d8'])).toEqual([]); // not a legal first move: nothing is claimed
    expect(motifsOf('6k1/5ppp/p7/8/8/8/5PPP/3R2K1 b - - 0 1', ['a6a5', 'd1d8'])).toEqual(expect.arrayContaining(['mateIn1', 'backRankMate']));
  });

  it('a double check and a discovered check', () => {
    // the knight leaves the e-file with check from itself and from the rook behind it
    const motifs = motifsOf('4k3/8/8/8/4N3/8/8/4R1K1 b - - 0 1', ['e8e7', 'e4f6']);
    expect(motifs).not.toContain('doubleCheck'); // Nf6 uncovers the rook only: the knight does not check from f6
    expect(motifs).toContain('discoveredAttack');
    expect(motifsOf('4k3/8/8/8/4N3/8/8/4R1K1 b - - 0 1', ['e8e7', 'e4d6'])).toContain('discoveredAttack');
    expect(motifsOf('4k3/8/8/8/4N3/8/8/4R1K1 b - - 0 1', ['e8d8', 'e4d6'])).not.toContain('doubleCheck');
    // check from the knight and from the rook it uncovers: a double check (which Lichess does not also call a discovered attack)
    expect(motifsOf('3k4/8/8/8/4N3/8/8/4R1K1 b - - 0 1', ['d8e8', 'e4d6'])).toEqual(['doubleCheck']);
  });

  it('works on a line with no set-up move when told who the solver is', () => {
    expect(motifsOf('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', ['d1d8'], 'white')).toEqual(expect.arrayContaining(['mateIn1', 'backRankMate']));
  });
});
