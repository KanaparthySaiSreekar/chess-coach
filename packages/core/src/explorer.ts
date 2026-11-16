// The opening explorer (features I3, D6; ARCHITECTURE §12; PLAN WP 8.2): what people play from a
// position, and how those games ended.
//
// Three sources: Lichess's database at the owner's level (or any rating band), the masters'
// database, and the owner's own games. All of it is counting, never judging: which move is good is
// the engine's job (D33). When Lichess cannot be asked, Maia's guess of what players at the owner's
// level play stands in, marked as a guess (no games are counted).

import { describeMove, mustPosition, parsePosition, positionKey, sanToMove, START_FEN, uciToMove, type Color } from './chess.ts';

export type ExplorerSource = 'level' | 'masters' | 'mine';

/** Lichess's rating buckets: each is "from this rating to just under the next one" (2500 and up for the last). */
export const RATING_BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500] as const;

/** The game speeds the explorer is asked about: the owner's own (rapid, classical, daily) or every speed. */
export const EXPLORER_SPEEDS: Record<'yours' | 'all', string[]> = {
  yours: ['rapid', 'classical', 'correspondence'],
  all: ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'],
};

/** Past this move number the explorer is not asked: it is for the opening, and positions this deep are almost never in its games. */
export const EXPLORER_LAST_MOVE = 30;

/** How deep the owner's own games are counted (plies). */
export const MY_GAMES_PLIES = 40;

/** Maia's guesses below this share are left out: a long tail of moves nobody plays. */
const GUESS_FLOOR = 0.02;

/** One move as Lichess's explorer sends it. */
export type RawExplorerMove = { uci: string; san: string; white: number; draws: number; black: number; averageRating?: number; opening?: { eco: string; name: string } | null };
/** Lichess's answer for one position (the lichess and masters databases share this shape). */
export type RawExplorerAnswer = { white: number; draws: number; black: number; moves: RawExplorerMove[]; opening?: { eco: string; name: string } | null };

export type ExplorerRow = {
  san: string;
  /** engine style (castling as the king's two-square move): what the page sends to play it */
  uci: string;
  /** games that went on with this move (0 for Maia's guess) */
  games: number;
  /** how often the move is played here, in % (one decimal) */
  share: number;
  /** how those games ended, in whole % that add up to 100; absent for a guess */
  result?: { white: number; draws: number; black: number };
  averageRating?: number;
};

export type ExplorerTable = {
  /** games that reached the position (0 for a guess) */
  games: number;
  rows: ExplorerRow[];
  opening?: { eco: string; name: string };
  /** Maia's guess, not counted games */
  guess?: boolean;
};

/** Whole percentages that add up to 100 (largest remainder), or all zero when there is nothing to split. */
export function percents(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v * 100) / total);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rest: r - Math.floor(r) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out;
}

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part * 1000) / whole) / 10 : 0);

/**
 * Lichess's answer for a position → the table the page shows. Every move is checked against the
 * rules in this position (by its SAN, then its UCI); a move that does not fit is left out, so a
 * stale or mixed-up answer can never put an illegal move on the page.
 */
