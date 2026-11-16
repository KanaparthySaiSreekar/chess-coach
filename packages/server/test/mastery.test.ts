import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileLadder, type ConceptLadderFile, type PuzzleView } from '@chess-coach/core';
import { config } from '../src/config.ts';
import { ContentService } from '../src/content.ts';
import { PuzzleDb, installPuzzles } from '../src/datasets/puzzle-db.ts';
import { Db } from '../src/db.ts';
import type { EngineService } from '../src/engine/service.ts';
import type { FactService } from '../src/facts-service.ts';
import { PuzzleController, loadPuzzleWords } from '../src/puzzles.ts';

// PLAN WP 6.9: motif mastery drives the guidance a puzzle gets. Built on the same fixed sample of the
// Lichess database as the themed-set tests; no engine is needed.
const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(path.join(here, '..', '..', 'core', 'test', 'fixtures', 'puzzles', 'sample.json'), 'utf8')) as { pool: Row[]; tagged: Record<string, Row[]> };
type Row = { id: string; fen: string; moves: string[]; rating: number; themes: string[] };

describe('motif mastery in the puzzle player', () => {
  let dir: string;
  let db: Db;
  let puzzleDb: PuzzleDb;
  let player: PuzzleController;
  let view: PuzzleView;
  const guidance = { fade: true, mixedKnownOnly: true };
  let n = 0;
  /** Answers on record for a motif, on puzzles kept out of play. */
  const history = (theme: string, how: ('alone' | 'shown')[]) => {
    for (const h of how) {
      const id = db.saveContent(`test:${theme}:${++n}`, { type: 'puzzle_db', status: 'quarantined', source: `test:${n}`, licence: 'cc0', level: '700–1000', gates: [], body: { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solution: ['Rd8#'], themes: [theme], kind: 'theme' } });
      db.addAttempt({ contentId: id, result: h === 'alone' ? 'solved' : 'shown', hints: h === 'alone' ? 0 : 3, misses: 0, ms: 20_000, again: false });
    }
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-mastery-'));
    const rows = new Map<string, Row>();
    for (const r of [...sample.pool, ...Object.values(sample.tagged).flat()]) rows.set(r.id, r);
    const csv = ['PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags', ...[...rows.values()].map((r) => [r.id, r.fen, r.moves.join(' '), r.rating, 80, 90, 500, r.themes.join(' '), 'https://lichess.org/x', ''].join(','))].join('\n');
    writeFileSync(path.join(dir, 'sample.csv'), csv);
    installPuzzles(path.join(dir, 'sample.csv'), path.join(dir, 'puzzles.sqlite'));
    puzzleDb = PuzzleDb.open(path.join(dir, 'puzzles.sqlite'))!;
    db = new Db(':memory:');
    const ladder = compileLadder(JSON.parse(readFileSync(config.ladderFile, 'utf8')) as ConceptLadderFile);
    const content = new ContentService({ db, engine: {} as EngineService, facts: {} as FactService, ladder, dataDir: dir, dbFile: ':memory:', options: () => ({ nodes: 0, vocabulary: 'core', autoApprove: true }) });
    player = new PuzzleController({
      db,
      facts: { checkMove: async () => ({ legal: false, reason: '', legalMoves: [] }) } as unknown as FactService,
      words: loadPuzzleWords(path.join(config.repoRoot, 'coach', 'templates', 'puzzle.json')),
      maxMisses: () => 2,
      guard: () => null,
      onChange: () => (view = player.view),
      content,
      puzzleDb: () => puzzleDb,
      startLevel: () => 900,
      guidance: () => guidance,
      noDelay: true,
    });
  });
  afterAll(() => {
    puzzleDb.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a new idea is offered as a worked example first; while it is still new it is named; once known, nothing', async () => {
    await player.choose({ kind: 'theme', theme: 'fork' });
    expect(view).toMatchObject({ status: 'solving', guide: { motif: 'fork', name: 'Fork', stage: 'example', offerExample: true, text: 'A new idea for you: Fork. Try it yourself, or watch how it works first.' } });
    // the worked example: the solution played out, logged as shown, so the puzzle comes back soon
    player.example();
    expect(view).toMatchObject({ status: 'shown', feedback: { tone: 'answer', text: expect.stringMatching(/^Here is how it works\./) } });
    expect(view.guide).toBeUndefined();
    expect(JSON.parse(db.recentEvents('worked_example', 1)[0]!.data)).toMatchObject({ motif: 'fork' });
    expect(db.attemptsOf(view.id!)).toMatchObject([{ result: 'shown' }]);
    // the next fork: a themed set names its theme already, so a motif being learnt gets nothing more
    await player.next();
    expect(view.status).toBe('solving');
    expect(view.guide).toBeUndefined();
    // a worked example is offered only before the owner has tried
    player.example();
    expect(view.status).toBe('solving');
    player.close();

    // a puzzle from the owner's games hides its idea; at the "learning" stage it is named
    history('backRankMate', ['alone', 'shown']);
    const game = db.saveContent('game:1#21', { type: 'puzzle_game', status: 'live', source: 'game:1#21', licence: 'own', level: '400–700', gates: [], body: { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solution: ['Rd8#'], themes: ['backRankMate', 'mateIn1'], kind: 'mistake' } });
    db.addAttempt({ contentId: db.saveContent('test:mate1', { type: 'puzzle_db', status: 'quarantined', source: 'test:m1', licence: 'cc0', level: '700–1000', gates: [], body: { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solution: ['Rd8#'], themes: ['mateIn1'], kind: 'theme' } }), result: 'solved', hints: 0, misses: 0, ms: 5000, again: false });
    await player.choose({ kind: 'games' });
    expect(view.id).toBe(game);
    // its least known idea sets the guidance: both are at "learning"; the first one named is the one in the puzzle's own order
    expect(view.guide).toMatchObject({ stage: 'partial', offerExample: false, text: expect.stringMatching(/^Look for: (Back-rank mate|Mate in 1)\.$/) });
    // with the guidance switched off, the idea stays hidden
    guidance.fade = false;
    player.start(game, true);
    expect(view.guide).toBeUndefined();
    guidance.fade = true;
    player.close();
  });

  it('mixed sets use only the ideas already known, once there are three; the motifs are listed with their stage', async () => {
    history('pin', ['alone', 'alone', 'alone']);
    history('skewer', ['alone', 'alone', 'shown', 'alone']);
    history('hangingPiece', ['alone', 'alone', 'alone', 'alone', 'alone', 'alone']);
    player.refresh();
    expect(view.status).toBe('idle');
    expect(view.motifs!.map((m) => [m.motif, m.stage])).toEqual(
      expect.arrayContaining([
        ['hangingPiece', 'mixed'],
        ['pin', 'full'],
        ['skewer', 'full'],
        ['backRankMate', 'partial'],
      ]),
    );
    expect(view.motifs!.find((m) => m.motif === 'skewer')).toMatchObject({ name: 'Skewer', alone: 3, recent: 4 });
    // known: pin, skewer and hanging piece. Each puzzle drawn is passed over unanswered, so the mastery does not move
    await player.choose({ kind: 'mixed' });
    for (let i = 0; i < 6; i++) {
      expect(view.status).toBe('solving');
      // a mixed set names nothing
      expect(view.guide).toBeUndefined();
      const themes = db.getContent(view.id!)!.body.themes;
      expect(themes.some((t) => ['pin', 'skewer', 'hangingPiece'].includes(t))).toBe(true);
      await player.next();
    }
    expect(db.motifHistory()).toHaveLength(17);
    // with the option off, a mixed set draws from every theme again
    guidance.mixedKnownOnly = false;
    await player.choose({ kind: 'mixed' });
    expect(view.status).toBe('solving');
    guidance.mixedKnownOnly = true;
  });
});
