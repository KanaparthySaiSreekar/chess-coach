// Move labels and the eval bar's reading (features A6, A17; decision D40).
//
// Everything here is worked out by code from engine results: the model never labels a move.
// The grading is Lichess's (winning chances, Lichess's thresholds); the label names are the
// ones Chess.com uses, with one rule each, written down in ARCHITECTURE §8.

import type { NormalMove } from 'chessops/types';
import { ROLE_VALUE, anyToMove, describeMove, mustPosition, parsePosition, type Color } from './chess.ts';
import { captureGain, capturables } from './attacks.ts';
import { gradeMove, tablebaseResult, type EngineEval, type EngineLine, type GradeResult } from './facts.ts';
import { DEFAULT_THRESHOLDS, dropOf, winChance, type Thresholds } from './winchance.ts';

// ---------------------------------------------------------------- the eval bar

/**
 * The eval bar's reading for one position. `white` is White's winning chances, 0..100.
 * `mate` is a forced mate: positive when White mates, negative when Black does. `cp` is only
 * shown when the owner switched engine numbers on.
 */
export type Gauge = {
  white: number;
  mate?: number;
  cp?: number;
  over?: 'checkmate' | 'stalemate' | 'draw';
  /** the result with best play is known exactly: read from the endgame tablebases */
  exact?: 'white' | 'black' | 'draw';
};

/** The reading for a position from the engine's best line there (scores are the side to move's). */
export function gaugeOf(fen: string, best?: EngineLine, tbhits?: number): Gauge | null {
  const pos = parsePosition(fen);
  if (!pos) return null;
  if (pos.isCheckmate()) return { white: pos.turn === 'white' ? 0 : 100, over: 'checkmate' };
  if (pos.isStalemate()) return { white: 50, over: 'stalemate' };
  if (pos.isInsufficientMaterial()) return { white: 50, over: 'draw' };
  if (!best) return null;
  const sign = pos.turn === 'white' ? 1 : -1;
  const w = winChance(best.score);
  const gauge: Gauge = { white: Math.round((pos.turn === 'white' ? w : 100 - w) * 10) / 10 };
  if (best.score.mate !== undefined) gauge.mate = sign * best.score.mate;
  else gauge.cp = sign * (best.score.cp ?? 0);
  const exact = tablebaseResult(fen, { fen, lines: [best], tbhits });
  if (exact === 'draw') {
    gauge.exact = 'draw';
    gauge.white = 50;
  } else if (exact) gauge.exact = (exact === 'win') === (pos.turn === 'white') ? 'white' : 'black';
  return gauge;
}

/** The reading in plain words, no numbers: "White is clearly better". */
export function gaugeWords(g: Gauge): string {
  if (g.over === 'checkmate') return `${g.white >= 50 ? 'White' : 'Black'} won by checkmate`;
  if (g.over === 'stalemate') return 'Stalemate: a draw';
  if (g.over === 'draw') return 'A draw: not enough material to mate';
  if (g.mate !== undefined) return `${g.mate > 0 ? 'White' : 'Black'} has a forced checkmate in ${Math.abs(g.mate)}`;
  if (g.exact) return g.exact === 'draw' ? 'A draw with best play' : `${g.exact === 'white' ? 'White' : 'Black'} wins with best play`;
  const w = g.white;
  if (w >= 90) return 'White is winning';
  if (w >= 70) return 'White is clearly better';
  if (w >= 58) return 'White is a bit better';
  if (w > 42) return 'About equal';
  if (w > 30) return 'Black is a bit better';
  if (w > 10) return 'Black is clearly better';
  return 'Black is winning';
}

/** The engine's number for the bar, shown only when numbers are switched on: "+1.3", "-0.4", "M3". */
export function gaugeNumber(g: Gauge): string {
  if (g.over) return g.over === 'checkmate' ? '#' : '½';
  if (g.mate !== undefined) return `M${Math.abs(g.mate)}`;
  const pawns = (g.cp ?? 0) / 100;
  const shown = Math.abs(pawns) >= 10 ? Math.abs(pawns).toFixed(0) : Math.abs(pawns).toFixed(1);
  return `${pawns > 0.04 ? '+' : pawns < -0.04 ? '-' : ''}${shown}`;
}

// ---------------------------------------------------------------- move labels

export type MoveLabel = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder' | 'forced';

