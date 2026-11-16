// A move is judged by what it gives away as well as by the drop in winning chances
// (ARCHITECTURE §8.2, decision D47). Found by the owner: in a game Black was already losing,
// 10...Qe6 put the queen where a bishop takes it, and the board called it "good" because the
// winning chances only went from 7 to 2.5. The label, the coach's facts and common sense now agree.

import { describe, expect, it } from 'vitest';
import { START_FEN, gradeMove, labelMove, moveFacts, playLine, plainText, type EngineEval, type EngineLine } from '../src/index.ts';

const after = (moves: string) => {
  const r = playLine(START_FEN, moves.split(' '));
  if (!r.ok) throw new Error(`illegal: ${r.move}`);
  return r.fens.at(-1)!;
};
const line = (pv: string, cp: number): EngineLine => ({ pv: pv.split(' '), score: { cp } });
const mate = (pv: string, n: number): EngineLine => ({ pv: pv.split(' '), score: { mate: n } });
const label = (fenBefore: string, san: string, lines: EngineLine[], played: EngineLine) => labelMove({ fenBefore, san, evalBefore: { fen: fenBefore, lines } satisfies EngineEval, playedLine: played });

// the owner's game, up to the move before the queen is hung (Black to move, already a knight down)
const GAME = 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 Re1 Nd6 Bf1 f6 d4 Nc4 Bd3 d6 Bxc4 Qe7 a4';
const before = after(GAME);
// the engine's numbers for this position at a million nodes (tools/label-line.ts)
const best = line('c8g4 h2h3', -701);
const qe6 = line('e7e6 c4e6 c8e6', -1093);

describe("the owner's game: 10...Qe6 hangs the queen in a lost position", () => {
  it('is a mistake that says what it loses, not a good move', () => {
    const r = label(before, 'Qe6', [best], qe6)!;
    expect(r.judged).toEqual({ label: 'mistake', why: 'it loses a queen for a bishop', best: 'Bg4', bestAt: { from: 'c8', to: 'g4' } });
    // the winning chances alone would have let it through
    expect(r.grade!.byChances).toBe('ok');
    expect(r.grade!.drop).toBeLessThan(5);
    expect(r.grade).toMatchObject({ cls: 'mistake', floor: 'material', decided: 'lost', givenAway: 6 });
  });

  it('the coach is given the same verdict, in words that cannot be read as praise', () => {
    let n = 0;
    // the owner sits on White's side here, so Black's move is "theirs"
    const res = moveFacts({ fenBefore: before, san: 'Qe6', evalBefore: { fen: before, lines: [best] }, playedLine: qe6, you: 'black' }, () => `T.F${++n}`, { owner: 'white' })!;
    const text = plainText(res.facts[0]!.text);
    // in the owner's voice: their loss is the owner's gain
    expect(text).toMatch(/Qe6 is a mistake by them: you win a queen for a bishop after Bxe6/);
    expect(text).toMatch(/They were already losing before it/);
    expect(text).not.toMatch(/good|safe/);
    // its small merit is not offered as the reason for it
    expect(text).not.toMatch(/Why:/);
    expect(res.facts[0]!.type).toBe('loses_material');
    expect(res.facts[0]!.data.class).toBe('mistake');
    expect(res.facts[0]!.data.verdictForYou).toBe('good'); // their mistake is good news for the owner
    // and the better move is named for the coach
    expect(plainText(res.facts.at(-1)!.text)).toMatch(/Their strongest move is Bg4/);
  });

  it('the same queen hung in a game still in the balance is a blunder', () => {
    const r = label(before, 'Qe6', [line('c8g4 h2h3', -40)], line('e7e6 c4e6 c8e6', -640))!;
    expect(r.judged.label).toBe('blunder');
    expect(r.grade!.byChances).toBe('blunder');
  });
});

