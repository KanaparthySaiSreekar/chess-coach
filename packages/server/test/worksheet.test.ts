// Which lines' words are on the worksheet (WP 8.6, 8.13): a line held back only by its words comes back on it.
import { describe, expect, it } from 'vitest';
import { Db } from '../src/db.ts';
import { hasWordsToWrite } from '../src/repertoire.ts';

describe("who wrote a position's words (D13)", () => {
  it('is kept with the words, and stays when the words are written again without saying who', () => {
    const db = new Db(':memory:');
    const rep = db.addRepertoire({ name: 'R', colour: 'white', source: 'pasted:2026-11-17', licence: 'own', level: '400–700' });
    const at = { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', uci: 'g1f3', san: 'Nf3' };
    db.setRepText(rep, 'k', { ...at, why: '{m:Nf3} develops your knight.', by: 'facts' });
    expect(db.repTexts(rep).get('k')).toMatchObject({ why: '{m:Nf3} develops your knight.', by: 'facts' });
    db.setRepText(rep, 'k', { ...at, why: '{m:Nf3} develops your knight.' });
    expect(db.repTexts(rep).get('k')?.by).toBe('facts');
    db.setRepText(rep, 'k', { ...at, why: 'Mine.', by: 'owner' });
    expect(db.repTexts(rep).get('k')?.by).toBe('owner');
  });
});

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
