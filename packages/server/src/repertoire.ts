// Repertoires through the gates (features D1–D4, D6, J2; CONTENT §5, §7; PLAN WP 8.3).
//
// A PGN comes in for one side; every line (root to leaf) becomes a content item and goes through
// the gates that apply to a repertoire line. Whatever fails is quarantined on its own, with the
// reason and the exact move; the rest stays usable. The order:
//
//   V1  legality, line by line (code)
//   V2  each of my moves loses at most `maxDrop` points of winning chances against the engine's
//       choice, and gives nothing away by force (the engine, `nodes`; graded like the move labels)
//   V5  no position where the repertoire plays two different moves (code; only lines that passed
//       V1 and V2 set the move, so a bad line never makes a good one fail)
//   V4  the replies covered are the ones players at the owner's level play (the explorer, Maia as
//       the second source): a gap flags the line, it does not quarantine it
//   V7  a deeper, separate pass (`secondNodes`) does not call any of my moves a mistake
//   V3  the coach's text: none yet in an imported line (the author's words are kept as written,
//       shown as theirs); WP 8.6 adds the why and the opponent's idea, which V3 will check
//   V6  the envelope
//
// V4 (network) and V7 (engine) run side by side. One line in ten (at least one) is marked for the
// owner's spot check (V7's sample); the review screen (WP 8.4) shows it.

import path from 'node:path';
import {
  GATES_FOR,
  REPLY_FLOOR,
  START_FEN,
  buildFromBook,
  coverageOf,
  describeMove,
  gateV1Line,
  gateV4Book,
  gateV4Line,
  gateV5Lines,
  gateV6,
  gradeMove,
  lineKey,
  lineSteps,
  lineText,
  mustPosition,
  opponentSpots,
  positionKey,
  quarantineReasons,
  repertoireLines,
  repliesToPrepare,
  seedMoves,
  spotCheckSample,
  statusAfter,
  uciToMove,
  validateSay,
  type BookBuildResult,
  type BookTable,
  type BuildPosition,
  type Color,
  type ConceptLadder,
  type ContentItem,
  type ContentStatus,
  type Coverage,
  type GateId,
  type GateResult,
  type GradeResult,
  type Licence,
  type Outline,
  type PrepareRule,
  type ReplySource,
  type RepLine,
  type VocabularyLevel,
} from '@chess-coach/core';
import type { Db } from './db.ts';
import type { EngineService } from './engine/service.ts';
import type { FactService } from './facts-service.ts';

export type RepertoireOptions = {
  /** V2's search (CONTENT §5: 5M nodes) */
  nodes: number;
  /** V7's deeper pass (20M nodes) */
  secondNodes: number;
  /** V2: the most a move of mine may lose against the engine's choice, in points of winning chances (4) */
  maxDrop: number;
  /** V4: the share of the replies at the owner's level the lines must cover at each opponent position (85%) */
  minCovered: number;
  /** V4: an uncovered reply this common is named (5%) */
  flagShare: number;
  /** how many of my moves the owner's level needs (V5's depth; V4 looks no deeper) */
  depthMoves: number;
  thresholds?: { inaccuracy: number; mistake: number; blunder: number };
  /** lines that pass every gate go live without the owner's yes (off: they wait on the review screen) */
  autoApprove: boolean;
};

export type RepertoireReport = {
  id: number;
  name: string;
  colour: Color;
  at: string;
  engine: string;
  lines: number;
  live: number;
  verified: number;
  quarantined: number;
  /** lines that passed with a gap flagged (V4) */
  flagged: number;
  /** lines dropped because another line already held them */
  duplicates: number;
  skipped: { chapter: string; reason: string }[];
  quarantine: { id: number; line: string; reasons: string[] }[];
  /** what players at the owner's level reply at each opponent position, and how much of it is covered */
  coverage: Coverage[];
  /** the lines put in front of the owner for the spot check (V7's sample) */
  sample: { id: number; line: string }[];
  /** per gate: how many lines passed, failed, were flagged, or were not checked */
  gates: Partial<Record<GateId, { pass: number; fail: number; flag: number; na: number }>>;
};

export type RepertoireProgress = { repertoire: number; step: 'build' | 'V1' | 'V2' | 'V4' | 'V7' | 'done'; done: number; total: number };

/** What the starter builder needs besides the gates' options (CONTENT §7; WP 8.5). */
export type BuildRequest = {
  colour: Color;
  /** the seed lines, a PGN (the owner's choice of openings, Q18) */
  seeds: string;
  name: string;
  /** a position reached in fewer than this % of the owner's games from the start is not prepared */
  minReach: number;
  /** the level band, for the envelope */
  level: string;
  /** today, for the envelope's source (a fixed date makes the build repeatable in tests) */
  date?: string;
};

/** How a repertoire was built from the book (WP 8.12): kept with it, so its gates and a rebuild use the same rules. */
export type BookPlan = {
  kind: 'book';
  outline: { id: string; hash: string; name: string };
  depth: number;
  budget: number;
  minGames: number;
  outlineReach: number;
  bookRule: PrepareRule;
  levelRule: PrepareRule;
  built: { at: string; engine: string; lines: number; prepared: number; cut: number | null; notes: string[]; chapters: BookBuildResult['chapters'] };
};

/** What a book build needs besides the gates' options. */
export type BookRequest = {
  hash: string;
  level: string;
  depth: number;
  budget: number;
  minGames: number;
  outlineReach: number;
  bookRule: PrepareRule;
  levelRule: PrepareRule;
  batch?: number;
  date?: string;
  /** between batches: go on or stop (a stopped build saves nothing; run it again and the caches replay what was done) */
  wait?: () => Promise<'go' | 'stop'>;
  progress?: (p: { lines: number; prepared: number; waiting: number; budget: number }) => void;
};

type Graded = { g: GradeResult | null; san: string };

/**
 * Does a line's words belong on the worksheet? Every line still in, one the owner kept with a note, and
 * one held back only by its words (V3): rewriting them is what brings it back.
 */
