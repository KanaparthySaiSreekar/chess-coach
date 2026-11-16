// Analysing a whole game (features B3, B9; PLAN WP 5.3). Two passes:
//
//   1. every position of the game once, a light search with one line: enough to label every move
//      and to see where the winning chances fell;
//   2. the owner's candidate moments again, with the analysis the coach's verdicts rest on
//      (FactService.checkMove: the deeper search, checked against Lichess when it has the
//      position). That is the same judgement the badge on the board and the coach's sentence use,
//      so a moment, its label and what the coach says about it cannot disagree (D54).
//
// Node-limited searches and the engine cache make the result repeat exactly, and a game that was
// analysed before costs almost nothing the second time.

import { describeMove, gradeGame, momentCandidates, mustPosition, parsePosition, pickMoments, sanToMove, summariseGame, tagGame, type Color, type EngineEval, type GameNumbers, type GamePly, type Moment, type MoveClock } from '@chess-coach/core';
import type { EngineService } from './engine/service.ts';
import type { FactService } from './facts-service.ts';

export type GameAnalysis = {
  you: Color;
  plies: GamePly[];
  moments: Moment[];
  numbers: GameNumbers;
  /** the engine's result for each position (index 0: before the first move), null where it was not asked */
  evals: (EngineEval | null)[];
  /** how many candidate moments the second pass confirmed */
  confirmed: number;
  engine: string;
};

export type AnalyseRequest = {
  rootFen: string;
  moves: string[];
  you: Color;
  /** nodes for the first pass */
  nodes: number;
  /** how many moments to pick */
  max: number;
  /** how many candidates the second pass looks at again, at most (0: no second pass) */
  confirm?: number;
  /** the clock for each move of a live game (index 0: the first move), for the "played too fast" tag */
  clocks?: (MoveClock | undefined)[];
  /** positions the engine must not be asked about (fair play): index 0 is the start */
  skip?: (index: number, fens: string[]) => boolean;
  onProgress?: (done: number, total: number) => void;
  /** stop early (the board moved on to another game) */
  cancelled?: () => boolean;
};

/** How many positions are searched at once: the analysis pool's size. */
const AT_ONCE = 6;

export class GameAnalyser {
  private readonly engine: EngineService;
  private readonly facts: FactService;

  constructor(engine: EngineService, facts: FactService) {
    this.engine = engine;
    this.facts = facts;
  }

  async analyse(req: AnalyseRequest): Promise<GameAnalysis | null> {
    // the positions of the game: fens[i] is the one before moves[i]
    const fens = [req.rootFen];
    const pos = mustPosition(req.rootFen);
    for (const san of req.moves) {
      const move = sanToMove(pos, san);
      if (!move) break;
      fens.push(describeMove(pos, move).fenAfter);
      pos.play(move);
    }
    const moves = req.moves.slice(0, fens.length - 1);
    const off = fens.map((_, i) => !!req.skip?.(i, fens));

    // ---- pass 1: every position once
    const evals: (EngineEval | null)[] = fens.map(() => null);
    const todo = fens.map((fen, i) => i).filter((i) => !off[i] && !parsePosition(fens[i]!)?.isEnd());
    let done = 0;
    req.onProgress?.(0, todo.length);
    const queue = [...todo];
    const worker = async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
        if (req.cancelled?.()) return;
        const r = await this.engine.analyse({ fen: fens[i]!, nodes: req.nodes, multipv: 1, pool: 'analysis' });
        evals[i] = { fen: fens[i]!, lines: r.lines, tbhits: r.tbhits };
        req.onProgress?.(++done, todo.length);
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
    if (req.cancelled?.()) return null;

    // a move into or out of a position that is off limits is not graded at all
    const usable = evals.map((e, i) => (off[i] || off[i + 1] ? null : e));
    const plies = gradeGame({ rootFen: req.rootFen, moves, evals: usable, thresholds: this.facts.thresholds, excellent: this.facts.excellent, book: (fen) => this.facts.book(fen) });

    // ---- pass 2: the candidate moments, judged as the coach's verdicts are
    const candidates = momentCandidates(plies, req.you);
    const early = candidates.slice(0, 4);
    const biggest = [...candidates].sort((a, b) => b.grade!.drop - a.grade!.drop);
    const again = [...new Set([...early, ...biggest])].slice(0, Math.max(0, req.confirm ?? 12));
    let confirmed = 0;
    // did the move make a threat of its own? ("it only works if they cooperate": asked for the candidates only)
    const ownThreat = new Map<GamePly, boolean>();
    for (const ply of again) {
      if (req.cancelled?.()) return null;
      const r = await this.facts.checkMove(ply.fenBefore, ply.san, req.you);
      if (!r.legal) continue;
      const judged = this.facts.knownLabel(ply.fenBefore, ply.san);
      ply.grade = r.grade;
      if (judged) ply.judged = judged;
      ply.factId = r.factId;
      ply.bestFactId = r.bestFactId;
      ply.findable = r.findable;
      if (r.grade.playedDelta < 0 || r.grade.mateAllowed !== undefined) ownThreat.set(ply, await this.facts.hasThreatAfter(ply.fenAfter));
      confirmed++;
    }
    // every slip gets its tag: the skipped step, and what happened on the board (WP 5.4)
    tagGame(plies, { clocks: req.clocks, ownThreat: (p) => ownThreat.get(p) });
    return { you: req.you, plies, moments: pickMoments(plies, req.you, req.max), numbers: summariseGame(plies, req.you), evals, confirmed, engine: this.engine.signature };
  }
}
