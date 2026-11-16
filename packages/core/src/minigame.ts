// Mini-games with few pieces (feature F6; PLAN WP 7.6): a start position, the side the owner plays,
// and a goal checked by code after every move (first to promote, stop the pawns, mate within N).

import { mustPosition, parsePosition, type Color } from './chess.ts';

export type MiniGoal = { kind: 'promote' } | { kind: 'stop' } | { kind: 'mate'; within: number };
export type MiniGame = { id: string; name: string; idea: string; about: string; fen: string; you: Color; goal: MiniGoal };

/** The goal in a few words, for the page. */
export function miniGoalText(goal: MiniGoal): string {
  if (goal.kind === 'promote') return 'Make a queen first.';
  if (goal.kind === 'stop') return 'Take every pawn before one becomes a queen.';
  return `Checkmate within ${goal.within} ${goal.within === 1 ? 'move' : 'moves'}.`;
}

/** What is wrong with a mini-game, or null: a legal position, a goal that can be reached in it. */
export function miniProblem(m: MiniGame): string | null {
  const pos = parsePosition(m.fen);
  if (!pos) return `${m.id}: the position is not legal`;
  if (m.you !== 'white' && m.you !== 'black') return `${m.id}: the side must be white or black`;
  const them = m.you === 'white' ? 'black' : 'white';
  const pawns = (side: Color) => [...pos.board.pieces(side, 'pawn')].length;
  if (m.goal.kind === 'promote' && pawns(m.you) === 0) return `${m.id}: the owner has no pawn to promote`;
  if (m.goal.kind === 'stop' && pawns(them) === 0) return `${m.id}: there are no pawns to stop`;
  if (m.goal.kind === 'mate' && !(m.goal.within > 0)) return `${m.id}: a mate needs a number of moves`;
  return null;
}

/**
 * After a move: has the mini-game's goal decided it? `last` is the move just played and who played
 * it; `ownerMoves` how many moves the owner has made. Checkmate, stalemate and the rest of the rules
 * are the game's own; this is only the goal.
 */
export function miniVerdict(m: MiniGame, last: { san: string; by: Color; fenAfter: string }, ownerMoves: number): { winner?: Color; text: string } | null {
  const them: Color = m.you === 'white' ? 'black' : 'white';
  const promoted = last.san.includes('=');
  if (m.goal.kind === 'promote' && promoted) return last.by === m.you ? { winner: m.you, text: 'You made a queen first. You win.' } : { winner: them, text: 'They made a queen first.' };
  if (m.goal.kind === 'stop') {
    if (promoted && last.by === them) return { winner: them, text: 'A pawn got through and became a queen.' };
    // every piece of theirs but the king is gone
    const left = [...mustPosition(last.fenAfter).board[them]].length - 1;
    if (left === 0) return { winner: m.you, text: 'You took every pawn. You win.' };
  }
  if (m.goal.kind === 'mate' && last.by === m.you && ownerMoves >= m.goal.within && !mustPosition(last.fenAfter).isCheckmate()) return { winner: them, text: `No mate within ${m.goal.within} ${m.goal.within === 1 ? 'move' : 'moves'}. Try it again.` };
  return null;
}
