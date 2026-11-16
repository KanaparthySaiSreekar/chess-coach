// Building a repertoire from the book (features D10, D11; PLAN WP 8.12; CONTENT §7).
//
// The owner's outline says which opening they play; the book says the rest. "The book" is what
// masters have played: every move of a line, theirs and mine, must have been played in at least
// `minGames` games of the masters' database, so no line rests on a move nobody plays (D33: the moves
// come from games people played, checked by the engine, never from the model).
//
//   my move:          the outline's move where it names one (when it is book and sound), else the
//                     move the masters play most often there that the engine finds sound (V2's and
//                     V7's rules); no such move: the reply before it is not prepared
//   the opponent's:   the book's replies, most played first, until `bookRule` is met; the replies
//                     players at the owner's level make (until `levelRule` is met) when they are book
//                     too; and the outline's moves; each must be book
//   which positions:  best first, by how often a game reaches them in the masters' games (the
//                     outline's positions first, counted as reached at least `outlineReach`%), until
//                     the lines number `budget`; never past `depth` of my moves, never where the book
//                     has fewer than `minGames` games, and a position reached again by another move
//                     order is prepared once
//
// Pure: the book, the owner's level, the engine's verdicts and the pause are passed in, so the same
// answers give the same repertoire.

import { START_FEN, describeMove, mustPosition, positionKey, uciToMove, type Color } from './chess.ts';
import type { GateResult } from './content.ts';
import { chapterOf, type Outline } from './outline.ts';
import { lineSteps, lineText, opponentSpots, type Coverage, type RepLine, type ReplySource } from './repertoire.ts';

/** How many of the replies at a position to prepare (shares in %, of the games counted there). */
export type PrepareRule = { minCovered: number; flagShare: number; floor: number };

export type PrepareRow = { uci: string; san: string; share: number };

/**
 * The replies to prepare, most played first: until `minCovered`% of the games are covered and no
 * reply left is common enough to name (`flagShare`%), and never one under `floor`%. The rest, with
 * the reason. The builder and gate V4 use the same rule, so a reply left out on purpose is not a gap.
 */
export function repliesToPrepare(rows: readonly PrepareRow[], rule: PrepareRule): { take: (PrepareRow & { pct: number })[]; left: (PrepareRow & { pct: number; why: 'floor' | 'enough' })[] } {
  const total = rows.reduce((a, r) => a + Math.max(0, r.share), 0);
  const ordered = [...rows].filter((r) => r.share > 0).sort((a, b) => b.share - a.share || a.uci.localeCompare(b.uci));
  const take: (PrepareRow & { pct: number })[] = [];
  const left: (PrepareRow & { pct: number; why: 'floor' | 'enough' })[] = [];
  let covered = 0;
  for (const r of ordered) {
    const pct = total > 0 ? (r.share * 100) / total : 0;
    if (pct < rule.floor) left.push({ ...r, pct, why: 'floor' });
    else if (covered >= rule.minCovered && pct < rule.flagShare) left.push({ ...r, pct, why: 'enough' });
    else {
      take.push({ ...r, pct });
      covered += pct;
    }
  }
  return { take, left };
}

/** The masters' games at a position: how many, and each move with its games. */
export type BookTable = { games: number; moves: { uci: string; san: string; games: number }[] };

export type BookBuildPlan = {
  colour: Color;
  startFen?: string;
  /** how many of my moves a line may have */
  depth: number;
  /** the most lines (a position that would take the repertoire past it is not prepared, nor any after it) */
  budget: number;
  /** the book rule: a move is book when the masters played it in at least this many games */
  minGames: number;
  bookRule: PrepareRule;
  levelRule: PrepareRule;
  outline?: Outline;
  /** an outline position counts as reached in at least this % of games (so a rare chapter still gets its lines) */
  outlineReach: number;
  /** positions asked for at a time (the answers are decided in a fixed order, so this does not change the result) */
  batch: number;
};

