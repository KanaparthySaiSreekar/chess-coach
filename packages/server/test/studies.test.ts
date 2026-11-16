import { describe, expect, it } from 'vitest';
import { chaptersFromPgn, importPgn, movesTo } from '@chess-coach/core';
import { Db } from '../src/db.ts';
import type { Http } from '../src/importers.ts';
import { StudyService } from '../src/studies.ts';

// PLAN WP 8.1: studies in and out. A Lichess study is fetched by its link (a fake site here).
const STUDY = `[Event "Endgames: Opposition"]
[StudyName "Endgames"]
[ChapterName "Opposition"]
[Orientation "white"]
[SetUp "1"]
[FEN "8/8/8/4k3/8/4K3/4P3/8 w - - 0 1"]

1. Kd3 { Take the opposition. [%csl Gd3] } 1... Kd5 2. e4+ *


[Event "Endgames: Black to hold"]
[StudyName "Endgames"]
[ChapterName "Black to hold"]
[Orientation "black"]
[SetUp "1"]
[FEN "8/8/8/4k3/8/4K3/4P3/8 b - - 0 1"]

1... Kd5 *`;

describe('studies (I6, J1; WP 8.1)', () => {
  it('imports a Lichess study by its link, opens a chapter, saves the board back, adds a chapter, and exports it all', async () => {
    const db = new Db(':memory:');
    const asked: { url: string; headers: Record<string, string> }[] = [];
    const http: Http = async (url, headers = {}) => {
      asked.push({ url, headers });
      return url.includes('/api/study/AbCdEfGh.pgn') ? { status: 200, text: async () => STUDY, headers: { get: () => null } } : { status: 404, text: async () => '', headers: { get: () => null } };
    };
    let changes = 0;
    const studies = new StudyService({ db, http, token: () => 'secret-token', onChange: () => void changes++ });
    const r = await studies.importText('https://lichess.org/study/AbCdEfGh');
    expect(r).toEqual({ ok: true, study: 1, chapters: 2, skipped: [] });
    expect(asked[0]!.url).toMatch(/^https:\/\/lichess\.org\/api\/study\/AbCdEfGh\.pgn\?/);
    expect(asked[0]!.headers.Authorization).toBe('Bearer secret-token');
    const view = studies.view();
    expect(view.studies).toEqual([{ id: 1, name: 'Endgames', source: 'https://lichess.org/study/AbCdEfGh', chapters: [{ id: 1, name: 'Opposition', orientation: 'white' }, { id: 2, name: 'Black to hold', orientation: 'black' }] }]);
    // a private study, or none at that address
    expect(await studies.importText('https://lichess.org/study/ZZZZZZZZ')).toMatchObject({ ok: false, reason: expect.stringMatching(/private/) });
    // a chapter on the board, saved back with a move added
    const c = studies.open(2)!;
    expect(c.orientation).toBe('black');
    expect(studies.view().open).toEqual({ study: 1, chapter: 2 });
    const tree = importPgn(c.pgn);
    if (!tree.ok) throw new Error('chapter');
    expect(studies.saveOpen(c.pgn.replace('1... Kd5 *', '1... Kd5 { The opposition. } 2. Kd3 *'))).toBe(true);
    const saved = importPgn(db.chapter(2)!.pgn);
    if (!saved.ok) throw new Error('saved');
    expect(Object.values(saved.tree.nodes).map((n) => movesTo(saved.tree, n.id).join(' ')).sort()).toEqual(['', 'Kd5', 'Kd5 Kd3']);
    // the board as a new chapter of the study, and as a new study of its own
    studies.add('1. e4 e5 *', 'white', 'Chapter 3', 1);
    expect(studies.view().studies[0]!.chapters.map((x) => x.name)).toEqual(['Opposition', 'Black to hold', 'Chapter 3']);
    studies.add('1. d4 *', 'white', 'My lines');
    expect(studies.view().studies.map((x) => x.name).sort()).toEqual(['Endgames', 'My lines']);
    // the whole study out as PGN, and back in: the same chapters
    const out = studies.export(1)!;
    expect(chaptersFromPgn(out).chapters.map((x) => [x.name, x.orientation])).toEqual([
      ['Opposition', 'white'],
      ['Black to hold', 'black'],
      ['Chapter 3', 'white'],
    ]);
    // a plain PGN is a study too
    expect(await studies.importText('1. e4 e5 2. Nf3 *')).toMatchObject({ ok: true, chapters: 1 });
    expect(studies.remove(1)).toBe(true);
    expect(studies.view().studies.map((x) => x.name).sort()).toEqual(['My lines', 'My study']);
    // the open chapter is in "My lines": removing that study closes it
    expect(studies.view().open).toEqual({ study: 2, chapter: 4 });
    expect(studies.remove(2)).toBe(true);
    expect(studies.view().open).toBeUndefined();
    expect(changes).toBeGreaterThan(5);
    db.close();
  });
});