export function hasWordsToWrite(item: { status: string; note?: string | null; gates: { gate: string; result: string }[] }): boolean {
  if (item.status !== 'quarantined' || item.note) return true;
  const failed = item.gates.filter((g) => g.result === 'fail');
  return failed.length > 0 && failed.every((g) => g.gate === 'V3');
}

export class RepertoireService {
  private readonly db: Db;
  private readonly engine: EngineService;
  private readonly replies: (fen: string) => Promise<ReplySource | null>;
  /** Maia's probabilities at the owner's level: which sound move people at that level find most often */
  private readonly human: (fen: string) => Promise<{ uci: string; p: number }[] | null>;
  /** the facts and the validator's settings, for V3 over the authored words (WP 8.6) */
  private readonly words?: { facts: FactService; ladder?: ConceptLadder; vocabulary: () => VocabularyLevel };
  private readonly options: () => RepertoireOptions;
  private readonly storedUnderData: boolean;
  private readonly onProgress: (p: RepertoireProgress) => void;
  /** the masters' games at a position (the book, WP 8.12) */
  private readonly book?: (fen: string) => Promise<BookTable | null>;
  /** what players at the owner's level reply, from counted games only (a book build takes those that are book too) */
  private readonly level: (fen: string, hint: { games?: number }) => Promise<ReplySource | null>;
  /** the opening's name along a line, from the book of names */
  private readonly openingName?: (fens: string[]) => string | undefined;

  constructor(o: {
    db: Db;
    engine: EngineService;
    replies: (fen: string) => Promise<ReplySource | null>;
    human?: (fen: string) => Promise<{ uci: string; p: number }[] | null>;
    book?: (fen: string) => Promise<BookTable | null>;
    level?: (fen: string, hint: { games?: number }) => Promise<ReplySource | null>;
    openingName?: (fens: string[]) => string | undefined;
    words?: { facts: FactService; ladder?: ConceptLadder; vocabulary: () => VocabularyLevel };
    options: () => RepertoireOptions;
    dataDir: string;
    dbFile: string;
    onProgress?: (p: RepertoireProgress) => void;
  }) {
    this.db = o.db;
    this.words = o.words;
    this.engine = o.engine;
    this.replies = o.replies;
    this.human = o.human ?? (async () => null);
    this.book = o.book;
    this.level = o.level ?? (async () => null);
    this.openingName = o.openingName;
    this.options = o.options;
    this.storedUnderData = isUnder(o.dbFile, o.dataDir);
    this.onProgress = o.onProgress ?? (() => {});
  }

  /**
   * A repertoire from the book around an outline (features D10, D11; WP 8.12): see core/repbuild.ts.
   * My moves must pass V2's and V7's rules while the lines are built, so the gates that follow find
   * the engine's answers already worked out. The repertoire built from an outline before is built
   * again in place (its id, its words and its drill history stay; lines no longer built are removed,
   * logged). A build that is stopped saves nothing.
   */
  async buildFromOutline(outline: Outline, b: BookRequest): Promise<{ stopped: true } | { stopped: false; report: RepertoireReport; plan: BookPlan }> {
    if (!this.book) throw new Error("the masters' games cannot be asked from here");
    const o = this.options();
    const date = b.date ?? new Date().toISOString().slice(0, 10);
    const engineName = this.engine.signature.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'stockfish';
    const source = `generated:${engineName}:${date}:outline-${outline.id}`;
    const existing = this.db.repertoireByOutline(outline.id);
    const id = existing ?? this.db.addRepertoire({ name: outline.name, colour: outline.colour, source, licence: 'project', level: b.level });
    if (!existing) this.db.setRepertoirePlan(id, { plan: null, outline: outline.id });
    const v2bad = (g: GradeResult | null) => !g || g.drop > o.maxDrop || !!g.floor || g.cls === 'mistake' || g.cls === 'blunder';
    const v7bad = (g: GradeResult | null) => !g || g.cls === 'mistake' || g.cls === 'blunder';
    let result: BookBuildResult;
    try {
      result = await buildFromBook(
        { colour: outline.colour, depth: b.depth, budget: b.budget, minGames: b.minGames, bookRule: b.bookRule, levelRule: b.levelRule, outline, outlineReach: b.outlineReach, batch: b.batch ?? 8 },
        {
          book: this.book,
          level: (fen, hint) => this.level(fen, hint),
          sound: async (fen, uci, san) => {
            const colour = mustPosition(fen).turn;
            if (v2bad(await this.grade(fen, uci, san, colour, o.nodes, o))) return false;
            return !v7bad(await this.grade(fen, uci, san, colour, o.secondNodes, o));
          },
          punish: (fen, uci, san) => this.isMistake(fen, uci, san, o),
          wait: b.wait,
          progress: (p) => {
            b.progress?.(p);
            this.onProgress({ repertoire: id, step: 'build', done: p.lines, total: p.budget });
          },
          openingName: this.openingName,
        },
      );
    } catch (e) {
      if (!existing) this.db.removeRepertoire(id);
      throw e;
    }
    if (result.stopped) {
      if (!existing) this.db.removeRepertoire(id);
      this.onProgress({ repertoire: id, step: 'done', done: 0, total: 0 });
      return { stopped: true };
    }
    const lines = result.lines.map((l) => ({ ...l, repertoire: id }));
    // the lines this build no longer makes go (their drill cards follow them out of the drill)
    const keep = new Set(lines.map(lineKey));
    const gone = this.db.repertoireItems<RepLine>(id).filter((i) => !keep.has(i.key));
    for (const g of gone) this.db.deleteContent(g.id);
    if (gone.length) this.db.logEvent('repertoire_rebuilt', { id, removed: gone.map((g) => ({ line: lineText(g.body.startFen, g.body.moves), status: g.status })) });
    const plan: BookPlan = {
      kind: 'book',
      outline: { id: outline.id, hash: b.hash, name: outline.name },
      depth: b.depth,
      budget: b.budget,
      minGames: b.minGames,
      outlineReach: b.outlineReach,
      bookRule: b.bookRule,
      levelRule: b.levelRule,
      built: { at: new Date().toISOString(), engine: this.engine.signature, lines: lines.length, prepared: result.prepared, cut: result.cut, notes: result.notes, chapters: result.chapters },
    };
    this.db.setRepertoirePlan(id, { plan, outline: outline.id, source, name: outline.name, level: b.level });
    this.db.setRepBook(id, [...result.positions.values()].map((p) => ({ key: p.key, data: p })), true);
    this.db.logEvent('repertoire_built', { id, outline: outline.id, lines: lines.length, cut: result.cut, notes: result.notes.length });
    const report = await this.run(id, lines, { source, licence: 'project', level: b.level }, { duplicates: 0, skipped: [] });
    return { stopped: false, report, plan };
  }

