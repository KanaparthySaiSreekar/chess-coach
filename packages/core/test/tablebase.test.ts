// Exact endgame results (PLAN WP 4.3: tablebase verdicts). With five pieces or fewer the engine
// reads its endgame tablebases, so the result with best play is known, not estimated.

import { describe, expect, it } from 'vitest';
import { buildFactPacket, gaugeOf, gaugeWords, plainText, tablebaseResult, type EngineLine } from '../src/index.ts';

const line = (pv: string, cp: number): EngineLine => ({ pv: pv.split(' '), score: { cp } });
// king and pawn against king: a draw with Black to move (the king holds the square in front of the pawn)
const DRAW = '4k3/8/8/4P3/4K3/8/8/8 b - - 0 1';
// the king has reached the sixth rank in front of its pawn: a win whoever moves
const WIN = '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1';

describe('the exact result of a small endgame', () => {
  it('is read from the score only when the tablebases were consulted and five pieces or fewer are left', () => {
    expect(tablebaseResult(DRAW, { fen: DRAW, lines: [line('e8e7', 0)], tbhits: 5 })).toBe('draw');
    expect(tablebaseResult(DRAW, { fen: DRAW, lines: [line('e8e7', 0)] })).toBeNull(); // no tablebase: zero is only an estimate
    expect(tablebaseResult(DRAW, { fen: DRAW, lines: [line('e8e7', 0)], tbhits: 0 })).toBeNull();
    expect(tablebaseResult(WIN, { fen: WIN, lines: [{ pv: ['e6d6'], score: { mate: 13 } }], tbhits: 4 })).toBe('win');
    expect(tablebaseResult(WIN, { fen: WIN, lines: [line('e6d6', 20000)], tbhits: 4 })).toBe('win');
    expect(tablebaseResult(WIN, { fen: WIN, lines: [line('e6d6', -20000)], tbhits: 4 })).toBe('loss');
    // an ordinary advantage is not a tablebase verdict
    expect(tablebaseResult(WIN, { fen: WIN, lines: [line('e6d6', 350)], tbhits: 4 })).toBeNull();
    // six pieces: beyond the tablebases installed here
    const six = '4k3/8/8/8/8/8/3PP3/2BQK3 w - - 0 1';
    expect(tablebaseResult(six, { fen: six, lines: [line('d1a4', 20000)], tbhits: 9 })).toBeNull();
  });

  it('shows on the eval bar as a result, not as a lean', () => {
    const draw = gaugeOf(DRAW, line('e8e7', 0), 5)!;
    expect(draw).toMatchObject({ white: 50, exact: 'draw' });
    expect(gaugeWords(draw)).toBe('A draw with best play');
    // White wins, read from Black's side to move: the score is the mover's
    const lost = gaugeOf('8/8/8/4k3/8/8/8/4K2R b - - 0 1', line('e5d5', -20000), 8)!;
    expect(lost.exact).toBe('white');
    expect(gaugeWords(lost)).toBe('White wins with best play');
    // without the tablebases the same score reads as before
    expect(gaugeOf(DRAW, line('e8e7', 0))!.exact).toBeUndefined();
    expect(gaugeWords(gaugeOf(DRAW, line('e8e7', 0))!)).toBe('About equal');
  });

  it('gives the coach a fact it can cite, in the owner\'s voice', () => {
    const forBlack = buildFactPacket({ id: 'T1', fen: DRAW, you: 'black', eval: { fen: DRAW, lines: [line('e8e7', 0)], tbhits: 5 } });
    expect(forBlack.tablebase).toBe('draw');
    const fact = forBlack.facts.find((f) => f.type === 'tablebase')!;
    expect(plainText(fact.text)).toMatch(/With best play from both sides, this position is a draw\. That is exact/);
    const forWhite = buildFactPacket({ id: 'T2', fen: WIN, you: 'white', eval: { fen: WIN, lines: [{ pv: ['e6d6'], score: { mate: 13 } }], tbhits: 4 } });
    expect(forWhite.tablebase).toBe('you win');
    const forTheLoser = buildFactPacket({ id: 'T3', fen: WIN, you: 'black', eval: { fen: WIN, lines: [{ pv: ['e6d6'], score: { mate: 13 } }], tbhits: 4 } });
    expect(forTheLoser.tablebase).toBe('you lose');
    expect(plainText(forTheLoser.facts.find((f) => f.type === 'tablebase')!.text)).toMatch(/you lose this position/);
    // no tablebase, no such fact
    expect(buildFactPacket({ id: 'T4', fen: DRAW, you: 'black', eval: { fen: DRAW, lines: [line('e8e7', 0)] } }).facts.some((f) => f.type === 'tablebase')).toBe(false);
  });
});
