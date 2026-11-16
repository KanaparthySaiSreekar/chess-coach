import { describe, expect, it } from 'vitest';
import { asStrongAs, gateV1Threat, isThreat, threatHint, threatWords, type ThreatItem, type ThreatResult } from '../src/index.ts';

// the position before 3...Nf6 in the Scholar's Mate: White threatens Qxf7#
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
const mate: ThreatResult = { san: 'Qxf7#', from: 'h5', to: 'f7', mate: 1, delta: -1, what: 'it would be checkmate' };
const item = (over: Partial<ThreatItem> = {}): ThreatItem => ({
  fen: FEN,
  lastMove: { san: 'Bc4', from: 'f1', to: 'c4' },
  threat: mate,
  accepted: [],
  best: { san: 'g6', why: 'g6 blocks the queen.' },
  played: { san: 'Nf6', why: 'Nf6 allows checkmate with Qxf7#.' },
  ...over,
});
const material = (delta: number): ThreatResult => ({ san: 'Bxf7+', from: 'c4', to: 'f7', delta, what: 'x' });

describe("what's the threat?", () => {
  it('a threat is a near mate or at least a pawn; a second one counts when it is as strong', () => {
    expect(isThreat(mate)).toBe(true);
    expect(isThreat({ ...mate, mate: 4 })).toBe(false);
    expect(isThreat(material(-3))).toBe(true);
    expect(isThreat(material(-0.5))).toBe(false);
    expect(isThreat(material(2))).toBe(false);
    // against a mate only another near mate counts; against material, as much or more
    expect(asStrongAs({ ...mate, mate: 2 }, mate)).toBe(true);
    expect(asStrongAs(material(-9), mate)).toBe(false);
    expect(asStrongAs(material(-3), material(-3))).toBe(true);
    expect(asStrongAs(material(-1), material(-3))).toBe(false);
    expect(asStrongAs(mate, material(-3))).toBe(true);
  });

  it('says what a threat would win, from the owner’s side', () => {
    expect(threatWords(1, null)).toBe('it would be checkmate');
    expect(threatWords(2, null)).toBe('it would lead to checkmate in 2');
    expect(threatWords(undefined, { delta: -3, text: 'you lose a knight' })).toBe('you would lose a knight');
    expect(threatWords(undefined, { delta: -8, text: 'you lose a queen for a knight' })).toBe('you would lose a queen for a knight');
    expect(threatWords(undefined, null)).toBe('nothing changes hands');
    expect(threatHint(item(), 1)).toBe('Look at their last move, Bc4. What does it attack now, or what does it make possible?');
    expect(threatHint(item({ lastMove: undefined }), 1)).toMatch(/^If it were their move/);
  });

  it('gate V1: legal moves where they are played, a real threat, and a reason for every move', () => {
    expect(gateV1Threat(item())).toEqual({ gate: 'V1', result: 'pass' });
    expect(gateV1Threat(item({ accepted: ['Qxf7+'] })).result).toBe('pass');
    expect(gateV1Threat(item({ threat: { ...mate, san: 'Qxf6' } })).detail).toBe('their threat Qxf6 is not legal with the turn passed');
    expect(gateV1Threat(item({ threat: { ...mate, from: 'h4' } })).detail).toBe('the squares of Qxf7# are wrong');
    expect(gateV1Threat(item({ threat: { ...mate, mate: undefined, delta: 0 } })).detail).toBe('Qxf7# wins nothing');
    expect(gateV1Threat(item({ accepted: ['Nf6'] })).detail).toBe('Nf6 is not legal with the turn passed');
    expect(gateV1Threat(item({ best: { san: 'Qxf7', why: 'x' } })).detail).toBe('Qxf7 is not legal in the position');
    expect(gateV1Threat(item({ best: { san: 'Nf6', why: 'x' } })).detail).toBe('the engine chose the move that was played');
    expect(gateV1Threat(item({ played: { san: 'Nf6', why: '' } })).detail).toBe('every move needs its reason');
    // with the owner in check the turn cannot be passed
    expect(gateV1Threat(item({ fen: 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4' })).detail).toMatch(/in check/);
    expect(gateV1Threat(item({ fen: 'nonsense' })).detail).toBe('the position is not valid');
  });
});
