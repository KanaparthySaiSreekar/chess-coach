// SQLite through Node's built-in driver. All database access goes through this one module
// (ARCHITECTURE §13, §18: node:sqlite is young, so swapping the driver must stay a one-file job).

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { outcomeOf, type Color, type ContentItem, type ContentStatus, type Puzzle, type GameNumbers, type GamePly, type GameSite, type GameSummary, type ImportedGame, type Moment, type OngoingGame, type ProfileGame, type ReportSlip, type StoredCard, type ReviewReport, type SkippedStep, type WordsBy } from '@chess-coach/core';

const MIGRATIONS: string[] = [
  // 1: the tables the board and the coach need (Phases 3–4)
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
  CREATE INDEX events_type_at ON events (type, at);
  CREATE TABLE board_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE coach_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, ended_at TEXT, agent TEXT NOT NULL, model TEXT NOT NULL,
    turns INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, end_reason TEXT
  );
  CREATE TABLE coach_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, run_id INTEGER, seq INTEGER NOT NULL, source TEXT NOT NULL,
    kind TEXT NOT NULL, text TEXT NOT NULL, claims TEXT NOT NULL, verdict TEXT NOT NULL, problems TEXT NOT NULL
  );
  CREATE TABLE engine_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // 2: Lichess's cloud analysis, cached (decision D33)
  `
  CREATE TABLE lichess_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
  `,
  // 3: the owner's finished games, the games still in progress (the fair-play guard), and where each sync got to (Phase 5)
  `
  CREATE TABLE games (
    id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, site_id TEXT NOT NULL, url TEXT,
    white TEXT NOT NULL, black TEXT NOT NULL, white_rating INTEGER, black_rating INTEGER, white_diff INTEGER, black_diff INTEGER,
    you TEXT, result TEXT NOT NULL, outcome TEXT, ending TEXT NOT NULL, time_class TEXT NOT NULL, time_control TEXT NOT NULL,
    rated INTEGER NOT NULL, played_at TEXT NOT NULL, eco TEXT, opening TEXT, plies INTEGER NOT NULL, pgn TEXT NOT NULL, imported_at TEXT NOT NULL,
    UNIQUE (site, site_id)
  );
  CREATE INDEX games_played_at ON games (played_at);
  CREATE TABLE ongoing_games (site TEXT NOT NULL, site_id TEXT NOT NULL, data TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY (site, site_id));
  CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
  `,
  // 4: a game's analysis (WP 5.3): one row per game, one per move, one per key moment
  `
  CREATE TABLE game_reviews (game_id INTEGER PRIMARY KEY, at TEXT NOT NULL, engine TEXT NOT NULL, you TEXT NOT NULL, numbers TEXT NOT NULL);
  CREATE TABLE game_plies (
    game_id INTEGER NOT NULL, ply INTEGER NOT NULL, by TEXT NOT NULL, san TEXT NOT NULL, label TEXT, drop_pts REAL, live INTEGER, given_away REAL, white_win REAL,
    step TEXT, what TEXT, motifs TEXT, step_owner TEXT,
    PRIMARY KEY (game_id, ply)
  );
  CREATE TABLE moments (game_id INTEGER NOT NULL, ply INTEGER NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (game_id, ply));
  CREATE TABLE self_reviews (game_id INTEGER PRIMARY KEY, at TEXT NOT NULL, skipped INTEGER NOT NULL, marks TEXT NOT NULL, notes TEXT NOT NULL);
  CREATE TABLE reviews (game_id INTEGER PRIMARY KEY, at TEXT NOT NULL, report TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
  CREATE TABLE takeaways (game_id INTEGER NOT NULL, step TEXT NOT NULL, at TEXT NOT NULL, text TEXT NOT NULL, plies TEXT NOT NULL, PRIMARY KEY (game_id, step));
  `,
  // 5: content and its gates (Phase 6): one envelope per item (CONTENT §3)
  `
  CREATE TABLE content_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, type TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, licence TEXT NOT NULL,
    engine TEXT, level TEXT, gates TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX content_type_status ON content_items (type, status);
  `,
  // 6: every answer to a piece of practice: right or shown, the hints and misses it took, the time (Phase 6)
  `
  CREATE TABLE attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, content_id INTEGER NOT NULL, result TEXT NOT NULL,
    hints INTEGER NOT NULL, misses INTEGER NOT NULL, ms INTEGER NOT NULL, again INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX attempts_content ON attempts (content_id);
  `,
  // 7: when each puzzle comes back (the schedule, WP 6.5): FSRS's state per item
  `
  CREATE TABLE cards (content_id INTEGER PRIMARY KEY, card TEXT NOT NULL, due_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX cards_due ON cards (due_at);
  `,
  // 8: Woodpecker sets and their rounds (WP 6.10): the same puzzles again and again
  `
  CREATE TABLE woodpecker_sets (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, items TEXT NOT NULL);
  CREATE TABLE woodpecker_rounds (id INTEGER PRIMARY KEY, set_id INTEGER NOT NULL, round INTEGER NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, ms INTEGER, done TEXT NOT NULL DEFAULT '[]');
  `,
  // 9: studies and their chapters (WP 8.1): the owner's annotated lines, and imported ones
  `
  CREATE TABLE studies (id INTEGER PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE study_chapters (id INTEGER PRIMARY KEY, study_id INTEGER NOT NULL, idx INTEGER NOT NULL, name TEXT NOT NULL, orientation TEXT NOT NULL, pgn TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX study_chapters_study ON study_chapters (study_id, idx);
  `,
  // 10: the opening explorer's answers, kept so a position is never asked for twice (WP 8.2, D45)
  `
  CREATE TABLE explorer_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
  `,
  // 11: repertoires (WP 8.3): one row per repertoire with its latest gate report; its lines are content items (type 'repertoire')
  `
  CREATE TABLE repertoires (id INTEGER PRIMARY KEY, name TEXT NOT NULL, colour TEXT NOT NULL, source TEXT NOT NULL, licence TEXT NOT NULL, level TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, report TEXT);
  `,
  // 12: the owner's note when they accept an item against a gate (the review screen, WP 8.4)
  `
  ALTER TABLE content_items ADD COLUMN note TEXT;
  `,
  // 13: a repertoire's positions of mine (WP 8.6): the move played there, its why and the opponent's idea, written once per position
  `
  CREATE TABLE rep_positions (repertoire INTEGER NOT NULL, key TEXT NOT NULL, fen TEXT NOT NULL, uci TEXT NOT NULL, san TEXT NOT NULL, why TEXT, idea TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (repertoire, key));
  `,
  // 14: a repertoire built from the book (WP 8.12): how it was built (its plan, its outline), and what
  // the book said at each of its positions, so gate V4 checks against the same answers the build used
  `
  ALTER TABLE repertoires ADD COLUMN plan TEXT;
  ALTER TABLE repertoires ADD COLUMN outline TEXT;
  CREATE TABLE rep_book (repertoire INTEGER NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (repertoire, key));
  `,
  // 15: who wrote a position's words (D13): 'facts' (the app's own reasons, phrased by code), 'claude'
  // (written by Claude from the checked facts), 'owner'; null for words from before it was recorded
  `
  ALTER TABLE rep_positions ADD COLUMN source TEXT;
  `,
];

