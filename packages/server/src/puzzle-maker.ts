// Puzzles from the owner's own games (features C1, C2, C3; CONTENT §6; PLAN WP 6.3). Plain code,
// no model: the engine supplies every move.
//
// A candidate is one of the owner's slips in an analysed game. The puzzle starts one move
// earlier, so the opponent's move that led to the position is played in front of the owner (as
// Lichess stores its puzzles). The solution is the engine's line, built the way Lichess's own
// generator builds it (lichess-puzzler, re-implemented):
//   - each of the solver's moves must be the only good move; where it is not, the line stops on
//     the solver's move before;
//   - a mate in one accepts every mating move;
//   - the line ends on a move of the solver's.
// A second, teaching tier covers what those rules skip and a beginner needs: a piece that can
// simply be taken. There every capture that wins the same material is an accepted answer.
//
// What comes out goes through the content gates like anything else, and only what passes is live.

import { anyToMove, describeMove, fenOf, motifsOf, parsePosition, uciToMove, type Color, type ContentItem, type EngineLine, type GamePly, type Puzzle, type PuzzleKind } from '@chess-coach/core';
import { asGoodAs, type ContentService, type StoredItem } from './content.ts';
import type { EngineService } from './engine/service.ts';

/** The longest solution: this many moves of the solver's (a mate in three). */
export const MAX_SOLVER_MOVES = 3;

export type Candidate = {
  /** the half-move of the owner's slip */
  ply: number;
  /** the position before the slip: the solver's position */
  fen: string;
  /** the move the owner played there */
  played: string;
  kind: PuzzleKind;
  /** the opponent's move that led to the position, and the position before it */
  before?: { fen: string; san: string };
};

export type Built = { ok: true; puzzle: Puzzle } | { ok: false; why: string };

/** The owner's slips that could make a puzzle: mistakes, blunders and missed chances made while the game was undecided, the costliest first. */
export function candidatesOf(plies: GamePly[], you: Color, max: number): Candidate[] {
  return plies
    .filter((p) => p.by === you && !!p.grade && p.grade.live && (p.judged?.label === 'mistake' || p.judged?.label === 'blunder' || p.judged?.label === 'miss'))
    .sort((a, b) => b.grade!.drop - a.grade!.drop || a.ply - b.ply)
    .slice(0, Math.max(0, max))
    .sort((a, b) => a.ply - b.ply)
    .map((p) => {
      const prev = plies[p.ply - 2];
      return {
        ply: p.ply,
        fen: p.fenBefore,
        played: p.san,
        // a chance that was left on the board is "punish it"; a move that lost something is "find the better move"
        kind: p.tag?.boardStep === 'missed_free_material' || p.judged?.label === 'miss' ? ('punish' as const) : ('mistake' as const),
        before: prev && prev.fenAfter === p.fenBefore ? { fen: prev.fenBefore, san: prev.san } : undefined,
      };
    });
}

export class PuzzleMaker {
  private readonly engine: EngineService;
  private readonly content: ContentService;
  private readonly nodes: () => number;

  constructor(engine: EngineService, content: ContentService, nodes: () => number) {
    this.engine = engine;
    this.content = content;
    this.nodes = nodes;
  }

  /** Build the puzzle for one slip, or say why there is none. */
  async build(c: Candidate): Promise<Built> {
    const pos = parsePosition(c.fen);
    if (!pos) return { ok: false, why: 'the position is not valid' };
    const solver = pos.turn;
    const line: string[] = [];
    let accepted: Record<number, string[]> | undefined;
    let reply: string | undefined;
    for (let n = 0; n < MAX_SOLVER_MOVES; n++) {
      const fen = fenOf(pos);
      const ev = await this.engine.analyse({ fen, nodes: this.nodes(), multipv: n === 0 ? 6 : 3, pool: 'analysis' });
      const best = ev.lines[0];
      const bestMove = best?.pv[0] ? uciToMove(pos, best.pv[0]) : null;
      if (!best || !bestMove) break;
      const info = describeMove(pos, bestMove);
      const sanOf = (l: EngineLine) => {
        const m = l.pv[0] ? uciToMove(pos, l.pv[0]) : null;
        return m ? describeMove(pos, m) : null;
      };
      const rivals = ev.lines.slice(1).filter((l) => {
        const other = sanOf(l);
        return !!other && asGoodAs(fen, l, other.san, best);
      });
      if (n === 0) {
        if (info.san.replace(/[+#]/g, '') === c.played.replace(/[+#]/g, '')) return { ok: false, why: `the move played (${c.played}) is the engine's first choice at this depth` };
        if (best.score.mate === 1) {
          // a mate in one accepts every mating move
          const others = rivals.filter((l) => l.score.mate === 1).map((l) => sanOf(l)!.san);
          line.push(info.san);
          if (others.length) accepted = { 0: others };
          break;
        }
        if (rivals.length) {
          // the teaching tier: a piece that can simply be taken, by more than one piece
          const takes = rivals.map((l) => sanOf(l)!);
          if (!info.captured || !takes.every((t) => !!t.captured && t.to === info.to)) return { ok: false, why: `more than one good move (${info.san}, ${takes.map((t) => t.san).join(', ')})` };
          line.push(info.san);
          accepted = { 0: takes.map((t) => t.san) };
          break;
        }
      } else if (rivals.length) break; // not the only good move any more: the line ended on the solver's move before
      if (reply) line.push(reply);
      line.push(info.san);
      pos.play(bestMove);
      if (pos.isEnd()) break;
      const replyMove = best.pv[1] ? uciToMove(pos, best.pv[1]) : null;
      if (!replyMove) break;
      reply = describeMove(pos, replyMove).san;
      pos.play(replyMove);
      if (pos.isEnd()) break;
    }
    if (!line.length) return { ok: false, why: 'the engine gave no line' };
    // the themes, from the same detectors that were checked against Lichess's own tags. They read a
    // line as the puzzle database stores it: the opponent's set-up move first, when there is one
    const from = c.before?.fen ?? c.fen;
    const walk = parsePosition(from)!;
    const ucis: string[] = [];
    for (const san of [...(c.before ? [c.before.san] : []), ...line]) {
      const m = anyToMove(walk, san);
      if (!m) break;
      ucis.push(describeMove(walk, m).uci);
      walk.play(m);
    }
    const themes = c.before ? motifsOf(from, ucis) : motifsOf(from, ucis, solver);
    return { ok: true, puzzle: { fen: c.before?.fen ?? c.fen, setup: c.before?.san, solution: line, accepted, themes, kind: c.kind } };
  }

  /** Make the puzzles of one game: build each candidate, then put it through the gates. */
  async fromGame(gameId: number, candidates: Candidate[], level: string, cancelled: () => boolean = () => false): Promise<{ made: StoredItem[]; skipped: { ply: number; why: string }[] }> {
    const made: StoredItem[] = [];
    const skipped: { ply: number; why: string }[] = [];
    for (const c of candidates) {
      if (cancelled()) break;
      const built = await this.build(c);
      if (!built.ok) {
        skipped.push({ ply: c.ply, why: built.why });
        continue;
      }
      const item: ContentItem<Puzzle> = { type: 'puzzle_game', status: 'draft', source: `game:${gameId}#${c.ply}`, licence: 'own', level, gates: [], body: built.puzzle };
      made.push(await this.content.submit(item));
    }
    return { made, skipped };
  }
}
