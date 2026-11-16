import { describe, expect, it } from 'vitest';
import { gameDeviation, lineResults, matchGame, repertoireGraph, repertoireLines, seedMoves, seedProblems, START_FEN, playLine, positionKey, type GameForRep, type RepLine } from '../src/index.ts';

// PLAN WP 8.10: fixture games against a repertoire: where each left it, who left it, results per line.
const white = repertoireLines('1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bc4 Bc5 4. c3 *', 'white').lines.map((l): RepLine => ({ ...l, repertoire: 1 }));
const black = repertoireLines('[Orientation "black"]\n\n1. e4 (1. d4 d5) 1... e5 2. Nf3 Nc6 *', 'black').lines.map((l): RepLine => ({ ...l, repertoire: 2 }));
const W = repertoireGraph('white', white);
const B = repertoireGraph('black', black);
const sans = (s: string) => s.split(' ');

describe("the owner's games against the repertoire (B6, D5, D7, G3; WP 8.10)", () => {
  it('the owner leaves it: the move played, and the move the repertoire plays there', () => {
    const d = gameDeviation(W, sans('e4 e5 Nf3 Nc6 Bb5 a6'));
    expect(d).toMatchObject({ by: 'you', ply: 4, moveText: '3.Bb5', played: { san: 'Bb5' }, expected: { san: 'Bc4' }, inBook: 4 });
  });

  it('the opponent leaves it: their move, and the replies the repertoire prepares there', () => {
    const d = gameDeviation(W, sans('e4 e5 Nf3 Nf6 Nxe5'));
    expect(d).toMatchObject({ by: 'them', ply: 3, moveText: '2...Nf6', played: { san: 'Nf6' }, prepared: ['Nc6', 'd6'], inBook: 3 });
    // as Black: the very first move of White's is not prepared
    expect(gameDeviation(B, sans('c4 e5 Nc3'))).toMatchObject({ by: 'them', ply: 0, moveText: '1.c4', prepared: ['e4', 'd4'] });
  });

  it('the preparation runs out; a game that never entered it; a game that stayed in it to the end', () => {
    expect(gameDeviation(W, sans('e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4'))).toMatchObject({ by: 'end', ply: 7, moveText: '4...Nf6', inBook: 7 });
    // 1.d4 against a 1.e4 repertoire: the owner left it at once; a side with no repertoire: never entered
    expect(gameDeviation(W, sans('d4 d5 c4'))).toMatchObject({ by: 'you', ply: 0, moveText: '1.d4', expected: { san: 'e4' } });
    expect(gameDeviation(repertoireGraph('black', []), sans('e4 e5'))).toMatchObject({ by: 'outside', ply: 0, inBook: 0 });
    expect(gameDeviation(W, sans('e4 e5 Nf3 d6 d4'))).toMatchObject({ by: 'stayed', inBook: 5 });
    // as Black, after 1.d4 d5 the repertoire has nothing more: the preparation ran out at White's 2nd move
    expect(gameDeviation(B, sans('d4 d5 c4 e6'))).toMatchObject({ by: 'end', moveText: '2.c4', inBook: 2 });
  });

  it('results per line, from the owner side, with how the games left each line', () => {
    const games: GameForRep[] = [
      { id: 1, you: 'white', result: '1-0', sans: sans('e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4') },
      { id: 2, you: 'white', result: '0-1', sans: sans('e4 e5 Nf3 Nc6 Bb5 a6') },
      { id: 3, you: 'white', result: '1/2-1/2', sans: sans('e4 e5 Nf3 d6 d4 exd4') },
      { id: 4, you: 'black', result: '0-1', sans: sans('e4 e5 Nf3 Nc6 Bb5') },
      { id: 5, you: 'black', result: '1-0', sans: sans('c4 e5') },
      { id: 6, you: 'white', result: '*', sans: sans('e4 e5') },
    ];
    const r = lineResults([W, B], games);
    expect(r.lines).toEqual([
      { line: '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3', colour: 'white', games: 2, won: 1, drawn: 0, lost: 1, leftByYou: 1, leftByThem: 0, prepRanOut: 1 },
      { line: '1.e4 e5 2.Nf3 d6 3.d4', colour: 'white', games: 1, won: 0, drawn: 1, lost: 0, leftByYou: 0, leftByThem: 0, prepRanOut: 1 },
      // 1.c4 (game 5) followed no line, so it counts toward none; its departure is still recorded below
      { line: '1.e4 e5 2.Nf3 Nc6', colour: 'black', games: 1, won: 1, drawn: 0, lost: 0, leftByYou: 0, leftByThem: 0, prepRanOut: 1 },
    ]);
    expect(r.deviations.get(5)).toMatchObject({ by: 'them', moveText: '1.c4' });
    expect(r.deviations.has(6)).toBe(false); // an unfinished game is not counted
  });
});

