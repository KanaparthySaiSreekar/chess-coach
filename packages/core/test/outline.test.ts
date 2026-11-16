import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { START_FEN, chapterOf, outlineSans, playLine, positionKey, readOutline, type Outline, type RepLine } from '../src/index.ts';

// PLAN WP 8.12: a repertoire's outline, the owner's moves chapter by chapter (D10, D11).

const at = (moves: string) => {
  const r = playLine(START_FEN, moves ? moves.split(' ') : []);
  if (!r.ok) throw new Error(moves);
  return positionKey(r.fens.at(-1)!);
};
const line = (moves: string): RepLine => ({ repertoire: 0, colour: 'white', startFen: START_FEN, moves: moves.split(' ') });

const reti = (() => {
  const r = readOutline(JSON.parse(readFileSync(new URL('../../../content/repertoires/reti-nimzo-larsen.json', import.meta.url), 'utf8')));
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.outline;
})();

describe('an outline (WP 8.12)', () => {
  it('reads PGN-style moves', () => {
    expect(outlineSans('1. Nf3 d5 2. b3 *')).toEqual(['Nf3', 'd5', 'b3']);
    expect(outlineSans('1.Nf3 d5 2.b3 Bg4 3...e6')).toEqual(['Nf3', 'd5', 'b3', 'Bg4', 'e6']);
  });

  it('the committed Réti outline reads with no problems: the owner moves and the replies they want a chapter for', () => {
    expect(reti.colour).toBe('white');
    expect(reti.chapters).toHaveLength(27);
    expect(reti.mine.get(at(''))?.san).toBe('Nf3');
    expect(reti.mine.get(at('Nf3 d5'))?.san).toBe('b3');
    expect(reti.mine.get(at('Nf3 Nf6'))?.san).toBe('b3');
    expect(reti.mine.get(at('Nf3 f5'))?.san).toBe('b3');
    expect(reti.mine.get(at('Nf3 c5'))?.san).toBe('b3');
    expect(reti.mine.get(at('Nf3 g6'))?.san).toBe('e4');
    expect(reti.mine.get(at('Nf3 b6'))?.san).toBe('e4');
    expect(reti.mine.get(at('Nf3 b5'))?.san).toBe('e4');
    expect(reti.mine.get(at('Nf3 Nc6'))?.san).toBe('d4');
    expect(reti.mine.get(at('Nf3 d6'))?.san).toBe('d4');
    expect(reti.mine.get(at('Nf3 d6 d4 Nf6'))?.san).toBe('Nc3');
    expect(reti.mine.get(at('Nf3 g6 e4 c5'))?.san).toBe('d4');
    // where the masters' usual move left the 2.b3 setup, the owner's choice (Q30)
    expect(reti.mine.get(at('Nf3 e6'))?.san).toBe('b3');
    expect(reti.mine.get(at('Nf3 d6 d4 g6'))?.san).toBe('e4');
    // every first move of Black the chapters name is prepared
    expect((reti.forced.get(at('Nf3')) ?? []).map((m) => m.san).sort()).toEqual(['Nc6', 'Nf6', 'b5', 'b6', 'c5', 'd5', 'd6', 'e6', 'f5', 'g6']);
    // the two chapters on the same moves are told apart by ...d5
    const names = reti.chapters.map((c) => c.name);
    expect(names).toContain('1...Nf6 2.b3 g6: Black plays with ...d5');
    expect(names).toContain('1.Nf3 Nf6 2.b3 c5');
  });

  it('a chapter with an illegal move, a conflict between chapters, or a chapter twice is refused with the reason', () => {
    const bad = readOutline({ id: 'x', name: 'X', colour: 'white', chapters: [{ moves: '1. Nf3 d5 2. Bb5' }] });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.problems[0]).toMatch(/chapter 1 \(1\. Nf3 d5 2\. Bb5\): 2\.Bb5 is not a legal move after 1\.Nf3 d5/);
    const conflict = readOutline({ id: 'x', name: 'X', colour: 'white', chapters: [{ moves: '1. Nf3 d5 2. b3' }, { moves: '1. Nf3 d5 2. c4' }] });
    expect(!conflict.ok && conflict.problems[0]).toMatch(/chapter 2 .*plays c4, but chapter 1 plays b3 there/);
    const twice = readOutline({ id: 'x', name: 'X', colour: 'white', chapters: [{ moves: '1. Nf3 d5' }, { moves: '1. Nf3 d5' }] });
    expect(!twice.ok && twice.problems[0]).toMatch(/the same as chapter 1/);
    expect(readOutline({ id: 'Bad Id', name: 'X', colour: 'white', chapters: [] }).ok).toBe(false);
  });

  it("a line's chapter: the deepest chapter it passes through, by position, with ...d5 or without; a line off the outline gets its own", () => {
    const o: Outline = reti;
    expect(chapterOf(line('Nf3 Nf6 b3 g6 Bb2 Bg7 g3 d5'), o).name).toBe('1...Nf6 2.b3 g6: Black plays with ...d5');
    expect(chapterOf(line('Nf3 Nf6 b3 g6 Bb2 Bg7 g3 O-O'), o).name).toBe('1...Nf6 2.b3 g6: Black plays without ...d5');
    // a transposition: 1...Nf6 2.b3 d5 is the chapter 1...d5 2.b3 Nf6
    expect(chapterOf(line('Nf3 Nf6 b3 d5 Bb2'), o).name).toBe('1.Nf3 d5 2.b3 Nf6');
    expect(chapterOf(line('Nf3 d6 d4 g6 e4'), o).name).toBe('1...d6 2.d4 g6 3.e4');
    expect(chapterOf(line('Nf3 d6 d4 Bg4 c4'), o).name).toBe('1...d6: sidelines on moves 2 and 3');
    expect(chapterOf(line('Nf3 d6 d4 Nf6 Nc3 Nbd7 e4'), o).name).toBe('1.Nf3 d6 2.d4 Nf6 3.Nc3 Nbd7');
    // 1...e6 2.b3 Nf6 transposes into the chapter 1...Nf6 2.b3 e6
    expect(chapterOf(line('Nf3 e6 b3 Nf6 Bb2'), o).name).toBe('1.Nf3 Nf6 2.b3 e6');
    expect(chapterOf(line('Nf3 e6 b3 d5 Bb2'), o).name).toBe('1...e6 2.b3');
    const off = chapterOf(line('Nf3 c6 b3 d5 Bb2'), o, () => 'Zukertort Opening');
    expect(off).toEqual({ name: '1.Nf3 c6 (Zukertort Opening)', index: 27, auto: true, ply: 2 });
    // a chapter starts at its position: the moves to it
    expect(chapterOf(line('Nf3 Nf6 b3 d5 Bb2'), o).ply).toBe(4);
  });
});
