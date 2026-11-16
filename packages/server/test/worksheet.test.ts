// Which lines' words are on the worksheet (WP 8.6, 8.13): a line held back only by its words comes back on it.
import { describe, expect, it } from 'vitest';
import { hasWordsToWrite } from '../src/repertoire.ts';

const pass = (gate: string) => ({ gate, result: 'pass' });
const fail = (gate: string) => ({ gate, result: 'fail' });

describe('hasWordsToWrite', () => {
  it('takes every line still in, and one the owner kept with a note', () => {
    expect(hasWordsToWrite({ status: 'machine-verified', gates: [pass('V1'), pass('V3')] })).toBe(true);
    expect(hasWordsToWrite({ status: 'live', gates: [] })).toBe(true);
    expect(hasWordsToWrite({ status: 'quarantined', note: 'kept: I want this line', gates: [fail('V2')] })).toBe(true);
  });

  it('takes a line held back only by its words, so they can be rewritten', () => {
    expect(hasWordsToWrite({ status: 'quarantined', gates: [pass('V1'), pass('V2'), fail('V3'), pass('V4')] })).toBe(true);
  });

  it('leaves out a line held back for its moves, with or without its words', () => {
    expect(hasWordsToWrite({ status: 'quarantined', gates: [fail('V2'), pass('V3')] })).toBe(false);
    expect(hasWordsToWrite({ status: 'quarantined', gates: [fail('V2'), fail('V3')] })).toBe(false);
    expect(hasWordsToWrite({ status: 'quarantined', gates: [fail('V4')] })).toBe(false);
  });
});