export type BookBuildDeps = {
  /** the masters' games at a position */
  book(fen: string): Promise<BookTable | null>;
  /** what players at the owner's level reply; `games` is how many of their games reach the position, when known (under 20: do not ask) */
  level(fen: string, hint: { games?: number }): Promise<ReplySource | null>;
  /** whether a move of mine passes V2's and V7's rules */
  sound(fen: string, uci: string, san: string): Promise<boolean>;
  /** whether the opponent's move is a mistake to punish */
  punish(fen: string, uci: string, san: string): Promise<boolean>;
  /** between batches: go on, or stop (the build is left unsaved) */
  wait?(): Promise<'go' | 'stop'>;
  progress?(p: { lines: number; prepared: number; waiting: number; budget: number }): void;
  /** the opening's name for a line, from the book of names */
  openingName?(fens: string[]): string | undefined;
};

export type Required = { uci: string; san: string; games: number; why: ('book' | 'level' | 'outline')[] };

/** What the build learned at a position: kept with the repertoire, so gate V4 checks against the same answers. */
export type BuildPosition = {
  key: string;
  fen: string;
  /** % of the masters' games that reach it (the outline's floor applied) */
  reach: number;
  book: BookTable | null;
  level?: ReplySource | null;
  /** an opponent's position that was prepared: the replies the rule asks for */
  required?: Required[];
  /** a position of mine: the move played */
  mine?: { uci: string; san: string; games: number };
};

export type BookBuildResult = {
  lines: RepLine[];
  positions: Map<string, BuildPosition>;
  /** the chapters in teaching order: how many lines, and the moves to the chapter's position (where it starts) */
  chapters: { name: string; index: number; auto: boolean; lines: number; moves: string[] }[];
  /** the reach of the first position the budget left out (null: the book ran out first) */
  cut: number | null;
  prepared: number;
  notes: string[];
  stopped: boolean;
};

type Node = {
  fen: string;
  key: string;
  moves: string[];
  /** the masters' games for each move */
  games: number[];
  reach: number;
  mine: number;
  punish: number[];
  outline: boolean;
  /** the owner's level: games reaching this position (undefined: not known, ask) */
  levelGames?: number;
  children: Node[];
};