  /**
   * V4 for a repertoire built from the book, against what the build kept. A position the build did
   * not see (a line the owner fixed) is asked of the book now and kept; at an opponent's position
   * the replies to answer are then the book rule's.
   */
  private async bookGate(id: number, lines: RepLine[], kept: boolean[], plan: BookPlan): Promise<{ gates: GateResult[]; coverage: Coverage[] }> {
    const stored = this.db.repBook<BuildPosition>(id);
    const fresh: BuildPosition[] = [];
    for (const [i, line] of lines.entries()) {
      if (!kept[i]) continue;
      for (const s of lineSteps(line).steps) {
        const key = positionKey(s.fenBefore);
        if (stored.has(key)) continue;
        const book = this.book ? await this.book(s.fenBefore).catch(() => null) : null;
        const p: BuildPosition = { key, fen: s.fenBefore, reach: 0, book };
        if (!s.mine && book && book.games >= plan.minGames) {
          p.required = repliesToPrepare(book.moves.map((m) => ({ uci: m.uci, san: m.san, share: m.games })), plan.bookRule)
            .take.map((r) => ({ uci: r.uci, san: r.san, games: book.moves.find((m) => m.uci === r.uci)!.games, why: ['book' as const] }))
            .filter((r) => r.games >= plan.minGames);
        }
        stored.set(key, p);
        if (book) fresh.push(p);
      }
    }
    if (fresh.length) this.db.setRepBook(id, fresh.map((p) => ({ key: p.key, data: p })));
    return gateV4Book(lines, kept, stored, { minGames: plan.minGames, depth: plan.depth });
  }

  /** A move of mine graded at a node budget: the engine's best first, then the move itself when it is not the best (the same searches the gates make, so they are worked out once). */
  private async grade(fen: string, uci: string, san: string, you: Color, nodes: number, o: RepertoireOptions): Promise<GradeResult | null> {
    const before = await this.engine.analyse({ fen, nodes, multipv: 1, pool: 'analysis' });
    const best = before.lines[0];
    const played = best && best.pv[0] === uci ? best : (await this.engine.analyse({ fen, nodes, multipv: 1, searchmoves: [uci], pool: 'analysis' })).lines[0];
    return best && played ? gradeMove({ fenBefore: fen, san, evalBefore: { fen, lines: [best] }, playedLine: played, you, thresholds: o.thresholds }) : null;
  }

  /** A PGN as a new repertoire for one side: every line through the gates, stored with its status; the report kept with the repertoire. */
  async importPgn(text: string, r: { name: string; colour: Color; source: string; licence: Licence; level: string }): Promise<RepertoireReport> {
    const read = repertoireLines(text, r.colour);
    const id = this.db.addRepertoire({ name: r.name, colour: r.colour, source: r.source, licence: r.licence, level: r.level });
    const lines = read.lines.map((l) => ({ ...l, repertoire: id }));
    return this.run(id, lines, { source: r.source, licence: r.licence, level: r.level }, { duplicates: read.duplicates, skipped: read.skipped });
  }

  /**
   * The starter builder (feature D1; CONTENT §7; WP 8.5). Breadth-first from the start, down to the
   * level's depth:
   *   my move: the seed's, when it is sound; otherwise, among the moves the engine finds sound, the one
   *            players at the owner's level choose most often (Maia), the engine's first when Maia cannot say;
   *   the opponent's: the replies players at the owner's level really play, most played first, until
   *            the coverage is reached and no reply left is common enough for V4 to name (5%), never
   *            one under 3%; a position reached in fewer than
   *            `minReach`% of games from the start is not prepared. A reply the engine calls a mistake
   *            is marked "punish".
   * Every move comes from the engine's sound moves or from games people played (D33). The lines then
   * go through the same gates as an imported PGN. The same seeds, settings and cached answers give the
   * same repertoire.
   */
  async buildStarter(b: BuildRequest): Promise<RepertoireReport> {
    const o = this.options();
    const date = b.date ?? new Date().toISOString().slice(0, 10);
    const engineName = this.engine.signature.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'stockfish';
    const source = `generated:${engineName}:${date}:starter-builder`;
    const id = this.db.addRepertoire({ name: b.name, colour: b.colour, source, licence: 'project', level: b.level });
    const seeds = seedMoves(b.seeds, b.colour);
    type Walk = { fen: string; moves: string[]; reach: number; punish: number[]; mine: number };
    const lines: RepLine[] = [];
    const finish = (w: Walk) => {
      if (w.moves.length) lines.push({ repertoire: id, colour: b.colour, startFen: START_FEN, moves: w.moves, punish: w.punish.length ? w.punish : undefined });
    };
    const chosen = new Map<string, { uci: string; san: string } | null>();
    let level: Walk[] = [{ fen: START_FEN, moves: [], reach: 100, punish: [], mine: 0 }];
    let positions = 0;
    while (level.length) {
      const next: Walk[] = [];
      for (const w of level) {
        this.onProgress({ repertoire: id, step: 'build', done: ++positions, total: positions + level.length });
        const pos = mustPosition(w.fen);
        if (pos.isEnd()) {
          finish(w);
          continue;
        }
        if (pos.turn === b.colour) {
          const key = positionKey(w.fen);
          if (!chosen.has(key)) chosen.set(key, await this.chooseMine(w.fen, seeds.get(key), o));
          const mine = chosen.get(key);
          if (!mine) {
            finish(w);
            continue;
          }
          next.push({ ...w, fen: fenAfter(w.fen, mine.uci), moves: [...w.moves, mine.san], mine: w.mine + 1 });
          continue;
        }
        // the opponent's turn: prepared only while within the level's depth
        if (w.mine >= o.depthMoves) {
          finish(w);
          continue;
        }
        const r = await this.replies(w.fen).catch(() => null);
        const total = r ? r.replies.reduce((a, x) => a + x.share, 0) : 0;
        const ordered = r && total > 0 ? [...r.replies].sort((x, y) => y.share - x.share || x.uci.localeCompare(y.uci)) : [];
        const picked: { uci: string; share: number }[] = [];
        let covered = 0;
        for (const rep of ordered) {
          const share = (rep.share * 100) / total;
          // enough once the coverage is reached and no reply left is common enough for V4 to name; never below the floor
          if ((covered >= o.minCovered && share < o.flagShare) || share < REPLY_FLOOR) break;
          covered += share;
          if ((w.reach * share) / 100 < b.minReach) continue; // too rare to prepare, counted from the start
          if (!uciToMove(pos, rep.uci)) continue;
          picked.push({ uci: rep.uci, share });
        }
        if (!picked.length) {
          finish(w);
          continue;
        }
        for (const p of picked) {
          const san = describeMove(pos, uciToMove(pos, p.uci)!).san;
          const punish = (await this.isMistake(w.fen, p.uci, san, o)) ? [...w.punish, w.moves.length] : w.punish;
          next.push({ fen: fenAfter(w.fen, p.uci), moves: [...w.moves, san], reach: (w.reach * p.share) / 100, punish, mine: w.mine });
        }
      }
      level = next;
    }
    return this.run(id, lines, { source, licence: 'project', level: b.level }, { duplicates: 0, skipped: [] });
  }

