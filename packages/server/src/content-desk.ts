// The review screen's side on the server (feature J4; CONTENT §10; PLAN WP 8.4): where the owner
// approves content and settles doubts. It lists the items by status, says why each quarantined one
// failed in plain words, and carries out the owner's decisions: approve, drop, accept against a gate
// with a note, or (a repertoire line) fix the move that failed. Every decision is logged, with the
// item as it was.

import { lineText, quarantineReasons, type ContentItem, type ContentReviewView, type ContentRowView, type OutlineView, type Puzzle, type RepLine, type RepertoireSummaryView } from '@chess-coach/core';
import type { Db } from './db.ts';
import type { BookPlan, RepertoireReport } from './repertoire.ts';

const KIND_WORDS: Record<string, string> = {
  puzzle_game: 'A puzzle from one of your games',
  puzzle_db: 'A Lichess puzzle',
  safety: 'A safety check from one of your games',
  threat: "A 'what's the threat?' position from one of your games",
  convert: 'A won position to play out, from one of your games',
  trap: 'A trap',
  lesson: 'A lesson',
  endgame: 'An endgame position',
  course: 'A course item',
};

/** What an item is, in words. */
export function itemTitle(item: ContentItem<unknown>): string {
  if (item.type === 'repertoire') {
    const line = item.body as RepLine;
    return lineText(line.startFen, line.moves);
  }
  const game = /^game:(\d+)#(\d+)$/.exec(item.source);
  const base = KIND_WORDS[item.type] ?? item.type;
  if (game) return `${base} (move ${Math.ceil(Number(game[2]) / 2)})`;
  const puzzle = /^puzzle:(\S+)$/.exec(item.source);
  if (puzzle) return `${base} (${puzzle[1]})`;
  return base;
}

/** The waiting and quarantined items, and the most recent live ones: the review screen lists these. */
const LIVE_SHOWN = 200;

export class ContentDesk {
  private readonly db: Db;
  /** a repertoire whose gates are running, and how far they are */
  running = new Map<number, RepertoireSummaryView['running']>();

  /** the outlines a repertoire can be built from (WP 8.12) */
  private readonly outlines?: () => OutlineView[];

  constructor(db: Db, outlines?: () => OutlineView[]) {
    this.db = db;
    this.outlines = outlines;
  }

  view(): ContentReviewView {
    const counts = this.db.contentCounts();
    const rows = [...this.db.listContent({ status: 'quarantined', limit: 2000 }), ...this.db.listContent({ status: 'machine-verified', limit: 2000 }), ...this.db.listContent({ status: 'live', limit: LIVE_SHOWN })];
    const items: ContentRowView[] = rows.map((x) => this.row(x as ContentItem<unknown> & { id: number }));
    // a repertoire's lines that are live are listed with it even when they are older than the newest puzzles
    const shown = new Set(items.map((i) => i.id));
    const repertoires: RepertoireSummaryView[] = this.db.repertoires().map((r) => {
      const lines = this.db.repertoireItems<RepLine>(r.id);
      const rep = this.db.repertoire(r.id);
      const report = rep?.report as RepertoireReport | undefined;
      const plan = rep?.plan as BookPlan | null | undefined;
      for (const l of lines) if (!shown.has(l.id)) items.push(this.row(l as ContentItem<unknown> & { id: number }));
      // its chapters, in teaching order (the lines are kept in it)
      const chapters = new Map<string, NonNullable<RepertoireSummaryView['chapters']>[number]>();
      for (const l of [...lines].sort((a, b) => (a.body.order ?? a.id) - (b.body.order ?? b.id))) {
        if (!l.body.chapter) continue;
        const c = chapters.get(l.body.chapter) ?? { name: l.body.chapter, lines: 0, live: 0, waiting: 0, quarantined: 0, flagged: 0 };
        c.lines++;
        if (l.status === 'live') c.live++;
        else if (l.status === 'machine-verified') c.waiting++;
        else if (l.status === 'quarantined') c.quarantined++;
        if (l.status !== 'quarantined' && l.gates.some((g) => g.result === 'flag')) c.flagged++;
        chapters.set(l.body.chapter, c);
      }
      return {
        built: plan?.kind === 'book' ? { outline: plan.outline.id, at: plan.built.at, minGames: plan.minGames, depth: plan.depth, budget: plan.budget, cut: plan.built.cut, notes: plan.built.notes } : undefined,
        chapters: chapters.size ? [...chapters.values()] : undefined,
        id: r.id,
        name: r.name,
        colour: r.colour,
        at: report?.at,
        lines: lines.length,
        live: lines.filter((l) => l.status === 'live').length,
        waiting: lines.filter((l) => l.status === 'machine-verified').length,
        quarantined: lines.filter((l) => l.status === 'quarantined').length,
        flagged: lines.filter((l) => l.status !== 'quarantined' && l.gates.some((g) => g.result === 'flag')).length,
        gaps: (report?.coverage ?? []).filter((c) => !c.ok).map((c) => ({ at: c.at, covered: c.covered, missing: c.missing, source: c.source })),
        sample: (report?.sample ?? []).filter((x) => lines.some((l) => l.id === x.id && l.status === 'machine-verified')),
        running: this.running.get(r.id),
      };
    });
    return { counts: { quarantined: counts.quarantined ?? 0, waiting: counts['machine-verified'] ?? 0, live: counts.live ?? 0 }, items, repertoires, outlines: this.outlines?.() };
  }

