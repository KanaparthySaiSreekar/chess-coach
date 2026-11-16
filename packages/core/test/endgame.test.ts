import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RANDOM_TOPIC, endgameTask, gateV8Endgame, keepsGoal, parsePosition, randomStart, readEndgame, verdictOf, type EndgameFile } from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(readFileSync(path.join(here, '..', '..', '..', 'content', 'endgames.json'), 'utf8')) as EndgameFile;
const topics = pack.topics;

describe('endgame training (F2)', () => {
  it('reads the verdict for the side to move from the score: a tablebase win or a mate, a draw, or not clear', () => {
    expect(verdictOf({ mate: 3 })).toBe('win');
    expect(verdictOf({ mate: -1 })).toBe('loss');
    // Stockfish reports a tablebase win as about 20000 less the distance
    expect(verdictOf({ cp: 19_980 })).toBe('win');
    expect(verdictOf({ cp: -19_975 })).toBe('loss');
    expect(verdictOf({ cp: 0 })).toBe('draw');
    expect(verdictOf({ cp: 120 })).toBe('unclear');
  });

  it('a draw is kept unless they win; a win only while they lose', () => {
    expect(keepsGoal('draw', 'draw')).toBe(true);
    expect(keepsGoal('draw', 'unclear')).toBe(true);
    expect(keepsGoal('draw', 'win')).toBe(false);
    expect(keepsGoal('mate', 'loss')).toBe(true);
    expect(keepsGoal('mate', 'draw')).toBe(false);
    expect(keepsGoal('promote', 'unclear')).toBe(false);
  });

  it('says what to do in words', () => {
    expect(endgameTask('mate', 'white')).toBe('White to play: give mate.');
    expect(endgameTask('draw', 'black')).toBe('Black to play: hold the draw.');
    expect(endgameTask('promote', 'white')).toBe('White to play: queen the pawn and keep the win.');
  });

  it('every position of the pack passes V1 and V8: legal, few enough pieces, a known topic, a short idea', () => {
    expect(pack.positions.length).toBeGreaterThanOrEqual(12);
    for (const [i, p] of pack.positions.entries()) {
      const r = readEndgame(p, topics, i);
      expect(r, p.id).toMatchObject({ ok: true });
      if (!r.ok) continue;
      expect(gateV8Endgame(r.item, '400–700', pack), p.id).toEqual({ gate: 'V8', result: 'pass' });
    }
    // the side to move is read from the position: Black defends the square and Philidor
    const sq = readEndgame(pack.positions.find((p) => p.id === 'sq-catch')!, topics, 0);
    expect(sq.ok && sq.item.side).toBe('black');
    // ids are unique, and every topic has positions
    expect(new Set(pack.positions.map((p) => p.id)).size).toBe(pack.positions.length);
    for (const t of topics) expect(pack.positions.some((p) => p.topic === t.id), t.id).toBe(true);
  });

  it('V1 refuses a position the tablebases cannot judge, an illegal one, one already over, or an unknown topic or goal', () => {
    const base = { id: 'x-test', topic: 'queen-mate', name: 'x', goal: 'mate' as const };
    expect(readEndgame({ ...base, fen: 'k7/8/1K6/2Q5/8/8/8/8 w - - 0 1' }, topics, 0)).toMatchObject({ ok: true });
    expect(readEndgame({ ...base, fen: 'k7/pp6/1K6/2Q5/8/8/8/R7 w - - 0 1' }, topics, 0)).toMatchObject({ ok: false, reason: expect.stringContaining('6 pieces') });
    expect(readEndgame({ ...base, fen: 'k7/8/1K6/2Q5/8/8/8/8 x - - 0 1' }, topics, 0)).toMatchObject({ ok: false, reason: 'the position is not legal' });
    // stalemate already
    expect(readEndgame({ ...base, fen: 'k7/2Q5/1K6/8/8/8/8/8 b - - 0 1' }, topics, 0)).toMatchObject({ ok: false, reason: expect.stringContaining('already over') });
    expect(readEndgame({ ...base, topic: 'nope', fen: 'k7/8/1K6/2Q5/8/8/8/8 w - - 0 1' }, topics, 0)).toMatchObject({ ok: false, reason: 'there is no topic "nope"' });
    expect(readEndgame({ ...base, goal: 'win' as never, fen: 'k7/8/1K6/2Q5/8/8/8/8 w - - 0 1' }, topics, 0)).toMatchObject({ ok: false });
    expect(readEndgame({ ...base, id: 'Bad Id', fen: 'k7/8/1K6/2Q5/8/8/8/8 w - - 0 1' }, topics, 0)).toMatchObject({ ok: false });
  });

  it('a random start for a basic mate: legal, their king in the middle and not in check, nothing next to it; the same seed, the same start', () => {
    const seeded = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    /** each piece's square, read from the FEN's placement: [file 0–7, rank 0–7] */
    const squares = (fen: string) => {
      const out: { p: string; f: number; r: number }[] = [];
      fen.split(' ')[0]!.split('/').forEach((row, i) => {
        let f = 0;
        for (const ch of row) {
          if (/\d/.test(ch)) f += Number(ch);
          else out.push({ p: ch, f: f++, r: 7 - i });
        }
      });
      return out;
    };
    const dist = (a: { f: number; r: number }, b: { f: number; r: number }) => Math.max(Math.abs(a.f - b.f), Math.abs(a.r - b.r));
    const want = { queen: 'KQk', rook: 'KRk', 'two-rooks': 'KRRk' } as const;
    for (const kind of ['queen', 'rook', 'two-rooks'] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const fen = randomStart(kind, seeded(seed));
        const pos = parsePosition(fen);
        expect(pos, fen).not.toBeNull();
        expect(pos!.turn).toBe('white');
        const sq = squares(fen);
        expect(sq.map((x) => x.p).sort().join(''), fen).toBe([...want[kind]].sort().join(''));
        const bk = sq.find((x) => x.p === 'k')!;
        // their king on c3–f6
        expect(bk.f >= 2 && bk.f <= 5 && bk.r >= 2 && bk.r <= 5, fen).toBe(true);
        expect(dist(sq.find((x) => x.p === 'K')!, bk), fen).toBeGreaterThanOrEqual(3);
        for (const x of sq.filter((y) => y.p === 'Q' || y.p === 'R')) expect(dist(x, bk), fen).toBeGreaterThanOrEqual(2);
        expect(parsePosition(fen.replace(' w ', ' b '))!.isCheck(), fen).toBe(false);
        // V1 reads it as a position of its topic
        const topic = Object.entries(RANDOM_TOPIC).find(([, k]) => k === kind)![0];
        expect(readEndgame({ id: `random-${kind}`, topic, name: 'x', fen, goal: 'mate' }, topics, 0).ok).toBe(true);
      }
      expect(randomStart(kind, seeded(5))).toBe(randomStart(kind, seeded(5)));
    }
    // each mate topic of the pack offers random starts; the others do not
    expect(Object.keys(RANDOM_TOPIC).every((id) => topics.some((t) => t.id === id))).toBe(true);
    expect(RANDOM_TOPIC['square']).toBeUndefined();
  });

  it('V8 fails an idea of more than three sentences and a topic with a single position', () => {
    const one: EndgameFile = { topics, positions: [{ id: 'solo', topic: 'square', name: 'x', fen: '8/8/5k2/1P6/8/8/8/7K b - - 0 1', goal: 'draw', idea: 'One. Two. Three. Four.' }] };
    const r = readEndgame(one.positions[0]!, topics, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v8 = gateV8Endgame(r.item, '400–700', one);
    expect(v8.result).toBe('fail');
    expect(v8.detail).toContain('4 sentences');
    expect(v8.detail).toContain('only this position');
    expect(gateV8Endgame(r.item, undefined, pack).detail).toContain('level band');
  });
});