  /**
   * V3 for the authored words (WP 8.6): each position of mine on a line may carry the why of my move
   * and the opponent's idea, written once per position. Every sentence is checked like a live coach
   * message, against the facts of that position (its packet, and check_move for my move), with the
   * opponent's last move nameable. A position whose words fail quarantines the lines through it; a
   * position with no words yet passes with a note (8.8's cards show the why when it is there).
   */
  private async wordsGate(id: number, lines: RepLine[], kept: boolean[]): Promise<GateResult[]> {
    const texts = this.db.repTexts(id);
    const checked = new Map<string, string | null>();
    const out: GateResult[] = [];
    for (const [i, line] of lines.entries()) {
      if (!kept[i]) {
        out.push({ gate: 'V3', result: 'n/a' });
        continue;
      }
      const steps = lineSteps(line).steps;
      let fail: GateResult | null = null;
      let missing = 0;
      let written = 0;
      for (const [k, s] of steps.entries()) {
        if (!s.mine) continue;
        const key = positionKey(s.fenBefore);
        const t = texts.get(key);
        if (!t || t.uci !== s.uci || (!t.why && !t.idea)) {
          missing++;
          continue;
        }
        written++;
        if (!checked.has(key)) {
          const prev = k > 0 ? steps[k - 1] : undefined;
          checked.set(key, await this.checkWords(s.fenBefore, s.san, line.colour, prev && !prev.mine ? { san: prev.san, baseFen: prev.fenBefore } : undefined, t));
        }
        const problem = checked.get(key);
        if (problem) {
          fail = { gate: 'V3', result: 'fail', detail: `at ${lineText(line.startFen, line.moves, s.index + 1)}: ${problem}`, at: s.index };
          break;
        }
      }
      if (fail) out.push(fail);
      else if (!written) out.push({ gate: 'V3', result: 'pass', detail: line.notes ? "no words of the coach's yet; the author's notes are kept as written and shown as theirs" : 'no words written yet' });
      else out.push(missing ? { gate: 'V3', result: 'pass', detail: `${written} of ${written + missing} moves have their words; the rest are still to be written` } : { gate: 'V3', result: 'pass' });
    }
    return out;
  }

  /** One position's words through the validator; the problem in plain words, or null. */
  private async checkWords(fen: string, san: string, you: Color, last: { san: string; baseFen: string } | undefined, t: { why?: string; idea?: string }): Promise<string | null> {
    if (!this.words) return 'not checked: the facts are not available here';
    const { facts, ladder, vocabulary } = this.words;
    const packet = await facts.packet({ fen, you, deep: true, lastMove: last ? { san: last.san, by: 'opponent', fenBefore: last.baseFen } : undefined });
    const move = await facts.checkMove(fen, san, you);
    const claims = [...packet.facts, ...(move.legal ? move.facts : [])].map((f) => f.id);
    for (const [what, text] of [['the why', t.why], ["the opponent's idea", t.idea]] as const) {
      if (!text?.trim()) continue;
      const v = validateSay({ kind: 'explain', text, claims }, { fen, you, fact: facts.fact, budgetSentences: 2, canAnswer: true, vocabulary: vocabulary(), ladder, lastMove: last });
      if (!v.ok) return `${what} "${text.trim()}": ${v.problems.map((p) => p.message).join(' ')}`;
    }
    return null;
  }

