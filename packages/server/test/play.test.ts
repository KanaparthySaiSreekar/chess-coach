// The bots and the game loop, with a stand-in for Maia: no Python, no engine.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTINE_PROMPTS, START_FEN, clockLeft, importPgn, legalMoves, mustPosition, movesTo, playLine, type RoutineLevel } from '@chess-coach/core';
import { legalOnly, sampleMove, type MoveProbability, type MoveSource, type ProbabilityRequest } from '../src/bots/service.ts';
import { config } from '../src/config.ts';
import { Db } from '../src/db.ts';
import { DRAW_FROM_PLY, PlayController, loadMinis, loadRoster } from '../src/play.ts';
import { GameLibrary } from '../src/library.ts';
import { Settings } from '../src/settings.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A "bot" that plays a script when it has one, and otherwise the first legal move. */
class FakeMaia implements MoveSource {
  state: 'idle' | 'starting' | 'ready' | 'error' = 'ready';
  problem?: string;
  seen: ProbabilityRequest[] = [];
  script: string[] = [];
  fail = false;
  async probabilities(req: ProbabilityRequest): Promise<MoveProbability[]> {
    this.seen.push(req);
    if (this.fail) throw new Error('no answer');
    const r = playLine(req.startFen, req.moves);
    if (!r.ok) throw new Error('bad history');
    const legal = legalMoves(mustPosition(r.fens.at(-1)!)).map((m) => m.uci);
    const want = this.script.shift();
    // an illegal move is offered too: the server must never play it
    return [{ uci: 'a1a8', p: 0.5 }, { uci: want && legal.includes(want) ? want : legal[0]!, p: 0.4 }];
  }
  stop() {}
}

let dir: string;
let db: Db;
let maia: FakeMaia;
let changes: number;
const make = () =>
  new PlayController({ db, settings: new Settings(db), roster: loadRoster(config.rosterFile), source: maia, onChange: () => void changes++, noDelay: true, rng: () => 0.3 });
const until = async (test: () => boolean) => {
  const t0 = Date.now();
  while (!test()) {
    if (Date.now() - t0 > 3000) throw new Error('timed out waiting');
    await sleep(5);
  }
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cc-play-'));
  db = new Db(path.join(dir, 't.sqlite'));
  maia = new FakeMaia();
  changes = 0;
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the bot roster (F9)', () => {
  it('has a bot for every 100 Elo from 600 to 2000, then every 200 up to 2600', () => {
    const roster = loadRoster(config.rosterFile);
    // the human-like bots; the engine-style ones are an option of their own (WP 7.8)
    const elos = roster.filter((b) => b.kind !== 'engine').map((b) => b.elo);
    expect(elos).toEqual([600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2200, 2400, 2600]);
    expect(roster.filter((b) => b.kind === 'engine').map((b) => b.elo)).toEqual([1400, 1700, 2000]);
    expect(new Set(roster.map((b) => b.name)).size).toBe(roster.length);
    expect(roster.every((b) => b.about.length > 20 && b.band)).toBe(true);
  });
});

describe('choosing a move from Maia\'s probabilities', () => {
  const probs: MoveProbability[] = [{ uci: 'e2e4', p: 0.6 }, { uci: 'd2d4', p: 0.3 }, { uci: 'a2a3', p: 0.1 }];
  const pick = (r: number, temperature = 1, topP = 1) => sampleMove(probs, { temperature, topP, rng: () => r })!.uci;

  it('plays each move as often as its probability says', () => {
    expect(pick(0.1)).toBe('e2e4');
    expect(pick(0.7)).toBe('d2d4');
    expect(pick(0.95)).toBe('a2a3');
  });

  it('temperature 0 always plays the likeliest move; top-p cuts off the rare tail', () => {
    expect(pick(0.99, 0)).toBe('e2e4');
    expect(pick(0.99, 1, 0.85)).toBe('d2d4'); // a2a3 is outside the top 85%
  });

  it('never keeps a move the rules do not allow', () => {
    const kept = legalOnly(START_FEN, [{ uci: 'e2e5', p: 0.9 }, { uci: 'g1f3', p: 0.1 }, { uci: 'zz', p: 0.1 }]);
    expect(kept).toEqual([{ uci: 'g1f3', p: 0.1 }]);
    expect(sampleMove([], { temperature: 1, topP: 1 })).toBeNull();
  });
});

