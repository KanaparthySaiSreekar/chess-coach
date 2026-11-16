// The routine overlay (feature A9; PLAN WP 7.5): in games against the bots, a short prompt for the
// thinking routine before the owner's move, often at first and less as the habit shows in their
// games (DP9: fade guidance as mastery grows). How often follows the skill profile's blunder rate
// (WP 5.8); which step is asked follows the step the owner skips most.

import type { SkippedStep } from './facts.ts';

/** How often the routine is voiced: before every move, every other one, every fourth, or not at all. */
export type RoutineLevel = 'every' | 'often' | 'sometimes' | 'off';

/** The four steps of the routine (CLAUDE.md, LEARNING §4), as short questions before a move. */
export const ROUTINE_PROMPTS = {
  threat: 'Their move: what does it threaten?',
  options: 'Your checks, captures and threats?',
  candidates: 'Which two moves are you choosing between?',
  blunder: 'Before you play it: after your move, what could they capture or check?',
} as const;
export type RoutineStep = keyof typeof ROUTINE_PROMPTS;

/** The routine step that works on each skipped step. */
const STEP_FOR: Partial<Record<SkippedStep, RoutineStep>> = {
  missed_threat: 'threat',
  no_safety_check: 'blunder',
  seemed_safe: 'blunder',
  assumed_reply: 'blunder',
  missed_tactic: 'options',
  missed_free_material: 'options',
};

/** The thresholds (TRACKER D71): blunders per 100 live moves, as the skill profile counts them, and the games it needs. */
export const ROUTINE_RULES = { minGames: 3, every: 30, often: 20, sometimes: 12 };

/**
 * How often to prompt, from the owner's blunder rate (the latest games when there are enough) and
 * how many analysed games it rests on. With too few games, every move.
 */
export function routineLevel(p: { blundersPer100: number | null; games: number }): RoutineLevel {
  if (p.blundersPer100 === null || p.games < ROUTINE_RULES.minGames) return 'every';
  if (p.blundersPer100 >= ROUTINE_RULES.every) return 'every';
  if (p.blundersPer100 >= ROUTINE_RULES.often) return 'often';
  if (p.blundersPer100 >= ROUTINE_RULES.sometimes) return 'sometimes';
  return 'off';
}

/** Is there a prompt before the owner's `n`th move (1, 2, …) at this level? */
export function promptAt(level: RoutineLevel, n: number): boolean {
  if (level === 'every') return true;
  if (level === 'often') return n % 2 === 1;
  if (level === 'sometimes') return n % 4 === 1;
  return false;
}

/**
 * The prompt before the owner's `n`th move. Every other prompt is the step that works on the step
 * they skip most; the others go round the routine in its order.
 */
export function routinePrompt(n: number, top?: SkippedStep): string {
  const focus = top ? STEP_FOR[top] : undefined;
  const order: RoutineStep[] = ['threat', 'options', 'candidates', 'blunder'];
  if (!focus) return ROUTINE_PROMPTS[order[(n - 1) % order.length]!];
  if (n % 2 === 1) return ROUTINE_PROMPTS[focus];
  // the other prompts go round the rest of the routine
  const rest = order.filter((s) => s !== focus);
  return ROUTINE_PROMPTS[rest[(n / 2 - 1) % rest.length]!];
}