  /**
   * The authoring worksheet (WP 8.6, the author-repertoire skill): every position of mine on the lines
   * still in, once each, with the move, the opponent's last move, the words written so far and the
   * facts the words may state (the same facts V3 checks them against).
   */
  async worksheet(id: number, only: { chapter?: string; missing?: boolean; depth?: number } = {}): Promise<{ key: string; line: string; chapter?: string; fen: string; move: string; last?: string; why?: string; idea?: string; facts: string[] }[]> {
    if (!this.words) throw new Error('the facts are not available here');
    const { facts } = this.words;
    const texts = this.db.repTexts(id);
    const seen = new Set<string>();
    // the positions first, in the repertoire's teaching order; then their facts, a few at a time (the engine's workers)
    const wanted: { key: string; s: ReturnType<typeof lineSteps>['steps'][number]; prev?: ReturnType<typeof lineSteps>['steps'][number]; line: RepLine }[] = [];
    const items = this.db.repertoireItems<RepLine>(id).sort((a, b) => (a.body.order ?? a.id) - (b.body.order ?? b.id));
    for (const item of items) {
      if (!hasWordsToWrite(item)) continue;
      if (only.chapter && item.body.chapter !== only.chapter) continue;
      const steps = lineSteps(item.body).steps;
      let mine = 0;
      for (const [k, s] of steps.entries()) {
        if (!s.mine) continue;
        if (only.depth && ++mine > only.depth) break;
        const key = positionKey(s.fenBefore);
        if (seen.has(key)) continue;
        seen.add(key);
        const t = texts.get(key);
        if (only.missing && t?.uci === s.uci && (t.why || t.idea)) continue;
        wanted.push({ key, s, prev: k > 0 && !steps[k - 1]!.mine ? steps[k - 1] : undefined, line: item.body });
      }
    }
    const out: Awaited<ReturnType<RepertoireService['worksheet']>> = Array.from({ length: wanted.length });
    let next = 0;
    const work = async () => {
      for (let i = next++; i < wanted.length; i = next++) {
        const { key, s, prev, line } = wanted[i]!;
        const packet = await facts.packet({ fen: s.fenBefore, you: line.colour, deep: true, lastMove: prev ? { san: prev.san, by: 'opponent', fenBefore: prev.fenBefore } : undefined });
        const move = await facts.checkMove(s.fenBefore, s.san, line.colour);
        const t = texts.get(key);
        out[i] = {
          key,
          line: lineText(line.startFen, line.moves, s.index + 1),
          chapter: line.chapter,
          fen: s.fenBefore,
          move: s.san,
          last: prev?.san,
          why: t?.uci === s.uci ? t.why : undefined,
          idea: t?.uci === s.uci ? t.idea : undefined,
          // what the words may state; castling and "nothing is attacked" say nothing about the move, and the same fact twice is shown once
          facts: [...new Set([...packet.facts, ...(move.legal ? move.facts : [])].filter((f) => f.type !== 'castling' && f.type !== 'quiet').map((f) => `${f.type}: ${f.text.replace(/\{m:([^}@]+)@[^}]+\}/g, '{m:$1}')}`))],
        };
      }
    };
    await Promise.all(Array.from({ length: 6 }, work));
    return out;
  }

  /** A repertoire's chapters with how far their words are written (the positions of mine on lines still in). */
  wordsByChapter(id: number): { chapter: string; lines: number; positions: number; written: number }[] {
    const texts = this.db.repTexts(id);
    const seen = new Set<string>();
    const out = new Map<string, { chapter: string; lines: number; positions: number; written: number; order: number }>();
    for (const item of this.db.repertoireItems<RepLine>(id)) {
      if (!hasWordsToWrite(item)) continue;
      const name = item.body.chapter ?? '(no chapter)';
      const c = out.get(name) ?? { chapter: name, lines: 0, positions: 0, written: 0, order: Infinity };
      c.lines++;
      c.order = Math.min(c.order, item.body.order ?? item.id);
      for (const s of lineSteps(item.body).steps) {
        const key = positionKey(s.fenBefore);
        if (!s.mine || seen.has(key)) continue;
        seen.add(key);
        c.positions++;
        const t = texts.get(key);
        if (t?.uci === s.uci && (t.why || t.idea)) c.written++;
      }
      out.set(name, c);
    }
    return [...out.values()].sort((a, b) => a.order - b.order).map(({ order: _o, ...c }) => c);
  }

  /** Keep the authored words of positions of mine (by key), then run the repertoire's gates again so V3 checks them. */
  async setWords(id: number, entries: { key: string; why?: string; idea?: string }[], opts: { full?: boolean } = {}): Promise<{ ok: true; report: RepertoireReport; unknown: string[] } | { ok: false; reason: string }> {
    if (!this.db.repertoire(id)) return { ok: false, reason: 'There is no such repertoire.' };
    const mine = new Map<string, { fen: string; uci: string; san: string }>();
    for (const item of this.db.repertoireItems<RepLine>(id)) for (const s of lineSteps(item.body).steps) if (s.mine && !mine.has(positionKey(s.fenBefore))) mine.set(positionKey(s.fenBefore), { fen: s.fenBefore, uci: s.uci, san: s.san });
    const unknown: string[] = [];
    for (const e of entries) {
      const at = mine.get(e.key);
      if (!at) {
        unknown.push(e.key);
        continue;
      }
      this.db.setRepText(id, e.key, { ...at, why: e.why?.trim() || undefined, idea: e.idea?.trim() || undefined });
    }
    this.db.logEvent('repertoire_words', { id, positions: entries.length - unknown.length });
    // words change only V3: the lines through the positions written are checked again (every gate with `full`)
    const changed = new Set(entries.map((e) => e.key).filter((k) => mine.has(k)));
    const report = opts.full ? await this.revalidate(id) : await this.recheckWords(id, changed);
    return report ? { ok: true, report, unknown } : { ok: false, reason: 'There is no such repertoire.' };
  }

