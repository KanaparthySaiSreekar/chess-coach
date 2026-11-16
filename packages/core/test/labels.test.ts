import { describe, expect, it } from 'vitest';
import { START_FEN, gaugeNumber, gaugeOf, gaugeWords, judgedText, labelMove, playLine, sacrificeOf, type EngineEval, type EngineLine } from '../src/index.ts';

const after = (moves: string) => {
  const r = playLine(START_FEN, moves.split(' '));
  if (!r.ok) throw new Error(`illegal: ${r.move}`);
  return r.fens.at(-1)!;
};
const line = (pv: string, cp: number): EngineLine => ({ pv: pv.split(' '), score: { cp } });
const label = (fenBefore: string, san: string, lines: EngineLine[], played: EngineLine, extra: { book?: string | boolean } = {}) =>
  labelMove({ fenBefore, san, evalBefore: { fen: fenBefore, lines } satisfies EngineEval, playedLine: played, ...extra })?.judged;

describe("the eval bar's reading", () => {
  it('is always from White\'s side, whoever is to move', () => {
    const whiteToMove = gaugeOf(START_FEN, { pv: ['e2e4'], score: { cp: 200 } })!;
    const blackToMove = gaugeOf(after('e4'), { pv: ['e7e5'], score: { cp: 200 } })!;
    expect(whiteToMove.white).toBeGreaterThan(60);
    expect(blackToMove.white).toBeLessThan(40);
    expect(Math.round(whiteToMove.white + blackToMove.white)).toBe(100);
    expect(whiteToMove.cp).toBe(200);
    expect(blackToMove.cp).toBe(-200);
  });

  it('reads a forced mate and a finished game', () => {
    expect(gaugeOf(after('e4'), { pv: ['e7e5'], score: { mate: 3 } })).toEqual({ white: 0, mate: -3 });
    expect(gaugeOf(after('f3 e5 g4 Qh4#'))).toEqual({ white: 0, over: 'checkmate' });
    expect(gaugeOf('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual({ white: 50, over: 'stalemate' });
    expect(gaugeOf(START_FEN)).toBeNull(); // no engine line yet: nothing to show
  });

  it('says it in words, and gives a number only for the numbers switch', () => {
    expect(gaugeWords({ white: 50 })).toBe('About equal');
    expect(gaugeWords({ white: 75 })).toBe('White is clearly better');
    expect(gaugeWords({ white: 5 })).toBe('Black is winning');
    expect(gaugeWords({ white: 100, mate: 2 })).toBe('White has a forced checkmate in 2');
    expect(gaugeWords({ white: 0, over: 'checkmate' })).toBe('Black won by checkmate');
    expect(gaugeWords({ white: 50 })).not.toMatch(/\d/);
    expect(gaugeNumber({ white: 62, cp: 131 })).toBe('+1.3');
    expect(gaugeNumber({ white: 40, cp: -40 })).toBe('-0.4');
    expect(gaugeNumber({ white: 50, cp: 0 })).toBe('0.0');
    expect(gaugeNumber({ white: 100, mate: 4 })).toBe('M4');
  });
});

describe('move labels', () => {
  // the Two Knights position where 6.Bb5+ is the move and 6.Ne6 drops the knight
  const two = after('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5');
  const twoLines = [line('c4b5 c7c6 d5c6 b7c6', 60), line('d2d3 h7h6 g5f3', 20), line('c4e2 h7h6', 0)];

  it('best, excellent and good follow the size of the drop', () => {
    expect(label(two, 'Bb5+', twoLines, twoLines[0]!)).toEqual({ label: 'best' });
    expect(label(two, 'd3', twoLines, line('d2d3 h7h6 g5f3', 50))).toEqual({ label: 'excellent', best: 'Bb5+', bestAt: { from: 'c4', to: 'b5' } });
    expect(label(two, 'Be2', twoLines, line('c4e2 h7h6', 20))).toEqual({ label: 'good', best: 'Bb5+', bestAt: { from: 'c4', to: 'b5' } });
  });

  it('inaccuracy, mistake and blunder use Lichess\'s thresholds, and a blunder says what it lost', () => {
    expect(label(two, 'Be2', twoLines, line('c4e2 h7h6', -10))?.label).toBe('inaccuracy');
    expect(label(two, 'Be2', twoLines, line('c4e2 h7h6', -70))?.label).toBe('mistake');
    expect(label(two, 'Ne6', twoLines, line('g5e6 f7e6', -420))).toEqual({ label: 'blunder', why: 'it loses a knight', best: 'Bb5+', bestAt: { from: 'c4', to: 'b5' } });
  });

  it('a book move is book whatever the engine thinks, and a single legal move is forced', () => {
    expect(label(after('e4 e5 Nf3 Nc6'), 'Bc4', [line('f1b5', 30)], line('f1c4', -300), { book: 'Italian Game' })).toEqual({ label: 'book', why: 'Italian Game' });
    // the rook cuts the king off: Kg1 is the only legal move
    expect(label('k7/8/8/8/8/8/r7/7K w - - 0 1', 'Kg1', [line('h1g1', -900)], line('h1g1', -900))).toEqual({ label: 'forced', why: 'the only legal move' });
  });

  it('a miss: nothing is lost, but a win was there', () => {
    // Black has just hung the queen on h4 to the knight; White plays a quiet move instead
    const fen = after('e4 e5 Nf3 Qh4');
    const lines = [line('f3h4', 900), line('b1c3', 60)];
    expect(label(fen, 'Nc3', lines, line('b1c3 h4h5', 60))).toEqual({ label: 'miss', why: 'it misses the chance to win a queen', best: 'Nxh4', bestAt: { from: 'f3', to: 'h4' } });
  });

  it("brilliant: a sacrifice that is the best move (Legal's trap leaves the queen to be taken)", () => {
    const fen = after('e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6');
    expect(sacrificeOf(fen, 'Nxe5')).toBeGreaterThanOrEqual(2);
    const lines = [line('f3e5 d6e5 d1g4', 250), line('h2h3 g4f3 d1f3', 80)];
    expect(label(fen, 'Nxe5', lines, lines[0]!)).toEqual({ label: 'brilliant', why: 'a sacrifice that works' });
    // an even trade is no sacrifice
    expect(sacrificeOf(after('e4 e5 Nf3 Nc6 Bb5 a6'), 'Bxc6')).toBe(0);
  });

  it('a sacrifice is not brilliant when the game was won without it', () => {
    const fen = after('e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6');
    const lines = [line('f3e5 d6e5 d1g4', 950), line('h2h3 g4f3 d1f3', 900)];
    expect(label(fen, 'Nxe5', lines, lines[0]!)?.label).toBe('best');
  });

  it('great: the only good move, unless it is the obvious capture', () => {
    const lines = [line('c4b5 c7c6', 60), line('d2d3 h7h6', -300)];
    expect(label(two, 'Bb5+', lines, lines[0]!)).toEqual({ label: 'great', why: 'the only good move here' });
    // taking back a queen is the only good move too, but nobody needs a badge for that
    const fen = after('e4 e5 Nf3 Qh4');
    expect(label(fen, 'Nxh4', [line('f3h4', 900), line('b1c3', 60)], line('f3h4', 900))?.label).toBe('best');
  });

  it('writes one plain line for the page', () => {
    expect(judgedText('Ne6', { label: 'blunder', why: 'it loses a knight', best: 'Bb5+' })).toBe('Ne6 is a blunder: it loses a knight. Bb5+ was best.');
    expect(judgedText('Bb5+', { label: 'best' })).toBe('Bb5+ is the best move.');
  });
});
