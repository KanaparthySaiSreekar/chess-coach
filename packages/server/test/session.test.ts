import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoFen, movesTo, type DemoMove } from '@chess-coach/core';
import { Db } from '../src/db.ts';
import { OpeningBook } from '../src/openings.ts';
import { BoardSession } from '../src/session.ts';
import { Settings } from '../src/settings.ts';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cc-test-'));
  file = path.join(dir, 't.sqlite');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const open = () => {
  const db = new Db(file);
  return { db, session: new BoardSession(db, new OpeningBook()) };
};
const play = (s: BoardSession, moves: string) => {
  for (const m of moves.split(' ')) {
    const r = s.move(m.slice(0, 2), m.slice(2, 4), m[4] === 'q' ? 'queen' : undefined);
    if (!r.ok) throw new Error(`${m}: ${r.reason}`);
  }
};

describe('the shared board', () => {
  it('plays only legal moves and moves seq on with each one', () => {
    const { db, session } = open();
    const seq = session.state.seq;
    expect(session.move('e2', 'e5').ok).toBe(false);
    expect(session.state.seq).toBe(seq);
    play(session, 'e2e4 e7e5 g1f3');
    expect(session.state.seq).toBe(seq + 3);
    expect(movesTo(session.state.tree, session.state.focus)).toEqual(['e4', 'e5', 'Nf3']);
    expect(session.lastMove()).toMatchObject({ san: 'Nf3', by: 'owner' });
    db.close();
  });

  it('branches into a variation when a different move is played from an earlier position', () => {
    const { db, session } = open();
    play(session, 'e2e4 e7e5 g1f3');
    session.nav('prev');
    play(session, 'f1c4');
    const e5 = session.state.tree.nodes[session.focusNode().parent!]!;
    expect(e5.children).toHaveLength(2);
    session.nav('start');
    expect(session.focusNode().ply).toBe(0);
    session.nav('end');
    expect(movesTo(session.state.tree, session.state.focus)).toEqual(['e4', 'e5', 'Nf3']);
    db.close();
  });

  it('survives a restart: same position, same conversation (PLAN 3.6)', () => {
    const a = open();
    play(a.session, 'e2e4 c7c5');
    a.session.addMessage({ seq: a.session.state.seq, from: 'owner', text: 'hello', segments: [{ type: 'text', text: 'hello' }] });
    const fen = a.session.focusFen();
    const seq = a.session.state.seq;
    a.db.close();
    const b = open();
    expect(b.session.focusFen()).toBe(fen);
    expect(b.session.state.seq).toBe(seq);
    expect(b.session.thread.map((m) => m.text)).toEqual(['hello']);
    b.db.close();
  });

  it("names the owner's side from the board's orientation", () => {
    const { db, session } = open();
    play(session, 'e2e4');
    expect(session.lastMove()?.by).toBe('owner');
    session.flip();
    expect(session.lastMove()?.by).toBe('opponent');
    db.close();
  });

  it('loads a PGN or a FEN, and refuses a game marked as still in progress', () => {
    const { db, session } = open();
    expect(session.load('1. e4 e5 2. Nf3 Nc6 1-0').ok).toBe(true);
    expect(Object.keys(session.state.tree.nodes)).toHaveLength(5);
    expect(session.load('8/P6k/8/8/8/8/8/K7 w - - 0 1').ok).toBe(true);
    const live = session.load('[Event "Daily"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *');
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.reason).toMatch(/still in progress/);
    db.close();
  });

  it('resets the whole position: to the start, or to the first position of what is loaded (I14)', () => {
    const { db, session } = open();
    const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    session.load(fen);
    play(session, 'a1b1');
    const seq = session.state.seq;
    session.reset('root');
    expect(session.focusFen()).toBe(fen); // the set-up position stays, its moves are gone
    expect(Object.keys(session.state.tree.nodes)).toHaveLength(1);
    expect(session.state.seq).toBe(seq + 1);
    session.reset('start');
    expect(session.focusFen()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    db.close();
  });

  it('keeps the engine\'s readings and labels on the moves without moving seq, and can drop the labels', () => {
    const { db, session } = open();
    play(session, 'e2e4');
    const seq = session.state.seq;
    const node = session.focusNode();
    node.gauge = { white: 53, cp: 30 };
    node.judged = { label: 'book', why: "King's Pawn Game", sure: true };
    session.touch();
    expect(session.state.seq).toBe(seq);
    db.close();
    const again = open();
    expect(again.session.focusNode().judged?.label).toBe('book'); // saved with the board
    again.session.clearJudgements();
    expect(again.session.focusNode().judged).toBeUndefined();
    expect(again.session.focusNode().gauge).toEqual({ white: 53, cp: 30 });
    again.db.close();
  });

  it('promotes a pawn', () => {
    const { db, session } = open();
    session.load('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    play(session, 'a7a8q');
    expect(session.focusNode().san).toBe('a8=Q');
    db.close();
  });
});

describe('a position set up in the board editor (I2)', () => {
  it('becomes the first position of a fresh board, and only legal moves are played from it', () => {
    const { db, session } = open();
    play(session, 'e2e4 e7e5');
    const seq = session.state.seq;
    const r = session.setup('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(r).toEqual({ ok: true, fen: '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1' });
    expect(session.state.tree.rootFen).toBe('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(Object.keys(session.state.tree.nodes)).toHaveLength(1);
    expect(session.state.seq).toBe(seq + 1);
    expect(session.move('e1', 'g1').ok).toBe(true); // castling is allowed here
    expect(session.move('e8', 'f8').ok).toBe(false); // the rook on f1 covers f8
    db.close();
  });

  it('is refused with the reason when chess does not allow it, and the board is left as it was', () => {
    const { db, session } = open();
    play(session, 'e2e4');
    const before = session.focusFen();
    const noKing = session.setup('8/8/8/8/8/8/4P3/4K3 w - - 0 1');
    expect(noKing).toMatchObject({ ok: false });
    if (!noKing.ok) expect(noKing.reason).toMatch(/exactly one king/);
    expect(session.setup('not a fen')).toMatchObject({ ok: false });
    expect(session.focusFen()).toBe(before);
    db.close();
  });

  it('drops castling that standard chess does not allow from a set-up or pasted position', () => {
    const { db, session } = open();
    // the king stands on f1: the "KQ" in the FEN means nothing
    expect(session.setup('r3k2r/8/8/8/8/8/8/R4K1R w KQkq - 0 1')).toEqual({ ok: true, fen: 'r3k2r/8/8/8/8/8/8/R4K1R w kq - 0 1' });
    expect(session.load('r3k2r/8/8/8/8/8/8/R4K1R w KQkq - 0 1').ok).toBe(true);
    expect(session.state.tree.rootFen).toBe('r3k2r/8/8/8/8/8/8/R4K1R w kq - 0 1');
    db.close();
  });
});

describe("the owner's drawings (PLAN 3.2: Lichess drawing tags)", () => {
  it('stay with the position they were drawn on, come back when the owner returns, and go into the PGN', () => {
    const { db, session } = open();
    play(session, 'e2e4');
    session.setOwnerShapes([
      { from: 'd2', to: 'd4', style: 'owner', color: 'green' },
      { from: 'e5', style: 'owner', color: 'red' },
    ]);
    const seq = session.state.seq;
    play(session, 'e7e5');
    expect(session.state.shapes.owner).toEqual([]); // a position not drawn on is clean
    session.nav('prev');
    expect(session.state.shapes.owner).toEqual([
      { from: 'd2', to: 'd4', style: 'owner', color: 'green' },
      { from: 'e5', style: 'owner', color: 'red' },
    ]);
    expect(session.state.seq).toBe(seq + 2); // drawing itself never moved seq on
    const pgn = session.pgn();
    expect(pgn).toContain('[%csl Re5]');
    expect(pgn).toContain('[%cal Gd2d4]');
    db.close();
    // and after a restart they are still there
    const again = open();
    expect(again.session.state.shapes.owner).toHaveLength(2);
    again.db.close();
  });

  it('are removed from the position when the owner clears them', () => {
    const { db, session } = open();
    play(session, 'e2e4');
    session.setOwnerShapes([{ from: 'd2', to: 'd4', style: 'owner', color: 'blue' }]);
    session.setOwnerShapes([]);
    expect(session.focusNode().drawings).toBeUndefined();
    expect(session.pgn()).not.toContain('%cal');
    db.close();
  });

  it('show a loaded study\'s drawings, and a scratch-pad drawing does not replace them', () => {
    const { db, session } = open();
    expect(session.load('[Result "1-0"]\n\n1. e4 { [%csl Gd4] [%cal Ye2e4] } e5 1-0').ok).toBe(true);
    session.nav('next');
    expect(session.state.shapes.owner).toEqual([
      { from: 'd4', to: undefined, style: 'owner', color: 'green' },
      { from: 'e2', to: 'e4', style: 'owner', color: 'yellow' },
    ]);
    // with "keep my drawings" off, what the owner draws is shown but not written into the position
    session.setOwnerShapes([{ from: 'a1', style: 'owner', color: 'green' }], { keep: false });
    expect(session.state.shapes.owner).toHaveLength(1);
    expect(session.focusNode().drawings).toHaveLength(2);
    db.close();
  });

  it("drawn on the coach's board are not written into the owner's position", () => {
    const { db, session } = open();
    play(session, 'e2e4');
    session.openDemo('a look', session.focusFen());
    session.setOwnerShapes([{ from: 'e4', to: 'e5', style: 'owner', color: 'green' }]);
    expect(session.state.shapes.owner).toHaveLength(1);
    expect(session.focusNode().drawings).toBeUndefined();
    session.closeDemo();
    expect(session.state.shapes.owner).toEqual([]);
    db.close();
  });
});

describe("the coach's layer", () => {
  const mv = (san: string, from: string, to: string, fen: string, by: 'white' | 'black'): DemoMove => ({ san, from, to, fen, by, mark: '' });

  it("keeps the owner's place while the coach shows a line, and never moves seq", () => {
    const { db, session } = open();
    play(session, 'e2e4 e7e5');
    const base = session.focusFen();
    const seq = session.state.seq;
    session.openDemo('An idea', base);
    const f3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
    const line = session.addDemoLine({ label: 'Develop', baseFen: base, moves: [mv('Nf3', 'g1', 'f3', f3, 'white')] });
    session.demoGoto(line.id, 1);
    expect(session.state.layer).toBe('demo');
    expect(session.visibleFen()).toBe(f3);
    expect(demoFen(session.state.demo!)).toBe(f3);
    expect(session.focusFen()).toBe(base); // the owner's board did not move
    expect(session.state.seq).toBe(seq);
    expect(session.move('g1', 'f3').ok).toBe(false); // no moving pieces on the coach's board
    session.closeDemo();
    expect(session.state.layer).toBe('owner');
    expect(session.visibleFen()).toBe(base);
    db.close();
  });

  it('follows sublines back to the base and copies a line into the owner’s moves', () => {
    const { db, session } = open();
    play(session, 'e2e4 e7e5');
    const base = session.focusFen();
    session.openDemo('Lines', base);
    const f3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
    const nc6 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const nf6 = 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const main = session.addDemoLine({ label: 'Main', baseFen: base, moves: [mv('Nf3', 'g1', 'f3', f3, 'white'), mv('Nc6', 'b8', 'c6', nc6, 'black')] });
    const sub = session.addDemoLine({ label: 'Or', baseFen: f3, moves: [mv('Nf6', 'g8', 'f6', nf6, 'black')], parent: { line: main.id, ply: 1 } });
    expect(session.demoPath(sub.id)).toEqual({ baseFen: base, sans: ['Nf3', 'Nf6'] });
    expect(session.adoptDemoLine(sub.id)).toBe(true);
    expect(session.state.layer).toBe('owner');
    expect(movesTo(session.state.tree, session.state.focus)).toEqual(['e4', 'e5', 'Nf3', 'Nf6']);
    db.close();
  });
});

describe("the owner's moves on the coach's board (A18)", () => {
  const mv = (san: string, from: string, to: string, fen: string, by: 'white' | 'black'): DemoMove => ({ san, from, to, fen, by, mark: '' });
  const f3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
  const nc6 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const nf6 = 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

  it("steps along the coach's line when the owner plays its next move, and onto a side line that starts there", () => {
    const { db, session } = open();
    play(session, 'e2e4 e7e5');
    const base = session.focusFen();
    const seq = session.state.seq;
    session.openDemo('Lines', base);
    const main = session.addDemoLine({ label: 'Main', baseFen: base, moves: [mv('Nf3', 'g1', 'f3', f3, 'white'), mv('Nc6', 'b8', 'c6', nc6, 'black')] });
    const side = session.addDemoLine({ label: 'Or', baseFen: f3, moves: [mv('Nf6', 'g8', 'f6', nf6, 'black')], parent: { line: main.id, ply: 1 } });
    session.demoGoto(null, 0);
    expect(session.demoFollow('Nf3')).toEqual({ line: main.id, ply: 1 }); // from the base: the line's first move
    expect(session.visibleFen()).toBe(f3);
    expect(session.demoFollow('Nf6')).toEqual({ line: side.id, ply: 1 }); // the side line that branches here
    session.demoGoto(main.id, 1);
    expect(session.demoFollow('Nc6')).toEqual({ line: main.id, ply: 2 });
    expect(session.demoFollow('a3')).toBeNull(); // not in any line: an alternative, for the engine to judge
    expect(session.state.seq).toBe(seq); // stepping through the coach's lines is not the owner's own board
    db.close();
  });

  it("adds the owner's alternative as a side line of their own, and moves seq on", () => {
    const { db, session } = open();
    play(session, 'e2e4 e7e5');
    const base = session.focusFen();
    session.openDemo('Lines', base);
    const main = session.addDemoLine({ label: 'Main', baseFen: base, moves: [mv('Nf3', 'g1', 'f3', f3, 'white'), mv('Nc6', 'b8', 'c6', nc6, 'black')] });
    session.demoGoto(main.id, 1);
    const seq = session.state.seq;
    const alt = session.addDemoLine({ label: 'Your alternative: Nf6', baseFen: f3, moves: [{ ...mv('Nf6', 'g8', 'f6', nf6, 'black'), alt: true }], parent: { line: main.id, ply: 1 }, kind: 'alt' }, { byOwner: true });
    expect(session.state.seq).toBe(seq + 1); // an answer the coach was still writing is now stale
    expect(session.state.demo!.cursor).toEqual({ line: alt.id, ply: 1 }); // the owner sees their own move
    expect(session.visibleFen()).toBe(nf6);
    expect(session.focusFen()).toBe(base); // their own board is untouched
    db.close();
  });
});

describe('settings', () => {
  it('a preset changes exactly its keys, logs each change, and can be undone (K2)', () => {
    const db = new Db(file);
    const s = new Settings(db);
    s.set('display.boardTheme', 'green');
    const r = s.applyPreset('think_first');
    expect(r.ok && r.changed.sort()).toEqual(['display.bestArrows', 'display.evalBar', 'display.moveLabels']);
    expect(s.get('display.evalBar')).toBe(false);
    expect(s.get('display.boardTheme')).toBe('green'); // not part of the preset: left alone
    expect(s.applyPreset('nope').ok).toBe(false);
    const back = s.applyPreset('default');
    expect(back.ok && back.changed).toHaveLength(3);
    expect(s.get('display.evalBar')).toBe(true);
    expect(s.resetAll('Board')).toEqual(['display.boardTheme']);
    const logged = (db.sql.prepare("SELECT data FROM events WHERE type = 'setting'").all() as { data: string }[]).map((x) => JSON.parse(x.data).key);
    expect(logged.filter((k) => k === 'display.evalBar')).toHaveLength(2);
    db.close();
  });


  it('have defaults, validate, persist, and log every change', () => {
    const db = new Db(file);
    const s = new Settings(db);
    expect(s.get('coach.verbosity.analysis')).toBe('key_moments');
    expect(s.get('display.engineLines')).toBe(false); // engine lines stay hidden until switched on
    expect(s.set('coach.verbosity.analysis', 'loud').ok).toBe(false);
    expect(s.set('coach.ladder.maxMisses', 99).ok).toBe(false);
    expect(s.set('coach.verbosity.analysis', 'every_move').ok).toBe(true);
    db.close();
    const db2 = new Db(file);
    expect(new Settings(db2).get('coach.verbosity.analysis')).toBe('every_move');
    const logged = db2.sql.prepare("SELECT data FROM events WHERE type = 'setting'").all() as { data: string }[];
    expect(JSON.parse(logged[0]!.data)).toEqual({ key: 'coach.verbosity.analysis', before: 'key_moments', after: 'every_move' });
    expect(new Settings(db2).all().every((x) => x.why.length > 10)).toBe(true);
    db2.close();
  });
});
