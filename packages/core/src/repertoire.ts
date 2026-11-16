// Repertoires and the gates that need no engine (features D1–D4, D6, J2; CONTENT §5, §7; PLAN WP 8.3).
//
// A repertoire is kept line by line: every root-to-leaf path of its PGN is one content item, so a
// line that fails a gate is quarantined on its own and the rest stays usable ("quarantine anything
// that fails, line by line", CONTENT §7). This file reads the lines (an illegal move is kept as
// written, so V1 can name it), and holds V1 for a line, V5 across the lines, and the arithmetic of
// V4 (which replies players at the owner's level actually play, and how much of them the lines
// cover). V2 and V7 need the engine and run on the server.

import { parseComment, parsePgn, startingPosition, type Node, type PgnNodeData } from 'chessops/pgn';
import { makeFen } from 'chessops/fen';
import { describeMove, parsePosition, positionKey, sanToMove, type Color } from './chess.ts';
import type { GateResult } from './content.ts';
import { standardCastling } from './setup.ts';

export type RepLine = {
  /** the repertoire the line belongs to (0 until it is stored) */
  repertoire: number;
  /** the side the repertoire is for: "my" moves are this side's */
  colour: Color;
  startFen: string;
  /** the moves as written (SAN), from startFen; an illegal one is kept so V1 can name it */
  moves: string[];
  /** the author's words after a move, by the move's index in `moves` */
  notes?: Record<number, string>;
  /** the chapter (game) of the PGN the line came from */
  chapter?: string;
  /** the opponent's moves in the line that are mistakes to punish (their index in `moves`), marked by the starter builder */
  punish?: number[];
  /** a line built from the book: how many of the masters' games played each move (the line's grounding, WP 8.12) */
  book?: number[];
  /** the line's place in the repertoire's teaching order (chapter by chapter) */
  order?: number;
};

export type RepImport = {
  lines: RepLine[];
  /** lines dropped because another line already holds them (the same moves, or a longer line through them) */
  duplicates: number;
  /** chapters left out, with the reason */
  skipped: { chapter: string; reason: string }[];
};

/** How deep the owner's level needs a repertoire, in moves of their own (CONTENT §7: a few moves at 400–700, about 8–10 at 700–1000). */
export const DEPTH_BY_BAND: Record<string, number> = { '400–700': 5, '700–1000': 9, '1000–1300': 12, '1300 and up': 15 };
export function depthFor(band: string | null | undefined): number {
  return DEPTH_BY_BAND[band ?? ''] ?? DEPTH_BY_BAND['400–700']!;
}

/** "1.e4 e5 2.Nf3", from a start position; `upto` moves only. */
export function lineText(startFen: string, moves: readonly string[], upto = moves.length): string {
  const parts = startFen.trim().split(/\s+/);
  let n = Number(parts[5] ?? 1) || 1;
  let black = parts[1] === 'b';
  const out: string[] = [];
  moves.slice(0, upto).forEach((san, i) => {
    if (!black) out.push(`${n}.${san}`);
    else out.push(i === 0 ? `${n}...${san}` : san);
    if (black) n++;
    black = !black;
  });
  return out.join(' ') || 'the start';
}

/**
 * Every line of a PGN for one side: each chapter's root-to-leaf paths, as written. A chapter whose
 * \`Orientation\` is the other side, or that starts from a position that cannot be read, is left
 * out with the reason. Lines another line already holds are dropped as duplicates.
 */
