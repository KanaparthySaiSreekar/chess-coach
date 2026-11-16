// The Lichess puzzle database, installed locally (features C5, J6; CONTENT §6; PLAN WP 6.4).
// CC0. 6.2 million rated puzzles with theme tags, in a SQLite file of its own beside the
// downloaded CSV (data/datasets/puzzles/puzzles.sqlite): it is a derived dataset, rebuilt from
// the CSV at any time, so it is kept out of the app's own database.
//
// Each theme has its own index by rating, so "a fork near 900" is one index lookup, not a scan.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstLines } from './zst-lines.ts';

export type DbPuzzle = { id: string; fen: string; moves: string[]; rating: number; popularity: number; plays: number; themes: string[] };

/** The tags that say how long or which phase a puzzle is: kept, but not offered as themes to practise. */
export const NOT_A_THEME = new Set(['oneMove', 'short', 'long', 'veryLong', 'opening', 'middlegame', 'endgame', 'master', 'masterVsMaster', 'superGM', 'crushing', 'advantage', 'equality', 'mate']);

/** Read the database's lines: the downloaded `.csv.zst`, or a plain `.csv` (tests). */
function* lines(file: string): Generator<string> {
  if (file.endsWith('.zst')) {
    yield* zstLines(file);
    return;
  }
  for (const line of readFileSync(file, 'utf8').split('\n')) if (line.trim()) yield line.replace(/\r$/, '');
}

/**
 * Build the puzzle file from the CSV. Written to a temporary file and moved into place at the
 * end, so a broken run never leaves half a database. `minPlays` leaves out puzzles that few people
 * have played (their rating is not settled yet); `onProgress` is called every 100,000 rows.
 */
