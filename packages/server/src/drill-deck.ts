// What the drills made from the owner's games share (the safety check, C7; "what's the threat?",
// C8): which item comes next (what is due again first, then one never asked), the counts on the
// page, and the schedule an answer moves an item on (FSRS, as for puzzles: CONTENT §6).

import { makeScheduler, review, statusAfter, type ContentItem, type ContentType, type GateResult, type Grade, type Scheduler, type StoredCard } from '@chess-coach/core';
import type { Db } from './db.ts';

export type Stored<T> = ContentItem<T> & { id: number };

/** Which items a sitting draws from, the order new ones come in, and how many new ones are left today. */
export type PickOptions<T> = { filter?: (item: Stored<T>) => boolean; freshOrder?: (a: Stored<T>, b: Stored<T>) => number; newLeft?: number };

export type DrillDeckOptions = {
  db: Db;
  type: ContentType;
  schedule: () => { reviewCap: number; maxDays: number };
  /** fair play: is this position off limits? */
  guard: (fens: string[]) => string | null;
  now?: () => Date;
};

export class DrillDeck<T extends { fen: string }> {
  private scheduler: Scheduler | null = null;
  private schedulerDays = 0;
  private readonly o: DrillDeckOptions;

  constructor(o: DrillDeckOptions) {
    this.o = o;
  }

  now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private live(filter?: (item: Stored<T>) => boolean): Stored<T>[] {
    const all = this.o.db.listContent({ status: 'live', type: this.o.type, limit: 100_000 }) as unknown as Stored<T>[];
    return filter ? all.filter(filter) : all;
  }

  /** Live items (in the scope), how many are due again today (under the cap), and how many can be asked now (new ones up to the day's limit). */
  counts(o: PickOptions<T> = {}): { ready: number; due: number; left: number } {
    const live = this.live(o.filter);
    const ids = new Set(live.map((x) => x.id));
    const due = Math.min(this.o.db.dueCards(this.now().toISOString(), [this.o.type]).filter((d) => ids.has(d.id)).length, this.o.schedule().reviewCap);
    const asked = this.o.db.attempted(this.o.type);
    const fresh = live.filter((x) => !asked.has(x.id)).length;
    return { ready: live.length, due, left: due + Math.min(fresh, o.newLeft ?? Infinity) };
  }

  /** The next item: what is due again first, then one never asked (while the day's new ones last); nothing from a game still being played. */
  pick(o: PickOptions<T> = {}): Stored<T> | null {
    const live = this.live(o.filter);
    const ids = new Set(live.map((x) => x.id));
    const due = this.o.db
      .dueCards(this.now().toISOString(), [this.o.type])
      .filter((d) => ids.has(d.id))
      .slice(0, this.o.schedule().reviewCap);
    const asked = this.o.db.attempted(this.o.type);
    const fresh = (o.newLeft ?? Infinity) > 0 ? live.filter((x) => !asked.has(x.id)).sort(o.freshOrder ?? ((a, b) => a.id - b.id)) : [];
    for (const id of [...due.map((d) => d.id), ...fresh.map((x) => x.id)]) {
      const item = this.o.db.getContent(id) as unknown as Stored<T> | undefined;
      if (item && item.status === 'live' && !this.o.guard([item.body.fen])) return item;
    }
    return null;
  }

  /** Store an item with its gates: live when they pass, quarantined when one fails. Returns its id and status. */
  save(key: string, item: ContentItem<T>, gates: GateResult[]): { id: number; status: 'live' | 'quarantined' } {
    const status = statusAfter(this.o.type, gates) === 'quarantined' ? 'quarantined' : 'live';
    return { id: this.o.db.saveContent(key, { ...item, gates, status } as never), status };
  }

  /** Move an item on its schedule after an answer. */
  async grade(id: number, grade: Grade): Promise<StoredCard> {
    const s = this.o.schedule();
    if (!this.scheduler || this.schedulerDays !== s.maxDays) {
      this.scheduler = await makeScheduler(s.maxDays);
      this.schedulerDays = s.maxDays;
    }
    const next = review(this.scheduler, this.o.db.getCard(id) ?? null, grade, this.now());
    this.o.db.saveCard(id, next.card);
    return next.card;
  }
}
