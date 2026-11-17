import { describe, expect, it } from 'vitest';
import { candidateArrow, forcingReplies, gateV1Safety, judgeSafety, safetyReason, type SafetyItem } from '../src/index.ts';

// the position before 3...Nf6 in the Scholar's Mate: Nf6 allows mate, g6 is safe
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
const nf6 = { san: 'Nf6', safe: false, why: 'Nf6 is a serious mistake: it allows checkmate with Qxf7#.' };
const g6 = { san: 'g6', safe: true, why: 'g6 is the strongest move: it blocks the queen.' };
const item = (over: Partial<SafetyItem>): SafetyItem => ({ fen: FEN, question: 'which_loses', candidates: [g6, nf6], played: 'Nf6', ...over });

describe('the safety check', () => {
  it('gate V1: legal moves, one answer, a reason for every move', () => {
    expect(gateV1Safety(item({}))).toEqual({ gate: 'V1', result: 'pass' });
    expect(gateV1Safety(item({ question: 'is_safe', candidates: [nf6] })).result).toBe('pass');
    expect(gateV1Safety(item({ candidates: [g6, { ...nf6, san: 'Nf5' }] })).detail).toBe('Nf5 is not legal in the position');
    expect(gateV1Safety(item({ candidates: [g6, { ...nf6, safe: true }] })).detail).toBe('exactly one of the two moves must be unsafe');
    expect(gateV1Safety(item({ question: 'is_safe' })).detail).toMatch(/exactly one move/);
    expect(gateV1Safety(item({ candidates: [g6, { ...nf6, why: ' ' }] })).detail).toMatch(/reason/);
    expect(gateV1Safety(item({ fen: 'nonsense' })).detail).toMatch(/not valid/);
  });

  it('judges an answer, and draws each move', () => {
    expect(judgeSafety(item({ question: 'is_safe', candidates: [nf6] }), { safe: false })).toBe(true);
    expect(judgeSafety(item({ question: 'is_safe', candidates: [nf6] }), { safe: true })).toBe(false);
    expect(judgeSafety(item({ question: 'is_safe', candidates: [g6] }), { safe: true })).toBe(true);
    expect(judgeSafety(item({}), { pick: 'Nf6' })).toBe(true);
    expect(judgeSafety(item({}), { pick: 'g6' })).toBe(false);
    expect(judgeSafety(item({}), {})).toBe(false);
    expect(candidateArrow(FEN, 'Nf6')).toEqual({ from: 'g8', to: 'f6' });
    expect(candidateArrow(FEN, 'Nf5')).toBeNull();
    // the listing step: every check and capture they have after the move, and none they do not
    const after = forcingReplies(FEN, 'Nf6')!;
    expect(after.lastMove).toEqual(['g8', 'f6']);
    expect(after.fen).toMatch(/ w KQkq - 4 4$/);
    expect(after.replies.map((r) => r.san).sort()).toEqual(['Bxf7+', 'Qxe5+', 'Qxf7#', 'Qxh7']);
    expect(after.replies.find((r) => r.san === 'Qxh7')).toEqual({ san: 'Qxh7', from: 'h5', to: 'h7', check: false, capture: true });
    // g6 blocks the queen's way to f7, and gives her a pawn to take on g6
    expect(forcingReplies(FEN, 'g6')!.replies.map((r) => r.san).sort()).toEqual(['Bxf7+', 'Qxe5+', 'Qxg6', 'Qxh7']);
    // a promotion is one reply, not four
    expect(forcingReplies('8/8/8/8/8/k7/6p1/K6N w - - 0 1', 'Kb1')!.replies.map((r) => r.san).sort()).toEqual(['g1=Q+', 'gxh1=Q+']);
    expect(forcingReplies(FEN, 'Nf5')).toBeNull();
    // their threats, when asked for: a quiet move after which something can be won that could not before
    // (1.e4 e5 2.Nf3 Nc6 3.Bc4, Black thinking of 3...Nf6: then Ng5 hits f7 twice, and the king guards it
    // once; after 3...d6 Ng5 would be no threat at all, the queen takes it)
    const italian = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
    expect(forcingReplies(italian, 'd6', { threats: true })!.replies.find((r) => r.san === 'Ng5')).toBeUndefined();
    const plain = forcingReplies(italian, 'Nf6')!.replies;
    expect(plain.some((r) => r.threat)).toBe(false);
    const withThreats = forcingReplies(italian, 'Nf6', { threats: true })!.replies;
    expect(withThreats.find((r) => r.san === 'Ng5')).toEqual({ san: 'Ng5', from: 'f3', to: 'g5', check: false, capture: false, threat: true, attacks: 'your pawn on {sq:f7}' });
    // the checks and captures are all still there
    expect(withThreats.filter((r) => !r.threat).map((r) => r.san).sort()).toEqual(plain.map((r) => r.san).sort());
    // against 3...h6, Ng5 is no threat: the pawn takes the knight
    expect(forcingReplies(italian, 'h6', { threats: true })!.replies.find((r) => r.san === 'Ng5')).toBeUndefined();
    // the reason keeps what the move runs into and drops what an unsafe move "does manage"
    expect(safetyReason('Nf6 is a serious mistake: it allows checkmate in 1, starting with Qxf7#. What it does manage: it adds a defender to your pawn on h7; it attacks their queen on h5.')).toBe('Nf6 is a serious mistake: it allows checkmate in 1, starting with Qxf7#.');
    expect(safetyReason('g6 is the strongest move here. It is safe: no material changes hands. Why: it protects your pawn on f7.')).toBe('g6 is the strongest move here. It is safe: no material changes hands. Why: it protects your pawn on f7.');
  });
});
