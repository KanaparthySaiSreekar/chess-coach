// Solving a puzzle (PLAN WP 6.2): the state of one attempt, as plain data and pure functions.
// The server keeps the run and the page shows it; nothing here needs an engine. A move is right
// when it is the solution's move, an answer the gates accepted, or a move that gives checkmate
// (a mate in one accepts any mating move: CONTENT §6).

import { anyToMove, describeMove, parsePosition, type Color, type Role } from './chess.ts';
import { solverStart, type Puzzle } from './content.ts';

export type PuzzleMove = { san: string; from: string; to: string; fen: string; by: 'you' | 'them' };

export type PuzzleRun = {
  puzzle: Puzzle;
  /** the solver's side */
  you: Color;
  /** the position on the board at the very start: before the set-up move when there is one */
  startFen: string;
  /** the moves played so far, the set-up move included */
  moves: PuzzleMove[];
  /** the set-up move has been played (or there is none) */
  ready: boolean;
  /** where in `solution` the next move comes from: even = the solver's, odd = the reply */
  index: number;
  status: 'solving' | 'solved' | 'shown';
  /** rungs of the hint ladder given so far: 1 a question, 2 a nudge at the piece, 3 the move as an arrow */
  hints: number;
  misses: number;
  /** solved with an answer that was accepted in place of the solution's move */
  also?: boolean;
};

/** The position on the board now. */
export function runFen(run: PuzzleRun): string {
  return run.moves.at(-1)?.fen ?? run.startFen;
}

/** Begin an attempt. The set-up move is not played yet: the page shows the position, then the move. */
export function startRun(puzzle: Puzzle): { ok: true; run: PuzzleRun } | { ok: false; reason: string } {
  const start = solverStart(puzzle);
  if (!start.ok) return start;
  const solver = parsePosition(start.fen);
  if (!solver || !puzzle.solution.length) return { ok: false, reason: 'the puzzle has no solution' };
  return { ok: true, run: { puzzle, you: solver.turn, startFen: puzzle.fen, moves: [], ready: !puzzle.setup, index: 0, status: 'solving', hints: 0, misses: 0 } };
}

function push(run: PuzzleRun, text: string, by: 'you' | 'them'): PuzzleRun | null {
  const pos = parsePosition(runFen(run));
  const move = pos ? anyToMove(pos, text) : null;
  if (!pos || !move) return null;
  const info = describeMove(pos, move);
  return { ...run, moves: [...run.moves, { san: info.san, from: info.from, to: info.to, fen: info.fenAfter, by }] };
}

/** Play the opponent's move that creates the puzzle. */
export function playSetup(run: PuzzleRun): PuzzleRun {
  if (run.ready || !run.puzzle.setup) return { ...run, ready: true };
  return { ...(push(run, run.puzzle.setup, 'them') ?? run), ready: true };
}

/** Is it the solver's move? */
export function yourTurn(run: PuzzleRun): boolean {
  return run.status === 'solving' && run.ready && run.index % 2 === 0;
}

export type Answer = { result: 'correct' | 'also' | 'wrong' | 'illegal' | 'not-now'; san?: string; run: PuzzleRun };

/** The solver plays a move ("e2e4", "e7e8q" or notation). A wrong move changes nothing but the count of misses. */
export function answer(run: PuzzleRun, text: string): Answer {
  if (!yourTurn(run)) return { result: 'not-now', run };
  const pos = parsePosition(runFen(run))!;
  const move = anyToMove(pos, text);
  if (!move) return { result: 'illegal', run };
  const info = describeMove(pos, move);
  const same = (other: string) => {
    const m = anyToMove(pos, other);
    return !!m && describeMove(pos, m).uci === info.uci;
  };
  if (same(run.puzzle.solution[run.index]!)) {
    const next = push(run, text, 'you')!;
    const index = run.index + 1;
    return { result: 'correct', san: info.san, run: { ...next, index, status: index >= run.puzzle.solution.length ? 'solved' : 'solving' } };
  }
  // an accepted answer, or any move that mates: right, and the puzzle ends there (its own continuation is not stored)
  if (info.mate || (run.puzzle.accepted?.[run.index] ?? []).some(same)) {
    return { result: 'also', san: info.san, run: { ...push(run, text, 'you')!, index: run.puzzle.solution.length, status: 'solved', also: true } };
  }
  return { result: 'wrong', san: info.san, run: { ...run, misses: run.misses + 1 } };
}

/** The opponent's reply from the solution, when one is due. */
export function playReply(run: PuzzleRun): PuzzleRun {
  if (run.status !== 'solving' || run.index % 2 === 0 || run.index >= run.puzzle.solution.length) return run;
  const next = push(run, run.puzzle.solution[run.index]!, 'them');
  return next ? { ...next, index: run.index + 1 } : run;
}

/** The rest of the solution, played out: the answer is shown. */
export function reveal(run: PuzzleRun): PuzzleRun {
  let cur = playSetup(run);
  if (cur.status !== 'solving') return cur;
  for (let i = cur.index; i < cur.puzzle.solution.length; i++) {
    const next = push(cur, cur.puzzle.solution[i]!, i % 2 === 0 ? 'you' : 'them');
    if (!next) break;
    cur = next;
  }
  return { ...cur, index: cur.puzzle.solution.length, status: 'shown' };
}