export async function buildFromBook(plan: BookBuildPlan, deps: BookBuildDeps): Promise<BookBuildResult> {
  const startFen = plan.startFen ?? START_FEN;
  const outline = plan.outline;
  const notes = new Set<string>();
  const positions = new Map<string, BuildPosition>();
  const books = new Map<string, Promise<BookTable | null>>();
  const bookAt = (fen: string) => {
    const key = positionKey(fen);
    // a failed question to the book stops the build (it is not "the book ends here"): run it again and the answers kept replay
    if (!books.has(key)) books.set(key, deps.book(fen));
    return books.get(key)!;
  };
  const gamesOf = (t: BookTable | null, uci: string) => t?.moves.find((m) => m.uci === uci)?.games ?? 0;
  const onPath = (key: string) => !!outline?.onPath.has(key);

  // my move in a position, once per position (a transposition gets the same move)
  const mineCache = new Map<string, Promise<{ uci: string; san: string; games: number } | null>>();
  const chooseMine = (fen: string, at: string, reach: number) => {
    const key = positionKey(fen);
    if (!mineCache.has(key))
      mineCache.set(
        key,
        (async () => {
          const book = await bookAt(fen);
          const pos = mustPosition(fen);
          const candidates: { uci: string; san: string; games: number; seed: boolean }[] = [];
          const seed = outline?.mine.get(key);
          if (seed) {
            const g = gamesOf(book, seed.uci);
            if (g >= plan.minGames) candidates.push({ ...seed, games: g, seed: true });
            else notes.add(`after ${at} the outline plays ${seed.san}, which is in ${g} of the masters' games (the book rule is ${plan.minGames}): the book's move is played instead`);
          }
          for (const m of [...(book?.moves ?? [])].sort((a, b) => b.games - a.games || a.uci.localeCompare(b.uci))) {
            if (m.games < plan.minGames || candidates.some((c) => c.uci === m.uci) || !uciToMove(pos, m.uci)) continue;
            candidates.push({ ...m, seed: false });
          }
          for (const c of candidates) {
            if (await deps.sound(fen, c.uci, c.san)) {
              positions.set(key, { key, fen, reach, book, mine: { uci: c.uci, san: c.san, games: c.games } });
              return { uci: c.uci, san: c.san, games: c.games };
            }
            if (c.seed) notes.add(`after ${at} the outline's ${c.san} does not pass the engine's check: the book's next move is played instead`);
          }
          positions.set(key, { key, fen, reach, book });
          return null;
        })(),
      );
    return mineCache.get(key)!;
  };

  /** The opponent's position after my move from `fen` (my turn), or null when there is no book move of mine. */
  const afterMine = async (fen: string, base: Omit<Node, 'fen' | 'key' | 'children'>): Promise<Node | null> => {
    const pos = mustPosition(fen);
    if (pos.isEnd()) return null;
    const m = await chooseMine(fen, lineText(startFen, base.moves), base.reach);
    if (!m) return null;
    const info = describeMove(pos, uciToMove(pos, m.uci)!);
    const key = positionKey(info.fenAfter);
    const outlined = !!outline && (onPath(positionKey(fen)) || onPath(key));
    const node: Node = {
      fen: info.fenAfter,
      key,
      moves: [...base.moves, info.san],
      games: [...base.games, m.games],
      reach: outlined ? Math.max(base.reach, plan.outlineReach) : base.reach,
      mine: base.mine + 1,
      punish: base.punish,
      outline: outlined,
      levelGames: base.levelGames,
      children: [],
    };
    // ask the book about it now, while the engine works on the others: the answers wait for their turn
    // (asking early changes nothing that is decided, only when the explorer's paced calls are made)
    if (node.mine < plan.depth && !mustPosition(node.fen).isEnd()) {
      bookAt(node.fen).then(
        (b) => {
          if (b && b.games >= plan.minGames) void levelAt(node);
        },
        () => {},
      );
    }
    return node;
  };

  // what players at the owner's level reply, once per position (not asked when too few of their games get there)
  const levels = new Map<string, Promise<ReplySource | null>>();
  const levelAt = (n: Node): Promise<ReplySource | null> => {
    if (n.levelGames !== undefined && n.levelGames < 20) return Promise.resolve(null);
    if (!levels.has(n.key)) levels.set(n.key, deps.level(n.fen, { games: n.levelGames }).catch(() => null));
    return levels.get(n.key)!;
  };

  const rootPos = mustPosition(startFen);
  const rootBase = { moves: [], games: [], reach: 100, mine: 0, punish: [], outline: true, levelGames: undefined };
  const root: Node | null = rootPos.turn === plan.colour ? await afterMine(startFen, rootBase) : { ...rootBase, fen: startFen, key: positionKey(startFen), children: [] };
  if (!root) return { lines: [], positions, chapters: [], cut: null, prepared: 0, notes: [...notes, 'the book has no sound first move'], stopped: false };

  const prepared = new Set<string>();
  let lines = 1;
  let cut: number | null = null;
  let stopped = false;
  const heap: Node[] = [root];
  const order = (a: Node, b: Node) => Number(b.outline) - Number(a.outline) || b.reach - a.reach || a.moves.join(' ').localeCompare(b.moves.join(' '));

  type Gathered = { book: BookTable | null; level: ReplySource | null };
  const gather = async (n: Node): Promise<Gathered | null> => {
    if (n.mine >= plan.depth || prepared.has(n.key) || mustPosition(n.fen).isEnd()) return null;
    const book = await bookAt(n.fen);
    if (!book || book.games < plan.minGames) return { book, level: null };
    return { book, level: await levelAt(n) };
  };

  while (heap.length && cut === null) {
    if (deps.wait && (await deps.wait()) === 'stop') {
      stopped = true;
      break;
    }
    heap.sort(order);
    const batch = heap.splice(0, Math.max(1, plan.batch));
    const data = await Promise.all(batch.map(gather));
    const accepted: { n: Node; required: Required[]; g: Gathered }[] = [];
    for (const [i, n] of batch.entries()) {
      const g = data[i];
      if (cut !== null || !g || prepared.has(n.key) || !g.book || g.book.games < plan.minGames) continue;
      const book = g.book;
      const required = new Map<string, Required>();
      const add = (uci: string, san: string, why: Required['why'][number]) => {
        const games = gamesOf(book, uci);
        if (games < plan.minGames) return false;
        const r = required.get(uci) ?? { uci, san, games, why: [] };
        if (!r.why.includes(why)) r.why.push(why);
        required.set(uci, r);
        return true;
      };
      for (const r of repliesToPrepare(book.moves.map((m) => ({ uci: m.uci, san: m.san, share: m.games })), plan.bookRule).take) add(r.uci, r.san, 'book');
      if (g.level?.replies.length) for (const r of repliesToPrepare(g.level.replies, plan.levelRule).take) add(r.uci, r.san, 'level');
      for (const f of outline?.forced.get(n.key) ?? []) {
        if (!add(f.uci, f.san, 'outline')) notes.add(`after ${lineText(startFen, n.moves)} the outline's ${f.san} is in ${gamesOf(book, f.uci)} of the masters' games (the book rule is ${plan.minGames}): not prepared`);
      }
      const list = [...required.values()].sort((a, b) => b.games - a.games || a.uci.localeCompare(b.uci));
      if (!list.length) continue;
      if (!n.outline && lines + list.length - 1 > plan.budget) {
        cut = n.reach;
        continue;
      }
      prepared.add(n.key);
      lines += list.length - 1;
      accepted.push({ n, required: list, g });
    }
    // the replies' answers, side by side
    await Promise.all(
      accepted.map(async ({ n, required, g }) => {
        const pos = mustPosition(n.fen);
        const kids = await Promise.all(
          required.map(async (r) => {
            const move = uciToMove(pos, r.uci);
            if (!move) return null;
            const info = describeMove(pos, move);
            const punish = await deps.punish(n.fen, r.uci, info.san).catch(() => false);
            const levelRow = g.level?.source === 'explorer' ? g.level.replies.find((x) => x.uci === r.uci) : undefined;
            const child = await afterMine(info.fenAfter, {
              moves: [...n.moves, info.san],
              games: [...n.games, r.games],
              reach: (n.reach * r.games) / g.book!.games,
              mine: n.mine,
              punish: punish ? [...n.punish, n.moves.length] : n.punish,
              outline: false,
              // the owner's level: how many of their games reach the reply, when the explorer counted them
              levelGames: g.level?.source === 'explorer' ? (levelRow?.games ?? 0) : g.level ? undefined : 0,
            });
            if (!child) notes.add(`after ${lineText(startFen, [...n.moves, info.san])} the book has no sound move with ${plan.minGames} games or more: ${info.san} is not prepared`);
            return child ? { r, child } : null;
          }),
        );
        const kept = kids.filter((k): k is { r: Required; child: Node } => !!k);
        n.children = kept.map((k) => k.child);
        lines += Math.max(kept.length, 1) - required.length;
        positions.set(n.key, { key: n.key, fen: n.fen, reach: n.reach, book: g.book, level: g.level, required: kept.map((k) => k.r) });
        heap.push(...n.children);
      }),
    );
    deps.progress?.({ lines, prepared: prepared.size, waiting: heap.length, budget: plan.budget });
  }

  // the lines: every root-to-leaf path, the most played replies first
  const out: RepLine[] = [];
  const walk = (n: Node) => {
    if (!n.children.length) {
      if (n.moves.length) out.push({ repertoire: 0, colour: plan.colour, startFen, moves: n.moves, book: n.games, punish: n.punish.length ? n.punish : undefined });
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  // each line's chapter
  const tally = new Map<string, { name: string; index: number; auto: boolean; lines: number; first: number; moves: string[] }>();
  out.forEach((line, i) => {
    const ch = outline ? chapterOf(line, outline, deps.openingName) : { name: lineText(startFen, line.moves, 1), index: 0, auto: true, ply: 1 };
    line.chapter = ch.name;
    const t = tally.get(ch.name) ?? { name: ch.name, index: ch.index, auto: ch.auto, lines: 0, first: i, moves: line.moves.slice(0, ch.ply) };
    t.lines++;
    tally.set(ch.name, t);
  });
  // the outline's chapters in its order; the others in the order the walk met them (the most played first)
  const chapters = [...tally.values()].sort((a, b) => a.index - b.index || a.first - b.first);
  const rank = new Map(chapters.map((c, i) => [c.name, i]));
  const sorted = out.map((l, i) => ({ l, i })).sort((a, b) => rank.get(a.l.chapter!)! - rank.get(b.l.chapter!)! || a.i - b.i);
  sorted.forEach((x, i) => (x.l.order = i));
  return {
    lines: sorted.map((x) => x.l),
    positions,
    chapters: chapters.map(({ name, index, auto, lines: n, moves }) => ({ name, index, auto, lines: n, moves })),
    cut,
    prepared: prepared.size,
    notes: [...notes],
    stopped,
  };
}

// ------------------------------------------------------------------ V4 for a repertoire built from the book

/**
 * Gate V4 ("human reality") for a repertoire built from the book: every move of a line, mine and the
 * opponent's, was played in at least `minGames` of the masters' games (else the line fails, naming the
 * move: it is not book), and at every opponent's position within `depth`, the replies the rule asked
 * for are all answered by some line (else the line is flagged: a line is missing, not wrong). The
 * answers are the ones the build kept, so the gate and the builder agree.
 */
export function gateV4Book(lines: readonly RepLine[], counts: readonly boolean[], stored: ReadonlyMap<string, BuildPosition>, o: { minGames: number; depth: number }): { gates: GateResult[]; coverage: Coverage[] } {
  const spots = opponentSpots(lines, counts, o.depth);
  const coverage = new Map<string, Coverage | null>();
  for (const spot of spots.values()) {
    const at = stored.get(spot.key);
    if (!at?.required || !at.book) {
      coverage.set(spot.key, null);
      continue;
    }
    const total = at.book.games || 1;
    const missing = at.required.filter((r) => !spot.covered.has(r.uci)).map((r) => ({ san: r.san, share: Math.round((r.games * 1000) / total) / 10 }));
    const covered = at.book.moves.filter((m) => spot.covered.has(m.uci)).reduce((a, m) => a + m.games, 0);
    coverage.set(spot.key, { at: spot.at, fen: spot.fen, source: 'book', games: at.book.games, covered: Math.round((covered * 1000) / total) / 10, missing, ok: missing.length === 0 });
  }
  const gates = lines.map((line, li): GateResult => {
    if (!counts[li]) return { gate: 'V4', result: 'n/a' };
    const { steps } = lineSteps(line);
    for (const s of steps) {
      const book = stored.get(positionKey(s.fenBefore))?.book;
      if (!book) return { gate: 'V4', result: 'n/a', detail: `not checked: the masters' games after ${lineText(line.startFen, line.moves, s.index)} are not known` };
      const games = book.moves.find((m) => m.uci === s.uci)?.games ?? 0;
      if (games < o.minGames) return { gate: 'V4', result: 'fail', detail: `${lineText(line.startFen, line.moves, s.index + 1).split(' ').at(-1)} is not book: the masters played it in ${games} ${games === 1 ? 'game' : 'games'} (the book rule is ${o.minGames})`, at: s.index };
    }
    const gaps: string[] = [];
    for (const spot of spots.values()) {
      if (!spot.lines.includes(li)) continue;
      const c = coverage.get(spot.key);
      if (!c) return { gate: 'V4', result: 'n/a', detail: `not checked: the replies to prepare after ${spot.at} are not known` };
      if (!c.ok) gaps.push(`after ${c.at}: not answered: ${c.missing.map((m) => `${m.san} (${m.share}% of the masters' games)`).join(', ')}`);
    }
    return gaps.length ? { gate: 'V4', result: 'flag', detail: gaps.join(' · ') } : { gate: 'V4', result: 'pass', detail: 'every move is book' };
  });
  return { gates, coverage: [...coverage.values()].filter((c): c is Coverage => !!c) };
}
