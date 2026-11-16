// Fetching the owner's games from Lichess and Chess.com (ARCHITECTURE §12; features B1, B8).
//
// Both sites' public APIs, with no login: a username is all they need. One request at a time,
// a generic client name, nothing personal in the headers (ARCHITECTURE §15). What comes back is
// read by packages/core/src/games.ts; nothing here decides what a game is.
//
//   Lichess    https://lichess.org/api  ("Export games of a user", as NDJSON)
//   Chess.com  https://www.chess.com/news/view/published-data-api  (monthly archives)

import type { ChessComGame, LichessGame } from '@chess-coach/core';

export const CLIENT = 'chess-coach-local/0.1';

export type HttpResponse = { status: number; header(name: string): string | null; text(): Promise<string> };
/** One GET. The tests pass a stand-in that answers from recorded files. */
export type Http = (url: string, headers?: Record<string, string>, timeoutMs?: number) => Promise<HttpResponse>;

export const realHttp: Http = async (url, headers = {}, timeoutMs = 20_000) => {
  const res = await fetch(url, { headers: { 'User-Agent': CLIENT, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, header: (name) => res.headers.get(name), text: () => res.text() };
};

/** Why a site could not be read, in a form the page can show. */
export class SiteError extends Error {
  readonly kind: 'no-user' | 'slow-down' | 'unavailable';
  constructor(kind: SiteError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export type Site = 'lichess' | 'chesscom';
export const SITE_NAME: Record<Site, string> = { lichess: 'Lichess', chesscom: 'Chess.com' };

/** A name the sites could have issued: it goes into an address, so nothing else is let through. */
export function validUser(user: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/.test(user);
}

function check(site: Site, user: string, status: number): void {
  if (status === 200) return;
  if (status === 404) throw new SiteError('no-user', `${SITE_NAME[site]} has no player called "${user}".`);
  if (status === 429) throw new SiteError('slow-down', `${SITE_NAME[site]} asked for a pause. The next sync will try again.`);
  throw new SiteError('unavailable', `${SITE_NAME[site]} did not answer (status ${status}).`);
}

async function get(http: Http, site: Site, user: string, url: string, headers: Record<string, string>, timeoutMs?: number): Promise<HttpResponse> {
  try {
    return await http(url, headers, timeoutMs);
  } catch (e) {
    throw new SiteError('unavailable', `${SITE_NAME[site]} could not be reached (${(e as Error).name === 'TimeoutError' ? 'it took too long' : (e as Error).message}).`);
  }
}

function ndjson<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* a line cut short at the end of a stream: the next sync fetches that game again */
    }
  }
  return out;
}

// ---------------------------------------------------------------- Lichess

const LICHESS = 'https://lichess.org';

/**
 * Finished games of one player, oldest first, that started at or after `since` (milliseconds).
 * `perfs` are Lichess's speed names. Lichess sends about 20 games a second, so a long list takes a while.
 */
export async function lichessFinished(http: Http, user: string, opts: { since: number; perfs: string[]; max: number }): Promise<LichessGame[]> {
  const q = new URLSearchParams({ since: String(Math.max(opts.since, 1356998400070)), perfType: opts.perfs.join(','), pgnInJson: 'true', clocks: 'true', opening: 'true', sort: 'dateAsc', max: String(opts.max) });
  const res = await get(http, 'lichess', user, `${LICHESS}/api/games/user/${encodeURIComponent(user)}?${q}`, { Accept: 'application/x-ndjson' }, 120_000);
  check('lichess', user, res.status);
  return ndjson<LichessGame>(await res.text());
}

/** The games one player is playing now (the fair-play guard's list). */
export async function lichessOngoing(http: Http, user: string): Promise<(LichessGame & { lastFen?: string })[]> {
  const q = new URLSearchParams({ ongoing: 'true', finished: 'false', moves: 'true', lastFen: 'true', max: '60' });
  const res = await get(http, 'lichess', user, `${LICHESS}/api/games/user/${encodeURIComponent(user)}?${q}`, { Accept: 'application/x-ndjson' }, 30_000);
  check('lichess', user, res.status);
  return ndjson<LichessGame & { lastFen?: string }>(await res.text());
}

/** One game by its id (the owner pasted its link). */
export async function lichessGame(http: Http, id: string): Promise<LichessGame> {
  const res = await get(http, 'lichess', id, `${LICHESS}/game/export/${encodeURIComponent(id)}?pgnInJson=true&clocks=true&opening=true`, { Accept: 'application/json' });
  if (res.status === 404) throw new SiteError('no-user', 'Lichess has no game at that address.');
  check('lichess', id, res.status);
  return JSON.parse(await res.text()) as LichessGame;
}

/** A Lichess study's chapters as one PGN (WP 8.1). Public studies need nothing; a private one needs the owner's token. */
export async function lichessStudyPgn(http: Http, id: string, token?: string): Promise<string> {
  const q = new URLSearchParams({ comments: 'true', variations: 'true', clocks: 'true', orientation: 'true' });
  const res = await get(http, 'lichess', id, `${LICHESS}/api/study/${encodeURIComponent(id)}.pgn?${q}`, { Accept: 'application/x-chess-pgn', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, 60_000);
  if (res.status === 404 || res.status === 403) throw new SiteError('no-user', 'Lichess has no study at that address that can be read: it may be private (a private study needs your Lichess token in .env).');
  check('lichess', id, res.status);
  return res.text();
}

// ---------------------------------------------------------------- Chess.com

const CHESSCOM = 'https://api.chess.com/pub/player';

/** The months one player has games in, oldest first, as "YYYY/MM". */
export async function chessComMonths(http: Http, user: string): Promise<string[]> {
  const res = await get(http, 'chesscom', user, `${CHESSCOM}/${encodeURIComponent(user.toLowerCase())}/games/archives`, { Accept: 'application/json' });
  check('chesscom', user, res.status);
  const data = JSON.parse(await res.text()) as { archives?: string[] };
  return (data.archives ?? []).map((url) => /\/(\d{4}\/\d{2})$/.exec(url)?.[1]).filter((m): m is string => !!m).sort();
}

/** One month's finished games. With the `etag` of the last answer, an unchanged month costs almost nothing. */
export async function chessComMonth(http: Http, user: string, month: string, etag?: string): Promise<{ changed: false } | { changed: true; games: ChessComGame[]; etag?: string }> {
  const res = await get(http, 'chesscom', user, `${CHESSCOM}/${encodeURIComponent(user.toLowerCase())}/games/${month}`, { Accept: 'application/json', ...(etag ? { 'If-None-Match': etag } : {}) }, 60_000);
  if (res.status === 304) return { changed: false };
  check('chesscom', user, res.status);
  const data = JSON.parse(await res.text()) as { games?: ChessComGame[] };
  return { changed: true, games: data.games ?? [], etag: res.header('etag') ?? undefined };
}

/** The Daily games one player is playing now (the fair-play guard's list). */
export async function chessComOngoing(http: Http, user: string): Promise<(ChessComGame & { fen?: string })[]> {
  const res = await get(http, 'chesscom', user, `${CHESSCOM}/${encodeURIComponent(user.toLowerCase())}/games`, { Accept: 'application/json' });
  check('chesscom', user, res.status);
  const data = JSON.parse(await res.text()) as { games?: (ChessComGame & { fen?: string })[] };
  return data.games ?? [];
}
