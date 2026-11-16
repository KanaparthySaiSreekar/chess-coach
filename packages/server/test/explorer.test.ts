import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { START_FEN, readExplorer, type RawExplorerAnswer } from '@chess-coach/core';
import { Db } from '../src/db.ts';
import { EXPLORER_KEEP_MS, LichessExplorer, explorerUrl, type ExplorerQuery } from '../src/explorer.ts';
import type { Http, HttpResponse } from '../src/importers.ts';

// PLAN WP 8.2: recorded answers as fixtures (explorer.lichess.org, 2026-11-15); no repeat calls for cached positions.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'explorer');
const recorded = (name: string) => readFileSync(path.join(dir, name), 'utf8');
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const level = (fen: string): ExplorerQuery => ({ db: 'lichess', fen, ratings: [0, 1000], speeds: ['rapid', 'classical', 'correspondence'] });

function fakeExplorer() {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  let status = 200;
  const answer = (code: number, body = ''): HttpResponse => ({ status: code, header: () => null, text: async () => body });
  const http: Http = async (url, headers = {}) => {
    calls.push({ url, headers });
    if (status !== 200) return answer(status);
    const u = new URL(url);
    const fen = u.searchParams.get('fen');
    if (u.host !== 'explorer.lichess.org') return answer(404);
    if (u.pathname === '/masters' && fen === START_FEN) return answer(200, recorded('masters-start.json'));
    if (u.pathname === '/lichess' && fen === START_FEN) return answer(200, recorded('lichess-start.json'));
    if (u.pathname === '/lichess' && fen === AFTER_E4) return answer(200, recorded('lichess-e4.json'));
    return answer(200, JSON.stringify({ white: 0, draws: 0, black: 0, moves: [] }));
  };
  return { http, calls, setStatus: (s: number) => (status = s) };
}

