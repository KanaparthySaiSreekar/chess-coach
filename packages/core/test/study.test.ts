import { describe, expect, it } from 'vitest';
import { START_FEN, addTree, chaptersFromPgn, graphMoves, graphSize, importPgn, lichessStudyId, movesTo, playLine, studyToPgn, treeFromGraph, type MoveTree, type PosGraph } from '../src/index.ts';

// a study as Lichess exports it: a game per chapter, comments with drawings, a side line, marks
const LICHESS_STUDY = `[Event "Italian basics: Main line"]
[Site "https://lichess.org/study/AbCdEfGh/IjKlMnOp"]
[Result "*"]
[Variant "Standard"]
[ECO "C50"]
[Opening "Italian Game"]
[StudyName "Italian basics"]
[ChapterName "Main line"]
[UTCDate "2026.11.01"]
[UTCTime "10:00:00"]
[Orientation "white"]
[ChapterMode "normal"]

{ The Italian: develop and castle. [%csl Ge4] } 1. e4 { [%cal Ge2e4] } 1... e5 2. Nf3 Nc6 3. Bc4 { Aims at f7. [%cal Gc4f7,Rd8h4] } (3. Bb5 { The Spanish. }) 3... Bc5 $1 *


[Event "Italian basics: Black's way"]
[Site "https://lichess.org/study/AbCdEfGh/QrStUvWx"]
[Result "*"]
[Variant "Standard"]
[StudyName "Italian basics"]
[ChapterName "Black's way"]
[Orientation "black"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 $5 { The Two Knights. } *
`;

/** Everything a chapter holds, node by node: the moves to it, its comment, its marks, its drawings. */
function contents(tree: MoveTree) {
  return Object.values(tree.nodes)
    .map((n) => ({ moves: movesTo(tree, n.id).join(' '), comment: n.comment ?? '', nags: n.nags ?? [], drawings: (n.drawings ?? []).map((d) => JSON.stringify(d)).sort() }))
    .sort((a, b) => a.moves.localeCompare(b.moves));
}

describe('studies (I6, J1)', () => {
  it('a Lichess study round-trips: its chapters, moves, side lines, comments, marks and drawings', () => {
    const first = chaptersFromPgn(LICHESS_STUDY);
    expect(first.name).toBe('Italian basics');
    expect(first.chapters.map((c) => [c.name, c.orientation])).toEqual([
      ['Main line', 'white'],
      ["Black's way", 'black'],
    ]);
    expect(first.skipped).toEqual([]);
    const out = studyToPgn(first.name, first.chapters);
    expect(out).toMatch(/\[Event "Italian basics: Main line"\]/);
    expect(out).toMatch(/\[Orientation "black"\]/);
    const again = chaptersFromPgn(out);
    expect(again.name).toBe('Italian basics');
    expect(again.chapters.map((c) => [c.name, c.orientation])).toEqual(first.chapters.map((c) => [c.name, c.orientation]));
    for (const [i, c] of first.chapters.entries()) {
      const a = importPgn(c.pgn);
      const b = importPgn(again.chapters[i]!.pgn);
      if (!a.ok || !b.ok) throw new Error('a chapter did not read');
      expect(contents(b.tree)).toEqual(contents(a.tree));
    }
    // the drawings and the side line really are there
    const main = importPgn(first.chapters[0]!.pgn);
    if (!main.ok) throw new Error('main');
    const c4 = Object.values(main.tree.nodes).find((n) => movesTo(main.tree, n.id).join(' ') === 'e4 e5 Nf3 Nc6 Bc4')!;
    expect(c4.drawings).toHaveLength(2);
    expect(Object.values(main.tree.nodes).some((n) => n.san === 'Bb5' && n.comment === 'The Spanish.')).toBe(true);
  });

  it('reads a study link, and leaves out a chapter it cannot read', () => {
    expect(lichessStudyId('https://lichess.org/study/AbCdEfGh')).toBe('AbCdEfGh');
    expect(lichessStudyId('https://lichess.org/study/AbCdEfGh/IjKlMnOp')).toBe('AbCdEfGh');
    expect(lichessStudyId('https://lichess.org/AbCdEfGh')).toBeNull();
    const broken = chaptersFromPgn('[Event "S: Good"]\n\n1. e4 *\n\n[Event "S: Bad"]\n\n1. e5 *', 'Mine');
    expect(broken.chapters.map((c) => c.name)).toEqual(['Good']);
    expect(broken.skipped[0]).toMatch(/^Bad: /);
  });
});

describe('the position-keyed graph (J1)', () => {
  it('merges two move orders that reach the same position, and shows what follows under both', () => {
    const tree = importPgn('1. d4 (1. c4 e6 2. d4 Nf6) 1... Nf6 2. c4 e6 3. Nc3 *');
    if (!tree.ok) throw new Error('tree');
    const graph: PosGraph = addTree(new Map(), tree.tree);
    // eight positions from the two move orders, one shared, and one more after Nc3
    expect(graphSize(graph)).toEqual({ positions: 9, moves: 9 });
    const shared = playLine(START_FEN, ['c4', 'e6', 'd4', 'Nf6']);
    if (!shared.ok) throw new Error('line');
    // reached by the c4 move order, it knows Nc3, which was only played after the d4 order
    expect(graphMoves(graph, shared.fens.at(-1)!).map((m) => m.san)).toEqual(['Nc3']);
    const back = treeFromGraph(graph, START_FEN);
    const lines = Object.values(back.nodes).filter((n) => !n.children.length).map((n) => movesTo(back, n.id).join(' '));
    expect(lines.sort()).toEqual(['c4 e6 d4 Nf6 Nc3', 'd4 Nf6 c4 e6 Nc3']);
  });
});
