// "What's the threat?" (feature C8; PLAN WP 6.7). Items are made from the owner's slips where the
// board says their threat went unanswered (the tag's step, WP 5.4), once a game has been gone
// through. The owner first names the threat, by making the move the opponent would play if it were
// their turn; then finds a move on the real position that deals with it. The threat and every move
// as strong are the engine's (searched with the turn passed); a move the owner names that is not
// among them is searched as well, so what they are told about it is the engine's too. Their own move
// is judged by check_move: right when it loses nothing by force and allows no mate.

import {
  asStrongAs,
  candidateArrow,
  gateV1Threat,
  gateV6,
  isThreat,
  legalMoves,
  parsePosition,
  passPosition,
  threatHint,
  type Color,
  type ContentItem,
  type GamePly,
  type MoveInfo,
  type ThreatItem,
  type ThreatResult,
  type ThreatView,
} from '@chess-coach/core';
import type { Db } from './db.ts';
import { DrillDeck, type Stored } from './drill-deck.ts';
import type { FactService } from './facts-service.ts';
import { moveVerdict, sameMove } from './safety.ts';

const EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';
const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/** The owner's slips where the board says their threat went unanswered, the costliest first. */
export function threatSlips(plies: GamePly[], you: Color, max: number): GamePly[] {
  return plies
    .filter((p) => p.by === you && !!p.grade && p.grade.live && (p.judged?.label === 'mistake' || p.judged?.label === 'blunder') && p.tag?.boardStep === 'missed_threat')
    .sort((a, b) => b.grade!.drop - a.grade!.drop || a.ply - b.ply)
    .slice(0, Math.max(0, max));
}

/**
 * Make the item of one slip: their strongest threat (one a beginner can be asked to name), the moves
 * that threaten as much, and the engine's verdicts on its first choice and on the move played.
 * Null when the position has no such threat, no safe answer, or the move played was safe after all.
 */
export async function threatItem(facts: FactService, slip: { fenBefore: string; san: string; best: string; lastMove?: ThreatItem['lastMove'] }): Promise<ThreatItem | null> {
  if (!parsePosition(slip.fenBefore) || !passPosition(slip.fenBefore) || sameMove(slip.best, slip.san)) return null;
  const list = await facts.threats(slip.fenBefore);
  const main = list.find(isThreat);
  if (!main) return null;
  const [best, played] = await Promise.all([moveVerdict(facts, slip.fenBefore, slip.best), moveVerdict(facts, slip.fenBefore, slip.san)]);
  if (!best || !played || !best.safe || played.safe) return null;
  return {
    fen: slip.fenBefore,
    lastMove: slip.lastMove,
    threat: main,
    accepted: list.filter((r) => r !== main && asStrongAs(r, main)).map((r) => r.san),
    best: { san: best.san, why: best.why },
    played: { san: played.san, why: played.why },
  };
}

export type ThreatOptions = {
  db: Db;
  facts: FactService;
  storedUnderData: boolean;
  onChange: () => void;
  schedule: () => { reviewCap: number; maxDays: number };
  /** fair play: is this position off limits? */
  guard: (fens: string[]) => string | null;
  now?: () => Date;
};

export class ThreatTrainer {
  view: ThreatView;
  private item: Stored<ThreatItem> | null = null;
  private startedAt = 0;
  /** hints given while naming the threat; the third shows it */
  private rung = 0;
  private shownThreat = false;
  private nameMisses = 0;
  private moveMisses = 0;
  private readonly deck: DrillDeck<ThreatItem>;
  private readonly o: ThreatOptions;

  constructor(o: ThreatOptions) {
    this.o = o;
    this.deck = new DrillDeck<ThreatItem>({ db: o.db, type: 'threat', schedule: o.schedule, guard: o.guard, now: o.now });
    this.view = this.idle();
  }

  private idle(problem?: string): ThreatView {
    return { status: 'idle', fen: EMPTY, you: 'white', hints: 0, misses: 0, shapes: [], tries: 0, ...this.deck.counts(), problem };
  }

