import { describe, expect, it } from 'vitest';
import { Db } from '../src/db.ts';
import { basisChanges, becauseText, storeBasis, storedBasis, type GateBasis } from '../src/revalidate.ts';

// PLAN WP 8.11: what the engine checks ran with, and what changed, in words.
const base: GateBasis = { engine: 'Stockfish 19#2497913', nodes: 5_000_000, secondNodes: 20_000_000, maxDrop: 4, thresholds: { inaccuracy: 10, mistake: 20, blunder: 30 } };

describe('re-validation: the basis of the checks (WP 8.11)', () => {
  it('says what changed, in words; nothing when nothing did, or when nothing was stored before', () => {
    expect(basisChanges(base, base)).toEqual([]);
    expect(basisChanges(undefined, base)).toEqual([]);
    expect(basisChanges(base, { ...base, engine: 'Stockfish 20#3100000', nodes: 2_000_000, thresholds: { ...base.thresholds, mistake: 15 } })).toEqual([
      'the engine (Stockfish 19#2497913 → Stockfish 20#3100000)',
      'the search that checks content (5,000,000 → 2,000,000 nodes)',
      'the mistake threshold (20 → 15)',
    ]);
    expect(becauseText(['the second opinion\'s search (20,000,000 → 10,000,000 nodes)'])).toBe("re-checked after a change of the second opinion's search (20,000,000 → 10,000,000 nodes)");
    expect(becauseText([])).toBeUndefined();
  });

  it('remembers the basis in the database', () => {
    const db = new Db(':memory:');
    expect(storedBasis(db)).toBeUndefined();
    storeBasis(db, base);
    expect(storedBasis(db)).toEqual(base);
    db.close();
  });
});
