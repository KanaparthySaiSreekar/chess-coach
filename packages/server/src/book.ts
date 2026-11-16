// The book and the outlines (features D10, D11; PLAN WP 8.12).
//
// The outlines are the files in content/repertoires/: the owner's moves for a repertoire, chapter by
// chapter. "The book" is the Lichess masters' database (over-the-board games, players rated 2200 and
// up), asked through the explorer at its pace (D45) and kept, so a build run again asks nothing twice.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPLY_FLOOR, readExplorer, readOutline, type BookTable, type Color, type Outline, type ReplySource } from '@chess-coach/core';
import type { LichessExplorer } from './explorer.ts';
import type { BookRequest } from './repertoire.ts';
import type { Settings } from './settings.ts';

/** A book build's rules, from the settings (the same for the page and the terminal). */
export function bookRules(settings: Settings): Pick<BookRequest, 'depth' | 'budget' | 'minGames' | 'outlineReach' | 'bookRule' | 'levelRule' | 'batch'> {
  return {
    depth: Number(settings.get<string>('repertoire.buildDepth')),
    budget: settings.get<number>('repertoire.outlineLines'),
    minGames: settings.get<number>('repertoire.bookMinGames'),
    outlineReach: settings.get<number>('repertoire.outlineReach'),
    bookRule: { minCovered: settings.get<number>('repertoire.bookCovered'), flagShare: settings.get<number>('repertoire.flagShare'), floor: settings.get<number>('repertoire.bookFloor') },
    levelRule: { minCovered: settings.get<number>('repertoire.minCovered'), flagShare: settings.get<number>('repertoire.flagShare'), floor: REPLY_FLOOR },
    batch: 16,
  };
}

/** Another process working on the content (a build in a terminal): what it is doing, or null. */
export function otherJob(db: { syncGet<T>(key: string): { value: T } | undefined }): string | null {
  const job = db.syncGet<{ pid: number; what: string }>('content.job')?.value;
  if (!job?.pid || job.pid === process.pid) return null;
  try {
    process.kill(job.pid, 0);
    return job.what || 'another job';
  } catch {
    return null;
  }
}

export type OutlineEntry = { file: string; id: string; name: string; colour?: Color; hash: string; outline?: Outline; problems: string[] };

/** Every outline in the folder, read and checked; one with a problem cannot be built. */
export function outlineFiles(dir: string): OutlineEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const file = path.join(dir, f);
      const text = readFileSync(file, 'utf8');
      const hash = createHash('sha1').update(text).digest('hex').slice(0, 12);
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        return { file, id: f.replace(/\.json$/, ''), name: f, hash, problems: [`it is not valid JSON: ${(e as Error).message}`] };
      }
      const r = readOutline(raw);
      const r0 = raw as { id?: string; name?: string };
      if (!r.ok) return { file, id: String(r0?.id ?? f.replace(/\.json$/, '')), name: String(r0?.name ?? f), hash, problems: r.problems };
      if (`${r.outline.id}.json` !== f) return { file, id: r.outline.id, name: r.outline.name, colour: r.outline.colour, hash, problems: [`the file should be called ${r.outline.id}.json, after its id`] };
      return { file, id: r.outline.id, name: r.outline.name, colour: r.outline.colour, hash, outline: r.outline, problems: [] };
    });
}

/** The masters' games at a position, from the explorer (kept). A question that cannot be answered throws: it is not "the book ends here". */
export function mastersBook(explorer: LichessExplorer): (fen: string) => Promise<BookTable | null> {
  return async (fen) => {
    let r = await explorer.ask({ db: 'masters', fen, ratings: [], speeds: [] }, { batch: true });
    // Lichess busy or the line down for a moment: wait and ask again, a few times, before giving up
    for (let tries = 0; !r.ok && (r.why === 'unavailable' || r.why === 'slow-down') && tries < 5; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 30_000 * (tries + 1)));
      r = await explorer.ask({ db: 'masters', fen, ratings: [], speeds: [] }, { batch: true });
    }
    if (!r.ok) throw new Error(`the masters' games could not be asked for (${r.why}); run the build again later: what was asked is kept`);
    const t = readExplorer(fen, r.raw);
    return t ? { games: t.games, moves: t.rows.map((x) => ({ uci: x.uci, san: x.san, games: x.games })) } : { games: 0, moves: [] };
  };
}

/** What players at the owner's level reply, from counted games only (20 or more); null when the explorer cannot say. */
export function levelReplies(explorer: LichessExplorer, query: (fen: string) => { ratings: readonly number[]; speeds: readonly string[] }): (fen: string, hint: { games?: number }) => Promise<ReplySource | null> {
  return async (fen, hint) => {
    if (hint.games !== undefined && hint.games < 20) return null;
    const q = query(fen);
    const r = await explorer.ask({ db: 'lichess', fen, ratings: q.ratings, speeds: q.speeds }, { batch: true });
    const t = r.ok ? readExplorer(fen, r.raw) : null;
    return t && t.games >= 20 ? { source: 'explorer', games: t.games, replies: t.rows.map((x) => ({ uci: x.uci, san: x.san, share: x.share, games: x.games })) } : null;
  };
}
