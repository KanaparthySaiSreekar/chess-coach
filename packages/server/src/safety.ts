// The safety-check trainer (feature C7; PLAN WP 6.6). Items are made from the owner's slips once
// a game has been gone through: the move they played, which lost something, and the engine's
// first choice, which did not. Three items a slip: "is this move safe?" about each move, and
// "which of these two is not safe?" about both. Every verdict and every reason is the engine's
// checked fact (FactService.checkMove). Items go through gates V1 and V6 and only live ones are
// asked; answers are scheduled like puzzles.

import {
  candidateArrow,
  forcingReplies,
  gateV1Safety,
  gateV6,
  judgeSafety,
  legalMoves,
  parsePosition,
  plainText,
  safetyReason,
  type ContentItem,
  type GamePly,
  type SafetyCandidate,
  type SafetyItem,
  type SafetyReply,
  type SafetyView,
} from '@chess-coach/core';
import type { Db } from './db.ts';
import { DrillDeck, type Stored } from './drill-deck.ts';
import type { FactService } from './facts-service.ts';

/** The owner's slips that lost something (not chances missed): what a safety check is about. */
export function safetySlips(plies: GamePly[], you: 'white' | 'black', max: number): GamePly[] {
  return plies
    .filter((p) => p.by === you && !!p.grade && p.grade.live && (p.judged?.label === 'mistake' || p.judged?.label === 'blunder') && (p.grade.playedDelta < 0 || p.grade.mateAllowed !== undefined))
    .sort((a, b) => b.grade!.drop - a.grade!.drop || a.ply - b.ply)
    .slice(0, Math.max(0, max));
}

/**
 * The engine's verdict on one move for the side to move (check_move): safe when nothing is lost by
 * force and no mate is allowed, with the reason in plain words. Null when the move is not legal.
 */
export async function moveVerdict(facts: FactService, fen: string, san: string): Promise<SafetyCandidate | null> {
  const pos = parsePosition(fen);
  if (!pos) return null;
  const r = await facts.checkMove(fen, san, pos.turn);
  if (!r.legal) return null;
  const main = r.facts.find((f) => f.id === r.factId);
  if (!main) return null;
  return { san: r.san, safe: r.grade.playedDelta >= 0 && r.grade.mateAllowed === undefined, why: safetyReason(plainText(main.text)) };
}