  /**
   * V3 again for the lines through some positions of mine (their words changed); every other gate's
   * result stays as stored. The line's status follows, with the owner's decisions kept as in a full run.
   */
  private async recheckWords(id: number, keys: Set<string>): Promise<RepertoireReport | null> {
    const rep = this.db.repertoire(id);
    if (!rep) return null;
    const o = this.options();
    const touched = this.db.repertoireItems<RepLine>(id).filter((it) => lineSteps(it.body).steps.some((s) => s.mine && keys.has(positionKey(s.fenBefore))));
    // as in a full run, V3 is checked only on lines that passed V1, V2 and V5
    const kept = touched.map((it) => (['V1', 'V2', 'V5'] as GateId[]).every((g) => it.gates.find((x) => x.gate === g)?.result === 'pass'));
    const v3 = await this.wordsGate(id, touched.map((t) => t.body), kept);
    const failed = (gates: GateResult[]) => gates.filter((g) => g.result === 'fail').map((g) => g.gate).sort().join(',');
    for (const [i, it] of touched.entries()) {
      if (!kept[i]) continue;
      const gates = it.gates.map((g) => (g.gate === 'V3' ? v3[i]! : g));
      const checked = statusAfter('repertoire', gates);
      let status: ContentStatus = checked === 'quarantined' ? 'quarantined' : o.autoApprove ? 'live' : 'machine-verified';
      if (it.status === 'live') {
        if (checked !== 'quarantined') status = 'live';
        else if (it.note && failed(it.gates) === failed(gates)) status = 'live';
      }
      this.db.saveContent(it.key, { type: 'repertoire', status, source: it.source, licence: it.licence, level: it.level, engine: it.engine, gates, body: it.body, note: it.note });
    }
    return this.recount(id);
  }

  /** The stored report's counts, quarantine list, gate tallies and spot-check sample, from the lines as they now stand (the coverage stays). */
  private recount(id: number): RepertoireReport | null {
    const rep = this.db.repertoire(id);
    const old = rep?.report as RepertoireReport | undefined;
    if (!rep || !old) return null;
    const items = this.db.repertoireItems<RepLine>(id);
    const count = (s: ContentStatus) => items.filter((x) => x.status === s).length;
    const gates: RepertoireReport['gates'] = {};
    for (const gid of GATES_FOR.repertoire) {
      const t = { pass: 0, fail: 0, flag: 0, na: 0 };
      for (const it of items) {
        const g = it.gates.find((x) => x.gate === gid);
        if (!g || g.result === 'n/a') t.na++;
        else t[g.result]++;
      }
      gates[gid] = t;
    }
    const passing = items.filter((x) => x.status !== 'quarantined');
    const report: RepertoireReport = {
      ...old,
      at: new Date().toISOString(),
      lines: items.length,
      live: count('live'),
      verified: count('machine-verified'),
      quarantined: count('quarantined'),
      flagged: passing.filter((x) => x.gates.some((g) => g.result === 'flag')).length,
      quarantine: items.filter((x) => x.status === 'quarantined').map((x) => ({ id: x.id, line: lineText(x.body.startFen, x.body.moves), reasons: quarantineReasons(x) })),
      sample: spotCheckSample(passing.length, id).map((k) => ({ id: passing[k]!.id, line: lineText(passing[k]!.body.startFen, passing[k]!.body.moves) })),
      gates,
    };
    this.db.setRepertoireReport(id, report);
    this.db.logEvent('repertoire_gated', { id, lines: report.lines, quarantined: report.quarantined, flagged: report.flagged, words: true });
    return report;
  }

  /** My move in a position: the seed's when it is sound, else the sound move people at the owner's level choose most often. */
  private async chooseMine(fen: string, seed: { uci: string; san: string } | undefined, o: RepertoireOptions): Promise<{ uci: string; san: string } | null> {
    const pos = mustPosition(fen);
    const unsound = (g: GradeResult | null) => !g || g.drop > o.maxDrop || !!g.floor || g.cls === 'mistake' || g.cls === 'blunder';
    const ev = await this.engine.analyse({ fen, nodes: o.nodes, multipv: 4, pool: 'analysis' });
    const best = ev.lines[0];
    if (!best) return null;
    const grade = async (uci: string, san: string) => {
      const line = ev.lines.find((l) => l.pv[0] === uci) ?? (await this.engine.analyse({ fen, nodes: o.nodes, multipv: 1, searchmoves: [uci], pool: 'analysis' })).lines[0];
      return line ? gradeMove({ fenBefore: fen, san, evalBefore: { fen, lines: [best] }, playedLine: line, you: pos.turn, thresholds: o.thresholds }) : null;
    };
    if (seed && !unsound(await grade(seed.uci, seed.san))) return seed;
    const sound: { uci: string; san: string }[] = [];
    for (const l of ev.lines) {
      const m = uciToMove(pos, l.pv[0]!);
      if (!m) continue;
      const san = describeMove(pos, m).san;
      if (!unsound(await grade(l.pv[0]!, san))) sound.push({ uci: l.pv[0]!, san });
    }
    if (!sound.length) return null;
    const probs = await this.human(fen).catch(() => null);
    if (!probs?.length) return sound[0]!;
    const p = (uci: string) => probs.find((x) => x.uci === uci)?.p ?? 0;
    // the most often chosen; on a tie, the engine's order
    return sound.reduce((a, c) => (p(c.uci) > p(a.uci) ? c : a), sound[0]!);
  }

  /** Is the opponent's reply a mistake the owner should punish? (graded from the opponent's side, like any move) */
  private async isMistake(fen: string, uci: string, san: string, o: RepertoireOptions): Promise<boolean> {
    const pos = mustPosition(fen);
    const ev = await this.engine.analyse({ fen, nodes: o.nodes, multipv: 1, pool: 'analysis' });
    const best = ev.lines[0];
    if (!best) return false;
    const line = best.pv[0] === uci ? best : (await this.engine.analyse({ fen, nodes: o.nodes, multipv: 1, searchmoves: [uci], pool: 'analysis' })).lines[0];
    if (!line) return false;
    const g = gradeMove({ fenBefore: fen, san, evalBefore: { fen, lines: [best] }, playedLine: line, you: pos.turn, thresholds: o.thresholds });
    return !!g && (g.cls === 'mistake' || g.cls === 'blunder');
  }

  /** Run every gate over a repertoire's lines again (a changed engine or threshold: WP 8.11), keeping their ids. */
  async revalidate(id: number, because?: string): Promise<RepertoireReport | null> {
    const rep = this.db.repertoire(id);
    if (!rep) return null;
    const items = this.db.repertoireItems<RepLine>(id);
    const old = rep.report as RepertoireReport | undefined;
    return this.run(id, items.map((i) => i.body), { source: rep.source, licence: rep.licence as Licence, level: rep.level ?? '400–700' }, { duplicates: old?.duplicates ?? 0, skipped: old?.skipped ?? [] }, because);
  }

