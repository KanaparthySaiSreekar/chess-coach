// Clocks for games against the bots (feature I10; PLAN WP 7.3). Untimed by default: the owner is a
// beginner who plays slow games (DP14), and a clock is there when they want one. The server keeps
// the time; the page only counts down between updates.

import type { Color } from './chess.ts';

/** A time control: minutes as seconds, and the seconds added after each move. */
export type TimeControl = { base: number; inc: number };

/** The choices on the page. Rapid and classical, as the owner plays online; no bullet or blitz. */
export const TIME_CONTROLS: { id: string; label: string; time: TimeControl | null }[] = [
  { id: 'untimed', label: 'No clock', time: null },
  { id: '10+0', label: '10 min', time: { base: 600, inc: 0 } },
  { id: '10+5', label: '10 + 5', time: { base: 600, inc: 5 } },
  { id: '15+10', label: '15 + 10', time: { base: 900, inc: 10 } },
  { id: '30+0', label: '30 min', time: { base: 1800, inc: 0 } },
  { id: '30+20', label: '30 + 20', time: { base: 1800, inc: 20 } },
];

/** The clocks of a game: each side's time left (ms) when `at` (epoch ms) was set, and whose is running. */
export type GameClock = { white: number; black: number; inc: number; running?: Color; at: number };

/** A new clock for a time control: White's starts at once. */
export function newClock(time: TimeControl, now: number): GameClock {
  return { white: time.base * 1000, black: time.base * 1000, inc: time.inc * 1000, running: 'white', at: now };
}

/** The time a side has left now. */
export function clockLeft(c: GameClock, side: Color, now: number): number {
  return c[side] - (c.running === side ? Math.max(0, now - c.at) : 0);
}

/**
 * A move by `mover`: their time is taken, the increment added, and the other clock starts. Null when
 * the mover had no time left before the move: the flag fell first.
 */
export function clockAfterMove(c: GameClock, mover: Color, now: number): GameClock | null {
  const left = clockLeft(c, mover, now);
  if (left <= 0) return null;
  const other: Color = mover === 'white' ? 'black' : 'white';
  return { ...c, [mover]: left + c.inc, running: other, at: now };
}

/** The clocks stopped (the game is over, or paused): each side keeps what it has left. */
export function clockStopped(c: GameClock, now: number): GameClock {
  return { ...c, white: Math.max(0, clockLeft(c, 'white', now)), black: Math.max(0, clockLeft(c, 'black', now)), running: undefined, at: now };
}

/** "4:05", or "0:09.4" under ten seconds. */
export function clockText(ms: number): string {
  const t = Math.max(0, ms);
  if (t < 10_000) return `0:0${(Math.floor(t / 100) / 10).toFixed(1)}`;
  const s = Math.ceil(t / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
