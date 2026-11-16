import { describe, expect, it } from 'vitest';
import { START_FEN, asksWhy, gateV1Opening, isCardMove, lineSteps, openingCardKey, openingCards, positionKey, repertoireLines, type RepLine } from '../src/index.ts';

// PLAN WP 8.8: one card per position of mine in the live lines (a transposition is learned once).
const lines = (pgn: string): RepLine[] => repertoireLines(pgn, 'white').lines.map((l) => ({ ...l, repertoire: 3 }));
const keyAfter = (line: RepLine, plies: number) => positionKey(lineSteps(line).steps[plies]!.fenBefore);

describe('opening drill cards (D3, D4; WP 8.8)', () => {
  it('one card per position of mine, the replies gathered from every line, the words where they belong, down to the depth', () => {
    const ls = lines('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 (3... Nf6 4. Ng5) 4. c3 *\n\n1. e4 e5 2. Nf3 d6 3. d4 *');
    const words = new Map([[keyAfter(ls[0]!, 2), { uci: 'g1f3', why: '{m:Nf3} develops your knight.', idea: 'Their move {m:e5} puts a pawn in the centre.' }]]);
    const cards = openingCards(3, ls, words, 9);
    expect(cards.map((c) => c.move.san)).toEqual(['e4', 'Nf3', 'Bc4', 'c3', 'Ng5', 'd4']);
    const nf3 = cards[1]!;
    expect(nf3.replies.map((r) => r.san)).toEqual(['Nc6', 'd6']); // two lines, one position
    expect(nf3.why).toBe('{m:Nf3} develops your knight.');
    expect(nf3.line).toEqual(['e4', 'e5']);
    expect(cards[2]!.replies.map((r) => r.san)).toEqual(['Bc5', 'Nf6']);
    expect(cards[0]!.fen).toBe(START_FEN);
    expect(openingCardKey(nf3)).toBe(`opening:3|${nf3.key}`);
    // words written for another move are not used
    expect(openingCards(3, ls, new Map([[keyAfter(ls[0]!, 2), { uci: 'b1c3', why: 'x' }]]), 9)[1]!.why).toBeUndefined();
    // the owner's depth: two moves of mine
    expect(openingCards(3, ls, new Map(), 2).map((c) => c.move.san)).toEqual(['e4', 'Nf3']);
  });

  it('two move orders to one position make one card', () => {
    const cards = openingCards(1, lines('1. e4 e5 2. Nf3 d6 3. d4 *\n\n1. e4 d6 2. Nf3 e5 3. d4 *'), new Map(), 9);
    expect(cards.filter((c) => c.move.san === 'd4')).toHaveLength(1);
    expect(cards.map((c) => c.move.san)).toEqual(['e4', 'Nf3', 'd4', 'Nf3']); // 2.Nf3 after 1...e5 and after 1...d6: two positions; 3.d4: one
  });

  it('a mistake to punish is marked on the card that punishes it', () => {
    const [line] = lines('1. e4 e5 2. Nf3 f6 3. Nxe5 *');
    const cards = openingCards(1, [{ ...line!, punish: [3] }], new Map(), 9);
    expect(cards.map((c) => [c.move.san, !!c.punish])).toEqual([
      ['e4', false],
      ['Nf3', false],
      ['Nxe5', true],
    ]);
  });

  it('checks the move by what it is, however it was entered; asks why on a schedule, never without a written why', () => {
    const [card] = openingCards(1, lines('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O *'), new Map(), 9).slice(-1);
    expect(card!.move.san).toBe('O-O');
    expect(isCardMove(card!, 'e1g1')).toBe(true);
    expect(isCardMove(card!, 'e1h1')).toBe(true);
    expect(isCardMove(card!, 'O-O')).toBe(true);
    expect(isCardMove(card!, 'd2d3')).toBe(false);
    expect(gateV1Opening(card!)).toEqual({ gate: 'V1', result: 'pass' });
    expect(gateV1Opening({ ...card!, move: { uci: 'e1c1', san: 'O-O-O' } }).result).toBe('fail');
    const withWhy = { ...card!, why: 'x' };
    expect([0, 1, 2, 3, 4, 5].map((n) => asksWhy(withWhy, n, 3))).toEqual([false, false, true, false, false, true]);
    expect(asksWhy(card!, 2, 3)).toBe(false);
    expect(asksWhy(withWhy, 2, 0)).toBe(false);
  });
});
