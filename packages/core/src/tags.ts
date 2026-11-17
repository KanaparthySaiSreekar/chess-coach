// What kind of mistake was it? (features B5, H12; LEARNING §4, the skipped-step table.)
//
// A mistake is tagged twice: by the step of the thinking routine that was skipped (which decides
// the coach's first question), and by what happened on the board (hung a piece, allowed a fork,
// missed a mate). Both are worked out by code from the engine's lines: the coach is handed the
// tag, it does not guess it (D33).
//
// "As far as a machine can tell": the table's rows are about what went on in a head. The board
// shows which rows are possible, and the owner's own review (WP 5.5) can say more.

import { attackersOf, capturables } from './attacks.ts';
import { ROLE_VALUE, anyToMove, describeMove, parsePosition, passPosition, uciToMove, type Role } from './chess.ts';
import type { EngineLine, GradeResult, SkippedStep } from './facts.ts';
import { sacrificeOf } from './labels.ts';
import { motifsOf, type Motif } from './motifs.ts';
import { dropOf } from './winchance.ts';

/** The table's rows, in the words the page uses: what was skipped. */
export const STEP_NAME: Record<SkippedStep, string> = {
  missed_threat: 'Their threat went unanswered',
  no_safety_check: 'No safety check on your own move',
  seemed_safe: 'It looked safe at a glance',
  missed_tactic: 'A natural move that fails to a tactic',
  assumed_reply: 'It counted on a reply they did not have to play',
  missed_free_material: 'A free gift was left on the board',
  time: 'Played too fast',
  unknown: 'No single step stands out',
};

/**
 * A tag the board cannot settle (COACH §6.2, step 3; WP 5.7): whether the owner looked at the reply and
 * it seemed fine, or did not look. Code tells "it looked safe" from "no safety check" by what was taken
 * and by what, not by what the owner did, so once the replay is over the owner is asked, and the answer
 * is their own word for the step (H8).
 */
export function tagUnclear(step: SkippedStep | undefined): boolean {
  return step === 'seemed_safe' || step === 'no_safety_check';
}

/** The question for an unclear tag, and the step each answer means (the move number names the moment). */
export function lookedQuestion(number: string, san: string): { text: string; choices: { text: string; step: SkippedStep }[] } {
  const at = `${number}${san}`;
  return {
    // the move as a token (checked against the position before it); the answers are plain words on buttons
    text: `About your move ${number}{m:${san}}: did you look at their reply and it seemed fine, or didn't you look?`,
    choices: [
      { text: `${at}: I looked, and it seemed fine`, step: 'seemed_safe' },
      { text: `${at}: I didn't look at their reply`, step: 'no_safety_check' },
    ],
  };
}

/** The coach's first question for each row (LEARNING §4, "Ask first"). */
export const STEP_QUESTION: Record<SkippedStep, string> = {
  missed_threat: "What was your opponent's last move trying to do?",
  no_safety_check: 'After your move, what checks, captures or attacks did they have?',
  seemed_safe: 'Walk me through each capture they could make.',
  missed_tactic: 'What did you expect them to play back?',
  assumed_reply: "What if they don't play that?",
  missed_free_material: 'Were any of their pieces unprotected?',
  time: 'Was this a moment to slow down?',
  unknown: 'What were you hoping this move would do?',
};

export type MoveClock = {
  /** seconds the move took, and seconds left on the mover's clock after it */
  spent?: number;
  left?: number;
  /** the game's starting time in seconds: a live game only (a Daily game has no clock worth reading) */
  base?: number;
};

export type MistakeTag = {
  /** the skipped step: what the coach asks about first */
  step: SkippedStep;
  /** what the board alone says, when the clock decided the step */
  boardStep: SkippedStep;
  /** tactical themes in the line that punished the move, or in the chance that was missed */
  motifs: Motif[];
  /** the kind of mistake in a few plain words: "hung a knight", "allowed a fork", "missed a checkmate" */
  what: string;
};

export type TagInput = {
  fenBefore: string;
  san: string;
  grade: GradeResult;
  clock?: MoveClock;
  /** the move made a threat of its own: with a free move the mover would win material or mate (the engine's answer to "what if they pass?") */
  ownThreat?: boolean;
};

