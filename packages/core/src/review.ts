// A whole game, graded move by move, and the few moments worth going through (features B3, B9;
// ARCHITECTURE §8; LEARNING §4: "find the first turning point, not the final blunder").
//
// Pure functions over what the engine found: the server searches every position once, this turns
// those results into a label and a grade for each move and picks the moments. The same input gives
// the same output.

import { materialOf } from './attacks.ts';
import { anyToMove, describeMove, mustPosition, parsePosition, sanToMove, type Color } from './chess.ts';
import type { EngineEval, EngineLine, GradeResult, SkippedStep } from './facts.ts';
import { labelMove, type Judged } from './labels.ts';
import type { Motif } from './motifs.ts';
import { STEP_NAME, TACTICS, tagMistake, type Findable, type MistakeTag, type MoveClock } from './tags.ts';
import { flipScore, winChance, type Score, type Thresholds } from './winchance.ts';

export type GamePly = {
  /** the move's place in the game, in half-moves: 1 is White's first move */
  ply: number;
  san: string;
  by: Color;
  fenBefore: string;
  fenAfter: string;
  /** the label and the grade behind it; absent when the engine was not asked about this move */
  judged?: Judged;
  grade?: GradeResult | null;
  /** White's winning chances after the move, 0 to 100 (the review's chart) */
  whiteWin?: number;
  /** the facts the checked analysis gave for this move, once it has looked (for the coach to cite) */
  factId?: string;
  bestFactId?: string;
  /** for a mistake, a blunder or a missed chance: the skipped step and what happened on the board (WP 5.4) */
  tag?: MistakeTag;
  /** the move to teach here: the engine's choice, or one about as good that is easier to find (H12) */
  findable?: Findable;
};

/** The score of a finished position, for the side that has just moved. */
function finishedScore(fen: string): Score | null {
  const pos = parsePosition(fen);
  if (!pos || !pos.isEnd()) return null;
  return pos.isCheckmate() ? { mate: 1 } : { cp: 0 };
}

export type GameInput = {
  rootFen: string;
  /** the moves, in notation */
  moves: string[];
  /**
   * The engine's result for each position, best line first: evals[i] is the position before
   * moves[i], evals[moves.length] the final position. A position the engine was not asked about
   * (a finished one, or one that is off limits) is null.
   */
  evals: (EngineEval | null)[];
  thresholds?: Thresholds;
  excellent?: number;
  /** is the position after a move a known opening position? */
  book?: (fen: string) => string | boolean | undefined;
};

/** Grade every move of a game from one engine result per position. */
export function gradeGame(input: GameInput): GamePly[] {
  const out: GamePly[] = [];
  const pos = mustPosition(input.rootFen);
  let fenBefore = input.rootFen;
  for (let i = 0; i < input.moves.length; i++) {
    const move = sanToMove(pos, input.moves[i]!);
    if (!move) break;
    const info = describeMove(pos, move);
    const by = pos.turn;
    pos.play(move);
    const ply: GamePly = { ply: i + 1, san: info.san, by, fenBefore, fenAfter: info.fenAfter };
    const before = input.evals[i];
    const after = input.evals[i + 1];
    const done = finishedScore(info.fenAfter);
    // the line that starts with the move played: the engine's own if it chose that move, else the
    // move followed by its best reply, scored from the position after it
    let played: EngineLine | null = null;
    const first = before?.lines[0];
    if (first && first.pv[0] === info.uci) played = first;
    else if (done) played = { pv: [info.uci], score: done };
    else if (after?.lines[0]) played = { pv: [info.uci, ...after.lines[0].pv], score: flipScore(after.lines[0].score) };
    if (before && before.lines.length && played) {
      const r = labelMove({ fenBefore, san: info.san, evalBefore: before, playedLine: played, thresholds: input.thresholds, excellent: input.excellent, book: input.book?.(info.fenAfter) });
      if (r) {
        ply.judged = r.judged;
        ply.grade = r.grade;
      }
    }
    const afterScore = done ?? (after?.lines[0] ? flipScore(after.lines[0].score) : played && played !== first ? played.score : null);
    if (afterScore) {
      const moverWin = winChance(afterScore);
      ply.whiteWin = Math.round((by === 'white' ? moverWin : 100 - moverWin) * 10) / 10;
    }
    out.push(ply);
    fenBefore = info.fenAfter;
  }
  return out;
}

/** The slips that get a tag: a mistake, a blunder, a missed chance. */
const isSlip = (label: string | undefined) => label === 'mistake' || label === 'blunder' || label === 'miss';

/**
 * Tag every slip of a game (B5). `clocks[i]` is the clock for move i+1 when the game had one;
 * `ownThreat(ply)` says whether that move made a threat of its own (asked of the engine for the
 * candidate moments only). A slip that already has a tag keeps the board's part and gains what is new.
 */