type GameRow = {
  id: number; site: string; site_id: string; url: string | null; white: string; black: string; white_rating: number | null; black_rating: number | null;
  white_diff: number | null; black_diff: number | null; you: string | null; result: string; outcome: string | null; ending: string; time_class: string;
  time_control: string; rated: number; played_at: string; eco: string | null; opening: string | null; plies: number; reviewed?: number | null;
};
const SUMMARY_COLUMNS = 'id, site, site_id, url, white, black, white_rating, black_rating, white_diff, black_diff, you, result, outcome, ending, time_class, time_control, rated, played_at, eco, opening, plies';
const un = <T>(v: T | null): T | undefined => v ?? undefined;
const summary = (r: GameRow): GameSummary => ({
  id: r.id, site: r.site as GameSite, siteId: r.site_id, url: un(r.url), white: r.white, black: r.black, whiteRating: un(r.white_rating), blackRating: un(r.black_rating),
  whiteDiff: un(r.white_diff), blackDiff: un(r.black_diff), you: un(r.you) as Color | undefined, result: r.result as GameSummary['result'], outcome: un(r.outcome) as GameSummary['outcome'],
  ending: r.ending as GameSummary['ending'], timeClass: r.time_class as GameSummary['timeClass'], timeControl: r.time_control, rated: r.rated === 1, playedAt: r.played_at, eco: un(r.eco),
  opening: un(r.opening), plies: r.plies, reviewed: r.reviewed === undefined ? undefined : r.reviewed === 1,
});

