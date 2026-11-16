// Golden files for the fact builder (PLAN WP 4.3). For 30 positions the engine's lines were
// searched once and stored (fixtures/golden/inputs.json), together with what the coach is handed
// for each (packets.json). This test builds every packet again from the stored inputs, with no
// engine, and compares.
//
// A failure here means the facts changed. If the change was meant:
//   node tools/make-golden.ts        prints every sentence that changed and rewrites packets.json
// Read what it prints before keeping it: this is everything the coach may say about 30 positions.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildFactPacket, plainText, type FactInput } from '../src/index.ts';
import { goldenView } from '../../../tools/make-golden.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const stored = JSON.parse(readFileSync(path.join(here, 'fixtures', 'golden', 'inputs.json'), 'utf8')) as { key: string; about: string; input: FactInput }[];
const golden = JSON.parse(readFileSync(path.join(here, 'fixtures', 'golden', 'packets.json'), 'utf8')) as Record<string, ReturnType<typeof goldenView>>;
// JSON drops what is undefined: compare like with like
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

describe('fact packets for 30 stored positions', () => {
  it('there are 30, each with its stored packet', () => {
    expect(stored).toHaveLength(30);
    expect(Object.keys(golden).sort()).toEqual(stored.map((s) => s.key).sort());
  });

  for (const s of stored) {
    it(`${s.key}: ${s.about}`, () => {
      expect(plain(goldenView(buildFactPacket(s.input)))).toEqual(golden[s.key]);
    });
  }
});

describe('what the stored packets say, checked by hand once', () => {
  const facts = (key: string) => golden[key]!.forCoach.facts as { id: string; type: string; text: string }[];
  const text = (key: string) => facts(key).map((f) => plainText(f.text)).join('\n');

  it("the owner's game: the hung queen is a mistake whoever is asked", () => {
    expect(golden.qe6!.lastVerdict).toMatchObject({ san: 'Qe6', by: 'opponent' });
    expect(['mistake', 'blunder']).toContain(golden.qe6!.lastVerdict!.cls);
    expect(text('qe6')).toMatch(/Their last move Qe6 was a mistake by them: you win a queen for a bishop/);
    expect(['mistake', 'blunder']).toContain(golden['qe6-own']!.graded!.cls);
    expect(text('qe6-own')).toMatch(/Your last move Qe6 was a mistake: you lose a queen for a bishop/);
    expect(text('qe6') + text('qe6-own')).not.toMatch(/Qe6 (was|is) (a )?good/);
  });

  it('no packet calls a move "safe" in a sentence that says it loses material or allows mate', () => {
    for (const s of stored) {
      for (const f of facts(s.key)) {
        const t = plainText(f.text);
        const firstSentence = t.split(/(?<=\.)\s/)[0]!;
        if (/\b(good, safe|is safe|It is safe)\b/.test(firstSentence)) expect(firstSentence, `${s.key} ${f.id}`).not.toMatch(/you lose|allows checkmate/);
      }
    }
  });

  it('the endgames the tablebases know are stated exactly', () => {
    expect(golden['kpk-draw']!.tablebase).toBe('draw');
    expect(golden['kpk-win']!.tablebase).toBe('you win');
    expect(golden.kqk!.tablebase).toBe('you win');
    expect(golden['krk-defender']!.tablebase).toBe('you lose');
    expect(golden.italian!.tablebase).toBeUndefined();
  });

  it('finished games are reported, not analysed', () => {
    expect(golden['fools-mate']!.over).toBe('checkmate');
    expect(golden.stalemate!.over).toBe('stalemate');
    expect(facts('fools-mate')).toHaveLength(1);
  });

  it('the mate threat and the mate in one are there to be cited', () => {
    expect(text('scholar')).toMatch(/Qxf7#/);
    expect(text('backrank')).toMatch(/Rd8#/);
  });
});