export function tagGame(plies: GamePly[], opts: { clocks?: (MoveClock | undefined)[]; ownThreat?: (ply: GamePly) => boolean | undefined } = {}): void {
  for (const p of plies) {
    if (!p.grade || !isSlip(p.judged?.label)) continue;
    p.tag = tagMistake({ fenBefore: p.fenBefore, san: p.san, grade: p.grade, clock: opts.clocks?.[p.ply - 1], ownThreat: opts.ownThreat?.(p) });
  }
}

// ---------------------------------------------------------------- the moments

export type MomentKind = 'mate' | 'piece' | 'pawn' | 'chance' | 'position';

export type Moment = {
  ply: number;
  /** "12." for White's twelfth move, "12..." for Black's */
  number: string;
  san: string;
  by: Color;
  fenBefore: string;
  label: 'mistake' | 'blunder' | 'miss';
  /** what it cost, in words that read the same from either side ("it loses a knight") */
  why: string;
  /** the move that should have been played */
  best: string;
  /** the drop in winning chances, in points */
  drop: number;
  kind: MomentKind;
  /** the first turning point of the game */
  first: boolean;
  factId?: string;
  bestFactId?: string;
  /** the step of the thinking routine that was skipped, its name on the page, and what happened in a few words */
  step?: SkippedStep;
  stepName?: string;
  what?: string;
  /** the owner said which step it was, in place of the machine's tag (feature H8) */
  stepBy?: 'owner';
  /** the move to teach, when it is not the engine's first choice */
  teach?: Findable;
  /** the tactical themes of the slip, and how many of the mover's own moves the better line needs to show its point */
  motifs?: Motif[];
  depth?: number;
};

const isCandidateLabel = (label: string | undefined): label is Moment['label'] => label === 'mistake' || label === 'blunder' || label === 'miss';

/** What a slip was about, coarsely: used to prefer moments of different kinds (the skipped-step tags replace it in WP 5.4). */
export function momentKind(ply: GamePly): MomentKind {
  const g = ply.grade;
  if (ply.judged?.label === 'miss') return 'chance';
  if (g?.mateAllowed !== undefined) return 'mate';
  if ((g?.givenAway ?? 0) >= 3) return 'piece';
  if ((g?.givenAway ?? 0) >= 1) return 'pawn';
  return 'position';
}

/** The owner's moves that could be a key moment: a mistake, a blunder or a missed chance, made while the game was still undecided. */
export function momentCandidates(plies: GamePly[], you: Color): GamePly[] {
  return plies.filter((p) => p.by === you && !!p.grade && p.grade.live && isCandidateLabel(p.judged?.label));
}

const numberOf = (ply: number) => `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '...'}`;

/**
 * The moments to go through (B3, DP5): the owner's mistakes and blunders in live positions.
 * The first one is always taken: it is where the game first went wrong. The rest are filled by the
 * size of the drop, preferring moments of different kinds, with at most one missed chance (an
 * opponent's blunder that went unpunished). A slip that cost nothing concrete ("gives up the
 * advantage") is used only when there is nothing else. Returned in game order.
 */
export function pickMoments(plies: GamePly[], you: Color, max = 3): Moment[] {
  const all = momentCandidates(plies, you);
  if (!all.length || max < 1) return [];
  const concrete = all.filter((p) => momentKind(p) !== 'position');
  const pool = concrete.length ? concrete : all;
  // the first turning point: the first slip that lost something, a missed chance only if there is no other
  const firstLoss = pool.find((p) => p.judged!.label !== 'miss') ?? pool[0]!;
  const chosen: GamePly[] = [firstLoss];
  const rest = pool.filter((p) => p !== firstLoss).sort((a, b) => b.grade!.drop - a.grade!.drop || a.ply - b.ply);
  // moments of different kinds teach more than three of the same: by skipped step once the slips are tagged, else by what was lost
  const kindOf = (p: GamePly): string => p.tag?.step ?? momentKind(p);
  const kinds = new Set<string>([kindOf(firstLoss)]);
  const missTaken = () => chosen.some((p) => p.judged!.label === 'miss');
  const take = (onlyNewKinds: boolean) => {
    for (const p of rest) {
      if (chosen.length >= max) return;
      if (chosen.includes(p)) continue;
      if (p.judged!.label === 'miss' && missTaken()) continue;
      if (onlyNewKinds && kinds.has(kindOf(p))) continue;
      chosen.push(p);
      kinds.add(kindOf(p));
    }
  };
  take(true);
  take(false);
  return chosen
    .sort((a, b) => a.ply - b.ply)
    .map((p) => ({
      ply: p.ply,
      number: numberOf(p.ply),
      san: p.san,
      by: p.by,
      fenBefore: p.fenBefore,
      label: p.judged!.label as Moment['label'],
      why: p.judged!.why ?? 'it gives up the advantage',
      best: p.judged!.best ?? p.grade!.best,
      drop: Math.round(p.grade!.drop * 10) / 10,
      kind: momentKind(p),
      first: p === firstLoss,
      factId: p.factId,
      bestFactId: p.bestFactId,
      step: p.tag?.step,
      stepName: p.tag ? STEP_NAME[p.tag.step] : undefined,
      what: p.tag?.what,
      teach: p.findable && p.findable.reason !== 'best' ? p.findable : undefined,
      motifs: p.tag?.motifs ?? [],
      depth: pointDepth(p.fenBefore, p.grade!.bestLine, p.grade!.mateFound),
    }));
}

