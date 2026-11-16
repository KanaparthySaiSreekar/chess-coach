// The owner's finished games, as the two sites and a pasted PGN give them, in one shape
// (ARCHITECTURE §12; features B1, B2, B8, G1). Pure functions: the server fetches, this reads.
//
// The fair-play rule starts here (H10, a hard rule): a game without a final result is refused,
// whatever the route. Nothing in this file accepts one.

import { START_FEN, parsePosition, type Color } from './chess.ts';
import { importPgn, mainlineEnd, pathTo, type MoveTree } from './tree.ts';

export type GameSite = 'lichess' | 'chesscom' | 'pgn';
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily' | 'unknown';
export type GameResult3 = '1-0' | '0-1' | '1/2-1/2';
export type GameEnding = 'checkmate' | 'resignation' | 'time' | 'abandoned' | 'stalemate' | 'draw agreed' | 'repetition' | 'not enough material' | 'fifty moves' | 'draw' | 'other';
export type Outcome = 'win' | 'loss' | 'draw';

export type ImportedGame = {
  site: GameSite;
  /** the site's own id for the game: importing it twice adds nothing */
  siteId: string;
  url?: string;
  white: string;
  black: string;
  whiteRating?: number;
  blackRating?: number;
  /** what the game did to each rating, when the site says */
  whiteDiff?: number;
  blackDiff?: number;
  /** the side the owner had, when one of the players is the owner */
  you?: Color;
  result: GameResult3;
  ending: GameEnding;
  timeClass: TimeClass;
  /** as a person reads it: "10+5", "3 days per move" */
  timeControl: string;
  rated: boolean;
  /** when the game ended (ISO) */
  playedAt: string;
  eco?: string;
  opening?: string;
  /** the moves in notation, from the normal starting position */
  moves: string[];
  /** the game as PGN, with the clock after each move when the site gave it */
  pgn: string;
};

export type ImportRefusal = {
  ok: false;
  /** unfinished = the fair-play rule; variant = not standard chess; empty = no moves were played; unreadable = not a game we can read */
  why: 'unfinished' | 'variant' | 'empty' | 'unreadable';
  reason: string;
  siteId?: string;
};
export type ImportOutcome = { ok: true; game: ImportedGame } | ImportRefusal;

const refuse = (why: ImportRefusal['why'], reason: string, siteId?: string): ImportRefusal => ({ ok: false, why, reason, siteId });
const UNFINISHED = 'This game is still in progress. Only finished games are imported (fair play).';

/** The owner's result in a game. */
export function outcomeOf(game: { result: string; you?: Color }): Outcome | undefined {
  if (!game.you) return undefined;
  if (game.result === '1/2-1/2') return 'draw';
  return (game.result === '1-0') === (game.you === 'white') ? 'win' : 'loss';
}

