// The gate runner (features J2, J3; CONTENT §1, §5; PLAN WP 6.1). An item comes in as a draft,
// goes through the gates that apply to its type, and comes out `machine-verified` or `quarantined`
// with the reason and the exact move or sentence. Approval makes it `live`; for puzzles that is
// automatic by default (a setting).
//
// Built so far: puzzles. V1 and V6 are in core; this file adds the two gates that need the
// engine and the facts:
//   V2  the solution is the only good move, or every good move is accepted;
//   V3  the explanation passes the same validator as a live coach message.

import path from 'node:path';
import {
  GATES_FOR,
  anyToMove,
  describeMove,
  dropOf,
  fenOf,
  gateV1Puzzle,
  gradeMove,
  gateV6,
  parsePosition,
  puzzleKey,
  quarantineReasons,
  solverStart,
  statusAfter,
  uciToMove,
  validateSay,
  type ConceptLadder,
  type ContentItem,
  type ContentStatus,
  type EngineLine,
  type GateResult,
  type Puzzle,
  type VocabularyLevel,
} from '@chess-coach/core';
import type { Db } from './db.ts';
import type { EngineService } from './engine/service.ts';
import type { FactService } from './facts-service.ts';

/**
 * How far below the solution another move must be for the solution to count as the only one:
 * 0.7 on Lichess's −1…+1 scale of winning chances (lichess-puzzler's rule), which is 35 points here.
 */
export const UNIQUE_MARGIN = 35;
/**
 * Is one line as good as another, from the same position? Close in winning chances, and winning
 * at least the same material once the captures have run their course. The second test matters in
 * a game that is won whatever is played: there every move is "winning", and only what a move
 * concretely wins tells the solution from a move that lets the piece go. The comparison is the
 * one the move labels use (gradeMove): `than` stands in for the best move, `other` for the move played.
 */
export function asGoodAs(fen: string, other: EngineLine, otherSan: string, than: EngineLine): boolean {
  const pos = parsePosition(fen);
  if (!pos) return false;
  if (other.pv[0] === than.pv[0]) return true;
  const g = gradeMove({ fenBefore: fen, san: otherSan, evalBefore: { fen, lines: [than] }, playedLine: other, you: pos.turn });
  if (!g) return dropOf(than.score, other.score) < UNIQUE_MARGIN;
  return g.drop < UNIQUE_MARGIN && g.playedDelta >= g.bestDelta - 0.5;
}

export type GateOptions = {
  /** nodes for V2 (CONTENT §5: 5M) */
  nodes: number;
  vocabulary: VocabularyLevel;
  /** approve what passes without asking (puzzles from games and from the database: on by default) */
  autoApprove: boolean;
};

export type StoredItem = ContentItem<Puzzle> & { id: number; key: string };

export class ContentService {
  private readonly db: Db;
  private readonly engine: EngineService;
  private readonly facts: FactService;
  private readonly ladder: ConceptLadder;
  private readonly dataDir: string;
  private readonly dbFile: string;
  private readonly options: () => GateOptions;

  constructor(o: { db: Db; engine: EngineService; facts: FactService; ladder: ConceptLadder; dataDir: string; dbFile: string; options: () => GateOptions }) {
    this.db = o.db;
    this.engine = o.engine;
    this.facts = o.facts;
    this.ladder = o.ladder;
    this.dataDir = o.dataDir;
    this.dbFile = o.dbFile;
    this.options = o.options;
  }

  /** Gate V2 for a puzzle: at each of the solver's moves, the solution is the only good move, or every good move is accepted. */
  async gateV2(p: Puzzle): Promise<GateResult> {
    const fail = (detail: string): GateResult => ({ gate: 'V2', result: 'fail', detail });
    const start = solverStart(p);
    if (!start.ok) return fail(start.reason);
    const pos = parsePosition(start.fen)!;
    const { nodes } = this.options();
    for (let i = 0; i < p.solution.length; i++) {
      const move = anyToMove(pos, p.solution[i]!);
      if (!move) return fail(`move ${i + 1} of the solution (${p.solution[i]}) is not legal`);
      const info = describeMove(pos, move);
      if (i % 2 === 0) {
        const fen = pos.clone();
        const accepted = new Set<string>([info.uci]);
        for (const alt of p.accepted?.[i] ?? []) {
          const m = anyToMove(fen, alt);
          if (m) accepted.add(describeMove(fen, m).uci);
        }
        // enough lines to see the first move that is not accepted
        const ev = await this.engine.analyse({ fen: fenOf(fen), nodes, multipv: accepted.size + 2, pool: 'analysis' });
        const best = ev.lines[0];
        if (!best) return fail(`the engine gave no line for move ${i + 1}`);
        const mine = ev.lines.find((l) => l.pv[0] === info.uci);
        const san = (uci: string) => {
          const m = uciToMove(fen, uci);
          return m ? describeMove(fen, m).san : uci;
        };
        // the solution itself must be about as good as the engine's first choice
        if (!mine || !asGoodAs(fenOf(fen), mine, info.san, best)) return fail(`move ${i + 1} of the solution (${info.san}) is not a good move here: the engine plays ${san(best.pv[0]!)}`);
        const mating = (mine.score.mate ?? 0) > 0;
        for (const other of ev.lines) {
          if (accepted.has(other.pv[0]!)) continue;
          // a mate is the answer when nothing else mates as fast; a mate in one accepts every mating move
          if (mating) {
            const alsoMates = (other.score.mate ?? 0) > 0 && other.score.mate! <= mine.score.mate!;
            if (alsoMates && mine.score.mate !== 1) return fail(`a second solution at move ${i + 1}: ${san(other.pv[0]!)} mates as fast as ${info.san}`);
            continue;
          }
          if (asGoodAs(fenOf(fen), other, san(other.pv[0]!), mine)) {
            return fail(`a second solution at move ${i + 1}: ${san(other.pv[0]!)} is about as good as ${info.san}. Accept it as an answer, or drop the puzzle`);
          }
        }
      }
      pos.play(move);
    }
    return { gate: 'V2', result: 'pass' };
  }