describe('a game against a bot (A5, F4)', () => {
  it('the owner and the bot take turns, and the bot never plays an illegal move', async () => {
    const play = make();
    expect(play.start('maia-600', 'white').ok).toBe(true);
    expect(play.game).toMatchObject({ status: 'playing', you: 'white', thinking: false });
    maia.script = ['e7e5'];
    expect(play.move('e2', 'e4').ok).toBe(true);
    await until(() => !play.game.thinking && movesTo(play.game.tree, play.game.focus).length === 2);
    expect(movesTo(play.game.tree, play.game.focus)).toEqual(['e4', 'e5']);
    // Maia is asked at the bot's rating and sees the whole game so far
    expect(maia.seen[0]).toMatchObject({ startFen: START_FEN, moves: ['e2e4'], selfElo: 600, oppoElo: 600 });
    expect(play.move('e7', 'e6').ok).toBe(false); // not a legal move for White
  });

  it('refuses a move while the bot is choosing, and when no game is on', async () => {
    const play = make();
    expect(play.move('e2', 'e4').ok).toBe(false);
    play.start('maia-600', 'black'); // the bot moves first
    expect(play.game.thinking).toBe(true);
    expect(play.move('e7', 'e5').ok).toBe(false);
    await until(() => !play.game.thinking);
    expect(movesTo(play.game.tree, play.game.focus)).toHaveLength(1);
    expect(play.move('e7', 'e5').ok).toBe(true);
  });

  it('ends on checkmate, records the result, and suggests the next bot from the results', async () => {
    const play = make();
    expect(play.botsView().suggested).toBe('maia-600');
    for (let game = 0; game < 2; game++) {
      play.start('maia-600', 'white');
      maia.script = ['e7e5', 'b8c6', 'g8f6']; // walks into Scholar's Mate
      for (const [from, to] of [['e2', 'e4'], ['d1', 'h5'], ['f1', 'c4']] as const) {
        play.move(from, to);
        await until(() => !play.game.thinking);
      }
      play.move('h5', 'f7');
      expect(play.game.status).toBe('over');
      expect(play.game.result).toMatchObject({ winner: 'white', reason: 'checkmate', text: 'Checkmate. You won.' });
    }
    const view = play.botsView();
    expect(view.record.slice(0, 2).map((r) => r.outcome)).toEqual(['win', 'win']);
    expect(view.suggested).toBe('maia-700'); // two wins: one step up
    expect(play.pgn()).toMatch(/\[Result "1-0"\]/);
    expect(play.pgn()).toMatch(/\[Black "Pip \(bot, 600\)"\]/);
  });

  it('takes back the owner\'s last move with the bot\'s reply, and counts it', async () => {
    const play = make();
    play.start('maia-600', 'white');
    expect(play.takeback()).toBe(false); // nothing to take back yet
    play.move('e2', 'e4');
    await until(() => !play.game.thinking);
    play.move('g1', 'f3');
    await until(() => !play.game.thinking);
    expect(movesTo(play.game.tree, play.game.focus)).toHaveLength(4);
    expect(play.takeback()).toBe(true);
    expect(movesTo(play.game.tree, play.game.focus)).toHaveLength(2);
    expect(play.game.takebacks).toBe(1);
    expect(play.move('d2', 'd4').ok).toBe(true);
  });

  it('a takeback while the bot is choosing drops the bot\'s late answer', async () => {
    const play = make();
    play.start('maia-600', 'white');
    play.move('e2', 'e4');
    expect(play.game.thinking).toBe(true);
    expect(play.takeback()).toBe(true);
    await sleep(40);
    expect(movesTo(play.game.tree, play.game.focus)).toEqual([]);
    expect(play.game.thinking).toBe(false);
  });

  it('resigning ends the game as a loss; a new game goes back to the picker', async () => {
    const play = make();
    play.start('maia-900', 'white');
    play.resign();
    expect(play.game).toMatchObject({ status: 'over', result: { winner: 'black', reason: 'resigned' } });
    expect(play.botsView().record[0]).toMatchObject({ bot: 'maia-900', outcome: 'loss' });
    play.fresh();
    expect(play.game.status).toBe('idle');
  });

  it('says so when Maia does not answer, and can try again', async () => {
    const play = make();
    play.start('maia-600', 'white');
    maia.fail = true;
    play.move('e2', 'e4');
    await until(() => !!play.game.problem);
    expect(play.game.problem).toMatch(/Pip could not move/);
    expect(play.game.status).toBe('playing');
    maia.fail = false;
    play.retry();
    await until(() => movesTo(play.game.tree, play.game.focus).length === 2);
    expect(play.game.problem).toBeUndefined();
  });

  it('survives a restart, and the bot moves if it was its turn', async () => {
    const a = make();
    a.start('maia-600', 'white');
    maia.fail = true; // the bot never got its move out before the server stopped
    a.move('e2', 'e4');
    await until(() => !!a.game.problem);
    maia.fail = false;
    const b = make();
    expect(b.game.status).toBe('playing');
    expect(b.game.bot?.name).toBe('Pip');
    expect(movesTo(b.game.tree, b.game.focus)).toEqual(['e4']);
    b.resume();
    await until(() => movesTo(b.game.tree, b.game.focus).length === 2);
  });
});

