import { describe, expect, it } from 'vitest';
import { Db } from '../src/db.ts';
import { LichessCloud, normaliseCloud } from '../src/lichess.ts';

const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
// recorded from lichess.org/api/cloud-eval on 2026-11-14 (trimmed)
const RECORDED = {
  fen: AFTER_NF3,
  knodes: 9319346,
  depth: 57,
  pvs: [
    { moves: 'b8c6 f1b5 g8f6 e1h1 f6e4', cp: 13 },
    { moves: 'g8f6 f3e5 d7d6', cp: 27 },
    { moves: 'd7d6 d2d4 e5d4', cp: 52 },
  ],
};

describe("Lichess's cloud analysis", () => {
  it("turns White-side scores into the side to move's, and castling into the king's move", () => {
    const e = normaliseCloud(AFTER_NF3, RECORDED)!;
    expect(e.depth).toBe(57);
    expect(e.lines.map((l) => l.score)).toEqual([{ cp: -13 }, { cp: -27 }, { cp: -52 }]); // Black to move
    expect(e.lines[0]!.pv).toEqual(['b8c6', 'f1b5', 'g8f6', 'e1g1', 'f6e4']); // e1h1 → e1g1, as Stockfish writes it
    const mate = normaliseCloud('8/8/3k4/8/8/2K5/6R1/8 w - - 0 1', { depth: 30, pvs: [{ moves: 'c3d4 d6e6', mate: 13 }] })!;
    expect(mate.lines[0]!.score).toEqual({ mate: 13 });
  });

  it('stops a line at a move that does not fit, and ignores empty answers', () => {
    const e = normaliseCloud(AFTER_NF3, { depth: 40, pvs: [{ moves: 'b8c6 e2e5 g8f6', cp: 10 }] })!;
    expect(e.lines[0]!.pv).toEqual(['b8c6']);
    expect(normaliseCloud(AFTER_NF3, { depth: 40, pvs: [] })).toBeNull();
  });

  it('asks once, caches answers and misses, and pauses after being told to slow down', async () => {
    const db = new Db(':memory:');
    const calls: string[] = [];
    let status = 200;
    const fakeFetch = async (url: string) => {
      calls.push(url);
      return { status, json: async () => RECORDED };
    };
    const cloud = new LichessCloud(db, { fetch: fakeFetch });
    const a = await cloud.evaluate(AFTER_NF3, 3);
    const b = await cloud.evaluate(AFTER_NF3, 3);
    expect(a?.depth).toBe(57);
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1); // the second answer came from the cache
    expect(calls[0]).toContain('/api/cloud-eval?fen=rnbqkbnr%2Fpppp1ppp');

    status = 404;
    const quiet = '8/8/8/4k3/8/8/3K4/7R w - - 0 1';
    expect(await cloud.evaluate(quiet, 3)).toBeNull();
    expect(await cloud.evaluate(quiet, 3)).toBeNull();
    expect(calls).toHaveLength(2); // a miss is remembered too

    status = 429;
    expect(await cloud.evaluate('8/8/8/4k3/8/8/2K5/7R w - - 0 1', 3)).toBeNull();
    status = 200;
    expect(await cloud.evaluate('8/8/8/4k3/8/8/1K6/7R w - - 0 1', 3)).toBeNull(); // paused: not even asked
    expect(calls).toHaveLength(3);
    db.close();
  });
});
