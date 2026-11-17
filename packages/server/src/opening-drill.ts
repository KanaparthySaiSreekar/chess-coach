// The opening drill (features D3, D4; CONTENT §7; COACH §6.5; PLAN WP 8.8). One card per position of
// mine in the owner's live repertoires, scheduled by FSRS like the other drills. A new card is shown
// first: the move, its why and the opponent's idea (written per position and checked by V3), and the
// replies prepared after it; the owner plays the move to take it in. A card due again is asked: the
// owner plays the move. Right: the replies; now and then "why this move?" (the owner says it in their
// own words, then sees the written why and says whether they had it). Wrong: the move is shown with
// its why, and the owner plays it before going on.
//
// The cards are made from live lines only (the review screen's approval), and only down to the
// owner's depth. Nothing on a card is made up here: moves and words come from gated lines.

import { asksWhy, describeMove, gateV1Opening, gateV6, isCardMove, mustPosition, openingCardKey, openingCards, plainText, trapCard, uciToMove, type ContentItem, type Grade, type Licence, type OpeningCard, type OpeningView, type RepLine, type TrapItem } from '@chess-coach/core';
import type { Db } from './db.ts';
import { DrillDeck, type PickOptions, type Stored } from './drill-deck.ts';

export type OpeningEvent =
  | { kind: 'opening_new'; card: OpeningCard }
  | { kind: 'opening_miss'; card: OpeningCard; played: string }
  | { kind: 'opening_why'; card: OpeningCard; words: string };

export type OpeningTrainerOptions = {
  db: Db;
  schedule: () => { reviewCap: number; maxDays: number };
  /** fair play: is this position off limits? */
  guard: (fens: string[]) => string | null;
  /** how many of my moves the owner's level drills */
  depthMoves: () => number;
  /** "why this move?" every this many right answers on a card (0: never) */
  whyEvery: () => number;
  /** how often players at the owner's level play each reply after a position, from the explorer's kept answers (no call) */
  replyShares?: (fen: string) => ReadonlyMap<string, number> | null;
  /** new cards a day (D11): a big repertoire comes in a few positions at a time */
  newPerDay?: () => number;
  storedUnderData: boolean;
  onChange: () => void;
  /** what the coach may want to know (a new card, a miss, the owner's words for the why) */
  onEvent?: (e: OpeningEvent) => void;
  now?: () => Date;
};

const EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';

export class OpeningTrainer {
  view: OpeningView;
  private card: Stored<OpeningCard> | null = null;
  private missed = false;
  private whyMissed = false;
  private startedAt = 0;
  private readonly deck: DrillDeck<OpeningCard>;
  private readonly o: OpeningTrainerOptions;

  constructor(o: OpeningTrainerOptions) {
    this.o = o;
    this.deck = new DrillDeck<OpeningCard>({ db: o.db, type: 'opening', schedule: o.schedule, guard: o.guard, now: o.now });
    this.view = this.idle();
  }

  private idle(problem?: string): OpeningView {
    return { status: 'idle', fen: EMPTY, you: 'white', line: [], startFen: EMPTY, tries: 0, ...this.counts(), problem, scopes: this.scopes() };
  }

  private set(view: Partial<OpeningView>) {
    this.view = { ...this.view, ...view, ...this.counts() };
    this.o.onChange();
  }

  /** What the sitting draws from (D11): one repertoire and some of its chapters, or everything (the traps only then). */
  scope(): { repertoire: number | null; chapters?: string[] } {
    const s = this.o.db.syncGet<{ repertoire: number | null; chapters?: string[] }>('openings.scope')?.value;
    return s && (s.repertoire === null || this.o.db.repertoire(s.repertoire)) ? s : { repertoire: null };
  }

  setScope(repertoire: number | null, chapters?: string[]) {
    const s = { repertoire: repertoire !== null && this.o.db.repertoire(repertoire) ? repertoire : null, chapters: repertoire !== null && chapters?.length ? chapters : undefined };
    this.o.db.syncSet('openings.scope', s);
    this.card = null;
    this.view = this.idle();
    this.o.onChange();
  }