describe('clocks, draws, and the library (I10; WP 7.3)', () => {
  let now = 1_000_000;
  const timed = (extra: Partial<ConstructorParameters<typeof PlayController>[0]> = {}) =>
    new PlayController({ db, settings: new Settings(db), roster: loadRoster(config.rosterFile), source: maia, onChange: () => void changes++, noDelay: true, rng: () => 0.3, now: () => now, ...extra });
  /** The owner's first legal move, by its squares. */
  const anyMove = (p: PlayController) => legalMoves(mustPosition(p.game.tree.nodes[p.game.focus]!.fen))[0]!;

  it('untimed by default; with a time control each move takes its time and adds the increment', async () => {
    const plain = timed();
    plain.start('maia-600', 'white');
    expect(plain.game.clock).toBeUndefined();
    plain.fresh();
    const p = timed();
    expect(p.start('maia-600', 'white', { base: 600, inc: 5 })).toEqual({ ok: true });
    expect(p.game.clock).toEqual({ white: 600_000, black: 600_000, inc: 5_000, running: 'white', at: now });
    now += 12_000;
    p.move('e2', 'e4');
    await until(() => movesTo(p.game.tree, p.game.focus).length === 2);
    // 600 - 12 + 5 for White; Black answered at once and got its increment
    expect(p.game.clock).toMatchObject({ white: 593_000, black: 605_000, running: 'white' });
    // a takeback hands the clock back to the owner, with what each side has left
    now += 4_000;
    expect(p.takeback()).toBe(true);
    expect(p.game.clock).toMatchObject({ running: 'white', at: now });
    expect(clockLeft(p.game.clock!, 'white', now)).toBe(593_000 - 4_000);
    expect(p.start('maia-600', 'white', { base: 5, inc: 0 })).toEqual({ ok: false, reason: 'That time control is not one the page offers.' });
    p.fresh();
  });

  it('the owner\'s flag falls on time: the bot wins; a move made after it does not count', async () => {
    const finished: { pgn: string; you: string }[] = [];
    const p = timed({ onFinished: (pgn, you) => (finished.push({ pgn, you }), 42) });
    p.start('maia-600', 'white', { base: 60, inc: 0 });
    now += 61_000;
    const m = anyMove(p);
    expect(p.move(m.from, m.to)).toEqual({ ok: true });
    expect(movesTo(p.game.tree, p.game.focus)).toEqual([]);
    expect(p.game).toMatchObject({ status: 'over', result: { winner: 'black', reason: 'time', text: 'Your time ran out. Pip wins on time.' }, libraryId: 42 });
    expect(p.game.clock).toMatchObject({ white: 0, running: undefined });
    // the finished game went to the library, with its clock and date in the PGN
    expect(finished).toHaveLength(1);
    expect(finished[0]!.you).toBe('white');
    expect(finished[0]!.pgn).toMatch(/\[TimeControl "60\+0"\]/);
    expect(finished[0]!.pgn).toMatch(/\[Date "\d{4}\.\d{2}\.\d{2}"\]/);
    expect(finished[0]!.pgn).toMatch(/\[Result "0-1"\]/);
  });

  it('the flag also falls by the timer, with nobody moving', async () => {
    const real = new PlayController({ db, settings: new Settings(db), roster: loadRoster(config.rosterFile), source: maia, onChange: () => void changes++, noDelay: true, rng: () => 0.3 });
    // the shortest control the server takes is one minute; the clock is wound down to 40 ms left
    real.start('maia-600', 'white', { base: 60, inc: 0 });
    real.game.clock = { ...real.game.clock!, white: 40, at: Date.now() };
    real.resume();
    await until(() => real.game.status === 'over');
    expect(real.game.result).toMatchObject({ reason: 'time', winner: 'black' });
  });

  it('the bot\'s flag falls too, when its time is gone before it moves', async () => {
    const slow = new (class extends FakeMaia {
      async probabilities(req: Parameters<FakeMaia['probabilities']>[0]) {
        now += 120_000; // the bot "thinks" for two minutes
        return super.probabilities(req);
      }
    })();
    const p = new PlayController({ db, settings: new Settings(db), roster: loadRoster(config.rosterFile), source: slow, onChange: () => void changes++, noDelay: true, rng: () => 0.3, now: () => now });
    p.start('maia-600', 'white', { base: 60, inc: 0 });
    p.move('e2', 'e4');
    await until(() => p.game.status === 'over');
    expect(p.game.result).toMatchObject({ winner: 'white', reason: 'time', text: "Pip's time ran out. You win on time." });
    expect(movesTo(p.game.tree, p.game.focus)).toEqual(['e4']);
  });

  it('after a restart the clock goes on from where it stopped', () => {
    const a = timed();
    a.start('maia-600', 'white', { base: 600, inc: 0 });
    now += 30_000;
    // the app is off for an hour
    now += 3_600_000;
    const b = timed();
    b.resume();
    expect(b.game.status).toBe('playing');
    expect(b.game.clock).toMatchObject({ running: 'white', at: now });
    expect(clockLeft(b.game.clock!, 'white', now)).toBe(600_000);
    b.fresh();
  });

  it('a draw offer: too early, declined when the bot is better, taken when it is not', async () => {
    let chances = 80;
    const p = timed({ assess: async () => chances });
    p.start('maia-600', 'white');
    expect(await p.draw()).toEqual({ accepted: false, text: 'Pip declines: it is too early in the game for a draw.' });
    // play to the twentieth half-move: the owner's first legal move each time, the bot its own
    while (movesTo(p.game.tree, p.game.focus).length < DRAW_FROM_PLY && p.game.status === 'playing') {
      const m = anyMove(p);
      p.move(m.from, m.to);
      await until(() => !p.game.thinking);
    }
    // the first-legal-move game is still going at the twentieth half-move
    expect(p.game.status).toBe('playing');
    // the engine's chances are for the side to move, the owner: 80 for them is 20 for the bot, which takes it
    chances = 80;
    const r = await p.draw();
    expect(r).toEqual({ accepted: true, text: 'Pip accepts the draw.' });
    expect(p.game).toMatchObject({ status: 'over', result: { reason: 'agreed', text: 'A draw by agreement.' } });
    expect(p.game.result!.winner).toBeUndefined();
  });

  it('declines when it is better', async () => {
    const p = timed({ assess: async () => 20 });
    p.start('maia-600', 'white');
    while (movesTo(p.game.tree, p.game.focus).length < DRAW_FROM_PLY && p.game.status === 'playing') {
      const m = anyMove(p);
      p.move(m.from, m.to);
      await until(() => !p.game.thinking);
    }
    expect(p.game.status).toBe('playing');
    expect(await p.draw()).toEqual({ accepted: false, text: 'Pip declines the draw and plays on.' });
    expect(p.game.status).toBe('playing');
    p.fresh();
  });

  it('a finished game goes into the library with the owner\'s side, its result and its clock', () => {
    const library = new GameLibrary({ db, settings: new Settings(db) });
    const pgn = '[Event "Chess Coach: game against a bot"]\n[Site "Chess Coach"]\n[Date "2026.11.15"]\n[White "Pip (bot, 600)"]\n[Black "You"]\n[Result "0-1"]\n[TimeControl "600+5"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
    const id = library.addPlayed(pgn, 'black')!;
    const g = db.getGame(id)!;
    expect(g).toMatchObject({ you: 'black', outcome: 'win', result: '0-1', white: 'Pip (bot, 600)', black: 'You', timeControl: '10+5' });
    expect(importPgn(g.pgn).ok).toBe(true);
    // added twice, it is the same game
    expect(library.addPlayed(pgn, 'black')).toBe(id);
  });
});

