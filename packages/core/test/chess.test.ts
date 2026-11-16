import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  addMove,
  anyToMove,
  balanceInWords,
  classifyDrop,
  describeMove,
  dropOf,
  exportPgn,
  importPgn,
  isLive,
  mainlineEnd,
  movesTo,
  mustPosition,
  newTree,
  parsePosition,
  passPosition,
  playLine,
  positionKey,
  sanToMove,
  uciToMove,
  winChance,
  winChanceFromCp,
  deleteNode,
  promote,
} from '../src/index.ts';

const after = (moves: string) => {
  const r = playLine(START_FEN, moves.split(' '));
  if (!r.ok) throw new Error(`illegal: ${r.move}`);
  return r.fens.at(-1)!;
};

describe('rules wrappers', () => {
  it('rejects invalid positions instead of passing them on', () => {
    expect(parsePosition('not a fen')).toBeNull();
    expect(parsePosition('8/8/8/8/8/8/8/8 w - - 0 1')).toBeNull(); // no kings
    expect(parsePosition(START_FEN)).not.toBeNull();
  });

  it('reads SAN leniently but only accepts legal moves', () => {
    const pos = mustPosition(START_FEN);
    expect(sanToMove(pos, 'e4')).not.toBeNull();
    expect(sanToMove(pos, '1. e4!')).not.toBeNull();
    expect(sanToMove(pos, 'Nf3+')).not.toBeNull(); // a stray "+" is tolerated
    expect(sanToMove(pos, 'e5')).toBeNull();
    expect(sanToMove(pos, 'Ke2')).toBeNull();
    expect(anyToMove(pos, 'g1f3')).not.toBeNull();
    expect(anyToMove(pos, 'g1g3')).toBeNull();
    expect(sanToMove(pos, 'Nxf3')).toBeNull(); // not a capture here: a move written for another position must not match
  });

  it('accepts both ways of writing castling and reports it the engine way', () => {
    const pos = mustPosition(after('e4 e5 Nf3 Nc6 Bc4 Bc5'));
    const a = uciToMove(pos, 'e1g1');
    const b = uciToMove(pos, 'e1h1');
    expect(a && b).toBeTruthy();
    expect(describeMove(pos, a!).san).toBe('O-O');
    expect(describeMove(pos, b!).uci).toBe('e1g1');
    expect(sanToMove(pos, '0-0')).not.toBeNull();
    expect(describeMove(pos, a!).castle).toBe('kingside');
  });

  it('describes captures, en passant, promotion, check and mate', () => {
    const ep = mustPosition(after('e4 a6 e5 d5'));
    const epInfo = describeMove(ep, sanToMove(ep, 'exd6')!);
    expect(epInfo.enPassant).toBe(true);
    expect(epInfo.captured).toBe('pawn');

    const promo = mustPosition('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    const q = describeMove(promo, sanToMove(promo, 'a8=Q')!);
    expect(q.promotion).toBe('queen');
    expect(q.uci).toBe('a7a8q');

    const mate = mustPosition(after('f3 e5 g4'));
    const m = describeMove(mate, sanToMove(mate, 'Qh4')!);
    expect(m.san).toBe('Qh4#');
    expect(m.mate).toBe(true);
  });

  it('stops a line at the first illegal move and says what was legal', () => {
    const r = playLine(START_FEN, ['e4', 'e5', 'Ke3']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.at).toBe(2);
      expect(r.legal).toContain('Ke2');
    }
  });

  it('gives the other side the move only when that is a legal position', () => {
    const quiet = after('e4 e5');
    expect(passPosition(quiet)?.split(' ')[1]).toBe('b');
    const inCheck = after('e4 f6 Qh5+');
    expect(passPosition(inCheck)).toBeNull();
  });

  it('keys transpositions the same', () => {
    expect(positionKey(after('Nf3 Nf6 c4 c5'))).toBe(positionKey(after('c4 c5 Nf3 Nf6')));
  });
});

