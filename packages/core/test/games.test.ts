import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EARLY,
  START_FEN,
  boardKey,
  fromChessCom,
  fromLichess,
  fromPgn,
  guardPath,
  guardPosition,
  guardText,
  guardTree,
  importPgn,
  ongoingFromChessCom,
  ongoingFromLichess,
  outcomeOf,
  parseGameLink,
  playLine,
  readTimeControl,
  speedOf,
  type ChessComGame,
  type LichessGame,
  type OngoingGame,
} from '../src/index.ts';

// Real answers of the two sites' public APIs, fetched once, with every player's name replaced
// (the owner is "OwnerLichess" / "OwnerChessCom"). PLAN WP 5.1: recorded API answers as fixtures.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'import');
const lichess = readFileSync(path.join(dir, 'lichess.ndjson'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as LichessGame);
const month = (JSON.parse(readFileSync(path.join(dir, 'chesscom-2026-10.json'), 'utf8')) as { games: ChessComGame[] }).games;
const ongoingRaw = (JSON.parse(readFileSync(path.join(dir, 'chesscom-ongoing.json'), 'utf8')) as { games: ChessComGame[] }).games;
const li = (id: string) => lichess.find((g) => g.id === id)!;

describe('a Lichess game', () => {
  it('is read with its players, ratings, result, speed and moves', () => {
    const r = fromLichess(li('aaaa1111'), 'ownerlichess');
    if (!r.ok) throw new Error(r.reason);
    expect(r.game).toMatchObject({
      site: 'lichess',
      siteId: 'aaaa1111',
      url: 'https://lichess.org/aaaa1111',
      white: 'OwnerLichess',
      black: 'rival_one',
      whiteRating: 912,
      whiteDiff: 9,
      blackRating: 930,
      you: 'white',
      result: '1-0',
      ending: 'resignation',
      timeClass: 'rapid',
      timeControl: '10+5',
      rated: true,
      eco: 'A50',
    });
    expect(r.game.moves).toHaveLength(91);
    expect(r.game.moves.slice(0, 3)).toEqual(['d4', 'Nf6', 'c4']);
    expect(outcomeOf(r.game)).toBe('win');
    expect(r.game.playedAt).toBe(new Date(li('aaaa1111').lastMoveAt!).toISOString());
  });

  it('knows which side the owner had, a draw, and a correspondence game', () => {
    const b = fromLichess(li('bbbb2222'), 'OwnerLichess');
    expect(b.ok && b.game.you).toBe('black');
    expect(b.ok && outcomeOf(b.game)).toBe('win');
    expect(b.ok && b.game.timeClass).toBe('classical');
    const c = fromLichess(li('cccc3333'), 'OwnerLichess');
    expect(c.ok && [c.game.timeClass, c.game.timeControl]).toEqual(['daily', '3 days per move']);
    const g = fromLichess(li('gggg7777'), 'OwnerLichess');
    expect(g.ok && [g.game.result, g.game.ending, outcomeOf(g.game)]).toEqual(['1/2-1/2', 'draw', 'draw']);
    // someone else's game has no "you"
    const other = fromLichess(li('aaaa1111'), 'nobody');
    expect(other.ok && other.game.you).toBeUndefined();
  });

  it('is refused while it is being played, when it is a variant, and when nothing was played', () => {
    expect(fromLichess(li('eeee5555'), 'OwnerLichess')).toMatchObject({ ok: false, why: 'unfinished', siteId: 'eeee5555' });
    expect(fromLichess(li('dddd4444'), 'OwnerLichess')).toMatchObject({ ok: false, why: 'variant' });
    expect(fromLichess(li('ffff6666'), 'OwnerLichess')).toMatchObject({ ok: false, why: 'empty' });
    // a status this app has never seen is not taken for a finished game
    expect(fromLichess({ ...li('aaaa1111'), status: 'somethingNew' })).toMatchObject({ ok: false, why: 'unfinished' });
    expect(fromLichess({} as LichessGame)).toMatchObject({ ok: false, why: 'unreadable' });
  });
});

describe('a Chess.com game', () => {
  const by = (test: (g: ChessComGame) => boolean) => month.find(test)!;

  it('is read with its players, ratings, result, speed and moves', () => {
    const r = fromChessCom(by((g) => g.url!.endsWith('/daily/900000001')), 'ownerchesscom');
    if (!r.ok) throw new Error(r.reason);
    expect(r.game).toMatchObject({
      site: 'chesscom',
      siteId: 'daily/900000001',
      white: 'rival_a',
      black: 'OwnerChessCom',
      whiteRating: 1487,
      blackRating: 1500,
      you: 'black',
      result: '1-0',
      ending: 'resignation',
      timeClass: 'daily',
      timeControl: '7 days per move',
      rated: false,
      eco: 'B07',
      opening: 'Pirc Defense',
    });
    expect(outcomeOf(r.game)).toBe('loss');
    expect(r.game.moves.slice(0, 4)).toEqual(['e4', 'd6', 'd3', 'Nf6']);
    expect(r.game.playedAt).toBe('2026-10-01T08:59:41.000Z');
  });

  it('reads a live game, a draw, and refuses a variant', () => {
    const rapid = fromChessCom(by((g) => g.time_class === 'rapid'), 'OwnerChessCom');
    expect(rapid.ok && [rapid.game.siteId.split('/')[0], rapid.game.timeClass, rapid.game.timeControl, outcomeOf(rapid.game)]).toEqual(['live', 'rapid', '10+0', 'win']);
    const drawn = fromChessCom(by((g) => g.white?.result === 'agreed'), 'OwnerChessCom');
    expect(drawn.ok && [drawn.game.result, drawn.game.ending, outcomeOf(drawn.game)]).toEqual(['1/2-1/2', 'draw agreed', 'draw']);
    expect(fromChessCom(by((g) => g.rules === 'chess960'), 'OwnerChessCom')).toMatchObject({ ok: false, why: 'variant' });
  });

  it('a game in progress is refused: it has no result', () => {
    for (const g of ongoingRaw) expect(fromChessCom(g, 'OwnerChessCom')).toMatchObject({ ok: false, why: 'unfinished' });
    // and a result code this app does not know is not guessed at
    const odd = { ...by((g) => g.time_class === 'rapid'), white: { username: 'a', result: 'win' }, black: { username: 'b', result: 'somethingNew' } };
    expect(fromChessCom(odd)).toMatchObject({ ok: false, why: 'unreadable' });
  });
});

describe('a pasted PGN', () => {
  const pgn = (result: string, extra = '') => `[Event "Rated Rapid game"]\n[Site "https://lichess.org/AbCd1234"]\n[Date "2026.11.01"]\n[White "Me"]\n[Black "Them"]\n[Result "${result}"]\n[WhiteElo "812"]\n[BlackElo "840"]\n[TimeControl "600+5"]\n[Termination "Normal"]\n${extra}\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# ${result}`;

  it('is read like a game from a site, and the site is told from its headers', () => {
    const r = fromPgn(pgn('1-0'), ['me']);
    if (!r.ok) throw new Error(r.reason);
    expect(r.game).toMatchObject({ site: 'lichess', siteId: 'AbCd1234', white: 'Me', black: 'Them', you: 'white', result: '1-0', ending: 'checkmate', timeClass: 'rapid', timeControl: '10+5', rated: true, whiteRating: 812 });
    expect(r.game.moves).toEqual(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
    const cc = fromPgn(pgn('1-0', '[Link "https://www.chess.com/game/live/123456"]').replace('https://lichess.org/AbCd1234', 'Chess.com'), []);
    expect(cc.ok && [cc.game.site, cc.game.siteId]).toEqual(['chesscom', 'live/123456']);
  });

  it('with no site gets an id of its own: the same game pasted twice is the same game', () => {
    const bare = '[White "A"]\n[Black "B"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
    const a = fromPgn(bare, []);
    const b = fromPgn(`${bare}\n`, []);
    expect(a.ok && b.ok && a.game.site === 'pgn' && a.game.siteId === b.game.siteId).toBe(true);
    const c = fromPgn(bare.replace('"A"', '"C"'), []);
    expect(a.ok && c.ok && a.game.siteId !== c.game.siteId).toBe(true);
  });

  it('is refused when it is unfinished, has no result, has no moves, or is not standard chess', () => {
    expect(fromPgn(pgn('*'), [])).toMatchObject({ ok: false, why: 'unfinished' });
    expect(fromPgn('1. e4 e5 2. Nf3', [])).toMatchObject({ ok: false, why: 'unfinished' });
    expect(fromPgn('[Result "1-0"]\n\n1-0', [])).toMatchObject({ ok: false, why: 'empty' });
    expect(fromPgn(pgn('1-0', '[Variant "Chess960"]'), [])).toMatchObject({ ok: false, why: 'variant' });
    expect(fromPgn('[FEN "8/8/8/8/8/4k3/8/4K2R w - - 0 1"]\n[SetUp "1"]\n[Result "1-0"]\n\n1. Rh3+ 1-0', [])).toMatchObject({ ok: false, why: 'variant' });
    expect(fromPgn('', [])).toMatchObject({ ok: false });
  });
});

describe('time controls and links', () => {
  it('speeds follow each site', () => {
    expect([speedOf(60, 0), speedOf(180, 0), speedOf(300, 3), speedOf(600, 0), speedOf(900, 10), speedOf(1800, 0)]).toEqual(['bullet', 'blitz', 'blitz', 'rapid', 'rapid', 'classical']);
    expect([speedOf(180, 0, 'chesscom'), speedOf(600, 0, 'chesscom'), speedOf(1800, 0, 'chesscom')]).toEqual(['blitz', 'rapid', 'rapid']);
    expect(readTimeControl('1/86400')).toEqual({ text: '1 day per move', timeClass: 'daily' });
    expect(readTimeControl('900+10')).toEqual({ text: '15+10', timeClass: 'rapid' });
    expect(readTimeControl(undefined).timeClass).toBe('unknown');
  });

  it('a link to a game is recognised on both sites', () => {
    expect(parseGameLink('https://lichess.org/AbCd1234')).toEqual({ site: 'lichess', siteId: 'AbCd1234' });
    expect(parseGameLink('lichess.org/AbCd1234efgh')).toEqual({ site: 'lichess', siteId: 'AbCd1234' });
    expect(parseGameLink('https://lichess.org/AbCd1234/black#42')).toEqual({ site: 'lichess', siteId: 'AbCd1234' });
    expect(parseGameLink('https://www.chess.com/game/live/800000001')).toEqual({ site: 'chesscom', siteId: 'live/800000001' });
    expect(parseGameLink('https://www.chess.com/game/daily/99?tab=review')).toEqual({ site: 'chesscom', siteId: 'daily/99' });
    expect(parseGameLink('https://lichess.org/training/12345')).toBeNull();
    expect(parseGameLink('1. e4 e5')).toBeNull();
  });
});

// PLAN WP 5.2: a fixture Daily game in progress is refused by every route.
describe('the fair-play guard', () => {
  const ongoing = ongoingRaw.map((g) => ongoingFromChessCom(g)).filter((g): g is OngoingGame => !!g);
  const long = ongoing.find((g) => g.siteId === 'daily/900000011')!;
  const liveFen = (ongoingRaw[0] as { fen: string }).fen;

  it('reads the list of games in progress', () => {
    expect(ongoing).toHaveLength(2);
    expect(long).toMatchObject({ site: 'chesscom', white: 'ownerchesscom', black: 'rival_live' });
    expect(long.keys[0]).toBe(boardKey(START_FEN));
    expect(long.keys.at(-1)).toBe(boardKey(liveFen));
    expect(long.keys.length).toBeGreaterThan(60);
    const l = ongoingFromLichess({ id: 'zzzz9999', variant: 'standard', moves: 'e4 e5 Nf3', players: { white: { user: { name: 'OwnerLichess' } }, black: { user: { name: 'x' } } } });
    expect(l?.keys).toHaveLength(4);
    expect(ongoingFromLichess({ id: 'zzzz9999', variant: 'chess960', moves: '' })).toBeNull();
  });

  it('the position a game stands in now is refused, whatever the move counters say', () => {
    expect(guardPosition(liveFen, ongoing)).toMatchObject({ how: 'now', game: { siteId: 'daily/900000011' } });
    expect(guardPosition(liveFen.replace(/ 2 37$/, ' 0 1'), ongoing)?.how).toBe('now');
    // the same pieces with the other side to move is another position
    expect(guardPosition(liveFen.replace(' b ', ' w '), ongoing)).toBeNull();
    expect(guardText(guardPosition(liveFen, ongoing)!)).toMatch(/game in progress on Chess\.com.*Fair play/);
  });

  it('an earlier position of the game is refused once the opening moves are behind, and never the start', () => {
    const tree = importPgn((ongoingRaw[0] as { pgn: string }).pgn);
    if (!tree.ok) throw new Error(tree.reason);
    const line = Object.values(tree.tree.nodes).sort((a, b) => a.ply - b.ply);
    expect(guardPosition(START_FEN, ongoing)).toBeNull();
    expect(guardPosition(line[4]!.fen, ongoing)).toBeNull();
    expect(guardPosition(line[EARLY]!.fen, ongoing)?.how).toBe('earlier');
    expect(guardPosition(line[40]!.fen, ongoing)?.how).toBe('earlier');
  });

  it('a game that has only just begun blocks its own position, not the openings around it', () => {
    const young = ongoingFromLichess({ id: 'yyyy0000', variant: 'standard', moves: 'e4 e5 Nf3', players: {} })!;
    const r = playLine(START_FEN, ['e4', 'e5', 'Nf3', 'Nc6']);
    if (!r.ok) throw new Error('setup');
    expect(guardPosition(r.fens[3]!, [young])?.how).toBe('now');
    expect(guardPosition(r.fens[2]!, [young])).toBeNull();
    // one move on from the live position: the path there goes through it
    expect(guardPosition(r.fens[4]!, [young])).toBeNull();
    expect(guardPath(r.fens, [young])?.how).toBe('now');
    expect(guardPath(r.fens.slice(0, 3), [young])).toBeNull();
    expect(guardPath([], [young])).toBeNull();
  });

  it('loading the game in progress is refused: by its address, by its moves, or as a part of it', () => {
    const pgn = (ongoingRaw[0] as { pgn: string }).pgn;
    const asFinished = importPgn(pgn.replace('[Result "*"]', '[Result "1-0"]'));
    if (!asFinished.ok) throw new Error(asFinished.reason);
    // the same game with a made-up result: caught by its address
    expect(guardTree(asFinished.tree, ongoing)?.game.siteId).toBe('daily/900000011');
    // with the headers stripped: caught by its positions
    const moves = pgn.slice(pgn.indexOf('\n\n'));
    const bare = importPgn(moves);
    if (!bare.ok) throw new Error(bare.reason);
    expect(guardTree(bare.tree, ongoing)).not.toBeNull();
    // only its first twelve moves
    const part = importPgn(moves.split(/\s13\.\s/)[0]!);
    if (!part.ok) throw new Error(part.reason);
    expect(Object.keys(part.tree.nodes).length).toBe(25);
    expect(guardTree(part.tree, ongoing)?.how).toBe('earlier');
    // a set-up position from it
    const setUp = importPgn(liveFen);
    expect(setUp.ok && guardTree(setUp.tree, ongoing)?.how).toBe('now');
  });

  it('a finished game that shares its opening with the game in progress loads, and is silent only where they overlap', () => {
    const pgn = (ongoingRaw[0] as { pgn: string }).pgn;
    const moves = pgn.slice(pgn.indexOf('\n\n'));
    // the same first twelve moves, then its own way to a finish
    const shared = importPgn(`${moves.split(/\s13\.\s/)[0]!} 13. a3 a6 14. h3 h6 1-0`);
    if (!shared.ok) throw new Error(shared.reason);
    expect(guardTree(shared.tree, ongoing)).toBeNull();
    const line = Object.values(shared.tree.nodes).sort((a, b) => a.ply - b.ply).map((n) => n.fen);
    expect(guardPath(line.slice(0, 5), ongoing)).toBeNull();
    expect(guardPath(line.slice(0, 13), ongoing)?.how).toBe('earlier');
    expect(guardPath(line.slice(0, 25), ongoing)?.how).toBe('earlier');
    // once it has left the game in progress, the engine may speak again
    expect(guardPath(line.slice(0, 26), ongoing)).toBeNull();
    expect(guardPath(line, ongoing)).toBeNull();
  });

  it('another game is let through, even one that starts the same way', () => {
    const other = importPgn('1. e4 b6 2. d4 Bb7 3. Bd3 g6 4. Nf3 Bg7 5. O-O d6 6. c3 Nd7 7. Re1 e5 8. Na3 Ne7 1-0');
    if (!other.ok) throw new Error(other.reason);
    expect(guardTree(other.tree, ongoing)).toBeNull();
    expect(guardTree(other.tree, [])).toBeNull();
  });
});