/** The tactical ideas that have a name: a beginner cannot be asked to find one they have never been shown. */
export const TACTICS: Motif[] = ['fork', 'skewer', 'discoveredAttack', 'doubleCheck', 'pin', 'trappedPiece', 'capturingDefender'];
const MOTIF_WORD: Partial<Record<Motif, string>> = { fork: 'a fork', skewer: 'a skewer', discoveredAttack: 'a discovered attack', doubleCheck: 'a double check', pin: 'a pin', trappedPiece: 'a trapped piece', capturingDefender: 'the capture of a defender', backRankMate: 'a back-rank mate' };
const article = (role: Role) => `a ${role}`;

/** A line in notation → engine moves, from a position. Stops at the first move that does not fit. */
function toUci(fen: string, sans: string[]): string[] {
  const pos = parsePosition(fen);
  const out: string[] = [];
  if (!pos) return out;
  for (const san of sans) {
    const move = anyToMove(pos, san);
    if (!move) break;
    out.push(describeMove(pos, move).uci);
    pos.play(move);
  }
  return out;
}

/** Was the clock the story? Nearly out of time, or a move of a few seconds in a game with time to think. */
function hurried(clock: MoveClock | undefined): boolean {
  if (!clock || !clock.base) return false;
  if (clock.left !== undefined && (clock.left < 20 || clock.left < clock.base * 0.05)) return true;
  return clock.spent !== undefined && clock.spent <= 3 && clock.base >= 300;
}

/**
 * The step the board points to. The order matters: a gift that was left, then a threat that was
 * already there, then the ways the move itself can go wrong.
 */
export function boardStepOf(input: TagInput): SkippedStep {
  const g = input.grade;
  const before = parsePosition(input.fenBefore);
  const played = before ? anyToMove(before, input.san) : null;
  if (!before || !played) return 'unknown';
  // 1. something was there for the taking, and the move neither took it nor lost anything
  const nothingLost = g.playedDelta >= -0.5 && g.mateAllowed === undefined;
  if (nothingLost && ((g.bestScore.mate ?? 0) > 0 || g.bestDelta - g.playedDelta >= 1)) return 'missed_free_material';
  if (g.playedDelta >= 0 && g.mateAllowed === undefined) return 'unknown';
  // 2. the punishing move was already possible before this move, and already won something
  const reply = g.line[1];
  const passBefore = passPosition(input.fenBefore);
  const passPos = passBefore ? parsePosition(passBefore) : null;
  if (reply && passPos && anyToMove(passPos, reply)) {
    if (g.mateAllowed !== undefined || capturables(passPos).some((c) => c.net > 0)) return 'missed_threat';
  }
  // 3. the move itself made the loss possible
  if (input.ownThreat) return 'assumed_reply';
  const info = describeMove(before, played);
  const after = parsePosition(info.fenAfter);
  const replyMove = after && reply ? anyToMove(after, reply) : null;
  if (after && replyMove && 'from' in replyMove) {
    const taken = after.board.get(replyMove.to);
    if (taken && taken.color === before.turn) {
      // a piece is simply taken. Taken by something cheaper, or with no defender at all, it was hung: one look
      // at their captures shows it. Defended, and taken by a piece worth as much or more, it only looked safe:
      // the count of attackers and defenders is what was skipped
      const by = after.board.get(replyMove.from);
      const defended = attackersOf(after, replyMove.to, before.turn).length > 0;
      return defended && !!by && ROLE_VALUE[by.role] >= ROLE_VALUE[taken.role] ? 'seemed_safe' : 'no_safety_check';
    }
    if (g.mateAllowed === undefined || g.mateAllowed > 1) {
      const themes = motifsOf(info.fenAfter, toUci(info.fenAfter, g.line.slice(1)), after.turn);
      if (themes.some((m) => TACTICS.includes(m))) return 'missed_tactic';
    }
  }
  return 'no_safety_check';
}