export function repertoireLines(text: string, colour: Color): RepImport {
  const skipped: RepImport['skipped'] = [];
  const all: RepLine[] = [];
  parsePgn(text).forEach((game, gi) => {
    // a chapter's name: Lichess's ChapterName, else the part of the Event after "Study: " (a PGN without one says "?")
    const event = game.headers.get('Event');
    const chapter = game.headers.get('ChapterName') || (event && event !== '?' ? event.replace(/^.*?:\s*/, '') : '') || `Chapter ${gi + 1}`;
    const orientation = game.headers.get('Orientation');
    if (orientation && orientation !== colour) return skipped.push({ chapter, reason: `the chapter is for ${orientation === 'white' ? 'White' : 'Black'}; this repertoire is for ${colour === 'white' ? 'White' : 'Black'}` });
    const start = startingPosition(game.headers);
    if (start.isErr) return skipped.push({ chapter, reason: 'it starts from a position that is not valid' });
    const startFen = standardCastling(makeFen(start.value.toSetup()));
    const walk = (node: Node<PgnNodeData>, moves: string[], notes: Record<number, string>) => {
      if (!node.children.length) {
        if (moves.length) all.push({ repertoire: 0, colour, startFen, moves, notes: Object.keys(notes).length ? notes : undefined, chapter });
        return;
      }
      for (const child of node.children) {
        const words = [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])]
          .map((c) => parseComment(c).text.trim())
          .filter(Boolean)
          .join(' ');
        const i = moves.length;
        walk(child, [...moves, child.data.san], words ? { ...notes, [i]: words } : notes);
      }
    };
    walk(game.moves, [], {});
  });
  // a line that another line holds (the same moves, or the start of a longer line) is not a line of its own
  const sameStart = (a: RepLine, b: RepLine) => positionKey(a.startFen) === positionKey(b.startFen);
  const lines: RepLine[] = [];
  let duplicates = 0;
  for (const line of all) {
    const holder = lines.find((l) => sameStart(l, line) && l.moves.length >= line.moves.length && line.moves.every((m, i) => cleanSan(l.moves[i]!) === cleanSan(m)));
    if (holder) {
      duplicates++;
      for (const [k, v] of Object.entries(line.notes ?? {})) if (!holder.notes?.[Number(k)]) holder.notes = { ...holder.notes, [k]: v };
      continue;
    }
    // a longer line through one already kept replaces it, in its place
    const held = lines.findIndex((l) => sameStart(l, line) && l.moves.length < line.moves.length && l.moves.every((m, i) => cleanSan(line.moves[i]!) === cleanSan(m)));
    if (held >= 0) {
      duplicates++;
      line.notes = { ...lines[held]!.notes, ...line.notes };
      lines[held] = line;
      continue;
    }
    lines.push(line);
  }
  return { lines, duplicates, skipped };
}

