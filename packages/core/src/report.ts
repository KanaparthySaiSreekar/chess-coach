// The review report of one game (features B10, G6; LEARNING §4, step 5: "write 2–4 takeaways").
//
// Built by code from what the analysis stored: the labels of the owner's moves, the tag on each
// slip, how the replay went. Every sentence is a count or a tag that is already checked, so the
// report cannot say anything the engine did not find (D33). The shape is a positive sandwich:
// something true that went well, the takeaways, something true to end on.

import type { SkippedStep } from './facts.ts';
import type { GameNumbers } from './review.ts';

/** The habit behind each skipped step, as the thing to do next time. */
export const STEP_HABIT: Record<SkippedStep, string> = {
  missed_threat: 'Before you choose a move, ask what their last move was trying to do',
  no_safety_check: 'After you choose a move and before you play it, look at every capture, check and threat they would have',
  seemed_safe: 'Before you put a piece on a square, count what attacks it there and what defends it',
  missed_tactic: 'When a move looks natural, look one move further: what do they play back?',
  assumed_reply: 'When your move makes a threat, ask what happens if they do not answer it the way you hope',
  missed_free_material: 'Before every move, look for their pieces that nothing protects',
  time: 'Slow down for the moves that matter: a few more seconds on a capture or a threat',
  unknown: 'Say out loud what your move is for before you play it',
};

/** One slip of the owner's, as the analysis stored it. */
export type ReportSlip = {
  ply: number;
  san: string;
  label: string;
  /** the skipped step: the owner's own word for it when they gave one, else the machine's tag */
  step: SkippedStep;
  what?: string;
};

export type Takeaway = {
  step: SkippedStep;
  /** the habit, and where in this game it was missing */
  text: string;
  /** the moves it rests on, as half-move numbers */
  plies: number[];
  /** the same habit was a takeaway of an earlier game */
  again?: boolean;
};

export type ReviewReport = {
  /** what went well: one or two true counts from the game */
  positives: string[];
  /** the habits to work on, most often skipped first: at most four, and none that the game does not show */
  takeaways: Takeaway[];
  /** how the takeaways of the last reviewed game fared in this one */
  since: { step: SkippedStep; habit: string; cameUpAgain: boolean }[];
  /** the last line of the sandwich */
  closing: string;
};

export type ReportInput = {
  numbers: GameNumbers;
  slips: ReportSlip[];
  /** how going through the key moments went, when it was done */
  replay?: { found: number; total: number };
  /** the takeaways of the game reviewed before this one */
  earlier?: SkippedStep[];
  /** every habit that has been a takeaway before, for "again" */
  known?: ReadonlySet<SkippedStep>;
  max?: number;
};

const moveNumber = (ply: number) => Math.ceil(ply / 2);
const listed = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Where a habit was missing: "move 12 (Nf6)" or "moves 12 (Nf6) and 23 (Rb3)". */
function evidence(slips: ReportSlip[]): string {
  const shown = slips.slice(0, 3).map((s) => `${moveNumber(s.ply)} (${s.san})`);
  const more = slips.length - shown.length;
  return `${slips.length === 1 ? 'move' : 'moves'} ${listed(shown)}${more > 0 ? ` and ${plural(more, 'other', 'others')}` : ''}`;
}

export function buildReport(input: ReportInput): ReviewReport {
  const n = input.numbers;
  const max = Math.max(1, Math.min(4, input.max ?? 4));
  // ---- the takeaways: one per skipped step that the game shows, the most frequent first
  const byStep = new Map<SkippedStep, ReportSlip[]>();
  for (const slip of [...input.slips].sort((a, b) => a.ply - b.ply)) {
    if (slip.step === 'unknown') continue;
    byStep.set(slip.step, [...(byStep.get(slip.step) ?? []), slip]);
  }
  const takeaways: Takeaway[] = [...byStep.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[1][0]!.ply - b[1][0]!.ply)
    .slice(0, max)
    .map(([step, slips]) => ({
      step,
      text: `${STEP_HABIT[step]}. That step was missing on ${evidence(slips)}.`,
      plies: slips.map((s) => s.ply),
      ...(input.known?.has(step) ? { again: true } : {}),
    }));

  // ---- what went well: counts, never opinions
  const positives: string[] = [];
  if (n.strong > 0) positives.push(`You played the engine's first choice, or a move just as good, on ${n.strong} of your ${plural(n.moves, 'move', 'moves')}.`);
  const first = [...input.slips].sort((a, b) => a.ply - b.ply)[0];
  if (!input.slips.length) positives.push('None of your moves was a mistake, a blunder or a missed chance.');
  else if (n.blunders === 0) positives.push('You made no blunders in this game.');
  else if (first && moveNumber(first.ply) > 10) positives.push(`Your first ${moveNumber(first.ply) - 1} moves were clean: the first slip came on move ${moveNumber(first.ply)}.`);
  const found = input.replay && input.replay.found > 0 ? `Going through the key moments, you found the better move yourself ${input.replay.found === input.replay.total ? (input.replay.total === 1 ? 'when you looked for it' : 'every time') : `in ${input.replay.found} of ${input.replay.total}`}.` : undefined;

  // ---- since the last game: did its takeaways come up again?
  const since = (input.earlier ?? []).filter((s) => s !== 'unknown').map((step) => ({ step, habit: STEP_HABIT[step], cameUpAgain: byStep.has(step) }));
  const kept = since.filter((s) => !s.cameUpAgain);

  // ---- the last slice: the best true thing that has not been said yet
  const closing = found ?? (kept.length ? `A takeaway from your last game did not come up this time: ${kept[0]!.habit.charAt(0).toLowerCase()}${kept[0]!.habit.slice(1)}.` : takeaways.length ? 'One habit at a time: the first takeaway is the one to take into your next game.' : 'Nothing here to fix: play the next one the same way.');
  return { positives: positives.slice(0, 2), takeaways, since, closing };
}

/** One line of the takeaway journal: a habit, and how many reviewed games it has come up in. */
export type JournalEntry = { step: SkippedStep; habit: string; games: number; lastAt: string };