  private set(view: Partial<ThreatView>) {
    this.view = { ...this.view, ...view };
    this.o.onChange();
  }

  /** Make and check the items of a game's slips. `plies` gives the opponent's move before each slip. Returns the ids that went live. */
  async fromGame(gameId: number, plies: GamePly[], slips: GamePly[]): Promise<number[]> {
    const ids: number[] = [];
    for (const slip of slips) {
      if (!slip.grade) continue;
      const prev = plies.find((p) => p.ply === slip.ply - 1);
      const squares = prev ? candidateArrow(prev.fenBefore, prev.san) : null;
      const body = await threatItem(this.o.facts, { fenBefore: slip.fenBefore, san: slip.san, best: slip.grade.best, lastMove: prev && squares ? { san: prev.san, ...squares } : undefined });
      if (!body) continue;
      const item: ContentItem<ThreatItem> = { type: 'threat', status: 'draft', source: `game:${gameId}#${slip.ply}`, licence: 'own', level: '400–700', engine: "the engine's threats with the turn passed, and check_move", gates: [], body };
      const gates = [gateV1Threat(body), gateV6(item, { storedUnderData: this.o.storedUnderData, engineRan: true })];
      const saved = this.deck.save(`game:${gameId}#${slip.ply}|threat`, item, gates);
      if (saved.status === 'live') ids.push(saved.id);
    }
    this.refresh();
    return ids;
  }

  /** The next item: what is due again first, then one never asked. The board starts with the turn passed. */
  next(): { ok: true } | { ok: false; reason: string } {
    const item = this.deck.pick();
    if (!item) {
      this.item = null;
      this.view = this.idle(this.deck.counts().ready ? 'Nothing more to look at today.' : '"What\'s the threat?" positions come from your own games, where a threat of theirs went unanswered: go through one of your games first.');
      this.o.onChange();
      return { ok: false, reason: this.view.problem! };
    }
    this.item = item;
    this.startedAt = Date.now();
    this.rung = 0;
    this.shownThreat = false;
    this.nameMisses = 0;
    this.moveMisses = 0;
    const body = item.body;
    this.view = {
      status: 'naming',
      id: item.id,
      fen: passPosition(body.fen)!,
      lastMove: body.lastMove ? [body.lastMove.from, body.lastMove.to] : undefined,
      you: parsePosition(body.fen)!.turn,
      hints: 0,
      misses: 0,
      nextHint: 1,
      shapes: [],
      tries: 0,
      ...this.deck.counts(),
    };
    this.o.onChange();
    return { ok: true };
  }

  /** A hint while naming the threat: a question, then the piece, then the threat itself. */
  hint() {
    const item = this.item;
    if (!item || this.view.status !== 'naming') return;
    this.rung++;
    if (this.rung >= 3) return this.showThreat();
    const shapes = this.rung >= 2 ? [{ from: item.body.threat.from, style: 'target' as const }] : [];
    this.set({ hints: this.rung, nextHint: (this.rung + 1) as 2 | 3, shapes, feedback: { tone: 'hint', text: threatHint(item.body, this.rung as 1 | 2) } });
  }

  /** The answer: while naming, the threat; while defending, the engine's first choice. */
  async show() {
    if (this.view.status === 'naming') return this.showThreat();
    if (this.view.status !== 'defending' || !this.item || this.view.busy) return;
    const body = this.item.body;
    const arrow = candidateArrow(body.fen, body.best.san);
    await this.finish('shown', undefined, arrow ? [...this.view.shapes, { ...arrow, style: 'good' }] : this.view.shapes);
  }

  private showThreat() {
    const item = this.item;
    if (!item || this.view.status !== 'naming') return;
    this.shownThreat = true;
    this.toDefending(item.body.threat, false, 'answer');
  }