  /** The start of today, for the day's new cards. */
  private today(): string {
    const d = new Date(this.deck.now());
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  private picking(): PickOptions<OpeningCard> {
    const s = this.scope();
    const perDay = this.o.newPerDay?.() ?? Infinity;
    return {
      filter: s.repertoire === null ? undefined : (it) => it.body.repertoire === s.repertoire && !it.body.trap && (!s.chapters?.length || (it.body.chapters ?? []).some((c) => s.chapters!.includes(c))),
      // new cards in the repertoire's teaching order: chapter by chapter, the first lines' first moves first
      freshOrder: (a, b) => a.body.repertoire - b.body.repertoire || (a.body.order ?? 1e9) - (b.body.order ?? 1e9) || a.id - b.id,
      newLeft: Math.max(0, perDay - this.o.db.firstAnsweredSince('opening', this.today())),
    };
  }

  private counts(): Pick<OpeningView, 'ready' | 'due' | 'left' | 'scope' | 'newToday' | 'newPerDay'> {
    const perDay = this.o.newPerDay?.();
    return { ...this.deck.counts(this.picking()), scope: this.scope(), newToday: this.o.db.firstAnsweredSince('opening', this.today()), newPerDay: perDay };
  }

  /** The repertoires there are cards for, chapter by chapter (a card counts under its first chapter), with how many are new and due. */
  private scopes(): OpeningView['scopes'] {
    const asked = this.o.db.attempted('opening');
    const due = new Set(this.o.db.dueCards(this.deck.now().toISOString(), ['opening']).map((d) => d.id));
    const out = new Map<number, NonNullable<OpeningView['scopes']>[number]>();
    for (const it of this.o.db.listContent({ status: 'live', type: 'opening', limit: 100_000 }) as unknown as Stored<OpeningCard>[]) {
      const c = it.body;
      if (c.trap) continue;
      let r = out.get(c.repertoire);
      if (!r) {
        const rep = this.o.db.repertoire(c.repertoire);
        if (!rep) continue;
        out.set(c.repertoire, (r = { id: rep.id, name: rep.name, colour: rep.colour, chapters: [] }));
      }
      const name = c.chapters?.[0] ?? 'All lines';
      let ch = r.chapters.find((x) => x.name === name);
      if (!ch) r.chapters.push((ch = { name, cards: 0, fresh: 0, due: 0, order: c.order ?? 1e9 } as (typeof r.chapters)[number] & { order: number }));
      const o = ch as typeof ch & { order: number };
      o.order = Math.min(o.order, c.order ?? 1e9);
      ch.cards++;
      if (!asked.has(it.id)) ch.fresh++;
      if (due.has(it.id)) ch.due++;
    }
    return [...out.values()].map((r) => ({ ...r, chapters: (r.chapters as ((typeof r.chapters)[number] & { order: number })[]).sort((a, b) => a.order - b.order).map(({ name, cards, fresh, due: d }) => ({ name, cards, fresh, due: d })) }));
  }

  /**
   * Make the cards from the live lines of every repertoire: one per position of mine down to the
   * owner's depth. A card whose position is no longer in a live line is put aside (status draft), with
   * its schedule and answers, and comes back as it was if the line does (WP 8.11).
   */
  sync(): { cards: number; added: number; removed: number } {
    const db = this.o.db;
    const wanted = new Map<string, { card: OpeningCard; source: string; licence: Licence; level: string }>();
    for (const r of db.repertoires()) {
      const rep = db.repertoire(r.id)!;
      const live = db.repertoireItems<RepLine>(r.id).filter((x) => x.status === 'live').map((x) => x.body);
      if (!live.length) continue;
      for (const card of openingCards(r.id, live, db.repTexts(r.id), this.o.depthMoves())) wanted.set(openingCardKey(card), { card, source: rep.source, licence: rep.licence as Licence, level: rep.level ?? '400–700' });
    }
    // the trap pack's live traps are cards too (WP 8.9)
    for (const t of db.listContent({ status: 'live', type: 'trap', limit: 1000 }) as unknown as (ContentItem<TrapItem> & { id: number })[]) {
      const card = trapCard(t.body);
      wanted.set(openingCardKey(card), { card, source: t.source, licence: t.licence, level: t.level ?? '400–700' });
    }
    const existing = db.contentKeys('opening');
    const shown = new Set(existing.filter((e) => e.status !== 'draft').map((e) => e.key));
    let added = 0;
    for (const [key, w] of wanted) {
      if (!shown.has(key)) added++;
      const item: ContentItem<OpeningCard> = { type: 'opening', status: 'draft', source: w.source, licence: w.licence, level: w.level, engine: 'from live repertoire lines (V1–V7 passed)', gates: [], body: w.card };
      this.deck.save(key, item, [gateV1Opening(w.card), gateV6(item, { storedUnderData: this.o.storedUnderData, engineRan: true })]);
    }
    let removed = 0;
    for (const e of existing) {
      if (wanted.has(e.key) || e.status === 'draft') continue;
      if (this.card?.id === e.id) this.card = null;
      // put aside, not deleted: if its line comes back (re-approved, re-validated), the card comes back with its schedule and history
      db.setContentStatus(e.id, 'draft');
      removed++;
    }
    if (this.view.status === 'idle') this.view = this.idle(this.view.problem);
    this.o.onChange();
    return { cards: wanted.size, added, removed };
  }

  /** The next card: one due again first, then a new one. */
  next(): { ok: true } | { ok: false; reason: string } {
    this.sync();
    const picking = this.picking();
    const item = this.deck.pick(picking);
    if (!item) {
      this.card = null;
      const c = this.deck.counts(picking);
      const problem = c.ready
        ? picking.newLeft === 0 && this.deck.counts({ ...picking, newLeft: Infinity }).left > 0
          ? `That is today's ${this.o.newPerDay?.() ?? ''} new positions, and nothing is due again: more tomorrow (the number is a setting).`
          : 'Nothing more to drill today: the cards come back when they are due.'
        : this.scope().repertoire !== null
          ? 'No live cards in this choice yet: approve its lines under Game → Review content…, or practise everything.'
          : 'No opening cards yet. They are made from the repertoire lines you approve under Game → Review content…';
      this.view = this.idle(problem);
      this.o.onChange();
      return { ok: false, reason: problem };
    }
    this.card = item;
    this.missed = false;
    this.whyMissed = false;
    this.startedAt = Date.now();
    const isNew = !this.o.db.attemptsOf(item.id).length;
    const c = item.body;
    const rep = this.o.db.repertoire(c.repertoire);
    this.view = {
      status: isNew ? 'learn' : 'ask',
      id: item.id,
      fen: c.fen,
      you: c.colour,
      line: c.line,
      startFen: c.startFen,
      repertoire: c.trap ? 'Traps' : rep?.name,
      chapter: c.chapters?.[0],
      book: c.book,
      punish: c.punish,
      // a trap's name would give the move away while the owner looks for it
      trap: c.trap ? { kind: c.trap.kind, name: isNew ? c.trap.name : undefined } : undefined,
      tries: this.view.tries,
      ...this.counts(),
      scopes: this.view.scopes,
      ...(isNew ? this.shown(c) : {}),
    };
    this.o.onChange();
    if (isNew) this.o.onEvent?.({ kind: 'opening_new', card: c });
    return { ok: true };
  }

  /** What is shown once the move is out: the move, its words, the replies the repertoire prepares after it. */
  private shown(c: OpeningCard): Partial<OpeningView> {
    const pos = mustPosition(c.fen);
    const info = describeMove(pos, uciToMove(pos, c.move.uci)!);
    const shares = this.o.replyShares?.(info.fenAfter) ?? null;
    return {
      move: { san: c.move.san, from: info.uci.slice(0, 2), to: info.uci.slice(2, 4) },
      why: c.why ? plainText(c.why) : undefined,
      idea: c.idea ? plainText(c.idea) : undefined,
      wordsBy: c.why || c.idea ? c.wordsBy : undefined,
      replies: c.replies.map((r) => ({ san: r.san, share: shares?.get(r.uci) })).sort((a, b) => (b.share ?? -1) - (a.share ?? -1)),
      after: info.fenAfter,
    };
  }

  /** A move on the drill's board. */
  move(from: string, to: string, promotion?: string) {
    const item = this.card;
    const v = this.view;
    if (!item || !['learn', 'ask', 'wrong'].includes(v.status)) return this.set({ tries: v.tries + 1 });
    const c = item.body;
    const pos = mustPosition(c.fen);
    const uci = `${from}${to}${promotion ? promotion[0] : ''}`;
    const legal = uciToMove(pos, uci);
    if (!legal) return this.set({ tries: v.tries + 1 });
    const san = describeMove(pos, legal).san;
    if (!isCardMove(c, uci)) {
      if (v.status === 'ask') {
        // a miss: the move, its why and the idea are shown; the owner plays it before going on
        this.missed = true;
        this.set({ status: 'wrong', played: san, tries: v.tries + 1, ...this.shown(c), trap: this.trapView(c) });
        this.o.onEvent?.({ kind: 'opening_miss', card: c, played: san });
        return;
      }
      return this.set({ tries: v.tries + 1 });
    }
    if (v.status === 'ask') {
      const rightBefore = this.o.db.attemptsOf(item.id).filter((a) => a.result === 'solved').length;
      if (asksWhy(c, rightBefore, this.o.whyEvery())) return this.set({ status: 'why', words: '', ...this.shown(c), why: undefined, idea: c.trap?.kind === 'avoid' ? undefined : this.shown(c).idea, trap: this.trapView(c) });
    }
    void this.finish();
  }

  /** The owner's own words for why the move is played (the why check). The written why is shown next. */
  why(text: string) {
    const item = this.card;
    if (!item || this.view.status !== 'why') return;
    const words = text.trim().slice(0, 400);
    // a trap to avoid asks what they hoped for: its idea is the answer; any other card, its why
    const c = item.body;
    if (c.trap?.kind === 'avoid') this.set({ words, why: c.idea ? plainText(c.idea) : undefined });
    else this.set({ words, why: c.why ? plainText(c.why) : undefined });
    if (words) this.o.onEvent?.({ kind: 'opening_why', card: item.body, words });
  }

  /** Whether the owner had the idea, by their own judgement against the written why. */
  whyKnown(known: boolean) {
    if (!this.card || this.view.status !== 'why') return;
    this.whyMissed = !known;
    void this.finish();
  }

  /** The card is done: logged, moved on its schedule (again after a miss, hard when the why was missed, good otherwise). */
  private async finish() {
    const item = this.card;
    if (!item) return;
    const grade: Grade = this.missed ? 'again' : this.whyMissed ? 'hard' : 'good';
    this.o.db.addAttempt({ contentId: item.id, result: this.missed ? 'shown' : 'solved', hints: 0, misses: this.missed ? 1 : 0, ms: Date.now() - this.startedAt, again: false });
    await this.deck.grade(item.id, grade);
    this.o.db.logEvent('opening_card', { id: item.id, grade, why: this.view.status === 'why' ? !this.whyMissed : undefined });
    this.set({ status: 'right', ...this.shown(item.body), words: this.view.words, trap: this.trapView(item.body) });
  }

  /** A trap card's view once its move is out: avoided or sprung, and its name. */
  private trapView(c: OpeningCard): OpeningView['trap'] {
    return c.trap ? { kind: c.trap.kind, name: c.trap.name } : undefined;
  }

  close() {
    this.card = null;
    this.view = this.idle();
    this.o.onChange();
  }

  /** The card in hand, for the coach. */
  current(): OpeningCard | null {
    return this.card?.body ?? null;
  }
}
