import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { legalMoves, lineText, mustPosition, playLine, type RepLine, type ServerMsg } from '@chess-coach/core';
import { App } from '../src/app.ts';
import type { MoveSource } from '../src/bots/service.ts';
import { config } from '../src/config.ts';
import type { RepertoireReport } from '../src/repertoire.ts';
import { fakeSites } from './fake-sites.ts';

// PLAN WP 8.7, the test that says it is done: repertoires come in from fixtures (a Lichess study
// export, the same PGN pasted, and one of the owner's studies) and go through the gates line by line.
const BLACK = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repertoire-black.pgn'), 'utf8');
const EXPECTED = ['1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5', '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6', '1.e4 e5 2.Nf3 Nc6 3.d4 exd4', '1.d4 d5 2.c4 e6', '1.d4 d5 2.Nf3 Nf6'];
// Maia stands in for the explorer where the recorded answers stop: here, the first legal move, always
const firstMove: MoveSource = {
  state: 'ready',
  probabilities: async (req) => {
    const r = playLine(req.startFen, req.moves);
    if (!r.ok) throw new Error('bad history');
    return [{ uci: legalMoves(mustPosition(r.fens.at(-1)!))[0]!.uci, p: 1 }];
  },
  stop: () => {},
};

describe('importing a repertoire (WP 8.7)', () => {
  let dir: string;
  let app: App;
  const toasts: string[] = [];
  const client = { send: (m: ServerMsg) => void (m.type === 'toast' && toasts.push(m.text)) };
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-import-'));
    app = new App({ repoRoot: config.repoRoot, dataDir: dir, stockfish: config.stockfish, syzygy: config.syzygy, claudePath: 'unused', openingsDir: config.openingsDir, mcpUrl: 'http://127.0.0.1:1/mcp', cloud: null, sites: fakeSites().http, lichessToken: () => 'test-token', botSource: firstMove });
    app.engine.signature = 'test';
    app.addClient(client);
    // smaller budgets than the app's; the gates are the app's
    app.settings.set('content.gateNodes', 1_000_000);
    app.settings.set('repertoire.secondNodes', 2_000_000);
  });
  afterAll(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Ask for an import the way the page does, and wait for its report. */
  const importAndWait = async (msg: { text?: string; study?: number; name: string }): Promise<RepertoireReport> => {
    const before = app.db.repertoires().length;
    await app.onClientMessage(client, { type: 'content', action: 'import', colour: 'black', ...msg });
    await expect.poll(() => app.db.repertoires().length, { timeout: 5_000 }).toBe(before + 1);
    const id = app.db.repertoires().at(-1)!.id;
    await expect.poll(() => !!app.repertoires.report(id), { timeout: 240_000, interval: 500 }).toBe(true);
    return app.repertoires.report(id)!;
  };

  it('a Lichess study by its link: the chapters for Black, the other side left out with the reason, a line held twice kept once, every line through the gates', async () => {
    const r = await importAndWait({ text: 'https://lichess.org/study/RepStud1', name: 'Black from Lichess' });
    const lines = app.db.repertoireItems<RepLine>(r.id);
    expect(lines.map((l) => lineText(l.body.startFen, l.body.moves))).toEqual(EXPECTED);
    expect(r.skipped).toEqual([{ chapter: "White's notes", reason: 'the chapter is for White; this repertoire is for Black' }]);
    expect(r.duplicates).toBe(1);
    expect(r.quarantined).toBe(0);
    expect(lines.every((l) => l.status === 'machine-verified' && l.licence === 'private' && l.source === 'https://lichess.org/study/RepStud1')).toBe(true);
    expect(lines[0]!.body.notes).toEqual({ 1: 'Share the centre.' });
    expect(toasts.at(-1)).toMatch(/Black from Lichess: 5 lines, 0 in quarantine, 1 chapter left out, 1 line already held by another\./);
  }, 300_000);

  it('the same PGN pasted, and one of the owner own studies: the same lines; a PGN with nothing for that side is refused at once', async () => {
    const pasted = await importAndWait({ text: BLACK, name: 'Black pasted' });
    expect(app.db.repertoireItems<RepLine>(pasted.id).map((l) => lineText(l.body.startFen, l.body.moves))).toEqual(EXPECTED);
    expect(app.db.repertoire(pasted.id)!.source).toMatch(/^pasted:\d{4}-\d{2}-\d{2}$/);
    // one of the owner's studies (WP 8.1) as a repertoire
    const added = await app.studies.importText(BLACK);
    if (!added.ok) throw new Error(added.reason);
    const fromStudy = await importAndWait({ study: added.study, name: '' });
    expect(fromStudy.name).toBe('Black repertoire');
    expect(app.db.repertoire(fromStudy.id)!.source).toBe(`study:${added.study}`);
    expect(app.db.repertoireItems<RepLine>(fromStudy.id).map((l) => lineText(l.body.startFen, l.body.moves))).toEqual(EXPECTED);
    // only White's chapter: nothing for Black, said at once, nothing stored
    const count = app.db.repertoires().length;
    await app.onClientMessage(client, { type: 'content', action: 'import', colour: 'black', name: 'x', text: '[Orientation "white"]\n\n1. e4 e5 *' });
    expect(toasts.at(-1)).toMatch(/^No lines for Black in it: Chapter 1: the chapter is for White/);
    expect(app.db.repertoires().length).toBe(count);
  }, 600_000);
});