/** A labelled move, as the page shows it: "<move> <phrase>: <why>. <best> was best." */
export type Judged = {
  label: MoveLabel;
  /** the reason, in words that do not depend on which side the owner plays */
  why?: string;
  /** the engine's first choice, when the move played was not it */
  best?: string;
  /** where that move goes from and to, so the board can draw what should have been played (feature A19) */
  bestAt?: { from: string; to: string };
  /** true once the deeper search has confirmed it */
  sure?: boolean;
};

export const LABEL_NAME: Record<MoveLabel, string> = {
  brilliant: 'Brilliant',
  great: 'Great move',
  best: 'Best move',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Miss',
  blunder: 'Blunder',
  forced: 'Forced',
};

/** "<move> is a blunder", "<move> misses a chance". */
export const LABEL_PHRASE: Record<MoveLabel, string> = {
  brilliant: 'is brilliant',
  great: 'is a great move',
  best: 'is the best move',
  excellent: 'is excellent',
  good: 'is a good move',
  book: 'is a book move',
  inaccuracy: 'is an inaccuracy',
  mistake: 'is a mistake',
  miss: 'misses a chance',
  blunder: 'is a blunder',
  forced: 'is forced',
};

/** The usual annotation mark for a label ("!!", "?"…), for PGN and plain-text lists. */
export const LABEL_MARK: Record<MoveLabel, string> = {
  brilliant: '!!',
  great: '!',
  best: '',
  excellent: '',
  good: '',
  book: '',
  inaccuracy: '?!',
  mistake: '?',
  miss: '?',
  blunder: '??',
  forced: '',
};

export const BAD_LABELS: ReadonlySet<MoveLabel> = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

/**
 * How much material a move offers: the most the other side can win by capturing one of the
 * mover's pieces afterwards (pawns aside), less whatever the move itself captured. Two or more
 * is a real sacrifice: a bishop for a pawn, a rook for a knight, a piece left to be taken.
 */
export function sacrificeOf(fenBefore: string, san: string): number {
  const pos = parsePosition(fenBefore);
  const move = pos ? anyToMove(pos, san) : null;
  if (!pos || !move) return 0;
  const info = describeMove(pos, move);
  const after = parsePosition(info.fenAfter);
  if (!after || after.isEnd()) return 0;
  let gained = info.captured ? ROLE_VALUE[info.captured] : 0;
  if (info.promotion) gained += ROLE_VALUE[info.promotion] - 1;
  let offered = 0;
  for (const c of capturables(after)) {
    if (c.piece.role === 'pawn') continue;
    if (c.net > offered) offered = c.net;
  }
  return offered - gained;
}

export type LabelInput = {
  fenBefore: string;
  san: string;
  /** the engine's lines for the position before the move, best first (two or more when it has them) */
  evalBefore: EngineEval;
  /** the engine's line that starts with the move played, from the same position */
  playedLine: EngineLine;
  thresholds?: Thresholds;
  /** a move within this many points of the best one is "excellent" */
  excellent?: number;
  /** the position after the move is a known opening position (its name, when it has one) */
  book?: string | boolean;
};

const legalCount = (fen: string): number => {
  let n = 0;
  for (const [, dests] of mustPosition(fen).allDests()) n += dests.size();
  return n;
};

/** The mover's voice ("you lose a knight") without a "you", so it reads the same from either side. */
function neutral(text: string): string {
  return text
    .replace(/^you lose\b/, 'it loses')
    .replace(/^you win\b/, 'it wins')
    .replace(/^you miss\b/, 'it misses')
    .replace(/^you end up\b/, 'it ends up')
    .replace(/^you come out\b/, 'it comes out')
    .replace(/\byour advantage\b/, 'the advantage');
}

/**
 * Label one move. The order of the rules matters:
 * forced → book → the size of the drop in winning chances (blunder, mistake or miss, inaccuracy)
 * → brilliant → great → best → excellent → good.
 */
