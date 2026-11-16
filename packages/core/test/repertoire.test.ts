import { describe, expect, it } from 'vitest';
import { START_FEN, coverageOf, gateV1Line, gateV4Line, gateV5Lines, lineKey, lineText, opponentSpots, repertoireLines, spotCheckSample, type Coverage } from '../src/index.ts';

import { TEST_REPERTOIRE } from './fixtures/repertoire.ts';

// PLAN WP 8.3: the repertoire gates that need no engine (V1, V5, V4's arithmetic).

describe('repertoire lines and the gates in code (WP 8.3)', () => {
  it('reads every line of a PGN as written, an illegal move kept so V1 can name it', () => {
    const r = repertoireLines(TEST_REPERTOIRE, 'white');
    expect(r.skipped).toEqual([]);
    expect(r.lines.map((l) => lineText(l.startFen, l.moves))).toEqual([
      '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4',
      '1.e4 e5 2.Nf3 d6 3.d4',
      '1.e4 c5 2.Nf3 d6 3.d4',
      '1.e4 Nc6 2.Ke3',
      '1.e4 a6 2.Bxa6 bxa6 3.d4',
      '1.e4 d6 2.Nf3 e5 3.Bc4',
    ]);
    expect(r.lines[0]!.notes).toEqual({ 1: 'The classical reply.' });
    expect(r.lines[0]!.chapter).toBe('White');
    // a chapter for the other side is left out with the reason
    const black = repertoireLines(TEST_REPERTOIRE, 'black');
    expect(black.lines).toEqual([]);
    expect(black.skipped[0]!.reason).toMatch(/for White; this repertoire is for Black/);
  });

  it('the same line twice, or a line inside a longer one, is kept once', () => {
    const r = repertoireLines('1. e4 e5 2. Nf3 *\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *\n\n1. e4 e5 *\n\n1. d4 d5 2. c4 *', 'white');
    expect(r.lines.map((l) => l.moves.join(' '))).toEqual(['e4 e5 Nf3 Nc6 Bb5', 'd4 d5 c4']);
    expect(r.duplicates).toBe(2);
  });

  it('V1: names the first move that is not legal, with the moves before it', () => {
    const [ok, , , illegal] = repertoireLines(TEST_REPERTOIRE, 'white').lines;
    expect(gateV1Line(ok!)).toEqual({ gate: 'V1', result: 'pass' });
    expect(gateV1Line(illegal!)).toEqual({ gate: 'V1', result: 'fail', detail: '2.Ke3 is not a legal move after 1.e4 Nc6', at: 2 });
  });

  it('V5: two moves for one position (a transposition) fail the later line, naming the earlier move; a quarantined line sets nothing', () => {
    const lines = repertoireLines(TEST_REPERTOIRE, 'white').lines;
    const counts = lines.map((l) => gateV1Line(l).result === 'pass');
    const v5 = gateV5Lines(lines, counts, 9);
    expect(v5.map((g) => g.result)).toEqual(['pass', 'pass', 'pass', 'n/a', 'pass', 'fail']);
    expect(v5[5]!.detail).toBe('after 1.e4 d6 2.Nf3 e5 this line plays 3.Bc4, but the repertoire already plays d4 in that position (reached by 1.e4 e5 2.Nf3 d6)');
    // had the d4 line been quarantined, the Bc4 line would stand
    const without = gateV5Lines(lines, counts.map((c, i) => c && i !== 1), 9);
    expect(without[5]!.result).toBe('pass');
    // deeper than the level needs, and a line that ends on the opponent's move: passed with a note
    const notes = gateV5Lines(repertoireLines('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *', 'white').lines, [true], 2);
    expect(notes[0]).toEqual({ gate: 'V5', result: 'pass', detail: "deeper than your level needs: drilled to your 2nd move, the rest kept as written; ends on the opponent's move: no answer is prepared for 3...a6" });
  });

  it("V4: how much of what players reply is covered at each of the opponent's turns; a gap flags the line, it does not fail it", () => {
    const lines = repertoireLines(TEST_REPERTOIRE, 'white').lines;
    const counts = [true, true, true, false, false, false]; // the three bad lines are out
    const spots = opponentSpots(lines, counts, 9);
    const afterE4 = [...spots.values()].find((s) => s.at === '1.e4')!;
    expect([...afterE4.covered].sort()).toEqual(['c7c5', 'e7e5']);
    expect(afterE4.lines).toEqual([0, 1, 2]);
    const c = coverageOf(
      afterE4,
      {
        source: 'explorer',
        games: 1000,
        replies: [
          { uci: 'e7e5', san: 'e5', share: 65 },
          { uci: 'd7d5', san: 'd5', share: 10 },
          { uci: 'e7e6', san: 'e6', share: 6 },
          { uci: 'c7c5', san: 'c5', share: 5 },
          { uci: 'c7c6', san: 'c6', share: 4 },
        ],
      },
      { minCovered: 85, flagShare: 5 },
    );
    expect(c).toMatchObject({ at: '1.e4', covered: 77.8, ok: false, missing: [{ san: 'd5', share: 11.1 }, { san: 'e6', share: 6.7 }] });
    const coverage = new Map<string, Coverage | null>([...spots.keys()].map((k) => [k, k === afterE4.key ? c : { ...c, ok: true, missing: [], covered: 100 }]));
    expect(gateV4Line(0, spots, coverage)).toEqual({ gate: 'V4', result: 'flag', detail: 'after 1.e4: 77.8% of the games at your level covered; not covered: d5 (11.1%), e6 (6.7%)' });
    // nothing could be asked: not checked
    expect(gateV4Line(1, spots, new Map())).toMatchObject({ gate: 'V4', result: 'n/a' });
  });

  it('the spot-check sample: one in ten, at least one, the same for the same repertoire', () => {
    expect(spotCheckSample(3, 7)).toHaveLength(1);
    expect(spotCheckSample(25, 7)).toHaveLength(3);
    expect(spotCheckSample(25, 7)).toEqual(spotCheckSample(25, 7));
    expect(spotCheckSample(0, 7)).toEqual([]);
    expect(lineKey({ repertoire: 4, colour: 'white', startFen: START_FEN, moves: ['e4', 'e5', 'Nf3+'] })).toBe('rep:4|rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -|e4 e5 Nf3');
  });
});
