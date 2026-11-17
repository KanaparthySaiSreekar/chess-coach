// A repertoire's outline (features D10, D11; PLAN WP 8.12): the owner's choice of moves for a
// repertoire, chapter by chapter, as a file in content/repertoires/. Moves only: the outline says
// which opening the owner plays and against which replies they want a chapter; everything past
// its moves comes from the book (the masters' games) and is checked by the engine (D33).
//
// Each chapter is a line from the start. Its moves of mine are the moves the builder plays in those
// positions; its opponent's moves are replies the builder always prepares; and a line of the
// repertoire belongs to the deepest chapter whose position it passes through (by position, so a
// transposition lands in the right chapter).

import { START_FEN, playLine, positionKey, type Color } from './chess.ts';
import { gateV1Line, lineSteps, lineText, type RepLine } from './repertoire.ts';

export type OutlineFile = {
  id: string;
  name: string;
  colour: Color;
  about?: string;
  /**
   * Who drew up the chapter list (D13): the owner (their list, say a course's chapter headings) or
   * Claude (from the owner's choices). Either way every move in it is checked against the book.
   */
  listBy?: 'owner' | 'claude';
  chapters: { moves: string; name?: string; with?: string }[];
};

export type OutlineChapter = {
  index: number;
  name: string;
  /** the chapter's moves from the start, as the rules write them */
  sans: string[];
  ucis: string[];
  /** the position after the chapter's last move */
  endKey: string;
  /** the chapter holds the lines where the opponent plays this move later (SAN) */
  with?: string;
};

export type Outline = {
  id: string;
  name: string;
  colour: Color;
  /** who drew up the chapter list (D13) */
  listBy?: 'owner' | 'claude';
  chapters: OutlineChapter[];
  /** my move in each position the chapters name one for (position key → move) */
  mine: Map<string, { uci: string; san: string }>;
  /** the opponent's moves the chapters name (position key → their moves), always prepared */
  forced: Map<string, { uci: string; san: string }[]>;
  /** every position on a chapter's moves, the last one included */
  onPath: Set<string>;
};

const ID = /^[a-z0-9][a-z0-9-]{0,60}$/;

/** The SAN of a line written the PGN way ("1. Nf3 Nf6 2. b3"): numbers and results left out. */
export function outlineSans(moves: string): string[] {
  return moves
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
}