// ---------------------------------------------------------------- going through a moment (the Socratic replay, B4)

/**
 * How many of the mover's own moves the better line needs before its point shows: the move that
 * mates, or the move after which the material it wins is on the board. A move whose point is
 * simply not to lose something shows it at once (1).
 */
export function pointDepth(fenBefore: string, bestLine: string[] | undefined, mateFound?: number): number {
  if (mateFound !== undefined && mateFound > 0) return mateFound;
  const pos = parsePosition(fenBefore);
  if (!pos) return 1;
  const sign = pos.turn === 'white' ? 1 : -1;
  const start = materialOf(pos).diff * sign;
  const gains: number[] = [];
  for (const san of bestLine ?? []) {
    const move = anyToMove(pos, san);
    if (!move) break;
    pos.play(move);
    gains.push(materialOf(pos).diff * sign - start);
  }
  const final = gains.at(-1) ?? 0;
  if (final <= 0) return 1;
  // the first of the mover's own moves after which the gain is on the board to stay
  for (let i = 0; i < gains.length; i += 2) if (gains.slice(i).every((g) => g >= final)) return i / 2 + 1;
  return Math.ceil(gains.length / 2);
}

export type ReplayPlan = { mode: 'ask' } | { mode: 'worked'; because: 'new' | 'deep' };

/**
 * Ask, or show? (COACH §4, the stop rules that are known before the owner has tried.) A point
 * deeper than `maxDepth` of the owner's moves is shown as a worked example, and so is a named
 * tactic the owner has not met in a review before: nobody finds a skewer they have never seen.
 */
export function replayPlan(moment: { motifs?: Motif[]; depth?: number }, opts: { maxDepth: number; seen: ReadonlySet<string>; workedWhenNew: boolean }): ReplayPlan {
  if ((moment.depth ?? 1) > opts.maxDepth) return { mode: 'worked', because: 'deep' };
  if (opts.workedWhenNew && (moment.motifs ?? []).some((m) => TACTICS.includes(m) && !opts.seen.has(m))) return { mode: 'worked', because: 'new' };
  return { mode: 'ask' };
}

// ---------------------------------------------------------------- the game in numbers

/** What one game adds to the owner's skill profile (feature G5; the profile itself is WP 5.8). */
export type GameNumbers = {
  /** the owner's moves that were graded, and how many of them were made while the game was undecided */
  moves: number;
  liveMoves: number;
  /** by label, the owner's moves only */
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  misses: number;
  /** blunders made in live positions: the number behind "blunders per 100 live moves" */
  liveBlunders: number;
  /** pieces left where they could be taken for nothing or lost outright: blunders and mistakes that cost a piece or more */
  piecesLost: number;
  /** how often each step of the thinking routine was skipped (the owner's slips only) */
  steps: Partial<Record<SkippedStep, number>>;
  /** the owner's moves that were the engine's first choice or as good as it: the true positive a review opens with */
  strong: number;
};

export function summariseGame(plies: GamePly[], you: Color): GameNumbers {
  const mine = plies.filter((p) => p.by === you && p.judged);
  const graded = mine.filter((p) => p.grade);
  const count = (label: string) => mine.filter((p) => p.judged!.label === label).length;
  return {
    moves: mine.length,
    liveMoves: graded.filter((p) => p.grade!.live).length,
    blunders: count('blunder'),
    mistakes: count('mistake'),
    inaccuracies: count('inaccuracy'),
    misses: count('miss'),
    liveBlunders: graded.filter((p) => p.grade!.live && p.judged!.label === 'blunder').length,
    piecesLost: graded.filter((p) => (p.judged!.label === 'blunder' || p.judged!.label === 'mistake') && p.grade!.givenAway >= 3).length,
    strong: mine.filter((p) => ['best', 'excellent', 'great', 'brilliant'].includes(p.judged!.label)).length,
    steps: mine.reduce<Partial<Record<SkippedStep, number>>>((acc, p) => (p.tag ? { ...acc, [p.tag.step]: (acc[p.tag.step] ?? 0) + 1 } : acc), {}),
  };
}
