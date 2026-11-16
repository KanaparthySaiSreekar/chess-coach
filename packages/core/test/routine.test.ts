import { describe, expect, it } from 'vitest';
import { ROUTINE_PROMPTS, promptAt, routineLevel, routinePrompt } from '../src/index.ts';

describe('the routine overlay (A9)', () => {
  it('prompt frequency follows the profile: often while blunders are common, fading as they get rare', () => {
    // too few analysed games to say: every move
    expect(routineLevel({ blundersPer100: null, games: 0 })).toBe('every');
    expect(routineLevel({ blundersPer100: 5, games: 2 })).toBe('every');
    // about 600 (38.7 per 100 in the published figures): every move
    expect(routineLevel({ blundersPer100: 38, games: 10 })).toBe('every');
    // between 600 and 1000: every other move
    expect(routineLevel({ blundersPer100: 24, games: 10 })).toBe('often');
    // about 1300: every fourth
    expect(routineLevel({ blundersPer100: 15, games: 10 })).toBe('sometimes');
    // the habit has stuck: none
    expect(routineLevel({ blundersPer100: 8, games: 10 })).toBe('off');
    const count = (level: Parameters<typeof promptAt>[0]) => Array.from({ length: 40 }, (_, i) => i + 1).filter((n) => promptAt(level, n)).length;
    expect([count('every'), count('often'), count('sometimes'), count('off')]).toEqual([40, 20, 10, 0]);
  });

  it('asks about the step the owner skips most every other time, and goes round the routine otherwise', () => {
    expect(routinePrompt(1, 'missed_threat')).toBe(ROUTINE_PROMPTS.threat);
    expect(routinePrompt(3, 'missed_threat')).toBe(ROUTINE_PROMPTS.threat);
    expect(routinePrompt(2, 'missed_threat')).not.toBe(ROUTINE_PROMPTS.threat);
    expect(routinePrompt(1, 'no_safety_check')).toBe(ROUTINE_PROMPTS.blunder);
    // with no habit to work on, the routine in its order
    expect([1, 2, 3, 4, 5].map((n) => routinePrompt(n))).toEqual([ROUTINE_PROMPTS.threat, ROUTINE_PROMPTS.options, ROUTINE_PROMPTS.candidates, ROUTINE_PROMPTS.blunder, ROUTINE_PROMPTS.threat]);
    // a step with no routine question of its own (the clock) leaves the order as it is
    expect(routinePrompt(1, 'time')).toBe(ROUTINE_PROMPTS.threat);
  });
});