const sameName = (a: string | undefined, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
function whoIsOwner(white: string, black: string, owners: (string | undefined)[]): Color | undefined {
  if (owners.some((o) => sameName(o, white))) return 'white';
  if (owners.some((o) => sameName(o, black))) return 'black';
  return undefined;
}

/** The mainline of a tree as notation, and the clock after each move when the PGN had one. */
function mainline(tree: MoveTree): { moves: string[]; lastFen: string } {
  const path = pathTo(tree, mainlineEnd(tree)).slice(1);
  return { moves: path.map((n) => n.san!), lastFen: path.at(-1)?.fen ?? tree.rootFen };
}

/** Read a game's PGN strictly: the normal starting position, every move legal, at least one move. */
function readMoves(pgn: string): { ok: true; tree: MoveTree; moves: string[]; lastFen: string } | { ok: false; why: 'empty' | 'unreadable' | 'variant'; reason: string } {
  const r = importPgn(pgn);
  if (!r.ok) return { ok: false, why: 'unreadable', reason: r.reason };
  if (r.tree.rootFen !== START_FEN) return { ok: false, why: 'variant', reason: 'This game does not start from the normal starting position.' };
  const { moves, lastFen } = mainline(r.tree);
  if (!moves.length) return { ok: false, why: 'empty', reason: 'No moves were played in this game.' };
  return { ok: true, tree: r.tree, moves, lastFen };
}

/** Lichess's rule: the starting time plus 40 moves' worth of increment decides the speed. */
export function speedOf(initialSeconds: number, incrementSeconds: number, rule: 'lichess' | 'chesscom' = 'lichess'): TimeClass {
  const t = initialSeconds + 40 * incrementSeconds;
  if (rule === 'chesscom') return t < 180 ? 'bullet' : t < 600 ? 'blitz' : 'rapid';
  return t < 180 ? 'bullet' : t < 480 ? 'blitz' : t < 1500 ? 'rapid' : 'classical';
}

const minutes = (s: number) => (s % 60 === 0 ? String(s / 60) : s < 60 ? `${s}s` : (s / 60).toFixed(1));
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'} per move`;

/** A PGN TimeControl ("600+5", "600", "1/86400", "-") as a person reads it, and its speed. */
export function readTimeControl(tc: string | undefined, rule: 'lichess' | 'chesscom' = 'lichess'): { text: string; timeClass: TimeClass } {
  const s = (tc ?? '').trim();
  const daily = /^(\d+)\/(\d+)$/.exec(s);
  if (daily) return { text: days(Math.max(1, Math.round(Number(daily[2]) / 86400))), timeClass: 'daily' };
  const live = /^(\d+)(?:\+(\d+))?$/.exec(s);
  if (live) {
    const initial = Number(live[1]);
    const inc = Number(live[2] ?? 0);
    return { text: `${minutes(initial)}+${inc}`, timeClass: speedOf(initial, inc, rule) };
  }
  return { text: s && s !== '-' && s !== '?' ? s : 'no clock', timeClass: s === '-' ? 'daily' : 'unknown' };
}

// ---------------------------------------------------------------- Lichess

type LichessPlayer = { user?: { name?: string; id?: string }; rating?: number; ratingDiff?: number; aiLevel?: number };
export type LichessGame = {
  id?: string;
  rated?: boolean;
  variant?: string;
  speed?: string;
  status?: string;
  createdAt?: number;
  lastMoveAt?: number;
  players?: { white?: LichessPlayer; black?: LichessPlayer };
  winner?: 'white' | 'black';
  opening?: { eco?: string; name?: string };
  moves?: string;
  pgn?: string;
  clock?: { initial?: number; increment?: number };
  daysPerTurn?: number;
};

/** How a Lichess game ended, by its status. A status that is not here is not a finished game. */
const LICHESS_ENDING: Record<string, GameEnding> = {
  mate: 'checkmate',
  resign: 'resignation',
  stalemate: 'stalemate',
  timeout: 'abandoned',
  outoftime: 'time',
  draw: 'draw',
  insufficientMaterialClaim: 'not enough material',
  cheat: 'other',
  unknownFinish: 'other',
};
const LICHESS_SPEED: Record<string, TimeClass> = { ultraBullet: 'bullet', bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', correspondence: 'daily' };

const lichessName = (p: LichessPlayer | undefined) => p?.user?.name ?? (p?.aiLevel ? `Stockfish level ${p.aiLevel}` : 'Anonymous');

/** One game of Lichess's export (`/api/games/user/…` as NDJSON, or `/game/export/…`), with `pgnInJson`. */
export function fromLichess(raw: LichessGame, owner?: string): ImportOutcome {
  const id = typeof raw?.id === 'string' ? raw.id : undefined;
  if (!id) return refuse('unreadable', 'This is not a Lichess game.');
  const status = String(raw.status ?? '');
  if (status === 'aborted' || status === 'noStart') return refuse('empty', 'This game was aborted before it started.', id);
  const ending = LICHESS_ENDING[status];
  if (!ending) return refuse('unfinished', UNFINISHED, id);
  if ((raw.variant ?? 'standard') !== 'standard') return refuse('variant', `This is a ${raw.variant} game: only standard chess is imported.`, id);
  // the site's PGN has the clocks; without it the moves alone make one
  const read = readMoves(raw.pgn ?? raw.moves ?? '');
  if (!read.ok) return refuse(read.why, read.reason, id);
  const white = lichessName(raw.players?.white);
  const black = lichessName(raw.players?.black);
  const result: GameResult3 = raw.winner === 'white' ? '1-0' : raw.winner === 'black' ? '0-1' : '1/2-1/2';
  const clock = raw.clock;
  const timeControl = typeof clock?.initial === 'number' ? `${minutes(clock.initial)}+${clock.increment ?? 0}` : raw.daysPerTurn ? days(raw.daysPerTurn) : 'no clock';
  return {
    ok: true,
    game: {
      site: 'lichess',
      siteId: id,
      url: `https://lichess.org/${id}`,
      white,
      black,
      whiteRating: raw.players?.white?.rating,
      blackRating: raw.players?.black?.rating,
      whiteDiff: raw.players?.white?.ratingDiff,
      blackDiff: raw.players?.black?.ratingDiff,
      you: whoIsOwner(white, black, [owner]),
      result,
      ending: ending === 'draw' && result !== '1/2-1/2' ? 'other' : ending,
      timeClass: LICHESS_SPEED[raw.speed ?? ''] ?? 'unknown',
      timeControl,
      rated: raw.rated === true,
      playedAt: new Date(raw.lastMoveAt ?? raw.createdAt ?? 0).toISOString(),
      eco: raw.opening?.eco,
      opening: raw.opening?.name,
      moves: read.moves,
      pgn: raw.pgn ?? raw.moves ?? '',
    },
  };
}

// ---------------------------------------------------------------- Chess.com

type ChessComPlayer = { username?: string; rating?: number; result?: string };
export type ChessComGame = {
  url?: string;
  pgn?: string;
  time_control?: string;
  end_time?: number;
  rated?: boolean;
  time_class?: string;
  rules?: string;
  white?: ChessComPlayer;
  black?: ChessComPlayer;
};

/** Chess.com's result codes (https://www.chess.com/news/view/published-data-api#game-results). */
const CC_DRAW: Record<string, GameEnding> = { agreed: 'draw agreed', repetition: 'repetition', stalemate: 'stalemate', insufficient: 'not enough material', '50move': 'fifty moves', timevsinsufficient: 'not enough material' };
const CC_LOSS: Record<string, GameEnding> = { checkmated: 'checkmate', resigned: 'resignation', timeout: 'time', abandoned: 'abandoned', lose: 'other' };
const CC_SPEED: Record<string, TimeClass> = { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', daily: 'daily' };

/** "https://www.chess.com/game/daily/123" → "daily/123": live and daily games are numbered separately. */
export function chessComId(url: string | undefined): string | undefined {
  const m = /chess\.com\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?game\/(live|daily)\/(\d+)/.exec(url ?? '');
  return m ? `${m[1]}/${m[2]}` : undefined;
}

const openingFromUrl = (url: string | undefined) => {
  const tail = /\/openings\/([^/?#"]+)/.exec(url ?? '')?.[1];
  return tail ? decodeURIComponent(tail).replace(/-/g, ' ').replace(/\s+\d+\..*$/, '').trim() : undefined;
};

/** One game of a Chess.com monthly archive (`/pub/player/…/games/YYYY/MM`). */
export function fromChessCom(raw: ChessComGame, owner?: string): ImportOutcome {
  const id = chessComId(raw?.url);
  if (!id) return refuse('unreadable', 'This is not a Chess.com game.');
  if ((raw.rules ?? 'chess') !== 'chess') return refuse('variant', `This is a ${raw.rules} game: only standard chess is imported.`, id);
  const w = raw.white?.result ?? '';
  const b = raw.black?.result ?? '';
  let result: GameResult3;
  let ending: GameEnding;
  if (w === 'win' && CC_LOSS[b]) [result, ending] = ['1-0', CC_LOSS[b]];
  else if (b === 'win' && CC_LOSS[w]) [result, ending] = ['0-1', CC_LOSS[w]];
  else if (CC_DRAW[w] && CC_DRAW[b]) [result, ending] = ['1/2-1/2', CC_DRAW[w]];
  // no result on both sides: the game is not over (the list of games in progress has this shape)
  else return refuse(w || b ? 'unreadable' : 'unfinished', w || b ? `Chess.com gave a result this app does not know (${w} / ${b}).` : UNFINISHED, id);
  if (/\[Result\s+"\*"\]/.test(raw.pgn ?? '')) return refuse('unfinished', UNFINISHED, id);
  const read = readMoves(raw.pgn ?? '');
  if (!read.ok) return refuse(read.why, read.reason, id);
  const white = raw.white?.username ?? 'White';
  const black = raw.black?.username ?? 'Black';
  const tc = readTimeControl(raw.time_control, 'chesscom');
  const headers = read.tree.headers ?? {};
  return {
    ok: true,
    game: {
      site: 'chesscom',
      siteId: id,
      url: raw.url,
      white,
      black,
      whiteRating: raw.white?.rating,
      blackRating: raw.black?.rating,
      you: whoIsOwner(white, black, [owner]),
      result,
      ending,
      timeClass: CC_SPEED[raw.time_class ?? ''] ?? tc.timeClass,
      timeControl: tc.text,
      rated: raw.rated === true,
      playedAt: new Date((raw.end_time ?? 0) * 1000).toISOString(),
      eco: headers.ECO,
      opening: openingFromUrl(headers.ECOUrl),
      moves: read.moves,
      pgn: raw.pgn ?? '',
    },
  };
}

// ---------------------------------------------------------------- a pasted PGN

/** A short stable id for a game that has none: the same game pasted twice gets the same one. */
function hashId(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

const pgnDate = (date: string | undefined, time: string | undefined): string | undefined => {
  const d = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date ?? '');
  if (!d) return undefined;
  const t = /^(\d{2}):(\d{2}):(\d{2})/.exec(time ?? '') ?? ['', '12', '00', '00'];
  const ms = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), Number(t[3]));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
};

function endingFromWords(termination: string | undefined, result: GameResult3, lastFen: string): GameEnding {
  const last = parsePosition(lastFen);
  if (last?.isCheckmate()) return 'checkmate';
  if (last?.isStalemate()) return 'stalemate';
  const t = (termination ?? '').toLowerCase();
  if (/checkmate/.test(t)) return 'checkmate';
  if (/resign/.test(t)) return 'resignation';
  if (/abandon/.test(t)) return 'abandoned';
  if (/insufficient/.test(t)) return 'not enough material';
  if (/time/.test(t)) return 'time';
  if (/agree/.test(t)) return 'draw agreed';
  if (/repetition/.test(t)) return 'repetition';
  if (/50|fifty/.test(t)) return 'fifty moves';
  if (/stalemate/.test(t)) return 'stalemate';
  return result === '1/2-1/2' ? 'draw' : t === 'normal' ? 'resignation' : 'other';
}

/**
 * A PGN the owner pasted or uploaded: one finished game of standard chess. `owners` are the
 * owner's names on the sites, to tell which side was theirs.
 */
export function fromPgn(text: string, owners: (string | undefined)[] = []): ImportOutcome {
  const read = readMoves(text);
  if (!read.ok) return refuse(read.why, read.reason);
  const h = read.tree.headers ?? {};
  const result = h.Result;
  if (result !== '1-0' && result !== '0-1' && result !== '1/2-1/2') {
    return refuse('unfinished', result === '*' ? 'This PGN says the game is still in progress (Result "*"). Only finished games are imported (fair play).' : 'This PGN has no result, so it cannot be told from a game in progress. Only finished games are imported (fair play).');
  }
  if (h.Variant && !/^standard$/i.test(h.Variant)) return refuse('variant', `This is a ${h.Variant} game: only standard chess is imported.`);
  const white = h.White && h.White !== '?' ? h.White : 'White';
  const black = h.Black && h.Black !== '?' ? h.Black : 'Black';
  const fromCc = chessComId(h.Link) ?? chessComId(h.Site);
  const fromLi = h.GameId && /lichess\.org/.test(h.Site ?? '') ? h.GameId : /lichess\.org\/(?:game\/)?([A-Za-z0-9]{8})/.exec(h.Site ?? '')?.[1];
  const site: GameSite = fromCc ? 'chesscom' : fromLi ? 'lichess' : 'pgn';
  const tc = readTimeControl(h.TimeControl, site === 'chesscom' ? 'chesscom' : 'lichess');
  const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  const diff = (v: string | undefined) => (v && /^[+-]?\d+$/.test(v) ? Number(v) : undefined);
  const playedAt = pgnDate(h.EndDate, h.EndTime) ?? pgnDate(h.UTCDate, h.UTCTime) ?? pgnDate(h.Date, undefined) ?? new Date(0).toISOString();
  return {
    ok: true,
    game: {
      site,
      siteId: fromCc ?? fromLi ?? hashId([white, black, h.Date ?? '', result, read.moves.join(' ')].join('|')),
      url: fromCc ? `https://www.chess.com/game/${fromCc}` : fromLi ? `https://lichess.org/${fromLi}` : undefined,
      white,
      black,
      whiteRating: num(h.WhiteElo),
      blackRating: num(h.BlackElo),
      whiteDiff: diff(h.WhiteRatingDiff),
      blackDiff: diff(h.BlackRatingDiff),
      you: whoIsOwner(white, black, owners),
      result,
      ending: endingFromWords(h.Termination, result, read.lastFen),
      timeClass: tc.timeClass,
      timeControl: tc.text,
      rated: /\brated\b/i.test(h.Event ?? '') && !/\b(?:casual|unrated)\b/i.test(h.Event ?? ''),
      playedAt,
      eco: h.ECO && h.ECO !== '?' ? h.ECO : undefined,
      opening: h.Opening && h.Opening !== '?' ? h.Opening : openingFromUrl(h.ECOUrl),
      moves: read.moves,
      pgn: text.trim(),
    },
  };
}

/** A game's address on one of the sites, from what the owner pasted. */
export function parseGameLink(text: string): { site: 'lichess' | 'chesscom'; siteId: string } | null {
  const s = text.trim();
  if (/\s/.test(s) || s.length > 200) return null;
  const cc = chessComId(s);
  if (cc) return { site: 'chesscom', siteId: cc };
  const li = /^(?:https?:\/\/)?(?:www\.)?lichess\.org\/(?:game\/export\/)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(?:white|black))?(?:[?#].*)?$/.exec(s);
  if (li) return { site: 'lichess', siteId: li[1]! };
  return null;
}

/** What a list of games shows for one game. */
export type GameSummary = Omit<ImportedGame, 'pgn' | 'moves'> & {
  id: number;
  plies: number;
  outcome?: Outcome;
  /** the owner has been through this game themselves (or chose to skip that) */
  reviewed?: boolean;
};