const cleanSan = (san: string) => san.replace(/[+#!?]+$/g, '');

/**
 * The starter builder's seed lines (CONTENT §7; the owner's choice, TRACKER Q18): for each position of
 * mine they reach, the move they play there (the first line to say wins). A PGN, variations allowed.
 */
export function seedMoves(text: string, colour: Color): Map<string, { uci: string; san: string }> {
  const out = new Map<string, { uci: string; san: string }>();
  for (const line of repertoireLines(text, colour).lines) {
    for (const s of lineSteps(line).steps) {
      const key = positionKey(s.fenBefore);
      if (s.mine && !out.has(key)) out.set(key, { uci: s.uci, san: s.san });
    }
  }
  return out;
}

/**
 * What is wrong with a seed line (the owner's openings, a PGN with variations in brackets): every
 * move that is not legal where it stands, so a slip in the brackets is said, not silently dropped.
 */
export function seedProblems(text: string, colour: Color): string[] {
  const read = repertoireLines(text, colour);
  const out = read.skipped.map((s) => `${s.chapter}: ${s.reason}`);
  if (!read.lines.length && !out.length) out.push('No moves found: write a line like "1. e4 e5 2. Nf3", with variations in brackets.');
  for (const line of read.lines) {
    const g = gateV1Line(line);
    if (g.result === 'fail' && g.detail) out.push(`${g.detail}: a variation in brackets replaces the move just before it`);
  }
  return [...new Set(out)];
}

/** The starter builder takes a reply played in at least this share of games at a position (CONTENT §7). */
export const REPLY_FLOOR = 3;

/** A line's positions: before each move, who moves, the move as the engine writes it. Stops at the first move that is not legal. */
export type LineStep = { fenBefore: string; san: string; uci: string; mine: boolean; index: number };
export function lineSteps(line: RepLine): { steps: LineStep[]; illegalAt?: number } {
  const pos = parsePosition(line.startFen);
  if (!pos) return { steps: [], illegalAt: 0 };
  const steps: LineStep[] = [];
  let fen = line.startFen;
  for (let i = 0; i < line.moves.length; i++) {
    const move = sanToMove(pos, line.moves[i]!);
    if (!move) return { steps, illegalAt: i };
    const info = describeMove(pos, move);
    steps.push({ fenBefore: fen, san: info.san, uci: info.uci, mine: pos.turn === line.colour, index: i });
    pos.play(move);
    fen = info.fenAfter;
  }
  return { steps };
}

/** V1 for a line: a valid start, every move legal in order. */
export function gateV1Line(line: RepLine): GateResult {
  if (!parsePosition(line.startFen)) return { gate: 'V1', result: 'fail', detail: 'the line starts from a position that is not valid' };
  const { illegalAt } = lineSteps(line);
  if (illegalAt === undefined) return { gate: 'V1', result: 'pass' };
  const before = lineText(line.startFen, line.moves, illegalAt);
  const mover = moveNumberOf(line.startFen, illegalAt);
  return { gate: 'V1', result: 'fail', detail: `${mover}${line.moves[illegalAt]} is not a legal move after ${before}`, at: illegalAt };
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "5." or "5..." for the move at this index of a line. */
function moveNumberOf(startFen: string, index: number): string {
  const parts = startFen.trim().split(/\s+/);
  const n0 = Number(parts[5] ?? 1) || 1;
  const blackFirst = parts[1] === 'b';
  const ply = index + (blackFirst ? 1 : 0);
  return `${n0 + Math.floor(ply / 2)}${ply % 2 ? '...' : '.'}`;
}

/**
 * V5 across the lines, in the order given (the PGN's order: main line first): no position where
 * the repertoire prescribes two different moves of mine (a transposition conflict: the later line
 * fails, naming the earlier one); a line deeper than the owner's level needs, or one that ends on
 * the opponent's move, passes with a note. Only lines that `counts` lets in set the moves others are
 * compared with (those that passed V1 and V2), so a quarantined line never makes a sound one fail.
 */
export function gateV5Lines(lines: readonly RepLine[], counts: readonly boolean[], depthMoves: number): GateResult[] {
  const chosen = new Map<string, { san: string; uci: string; line: number; at: string }>();
  return lines.map((line, li) => {
    const { steps, illegalAt } = lineSteps(line);
    if (illegalAt !== undefined) return { gate: 'V5', result: 'n/a', detail: 'not run: the line is not legal' };
    let conflict: string | null = null;
    let conflictAt = 0;
    const mine: [string, { san: string; uci: string; line: number; at: string }][] = [];
    for (const s of steps) {
      if (!s.mine) continue;
      const key = positionKey(s.fenBefore);
      const prev = chosen.get(key);
      const at = lineText(line.startFen, line.moves, s.index);
      if (prev && prev.uci !== s.uci) {
        conflictAt = s.index;
        conflict = `after ${at} this line plays ${moveNumberOf(line.startFen, s.index)}${s.san}, but the repertoire already plays ${prev.san} in that position${prev.at !== at ? ` (reached by ${prev.at})` : ''}`;
        break;
      }
      if (!prev) mine.push([key, { san: s.san, uci: s.uci, line: li, at }]);
    }
    if (conflict) return { gate: 'V5', result: 'fail', detail: conflict, at: conflictAt };
    if (counts[li]) for (const [k, v] of mine) chosen.set(k, v);
    const notes: string[] = [];
    const myMoves = steps.filter((s) => s.mine).length;
    if (myMoves > depthMoves) notes.push(`deeper than your level needs: drilled to your ${ordinal(depthMoves)} move, the rest kept as written`);
    const last = steps.at(-1);
    if (last && !last.mine) notes.push(`ends on the opponent's move: no answer is prepared for ${moveNumberOf(line.startFen, last.index)}${last.san}`);
    return notes.length ? { gate: 'V5', result: 'pass', detail: notes.join('; ') } : { gate: 'V5', result: 'pass' };
  });
}

// ------------------------------------------------------------------ V4: human reality

/** What players at the owner's level reply in a position: from the explorer's counted games, or Maia's guess. */
export type ReplySource = { source: 'explorer' | 'maia'; games?: number; replies: { uci: string; san: string; share: number; games?: number }[] };

/** The opponent's positions in the lines that count (within the owner's depth), with the replies the repertoire has there. */
export type OpponentSpot = { key: string; fen: string; at: string; covered: Set<string>; lines: number[] };

export function opponentSpots(lines: readonly RepLine[], counts: readonly boolean[], depthMoves: number): Map<string, OpponentSpot> {
  const spots = new Map<string, OpponentSpot>();
  lines.forEach((line, li) => {
    if (!counts[li]) return;
    const { steps } = lineSteps(line);
    let myMoves = 0;
    for (const s of steps) {
      if (s.mine) {
        myMoves++;
        continue;
      }
      if (myMoves >= depthMoves) break; // past the depth the owner drills, a missing reply is not a gap
      const key = positionKey(s.fenBefore);
      let spot = spots.get(key);
      if (!spot) spots.set(key, (spot = { key, fen: s.fenBefore, at: lineText(line.startFen, line.moves, s.index), covered: new Set(), lines: [] }));
      spot.covered.add(s.uci);
      if (!spot.lines.includes(li)) spot.lines.push(li);
    }
  });
  return spots;
}

export type Coverage = { at: string; fen: string; source: ReplySource['source'] | 'book'; games?: number; covered: number; missing: { san: string; share: number }[]; ok: boolean };

/** How much of what players at the owner's level reply the repertoire covers here, and the common replies it leaves out. */
export function coverageOf(spot: OpponentSpot, replies: ReplySource, opts: { minCovered: number; flagShare: number }): Coverage {
  const total = replies.replies.reduce((a, r) => a + r.share, 0);
  const covered = total > 0 ? (replies.replies.filter((r) => spot.covered.has(r.uci)).reduce((a, r) => a + r.share, 0) * 100) / total : 100;
  const missing = replies.replies
    .filter((r) => !spot.covered.has(r.uci) && (total > 0 ? (r.share * 100) / total : 0) >= opts.flagShare)
    .map((r) => ({ san: r.san, share: Math.round((r.share * 1000) / total) / 10 }));
  const rounded = Math.round(covered * 10) / 10;
  return { at: spot.at, fen: spot.fen, source: replies.source, games: replies.games, covered: rounded, missing, ok: rounded >= opts.minCovered && missing.length === 0 };
}

/** V4 for one line, from the coverage of the opponent's positions on it: passed, or flagged with each gap (a gap is a line missing, not a wrong one). */
export function gateV4Line(li: number, spots: Map<string, OpponentSpot>, coverage: Map<string, Coverage | null>): GateResult {
  const gaps: string[] = [];
  const unknown: string[] = [];
  for (const spot of spots.values()) {
    if (!spot.lines.includes(li)) continue;
    const c = coverage.get(spot.key);
    if (c === undefined || c === null) {
      unknown.push(spot.at);
      continue;
    }
    if (!c.ok) {
      const who = c.source === 'maia' ? "by Maia's guess" : c.source === 'book' ? "of the masters' games" : 'of the games at your level';
      const list = c.missing.map((m) => `${m.san} (${m.share}%)`).join(', ');
      gaps.push(`after ${c.at}: ${c.covered}% ${who} covered${list ? `; not covered: ${list}` : ''}`);
    }
  }
  if (unknown.length && !gaps.length) return { gate: 'V4', result: 'n/a', detail: `not checked: neither the explorer nor Maia could say what players reply after ${unknown.join('; ')}` };
  if (gaps.length) return { gate: 'V4', result: 'flag', detail: gaps.join(' · ') };
  return { gate: 'V4', result: 'pass' };
}

/** Which lines go to the owner as the spot-check sample (V7: one in ten, at least one), the same ones every time for the same repertoire. */
export function spotCheckSample(count: number, seed: number, share = 0.1): number[] {
  if (count <= 0) return [];
  const want = Math.max(1, Math.ceil(count * share));
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order.slice(0, want).sort((a, b) => a - b);
}

/** A stable key for a line of a repertoire: the same line imported again is the same item. */
export function lineKey(line: RepLine): string {
  return `rep:${line.repertoire}|${positionKey(line.startFen)}|${line.moves.map(cleanSan).join(' ')}`;
}