export function labelMove(input: LabelInput): { judged: Judged; grade: GradeResult | null } | null {
  const pos = parsePosition(input.fenBefore);
  const move = pos ? anyToMove(pos, input.san) : null;
  if (!pos || !move) return null;
  const info = describeMove(pos, move);
  if (legalCount(input.fenBefore) === 1) return { judged: { label: 'forced', why: 'the only legal move' }, grade: null };
  if (input.book) return { judged: { label: 'book', why: typeof input.book === 'string' ? input.book : undefined }, grade: null };
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const g = gradeMove({ fenBefore: input.fenBefore, san: info.san, evalBefore: input.evalBefore, playedLine: input.playedLine, you: pos.turn, thresholds: t });
  if (!g) return null;
  const best = g.isBest ? undefined : g.best;
  const bestMove = best ? anyToMove(pos, best) : null;
  const bestInfo = bestMove ? describeMove(pos, bestMove) : null;
  const bestAt = bestInfo ? { from: bestInfo.from, to: bestInfo.to } : undefined;
  const first = input.evalBefore.lines[0]!;
  const second = input.evalBefore.lines[1];
  // a chance worth a label of its own: a piece or more for the taking, or a mate a beginner can find
  const shortMate = (g.bestScore.mate ?? 0) > 0 && (g.bestScore.mate ?? 0) <= 3;
  const clearMiss = !!g.missed && (g.bestScore.mate === undefined || shortMate);

  if (g.cls === 'blunder' || g.cls === 'mistake') {
    // a miss: nothing is lost, the position is still fine, but a win of material or a mate was there
    const chanceMissed = (g.bestScore.mate ?? 0) > 0 || g.bestDelta - g.playedDelta >= 2;
    const stillFine = g.mateAllowed === undefined && g.playedDelta >= 0 && winChance(g.playedScore) >= 40;
    const label: MoveLabel = chanceMissed && stillFine ? 'miss' : g.cls;
    return { judged: { label, why: neutral(g.lost ?? 'it gives up the advantage'), best, bestAt }, grade: g };
  }
  if (g.cls === 'inaccuracy') {
    const label: MoveLabel = clearMiss && g.playedDelta >= 0 ? 'miss' : 'inaccuracy';
    return { judged: { label, why: g.lost ? neutral(g.lost) : undefined, best, bestAt }, grade: g };
  }
  // the winning chances hardly moved (the game is won either way), but a piece or a short mate was passed over
  if (clearMiss) return { judged: { label: 'miss', why: neutral(g.missed!), best, bestAt }, grade: g };

  const near = g.isBest || g.drop < (input.excellent ?? 2);
  // A move after which the game or material goes, though nothing better was there: the label is
  // true (it is as good as any), and the reason keeps it from reading as praise.
  const nothingBetter = (g.bestScore.mate ?? 0) < 0 ? 'checkmate cannot be stopped here' : g.bestDelta < 0 && g.playedDelta < 0 ? 'material is lost whatever is played' : undefined;
  // brilliant: a sacrifice that is (about) the best move, when the game was not already won without it
  if (near && !info.mate) {
    const wonAnyway = !!second && winChance(second.score) >= 90;
    if (sacrificeOf(input.fenBefore, info.san) >= 2 && winChance(g.playedScore) >= 50 && !wonAnyway) {
      return { judged: { label: 'brilliant', why: 'a sacrifice that works', best, bestAt }, grade: g };
    }
  }
  if (g.isBest) {
    // great: the only good move, unless it is the obvious one (taking a free piece, one of two ways out of check)
    const onlyGood = !!second && dropOf(first.score, second.score) >= t.blunder && winChance(first.score) > 15;
    const freeCapture = !!info.captured && 'from' in move && captureGain(pos, move as NormalMove) > 0;
    const obvious = freeCapture || info.mate || (pos.isCheck() && legalCount(input.fenBefore) <= 3);
    if (onlyGood && !obvious) return { judged: { label: 'great', why: 'the only good move here' }, grade: g };
    return { judged: nothingBetter ? { label: 'best', why: nothingBetter } : { label: 'best' }, grade: g };
  }
  // a small give-away the grading lets through (a pawn, in a game already decided): never "excellent", and it says what went
  if (g.givenAway > 0) return { judged: { label: 'good', why: neutral(g.playedOutcome), best, bestAt }, grade: g };
  return { judged: { label: near ? 'excellent' : 'good', ...(nothingBetter ? { why: nothingBetter } : {}), best, bestAt }, grade: g };
}

/** One line for a labelled move, in plain words: "Qh5 is a blunder: it loses a queen. Nf3 was best." */
export function judgedText(san: string, j: Judged, by?: Color): string {
  const who = by ? `${by === 'white' ? 'White' : 'Black'}'s ` : '';
  const why = j.why ? `: ${j.why}` : '';
  const best = j.best ? ` ${j.best} was ${BAD_LABELS.has(j.label) ? 'best' : 'the engine\'s first choice'}.` : '';
  return `${who}${san} ${LABEL_PHRASE[j.label]}${why}.${best}`;
}