describe('what a move gives away, one step milder once the game is decided', () => {
  // White is a queen up and to move (Black's queen is gone): every line here is winning
  const won = 'rnb1kbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 4';
  const calm = line('b1c3 b8c6', 1500);

  it('a piece or more: blunder in a live game, mistake in a decided one', () => {
    // the bishop goes to a6, where the b-pawn takes it: a bishop for nothing, and White is still winning
    const hung = line('f1a6 b7a6', 1100);
    const r = label(won, 'Ba6', [calm], hung)!;
    expect(r.grade).toMatchObject({ byChances: 'ok', givenAway: 3, decided: 'won', cls: 'mistake', floor: 'material' });
    expect(r.judged).toMatchObject({ label: 'mistake', why: 'it loses a bishop', best: 'Nc3' });
  });

  it('a pawn in a decided game is let through, but is never called excellent', () => {
    // 4.d4 exd4 5.Nxd4 would be even; here the pawn is just left: d4 exd4 and no recapture in the line
    const r = label(won, 'd4', [calm], line('d2d4 e5d4 b1d2', 1350))!;
    expect(r.grade).toMatchObject({ givenAway: 1, cls: 'ok' });
    expect(r.judged).toMatchObject({ label: 'good', why: 'it loses a pawn' });
  });

  it('a pawn while the game is still being decided is an inaccuracy', () => {
    const live = after('e4 e5 Nf3 Nc6');
    // clearly better but not yet won: the winning chances only go from 90 to 86
    const r = label(live, 'd4', [line('f1b5 a7a6', 600)], line('d2d4 e5d4 f1c4', 500))!;
    expect(r.grade).toMatchObject({ byChances: 'ok', givenAway: 1, cls: 'inaccuracy', floor: 'material' });
    expect(r.judged).toMatchObject({ label: 'inaccuracy', why: 'it loses a pawn' });
  });

  it('a sound sacrifice is left alone: the material goes but the engine rates it as well as the best move', () => {
    const live = after('e4 e5 Nf3 Nc6');
    // the same pawn given up, with the engine seeing full compensation
    const r = label(live, 'd4', [line('f1b5 a7a6', 30)], line('d2d4 e5d4 f1c4', 20))!;
    expect(r.grade).toMatchObject({ givenAway: 0, cls: 'ok', floor: undefined });
    expect(r.judged.label).toBe('excellent');
    expect(r.judged.why).toBeUndefined();
  });

  it('in a lost game half a pawn of score is enough: there the score moves less for each piece (found by the audit)', () => {
    // a real case: Black, already at 9%, plays ...d5 and loses the knight on h7 to a queen trade there;
    // the engine's score only goes from -6.4 to -7.4, and ...Nf6 would have kept the knight
    const fen = 'rn1k1r2/p3q2n/1pppP1Q1/4pB1p/2P1N3/3P4/PP3PPP/R4RK1 b - - 5 19';
    const r = label(fen, 'd5', [line('h7f6 a2a3', -640)], line('d6d5 c4d5 c6d5 g6h7 e7h7 f5h7', -736))!;
    expect(r.grade).toMatchObject({ byChances: 'ok', decided: 'lost', givenAway: 3, cls: 'mistake', floor: 'material' });
    expect(r.judged).toMatchObject({ label: 'mistake', why: 'it loses a knight', best: 'Nf6' });
    // the same line in a game that is won either way needs the full pawn: 96 points of score are not enough
    const wonEitherWay = label(fen, 'd5', [line('h7f6 a2a3', 1500)], line('d6d5 c4d5 c6d5 g6h7 e7h7 f5h7', 1404))!;
    expect(wonEitherWay.grade).toMatchObject({ decided: 'won', givenAway: 0, cls: 'ok' });
  });

  it('nothing is held against a move when the best move loses just as much', () => {
    // a piece is lost whatever White does: the knight on g5 is trapped and both lines drop it
    const fen = after('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5');
    const forced = [line('g5e6 f7e6 d5e6', -300), line('g5h3 c8h3 g2h3', -330)];
    const r = label(fen, 'Nh3', forced, forced[1]!)!;
    expect(r.grade).toMatchObject({ givenAway: 0, cls: 'ok' });
  });
});

describe('walking into a mate that could be avoided', () => {
  // Black to move, already lost; ...Kh8 keeps the game going, ...g5 lets White mate
  const lost = '6k1/5ppp/8/8/8/8/5PPP/3RR1K1 b - - 0 1';

  it('is a blunder when the mate is immediate, even in a lost game', () => {
    const g = gradeMove({ fenBefore: lost, san: 'g5', evalBefore: { fen: lost, lines: [line('g8f8 d1d7', -900)] }, playedLine: mate('g7g5 e1e8', -1), you: 'black' })!;
    expect(g).toMatchObject({ byChances: 'ok', cls: 'blunder', floor: 'mate', decided: 'lost', mateAllowed: 1 });
  });

  it('is a mistake when the game was lost and the mate is some moves off', () => {
    const g = gradeMove({ fenBefore: lost, san: 'g5', evalBefore: { fen: lost, lines: [line('g8f8 d1d7', -900)] }, playedLine: mate('g7g5 e1e8 g8g7 d1d7', -5), you: 'black' })!;
    expect(g).toMatchObject({ cls: 'mistake', floor: 'mate' });
  });

  it('is not held against a move when every move is mated', () => {
    const g = gradeMove({ fenBefore: lost, san: 'g5', evalBefore: { fen: lost, lines: [mate('g8f8 d1d8', -6)] }, playedLine: mate('g7g5 e1e8', -3), you: 'black' })!;
    expect(g).toMatchObject({ cls: 'ok', floor: undefined });
  });
});

describe('a chance passed over in a game that is won either way', () => {
  // Black has left the queen on h4 to the knight; White is winning with or without it
  const fen = after('e4 e5 Nf3 Qh4');

  it('is a miss when a piece was there for the taking', () => {
    const r = label(fen, 'Nc3', [line('f3h4', 1500), line('b1c3 h4h5', 1150)], line('b1c3 h4h5', 1150))!;
    expect(r.grade!.byChances).toBe('ok');
    expect(r.judged).toEqual({ label: 'miss', why: 'it misses the chance to win a queen', best: 'Nxh4', bestAt: { from: 'f3', to: 'h4' } });
  });

  it('is not a miss when the engine sees no difference: the piece can be taken next move as well', () => {
    const r = label(fen, 'Nc3', [line('f3h4', 1500), line('b1c3 h4h5', 1480)], line('b1c3 h4h5', 1480))!;
    expect(r.judged.label).not.toBe('miss');
  });

  it('is a miss for a mate a beginner can find, and no miss for a long one', () => {
    const short = label(fen, 'Nc3', [mate('f3h4 a7a6 d1h5', 2)], line('b1c3 h4h5', 1150))!;
    expect(short.judged).toMatchObject({ label: 'miss', why: 'it misses a forced checkmate in 2' });
    const long = label(fen, 'Nc3', [mate('f3h4 a7a6 d1h5', 7)], line('b1c3 h4h5', 1150))!;
    expect(long.judged.label).not.toBe('miss');
  });
});