  /**
   * The owner's fix for a quarantined line (the review screen): the line becomes `moves` (the board's
   * line, which must start like this one and change it at or before the move that failed), and the
   * repertoire's gates run again, so the new move is checked like every other.
   */
  async fixLine(itemId: number, moves: string[]): Promise<{ ok: true; report: RepertoireReport } | { ok: false; reason: string }> {
    const item = this.db.getContent(itemId) as unknown as (ContentItem<RepLine> & { id: number }) | undefined;
    if (!item || item.type !== 'repertoire') return { ok: false, reason: 'That line is not here any more.' };
    const at = Math.min(...item.gates.filter((g) => g.result === 'fail' && typeof g.at === 'number').map((g) => g.at!));
    if (!Number.isFinite(at)) return { ok: false, reason: 'Nothing in this line names a move to change.' };
    const clean = (s: string) => s.replace(/[+#!?]+$/g, '');
    const same = item.body.moves.slice(0, at).every((m, i) => clean(m) === clean(moves[i] ?? ''));
    if (!same || moves.length <= at) return { ok: false, reason: `Play the line on the board up to ${lineText(item.body.startFen, item.body.moves, at)}, then your move instead.` };
    if (clean(moves[at]!) === clean(item.body.moves[at]!) && moves.length === item.body.moves.length) return { ok: false, reason: 'The board shows the same move: play another one there first.' };
    const line: RepLine = { ...item.body, moves, notes: undefined };
    this.db.deleteContent(itemId);
    this.db.saveContent(lineKey(line), { ...item, status: 'draft', gates: [], body: line, note: undefined });
    this.db.logEvent('content_decision', { id: itemId, action: 'fix', from: item.body.moves, to: moves });
    const report = await this.revalidate(item.body.repertoire);
    return report ? { ok: true, report } : { ok: false, reason: 'The repertoire is not here any more.' };
  }

  report(id: number): RepertoireReport | undefined {
    return this.db.repertoire(id)?.report as RepertoireReport | undefined;
  }

  private async run(id: number, lines: RepLine[], env: { source: string; licence: Licence; level: string }, read: { duplicates: number; skipped: RepertoireReport['skipped'] }, because?: string): Promise<RepertoireReport> {
    const o = this.options();
    const rep = this.db.repertoire(id)!;
    const total = lines.length;
    const progress = (step: RepertoireProgress['step'], done: number, of = total) => this.onProgress({ repertoire: id, step, done, total: of });

    // V1
    progress('V1', 0);
    const v1 = lines.map(gateV1Line);
    const legal = v1.map((g) => g.result === 'pass');

    // V2: each distinct move of mine is searched once, however many lines share it
    const v2 = await this.soundness(lines, legal, o.nodes, o, (g) => !!g && (g.drop > o.maxDrop || !!g.floor || g.cls === 'mistake' || g.cls === 'blunder'), 'V2', (done, of) => progress('V2', done, of));
    const sound = legal.map((ok, i) => ok && v2[i]!.result === 'pass');

    // V5 across the lines
    const v5 = gateV5Lines(lines, sound, o.depthMoves);
    const kept = sound.map((ok, i) => ok && v5[i]!.result === 'pass');

    // V4 (the explorer, paced) and V7 (the engine, deeper) side by side, over the lines still in.
    // A repertoire built from the book is checked against the book the build kept (every move book,
    // every reply the rule asked for answered); any other against what players at the owner's level reply.
    const plan = rep.plan as BookPlan | null | undefined;
    const bookPlan = plan?.kind === 'book' ? plan : undefined;
    const spots = bookPlan ? new Map() : opponentSpots(lines, kept, o.depthMoves);
    const coverage = new Map<string, Coverage | null>();
    let v4Book: { gates: GateResult[]; coverage: Coverage[] } | null = null;
    if (bookPlan) v4Book = await this.bookGate(id, lines, kept, bookPlan);
    const v4Run = (async () => {
      let done = 0;
      progress('V4', 0, spots.size);
      for (const spot of spots.values()) {
        const r = await this.replies(spot.fen).catch(() => null);
        coverage.set(spot.key, r && r.replies.length ? coverageOf(spot, r, { minCovered: o.minCovered, flagShare: o.flagShare }) : null);
        progress('V4', ++done, spots.size);
      }
    })();
    const v7Run = this.soundness(lines, kept, o.secondNodes, o, (g) => !!g && (g.cls === 'mistake' || g.cls === 'blunder'), 'V7', (done, of) => progress('V7', done, of));
    const [, v7] = await Promise.all([v4Run, v7Run]);
    const v3 = await this.wordsGate(id, lines, kept);

    const engine = `${this.engine.signature}, ${o.nodes} nodes (V2), ${o.secondNodes} nodes (V7)`;
    const notRun = (gate: GateId, why: string): GateResult => ({ gate, result: 'n/a', detail: `not run: ${why}` });
    const before = new Map(this.db.repertoireItems<RepLine>(id).map((x) => [x.key, x]));
    const items: (ContentItem<RepLine> & { key: string })[] = lines.map((line, i) => {
      const gates: GateResult[] = [v1[i]!];
      gates.push(legal[i] ? v2[i]! : notRun('V2', 'the line is not legal'));
      gates.push(kept[i] ? v3[i]! : notRun('V3', 'the line failed an earlier gate'));
      gates.push(kept[i] ? (v4Book ? v4Book.gates[i]! : gateV4Line(i, spots, coverage)) : notRun('V4', 'the line failed an earlier gate'));
      gates.push(legal[i] ? v5[i]! : notRun('V5', 'the line is not legal'));
      gates.push(kept[i] ? v7[i]! : notRun('V7', 'the line failed an earlier gate'));
      // a re-check after the engine or a threshold changed (WP 8.11): a failure of the engine's gates says so
      if (because) for (const g of gates) if ((g.gate === 'V2' || g.gate === 'V7') && g.result === 'fail') g.detail = `${g.detail} (${because})`;
      const item: ContentItem<RepLine> & { key: string } = { key: lineKey(line), type: 'repertoire', status: 'draft', source: env.source, licence: env.licence, level: env.level, engine, gates, body: line };
      item.gates.push(gateV6(item, { storedUnderData: this.storedUnderData, engineRan: true }));
      const checked = statusAfter('repertoire', item.gates);
      item.status = checked === 'quarantined' ? 'quarantined' : o.autoApprove ? 'live' : 'machine-verified';
      // what the owner decided stays decided: a line they approved stays live while it passes; one they
      // accepted with a note stays live while it fails the same gates (a new failure puts it back in quarantine)
      const was = before.get(item.key);
      if (was?.status === 'live') {
        const failed = (x: ContentItem) => x.gates.filter((g) => g.result === 'fail').map((g) => g.gate).sort().join(',');
        if (checked !== 'quarantined') item.status = 'live';
        else if (was.note && failed(was) === failed(item)) item.status = 'live';
        item.note = was.note;
      }
      return item;
    });

    // keep them: the same line again is the same item (its drill history stays with it)
    const ids = items.map((item) => this.db.saveContent(item.key, item));
    const sampleIdx = spotCheckSample(items.filter((x) => x.status !== 'quarantined').length, id);
    const passing = items.map((x, i) => ({ x, id: ids[i]! })).filter((p) => p.x.status !== 'quarantined');
    const count = (s: ContentStatus) => items.filter((x) => x.status === s).length;
    const gates: RepertoireReport['gates'] = {};
    for (const gid of GATES_FOR.repertoire) {
      const t = { pass: 0, fail: 0, flag: 0, na: 0 };
      for (const it of items) {
        const g = it.gates.find((x) => x.gate === gid);
        if (!g || g.result === 'n/a') t.na++;
        else t[g.result]++;
      }
      gates[gid] = t;
    }
    const report: RepertoireReport = {
      id,
      name: rep.name,
      colour: rep.colour,
      at: new Date().toISOString(),
      engine,
      lines: items.length,
      live: count('live'),
      verified: count('machine-verified'),
      quarantined: count('quarantined'),
      flagged: items.filter((x) => x.status !== 'quarantined' && x.gates.some((g) => g.result === 'flag')).length,
      duplicates: read.duplicates,
      skipped: read.skipped,
      quarantine: items.map((x, i) => ({ x, id: ids[i]! })).filter((p) => p.x.status === 'quarantined').map((p) => ({ id: p.id, line: lineText(p.x.body.startFen, p.x.body.moves), reasons: quarantineReasons(p.x) })),
      coverage: v4Book ? v4Book.coverage : [...coverage.values()].filter((c): c is Coverage => !!c),
      sample: sampleIdx.map((k) => ({ id: passing[k]!.id, line: lineText(passing[k]!.x.body.startFen, passing[k]!.x.body.moves) })),
      gates,
    };
    this.db.setRepertoireReport(id, report);
    this.db.logEvent('repertoire_gated', { id, lines: report.lines, quarantined: report.quarantined, flagged: report.flagged });
    progress('done', total);
    return report;
  }

  /**
   * V2 or V7: grade each distinct move of mine on the lines that count, at a node budget, and fail a
   * line at its first move that `bad` rejects. Moves shared by several lines are searched once.
   */
  private async soundness(lines: RepLine[], counts: boolean[], nodes: number, o: RepertoireOptions, bad: (g: GradeResult | null) => boolean, gate: 'V2' | 'V7', progress: (done: number, of: number) => void): Promise<GateResult[]> {
    const jobs = new Map<string, { fen: string; uci: string; san: string; colour: Color }>();
    const perLine = lines.map((line, i) => {
      if (!counts[i]) return [];
      return lineSteps(line)
        .steps.filter((s) => s.mine)
        .map((s) => {
          const key = `${positionKey(s.fenBefore)}|${s.uci}`;
          if (!jobs.has(key)) jobs.set(key, { fen: s.fenBefore, uci: s.uci, san: s.san, colour: line.colour });
          return { key, index: s.index };
        });
    });
    const graded = new Map<string, Graded>();
    let done = 0;
    progress(0, jobs.size);
    await Promise.all(
      [...jobs].map(async ([key, j]) => {
        const before = await this.engine.analyse({ fen: j.fen, nodes, multipv: 1, pool: 'analysis' });
        const best = before.lines[0];
        const played = best && best.pv[0] === j.uci ? best : (await this.engine.analyse({ fen: j.fen, nodes, multipv: 1, searchmoves: [j.uci], pool: 'analysis' })).lines[0];
        const g = best && played ? gradeMove({ fenBefore: j.fen, san: j.san, evalBefore: { fen: j.fen, lines: [best] }, playedLine: played, you: j.colour, thresholds: o.thresholds }) : null;
        graded.set(key, { g, san: j.san });
        progress(++done, jobs.size);
      }),
    );
    return lines.map((line, i) => {
      if (!counts[i]) return { gate, result: 'n/a' };
      for (const { key, index } of perLine[i]!) {
        const r = graded.get(key)!;
        if (!r.g) return { gate, result: 'fail', detail: `the engine gave no line for ${r.san} after ${lineText(line.startFen, line.moves, index)}`, at: index };
        if (bad(r.g)) {
          const what = r.g.lost ?? (gate === 'V2' ? `it loses ${Math.round(r.g.drop)} points of winning chances` : `a deeper search calls it a ${r.g.cls}`);
          return { gate, result: 'fail', detail: `${lineText(line.startFen, line.moves, index + 1)}: ${r.san} is not sound (${what}); the engine plays ${r.g.best} here (${nodes.toLocaleString('en-US')} nodes)`, at: index };
        }
      }
      return { gate, result: 'pass' };
    });
  }
}

function fenAfter(fen: string, uci: string): string {
  const pos = mustPosition(fen);
  return describeMove(pos, uciToMove(pos, uci)!).fenAfter;
}

function isUnder(file: string, dir: string): boolean {
  if (file === ':memory:') return true;
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