/** The solver's next move in the solution: what the hints point at. */
export function expectedMove(run: PuzzleRun): { san: string; from: string; to: string; role: Role } | null {
  if (!yourTurn(run)) return null;
  const pos = parsePosition(runFen(run));
  const move = pos ? anyToMove(pos, run.puzzle.solution[run.index]!) : null;
  if (!pos || !move) return null;
  const info = describeMove(pos, move);
  return { san: info.san, from: info.from, to: info.to, role: info.role };
}

export type Rung = 'question' | 'nudge' | 'arrow' | 'answer';
/** The rung the next hint gives (the ladder of COACH §4): after the arrow, the answer. */
export function nextRung(run: PuzzleRun): Rung {
  return (['question', 'nudge', 'arrow', 'answer'] as const)[Math.max(0, Math.min(3, run.hints))]!;
}

/** How the attempt went, for the log and (later) the schedule. */
export type AttemptResult = 'solved' | 'shown';
export function attemptOf(run: PuzzleRun): { result: AttemptResult; hints: number; misses: number; clean: boolean } | null {
  if (run.status === 'solving') return null;
  return { result: run.status === 'solved' ? 'solved' : 'shown', hints: run.hints, misses: run.misses, clean: run.status === 'solved' && run.hints === 0 && run.misses === 0 };
}

// ---------------------------------------------------------------- themed sets: the level follows the results (C5)

/** What one answer is worth to the level: solved alone, solved with help, or shown. */
export function scoreOf(a: { result: 'solved' | 'shown'; hints: number; misses: number }): number {
  if (a.result === 'shown') return 0;
  return a.hints === 0 && a.misses === 0 ? 1 : 0.6;
}

/** How fast the level moves: a step of up to this many rating points per puzzle. */
export const LEVEL_K = 40;
/** Puzzles are drawn this far below the level, so that most of them are solved (CONTENT §6: "difficulty stays where most are solved"). */
export const DRAW_BELOW = 100;

/**
 * The owner's puzzle level, replayed from their answers in order, the way a rating is: each
 * answer moves it by how much better or worse it went than expected for a puzzle of that rating.
 * Second goes at the same puzzle are not counted.
 */
export function practiceLevel(history: { rating: number; score: number }[], start: number): number {
  let level = start;
  for (const h of history) {
    const expected = 1 / (1 + 10 ** ((h.rating - level) / 400));
    level += LEVEL_K * (h.score - expected);
  }
  return Math.round(Math.max(400, Math.min(2800, level)));
}

/** A theme's name as the page shows it: the known ones by hand, the rest from the tag itself ("kingsideAttack" → "Kingside attack"). */
export const THEME_NAME: Record<string, string> = {
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  discoveredAttack: 'Discovered attack',
  doubleCheck: 'Double check',
  backRankMate: 'Back-rank mate',
  hangingPiece: 'Hanging piece',
  capturingDefender: 'Removing the defender',
  trappedPiece: 'Trapped piece',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  mateIn4: 'Mate in 4',
  mateIn5: 'Mate in 5',
  smotheredMate: 'Smothered mate',
  deflection: 'Deflection',
  attraction: 'Attraction',
  clearance: 'Clearance',
  interference: 'Interference',
  intermezzo: 'In-between move',
  quietMove: 'Quiet move',
  sacrifice: 'Sacrifice',
  defensiveMove: 'Defensive move',
  promotion: 'Promotion',
  underPromotion: 'Underpromotion',
  enPassant: 'En passant',
  castling: 'Castling',
  zugzwang: 'Zugzwang',
  xRayAttack: 'X-ray attack',
  kingsideAttack: 'Kingside attack',
  queensideAttack: 'Queenside attack',
  exposedKing: 'Exposed king',
  advancedPawn: 'Advanced pawn',
  pawnEndgame: 'Pawn endgame',
  rookEndgame: 'Rook endgame',
  queenEndgame: 'Queen endgame',
  bishopEndgame: 'Bishop endgame',
  knightEndgame: 'Knight endgame',
  queenRookEndgame: 'Queen and rook endgame',
  anastasiaMate: "Anastasia's mate",
  arabianMate: 'Arabian mate',
  bodenMate: "Boden's mate",
  doubleBishopMate: 'Two bishops mate',
  dovetailMate: 'Dovetail mate',
  hookMate: 'Hook mate',
  killBoxMate: 'Kill box mate',
  vukovicMate: "Vuković's mate",
  pillsburysMate: "Pillsbury's mate",
  morphysMate: "Morphy's mate",
  balestraMate: 'Balestra mate',
  blindSwineMate: 'Blind swine mate',
  epauletteMate: 'Epaulette mate',
  swallowstailMate: "Swallow's tail mate",
  operaMate: 'Opera mate',
  cornerMate: 'Corner mate',
  triangleMate: 'Triangle mate',
};
export function themeName(tag: string): string {
  return THEME_NAME[tag] ?? (tag.charAt(0).toUpperCase() + tag.slice(1)).replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/ ([A-Z])(?=[a-z])/g, (_m, c: string) => ` ${c.toLowerCase()}`);
}