export function installPuzzles(source: string, target: string, opts: { minPlays?: number; onProgress?: (rows: number) => void } = {}): { rows: number; kept: number; themes: number } {
  mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.building`;
  rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec(`
    PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA locking_mode = EXCLUSIVE; PRAGMA temp_store = MEMORY;
    CREATE TABLE puzzles (n INTEGER PRIMARY KEY, id TEXT NOT NULL, fen TEXT NOT NULL, moves TEXT NOT NULL, rating INTEGER NOT NULL, popularity INTEGER NOT NULL, plays INTEGER NOT NULL, themes TEXT NOT NULL);
    CREATE TABLE themes (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE puzzle_themes (theme INTEGER NOT NULL, rating INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (theme, rating, n)) WITHOUT ROWID;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const addPuzzle = db.prepare('INSERT INTO puzzles (n, id, fen, moves, rating, popularity, plays, themes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const addTheme = db.prepare('INSERT INTO themes (id, name) VALUES (?, ?)');
  const link = db.prepare('INSERT INTO puzzle_themes (theme, rating, n) VALUES (?, ?, ?)');
  const themeIds = new Map<string, number>();
  let header: string[] | null = null;
  let rows = 0;
  let kept = 0;
  db.exec('BEGIN');
  try {
    for (const line of lines(source)) {
      if (!header) {
        header = line.split(',');
        if (header[0] !== 'PuzzleId' || header[7] !== 'Themes') throw new Error(`this is not the Lichess puzzle database (its first line is "${line.slice(0, 80)}")`);
        continue;
      }
      rows++;
      if (opts.onProgress && rows % 100_000 === 0) opts.onProgress(rows);
      // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags: no quoted commas in the first eight
      const c = line.split(',');
      const plays = Number(c[6]);
      if (opts.minPlays && plays < opts.minPlays) continue;
      const rating = Number(c[3]);
      const themes = (c[7] ?? '').split(' ').filter(Boolean);
      kept++;
      addPuzzle.run(kept, c[0]!, c[1]!, c[2]!, rating, Number(c[5]), plays, themes.join(' '));
      for (const name of themes) {
        let id = themeIds.get(name);
        if (id === undefined) {
          id = themeIds.size + 1;
          themeIds.set(name, id);
          addTheme.run(id, name);
        }
        link.run(id, rating, kept);
      }
    }
    if (!header) throw new Error('the file is empty');
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('source', path.basename(source));
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('rows', String(rows));
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('installed', new Date().toISOString());
    db.exec('COMMIT');
    // how many puzzles each theme has in each band of 100 rating points: what the page offers to practise, without counting millions of rows each time
    db.exec('CREATE INDEX puzzles_rating ON puzzles (rating); CREATE UNIQUE INDEX puzzles_id ON puzzles (id); CREATE TABLE theme_counts AS SELECT theme, rating / 100 AS band, COUNT(*) AS count FROM puzzle_themes GROUP BY theme, band; ANALYZE;');
  } catch (e) {
    db.exec('ROLLBACK');
    db.close();
    rmSync(tmp, { force: true });
    throw e;
  }
  db.close();
  rmSync(target, { force: true });
  renameSync(tmp, target);
  return { rows, kept, themes: themeIds.size };
}

/** The installed puzzle file, read-only. */
export class PuzzleDb {
  private readonly db: DatabaseSync;
  private readonly themeId = new Map<string, number>();

  private constructor(file: string) {
    this.db = new DatabaseSync(file, { readOnly: true });
    for (const r of this.db.prepare('SELECT id, name FROM themes').all() as { id: number; name: string }[]) this.themeId.set(r.name, r.id);
  }

  /** Open the installed file, or say that it is not installed. */
  static open(file: string): PuzzleDb | null {
    return existsSync(file) ? new PuzzleDb(file) : null;
  }

  private row(r: { id: string; fen: string; moves: string; rating: number; popularity: number; plays: number; themes: string }): DbPuzzle {
    return { id: r.id, fen: r.fen, moves: r.moves.split(' '), rating: r.rating, popularity: r.popularity, plays: r.plays, themes: r.themes.split(' ').filter(Boolean) };
  }

  /** How many puzzles there are. */
  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM puzzles').get() as { n: number }).n;
  }

  /**
   * Puzzles of one theme (or of any, for a mixed set) near a rating: the closest first, spreading
   * out from the target until enough are found, leaving out the ids given.
   */
  near(opts: { theme?: string; rating: number; count: number; exclude?: ReadonlySet<string>; minPopularity?: number }): DbPuzzle[] {
    const out: DbPuzzle[] = [];
    const seen = new Set<string>(opts.exclude ?? []);
    const minPop = opts.minPopularity ?? 0;
    const theme = opts.theme ? this.themeId.get(opts.theme) : undefined;
    if (opts.theme && theme === undefined) return [];
    const take = (rows: { id: string; fen: string; moves: string; rating: number; popularity: number; plays: number; themes: string }[]) => {
      for (const r of rows) {
        if (out.length >= opts.count) return;
        if (seen.has(r.id) || r.popularity < minPop) continue;
        seen.add(r.id);
        out.push(this.row(r));
      }
    };
    // above the target, then below it, in widening steps: an index range each time
    const up = theme
      ? this.db.prepare('SELECT p.id, p.fen, p.moves, p.rating, p.popularity, p.plays, p.themes FROM puzzle_themes t JOIN puzzles p ON p.n = t.n WHERE t.theme = ? AND t.rating >= ? AND t.rating < ? ORDER BY t.rating LIMIT ?')
      : this.db.prepare('SELECT id, fen, moves, rating, popularity, plays, themes FROM puzzles WHERE rating >= ? AND rating < ? ORDER BY rating LIMIT ?');
    const down = theme
      ? this.db.prepare('SELECT p.id, p.fen, p.moves, p.rating, p.popularity, p.plays, p.themes FROM puzzle_themes t JOIN puzzles p ON p.n = t.n WHERE t.theme = ? AND t.rating < ? AND t.rating >= ? ORDER BY t.rating DESC LIMIT ?')
      : this.db.prepare('SELECT id, fen, moves, rating, popularity, plays, themes FROM puzzles WHERE rating < ? AND rating >= ? ORDER BY rating DESC LIMIT ?');
    const want = opts.count * 4 + (opts.exclude?.size ?? 0);
    for (const width of [50, 150, 400, 1000, 3000]) {
      if (out.length >= opts.count) break;
      const lo = opts.rating - width;
      const hi = opts.rating + width;
      type R = Parameters<PuzzleDb['row']>[0];
      const a = (theme ? up.all(theme, opts.rating, hi, want) : up.all(opts.rating, hi, want)) as R[];
      const b = (theme ? down.all(theme, opts.rating, lo, want) : down.all(opts.rating, lo, want)) as R[];
      // nearest first, alternating above and below
      const merged: R[] = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i]) merged.push(a[i]!);
        if (b[i]) merged.push(b[i]!);
      }
      take(merged.sort((x, y) => Math.abs(x.rating - opts.rating) - Math.abs(y.rating - opts.rating)));
    }
    return out;
  }

  get(id: string): DbPuzzle | undefined {
    const r = this.db.prepare('SELECT id, fen, moves, rating, popularity, plays, themes FROM puzzles WHERE id = ?').get(id) as Parameters<PuzzleDb['row']>[0] | undefined;
    return r ? this.row(r) : undefined;
  }

  /** The themes with about how many puzzles each has within `width` of a rating (by bands of 100): what can be practised at this level. */
  themesNear(rating: number, width = 200): { theme: string; count: number }[] {
    const rows = this.db.prepare('SELECT t.name AS theme, SUM(c.count) AS count FROM theme_counts c JOIN themes t ON t.id = c.theme WHERE c.band BETWEEN ? AND ? GROUP BY c.theme ORDER BY count DESC').all(Math.floor((rating - width) / 100), Math.floor((rating + width) / 100)) as { theme: string; count: number }[];
    return rows.filter((r) => !NOT_A_THEME.has(r.theme));
  }

  close() {
    this.db.close();
  }
}