  /** Gate V3 for a puzzle: its explanation is checked like a coach message, against the facts of the solver's position and of the solution's first move. */
  async gateV3(p: Puzzle): Promise<GateResult> {
    if (!p.explanation?.trim()) return { gate: 'V3', result: 'pass', detail: 'no text to check' };
    const start = solverStart(p);
    if (!start.ok) return { gate: 'V3', result: 'fail', detail: start.reason };
    const you = parsePosition(start.fen)!.turn;
    const packet = await this.facts.packet({ fen: start.fen, you, deep: true });
    const checked = await this.facts.checkMove(start.fen, p.solution[0]!, you);
    const ids = [...packet.facts.map((f) => f.id), ...(checked.legal ? checked.facts.map((f) => f.id) : [])];
    const verdict = validateSay({ kind: 'explain', text: p.explanation, claims: ids }, { fen: start.fen, you, fact: this.facts.fact, budgetSentences: 6, canAnswer: true, vocabulary: this.options().vocabulary, ladder: this.ladder });
    if (verdict.ok) return { gate: 'V3', result: 'pass' };
    return { gate: 'V3', result: 'fail', detail: `"${p.explanation.trim()}": ${verdict.problems.map((x) => x.message).join(' ')}` };
  }

  /** Run every gate that applies to a puzzle, and give the item its status. Nothing is stored. */
  async validate(item: ContentItem<Puzzle>): Promise<ContentItem<Puzzle>> {
    const needed = GATES_FOR[item.type];
    const gates: GateResult[] = [];
    const v1 = gateV1Puzzle(item.body);
    gates.push(v1);
    // a line that is not legal cannot be given to the engine
    const sound = v1.result === 'pass';
    let engine = item.engine;
    if (needed.includes('V2')) {
      gates.push(sound ? await this.gateV2(item.body) : { gate: 'V2', result: 'fail', detail: 'not run: the line is not legal' });
      engine = `${this.engine.signature}, ${this.options().nodes} nodes`;
    }
    if (needed.includes('V3')) gates.push(sound ? await this.gateV3(item.body) : { gate: 'V3', result: 'fail', detail: 'not run: the line is not legal' });
    const checked: ContentItem<Puzzle> = { ...item, engine, gates };
    gates.push(gateV6(checked, { storedUnderData: isUnder(this.dbFile, this.dataDir), engineRan: needed.includes('V2') }));
    const status: ContentStatus = statusAfter(item.type, gates) === 'quarantined' ? 'quarantined' : this.options().autoApprove ? 'live' : 'machine-verified';
    return { ...checked, status };
  }

  /** Validate a puzzle and keep it. The same puzzle from the same source is one item: it is checked again and replaced. */
  async submit(item: ContentItem<Puzzle>): Promise<StoredItem> {
    const checked = await this.validate(item);
    const key = puzzleKey(checked.body, checked.source);
    const id = this.db.saveContent(key, checked);
    this.db.logEvent('content', { id, type: checked.type, status: checked.status, reasons: checked.status === 'quarantined' ? quarantineReasons(checked) : undefined });
    return { ...checked, id, key };
  }

  /** The owner approves an item that passed its gates (or it is approved for them, by the setting). */
  approve(id: number): boolean {
    const item = this.db.getContent(id);
    if (!item || item.status !== 'machine-verified') return false;
    this.db.setContentStatus(id, 'live');
    this.db.logEvent('content_approved', { id });
    return true;
  }
}

function isUnder(file: string, dir: string): boolean {
  if (file === ':memory:') return true;
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