const clean = (san: string) => san.replace(/[+#!?]+$/g, '');

/**
 * An outline file read and checked: every chapter's moves legal from the start (gate V1, naming the
 * chapter and the move), no position where two chapters play different moves of mine, no chapter
 * twice. A file with a problem cannot be built.
 */
export function readOutline(raw: unknown): { ok: true; outline: Outline } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const f = raw as Partial<OutlineFile> | null;
  if (!f || typeof f !== 'object') return { ok: false, problems: ['the file is not an outline (an object with id, name, colour and chapters)'] };
  if (typeof f.id !== 'string' || !ID.test(f.id)) problems.push('the id must be lower-case letters, digits and dashes');
  if (typeof f.name !== 'string' || !f.name.trim()) problems.push('the outline has no name');
  if (f.colour !== 'white' && f.colour !== 'black') problems.push('the colour must be "white" or "black"');
  if (!Array.isArray(f.chapters) || !f.chapters.length) problems.push('the outline has no chapters');
  if (problems.length) return { ok: false, problems };
  const colour = f.colour as Color;
  const chapters: OutlineChapter[] = [];
  const mine = new Map<string, { uci: string; san: string; chapter: number }>();
  const forced = new Map<string, { uci: string; san: string }[]>();
  const onPath = new Set<string>();
  const seen = new Map<string, number>();
  f.chapters!.forEach((c, i) => {
    const label = `chapter ${i + 1}${typeof c?.moves === 'string' ? ` (${c.moves})` : ''}`;
    if (!c || typeof c.moves !== 'string') return problems.push(`${label}: it has no moves`);
    const sans = outlineSans(c.moves);
    if (!sans.length) return problems.push(`${label}: it has no moves`);
    const line: RepLine = { repertoire: 0, colour, startFen: START_FEN, moves: sans };
    const v1 = gateV1Line(line);
    if (v1.result !== 'pass') return problems.push(`${label}: ${v1.detail}`);
    if (c.with !== undefined && (typeof c.with !== 'string' || !c.with.trim())) return problems.push(`${label}: "with" must name a move`);
    const same = `${sans.map(clean).join(' ')}|${c.with ?? ''}`;
    if (seen.has(same)) return problems.push(`${label}: the same as chapter ${seen.get(same)! + 1}`);
    seen.set(same, i);
    const { steps } = lineSteps(line);
    for (const s of steps) {
      const key = positionKey(s.fenBefore);
      onPath.add(key);
      if (s.mine) {
        const prev = mine.get(key);
        if (prev && prev.uci !== s.uci) problems.push(`${label}: after ${lineText(START_FEN, sans, s.index) } it plays ${s.san}, but chapter ${prev.chapter + 1} plays ${prev.san} there`);
        else if (!prev) mine.set(key, { uci: s.uci, san: s.san, chapter: i });
      } else {
        const list = forced.get(key) ?? [];
        if (!list.some((x) => x.uci === s.uci)) list.push({ uci: s.uci, san: s.san });
        forced.set(key, list);
      }
    }
    const endFen = positionAfter(START_FEN, sans);
    onPath.add(positionKey(endFen));
    chapters.push({ index: i, name: (typeof c.name === 'string' && c.name.trim()) || '', sans: steps.map((s) => s.san), ucis: steps.map((s) => s.uci), endKey: positionKey(endFen), with: c.with ? clean(c.with.trim()) : undefined });
  });
  if (problems.length) return { ok: false, problems };
  // a chapter without a name is named by its moves; two chapters on the same moves are told apart by "with"
  for (const ch of chapters) {
    if (ch.name) continue;
    const base = lineText(START_FEN, ch.sans);
    const twin = chapters.some((o) => o !== ch && o.endKey === ch.endKey);
    const dots = colour === 'white' ? '...' : '';
    ch.name = ch.with ? `${base} (with ${dots}${ch.with})` : twin ? `${base} (other moves)` : base;
  }
  return {
    ok: true,
    outline: { id: f.id!, name: f.name!.trim(), colour, listBy: f.listBy === 'owner' || f.listBy === 'claude' ? f.listBy : undefined, chapters, mine: new Map([...mine].map(([k, v]) => [k, { uci: v.uci, san: v.san }])), forced, onPath },
  };
}

/** The position after a line's moves (the line is legal: checked first). */
export function positionAfter(startFen: string, moves: readonly string[]): string {
  const r = playLine(startFen, [...moves]);
  return r.fens.at(-1) ?? startFen;
}

/**
 * The chapter a line belongs to: the deepest chapter whose position the line passes through (and,
 * for a chapter "with" a move, where the opponent plays that move later). A line that passes through
 * no chapter's position gets a chapter of its own, named by its moves up to the opponent's first move
 * the outline does not have, and the opening's name when the book of names has one.
 */
export function chapterOf(line: RepLine, outline: Outline, openingName?: (fens: string[]) => string | undefined): { name: string; index: number; auto: boolean; ply: number } {
  const r = playLine(line.startFen, line.moves);
  const fens = r.fens;
  const keys = fens.map(positionKey);
  const sans = r.infos.map((i) => clean(i.san));
  let best: { ch: OutlineChapter; ply: number } | null = null;
  for (const ch of outline.chapters) {
    const ply = keys.indexOf(ch.endKey);
    if (ply < 0) continue;
    if (ch.with) {
      // the opponent's moves after the chapter's position
      const theirs = sans.filter((_, i) => i >= ply && mover(line, i) !== line.colour);
      if (!theirs.includes(ch.with)) continue;
    } else if (outline.chapters.some((o) => o !== ch && o.endKey === ch.endKey && o.with && sans.filter((_, i) => i >= ply && mover(line, i) !== line.colour).includes(o.with))) continue;
    if (!best || ply > best.ply || (ply === best.ply && ch.with && !best.ch.with)) best = { ch, ply };
  }
  if (best) return { name: best.ch.name, index: best.ch.index, auto: false, ply: best.ply };
  // off the outline: the moves up to the opponent's first move that leaves it
  let cut = line.moves.length;
  for (let i = 0; i < line.moves.length; i++) {
    if (!outline.onPath.has(keys[i + 1]!) && mover(line, i) !== line.colour) {
      cut = i + 1;
      break;
    }
  }
  const base = lineText(line.startFen, line.moves, cut);
  const known = openingName?.(fens.slice(0, cut + 1));
  return { name: known ? `${base} (${known})` : base, index: outline.chapters.length, auto: true, ply: cut };
}

/** Who plays the move at this index of a line. */
function mover(line: RepLine, index: number): Color {
  const first: Color = line.startFen.split(' ')[1] === 'b' ? 'black' : 'white';
  return index % 2 === 0 ? first : first === 'white' ? 'black' : 'white';
}
