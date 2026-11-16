import { describe, expect, it } from 'vitest';
import { Db } from '../src/db.ts';
import { GameLibrary } from '../src/library.ts';
import { Settings } from '../src/settings.ts';
import { NOW, fakeSites, ongoingCc } from './fake-sites.ts';

function setup(accounts: { lichess?: string; chesscom?: string } = { lichess: 'OwnerLichess', chesscom: 'OwnerChessCom' }) {
  const db = new Db(':memory:');
  const settings = new Settings(db);
  if (accounts.lichess) settings.set('accounts.lichess', accounts.lichess);
  if (accounts.chesscom) settings.set('accounts.chesscom', accounts.chesscom);
  const sites = fakeSites();
  let changes = 0;
  const library = new GameLibrary({ db, settings, http: sites.http, now: () => NOW, onChange: () => changes++ });
  return { db, settings, sites, library, changes: () => changes };
}

describe('syncing the owner\'s games', () => {
  it('brings in the finished Rapid, Classical and Daily games from both sites, with ratings and results', async () => {
    const { library, db } = setup();
    const r = await library.sync();
    expect(r.problems).toEqual([]);
    // Lichess: the rapid, the classical and the correspondence game; not the variant, the game in progress, the aborted one or the blitz
    // Chess.com: two Daily games, a rapid and a draw from October, one from November; not the Chess960 game
    expect(r.added).toEqual({ lichess: 3, chesscom: 4 });
    expect(r.text).toBe('7 new games: 3 from Lichess, 4 from Chess.com.');
    const v = library.view();
    expect(v.total).toBe(7);
    expect(v.games).toHaveLength(7);
    expect(v.games.every((g) => g.you)).toBe(true);
    expect(v.record).toEqual({ win: 5, loss: 1, draw: 1 });
    expect(new Set(v.games.map((g) => g.timeClass))).toEqual(new Set(['rapid', 'classical', 'daily']));
    // newest first
    expect(v.games.map((g) => g.playedAt)).toEqual(v.games.map((g) => g.playedAt).sort().reverse());
    const lichess = v.accounts.find((a) => a.site === 'lichess')!;
    expect(lichess).toMatchObject({ user: 'OwnerLichess', state: 'ok', games: 3, ongoing: 1 });
    expect(lichess.ratings.rapid).toBe(921); // 912 before the game, +9
    expect(lichess.lastSync).toBeTruthy();
    const cc = v.accounts.find((a) => a.site === 'chesscom')!;
    expect(cc).toMatchObject({ state: 'ok', games: 4, ongoing: 2 });
    expect(cc.ratings.rapid).toBe(1713);
    // a stored game has everything needed to put it on the board
    const one = db.getGame(v.games[0]!.id)!;
    expect(one.pgn).toContain('[Result "');
    expect(db.recentEvents('sync', 1)).toHaveLength(1);
  });

  it('importing twice adds nothing, and asks the sites for less', async () => {
    const { library, sites } = setup();
    await library.sync();
    const before = sites.calls.length;
    const again = await library.sync();
    expect(again.added).toEqual({ lichess: 0, chesscom: 0 });
    expect(again.text).toBe('No new games.');
    expect(library.view().total).toBe(7);
    const second = sites.calls.slice(before);
    // October is over: it is not asked for again. November is asked for with its tag, and has not changed
    expect(second.some((c) => c.url.endsWith('/games/2026/10'))).toBe(false);
    expect(second.find((c) => c.url.endsWith('/games/2026/11'))?.headers['If-None-Match']).toBe('W/"2026-11"');
    // nothing personal travels: a generic client and the public name only
    for (const c of sites.calls) expect(Object.keys(c.headers).every((h) => ['Accept', 'If-None-Match'].includes(h))).toBe(true);
  });

  it('what is imported follows the settings, and changing them fetches again', async () => {
    const { library, settings } = setup();
    await library.sync();
    settings.set('import.speeds', 'all');
    library.accountsChanged();
    const r = await library.sync();
    expect(r.added).toEqual({ lichess: 1, chesscom: 0 }); // the blitz draw
    expect(library.view().total).toBe(8);

    const rated = setup();
    rated.settings.set('import.casual', false);
    await rated.library.sync();
    expect(rated.library.view().games.every((g) => g.rated)).toBe(true);
    expect(rated.library.view().total).toBe(5);

    const recent = setup();
    recent.settings.set('import.monthsBack', 1);
    await recent.library.sync();
    // only what ended in the last month: both sites' October games from before the 15th are out
    expect(recent.library.view().games.every((g) => Date.parse(g.playedAt) > NOW - 31 * 24 * 3600 * 1000)).toBe(true);
  });

  it('says so in plain words when a name is unknown, a site asks for a pause, or the network is down', async () => {
    const unknown = setup({ lichess: 'nobody' });
    const r = await unknown.library.sync();
    expect(r.problems).toEqual(['Lichess has no player called "nobody".']);
    expect(unknown.library.view().accounts[0]).toMatchObject({ state: 'error', problem: 'Lichess has no player called "nobody".' });

    const busy = setup();
    busy.sites.status.set('/games/archives', 429);
    const b = await busy.library.sync();
    expect(b.added.lichess).toBe(3);
    expect(b.problems[0]).toMatch(/Chess\.com asked for a pause/);
    expect(b.text).toMatch(/^3 new games: 3 from Lichess\. Chess\.com asked for a pause/);

    const down = setup();
    down.sites.fail.add('lichess.org');
    const d = await down.library.sync();
    expect(d.problems[0]).toMatch(/Lichess could not be reached/);
    expect(d.added.chesscom).toBe(4);

    const none = setup({});
    expect((await none.library.sync()).text).toMatch(/Enter your name/);
    expect(none.sites.calls).toEqual([]);
  });
});