describe('the undo offer after a blunder (A8; WP 7.4)', () => {
  const QUESTION = 'After your move, what checks, captures or attacks did they have?';
  /** A judge that calls the moves in `bad` blunders, after `delay` ms. */
  const judge = (bad: string[], delay = 0) => async (_fen: string, san: string) => {
    if (delay) await sleep(delay);
    return bad.includes(san) ? { blunder: true, what: 'hung your queen', question: QUESTION } : { blunder: false, what: '', question: '' };
  };
  const make2 = (judgeMove?: ReturnType<typeof judge>, settings = new Settings(db)) =>
    new PlayController({ db, settings, roster: loadRoster(config.rosterFile), source: maia, onChange: () => void changes++, noDelay: true, rng: () => 0.3, judgeMove });
  const plies = (p: PlayController) => movesTo(p.game.tree, p.game.focus).length;

  it('a blunder brings the offer once the bot has replied; playing on clears it; taking it back counts as a takeback', async () => {
    const bad = ['Qh5'];
    const p = make2(judge(bad));
    p.start('maia-600', 'white');
    p.move('e2', 'e4');
    await until(() => plies(p) === 2);
    await sleep(20);
    expect(p.game.offer).toBeUndefined();
    p.move('d1', 'h5');
    await until(() => plies(p) === 4 && !!p.game.offer);
    expect(p.game.offer).toEqual({ ply: 3, what: 'hung your queen', question: QUESTION });
    p.playOn();
    expect(p.game.offer).toBeUndefined();
    expect(db.recentEvents('bot_game_offer_declined', 1)).toHaveLength(1);
    // another one, taken this time: the blunder and the bot's reply go back, counted
    const next = legalMoves(mustPosition(p.game.tree.nodes[p.game.focus]!.fen))[0]!;
    bad.push(next.san);
    p.move(next.from, next.to);
    await until(() => !!p.game.offer);
    expect(p.takeOffer()).toBe(true);
    expect(plies(p)).toBe(4);
    expect(p.game).toMatchObject({ takebacks: 1, offer: undefined });
    expect(db.recentEvents('bot_game_offer_taken', 1)).toHaveLength(1);
    expect(p.takeOffer()).toBe(false);
    p.fresh();
  });

  it('no offer with the setting off, for a move that was fine, or when the answer comes after the owner moved on', async () => {
    const settings = new Settings(db);
    settings.set('play.undoOffer', false);
    const off = make2(judge(['e4']), settings);
    off.start('maia-600', 'white');
    off.move('e2', 'e4');
    await until(() => plies(off) === 2);
    await sleep(20);
    expect(off.game.offer).toBeUndefined();
    off.fresh();

    const late = make2(judge(['e4'], 150));
    late.start('maia-600', 'white');
    late.move('e2', 'e4');
    await until(() => plies(late) === 2);
    const m = legalMoves(mustPosition(late.game.tree.nodes[late.game.focus]!.fen))[0]!;
    late.move(m.from, m.to);
    await sleep(250);
    expect(late.game.offer).toBeUndefined();
    late.fresh();
  });
});

