// Endgame training (feature F2; built early at the owner's request, 2026-11-15): key endgames played
// out against the engine until the owner can win or hold them, in the order of the ladder (queen
// mate, rook mate, the two-rook ladder, the square of the pawn, the opposition, Lucena and Philidor).
// With five pieces or fewer the Syzygy tablebases decide every position exactly, so the moment a
// move lets a win slip (or loses a draw) is known, and so is the move that kept it.

import { parsePosition, type Color } from './chess.ts';
import type { GateResult } from './content.ts';
import type { Score } from './winchance.ts';

export type EndgameGoal = 'mate' | 'promote' | 'draw';
export type EndgameTopic = { id: string; name: string; about: string };
export type EndgamePosition = { id: string; topic: string; name: string; fen: string; goal: EndgameGoal; idea?: string };
export type EndgameFile = { topics: EndgameTopic[]; positions: EndgamePosition[] };

/** As stored (a content item of type `endgame`). */
export type EndgameItem = EndgamePosition & { topicName: string; order: number; side: Color };

/** A draw is held once the owner has made this many moves with the draw kept. */
export const ENDGAME_HOLD_MOVES = 12;
/** A win not finished in this many of the owner's moves stops there (kept, not finished). */
export const ENDGAME_MAX_MOVES = 60;
/** The tablebases are exact up to this many pieces (the 3-4-5 set is installed). */
export const ENDGAME_TB_PIECES = 5;

/** The verdict for the side to move, from the engine's score (Stockfish reports a tablebase win as ±20000). */
export function verdictOf(score: Score): 'win' | 'loss' | 'draw' | 'unclear' {
  if (score.mate !== undefined) return score.mate > 0 ? 'win' : 'loss';
  const cp = score.cp ?? 0;
  if (cp >= 15_000) return 'win';
  if (cp <= -15_000) return 'loss';
  return Math.abs(cp) <= 30 ? 'draw' : 'unclear';
}

/** V1 for an endgame position: a legal position, the side to move is the owner's, few enough pieces for the tablebases, a known topic. */
export function readEndgame(p: EndgamePosition, topics: readonly EndgameTopic[], order: number): { ok: true; item: EndgameItem } | { ok: false; reason: string } {
  if (!/^[a-z0-9-]{2,40}$/.test(p.id ?? '')) return { ok: false, reason: `"${p.id}" is not a usable id` };
  const topic = topics.find((t) => t.id === p.topic);
  if (!topic) return { ok: false, reason: `there is no topic "${p.topic}"` };
  if (p.goal !== 'mate' && p.goal !== 'promote' && p.goal !== 'draw') return { ok: false, reason: 'the goal must be mate, promote or draw' };
  const pos = parsePosition(p.fen);
  if (!pos) return { ok: false, reason: 'the position is not legal' };
  if (pos.isEnd()) return { ok: false, reason: 'the game is already over in this position' };
  const pieces = [...pos.board.occupied].length;
  if (pieces > ENDGAME_TB_PIECES) return { ok: false, reason: `${pieces} pieces: the tablebases cover ${ENDGAME_TB_PIECES} at most` };
  return { ok: true, item: { ...p, topicName: topic.name, order, side: pos.turn } };
}

/** V8 (teaching lint) for an endgame position: a level band, a short idea (three sentences at most), and a topic with more than one position. */
export function gateV8Endgame(item: EndgameItem, level: string | undefined, file: EndgameFile): GateResult {
  const problems: string[] = [];
  if (!level) problems.push('the level band is not set');
  const sentences = (item.idea ?? '').split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;
  if (sentences > 3) problems.push(`the idea has ${sentences} sentences: three at most`);
  if ((item.idea ?? '').length > 280) problems.push('the idea is longer than 280 characters');
  if (file.positions.filter((p) => p.topic === item.topic).length < 2) problems.push(`the topic "${item.topicName}" has only this position: a topic needs a second to practise on`);
  return problems.length ? { gate: 'V8', result: 'fail', detail: problems.join('; ') } : { gate: 'V8', result: 'pass' };
}

/** What the owner is asked to do, in words. */
export function endgameTask(goal: EndgameGoal, side: Color): string {
  const who = side === 'white' ? 'White' : 'Black';
  if (goal === 'mate') return `${who} to play: give mate.`;
  if (goal === 'promote') return `${who} to play: queen the pawn and keep the win.`;
  return `${who} to play: hold the draw.`;
}

/** Does the verdict (for the side to move after the owner's move: the opponent) keep the goal? */
export function keepsGoal(goal: EndgameGoal, opponentVerdict: ReturnType<typeof verdictOf>): boolean {
  return goal === 'draw' ? opponentVerdict !== 'win' : opponentVerdict === 'loss';
}

/** The basic mates that can start from a new position each time (PLAN 9.3): the pieces White mates with. */
export type RandomStart = 'queen' | 'rook' | 'two-rooks';
/** Which topic of the ladder each random start belongs to. */
export const RANDOM_TOPIC: Readonly<Record<string, RandomStart>> = { 'queen-mate': 'queen', 'rook-mate': 'rook', 'two-rooks': 'two-rooks' };
const RANDOM_PIECES: Record<RandomStart, string[]> = { queen: ['Q'], rook: ['R'], 'two-rooks': ['R', 'R'] };

/**
 * A new start for a basic mate: White's king and piece(s) against the lone black king, White to
 * move. Their king starts in the middle of the board (so it is a real mate to give, not one move
 * from the edge), the kings at least three squares apart, no White piece next to their king, and
 * their king not in check. Legal by construction and read back through the rules; the trainer then
 * asks the tablebases that it is a win (V2) before it is played. `rand` is the source of chance
 * (seeded in tests).
 */
export function randomStart(kind: RandomStart, rand: () => number = Math.random): string {
  const pick = (n: number) => Math.min(n - 1, Math.floor(rand() * n));
  const dist = (a: number, b: number) => Math.max(Math.abs((a % 8) - (b % 8)), Math.abs(Math.floor(a / 8) - Math.floor(b / 8)));
  for (let tries = 0; tries < 2000; tries++) {
    // their king on c3–f6: files c–f, ranks 3–6 (index = rank * 8 + file, a1 = 0)
    const bk = (2 + pick(4)) * 8 + (2 + pick(4));
    const wk = pick(64);
    if (dist(wk, bk) < 3) continue;
    const board = new Map<number, string>([
      [bk, 'k'],
      [wk, 'K'],
    ]);
    let ok = true;
    for (const p of RANDOM_PIECES[kind]) {
      const s = pick(64);
      if (board.has(s) || dist(s, bk) < 2) {
        ok = false;
        break;
      }
      board.set(s, p);
    }
    if (!ok) continue;
    const rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
      let row = '';
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = board.get(r * 8 + f);
        if (!p) {
          empty++;
          continue;
        }
        if (empty) row += String(empty);
        empty = 0;
        row += p;
      }
      rows.push(row + (empty ? String(empty) : ''));
    }
    const placement = rows.join('/');
    const fen = `${placement} w - - 0 1`;
    const pos = parsePosition(fen);
    // their king must not be in check with White to move (the same board with Black to move shows it)
    const theirs = parsePosition(`${placement} b - - 0 1`);
    if (!pos || !theirs || theirs.isCheck() || pos.isEnd()) continue;
    return fen;
  }
  throw new Error(`no start found for ${kind}`);
}