describe('the Lichess opening explorer (WP 8.2, D45)', () => {
  it('reads the recorded answers: the start at beginner level, after 1.e4, and the masters', () => {
    const start = readExplorer(START_FEN, JSON.parse(recorded('lichess-start.json')) as RawExplorerAnswer)!;
    expect(start.games).toBeGreaterThan(200_000_000);
    expect(start.rows[0]!.san).toBe('e4');
    expect(start.rows.map((r) => r.san)).toContain('d4');
    expect(start.rows.every((r) => r.result && r.result.white + r.result.draws + r.result.black === 100)).toBe(true);
    const e4 = readExplorer(AFTER_E4, JSON.parse(recorded('lichess-e4.json')) as RawExplorerAnswer)!;
    expect(e4.rows.slice(0, 3).map((r) => r.san)).toEqual(['e5', 'd5', 'e6']);
    expect(e4.opening?.name).toBe("King's Pawn Game");
    const masters = readExplorer(START_FEN, JSON.parse(recorded('masters-start.json')) as RawExplorerAnswer)!;
    expect(masters.rows.slice(0, 2).map((r) => r.san)).toEqual(['e4', 'd4']);
    expect(masters.games).toBeLessThan(start.games);
  });

  it('sends the token only in the header, asks for the right filters, and never asks twice for a kept position (even after a restart)', async () => {
    const db = new Db(':memory:');
    const site = fakeExplorer();
    const ex = new LichessExplorer({ db, http: site.http, token: () => 'secret-token', gapMs: 0 });
    const a = await ex.ask(level(START_FEN));
    expect(a.ok && !a.cached).toBe(true);
    expect(site.calls).toHaveLength(1);
    expect(site.calls[0]!.headers.Authorization).toBe('Bearer secret-token');
    expect(site.calls[0]!.url).not.toContain('secret-token');
    const u = new URL(site.calls[0]!.url);
    expect([u.host, u.pathname, u.searchParams.get('ratings'), u.searchParams.get('speeds'), u.searchParams.get('variant')]).toEqual(['explorer.lichess.org', '/lichess', '0,1000', 'rapid,classical,correspondence', 'standard']);
    // the same position again, and with other move counters: from the database
    const b = await ex.ask(level(START_FEN));
    expect(b.ok && b.cached).toBe(true);
    await ex.ask(level(START_FEN.replace(' 0 1', ' 0 7')));
    expect(site.calls).toHaveLength(1);
    expect(ex.cached(level(START_FEN))?.moves[0]?.san).toBe('e4');
    // another explorer on the same database (the app restarted): still no call
    const again = new LichessExplorer({ db, http: site.http, token: () => 'secret-token', gapMs: 0 });
    expect((await again.ask(level(START_FEN))).ok).toBe(true);
    expect(site.calls).toHaveLength(1);
    // other filters are another question; the masters too
    await ex.ask({ ...level(START_FEN), ratings: [1400] });
    await ex.ask({ db: 'masters', fen: START_FEN, ratings: [], speeds: [] });
    expect(site.calls.map((c) => new URL(c.url).pathname)).toEqual(['/lichess', '/lichess', '/masters']);
    expect(explorerUrl({ db: 'masters', fen: START_FEN, ratings: [], speeds: [] })).not.toContain('ratings');
    db.close();
  });

  it('no token: no call at all; a refused token and an unreachable site are told apart', async () => {
    const db = new Db(':memory:');
    const site = fakeExplorer();
    let token: string | undefined;
    const ex = new LichessExplorer({ db, http: site.http, token: () => token, gapMs: 0 });
    expect(await ex.ask(level(START_FEN))).toEqual({ ok: false, why: 'no-token' });
    expect(site.calls).toHaveLength(0);
    token = 'revoked';
    site.setStatus(401);
    expect(await ex.ask(level(START_FEN))).toEqual({ ok: false, why: 'bad-token' });
    site.setStatus(503);
    expect(await ex.ask(level(START_FEN))).toEqual({ ok: false, why: 'unavailable' });
    db.close();
  });

  it('after a 429 it waits a full minute: nothing is sent meanwhile; an old kept answer is used rather than nothing', async () => {
    const db = new Db(':memory:');
    const site = fakeExplorer();
    // the real clock: what is kept is stamped with it
    let now = Date.now();
    const ex = new LichessExplorer({ db, http: site.http, token: () => 't', gapMs: 0, now: () => now });
    expect((await ex.ask(level(START_FEN))).ok).toBe(true); // kept
    site.setStatus(429);
    expect(await ex.ask(level(AFTER_E4))).toEqual({ ok: false, why: 'slow-down' });
    expect(await ex.ask(level(AFTER_E4))).toEqual({ ok: false, why: 'slow-down' }); // paused: not even sent
    expect(site.calls).toHaveLength(2);
    // a month later the kept answer is old, and Lichess refuses again: the old answer is shown rather than nothing
    now += EXPLORER_KEEP_MS + 60_000;
    expect(ex.cached(level(START_FEN))).toBeUndefined();
    site.setStatus(429);
    const old = await ex.ask(level(START_FEN));
    expect(old.ok && old.cached).toBe(true);
    // the pause over, the site answering again: the old answer is replaced
    now += 61_000;
    site.setStatus(200);
    const fresh = await ex.ask(level(START_FEN));
    expect(fresh.ok && !fresh.cached).toBe(true);
    expect(ex.stats.refused).toBe(2);
    db.close();
  });

  it('one call at a time, three seconds apart: clicking through moves asks only for the newest position', async () => {
    const db = new Db(':memory:');
    const site = fakeExplorer();
    const ex = new LichessExplorer({ db, http: site.http, token: () => 't', gapMs: 120 });
    const t0 = Date.now();
    const first = ex.ask(level(START_FEN)); // sent at once
    const second = ex.ask(level(AFTER_E4)); // waits for its turn…
    const secondAgain = ex.ask(level(AFTER_E4)); // …the same position shares the wait
    const third = ex.ask(level('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2')); // …and is overtaken
    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: false, why: 'superseded' });
    expect(await secondAgain).toEqual({ ok: false, why: 'superseded' });
    expect((await third).ok).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    expect(site.calls).toHaveLength(2); // the start, then the newest
    expect(ex.stats.superseded).toBe(1);
    db.close();
  });

  it("a repertoire's gates ask in a batch: every position in order, never dropped, after the panel's newest, and through a pause", async () => {
    const db = new Db(':memory:');
    const site = fakeExplorer();
    let now = 0;
    const ex = new LichessExplorer({ db, http: site.http, token: () => 't', gapMs: 0, now: () => now });
    const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const batch = [ex.ask(level(START_FEN), { batch: true }), ex.ask(level(AFTER_E4), { batch: true }), ex.ask(level(AFTER_E4_E5), { batch: true })];
    const panel = ex.ask(level('rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1')); // the owner clicks meanwhile
    const answers = await Promise.all([...batch, panel]);
    expect(answers.every((a) => a.ok)).toBe(true);
    // the first batch call was already on its way; then the panel's, then the rest of the batch in order
    expect(site.calls.map((c) => new URL(c.url).searchParams.get('fen'))).toEqual([START_FEN, 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1', AFTER_E4, AFTER_E4_E5]);
    // a 429 pauses everyone; a batch ask waits the minute out instead of giving up
    site.setStatus(429);
    expect((await ex.ask(level('8/8/8/4k3/8/4K3/4P3/8 w - - 0 1'))).ok).toBe(false);
    site.setStatus(200);
    vi.useFakeTimers();
    try {
      const waiting = ex.ask(level('8/8/8/4k3/8/4K3/4P3/8 b - - 0 1'), { batch: true });
      expect(await ex.ask(level('8/8/8/3k4/8/4K3/4P3/8 w - - 0 1'))).toEqual({ ok: false, why: 'slow-down' }); // the panel gives up at once
      expect(site.calls).toHaveLength(5); // the batch ask has not been sent during the pause
      now += 61_000;
      await vi.advanceTimersByTimeAsync(61_000);
      expect((await waiting).ok).toBe(true);
      expect(site.calls).toHaveLength(6);
    } finally {
      vi.useRealTimers();
    }
    ex.stop();
    db.close();
  });
});