export function readExplorer(fen: string, raw: RawExplorerAnswer): ExplorerTable | null {
  if (!parsePosition(fen) || !raw || !Array.isArray(raw.moves)) return null;
  const total = num(raw.white) + num(raw.draws) + num(raw.black);
  const rows: ExplorerRow[] = [];
  const seen = new Set<string>();
  for (const m of raw.moves) {
    const pos = mustPosition(fen);
    const move = (typeof m.san === 'string' ? sanToMove(pos, m.san) : null) ?? (typeof m.uci === 'string' ? uciToMove(pos, m.uci) : null);
    if (!move) continue;
    const info = describeMove(pos, move);
    if (seen.has(info.uci)) continue;
    seen.add(info.uci);
    const w = num(m.white);
    const d = num(m.draws);
    const b = num(m.black);
    const games = w + d + b;
    if (!games) continue;
    const [pw, pd, pb] = percents([w, d, b]);
    rows.push({ san: info.san, uci: info.uci, games, share: share(games, total), result: { white: pw!, draws: pd!, black: pb! }, averageRating: typeof m.averageRating === 'number' && m.averageRating > 0 ? m.averageRating : undefined });
  }
  rows.sort((a, b) => b.games - a.games);
  const opening = raw.opening && typeof raw.opening.name === 'string' ? { eco: String(raw.opening.eco ?? ''), name: raw.opening.name } : undefined;
  return { games: total, rows, opening };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Maia's probabilities for a position → a table marked as a guess (moves under 2% left out). */
export function guessTable(fen: string, probs: readonly { uci: string; p: number }[]): ExplorerTable | null {
  if (!parsePosition(fen)) return null;
  const rows: ExplorerRow[] = [];
  for (const { uci, p } of [...probs].sort((a, b) => b.p - a.p)) {
    if (!(p >= GUESS_FLOOR)) continue;
    const pos = mustPosition(fen);
    const move = uciToMove(pos, uci);
    if (!move) continue;
    const info = describeMove(pos, move);
    if (rows.some((r) => r.uci === info.uci)) continue;
    rows.push({ san: info.san, uci: info.uci, games: 0, share: Math.round(p * 1000) / 10 });
  }
  return { games: 0, rows, guess: true };
}

// ------------------------------------------------------------------ the owner's own games

export type MyGame = { id: number; you: Color; result: '1-0' | '0-1' | '1/2-1/2' | '*'; sans: readonly string[] };
type Tally = { white: number; draws: number; black: number };
type MoveTally = Tally & { san: string; uci: string };
/** The owner's games by position: for each colour they played, each position reached and the moves played from it. */
export type MyGamesIndex = { games: number; byPosition: Map<string, { reached: Tally; moves: Map<string, MoveTally> }> };

const tallyOf = (result: MyGame['result']): Tally => ({ white: result === '1-0' ? 1 : 0, draws: result === '1/2-1/2' ? 1 : 0, black: result === '0-1' ? 1 : 0 });
const add = (into: Tally, t: Tally) => {
  into.white += t.white;
  into.draws += t.draws;
  into.black += t.black;
};

/** Count the owner's games position by position (their first MY_GAMES_PLIES plies; games from the normal start). */
export function indexMyGames(games: readonly MyGame[], plies = MY_GAMES_PLIES): MyGamesIndex {
  const byPosition: MyGamesIndex['byPosition'] = new Map();
  let counted = 0;
  for (const g of games) {
    if (g.result === '*') continue;
    const t = tallyOf(g.result);
    const pos = mustPosition(START_FEN);
    let fen = START_FEN;
    counted++;
    for (let i = 0; i <= Math.min(plies, g.sans.length); i++) {
      const key = `${g.you}|${positionKey(fen)}`;
      let entry = byPosition.get(key);
      if (!entry) byPosition.set(key, (entry = { reached: { white: 0, draws: 0, black: 0 }, moves: new Map() }));
      add(entry.reached, t);
      if (i === Math.min(plies, g.sans.length)) break;
      const move = sanToMove(pos, g.sans[i]!);
      if (!move) break;
      const info = describeMove(pos, move);
      let m = entry.moves.get(info.uci);
      if (!m) entry.moves.set(info.uci, (m = { san: info.san, uci: info.uci, white: 0, draws: 0, black: 0 }));
      add(m, t);
      pos.play(move);
      fen = info.fenAfter;
    }
  }
  return { games: counted, byPosition };
}

/** What was played from this position in the owner's games as one colour (theirs when it is their turn, their opponents' otherwise). */
export function myGamesTable(index: MyGamesIndex, fen: string, you: Color): ExplorerTable | null {
  if (!parsePosition(fen)) return null;
  const entry = index.byPosition.get(`${you}|${positionKey(fen)}`);
  if (!entry) return { games: 0, rows: [] };
  const total = entry.reached.white + entry.reached.draws + entry.reached.black;
  const rows: ExplorerRow[] = [...entry.moves.values()]
    .map((m) => {
      const games = m.white + m.draws + m.black;
      const [pw, pd, pb] = percents([m.white, m.draws, m.black]);
      return { san: m.san, uci: m.uci, games, share: share(games, total), result: { white: pw!, draws: pd!, black: pb! } };
    })
    .sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));
  return { games: total, rows };
}

// ------------------------------------------------------------------ what to ask for

/** The buckets for "my level": the one the owner's rating falls in and the one above (where they are going); under 1000 when nothing is known yet. */
export function levelBuckets(rating: number | null | undefined): number[] {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) return [0, 1000];
  let i = 0;
  for (let k = 0; k < RATING_BUCKETS.length; k++) if (rating >= RATING_BUCKETS[k]!) i = k;
  return RATING_BUCKETS.slice(i, Math.min(i + 2, RATING_BUCKETS.length)) as number[];
}

/** "rated under 1200", "rated 1400–1799", "rated 2500 and up" */
export function bucketsText(buckets: readonly number[]): string {
  if (!buckets.length) return 'of every rating';
  const lo = Math.min(...buckets);
  const hiBucket = Math.max(...buckets);
  const next = RATING_BUCKETS.find((b) => b > hiBucket);
  if (next === undefined) return lo === 0 ? 'of every rating' : `rated ${lo} and up`;
  return lo === 0 ? `rated under ${next}` : `rated ${lo}–${next - 1}`;
}

const SPEED_WORDS: Record<string, string> = { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', correspondence: 'daily' };

/** "rapid, classical and daily" */
export function speedsText(speeds: readonly string[]): string {
  const words = speeds.map((s) => SPEED_WORDS[s] ?? s);
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** Whether the explorer is asked about this position at all (the opening only). */
export function explorerCovers(fen: string): boolean {
  const pos = parsePosition(fen);
  return !!pos && !pos.isEnd() && pos.fullmoves <= EXPLORER_LAST_MOVE;
}