/** The same move written two ways? (A check sign makes no difference.) */
export const sameMove = (a: string, b: string) => a.replace(/[+#]/g, '') === b.replace(/[+#]/g, '');

/** Make the items of one slip from the engine's verdicts on the move played and on its first choice. Nothing is stored. */
export async function safetyItems(facts: FactService, slip: { fenBefore: string; san: string; best: string }): Promise<SafetyItem[]> {
  if (!parsePosition(slip.fenBefore) || sameMove(slip.best, slip.san)) return [];
  const [played, best] = await Promise.all([moveVerdict(facts, slip.fenBefore, slip.san), moveVerdict(facts, slip.fenBefore, slip.best)]);
  // the item needs the move played to be unsafe and the other safe, as the engine sees them now
  if (!played || !best || played.safe || !best.safe) return [];
  return [
    { fen: slip.fenBefore, question: 'is_safe', candidates: [played], played: played.san },
    { fen: slip.fenBefore, question: 'is_safe', candidates: [best], played: played.san },
    // the order of the two is fixed by the moves, so it does not give the answer away
    { fen: slip.fenBefore, question: 'which_loses', candidates: played.san < best.san ? [played, best] : [best, played], played: played.san },
  ];
}

export type SafetyOptions = {
  db: Db;
  facts: FactService;
  storedUnderData: boolean;
  onChange: () => void;
  schedule: () => { reviewCap: number; maxDays: number };
  /** fair play: is this position off limits? */
  guard: (fens: string[]) => string | null;
  /** ask for the opponent's checks and captures before the ruling (safety.listFirst) */
  listFirst: () => boolean;
  now?: () => Date;
};

export class SafetyTrainer {
  view: SafetyView;
  private item: Stored<SafetyItem> | null = null;
  private replies: SafetyReply[] = [];
  private found: SafetyReply[] = [];
  private startedAt = 0;
  private readonly deck: DrillDeck<SafetyItem>;
  private readonly o: SafetyOptions;

  constructor(o: SafetyOptions) {
    this.o = o;
    this.deck = new DrillDeck<SafetyItem>({ db: o.db, type: 'safety', schedule: o.schedule, guard: o.guard, now: o.now });
    this.view = this.idle();
  }

  private idle(problem?: string): SafetyView {
    return { status: 'idle', fen: '8/8/8/8/8/8/8/8 w - - 0 1', you: 'white', question: 'is_safe', candidates: [], ...this.deck.counts(), problem };
  }

  /** Make and check the items of a game's slips. Returns the ids that went live. */
  async fromGame(gameId: number, slips: GamePly[]): Promise<number[]> {
    const ids: number[] = [];
    for (const slip of slips) {
      if (!slip.grade) continue;
      for (const body of await safetyItems(this.o.facts, { fenBefore: slip.fenBefore, san: slip.san, best: slip.grade.best })) {
        const item: ContentItem<SafetyItem> = { type: 'safety', status: 'draft', source: `game:${gameId}#${slip.ply}`, licence: 'own', level: '400–700', engine: 'the engine verdicts of check_move', gates: [], body };
        const gates = [gateV1Safety(body), gateV6(item, { storedUnderData: this.o.storedUnderData, engineRan: true })];
        const saved = this.deck.save(`game:${gameId}#${slip.ply}|safety|${body.question}|${body.candidates.map((c) => c.san).join(',')}`, item, gates);
        if (saved.status === 'live') ids.push(saved.id);
      }
    }
    this.refresh();
    return ids;
  }

  /** The next item: what is due again first, then one never asked. */
  next(): { ok: true } | { ok: false; reason: string } {
    const item = this.deck.pick();
    if (!item) {
      this.item = null;
      this.view = this.idle(this.deck.counts().ready ? 'Nothing more to check today.' : 'Safety checks are made from your own slips: go through one of your games first.');
      this.o.onChange();
      return { ok: false, reason: this.view.problem! };
    }
    this.item = item;
    this.startedAt = Date.now();
    const body = item.body;
    const list = body.question === 'is_safe' && this.o.listFirst() ? forcingReplies(body.fen, body.candidates[0]!.san) : null;
    this.replies = list?.replies ?? [];
    this.found = [];
    this.view = {
      status: 'asking',
      id: item.id,
      fen: body.fen,
      you: parsePosition(body.fen)!.turn,
      question: body.question,
      candidates: body.candidates.map((c) => ({ san: c.san, ...(candidateArrow(body.fen, c.san) ?? { from: '', to: '' }) })),
      list: list ? { stage: 'listing', fen: list.fen, lastMove: list.lastMove, found: [], tries: 0 } : undefined,
      ...this.deck.counts(),
    };
    this.o.onChange();
    return { ok: true };
  }

  /** In the listing step, the owner makes one of the opponent's moves: a check or a capture, or not. The board is put back either way. */
  try(from: string, to: string) {
    const list = this.view.list;
    if (this.view.status !== 'asking' || !list || list.stage !== 'listing') return;
    const hit = this.replies.find((r) => r.from === from && r.to === to);
    let note: NonNullable<typeof list.note>;
    if (hit && this.found.includes(hit)) note = { san: hit.san, text: 'is on your list already.', good: true };
    else if (hit) {
      this.found.push(hit);
      note = { san: hit.san, text: hit.check && hit.capture ? 'is a capture with check.' : hit.check ? 'is a check.' : 'is a capture.', good: true };
    } else {
      const pos = parsePosition(list.fen);
      const legal = pos ? legalMoves(pos).find((m) => m.from === from && m.to === to) : undefined;
      note = legal ? { san: legal.san, text: 'is neither a check nor a capture.', good: false } : { text: 'That move is not possible.', good: false };
    }
    this.view = { ...this.view, list: { ...list, found: this.found.map(({ san, from: f, to: t }) => ({ san, from: f, to: t })), note, tries: list.tries + 1 } };
    this.o.onChange();
  }

  /** The owner says that is all of their checks and captures: the ones missed are shown, and the question is asked. */
  listed() {
    const list = this.view.list;
    if (this.view.status !== 'asking' || !list || list.stage !== 'listing') return;
    const missed = this.replies.filter((r) => !this.found.includes(r)).map(({ san, from, to }) => ({ san, from, to }));
    this.view = { ...this.view, list: { ...list, stage: 'listed', missed, note: undefined } };
    this.o.onChange();
  }

  /** The owner answers: "safe" or "not safe", or the move they think is not safe. */
  async answer(a: { safe?: boolean; pick?: string }): Promise<void> {
    const item = this.item;
    if (!item || this.view.status !== 'asking') return;
    // with the listing step on, the ruling comes after it
    if (this.view.list && this.view.list.stage !== 'listed') return;
    const right = judgeSafety(item.body, a);
    const missed = this.view.list?.missed?.length ?? 0;
    // a check or capture the app had to show counts like a hint
    this.o.db.addAttempt({ contentId: item.id, result: right ? 'solved' : 'shown', hints: missed, misses: right ? 0 : 1, ms: Date.now() - this.startedAt, again: false });
    this.o.db.logEvent('safety', { id: item.id, right, question: item.body.question, ...(this.view.list ? { found: this.view.list.found.length, missed } : {}) });
    // right with every check and capture found: good; right but some missed: hard; wrong: again
    const card = await this.deck.grade(item.id, !right ? 'again' : missed ? 'hard' : 'good');
    this.view = { ...this.view, status: 'answered', result: { right, candidates: item.body.candidates, played: item.body.played }, comesBack: card.dueAt, ...this.deck.counts() };
    this.o.onChange();
  }

  close() {
    this.item = null;
    this.view = this.idle();
    this.o.onChange();
  }

  refresh() {
    this.view = { ...this.view, ...this.deck.counts() };
    this.o.onChange();
  }
}
