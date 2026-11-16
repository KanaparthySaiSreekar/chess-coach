import { describe, expect, it } from 'vitest';
import { TIME_CONTROLS, clockAfterMove, clockLeft, clockStopped, clockText, newClock } from '../src/index.ts';

describe('the clocks of a game against a bot (I10)', () => {
  it('a move takes the time used, adds the increment, and starts the other clock', () => {
    const c = newClock({ base: 600, inc: 5 }, 1_000);
    expect(c).toEqual({ white: 600_000, black: 600_000, inc: 5_000, running: 'white', at: 1_000 });
    expect(clockLeft(c, 'white', 31_000)).toBe(570_000);
    expect(clockLeft(c, 'black', 31_000)).toBe(600_000);
    const after = clockAfterMove(c, 'white', 31_000)!;
    expect(after).toEqual({ white: 575_000, black: 600_000, inc: 5_000, running: 'black', at: 31_000 });
    const back = clockAfterMove(after, 'black', 41_000)!;
    expect(back).toMatchObject({ white: 575_000, black: 595_000, running: 'white' });
  });

  it('a side out of time has flagged before it could move; a stopped clock keeps what each side had', () => {
    const c = newClock({ base: 60, inc: 0 }, 0);
    expect(clockAfterMove(c, 'white', 60_000)).toBeNull();
    expect(clockAfterMove(c, 'white', 59_999)).not.toBeNull();
    expect(clockStopped(c, 20_000)).toEqual({ white: 40_000, black: 60_000, inc: 0, running: undefined, at: 20_000 });
    expect(clockStopped(c, 90_000).white).toBe(0);
  });

  it('reads as minutes and seconds, with tenths under ten seconds; no clock is the first choice', () => {
    expect(clockText(605_000)).toBe('10:05');
    expect(clockText(59_001)).toBe('1:00');
    expect(clockText(9_440)).toBe('0:09.4');
    expect(clockText(3_725_000)).toBe('1:02:05');
    expect(clockText(-5)).toBe('0:00.0');
    expect(TIME_CONTROLS[0]).toEqual({ id: 'untimed', label: 'No clock', time: null });
    expect(TIME_CONTROLS.every((t) => !t.time || t.time.base >= 600)).toBe(true);
  });
});