describe('winning chances (decision D25)', () => {
  it.each([
    [0, 50],
    [100, 59.1],
    [-100, 40.9],
    [300, 75.1],
    [1000, 97.5],
    [5000, 97.5], // clamped
  ])('%i centipawns → %f', (cp, win) => {
    expect(winChanceFromCp(cp)).toBeCloseTo(win, 0);
  });

  it('treats a forced mate as won or lost', () => {
    expect(winChance({ mate: 3 })).toBe(100);
    expect(winChance({ mate: -1 })).toBe(0);
  });

  it('classifies drops with the Lichess thresholds', () => {
    expect(classifyDrop(4.9)).toBe('ok');
    expect(classifyDrop(5)).toBe('inaccuracy');
    expect(classifyDrop(10)).toBe('mistake');
    expect(classifyDrop(15)).toBe('blunder');
    expect(dropOf({ cp: 300 }, { cp: 0 })).toBeCloseTo(25.1, 0);
    expect(dropOf({ cp: 0 }, { cp: 50 })).toBe(0);
  });

  it('knows a live position and speaks in words', () => {
    expect(isLive({ cp: 100 })).toBe(true);
    expect(isLive({ cp: 900 })).toBe(false);
    expect(balanceInWords({ cp: 0 })).toBe('about equal');
    expect(balanceInWords({ cp: 700 })).toBe('winning');
    expect(balanceInWords({ mate: 2 })).toMatch(/mate in 2/);
  });
});

describe('move tree and PGN', () => {
  it('adds moves, reuses an existing child, and branches', () => {
    const tree = newTree();
    const e4 = addMove(tree, tree.root, 'e4');
    const again = addMove(tree, tree.root, 'e2e4');
    const d4 = addMove(tree, tree.root, 'd4');
    expect(e4.ok && again.ok && d4.ok).toBe(true);
    if (e4.ok && again.ok && d4.ok) {
      expect(again.id).toBe(e4.id);
      expect(again.created).toBe(false);
      expect(tree.nodes[tree.root]!.children).toEqual([e4.id, d4.id]);
      expect(promote(tree, d4.id)).toBe(true);
      expect(tree.nodes[tree.root]!.children[0]).toBe(d4.id);
    }
    expect(addMove(tree, tree.root, 'e5').ok).toBe(false);
  });

  it('deletes a move with everything after it', () => {
    const tree = newTree();
    let cur = tree.root;
    for (const san of ['e4', 'e5', 'Nf3']) {
      const r = addMove(tree, cur, san);
      if (r.ok) cur = r.id;
    }
    const e5 = tree.nodes[tree.nodes[cur]!.parent!]!;
    expect(deleteNode(tree, e5.id)).toBe(e5.parent);
    expect(Object.keys(tree.nodes)).toHaveLength(2);
    expect(deleteNode(tree, tree.root)).toBeNull();
  });

  it('round-trips a PGN with variations, castling, promotion and en passant', () => {
    const pgn = `[Event "Test"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. Nxe5 d6 4. Nf3 Nxe4) 3. Bc4 Bc5 4. O-O Nf6 5. d4 exd4 6. e5 d5 7. exd6 (7. exf6 dxc4) 7... O-O 1-0`;
    const first = importPgn(pgn);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const out = exportPgn(first.tree);
    const second = importPgn(out);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(movesTo(second.tree, mainlineEnd(second.tree))).toEqual(movesTo(first.tree, mainlineEnd(first.tree)));
    expect(Object.keys(second.tree.nodes)).toHaveLength(Object.keys(first.tree.nodes).length);
    expect(movesTo(first.tree, mainlineEnd(first.tree))).toContain('exd6');
    expect(out).toContain('( 2... Nf6');
  });

  it('round-trips a game that starts from a set-up position', () => {
    const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    const tree = newTree(fen);
    const r = addMove(tree, tree.root, 'a8=Q');
    expect(r.ok).toBe(true);
    const back = importPgn(exportPgn(tree));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.tree.rootFen).toBe(fen);
      expect(movesTo(back.tree, mainlineEnd(back.tree))).toEqual(['a8=Q']);
    }
  });

  it('accepts a bare FEN and refuses nonsense', () => {
    const fen = importPgn('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
    expect(fen.ok).toBe(true);
    expect(importPgn('').ok).toBe(false);
    expect(importPgn('1. e4 e5 2. Ke3').ok).toBe(true); // the legal part is kept
    expect(importPgn('1. Ke3').ok).toBe(false);
  });
});
