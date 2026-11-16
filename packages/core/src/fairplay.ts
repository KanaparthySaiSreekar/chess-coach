// The fair-play guard (feature H10; ARCHITECTURE §12). A hard rule, never a setting: the app does
// not help with a game that is still being played, Daily games included. Both sites ban it.
//
// The sites list the owner's games in progress. A position on the board is compared with that
// list, and so is every game that is loaded:
//
//   - the position a game in progress stands in now is always off limits, and so is everything
//     played on from it (trying candidate moves is the help the rule forbids);
//   - an earlier position of a game in progress is off limits once the game has left the common
//     opening moves (EARLY plies): before that the position belongs to thousands of games, and
//     refusing it would stop the owner studying any opening they are also playing;
//   - a finished game that only shares its opening with a game in progress is not that game: it
//     loads, and the engine stays silent on the positions the two have in common.
//
// Pure functions: the server fetches the lists, this reads and compares them.

import { START_FEN, parsePosition } from './chess.ts';
import { chessComId, type ChessComGame, type GameSite, type LichessGame } from './games.ts';
import { importPgn, mainlineEnd, pathTo, type MoveTree } from './tree.ts';

/** From this many half-moves on, a position is taken to belong to one game. Ten = five moves each. */
export const EARLY = 10;

export type OngoingGame = {
  site: GameSite;
  siteId: string;
  url?: string;
  white: string;
  black: string;
  /** placement and side to move after each half-move so far: keys[0] is the start, keys.at(-1) is now */
  keys: string[];
};

/** What two positions must share to be "the same position" here: where the pieces stand, and whose move it is. */
export function boardKey(fen: string): string {
  const [placement = '', turn = 'w'] = fen.trim().split(/\s+/);
  return `${placement} ${turn}`;
}

const START_KEY = boardKey(START_FEN);

function keysOf(pgn: string, nowFen?: string): string[] | null {
  const r = pgn.trim() ? importPgn(pgn) : null;
  let keys: string[] = [];
  if (r?.ok) keys = pathTo(r.tree, mainlineEnd(r.tree)).map((n) => boardKey(n.fen));
  // the site's own word for the position now is taken as well: its move list can run a little behind
  if (nowFen && parsePosition(nowFen)) {
    const now = boardKey(nowFen);
    if (keys.at(-1) !== now) keys.push(now);
  }
  return keys.length ? keys : null;
}

const lastPart = (url: unknown) => (typeof url === 'string' ? (url.split('/').pop() ?? '') : '');

/** One game of Chess.com's "games in progress" list (`/pub/player/…/games`). Variants are skipped: they are never imported. */
export function ongoingFromChessCom(raw: ChessComGame & { fen?: string; white?: unknown; black?: unknown }): OngoingGame | null {
  const siteId = chessComId(raw?.url);
  if (!siteId || (raw.rules ?? 'chess') !== 'chess') return null;
  const keys = keysOf(raw.pgn ?? '', raw.fen);
  if (!keys) return null;
  return { site: 'chesscom', siteId, url: raw.url, white: lastPart(raw.white), black: lastPart(raw.black), keys };
}

/** One game of Lichess's export asked for with `ongoing=true&finished=false`. */
export function ongoingFromLichess(raw: LichessGame & { lastFen?: string }): OngoingGame | null {
  if (typeof raw?.id !== 'string' || (raw.variant ?? 'standard') !== 'standard') return null;
  const keys = keysOf(raw.moves ?? '', raw.lastFen) ?? [START_KEY];
  return { site: 'lichess', siteId: raw.id, url: `https://lichess.org/${raw.id}`, white: raw.players?.white?.user?.name ?? 'Anonymous', black: raw.players?.black?.user?.name ?? 'Anonymous', keys };
}

export type GuardHit = { game: OngoingGame; how: 'now' | 'earlier' };

/** Is this position one from a game in progress? */
export function guardPosition(fen: string, ongoing: readonly OngoingGame[]): GuardHit | null {
  const key = boardKey(fen);
  if (key === START_KEY) return null;
  for (const game of ongoing) {
    const n = game.keys.length - 1;
    if (n >= 1 && game.keys[n] === key) return { game, how: 'now' };
    for (let i = EARLY; i < n; i++) if (game.keys[i] === key) return { game, how: 'earlier' };
  }
  return null;
}

/**
 * The position being looked at, given the positions that led to it on the board (the last one is
 * the position itself). Off limits when it is a position of a game in progress, or when the way
 * to it went through the position such a game stands in now: that is playing the game on.
 */
export function guardPath(fens: readonly string[], ongoing: readonly OngoingGame[]): GuardHit | null {
  if (!ongoing.length || !fens.length) return null;
  for (const fen of fens) {
    const hit = guardPosition(fen, ongoing);
    if (hit?.how === 'now') return hit;
  }
  return guardPosition(fens.at(-1)!, ongoing);
}

/**
 * A game or position about to be put on the board from outside (pasted, set up, shown by the
 * coach). It is refused when it is one of the games in progress: by its address on the site, by
 * reaching the position that game stands in now, or by ending on a position that game has been
 * through (a part of it). The first EARLY half-moves of a game from the normal start never
 * refuse a load: the engine still stays silent on those positions when the owner gets there
 * (guardPath).
 */
export function guardTree(tree: MoveTree, ongoing: readonly OngoingGame[]): GuardHit | null {
  if (!ongoing.length) return null;
  const h = tree.headers ?? {};
  const cc = chessComId(h.Link) ?? chessComId(h.Site);
  const li = h.GameId ?? /lichess\.org\/(?:game\/)?([A-Za-z0-9]{8})/.exec(h.Site ?? '')?.[1];
  for (const game of ongoing) {
    if ((game.site === 'chesscom' && cc === game.siteId) || (game.site === 'lichess' && li === game.siteId)) return { game, how: 'now' };
  }
  const fromStart = tree.rootFen === START_FEN;
  const counts = (ply: number) => !fromStart || ply >= EARLY;
  for (const node of Object.values(tree.nodes)) {
    if (!counts(node.ply)) continue;
    const hit = guardPosition(node.fen, ongoing);
    if (hit?.how === 'now') return hit;
  }
  const end = tree.nodes[mainlineEnd(tree)]!;
  return counts(end.ply) ? guardPosition(end.fen, ongoing) : null;
}

const SITE_NAME: Record<GameSite, string> = { lichess: 'Lichess', chesscom: 'Chess.com', pgn: 'a PGN' };

/** The refusal, in plain words. The same sentence wherever the guard stops something. */
export function guardText(hit: GuardHit): string {
  const where = `your game in progress on ${SITE_NAME[hit.game.site]} (${hit.game.white} against ${hit.game.black})`;
  return hit.how === 'now'
    ? `This is the position of ${where}. Fair play: the app does not help with a game that is still being played, Daily games included. Bring it back when the game is over.`
    : `This position is from ${where}. Fair play: the app does not help with a game that is still being played, Daily games included. Bring it back when the game is over.`;
}