describe('the routine overlay in a game (A9; WP 7.5)', () => {
  it("prompts before the owner's moves at the level given, clears when they move, and fades with the level", async () => {
    let level: RoutineLevel = 'every';
    const p = new PlayController({ db, settings: new Settings(db), roster: loadRoster(config.rosterFile), source: maia, onChange: () => void changes++, noDelay: true, rng: () => 0.3, routine: () => ({ level, top: 'missed_threat' }) });
    const plies = () => movesTo(p.game.tree, p.game.focus).length;
    const play = async () => {
      const m = legalMoves(mustPosition(p.game.tree.nodes[p.game.focus]!.fen))[0]!;
      const before = plies();
      p.move(m.from, m.to);
      expect(p.game.prompt).toBeUndefined();
      await until(() => plies() === before + 2);
    };
    p.start('maia-600', 'white');
    // the first move: the step they skip most (their threat)
    expect(p.game.prompt).toBe(ROUTINE_PROMPTS.threat);
    await play();
    // the second: the rest of the routine in turn
    expect(p.game.prompt).toBe(ROUTINE_PROMPTS.options);
    // every other move
    level = 'often';
    await play();
    expect(p.game.prompt).toBe(ROUTINE_PROMPTS.threat);
    await play();
    expect(p.game.prompt).toBeUndefined();
    // the habit has stuck
    level = 'off';
    await play();
    expect(p.game.prompt).toBeUndefined();
    p.fresh();
  });
});