/** Tag one mistake: the skipped step, the tactical themes, and what it was in plain words. */
export function tagMistake(input: TagInput): MistakeTag {
  const g = input.grade;
  const boardStep = boardStepOf(input);
  const before = parsePosition(input.fenBefore);
  const played = before ? anyToMove(before, input.san) : null;
  const info = before && played ? describeMove(before, played) : null;
  const missed = boardStep === 'missed_free_material';
  // the themes of the chance that was missed, or of the line that punished the move
  let motifs: Motif[] = [];
  if (before && missed) motifs = motifsOf(input.fenBefore, toUci(input.fenBefore, g.bestLine), before.turn);
  else if (before && info && g.line.length > 1) motifs = motifsOf(info.fenAfter, toUci(info.fenAfter, g.line.slice(1)), before.turn === 'white' ? 'black' : 'white');
  const theme = motifs.find((m) => TACTICS.includes(m) || m === 'backRankMate');
  let what: string;
  if (missed) {
    const bestMove = before ? anyToMove(before, g.best) : null;
    const captured = before && bestMove ? describeMove(before, bestMove).captured : undefined;
    what = (g.bestScore.mate ?? 0) > 0 ? 'missed a checkmate' : theme && MOTIF_WORD[theme] && !captured ? `missed ${MOTIF_WORD[theme]}` : captured ? `missed a free ${captured}` : 'missed a chance to win material';
  } else if (g.mateAllowed !== undefined) what = 'allowed checkmate';
  else if (boardStep === 'missed_threat') what = 'left a threat unanswered';
  else if (boardStep === 'missed_tactic' && theme && MOTIF_WORD[theme]) what = `allowed ${MOTIF_WORD[theme]}`;
  else {
    // the piece the reply takes
    const after = info ? parsePosition(info.fenAfter) : null;
    const replyMove = after && g.line[1] ? anyToMove(after, g.line[1]) : null;
    const taken = after && replyMove && 'from' in replyMove ? after.board.get(replyMove.to) : undefined;
    what = taken ? (boardStep === 'seemed_safe' ? `lost ${article(taken.role)} that looked defended` : `hung ${article(taken.role)}`) : g.playedDelta < 0 ? 'lost material' : 'gave up the advantage';
  }
  return { step: hurried(input.clock) ? 'time' : boardStep, boardStep, motifs, what };
}

// ---------------------------------------------------------------- the findable move (H12)

export type Findable = { move: string; reason: 'best' | 'forcing' | 'simple' | 'likely' };

/**
 * The move to teach, with a model of human play (WP 7.8, H12): among the engine's moves about as good
 * as its first choice (within `margin`), none of them a sacrifice, the one players at the owner's
 * level play most often, by the model's probabilities (Maia's, at that rating; engine-style moves).
 * The move still comes from the engine's own lines. Null without probabilities or candidates.
 */
export function findableByPeople(fen: string, lines: EngineLine[], probs: ReadonlyMap<string, number>, margin = 2): Findable | null {
  const pos = parsePosition(fen);
  const first = lines[0];
  if (!pos || !first?.pv[0] || !probs.size) return null;
  const candidates = lines
    .filter((l) => l.pv[0] && dropOf(first.score, l.score) <= margin)
    .map((l, i) => {
      const move = uciToMove(pos, l.pv[0]!);
      if (!move) return null;
      const info = describeMove(pos, move);
      return { san: info.san, rank: i, p: probs.get(info.uci) ?? 0, sacrifice: sacrificeOf(fen, info.san) > 0 };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && !x.sacrifice);
  const top = [...candidates].sort((a, b) => b.p - a.p || a.rank - b.rank)[0];
  if (!top || top.p <= 0) return null;
  return { move: top.san, reason: top.rank === 0 ? 'best' : 'likely' };
}

/**
 * The move to teach. Among the engine's moves that are about as good as its first choice, a
 * beginner finds a forcing one (a mate, a capture, a check) sooner than a quiet one, and a move
 * that gives nothing up sooner than a sacrifice. `margin` is how far below the best a move may be,
 * in points of winning chances. The move always comes from the engine's own lines.
 */
export function findableMove(fen: string, lines: EngineLine[], margin = 2): Findable | null {
  const pos = parsePosition(fen);
  const first = lines[0];
  if (!pos || !first?.pv[0]) return null;
  const close = lines.filter((l) => l.pv[0] && dropOf(first.score, l.score) <= margin);
  const scored = close
    .map((l, i) => {
      const move = uciToMove(pos, l.pv[0]!);
      if (!move) return null;
      const info = describeMove(pos, move);
      // forcing first: a mate, then the biggest capture, then a check
      const forcing = info.mate ? 100 : info.captured ? 10 + ROLE_VALUE[info.captured] : info.check ? 5 : 0;
      return { san: info.san, rank: i, forcing, sacrifice: sacrificeOf(fen, info.san) > 0 };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const best = scored[0];
  if (!best) return null;
  const sound = scored.filter((s) => !s.sacrifice);
  const forcing = [...sound].sort((a, b) => b.forcing - a.forcing || a.rank - b.rank)[0];
  if (forcing && forcing.forcing > 0 && forcing.forcing > best.forcing) return { move: forcing.san, reason: 'forcing' };
  if (best.sacrifice && sound[0]) return { move: sound[0].san, reason: 'simple' };
  return { move: best.san, reason: 'best' };
}
