// Opening drill cards (features D3, D4; CONTENT §7; PLAN WP 8.8): one card per position of mine in
// the owner's live repertoires, so a transposition is learned once. A card holds the position, my
// move, its why and the opponent's idea (both written per position and checked by V3, WP 8.6), and
// the replies the repertoire prepares after my move. Everything on a card comes from lines that
// passed their gates; the card itself only re-checks that the move is legal (V1) and its envelope (V6).

import { describeMove, mustPosition, parsePosition, positionKey, sanToMove, uciToMove, type Color } from './chess.ts';
import type { GateResult } from './content.ts';
import { lineSteps, type RepLine } from './repertoire.ts';
import type { TrapItem } from './trap.ts';

export type OpeningCard = {
  /** the position, the owner to move */
  fen: string;
  colour: Color;
  repertoire: number;
  /** the position's key in the repertoire (placement, side, castling, en passant) */
  key: string;
  move: { uci: string; san: string };
  /** how the position was reached in the first line through it (SAN from the start), for context */
  line: string[];
  startFen: string;
  why?: string;
  idea?: string;
  /** the opponent's replies the repertoire prepares after my move */
  replies: { uci: string; san: string }[];
  /** the opponent's last move is a mistake to punish (marked by the starter builder) */
  punish?: boolean;
  /** a card of the trap pack (WP 8.9): its name, whether it is avoided or sprung, and the move they hope for */
  trap?: { name: string; kind: 'avoid' | 'punish'; hope?: string };
  /** other moves that count as right here (a trap's other sound defences, from the engine) */
  accepted?: string[];
  /** the chapters of the lines through the position (D11), the first one first */
  chapters?: string[];
  /** where the card comes in the repertoire's teaching order (new cards are shown in this order) */
  order?: number;
  /** a line built from the book: how many of the masters' games played my move here (its grounding) */
  book?: number;
};

/**
 * The cards of one repertoire: every position of mine on its live lines, once, up to the owner's
 * depth (moves of mine past it are kept in the lines but not drilled). The first line through a
 * position gives its context; the replies are gathered from every line.
 */
export function openingCards(repertoire: number, lines: readonly RepLine[], words: ReadonlyMap<string, { uci: string; why?: string; idea?: string }>, depthMoves: number): OpeningCard[] {
  const cards = new Map<string, OpeningCard>();
  // in the teaching order: a position shared by several chapters belongs first to the one taught first
  const ordered = lines.map((line, li) => ({ line, li })).sort((a, b) => (a.line.order ?? a.li) - (b.line.order ?? b.li));
  for (const { line, li } of ordered) {
    const { steps, illegalAt } = lineSteps(line);
    if (illegalAt !== undefined) continue;
    let mine = 0;
    for (const [i, s] of steps.entries()) {
      if (!s.mine) continue;
      if (++mine > depthMoves) break;
      const key = positionKey(s.fenBefore);
      let card = cards.get(key);
      // the teaching order: the line's place, then the move's place in it (the first lines' first moves first)
      const order = (line.order ?? li) * 100 + mine;
      if (card) {
        if (line.chapter && !card.chapters?.includes(line.chapter)) card.chapters = [...(card.chapters ?? []), line.chapter];
        if (order < (card.order ?? Infinity)) card.order = order;
      }
      if (!card) {
        const w = words.get(key);
        const prev = i > 0 ? steps[i - 1] : undefined;
        card = {
          fen: s.fenBefore,
          colour: line.colour,
          repertoire,
          key,
          move: { uci: s.uci, san: s.san },
          line: line.moves.slice(0, s.index),
          startFen: line.startFen,
          why: w?.uci === s.uci ? w.why : undefined,
          idea: w?.uci === s.uci ? w.idea : undefined,
          replies: [],
          punish: prev && !prev.mine && line.punish?.includes(prev.index) ? true : undefined,
          chapters: line.chapter ? [line.chapter] : undefined,
          order,
          book: line.book?.[s.index],
        };
        cards.set(key, card);
      }
      // a position seen again with another move of mine would be a conflict: V5 keeps those out of live lines
      if (card.move.uci !== s.uci) continue;
      const reply = steps[i + 1];
      if (reply && !reply.mine && !card.replies.some((r) => r.uci === reply.uci)) card.replies.push({ uci: reply.uci, san: reply.san });
    }
  }
  return [...cards.values()];
}

/** A card's key as a content item: one per repertoire and position. */
export function openingCardKey(card: Pick<OpeningCard, 'repertoire' | 'key'>): string {
  return `opening:${card.repertoire}|${card.key}`;
}

/** V1 for a card: the position is valid and the move is legal in it. */
export function gateV1Opening(card: OpeningCard): GateResult {
  const pos = parsePosition(card.fen);
  if (!pos) return { gate: 'V1', result: 'fail', detail: 'the position is not valid' };
  if (pos.turn !== card.colour) return { gate: 'V1', result: 'fail', detail: 'it is not the side of the repertoire to move' };
  if (!uciToMove(pos, card.move.uci)) return { gate: 'V1', result: 'fail', detail: `${card.move.san} is not legal in the position` };
  return { gate: 'V1', result: 'pass' };
}

/** Is a move the owner played the card's move? (by the move itself, however it was entered) */
export function isCardMove(card: OpeningCard, uciOrSan: string): boolean {
  const pos = mustPosition(card.fen);
  const m = uciToMove(pos, uciOrSan) ?? sanToMove(pos, uciOrSan);
  if (!m) return false;
  const uci = describeMove(pos, m).uci;
  return uci === card.move.uci || !!card.accepted?.includes(uci);
}

/** Whether the "why this move?" check comes up on this review (every `every`-th time a card is answered right, and never on a card with no why). A trap to avoid asks what they hoped for instead, so it needs its idea. */
export function asksWhy(card: OpeningCard, rightBefore: number, every: number): boolean {
  const words = card.trap?.kind === 'avoid' ? card.idea : card.why;
  return !!words && every > 0 && (rightBefore + 1) % every === 0;
}

/** A trap of the pack as an opening card (repertoire 0, keyed by the trap's id). */
export function trapCard(t: TrapItem): OpeningCard {
  return {
    fen: t.fen,
    colour: t.colour,
    repertoire: 0,
    key: t.id,
    move: t.move,
    line: t.line,
    startFen: t.startFen,
    why: t.why,
    idea: t.idea,
    replies: [],
    trap: { name: t.name, kind: t.kind, hope: t.hope?.san },
    accepted: t.accepted,
  };
}
