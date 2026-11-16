// The owner's games: fetched from the two sites, kept in the database, and the list of games
// still in progress that the fair-play guard reads (ARCHITECTURE §12; features B1, B2, B8, G1, H10).
//
// Sync runs when the app opens and on a timer (a setting), and whenever the owner asks. Importing
// is idempotent: the site's game id is the key, so fetching the same game again adds nothing.
// Only finished games are stored. The list of games in progress is refreshed more often than the
// games themselves, and it is kept in the database so the guard works from the first second.

import {
  fromChessCom,
  fromLichess,
  fromPgn,
  guardPath,
  outcomeOf,
  guardTree,
  importPgn,
  ongoingFromChessCom,
  ongoingFromLichess,
  buildProfile,
  parseGameLink,
  STEP_HABIT,
  type AccountView,
  type Color,
  type GuardHit,
  type ImportOutcome,
  type LibraryView,
  type MoveTree,
  type OngoingGame,
  type TimeClass,
} from '@chess-coach/core';
import type { Db } from './db.ts';
import { SITE_NAME, SiteError, chessComMonth, chessComMonths, chessComOngoing, lichessFinished, lichessGame, lichessOngoing, realHttp, validUser, type Http, type Site } from './importers.ts';
import type { Settings } from './settings.ts';

const SITES: Site[] = ['lichess', 'chesscom'];
const DAY = 24 * 60 * 60 * 1000;
/** the list of games in progress is read again when it is this old */
const ONGOING_EVERY_MS = 5 * 60 * 1000;
/** games a Lichess request asks for, and how many requests one sync makes at most */
const LICHESS_PAGE = 300;
const LICHESS_PAGES = 4;
/** a Daily game can take months: finished ones are looked for this far back on every sync */
const DAILY_WINDOW_MS = 180 * DAY;

const SPEEDS: Record<string, TimeClass[]> = { slow: ['rapid', 'classical', 'daily'], slow_blitz: ['rapid', 'classical', 'daily', 'blitz'], all: ['rapid', 'classical', 'daily', 'blitz', 'bullet', 'unknown'] };
const LICHESS_PERF: Partial<Record<TimeClass, string[]>> = { rapid: ['rapid'], classical: ['classical'], blitz: ['blitz'], bullet: ['bullet', 'ultraBullet'] };

export type SyncReport = { added: Record<Site, number>; problems: string[]; text: string };
export type ImportReport = { ok: true; added: number; already: number; id?: number; text: string } | { ok: false; reason: string };

type SiteStatus = { syncing: boolean; problem?: string; ongoingProblem?: string };
/** a note in sync_state, stamped with this library's own clock (the tests run it on a fixed one) */
type Stamp = { user: string; at: number };

export class GameLibrary {
  /** the owner's games in progress on both sites, as last read */
  ongoing: OngoingGame[];
  private readonly db: Db;
  private readonly settings: Settings;
  private readonly http: Http;
  private readonly onChange: () => void;
  private readonly log: (msg: string) => void;
  private readonly now: () => number;
  private status: Record<Site, SiteStatus> = { lichess: { syncing: false }, chesscom: { syncing: false } };
  private running: Promise<SyncReport> | null = null;
  private checking: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastAuto = 0;
  /** when the list of games in progress was last asked for, answered or not: a site that is down is not asked again at once */
  private lastCheck = Number.NEGATIVE_INFINITY;

  constructor(opts: { db: Db; settings: Settings; http?: Http; onChange?: () => void; log?: (msg: string) => void; now?: () => number }) {
    this.db = opts.db;
    this.settings = opts.settings;
    this.http = opts.http ?? realHttp;
    this.onChange = opts.onChange ?? (() => {});
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.ongoing = this.db.ongoing();
  }

  /** The owner's name on a site, or '' when they have not entered one. */
  user(site: Site): string {
    const name = this.settings.get<string>(`accounts.${site}`).trim();
    return validUser(name) ? name : '';
  }