export class Db {
  readonly sql: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    // busy_timeout: a long job in a terminal (a repertoire build) and the server can share the file; a writer waits its turn
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 10000;');
    this.migrate();
  }

  private migrate() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const done = new Set((this.sql.prepare('SELECT id FROM migrations').all() as { id: number }[]).map((r) => r.id));
    MIGRATIONS.forEach((sqlText, i) => {
      const id = i + 1;
      if (done.has(id)) return;
      this.sql.exec('BEGIN');
      try {
        this.sql.exec(sqlText);
        this.sql.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)').run(id, new Date().toISOString());
        this.sql.exec('COMMIT');
      } catch (e) {
        this.sql.exec('ROLLBACK');
        throw e;
      }
    });
  }

  /** The append-only log of everything that happens (answers, hints, setting changes, coach runs). */
  logEvent(type: string, data: unknown) {
    this.sql.prepare('INSERT INTO events (at, type, data) VALUES (?, ?, ?)').run(new Date().toISOString(), type, JSON.stringify(data ?? {}));
  }

  /** The newest events of one type, newest first. */
  recentEvents(type: string, limit: number): { at: string; data: string }[] {
    return this.sql.prepare('SELECT at, data FROM events WHERE type = ? ORDER BY id DESC LIMIT ?').all(type, limit) as { at: string; data: string }[];
  }

  getSettingRaw(key: string): string | undefined {
    return (this.sql.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }

  setSettingRaw(key: string, value: string) {
    this.sql
      .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, value, new Date().toISOString());
  }

  loadSession(id: string): string | undefined {
    return (this.sql.prepare('SELECT data FROM board_sessions WHERE id = ?').get(id) as { data: string } | undefined)?.data;
  }

  saveSession(id: string, data: string) {
    this.sql
      .prepare('INSERT INTO board_sessions (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .run(id, data, new Date().toISOString());
  }

  engineCache = {
    get: (key: string): string | undefined => (this.sql.prepare('SELECT value FROM engine_cache WHERE key = ?').get(key) as { value: string } | undefined)?.value,
    set: (key: string, value: string): void => {
      this.sql.prepare('INSERT OR REPLACE INTO engine_cache (key, value) VALUES (?, ?)').run(key, value);
    },
  };

  cacheGet(table: 'lichess_cache' | 'explorer_cache', key: string): { value: string; at: string } | undefined {
    return this.sql.prepare(`SELECT value, at FROM ${table} WHERE key = ?`).get(key) as { value: string; at: string } | undefined;
  }

  cacheSet(table: 'lichess_cache' | 'explorer_cache', key: string, value: string) {
    this.sql.prepare(`INSERT OR REPLACE INTO ${table} (key, value, at) VALUES (?, ?, ?)`).run(key, value, new Date().toISOString());
  }

  // ---------------------------------------------------------------- the owner's games (Phase 5)

  /** Add a finished game. The site's id is the key: a game that is already here is left as it is (false). */
  addGame(g: ImportedGame): boolean {
    const r = this.sql
      .prepare(
        `INSERT OR IGNORE INTO games (site, site_id, url, white, black, white_rating, black_rating, white_diff, black_diff, you, result, outcome, ending, time_class, time_control, rated, played_at, eco, opening, plies, pgn, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(g.site, g.siteId, g.url ?? null, g.white, g.black, g.whiteRating ?? null, g.blackRating ?? null, g.whiteDiff ?? null, g.blackDiff ?? null, g.you ?? null, g.result, outcomeOf(g) ?? null, g.ending, g.timeClass, g.timeControl, g.rated ? 1 : 0, g.playedAt, g.eco ?? null, g.opening ?? null, g.moves.length, g.pgn, new Date().toISOString());
    return Number(r.changes) > 0;
  }

  /** The newest games first. */
  listGames(limit: number, offset = 0): GameSummary[] {
    return (this.sql.prepare(`SELECT ${SUMMARY_COLUMNS}, EXISTS (SELECT 1 FROM self_reviews s WHERE s.game_id = games.id) AS reviewed FROM games ORDER BY played_at DESC, id DESC LIMIT ? OFFSET ?`).all(limit, offset) as GameRow[]).map(summary);
  }

  getGame(id: number): (GameSummary & { pgn: string }) | undefined {
    const r = this.sql.prepare(`SELECT ${SUMMARY_COLUMNS}, pgn FROM games WHERE id = ?`).get(id) as (GameRow & { pgn: string }) | undefined;
    return r ? { ...summary(r), pgn: r.pgn } : undefined;
  }

  findGame(site: string, siteId: string): number | undefined {
    return (this.sql.prepare('SELECT id FROM games WHERE site = ? AND site_id = ?').get(site, siteId) as { id: number } | undefined)?.id;
  }

  deleteGame(id: number): boolean {
    for (const table of ['game_reviews', 'game_plies', 'moments', 'self_reviews', 'reviews', 'takeaways']) this.sql.prepare(`DELETE FROM ${table} WHERE game_id = ?`).run(id);
    // the puzzles made from the game go with it, and what was answered on them, and their cards
    this.sql.prepare("DELETE FROM attempts WHERE content_id IN (SELECT id FROM content_items WHERE source LIKE ?)").run(`game:${id}#%`);
    this.sql.prepare("DELETE FROM cards WHERE content_id IN (SELECT id FROM content_items WHERE source LIKE ?)").run(`game:${id}#%`);
    this.sql.prepare('DELETE FROM content_items WHERE source LIKE ?').run(`game:${id}#%`);
    return Number(this.sql.prepare('DELETE FROM games WHERE id = ?').run(id).changes) > 0;
  }

  // ---------------------------------------------------------------- content and its gates (Phase 6)

  /** Keep an item with the results of its gates. The key makes the same item, made again, replace itself. */
  saveContent<T>(key: string, item: ContentItem<T>): number {
    const now = new Date().toISOString();
    this.sql
      .prepare(
        `INSERT INTO content_items (key, type, status, source, licence, engine, level, gates, body, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET status = excluded.status, engine = excluded.engine, level = excluded.level, gates = excluded.gates, body = excluded.body, note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(key, item.type, item.status, item.source, item.licence, item.engine ?? null, item.level ?? null, JSON.stringify(item.gates), JSON.stringify(item.body), item.note ?? null, now, now);
    return (this.sql.prepare('SELECT id FROM content_items WHERE key = ?').get(key) as { id: number }).id;
  }

  private contentRow(r: { id: number; type: string; status: string; source: string; licence: string; engine: string | null; level: string | null; gates: string; body: string; note?: string | null }): ContentItem<Puzzle> & { id: number } {
    return { id: r.id, type: r.type as ContentItem['type'], status: r.status as ContentStatus, source: r.source, licence: r.licence as ContentItem['licence'], engine: r.engine ?? undefined, level: r.level ?? undefined, gates: JSON.parse(r.gates) as ContentItem['gates'], body: JSON.parse(r.body) as Puzzle, note: r.note ?? undefined };
  }

  /** Remove an item for good (the owner dropped it on the review screen; the decision is logged with the item). */
  deleteContent(id: number): boolean {
    // its schedule goes; the answers already given stay in the history
    this.sql.prepare('DELETE FROM cards WHERE content_id = ?').run(id);
    return this.sql.prepare('DELETE FROM content_items WHERE id = ?').run(id).changes > 0;
  }

  setContentNote(id: number, note: string | null) {
    this.sql.prepare('UPDATE content_items SET note = ?, updated_at = ? WHERE id = ?').run(note, new Date().toISOString(), id);
  }

  /** The ids, keys and statuses of every item of one type (the opening cards are matched to their positions by key). */
  contentKeys(type: string): { id: number; key: string; status: ContentStatus }[] {
    return this.sql.prepare('SELECT id, key, status FROM content_items WHERE type = ? ORDER BY id').all(type) as { id: number; key: string; status: ContentStatus }[];
  }

  /** How many items there are of each status. */
  contentCounts(): Record<string, number> {
    const rows = this.sql.prepare('SELECT status, COUNT(*) AS n FROM content_items GROUP BY status').all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  getContent(id: number): (ContentItem<Puzzle> & { id: number }) | undefined {
    const r = this.sql.prepare('SELECT id, type, status, source, licence, engine, level, gates, body, note FROM content_items WHERE id = ?').get(id) as Parameters<Db['contentRow']>[0] | undefined;
    return r ? this.contentRow(r) : undefined;
  }

  /** Items by status (and type), newest first. Only `live` items are ever used for practice. */
  listContent(filter: { status?: ContentStatus; type?: string; limit?: number } = {}): (ContentItem<Puzzle> & { id: number })[] {
    const rows = this.sql
      .prepare('SELECT id, type, status, source, licence, engine, level, gates, body, note FROM content_items WHERE (? IS NULL OR status = ?) AND (? IS NULL OR type = ?) ORDER BY id DESC LIMIT ?')
      .all(filter.status ?? null, filter.status ?? null, filter.type ?? null, filter.type ?? null, filter.limit ?? 500) as Parameters<Db['contentRow']>[0][];
    return rows.map((r) => this.contentRow(r));
  }

  /** One answer to a puzzle. `again` marks a second go at the same puzzle: kept, but not counted. */
  addAttempt(a: { contentId: number; result: 'solved' | 'shown'; hints: number; misses: number; ms: number; again: boolean }) {
    this.sql.prepare('INSERT INTO attempts (at, content_id, result, hints, misses, ms, again) VALUES (?, ?, ?, ?, ?, ?, ?)').run(new Date().toISOString(), a.contentId, a.result, a.hints, a.misses, a.ms, a.again ? 1 : 0);
  }

  // ------------------------------------------------------------ studies (WP 8.1)

  addStudy(name: string, source: string): number {
    const now = new Date().toISOString();
    return Number(this.sql.prepare('INSERT INTO studies (name, source, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, source, now, now).lastInsertRowid);
  }

  addChapter(studyId: number, c: { name: string; orientation: string; pgn: string }): number {
    const idx = (this.sql.prepare('SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM study_chapters WHERE study_id = ?').get(studyId) as { n: number }).n;
    const now = new Date().toISOString();
    this.sql.prepare('UPDATE studies SET updated_at = ? WHERE id = ?').run(now, studyId);
    return Number(this.sql.prepare('INSERT INTO study_chapters (study_id, idx, name, orientation, pgn, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(studyId, idx, c.name, c.orientation, c.pgn, now).lastInsertRowid);
  }

  saveChapter(id: number, pgn: string) {
    const now = new Date().toISOString();
    this.sql.prepare('UPDATE study_chapters SET pgn = ?, updated_at = ? WHERE id = ?').run(pgn, now, id);
    this.sql.prepare('UPDATE studies SET updated_at = ? WHERE id = (SELECT study_id FROM study_chapters WHERE id = ?)').run(now, id);
  }

  studies(): { id: number; name: string; source: string; chapters: { id: number; name: string; orientation: 'white' | 'black' }[] }[] {
    const studies = this.sql.prepare('SELECT id, name, source FROM studies ORDER BY updated_at DESC').all() as { id: number; name: string; source: string }[];
    return studies.map((st) => ({
      ...st,
      chapters: (this.sql.prepare('SELECT id, name, orientation FROM study_chapters WHERE study_id = ? ORDER BY idx').all(st.id) as { id: number; name: string; orientation: string }[]).map((c) => ({ ...c, orientation: c.orientation === 'black' ? 'black' : 'white' })),
    }));
  }

  chapter(id: number): { id: number; studyId: number; name: string; orientation: 'white' | 'black'; pgn: string } | undefined {
    const r = this.sql.prepare('SELECT id, study_id, name, orientation, pgn FROM study_chapters WHERE id = ?').get(id) as { id: number; study_id: number; name: string; orientation: string; pgn: string } | undefined;
    return r ? { id: r.id, studyId: r.study_id, name: r.name, orientation: r.orientation === 'black' ? 'black' : 'white', pgn: r.pgn } : undefined;
  }

  studyChapters(studyId: number): { name: string; orientation: 'white' | 'black'; pgn: string }[] {
    return (this.sql.prepare('SELECT name, orientation, pgn FROM study_chapters WHERE study_id = ? ORDER BY idx').all(studyId) as { name: string; orientation: string; pgn: string }[]).map((c) => ({ ...c, orientation: c.orientation === 'black' ? 'black' : 'white' }));
  }

  // ---------------------------------------------------------------- repertoires (WP 8.3)

  addRepertoire(r: { name: string; colour: Color; source: string; licence: string; level?: string }): number {
    const now = new Date().toISOString();
    return Number(this.sql.prepare('INSERT INTO repertoires (name, colour, source, licence, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(r.name, r.colour, r.source, r.licence, r.level ?? null, now, now).lastInsertRowid);
  }

  repertoire(id: number): { id: number; name: string; colour: Color; source: string; licence: string; level?: string; report?: unknown; plan?: unknown; outline?: string } | undefined {
    const r = this.sql.prepare('SELECT id, name, colour, source, licence, level, report, plan, outline FROM repertoires WHERE id = ?').get(id) as { id: number; name: string; colour: string; source: string; licence: string; level: string | null; report: string | null; plan: string | null; outline: string | null } | undefined;
    return r
      ? { id: r.id, name: r.name, colour: r.colour as Color, source: r.source, licence: r.licence, level: r.level ?? undefined, report: r.report ? (JSON.parse(r.report) as unknown) : undefined, plan: r.plan ? (JSON.parse(r.plan) as unknown) : undefined, outline: r.outline ?? undefined }
      : undefined;
  }

  /** The repertoire built from an outline (one per outline: building it again keeps its id, its words and its drill history). */
  repertoireByOutline(outline: string): number | undefined {
    return (this.sql.prepare('SELECT id FROM repertoires WHERE outline = ? ORDER BY id LIMIT 1').get(outline) as { id: number } | undefined)?.id;
  }

  /** How a repertoire was built (WP 8.12), and the source it now has. */
  setRepertoirePlan(id: number, p: { plan: unknown; outline?: string; source?: string; name?: string; level?: string }) {
    this.sql
      .prepare('UPDATE repertoires SET plan = ?, outline = COALESCE(?, outline), source = COALESCE(?, source), name = COALESCE(?, name), level = COALESCE(?, level), updated_at = ? WHERE id = ?')
      .run(JSON.stringify(p.plan), p.outline ?? null, p.source ?? null, p.name ?? null, p.level ?? null, new Date().toISOString(), id);
  }

  /** What the book said at a repertoire's positions (by position key). */
  repBook<T>(id: number): Map<string, T> {
    const rows = this.sql.prepare('SELECT key, data FROM rep_book WHERE repertoire = ?').all(id) as { key: string; data: string }[];
    return new Map(rows.map((r) => [r.key, JSON.parse(r.data) as T]));
  }

  /** Keep what the book said at a repertoire's positions; `replace` drops what was kept before. */
  setRepBook(id: number, rows: { key: string; data: unknown }[], replace = false) {
    this.sql.exec('BEGIN');
    try {
      if (replace) this.sql.prepare('DELETE FROM rep_book WHERE repertoire = ?').run(id);
      const put = this.sql.prepare('INSERT OR REPLACE INTO rep_book (repertoire, key, data) VALUES (?, ?, ?)');
      for (const r of rows) put.run(id, r.key, JSON.stringify(r.data));
      this.sql.exec('COMMIT');
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  repertoires(): { id: number; name: string; colour: Color; source: string; updatedAt: string }[] {
    return (this.sql.prepare('SELECT id, name, colour, source, updated_at FROM repertoires ORDER BY id').all() as { id: number; name: string; colour: string; source: string; updated_at: string }[]).map((r) => ({ id: r.id, name: r.name, colour: r.colour as Color, source: r.source, updatedAt: r.updated_at }));
  }

  setRepertoireReport(id: number, report: unknown) {
    this.sql.prepare('UPDATE repertoires SET report = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(report), new Date().toISOString(), id);
  }

  /** A repertoire's lines (content items of type 'repertoire'), in the order they were stored. */
  repertoireItems<T>(id: number): (ContentItem<T> & { id: number; key: string })[] {
    const rows = this.sql.prepare("SELECT id, key, type, status, source, licence, engine, level, gates, body, note FROM content_items WHERE type = 'repertoire' AND key LIKE ? ORDER BY id").all(`rep:${id}|%`) as (Parameters<Db['contentRow']>[0] & { key: string })[];
    return rows.map((r) => ({ ...(this.contentRow(r) as unknown as ContentItem<T> & { id: number }), key: r.key }));
  }

  /** The authored words of a repertoire's positions of mine, by position key (WP 8.6). */
  repTexts(id: number): Map<string, { fen: string; uci: string; san: string; why?: string; idea?: string; by?: WordsBy }> {
    const rows = this.sql.prepare('SELECT key, fen, uci, san, why, idea, source FROM rep_positions WHERE repertoire = ?').all(id) as { key: string; fen: string; uci: string; san: string; why: string | null; idea: string | null; source: string | null }[];
    return new Map(rows.map((r) => [r.key, { fen: r.fen, uci: r.uci, san: r.san, why: r.why ?? undefined, idea: r.idea ?? undefined, by: (r.source as WordsBy | null) ?? undefined }]));
  }

  /** A position's words; `by` is who wrote them (D13), kept as it was when not given. */
  setRepText(id: number, key: string, t: { fen: string; uci: string; san: string; why?: string; idea?: string; by?: WordsBy }) {
    this.sql
      .prepare('INSERT INTO rep_positions (repertoire, key, fen, uci, san, why, idea, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(repertoire, key) DO UPDATE SET fen = excluded.fen, uci = excluded.uci, san = excluded.san, why = excluded.why, idea = excluded.idea, source = COALESCE(excluded.source, rep_positions.source), updated_at = excluded.updated_at')
      .run(id, key, t.fen, t.uci, t.san, t.why ?? null, t.idea ?? null, t.by ?? null, new Date().toISOString());
  }

  /**
   * A repertoire removed for good (the owner's decision, logged by the caller): its lines, its words,
   * what the book said, and its drill cards with their schedules. The answers already given stay in
   * the history.
   */
  removeRepertoire(id: number): { removed: boolean; lines: number; cards: number } {
    const cards = this.sql.prepare("SELECT id FROM content_items WHERE type = 'opening' AND key LIKE ?").all(`opening:${id}|%`) as { id: number }[];
    for (const c of cards) this.sql.prepare('DELETE FROM cards WHERE content_id = ?').run(c.id);
    this.sql.prepare("DELETE FROM content_items WHERE type = 'opening' AND key LIKE ?").run(`opening:${id}|%`);
    this.sql.prepare('DELETE FROM rep_positions WHERE repertoire = ?').run(id);
    this.sql.prepare('DELETE FROM rep_book WHERE repertoire = ?').run(id);
    const lines = Number(this.sql.prepare("DELETE FROM content_items WHERE type = 'repertoire' AND key LIKE ?").run(`rep:${id}|%`).changes);
    const removed = Number(this.sql.prepare('DELETE FROM repertoires WHERE id = ?').run(id).changes) > 0;
    return { removed, lines, cards: cards.length };
  }

  /** The owner's games for the explorer's "my games" (WP 8.2): the side they played, the result, the PGN. */
  explorerGames(): { id: number; you: Color; result: string; pgn: string }[] {
    return this.sql.prepare("SELECT id, you, result, pgn FROM games WHERE you IN ('white', 'black') ORDER BY id").all() as { id: number; you: Color; result: string; pgn: string }[];
  }

  removeStudy(id: number): boolean {
    this.sql.prepare('DELETE FROM study_chapters WHERE study_id = ?').run(id);
    return this.sql.prepare('DELETE FROM studies WHERE id = ?').run(id).changes > 0;
  }

  /** Puzzles the owner has met that can go into a Woodpecker set: live, from their games or the database, the latest met first. */
  woodpeckerPool(size: number): number[] {
    return (this.sql.prepare("SELECT c.id FROM content_items c WHERE c.status = 'live' AND c.type IN ('puzzle_game', 'puzzle_db') AND EXISTS (SELECT 1 FROM attempts a WHERE a.content_id = c.id) ORDER BY (SELECT MAX(a.id) FROM attempts a WHERE a.content_id = c.id) DESC LIMIT ?").all(size) as { id: number }[]).map((r) => r.id);
  }

  /** The Woodpecker set in use: the newest. */
  woodpeckerSet(): { id: number; items: number[] } | undefined {
    const r = this.sql.prepare('SELECT id, items FROM woodpecker_sets ORDER BY id DESC LIMIT 1').get() as { id: number; items: string } | undefined;
    return r ? { id: r.id, items: JSON.parse(r.items) as number[] } : undefined;
  }

  newWoodpeckerSet(items: number[]): { id: number; items: number[] } {
    const r = this.sql.prepare('INSERT INTO woodpecker_sets (created_at, items) VALUES (?, ?)').run(new Date().toISOString(), JSON.stringify(items));
    return { id: Number(r.lastInsertRowid), items };
  }

  /** The rounds of a set, the first first: what was done in each (puzzle id and whether it was solved alone), and the time of a finished one. */
  woodpeckerRounds(setId: number): { id: number; round: number; startedAt: string; ms?: number; done: { id: number; solved: boolean; alone: boolean }[] }[] {
    const rows = this.sql.prepare('SELECT id, round, started_at, ms, done FROM woodpecker_rounds WHERE set_id = ? ORDER BY round').all(setId) as { id: number; round: number; started_at: string; ms: number | null; done: string }[];
    return rows.map((r) => ({ id: r.id, round: r.round, startedAt: r.started_at, ms: r.ms ?? undefined, done: JSON.parse(r.done) as { id: number; solved: boolean; alone: boolean }[] }));
  }

  startWoodpeckerRound(setId: number, round: number): number {
    return Number(this.sql.prepare('INSERT INTO woodpecker_rounds (set_id, round, started_at) VALUES (?, ?, ?)').run(setId, round, new Date().toISOString()).lastInsertRowid);
  }

  /** One puzzle of a round done; with `ms`, the round is over. */
  woodpeckerDone(roundId: number, done: { id: number; solved: boolean; alone: boolean }[], ms?: number) {
    this.sql.prepare('UPDATE woodpecker_rounds SET done = ?, ms = ?, finished_at = ? WHERE id = ?').run(JSON.stringify(done), ms ?? null, ms === undefined ? null : new Date().toISOString(), roundId);
  }

  /** Every answer to a puzzle, with the puzzle's themes: what motif mastery is counted from (G7). */
  motifHistory(): { themes: string[]; result: 'solved' | 'shown'; hints: number; misses: number; ms: number; at: string; again: boolean }[] {
    const rows = this.sql
      .prepare("SELECT a.at, a.result, a.hints, a.misses, a.ms, a.again, c.body FROM attempts a JOIN content_items c ON c.id = a.content_id WHERE c.type IN ('puzzle_game', 'puzzle_db') ORDER BY a.id")
      .all() as { at: string; result: string; hints: number; misses: number; ms: number; again: number; body: string }[];
    return rows.map((r) => {
      let themes: string[] = [];
      try {
        themes = (JSON.parse(r.body) as { themes?: string[] }).themes ?? [];
      } catch {
        /* a body that cannot be read has no themes */
      }
      return { themes, result: r.result === 'solved' ? 'solved' : 'shown', hints: r.hints, misses: r.misses, ms: r.ms, at: r.at, again: r.again === 1 };
    });
  }

  attemptsOf(contentId: number): { at: string; result: string; hints: number; misses: number; ms: number; again: boolean }[] {
    return (this.sql.prepare('SELECT at, result, hints, misses, ms, again FROM attempts WHERE content_id = ? ORDER BY id').all(contentId) as { at: string; result: string; hints: number; misses: number; ms: number; again: number }[]).map((r) => ({ ...r, again: r.again === 1 }));
  }

  /** The items of one type that have been answered at least once (one query, for a deck of thousands). */
  attempted(type: string): Set<number> {
    const rows = this.sql.prepare('SELECT DISTINCT a.content_id AS id FROM attempts a JOIN content_items c ON c.id = a.content_id WHERE c.type = ?').all(type) as { id: number }[];
    return new Set(rows.map((r) => r.id));
  }

  /** How many items of one type were answered for the first time since a moment (the new cards of a day). */
  firstAnsweredSince(type: string, since: string): number {
    const r = this.sql.prepare('SELECT COUNT(*) AS n FROM (SELECT a.content_id, MIN(a.at) AS first FROM attempts a JOIN content_items c ON c.id = a.content_id WHERE c.type = ? GROUP BY a.content_id) WHERE first >= ?').get(type, since) as { n: number };
    return r.n;
  }

  /** The next live puzzle: the one tried least, the oldest first; `exclude` leaves some out (the one just played, ones that cannot be shown). */
  nextPuzzle(exclude: number[] = []): (ContentItem<Puzzle> & { id: number }) | undefined {
    const not = exclude.length ? `AND c.id NOT IN (${exclude.map(() => '?').join(', ')})` : '';
    const r = this.sql
      .prepare(
        `SELECT c.id, c.type, c.status, c.source, c.licence, c.engine, c.level, c.gates, c.body FROM content_items c
         WHERE c.status = 'live' AND c.type = 'puzzle_game' ${not}
         ORDER BY (SELECT COUNT(*) FROM attempts a WHERE a.content_id = c.id AND a.again = 0), c.id LIMIT 1`,
      )
      .get(...exclude) as Parameters<Db['contentRow']>[0] | undefined;
    return r ? this.contentRow(r) : undefined;
  }

  getCard(contentId: number): StoredCard | undefined {
    const r = this.sql.prepare('SELECT card FROM cards WHERE content_id = ?').get(contentId) as { card: string } | undefined;
    return r ? (JSON.parse(r.card) as StoredCard) : undefined;
  }

  saveCard(contentId: number, card: StoredCard) {
    const now = new Date().toISOString();
    this.sql
      .prepare('INSERT INTO cards (content_id, card, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(content_id) DO UPDATE SET card = excluded.card, due_at = excluded.due_at, updated_at = excluded.updated_at')
      .run(contentId, JSON.stringify(card), card.dueAt, now, now);
  }

  /** Cards due by a moment, the longest overdue first: only items that are still live. */
  dueCards(now: string, types: string[] = ['puzzle_game', 'puzzle_db']): { id: number; dueAt: string }[] {
    return this.sql
      .prepare(`SELECT k.content_id AS id, k.due_at AS dueAt FROM cards k JOIN content_items c ON c.id = k.content_id WHERE k.due_at <= ? AND c.status = 'live' AND c.type IN (${types.map(() => '?').join(', ')}) ORDER BY k.due_at, k.content_id`)
      .all(now, ...types) as { id: number; dueAt: string }[];
  }

  /** Move a card to another day (the backlog cap), keeping its memory state. */
  moveCard(contentId: number, dueAt: string) {
    const card = this.getCard(contentId);
    if (!card) return;
    this.saveCard(contentId, { ...card, dueAt });
  }

  /** How many of the owner's game puzzles were tried for the first time since a moment: the new ones of the day. */
  newPuzzlesSince(since: string): number {
    return (this.sql.prepare("SELECT COUNT(*) AS n FROM content_items c WHERE c.type = 'puzzle_game' AND (SELECT MIN(a.at) FROM attempts a WHERE a.content_id = c.id) >= ?").get(since) as { n: number }).n;
  }

  /** The answers to database puzzles, in order, with each puzzle's rating: the owner's puzzle level is replayed from them. Second goes are left out. */
  databaseHistory(): { rating: number; result: 'solved' | 'shown'; hints: number; misses: number }[] {
    const rows = this.sql.prepare("SELECT a.result, a.hints, a.misses, c.body FROM attempts a JOIN content_items c ON c.id = a.content_id WHERE c.type = 'puzzle_db' AND a.again = 0 ORDER BY a.id").all() as { result: string; hints: number; misses: number; body: string }[];
    return rows.map((r) => ({ rating: (JSON.parse(r.body) as Puzzle).rating ?? 1500, result: r.result as 'solved' | 'shown', hints: r.hints, misses: r.misses }));
  }

  /** The database puzzles already drawn (their Lichess ids): a set does not repeat them. */
  drawnPuzzleIds(): Set<string> {
    return new Set((this.sql.prepare("SELECT source FROM content_items WHERE type = 'puzzle_db'").all() as { source: string }[]).map((r) => r.source.replace(/^puzzle:/, '')));
  }

  /** How many puzzles from the owner's games are live, and how many of them have not been tried. */
  puzzleCounts(): { ready: number; fresh: number } {
    const r = this.sql
      .prepare("SELECT COUNT(*) AS ready, SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM attempts a WHERE a.content_id = c.id AND a.again = 0) THEN 1 ELSE 0 END) AS fresh FROM content_items c WHERE c.status = 'live' AND c.type = 'puzzle_game'")
      .get() as { ready: number; fresh: number | null };
    return { ready: r.ready, fresh: r.fresh ?? 0 };
  }

  /** The items made from one game (their source is `game:<id>#<ply>`). */
  contentFromGame(gameId: number): (ContentItem<Puzzle> & { id: number })[] {
    const rows = this.sql.prepare('SELECT id, type, status, source, licence, engine, level, gates, body FROM content_items WHERE source LIKE ? ORDER BY id').all(`game:${gameId}#%`) as Parameters<Db['contentRow']>[0][];
    return rows.map((r) => this.contentRow(r));
  }

  setContentStatus(id: number, status: ContentStatus) {
    this.sql.prepare('UPDATE content_items SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
  }

  // ---------------------------------------------------------------- the review report and the takeaway journal (WP 5.7)

  /** The owner's slips in an analysed game, each with its skipped step: the owner's own word for it when they gave one. */
  ownerSlips(gameId: number, you: Color): (ReportSlip & { stepBy?: 'owner' })[] {
    const rows = this.sql
      .prepare("SELECT ply, san, label, step, step_owner, what FROM game_plies WHERE game_id = ? AND by = ? AND label IN ('mistake', 'blunder', 'miss') ORDER BY ply")
      .all(gameId, you) as { ply: number; san: string; label: string; step: string | null; step_owner: string | null; what: string | null }[];
    return rows.map((r) => ({ ply: r.ply, san: r.san, label: r.label, step: (r.step_owner ?? r.step ?? 'unknown') as SkippedStep, what: r.what ?? undefined, ...(r.step_owner ? { stepBy: 'owner' as const } : {}) }));
  }

  /** The owner says which step a slip of theirs skipped (feature H8). False when that move is not one of their slips. */
  setOwnerStep(gameId: number, ply: number, step: SkippedStep): boolean {
    return Number(this.sql.prepare("UPDATE game_plies SET step_owner = ? WHERE game_id = ? AND ply = ? AND label IN ('mistake', 'blunder', 'miss')").run(step, gameId, ply).changes) > 0;
  }

  /** Keep a game's report and its takeaways (a new one replaces the old; the owner's note stays). */
  saveReport(gameId: number, report: ReviewReport) {
    const now = new Date().toISOString();
    const first = (this.sql.prepare('SELECT at FROM reviews WHERE game_id = ?').get(gameId) as { at: string } | undefined)?.at ?? now;
    this.sql.exec('BEGIN');
    try {
      this.sql.prepare('INSERT INTO reviews (game_id, at, report) VALUES (?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET report = excluded.report').run(gameId, first, JSON.stringify(report));
      this.sql.prepare('DELETE FROM takeaways WHERE game_id = ?').run(gameId);
      const add = this.sql.prepare('INSERT INTO takeaways (game_id, step, at, text, plies) VALUES (?, ?, ?, ?, ?)');
      for (const t of report.takeaways) add.run(gameId, t.step, first, t.text, JSON.stringify(t.plies));
      this.sql.exec('COMMIT');
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  getReport(gameId: number): { at: string; report: ReviewReport; note: string } | undefined {
    const row = this.sql.prepare('SELECT at, report, note FROM reviews WHERE game_id = ?').get(gameId) as { at: string; report: string; note: string } | undefined;
    return row ? { at: row.at, report: JSON.parse(row.report) as ReviewReport, note: row.note } : undefined;
  }

  setReportNote(gameId: number, note: string): boolean {
    return Number(this.sql.prepare('UPDATE reviews SET note = ? WHERE game_id = ?').run(note, gameId).changes) > 0;
  }

  /** The takeaways of the game reviewed last before this one, and every habit that has been a takeaway of another game. */
  takeawaysBefore(gameId: number): { last: SkippedStep[]; known: Set<SkippedStep> } {
    const mine = (this.sql.prepare('SELECT at FROM reviews WHERE game_id = ?').get(gameId) as { at: string } | undefined)?.at ?? new Date().toISOString();
    const prev = this.sql.prepare('SELECT game_id FROM reviews WHERE game_id != ? AND at <= ? ORDER BY at DESC, game_id DESC LIMIT 1').get(gameId, mine) as { game_id: number } | undefined;
    const last = prev ? (this.sql.prepare('SELECT step FROM takeaways WHERE game_id = ?').all(prev.game_id) as { step: string }[]).map((r) => r.step as SkippedStep) : [];
    const known = new Set((this.sql.prepare('SELECT DISTINCT step FROM takeaways WHERE game_id != ?').all(gameId) as { step: string }[]).map((r) => r.step as SkippedStep));
    return { last, known };
  }

  /**
   * Every analysed game in which the owner's side is known, as the skill profile needs it (WP 5.8).
   * `speeds` limits it to those time classes: the profile is about slow games (LEARNING §8).
   */
  profileGames(speeds?: readonly string[]): ProfileGame[] {
    const games = this.sql
      .prepare('SELECT g.id, g.played_at, g.outcome, g.time_class, r.you, r.numbers FROM games g JOIN game_reviews r ON r.game_id = g.id ORDER BY g.played_at, g.id')
      .all() as { id: number; played_at: string; outcome: string | null; time_class: string; you: string; numbers: string }[];
    const plies = this.sql.prepare("SELECT ply, by, label, white_win, step, step_owner FROM game_plies WHERE game_id = ? ORDER BY ply");
    const out: ProfileGame[] = [];
    for (const g of games) {
      if (speeds && !speeds.includes(g.time_class)) continue;
      const rows = plies.all(g.id) as { ply: number; by: string; label: string | null; white_win: number | null; step: string | null; step_owner: string | null }[];
      out.push({
        id: g.id,
        playedAt: g.played_at,
        outcome: (g.outcome ?? undefined) as ProfileGame['outcome'],
        you: g.you as Color,
        numbers: JSON.parse(g.numbers) as GameNumbers,
        winAfter: rows.map((p) => (p.white_win === null ? null : g.you === 'white' ? p.white_win : Math.round((100 - p.white_win) * 10) / 10)),
        steps: rows.filter((p) => p.by === g.you && (p.label === 'mistake' || p.label === 'blunder' || p.label === 'miss')).map((p) => (p.step_owner ?? p.step ?? 'unknown') as SkippedStep),
      });
    }
    return out;
  }

  /** The takeaway journal (feature G6): each habit, in how many reviewed games it came up, and when last. */
  journal(): { step: SkippedStep; games: number; lastAt: string }[] {
    return (this.sql.prepare('SELECT step, COUNT(*) AS games, MAX(at) AS lastAt FROM takeaways GROUP BY step ORDER BY games DESC, lastAt DESC').all() as { step: string; games: number; lastAt: string }[]).map((r) => ({ step: r.step as SkippedStep, games: r.games, lastAt: r.lastAt }));
  }

  /** The named tactics that have come up in a review before: one that has not is shown, not asked for (the stop rules). */
  seenMotifs(): Set<string> {
    const out = new Set<string>();
    for (const row of this.sql.prepare("SELECT data FROM events WHERE type = 'replay_moment'").all() as { data: string }[]) {
      try {
        for (const m of (JSON.parse(row.data) as { motifs?: string[] }).motifs ?? []) out.add(m);
      } catch {
        /* a row that cannot be read counts for nothing */
      }
    }
    return out;
  }

  /** The owner's own review of a game (feature B7): the moves they marked and what they wrote, or that they skipped it. */
  saveSelfReview(gameId: number, r: { skipped: boolean; marks: number[]; notes: string }) {
    this.sql.prepare('INSERT OR REPLACE INTO self_reviews (game_id, at, skipped, marks, notes) VALUES (?, ?, ?, ?, ?)').run(gameId, new Date().toISOString(), r.skipped ? 1 : 0, JSON.stringify(r.marks), r.notes);
  }

  getSelfReview(gameId: number): { at: string; skipped: boolean; marks: number[]; notes: string } | undefined {
    const row = this.sql.prepare('SELECT at, skipped, marks, notes FROM self_reviews WHERE game_id = ?').get(gameId) as { at: string; skipped: number; marks: string; notes: string } | undefined;
    return row ? { at: row.at, skipped: row.skipped === 1, marks: JSON.parse(row.marks) as number[], notes: row.notes } : undefined;
  }

  /** Keep a game's analysis: what each move was, and its key moments. A new analysis replaces the old one. */
  saveReview(gameId: number, r: { engine: string; you: Color; numbers: GameNumbers; plies: GamePly[]; moments: Moment[] }) {
    // what the owner said about their own slips outlives a new analysis
    const said = this.sql.prepare('SELECT ply, san, step_owner FROM game_plies WHERE game_id = ? AND step_owner IS NOT NULL').all(gameId) as { ply: number; san: string; step_owner: string }[];
    this.sql.exec('BEGIN');
    try {
      for (const table of ['game_reviews', 'game_plies', 'moments']) this.sql.prepare(`DELETE FROM ${table} WHERE game_id = ?`).run(gameId);
      this.sql.prepare('INSERT INTO game_reviews (game_id, at, engine, you, numbers) VALUES (?, ?, ?, ?, ?)').run(gameId, new Date().toISOString(), r.engine, r.you, JSON.stringify(r.numbers));
      const ply = this.sql.prepare('INSERT INTO game_plies (game_id, ply, by, san, label, drop_pts, live, given_away, white_win, step, what, motifs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const p of r.plies) {
        ply.run(gameId, p.ply, p.by, p.san, p.judged?.label ?? null, p.grade?.drop ?? null, p.grade ? (p.grade.live ? 1 : 0) : null, p.grade?.givenAway ?? null, p.whiteWin ?? null, p.tag?.step ?? null, p.tag?.what ?? null, p.tag?.motifs.length ? p.tag.motifs.join(',') : null);
      }
      const keep = this.sql.prepare('UPDATE game_plies SET step_owner = ? WHERE game_id = ? AND ply = ? AND san = ?');
      for (const o of said) keep.run(o.step_owner, gameId, o.ply, o.san);
      const moment = this.sql.prepare('INSERT INTO moments (game_id, ply, label, kind, data) VALUES (?, ?, ?, ?, ?)');
      for (const m of r.moments) moment.run(gameId, m.ply, m.label, m.kind, JSON.stringify(m));
      this.sql.exec('COMMIT');
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  getReview(gameId: number): { at: string; engine: string; you: Color; numbers: GameNumbers; moments: Moment[]; plies: { ply: number; by: Color; san: string; label: string | null; drop: number | null; live: boolean | null; whiteWin: number | null; step: string | null; what: string | null }[] } | undefined {
    const row = this.sql.prepare('SELECT at, engine, you, numbers FROM game_reviews WHERE game_id = ?').get(gameId) as { at: string; engine: string; you: string; numbers: string } | undefined;
    if (!row) return undefined;
    const moments = (this.sql.prepare('SELECT data FROM moments WHERE game_id = ? ORDER BY ply').all(gameId) as { data: string }[]).map((m) => JSON.parse(m.data) as Moment);
    const plies = (this.sql.prepare('SELECT ply, by, san, label, drop_pts, live, white_win, step, what FROM game_plies WHERE game_id = ? ORDER BY ply').all(gameId) as { ply: number; by: string; san: string; label: string | null; drop_pts: number | null; live: number | null; white_win: number | null; step: string | null; what: string | null }[]).map(
      (p) => ({ ply: p.ply, by: p.by as Color, san: p.san, label: p.label, drop: p.drop_pts, live: p.live === null ? null : p.live === 1, whiteWin: p.white_win, step: p.step, what: p.what }),
    );
    return { at: row.at, engine: row.engine, you: row.you as Color, numbers: JSON.parse(row.numbers) as GameNumbers, moments, plies };
  }

  /** How many games there are, and the owner's wins, losses and draws among them. */
  gameCounts(): { total: number; bySite: Record<string, number>; win: number; loss: number; draw: number } {
    const rows = this.sql.prepare('SELECT site, outcome, COUNT(*) AS n FROM games GROUP BY site, outcome').all() as { site: string; outcome: string | null; n: number }[];
    const out = { total: 0, bySite: {} as Record<string, number>, win: 0, loss: 0, draw: 0 };
    for (const r of rows) {
      out.total += r.n;
      out.bySite[r.site] = (out.bySite[r.site] ?? 0) + r.n;
      if (r.outcome === 'win' || r.outcome === 'loss' || r.outcome === 'draw') out[r.outcome] += r.n;
    }
    return out;
  }

  /** The owner's rating after their newest rated game of each speed on one site. */
  latestRatings(site: string): Record<string, number> {
    const rows = this.sql
      .prepare("SELECT time_class, you, white_rating, black_rating, white_diff, black_diff FROM games WHERE site = ? AND you IS NOT NULL AND rated = 1 ORDER BY played_at DESC, id DESC LIMIT 400")
      .all(site) as { time_class: string; you: string; white_rating: number | null; black_rating: number | null; white_diff: number | null; black_diff: number | null }[];
    const out: Record<string, number> = {};
    for (const r of rows) {
      if (out[r.time_class] !== undefined) continue;
      const rating = r.you === 'white' ? r.white_rating : r.black_rating;
      // Lichess gives the rating before the game and the change; Chess.com gives the rating after it
      if (rating !== null) out[r.time_class] = rating + ((r.you === 'white' ? r.white_diff : r.black_diff) ?? 0);
    }
    return out;
  }

  /** Replace one site's list of games in progress with what it says now. */
  setOngoing(site: string, games: OngoingGame[]) {
    const now = new Date().toISOString();
    this.sql.exec('BEGIN');
    try {
      this.sql.prepare('DELETE FROM ongoing_games WHERE site = ?').run(site);
      const add = this.sql.prepare('INSERT OR REPLACE INTO ongoing_games (site, site_id, data, seen_at) VALUES (?, ?, ?, ?)');
      for (const g of games) add.run(site, g.siteId, JSON.stringify(g), now);
      this.sql.exec('COMMIT');
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  ongoing(): OngoingGame[] {
    return (this.sql.prepare('SELECT data FROM ongoing_games').all() as { data: string }[]).map((r) => JSON.parse(r.data) as OngoingGame);
  }

  syncGet<T>(key: string): { value: T; at: string } | undefined {
    const r = this.sql.prepare('SELECT value, at FROM sync_state WHERE key = ?').get(key) as { value: string; at: string } | undefined;
    return r ? { value: JSON.parse(r.value) as T, at: r.at } : undefined;
  }

  syncSet(key: string, value: unknown) {
    this.sql.prepare('INSERT OR REPLACE INTO sync_state (key, value, at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), new Date().toISOString());
  }

  startRun(agent: string, model: string): number {
    const r = this.sql.prepare('INSERT INTO coach_runs (started_at, agent, model) VALUES (?, ?, ?)').run(new Date().toISOString(), agent, model);
    return Number(r.lastInsertRowid);
  }

  addRunUsage(id: number, u: { input: number; output: number; cacheRead: number; cost: number }) {
    this.sql
      .prepare('UPDATE coach_runs SET turns = turns + 1, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cache_read_tokens = cache_read_tokens + ?, cost_usd = ? WHERE id = ?')
      .run(u.input, u.output, u.cacheRead, u.cost, id);
  }

  endRun(id: number, reason: string) {
    this.sql.prepare('UPDATE coach_runs SET ended_at = ?, end_reason = ? WHERE id = ?').run(new Date().toISOString(), reason, id);
  }

  saveCoachMessage(m: { runId: number | null; seq: number; source: 'coach' | 'scripted'; kind: string; text: string; claims: string[]; ok: boolean; problems: unknown[] }) {
    this.sql
      .prepare('INSERT INTO coach_messages (at, run_id, seq, source, kind, text, claims, verdict, problems) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), m.runId, m.seq, m.source, m.kind, m.text, JSON.stringify(m.claims), m.ok ? 'ok' : 'rejected', JSON.stringify(m.problems));
  }

  /** First-try validity and totals, for the coach's accuracy measure. */
  messageStats(): { total: number; ok: number } {
    const r = this.sql.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN verdict = 'ok' THEN 1 ELSE 0 END) AS ok FROM coach_messages WHERE source = 'coach'").get() as { total: number; ok: number | null };
    return { total: r.total, ok: r.ok ?? 0 };
  }

  close() {
    this.sql.close();
  }
}
