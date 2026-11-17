// The Openings tab's repertoire browser (feature D9; 2026-11-15): a repertoire as positions to walk
// on a board. In each position of the owner's: the move the repertoire plays, its why and the
// opponent's idea (as written and checked, WP 8.6). In each of the opponent's: the replies the
// repertoire prepares. Built from the lines that are not in quarantine (live, or waiting for the
// owner's approval, which the page marks).

import { positionKey } from './chess.ts';
import { lineSteps, type MoveFrom, type RepLine, type WordsBy } from './repertoire.ts';

export type BrowserPosition = {
  /** the owner's position: the move the repertoire plays here; `from` where the move comes from, `wordsBy` who wrote its words (D13) */
  mine?: { san: string; uci: string; why?: string; idea?: string; wordsBy?: WordsBy; punish?: boolean; waiting?: boolean; from?: MoveFrom };
  /** the opponent's position: the replies prepared, each to follow, and why each is prepared */
  replies?: { san: string; uci: string; waiting?: boolean; from?: MoveFrom[] }[];
};

/** Positions by key, from lines that are live or waiting. `waiting` marks a line the owner has not approved yet. */
export function browserPositions(lines: readonly { body: RepLine; waiting: boolean }[], words: ReadonlyMap<string, { uci: string; why?: string; idea?: string; by?: WordsBy }>): Record<string, BrowserPosition> {
  const out: Record<string, BrowserPosition> = {};
  for (const { body: line, waiting } of lines) {
    const { steps, illegalAt } = lineSteps(line);
    if (illegalAt !== undefined) continue;
    for (const s of steps) {
      const key = positionKey(s.fenBefore);
      const at = (out[key] ??= {});
      if (s.mine) {
        if (at.mine) {
          if (!waiting) at.mine.waiting = undefined; // a live line makes the move live
          continue;
        }
        const w = words.get(key);
        const prev = steps[steps.indexOf(s) - 1];
        at.mine = {
          san: s.san,
          uci: s.uci,
          why: w?.uci === s.uci ? w.why : undefined,
          idea: w?.uci === s.uci ? w.idea : undefined,
          wordsBy: w?.uci === s.uci && (w.why || w.idea) ? w.by : undefined,
          punish: prev && !prev.mine && line.punish?.includes(prev.index) ? true : undefined,
          waiting: waiting || undefined,
        };
      } else {
        const replies = (at.replies ??= []);
        const r = replies.find((x) => x.uci === s.uci);
        if (!r) replies.push({ san: s.san, uci: s.uci, waiting: waiting || undefined });
        else if (!waiting) r.waiting = undefined;
      }
    }
  }
  return out;
}

/** How many moves a chapter's lines share from the start (where the chapter's position is, when no outline says). */
export function commonMoves(lines: readonly { moves: readonly string[] }[]): number {
  if (!lines.length) return 0;
  if (lines.length === 1) return Math.min(2, lines[0]!.moves.length);
  const clean = (s: string) => s.replace(/[+#!?]+$/g, '');
  let n = 0;
  for (;;) {
    const m = lines[0]!.moves[n];
    if (m === undefined || !lines.every((l) => l.moves[n] !== undefined && clean(l.moves[n]!) === clean(m))) return n;
    n++;
  }
}