  private row(x: ContentItem<unknown> & { id: number }): ContentRowView {
    const failing = x.gates.filter((g) => g.result === 'fail' && typeof g.at === 'number');
    return {
      id: x.id,
      type: x.type,
      status: x.status,
      title: itemTitle(x),
      source: x.source,
      reasons: x.status === 'quarantined' ? quarantineReasons(x) : [],
      flags: x.gates.filter((g) => g.result === 'flag').map((g) => `${g.gate}: ${g.detail ?? 'flagged'}`),
      gates: x.gates.filter((g) => g.result === 'fail' || g.result === 'flag').map((g) => g.gate),
      note: x.note,
      repertoire: x.type === 'repertoire' ? (x.body as RepLine).repertoire : undefined,
      chapter: x.type === 'repertoire' ? (x.body as RepLine).chapter : undefined,
      book: x.type === 'repertoire' ? (x.body as RepLine).book : undefined,
      fixable: x.type === 'repertoire' && x.status === 'quarantined' && failing.length > 0,
    };
  }

  /** The owner's yes to an item that passed its gates. */
  approve(id: number): boolean {
    const item = this.db.getContent(id);
    if (!item || item.status !== 'machine-verified') return false;
    this.db.setContentStatus(id, 'live');
    this.db.logEvent('content_decision', { id, action: 'approve' });
    return true;
  }

  /** The owner's yes to every waiting line of a repertoire at once, after the spot check. */
  approveAll(repertoire: number): number {
    const waiting = this.db.repertoireItems(repertoire).filter((l) => l.status === 'machine-verified');
    for (const l of waiting) this.db.setContentStatus(l.id, 'live');
    this.db.logEvent('content_decision', { repertoire, action: 'approve_all', ids: waiting.map((l) => l.id) });
    return waiting.length;
  }

  /** The owner's yes to every waiting line of one chapter, after its spot check (D11). */
  approveChapter(repertoire: number, chapter: string): number {
    const waiting = this.db.repertoireItems<RepLine>(repertoire).filter((l) => l.status === 'machine-verified' && l.body.chapter === chapter);
    for (const l of waiting) this.db.setContentStatus(l.id, 'live');
    this.db.logEvent('content_decision', { repertoire, chapter, action: 'approve_chapter', ids: waiting.map((l) => l.id) });
    return waiting.length;
  }

  /** A repertoire removed for good, at the owner's word: logged whole first (its lines, their statuses, how many words), then removed with its cards. */
  removeRepertoire(id: number): { ok: true; lines: number; cards: number } | { ok: false; reason: string } {
    const rep = this.db.repertoire(id);
    if (!rep) return { ok: false, reason: 'That repertoire is not here any more.' };
    if (this.running.has(id)) return { ok: false, reason: 'Its gates are running: wait for them to finish.' };
    const lines = this.db.repertoireItems<RepLine>(id);
    this.db.logEvent('repertoire_removed', { id, name: rep.name, colour: rep.colour, source: rep.source, words: this.db.repTexts(id).size, lines: lines.map((l) => ({ line: lineText(l.body.startFen, l.body.moves), status: l.status, note: l.note })) });
    const r = this.db.removeRepertoire(id);
    return { ok: true, lines: r.lines, cards: r.cards };
  }

  /** Drop an item for good. The log keeps it as it was. */
  drop(id: number): boolean {
    const item = this.db.getContent(id);
    if (!item) return false;
    this.db.deleteContent(id);
    this.db.logEvent('content_decision', { id, action: 'drop', item });
    return true;
  }

  /** Accept a quarantined item against its gate, with the owner's note on why. */
  accept(id: number, note: string): { ok: true } | { ok: false; reason: string } {
    const item = this.db.getContent(id);
    if (!item || item.status !== 'quarantined') return { ok: false, reason: 'That item is not in quarantine any more.' };
    const text = note.trim();
    if (!text) return { ok: false, reason: 'Say in a few words why you accept it: the note stays with it.' };
    this.db.setContentNote(id, text);
    this.db.setContentStatus(id, 'live');
    this.db.logEvent('content_decision', { id, action: 'accept', note: text, reasons: quarantineReasons(item) });
    return { ok: true };
  }

  /** A repertoire line, to show it on the board: up to the move that failed, or the whole line when nothing did. */
  failingLine(id: number): { line: RepLine; at: number; failed: boolean } | null {
    const item = this.db.getContent(id) as unknown as (ContentItem<RepLine> & { id: number }) | undefined;
    if (!item || item.type !== 'repertoire') return null;
    const at = Math.min(...item.gates.filter((g) => g.result === 'fail' && typeof g.at === 'number').map((g) => g.at!));
    return Number.isFinite(at) ? { line: item.body, at, failed: true } : { line: item.body, at: item.body.moves.length, failed: false };
  }

  /** A puzzle's start, to show it on the board. */
  puzzleStart(id: number): string | null {
    const item = this.db.getContent(id) as (ContentItem<Puzzle> & { id: number }) | undefined;
    return item && item.type !== 'repertoire' && typeof item.body?.fen === 'string' ? item.body.fen : null;
  }
}
