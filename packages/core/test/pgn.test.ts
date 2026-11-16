// PGN in and out with what a Lichess study or game export carries besides the moves (PLAN WP 3.2,
// CONTENT §4): drawings, move marks, clocks, the source's evaluation. Nothing may be lost on the way.

import { describe, expect, it } from 'vitest';
import { START_FEN, addMove, exportPgn, importPgn, mainlineEnd, newTree, pathTo } from '../src/index.ts';

const mustImport = (pgn: string) => {
  const r = importPgn(pgn);
  if (!r.ok) throw new Error(r.reason);
  return r.tree;
};
const main = (pgn: string) => {
  const tree = mustImport(pgn);
  return { tree, nodes: pathTo(tree, mainlineEnd(tree)) };
};

describe('PGN: Lichess drawing tags', () => {
  it('reads arrows and circles out of a comment and keeps the words', () => {
    const { nodes } = main('1. e4 { The centre. [%csl Gd4,Re5] [%cal Ge2e4,Bg1f3] } e5 { [%cal Yd7d5] } *');
    expect(nodes[1]!.comment).toBe('The centre.');
    expect(nodes[1]!.drawings).toEqual([
      { from: 'd4', color: 'green' },
      { from: 'e5', color: 'red' },
      { from: 'e2', to: 'e4', color: 'green' },
      { from: 'g1', to: 'f3', color: 'blue' },
    ]);
    // a comment that held only drawings leaves no words behind
    expect(nodes[2]!.comment).toBeUndefined();
    expect(nodes[2]!.drawings).toEqual([{ from: 'd7', to: 'd5', color: 'yellow' }]);
  });

  it('keeps drawings on the starting position (a study chapter draws there)', () => {
    const tree = mustImport('[Event "Chapter 1"]\n\n{ Look at the centre. [%csl Ge4,Gd4] } 1. e4 *');
    const root = tree.nodes[tree.root]!;
    expect(root.comment).toBe('Look at the centre.');
    expect(root.drawings).toEqual([
      { from: 'e4', color: 'green' },
      { from: 'd4', color: 'green' },
    ]);
    const again = mustImport(exportPgn(tree));
    expect(again.nodes[again.root]!.drawings).toEqual(root.drawings);
    expect(again.nodes[again.root]!.comment).toBe('Look at the centre.');
  });

  it('writes drawings back as Lichess writes them', () => {
    const tree = newTree(START_FEN);
    const r = addMove(tree, tree.root, 'e4');
    if (!r.ok) throw new Error('e4');
    tree.nodes[r.id]!.comment = 'Takes the centre.';
    tree.nodes[r.id]!.drawings = [
      { from: 'd4', color: 'green' },
      { from: 'e4', to: 'e5', color: 'red' },
    ];
    const pgn = exportPgn(tree);
    expect(pgn).toContain('Takes the centre.');
    expect(pgn).toContain('[%csl Gd4]');
    expect(pgn).toContain('[%cal Re4e5]');
  });
});

describe('PGN: marks, clocks and the source evaluation', () => {
  it('keeps the marks on moves', () => {
    const { tree, nodes } = main('1. e4! e5?? 2. Nf3!? Nc6 $14 *');
    expect(nodes.map((n) => n.nags)).toEqual([undefined, [1], [4], [5], [14]]);
    const pgn = exportPgn(tree);
    expect(pgn).toMatch(/1\. e4 ?(\$1|!)/);
    expect(mustImport(pgn).nodes[nodes[4]!.id]!.nags).toEqual([14]);
  });

  it('keeps clocks and the evaluation a Lichess game export carries', () => {
    const { tree, nodes } = main('1. e4 { [%eval 0.17] [%clk 0:10:00] } e5 { [%eval 0.19] [%clk 0:09:58] } 2. Qh5 { A raid. [%eval -0.4] [%clk 0:09:55] } *');
    expect(nodes[1]!.clock).toBe(600);
    expect(nodes[2]!.clock).toBe(598);
    expect(nodes[3]!.comment).toBe('A raid.');
    expect(nodes[1]!.sourceEval).toEqual({ pawns: 0.17 });
    const pgn = exportPgn(tree);
    expect(pgn).toContain('[%clk 0:09:58]');
    expect(pgn).toContain('[%eval -0.4');
    expect(pgn).toContain('A raid.');
  });
});

describe('PGN: nothing is lost on the way through', () => {
  const STUDY = `[Event "Italian: chapter 2"]
[Site "https://lichess.org/study/abc"]
[Result "*"]

{ Start here. [%csl Ge4] }
1. e4 { [%cal Ge2e4] } e5 2. Nf3! { Attacks the pawn. [%csl Re5] [%cal Gf3e5] } Nc6 (2... d6 { Solid. } 3. d4 { [%cal Gd2d4,Rd4e5] }) (2... f6?? { Loses. } 3. Nxe5! fxe5 4. Qh5+ { [%csl Re8] }) 3. Bc4 Bc5 { [%clk 0:05:00] } *`;

  it('a study with variations, comments, marks and drawings exports and re-imports unchanged', () => {
    const first = mustImport(STUDY);
    const pgn1 = exportPgn(first);
    const second = mustImport(pgn1);
    const pgn2 = exportPgn(second);
    expect(pgn2).toBe(pgn1);
    // and the trees hold the same things, node for node
    const strip = (t: typeof first) => Object.values(t.nodes).map((n) => ({ san: n.san, comment: n.comment, drawings: n.drawings, nags: n.nags, clock: n.clock, children: n.children.length }));
    expect(strip(second)).toEqual(strip(first));
    // spot checks against the text
    const all = Object.values(first.nodes);
    expect(all.filter((n) => n.drawings?.length).length).toBe(5);
    expect(all.find((n) => n.san === 'Qh5+')!.drawings).toEqual([{ from: 'e8', color: 'red' }]);
    expect(all.find((n) => n.san === 'f6')!.nags).toEqual([4]);
    expect(all.find((n) => n.san === 'd4')!.drawings).toEqual([
      { from: 'd2', to: 'd4', color: 'green' },
      { from: 'd4', to: 'e5', color: 'red' },
    ]);
  });

  it('tricky moves round-trip: promotion, en passant, castling both ways, checks, nested variations', () => {
    const TRICKY = '1. e4 d5 2. e5 f5 3. exf6 (3. Nf3 Nc6 (3... e6 4. d4) 4. Bb5) exf6 4. Nf3 Bd6 5. Bc4 Ne7 6. O-O O-O 7. d4 Nbc6 8. Nc3 Bg4 9. Be3 Qd7 10. Qd2 Rae8 11. Rae1 Kh8 12. Bxd5 Nxd5 13. Nxd5 Bxh2+ 14. Kxh2 Qxd5 15. c4 Qh5+ 16. Kg1 Bxf3 17. gxf3 Qxf3 18. d5 Ne5 19. Bf4 Nd3 20. Rxe8 Rxe8 21. Qxd3 Qxd3 22. b3 g5 23. Bg3 f5 24. d6 f4 25. dxc7 fxg3 26. c8=Q gxf2+ 27. Rxf2 Rxc8 *';
    const first = mustImport(TRICKY);
    const pgn1 = exportPgn(first);
    expect(exportPgn(mustImport(pgn1))).toBe(pgn1);
    const sans = Object.values(first.nodes).map((n) => n.san);
    for (const san of ['exf6', 'O-O', 'Bxh2+', 'c8=Q', 'gxf2+']) expect(sans).toContain(san);
  });
});