describe('mini-games (F6; WP 7.6)', () => {
  // test mini-games one move from their goal; the real ones are checked as they load
  const minis = [
    { id: 't-promote', name: 'Promote', idea: 'x', about: 'x', fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1', you: 'white' as const, goal: { kind: 'promote' as const } },
    { id: 't-stop', name: 'Stop', idea: 'x', about: 'x', fen: '4k3/8/8/8/8/8/p7/4K3 b - - 0 1', you: 'white' as const, goal: { kind: 'stop' as const } },
    { id: 't-mate', name: 'Mate', idea: 'x', about: 'x', fen: '7k/8/6K1/8/8/8/Q7/8 w - - 0 1', you: 'white' as const, goal: { kind: 'mate' as const, within: 1 } },
  ];
  const finished: string[] = [];
  const makeMini = () => new PlayController({ db, settings: new Settings(db), roster: loadRoster(config.rosterFile), source: maia, onChange: () => void changes++, noDelay: true, rng: () => 0.3, minis, onFinished: (pgn) => (finished.push(pgn), 1) });

  it('the content file loads, every game in it with a legal position and a goal', () => {
    const real = loadMinis(path.join(config.repoRoot, 'content', 'minigames.json'));
    expect(real.map((m) => m.id)).toEqual(['pawn-war', 'queen-vs-pawns', 'two-rook-mate', 'rook-mate']);
    const p = new PlayController({ db, settings: new Settings(db), roster: loadRoster(config.rosterFile), source: maia, onChange: () => {}, noDelay: true, minis: real });
    expect(p.botsView().minis[0]).toMatchObject({ id: 'pawn-war', name: 'Pawn war', you: 'white', goal: 'Make a queen first.' });
  });

  it('end to end: the goal reached wins, a pawn through loses, no mate in time loses; none of them go to the library or the record', async () => {
    const p = makeMini();
    expect(p.startMini('t-promote')).toEqual({ ok: true });
    expect(p.game).toMatchObject({ status: 'playing', you: 'white', mini: { id: 't-promote', name: 'Promote', goal: 'Make a queen first.' } });
    p.move('a7', 'a8', 'queen');
    expect(p.game).toMatchObject({ status: 'over', result: { winner: 'white', reason: 'goal', text: 'You made a queen first. You win.' } });
    expect(p.game.libraryId).toBeUndefined();
    // the bot moves first here, and its pawn goes through
    maia.script = ['a2a1q'];
    p.startMini('t-stop');
    await until(() => p.game.status === 'over');
    expect(p.game.result).toMatchObject({ winner: 'black', reason: 'goal', text: 'A pawn got through and became a queen.' });
    // one move to mate: a quiet move instead
    p.startMini('t-mate');
    p.move('a2', 'b2');
    expect(p.game.result).toMatchObject({ winner: 'black', reason: 'goal', text: 'No mate within 1 move. Try it again.' });
    p.startMini('t-mate');
    p.move('a2', 'a8');
    expect(p.game.result).toMatchObject({ winner: 'white', reason: 'checkmate' });
    expect(finished).toEqual([]);
    expect(p.botsView().record).toEqual([]);
    expect(p.startMini('nope')).toEqual({ ok: false, reason: 'There is no such mini-game.' });
  });
});

describe('engine-style bots (WP 7.8)', () => {
  it('are hidden unless switched on, and then play through their own move source', async () => {
    const engineCalls: number[] = [];
    const engineSource = new (class extends FakeMaia {
      async probabilities(req: Parameters<FakeMaia['probabilities']>[0]) {
        engineCalls.push(req.selfElo);
        return super.probabilities(req);
      }
    })();
    const settings = new Settings(db);
    const p = new PlayController({ db, settings, roster: loadRoster(config.rosterFile), source: maia, engineSource, onChange: () => {}, noDelay: true, rng: () => 0.3 });
    expect(p.botsView().bots.some((b) => b.kind === 'engine')).toBe(false);
    settings.set('play.engineBots', true);
    const cog = p.botsView().bots.find((b) => b.id === 'engine-1400')!;
    expect(cog).toMatchObject({ name: 'Cog', kind: 'engine', band: 'Engine-style' });
    p.start('engine-1400', 'white');
    p.move('e2', 'e4');
    await until(() => movesTo(p.game.tree, p.game.focus).length === 2);
    expect(engineCalls).toEqual([1400]);
    expect(maia.seen).toEqual([]);
    p.fresh();
  });
});