  private toDefending(threat: ThreatResult, named: boolean, tone: 'good' | 'answer') {
    const body = this.item!.body;
    this.set({
      status: 'defending',
      busy: false,
      fen: body.fen,
      threat: { san: threat.san, from: threat.from, to: threat.to, what: threat.what, named },
      shapes: [{ from: threat.from, to: threat.to, style: 'threat' }],
      nextHint: undefined,
      hints: this.rung,
      // the move and what it would win are on the page from now on (view.threat); the feedback only says whose finding it was
      feedback: { tone, text: named ? 'Yes: that is their threat.' : 'This is their threat.' },
    });
  }

  /** A move on the board: while naming, theirs (the threat); while defending, the owner's own. A refused move is put back. */
  async try(from: string, to: string, promotion?: MoveInfo['promotion']) {
    const item = this.item;
    if (!item || this.view.busy || (this.view.status !== 'naming' && this.view.status !== 'defending')) return;
    const pos = parsePosition(this.view.fen);
    const moves = pos ? legalMoves(pos).filter((m) => m.from === from && m.to === to) : [];
    const move = moves.find((m) => m.promotion === (promotion ?? 'queen')) ?? moves[0];
    const tries = this.view.tries + 1;
    if (!move) return this.set({ tries, feedback: { tone: 'wrong', text: 'That move is not possible.' } });
    if (this.view.status === 'naming') return this.name(item, move.san, tries);
    return this.defend(item, move.san, tries);
  }

  private async name(item: Stored<ThreatItem>, san: string, tries: number) {
    const body = item.body;
    if (sameMove(san, body.threat.san)) return this.toDefending(body.threat, true, 'good');
    // any other move is searched: one that threatens as much counts, and what the rest would do is the engine's
    this.set({ busy: true, tries });
    const r = await this.o.facts.threatOf(body.fen, san);
    if (this.item !== item) return;
    if (r && (asStrongAs(r, body.threat) || body.accepted.some((a) => sameMove(a, san)))) return this.toDefending(r, true, 'good');
    this.nameMisses++;
    const text = r && isThreat(r) ? `would win something too (${r.what}), but they have a bigger threat.` : 'would not win anything for them.';
    this.set({ busy: false, misses: this.nameMisses + this.moveMisses, feedback: { tone: 'wrong', san, by: other(this.view.you), text } });
  }

  private async defend(item: Stored<ThreatItem>, san: string, tries: number) {
    this.set({ busy: true, tries });
    const v = await moveVerdict(this.o.facts, item.body.fen, san);
    if (this.item !== item) return;
    if (v?.safe) {
      const arrow = candidateArrow(item.body.fen, v.san);
      return this.finish('solved', { san: v.san, why: v.why }, arrow ? [...this.view.shapes, { ...arrow, style: 'good' }] : this.view.shapes);
    }
    this.moveMisses++;
    this.set({ busy: false, misses: this.nameMisses + this.moveMisses, feedback: { tone: 'wrong', text: `Not that one. ${v?.why ?? `${san} cannot be judged.`}` } });
  }

  /** Over: record the attempt and move the item on its schedule. Shown (the threat or the move) → again; any help or miss → hard; else good. */
  private async finish(status: 'solved' | 'shown', found: { san: string; why: string } | undefined, shapes: ThreatView['shapes']) {
    const item = this.item!;
    const body = item.body;
    const shown = status === 'shown' || this.shownThreat;
    const helped = this.rung > 0 || this.nameMisses + this.moveMisses > 0;
    this.o.db.addAttempt({ contentId: item.id, result: shown ? 'shown' : 'solved', hints: this.rung, misses: this.nameMisses + this.moveMisses, ms: Date.now() - this.startedAt, again: false });
    this.o.db.logEvent('threat', { id: item.id, named: !this.shownThreat, found: !!found, hints: this.rung, misses: this.nameMisses + this.moveMisses });
    const card = await this.deck.grade(item.id, shown ? 'again' : helped ? 'hard' : 'good');
    if (this.item !== item) return;
    const feedback: ThreatView['feedback'] = found ? { tone: 'good', text: found.why } : { tone: 'answer', text: body.best.why };
    this.set({ status, busy: false, shapes, feedback, result: { found, best: body.best, played: body.played }, comesBack: card.dueAt, ...this.deck.counts() });
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