  // ---------------------------------------------------------------- the timer

  /** Begin syncing by itself: once now, then as the settings say. */
  start() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    try {
      if (!SITES.some((s) => this.user(s))) return;
      const every = this.settings.get<number>('import.everyMinutes') * 60_000;
      if (this.settings.get<boolean>('import.auto') && this.now() - this.lastAuto >= every) {
        this.lastAuto = this.now();
        await this.sync(); // reads the games in progress as well
      } else if (this.ongoingAge() >= ONGOING_EVERY_MS) await this.refreshOngoing();
    } catch (e) {
      this.log(`game sync failed: ${(e as Error).message}`);
    }
  }

  /** The owner changed an account or what is imported: start over, so nothing is missed. */
  accountsChanged() {
    for (const site of SITES) {
      this.status[site] = { syncing: false };
      if (!this.user(site)) {
        this.db.setOngoing(site, []);
        this.db.syncSet(`ongoing:${site}`, null);
      }
    }
    this.ongoing = this.db.ongoing();
    this.db.syncSet('cursor:reset', this.now());
    this.lastAuto = 0;
    this.onChange();
    if (this.timer) void this.tick();
  }

  // ---------------------------------------------------------------- games in progress (the fair-play guard)

  private ongoingAge(): number {
    let oldest = 0;
    for (const site of SITES) {
      if (!this.user(site)) continue;
      const seen = this.db.syncGet<Stamp | null>(`ongoing:${site}`)?.value;
      const age = seen && seen.user === this.user(site).toLowerCase() ? this.now() - seen.at : Number.POSITIVE_INFINITY;
      oldest = Math.max(oldest, age);
    }
    return oldest;
  }

  /** Read both sites' lists of the owner's games in progress. A site that cannot be read keeps its last list. */
  refreshOngoing(): Promise<void> {
    this.checking ??= this.readOngoing().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async readOngoing() {
    this.lastCheck = this.now();
    for (const site of SITES) {
      const user = this.user(site);
      if (!user) continue;
      try {
        const games = site === 'lichess' ? (await lichessOngoing(this.http, user)).map((g) => ongoingFromLichess(g)) : (await chessComOngoing(this.http, user)).map((g) => ongoingFromChessCom(g));
        this.db.setOngoing(site, games.filter((g): g is OngoingGame => !!g));
        this.db.syncSet(`ongoing:${site}`, { user: user.toLowerCase(), at: this.now() } satisfies Stamp);
        this.status[site].ongoingProblem = undefined;
      } catch (e) {
        this.status[site].ongoingProblem = (e as Error).message;
        this.log(`games in progress on ${SITE_NAME[site]} could not be read: ${(e as Error).message}`);
      }
    }
    this.ongoing = this.db.ongoing();
    this.onChange();
  }

  /**
   * The standing notice for the board (ARCHITECTURE §12, rule 4): shown whenever the owner's games
   * in progress cannot be checked, so the rule is in front of them instead of silently unenforced.
   */
  notice(): string | undefined {
    const named = SITES.filter((s) => this.user(s));
    if (!named.length) return 'Fair play: games still in progress (Daily games too) are never analysed here. Enter your Lichess and Chess.com names under Games, and the app will check positions against your games in progress.';
    const unchecked = named.filter((s) => {
      const seen = this.db.syncGet<Stamp | null>(`ongoing:${s}`)?.value;
      return !seen || seen.user !== this.user(s).toLowerCase() || this.now() - seen.at > 6 * ONGOING_EVERY_MS;
    });
    if (!unchecked.length) return undefined;
    return `Fair play: your games in progress on ${unchecked.map((s) => SITE_NAME[s]).join(' and ')} could not be checked${this.status[unchecked[0]!].ongoingProblem ? ` (${this.status[unchecked[0]!].ongoingProblem})` : ' yet'}. Until they can be, please only set up positions from finished games.`;
  }

  /** Make sure the list is not stale before it is relied on. Never waits for the network. */
  private keepFresh() {
    if (this.now() - this.lastCheck >= 60_000 && this.ongoingAge() >= ONGOING_EVERY_MS && SITES.some((s) => this.user(s))) void this.refreshOngoing().catch(() => {});
  }

  /** The position being looked at, with the positions that led to it: is it off limits? */
  guard(fens: readonly string[]): GuardHit | null {
    this.keepFresh();
    return guardPath(fens, this.ongoing);
  }

  /** A game or position about to be put on the board from outside: is it one of the games in progress? */
  guardLoad(tree: MoveTree): GuardHit | null {
    this.keepFresh();
    return guardTree(tree, this.ongoing);
  }

  // ---------------------------------------------------------------- syncing finished games

  private wanted(): { speeds: Set<TimeClass>; casual: boolean; since: number } {
    return {
      speeds: new Set(SPEEDS[this.settings.get<string>('import.speeds')] ?? SPEEDS.slow),
      casual: this.settings.get<boolean>('import.casual'),
      since: this.now() - this.settings.get<number>('import.monthsBack') * 30.44 * DAY,
    };
  }

  /** Store what the site sent, if it is a finished game of standard chess that the settings ask for. */
  private keep(r: ImportOutcome, want: { speeds: Set<TimeClass>; casual: boolean; since: number }): boolean {
    if (!r.ok) return false;
    const g = r.game;
    if (!want.speeds.has(g.timeClass) || (!want.casual && !g.rated) || Date.parse(g.playedAt) < want.since) return false;
    return this.db.addGame(g);
  }

  /** Fetch new finished games from every account, and the games in progress. One sync at a time. */
  sync(): Promise<SyncReport> {
    this.running ??= this.runSync().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runSync(): Promise<SyncReport> {
    const added: Record<Site, number> = { lichess: 0, chesscom: 0 };
    const problems: string[] = [];
    const named = SITES.filter((s) => this.user(s));
    if (!named.length) return { added, problems, text: 'Enter your name on Lichess or Chess.com first.' };
    // the guard's list first: it matters more than the games
    await this.refreshOngoing();
    const reset = this.db.syncGet<number>('cursor:reset')?.value ?? 0;
    for (const site of named) {
      this.status[site] = { ...this.status[site], syncing: true, problem: undefined };
      this.onChange();
      try {
        added[site] = site === 'lichess' ? await this.syncLichess(this.user(site), reset) : await this.syncChessCom(this.user(site), reset);
        this.db.syncSet(`synced:${site}`, { user: this.user(site).toLowerCase(), at: this.now() } satisfies Stamp);
      } catch (e) {
        const message = e instanceof SiteError ? e.message : `${SITE_NAME[site]}: ${(e as Error).message}`;
        this.status[site].problem = message;
        problems.push(message);
        this.log(`sync of ${SITE_NAME[site]} failed: ${(e as Error).message}`);
      }
      this.status[site].syncing = false;
      this.onChange();
    }
    const total = added.lichess + added.chesscom;
    const parts = named.filter((s) => added[s]).map((s) => `${added[s]} from ${SITE_NAME[s]}`);
    const text = [total ? `${total} new ${total === 1 ? 'game' : 'games'}: ${parts.join(', ')}.` : problems.length ? '' : 'No new games.', ...problems].filter(Boolean).join(' ');
    this.db.logEvent('sync', { added, problems });
    return { added, problems, text };
  }

  private async syncLichess(user: string, reset: number): Promise<number> {
    const want = this.wanted();
    const key = `lichess:${user.toLowerCase()}`;
    const saved = this.db.syncGet<{ since: number; at: number }>(key)?.value;
    // the cursor is the start time of the newest game seen so far. It starts over when the owner
    // changed what is imported after it was written
    let cursor = saved && saved.at > reset ? saved.since : want.since;
    let added = 0;
    const perfs = [...want.speeds].flatMap((s) => LICHESS_PERF[s] ?? []);
    for (let page = 0; perfs.length && page < LICHESS_PAGES; page++) {
      // a game that was still being played last time started before the newest one: the first request looks a little back
      const since = page === 0 ? Math.max(want.since, cursor - DAY / 4) : cursor + 1;
      const games = await lichessFinished(this.http, user, { since, perfs, max: LICHESS_PAGE });
      for (const raw of games) if (this.keep(fromLichess(raw, user), want)) added++;
      cursor = Math.max(cursor, ...games.map((g) => g.createdAt ?? 0));
      this.db.syncSet(key, { since: cursor, at: this.now() });
      if (games.length < LICHESS_PAGE) break;
    }
    // Daily games: they start long before they end, so a moving start date would miss them
    if (want.speeds.has('daily')) {
      const games = await lichessFinished(this.http, user, { since: Math.max(want.since, this.now() - DAILY_WINDOW_MS), perfs: ['correspondence'], max: LICHESS_PAGE });
      for (const raw of games) if (this.keep(fromLichess(raw, user), want)) added++;
    }
    return added;
  }

  private async syncChessCom(user: string, reset: number): Promise<number> {
    const want = this.wanted();
    const from = new Date(want.since);
    const first = `${from.getUTCFullYear()}/${String(from.getUTCMonth() + 1).padStart(2, '0')}`;
    let added = 0;
    for (const month of await chessComMonths(this.http, user)) {
      if (month < first) continue;
      const key = `chesscom:${user.toLowerCase()}:${month}`;
      const row = this.db.syncGet<{ etag?: string; final?: boolean; at: number }>(key)?.value;
      const saved = row && row.at > reset ? row : undefined;
      if (saved?.final) continue;
      const r = await chessComMonth(this.http, user, month, saved?.etag);
      if (r.changed) for (const raw of r.games) if (this.keep(fromChessCom(raw, user), want)) added++;
      // a month that ended a few days ago will not change any more
      const [y, m] = month.split('/').map(Number) as [number, number];
      const final = this.now() > Date.UTC(y, m, 1) + 3 * DAY;
      this.db.syncSet(key, { etag: r.changed ? r.etag : saved?.etag, final, at: this.now() });
    }
    return added;
  }

  // ---------------------------------------------------------------- one game, by hand

  /** A PGN (one game or several) or a link to a game, pasted by the owner (feature B8). */
  async importText(text: string): Promise<ImportReport> {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, reason: 'Paste a PGN, or a link to a game on Lichess or Chess.com.' };
    const link = parseGameLink(trimmed);
    if (link) return this.importLink(link);
    const owners = SITES.map((s) => this.user(s));
    const chunks = trimmed.split(/\r?\n\s*\r?\n(?=\[Event\s)/).filter((c) => c.trim());
    let added = 0;
    let already = 0;
    let id: number | undefined;
    const refused: string[] = [];
    for (const chunk of chunks) {
      const r = fromPgn(chunk, owners);
      if (!r.ok) {
        refused.push(r.reason);
        continue;
      }
      const tree = importPgn(chunk);
      const hit = tree.ok ? this.guardLoad(tree.tree) : null;
      if (hit) {
        refused.push('This is one of your games in progress. Only finished games are imported (fair play).');
        continue;
      }
      if (this.db.addGame(r.game)) added++;
      else already++;
      id = this.db.findGame(r.game.site, r.game.siteId);
    }
    if (!added && !already) return { ok: false, reason: refused[0] ?? 'No game was found in that text.' };
    this.db.logEvent('import', { added, already, refused: refused.length });
    this.onChange();
    const text2 = [added ? `${added} ${added === 1 ? 'game' : 'games'} added.` : '', already ? (chunks.length === 1 ? 'That game is already here.' : `${already} ${already === 1 ? 'was' : 'were'} already here.`) : '', refused.length ? `${refused.length} not imported: ${refused[0]}` : ''].filter(Boolean).join(' ');
    return { ok: true, added, already, id: chunks.length === 1 ? id : undefined, text: text2 };
  }

  private async importLink(link: { site: Site; siteId: string }): Promise<ImportReport> {
    const have = this.db.findGame(link.site, link.siteId);
    if (have !== undefined) return { ok: true, added: 0, already: 1, id: have, text: 'That game is already here.' };
    try {
      if (link.site === 'lichess') {
        const r = fromLichess(await lichessGame(this.http, link.siteId), this.user('lichess'));
        if (!r.ok) return { ok: false, reason: r.reason };
        this.db.addGame(r.game);
      } else {
        // Chess.com has no public address for one game: it is in the month it ended in
        const user = this.user('chesscom');
        if (!user) return { ok: false, reason: 'A Chess.com game is found through your games there: enter your Chess.com name first, or paste the game as PGN (Share, then PGN, on the game page).' };
        await this.syncChessCom(user, this.db.syncGet<number>('cursor:reset')?.value ?? 0);
      }
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
    const id = this.db.findGame(link.site, link.siteId);
    this.onChange();
    if (id === undefined) return { ok: false, reason: 'That game is not among your finished games on Chess.com yet (its list can run some hours behind, and it only has the speeds you chose to import). Paste the game as PGN instead: Share, then PGN, on the game page.' };
    return { ok: true, added: 1, already: 0, id, text: 'Game added.' };
  }

  /** A finished game against a bot (WP 7.3): into the library like any other, with the owner's side known. Returns its id. */
  addPlayed(pgn: string, you: Color): number | undefined {
    const r = fromPgn(pgn, []);
    if (!r.ok) {
      this.log(`a bot game could not be added to the library: ${r.reason}`);
      return undefined;
    }
    const game = { ...r.game, you, outcome: outcomeOf({ result: r.game.result, you }) };
    this.db.addGame(game);
    const id = this.db.findGame(game.site, game.siteId);
    this.db.logEvent('bot_game_saved', { id });
    this.onChange();
    return id;
  }

  /** The owner's skill profile (features G2, G5): counted from the analysed slow games, pasted games of unknown speed included. */
  profile() {
    return buildProfile(this.db.profileGames(['rapid', 'classical', 'daily', 'unknown']));
  }

  // ---------------------------------------------------------------- what the page shows

  view(limit = 300): LibraryView {
    const counts = this.db.gameCounts();
    const accounts: AccountView[] = SITES.map((site) => {
      const user = this.user(site);
      const st = this.status[site];
      const synced = this.db.syncGet<Stamp | null>(`synced:${site}`)?.value;
      const checked = this.db.syncGet<Stamp | null>(`ongoing:${site}`)?.value;
      const when = (stamp: Stamp | null | undefined) => (user && stamp && stamp.user === user.toLowerCase() ? new Date(stamp.at).toISOString() : undefined);
      return {
        site,
        user,
        state: !user ? 'none' : st.syncing ? 'syncing' : st.problem ? 'error' : 'ok',
        problem: st.problem,
        lastSync: when(synced),
        games: counts.bySite[site] ?? 0,
        ongoing: this.ongoing.filter((g) => g.site === site).length,
        ongoingAt: when(checked),
        ongoingProblem: st.ongoingProblem,
        ratings: user ? this.db.latestRatings(site) : {},
      };
    });
    return { accounts, games: this.db.listGames(limit), total: counts.total, record: { win: counts.win, loss: counts.loss, draw: counts.draw }, syncing: SITES.some((s) => this.status[s].syncing), journal: this.db.journal().map((j) => ({ ...j, habit: STEP_HABIT[j.step] })), profile: this.profile() };
  }
}