describe('a collection: several repertoires for one side (WP 8.15)', () => {
  const reti = repertoireLines('1. Nf3 d5 2. b3 Nf6 3. Bb2 *', 'white').lines.map((l): RepLine => ({ ...l, repertoire: 3 }));
  const R = repertoireGraph('white', reti, { repertoire: 3, name: 'Réti' });
  const I = repertoireGraph('white', white, { repertoire: 1, name: 'Italian' });

  it('each game is matched with the repertoire it stayed in longest; one never stands in for the other', () => {
    expect(matchGame([I, R], 'white', sans('Nf3 d5 b3 Nf6 Bb2 e6'))).toMatchObject({ graph: { name: 'Réti' }, deviation: { by: 'end', inBook: 5 } });
    expect(matchGame([R, I], 'white', sans('e4 e5 Nf3 Nc6 Bb5'))).toMatchObject({ graph: { name: 'Italian' }, deviation: { by: 'you', expected: { san: 'Bc4' } } });
    // a first move neither plays: the first is kept (the owner left it at once)
    expect(matchGame([I, R], 'white', sans('d4 d5'))).toMatchObject({ graph: { name: 'Italian' }, deviation: { by: 'you', inBook: 0, expected: { san: 'e4' } } });
    // results per line count each game once, with its own repertoire's line
    const r = lineResults([I, R], [{ id: 1, you: 'white', result: '1-0', sans: sans('Nf3 d5 b3 Nf6 Bb2 e6') }, { id: 2, you: 'white', result: '0-1', sans: sans('e4 e5 Nf3 Nc6 Bc4 Bc5 c3') }]);
    expect(r.lines.map((l) => [l.line, l.won, l.lost])).toEqual([['1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3', 0, 1], ['1.Nf3 d5 2.b3 Nf6 3.Bb2', 1, 0]]);
  });
});

describe('seed lines are checked, not silently dropped (WP 8.12)', () => {
  const at = (moves: string) => positionKey((playLine(START_FEN, moves ? moves.split(' ') : []) as { fens: string[] }).fens.at(-1)!);
  it("the default seeds read fully: Black's 1...d5 against 1.d4 is a variation of White's first move", () => {
    expect(seedProblems('1. e4 (1. d4 d5) 1... e5 2. Nf3 Nc6', 'black')).toEqual([]);
    const seeds = seedMoves('1. e4 (1. d4 d5) 1... e5 2. Nf3 Nc6', 'black');
    expect([seeds.get(at('e4'))?.san, seeds.get(at('e4 e5 Nf3'))?.san, seeds.get(at('d4'))?.san]).toEqual(['e5', 'Nc6', 'd5']);
    expect(seedProblems('1. e4 e5 2. Nf3 Nc6 3. Bc4', 'white')).toEqual([]);
  });
  it('a variation in the wrong place is named', () => {
    expect(seedProblems('1. e4 e5 2. Nf3 Nc6 (1. d4 d5)', 'black')[0]).toMatch(/^2\.\.\.d4 is not a legal move after 1\.e4 e5 2\.Nf3: a variation in brackets replaces the move just before it/);
  });
});
