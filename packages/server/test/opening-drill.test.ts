import { describe, expect, it } from 'vitest';
import { lineSteps, positionKey, readTrap, repertoireLines, type ContentItem, type RepLine, type TrapItem } from '@chess-coach/core';
import { Db } from '../src/db.ts';
import { OpeningTrainer, type OpeningEvent } from '../src/opening-drill.ts';

// PLAN WP 8.8: the opening drill and its schedule (FSRS, through the drills' shared deck).
function setup(whyEvery = 3) {
  const db = new Db(':memory:');
  const rep = db.addRepertoire({ name: 'Italian', colour: 'white', source: 'pasted:2026-11-15', licence: 'own', level: '400–700' });
  const lines = repertoireLines('1. e4 e5 2. Nf3 Nc6 3. Bc4 *\n\n1. e4 e5 2. Nf3 d6 3. d4 *', 'white').lines.map((l) => ({ ...l, repertoire: rep }));
  const ids = lines.map((line) => {
    const item: ContentItem<RepLine> = { type: 'repertoire', status: 'live', source: 'pasted:2026-11-15', licence: 'own', level: '400–700', engine: 'test', gates: [], body: line };
    return db.saveContent(`rep:${rep}|${line.moves.join(' ')}`, item);
  });
  const nf3 = lineSteps(lines[0]!).steps[2]!;
  db.setRepText(rep, positionKey(nf3.fenBefore), { fen: nf3.fenBefore, uci: nf3.uci, san: nf3.san, why: '{m:Nf3} develops your knight and attacks the pawn on {sq:e5}.', idea: 'Their move {m:e5} puts a pawn in the centre.' });
  let now = new Date('2026-11-15T12:00:00Z');
  const events: OpeningEvent[] = [];
  const trainer = new OpeningTrainer({
    db,
    schedule: () => ({ reviewCap: 50, maxDays: 365 }),
    guard: () => null,
    depthMoves: () => 9,
    whyEvery: () => whyEvery,
    replyShares: (fen) => (fen.startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2') ? new Map([['b8c6', 55], ['d7d6', 15]]) : null),
    storedUnderData: true,
    onChange: () => {},
    onEvent: (e) => void events.push(e),
    now: () => now,
  });
  return { db, rep, ids, trainer, events, later: (days: number) => (now = new Date(now.getTime() + days * 86_400_000)) };
}

describe('the opening drill (WP 8.8)', () => {
  it('makes a card per position of the live lines, shows a new card first, then asks it when it is due', async () => {
    const { db, trainer, events, later } = setup();
    expect(trainer.sync()).toEqual({ cards: 4, added: 4, removed: 0 }); // e4, Nf3, Bc4, d4
    expect(trainer.view).toMatchObject({ ready: 4, left: 4 });
    // the first card: new, so it is shown: the move, then the owner plays it
    trainer.next();
    expect(trainer.view).toMatchObject({ status: 'learn', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', move: { san: 'e4', from: 'e2', to: 'e4' } });
    expect(events.at(-1)).toMatchObject({ kind: 'opening_new' });
    trainer.move('d2', 'd4'); // not the move shown: the board puts it back
    expect(trainer.view).toMatchObject({ status: 'learn', tries: 1 });
    trainer.move('e2', 'e4');
    await expect.poll(() => trainer.view.status).toBe('right');
    expect(db.attemptsOf(trainer.view.id!)).toHaveLength(1);
    const card = db.getCard(trainer.view.id!)!;
    expect(new Date(card.dueAt).getTime()).toBeGreaterThan(Date.parse('2026-11-15T12:00:00Z'));
    // the second: 2.Nf3 with its words, and the replies prepared after it, the most played at the owner's level first
    trainer.next();
    expect(trainer.view).toMatchObject({ status: 'learn', line: ['e4', 'e5'], why: 'Nf3 develops your knight and attacks the pawn on e5.', idea: 'Their move e5 puts a pawn in the centre.' });
    expect(trainer.view.replies).toEqual([{ san: 'Nc6', share: 55 }, { san: 'd6', share: 15 }]);
    trainer.move('g1', 'f3');
    await expect.poll(() => trainer.view.status).toBe('right');
    // a week later the first cards are due: asked, not shown
    later(7);
    trainer.next();
    expect(trainer.view.status).toBe('ask');
    expect(trainer.view.move).toBeUndefined();
  });

  it('a wrong move shows the right one with its why, and the card comes back soon; a right one moves it further away', async () => {
    const { db, trainer, events, later } = setup(0);
    trainer.sync();
    for (let i = 0; i < 4; i++) {
      trainer.next();
      const m = trainer.view.move!;
      trainer.move(m.from, m.to);
      await expect.poll(() => trainer.view.status).toBe('right');
    }
    later(30);
    trainer.next();
    const id = trainer.view.id!;
    expect(trainer.view.status).toBe('ask');
    const fen = trainer.view.fen;
    // a move that is not the card's
    const wrong = fen.startsWith('rnbqkbnr/pppppppp') ? ['d2', 'd4'] : ['b1', 'c3'];
    trainer.move(wrong[0]!, wrong[1]!);
    expect(trainer.view.status).toBe('wrong');
    expect(trainer.view.move).toBeDefined();
    expect(events.at(-1)).toMatchObject({ kind: 'opening_miss' });
    trainer.move(trainer.view.move!.from, trainer.view.move!.to);
    await expect.poll(() => trainer.view.status).toBe('right');
    const missed = db.getCard(id)!;
    expect(db.attemptsOf(id).at(-1)).toMatchObject({ result: 'shown', misses: 1 });
    // the next card answered right goes much further out than the missed one
    trainer.next();
    const other = trainer.view.id!;
    const right = db.getContent(other)!.body as unknown as { move: { uci: string } };
    trainer.move(right.move.uci.slice(0, 2), right.move.uci.slice(2, 4));
    await expect.poll(() => trainer.view.status).toBe('right');
    expect(new Date(db.getCard(other)!.dueAt).getTime()).toBeGreaterThan(new Date(missed.dueAt).getTime());
  });

  it('now and then asks why; the written why is shown after the owner has said it, and a missed why counts', async () => {
    const { db, trainer, events } = setup(1);
    trainer.sync();
    // learn the Nf3 card first (the only card with a why)
    for (let i = 0; i < 2; i++) {
      trainer.next();
      trainer.move(trainer.view.move!.from, trainer.view.move!.to);
      await expect.poll(() => trainer.view.status).toBe('right');
    }
    const nf3 = db.contentKeys('opening').find((k) => db.getContent(k.id)!.body && (db.getContent(k.id)!.body as unknown as { move: { san: string } }).move.san === 'Nf3')!.id;
    // make it due now, then ask it
    db.saveCard(nf3, { ...db.getCard(nf3)!, dueAt: '2026-11-01T00:00:00.000Z' });
    trainer.next();
    expect(trainer.view).toMatchObject({ status: 'ask', id: nf3 });
    trainer.move('g1', 'f3');
    expect(trainer.view.status).toBe('why');
    expect(trainer.view.why).toBeUndefined(); // not given away before the owner says it
    trainer.why('it develops a piece');
    expect(trainer.view).toMatchObject({ status: 'why', words: 'it develops a piece', why: 'Nf3 develops your knight and attacks the pawn on e5.' });
    expect(events.at(-1)).toMatchObject({ kind: 'opening_why', words: 'it develops a piece' });
    trainer.whyKnown(false);
    await expect.poll(() => trainer.view.status).toBe('right');
    expect(db.recentEvents('opening_card', 1)[0]!.data).toMatch(/"grade":"hard","why":false/);
  });

  it('a card is put aside when its line stops being live, and comes back with its schedule when the line does (WP 8.11); nothing to drill says where cards come from', async () => {
    const { db, ids, trainer } = setup();
    trainer.sync();
    // answer the d4 card (the d6 line's) so it has a schedule
    const d4 = db.contentKeys('opening').find((k) => (db.getContent(k.id)!.body as unknown as { move: { san: string } }).move.san === 'd4')!.id;
    for (let i = 0; i < 4; i++) {
      trainer.next();
      trainer.move(trainer.view.move!.from, trainer.view.move!.to);
      await expect.poll(() => trainer.view.status).toBe('right');
    }
    const card = db.getCard(d4)!;
    db.setContentStatus(ids[1]!, 'quarantined'); // the d6 line, quarantined by a re-check
    expect(trainer.sync()).toEqual({ cards: 3, added: 0, removed: 1 });
    expect(db.getContent(d4)!.status).toBe('draft');
    expect(trainer.sync()).toEqual({ cards: 3, added: 0, removed: 0 }); // put aside once
    db.setContentStatus(ids[1]!, 'live'); // re-approved
    expect(trainer.sync()).toMatchObject({ cards: 4, added: 1 });
    expect(db.getContent(d4)!.status).toBe('live'); // the same card…
    expect(db.getCard(d4)).toEqual(card); // …with its schedule
    expect(db.attemptsOf(d4)).toHaveLength(1);
    db.setContentStatus(ids[1]!, 'quarantined');
    trainer.sync();
    for (const id of ids) db.setContentStatus(id, 'machine-verified');
    trainer.sync();
    expect(trainer.next()).toEqual({ ok: false, reason: expect.stringMatching(/approve under Game → Review content/) });
  });

  it("a live trap of the pack is a card: its name kept back while it is asked, another sound defence counts, and the why check asks what they hoped for (WP 8.9)", async () => {
    const { db, ids, trainer, later } = setup(1);
    for (const id of ids) db.setContentStatus(id, 'machine-verified'); // only the trap is live
    const read = readTrap({ id: 'scholar', name: "Scholar's Mate", side: 'black', kind: 'avoid', moves: 'e4 e5 Bc4 Nc6 Qh5', hope: 'Nf6', move: 'g6', why: '{m:g6} protects your pawn on {sq:f7} and attacks their queen on {sq:h5}.', idea: 'They hope you play {m:Nf6}: then their queen takes on {sq:f7}, and it is checkmate.', themes: ['f7'] });
    if (!read.ok) throw new Error(read.reason);
    db.saveContent('trap:scholar', { type: 'trap', status: 'live', source: 'file:content/traps.json#scholar', licence: 'project', level: '400–700', engine: 'test', gates: [], body: { ...read.item, accepted: ['d8e7'] } } as ContentItem<TrapItem>);
    expect(trainer.sync()).toMatchObject({ cards: 1 });
    trainer.next();
    expect(trainer.view).toMatchObject({ status: 'learn', repertoire: 'Traps', trap: { kind: 'avoid', name: "Scholar's Mate" }, move: { san: 'g6' } });
    trainer.move('g7', 'g6');
    await expect.poll(() => trainer.view.status).toBe('right');
    later(30);
    trainer.next();
    expect(trainer.view).toMatchObject({ status: 'ask', trap: { kind: 'avoid' } });
    expect(trainer.view.trap!.name).toBeUndefined(); // the name would give it away
    trainer.move('d8', 'e7'); // Qe7: another sound defence
    expect(trainer.view.status).toBe('why');
    expect(trainer.view.idea).toBeUndefined(); // what they hope for is the question now
    trainer.why('they want Nf6 so the queen mates on f7');
    expect(trainer.view.why).toBe('They hope you play Nf6: then their queen takes on f7, and it is checkmate.');
    trainer.whyKnown(true);
    await expect.poll(() => trainer.view.status).toBe('right');
    expect(trainer.view.trap).toEqual({ kind: 'avoid', name: "Scholar's Mate" });
  });
});

describe('drilling a big repertoire (WP 8.14, D11)', () => {
  function big(newPerDay: number) {
    const db = new Db(':memory:');
    const rep = db.addRepertoire({ name: 'Réti', colour: 'white', source: 'pasted:2026-11-16', licence: 'own', level: '400–700' });
    const pgn = '1. Nf3 d5 2. b3 Nf6 3. Bb2 *\n\n1. Nf3 Nf6 2. b3 g6 3. Bb2 *\n\n1. Nf3 c5 2. b3 Nc6 3. Bb2 *';
    const chapters = ['1.Nf3 d5 2.b3', '1.Nf3 Nf6 2.b3 g6', '1.Nf3 c5 2.b3'];
    repertoireLines(pgn, 'white').lines.forEach((l, i) => {
      // the teaching order puts the last chapter first
      const line = { ...l, repertoire: rep, chapter: chapters[i], order: [2, 1, 0][i] };
      db.saveContent(`rep:${rep}|${line.moves.join(' ')}`, { type: 'repertoire', status: 'live', source: 'pasted:2026-11-16', licence: 'own', level: '400–700', engine: 'test', gates: [], body: line } as ContentItem<RepLine>);
    });
    const trainer = new OpeningTrainer({ db, schedule: () => ({ reviewCap: 50, maxDays: 365 }), guard: () => null, depthMoves: () => 9, whyEvery: () => 0, newPerDay: () => newPerDay, storedUnderData: true, onChange: () => {} });
    return { db, rep, trainer };
  }
  const learn = async (trainer: OpeningTrainer) => {
    const m = trainer.view.move!;
    trainer.move(m.from, m.to);
    await expect.poll(() => trainer.view.status).toBe('right');
  };

  it("new cards come in the teaching order, chapter by chapter, and only so many a day", async () => {
    const { trainer } = big(3);
    trainer.sync();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      expect(trainer.next()).toEqual({ ok: true });
      seen.push(`${trainer.view.chapter}: ${trainer.view.move!.san}`);
      await learn(trainer);
    }
    // 1.Nf3 is in every chapter: it comes with the first one in the order (1...c5), then that chapter's moves
    expect(seen).toEqual(['1.Nf3 c5 2.b3: Nf3', '1.Nf3 c5 2.b3: b3', '1.Nf3 c5 2.b3: Bb2']);
    expect(trainer.view).toMatchObject({ newToday: 3, newPerDay: 3 });
    // the day's three are done and nothing is due: more tomorrow
    expect(trainer.next()).toEqual({ ok: false, reason: expect.stringMatching(/today's 3 new positions/) });
  });

  it('the drill can be kept to one chapter; the choices list the chapters with their new cards', async () => {
    const { rep, trainer } = big(10);
    trainer.sync();
    expect(trainer.view.scopes).toEqual([
      {
        id: rep,
        name: 'Réti',
        colour: 'white',
        chapters: [
          { name: '1.Nf3 c5 2.b3', cards: 3, fresh: 3, due: 0 },
          { name: '1.Nf3 Nf6 2.b3 g6', cards: 2, fresh: 2, due: 0 },
          { name: '1.Nf3 d5 2.b3', cards: 2, fresh: 2, due: 0 },
        ],
      },
    ]);
    trainer.setScope(rep, ['1.Nf3 d5 2.b3']);
    expect(trainer.view.scope).toEqual({ repertoire: rep, chapters: ['1.Nf3 d5 2.b3'] });
    // 1.Nf3 belongs to every chapter; then this chapter's own move
    const moves: string[] = [];
    while (trainer.next().ok) {
      moves.push(trainer.view.move!.san);
      await learn(trainer);
    }
    expect(moves).toEqual(['Nf3', 'b3', 'Bb2']);
  });
});