describe('the games in progress, for the fair-play guard', () => {
  const liveFen = ongoingCc.games[0]!.fen;

  it('are read from both sites, kept in the database, and guard the board', async () => {
    const { library, db, settings, sites } = setup();
    expect(library.ongoing).toEqual([]);
    await library.refreshOngoing();
    expect(library.ongoing.map((g) => `${g.site}:${g.siteId}`).sort()).toEqual(['chesscom:daily/900000011', 'chesscom:daily/900000012', 'lichess:live0001']);
    expect(library.guard([liveFen])?.how).toBe('now');
    expect(library.notice()).toBeUndefined();
    // a new start has the list at once, before any site has answered
    const next = new GameLibrary({ db, settings, http: sites.http, now: () => NOW });
    expect(next.guard([liveFen])?.game.siteId).toBe('daily/900000011');
  });

  it('a standing notice says when they cannot be checked', async () => {
    const none = setup({});
    expect(none.library.notice()).toMatch(/Enter your Lichess and Chess\.com names/);
    const fresh = setup();
    expect(fresh.library.notice()).toMatch(/games in progress on Lichess and Chess\.com could not be checked yet/);
    fresh.sites.fail.add('api.chess.com');
    await fresh.library.refreshOngoing();
    expect(fresh.library.notice()).toMatch(/on Chess\.com could not be checked \(Chess\.com could not be reached/);
    expect(fresh.library.view().accounts.find((a) => a.site === 'chesscom')?.ongoingProblem).toMatch(/could not be reached/);
    fresh.sites.fail.clear();
    await fresh.library.refreshOngoing();
    expect(fresh.library.notice()).toBeUndefined();
  });

  it('a site that stops answering keeps its last list', async () => {
    const { library, sites } = setup();
    await library.refreshOngoing();
    sites.fail.add('api.chess.com');
    await library.refreshOngoing();
    expect(library.ongoing.filter((g) => g.site === 'chesscom')).toHaveLength(2);
    expect(library.guard([liveFen])).not.toBeNull();
  });

  it('removing a name removes its list', async () => {
    const { library, settings } = setup();
    await library.refreshOngoing();
    settings.set('accounts.chesscom', '');
    library.accountsChanged();
    expect(library.ongoing.map((g) => g.site)).toEqual(['lichess']);
    expect(library.guard([liveFen])).toBeNull();
  });
});

describe('adding a game by hand', () => {
  const finished = '[Event "Rated Rapid game"]\n[Site "https://lichess.org/QwErTy12"]\n[Date "2026.11.01"]\n[White "OwnerLichess"]\n[Black "someone"]\n[Result "1-0"]\n[TimeControl "600+5"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';

  it('a pasted PGN is added once, with the owner\'s side known', async () => {
    const { library, db } = setup();
    const r = await library.importText(finished);
    expect(r).toMatchObject({ ok: true, added: 1, already: 0, text: '1 game added.' });
    const id = r.ok ? r.id! : 0;
    expect(db.getGame(id)).toMatchObject({ site: 'lichess', siteId: 'QwErTy12', you: 'white', outcome: 'win', ending: 'checkmate', plies: 7 });
    expect(await library.importText(finished)).toMatchObject({ ok: true, added: 0, already: 1, id });
    // several games in one paste
    const two = await library.importText(`${finished.replace('QwErTy12', 'AsDfGh34')}\n\n${finished.replace('QwErTy12', 'ZxCvBn56')}`);
    expect(two).toMatchObject({ ok: true, added: 2 });
    expect(library.view().total).toBe(3);
  });

  it('a game in progress is refused, whatever its PGN claims', async () => {
    const { library } = setup();
    await library.refreshOngoing();
    expect(await library.importText(finished.replace(/1-0/g, '*'))).toMatchObject({ ok: false, reason: expect.stringMatching(/still in progress/) });
    const live = ongoingCc.games[0]!.pgn;
    expect(await library.importText(live)).toMatchObject({ ok: false, reason: expect.stringMatching(/still in progress/) });
    // the same game with a result written in by hand
    expect(await library.importText(live.replace('[Result "*"]', '[Result "1-0"]').replace(/\*\s*$/, '1-0'))).toMatchObject({ ok: false, reason: expect.stringMatching(/one of your games in progress/) });
    expect(library.view().total).toBe(0);
  });

  it('a link to a Lichess game fetches it; one that is still being played is refused', async () => {
    const { library } = setup();
    const r = await library.importText('https://lichess.org/gggg7777/black');
    expect(r).toMatchObject({ ok: true, added: 1 });
    expect(await library.importText('https://lichess.org/gggg7777')).toMatchObject({ ok: true, already: 1 });
    expect(await library.importText('https://lichess.org/eeee5555')).toMatchObject({ ok: false, reason: expect.stringMatching(/still in progress/) });
    expect(await library.importText('https://lichess.org/nothere1')).toMatchObject({ ok: false, reason: 'Lichess has no game at that address.' });
  });

  it('a link to a Chess.com game is found among the owner\'s games there', async () => {
    const { library } = setup();
    expect(await library.importText('https://www.chess.com/game/daily/900000001')).toMatchObject({ ok: true, added: 1 });
    expect(await library.importText('https://www.chess.com/game/live/42')).toMatchObject({ ok: false, reason: expect.stringMatching(/not among your finished games/) });
    const anon = setup({});
    expect(await anon.library.importText('https://www.chess.com/game/daily/900000001')).toMatchObject({ ok: false, reason: expect.stringMatching(/enter your Chess\.com name/) });
  });

  it('nonsense is refused with a reason', async () => {
    const { library } = setup();
    expect(await library.importText('   ')).toMatchObject({ ok: false });
    expect(await library.importText('hello there')).toMatchObject({ ok: false });
  });
});
