// The scripted fallback's sentences are content (coach/templates/analysis.json; COACH §7, A11).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { START_FEN, buildFactPacket, playLine } from '@chess-coach/core';
import { loadTemplates, scripted } from '../src/coach/fallback.ts';
import { config } from '../src/config.ts';

const file = path.join(config.repoRoot, 'coach', 'templates', 'analysis.json');
const templates = loadTemplates(file);
// the black queen attacks the undefended knight on e5: no engine is needed to see that
const fen = (() => {
  const r = playLine(START_FEN, 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4'.split(' '));
  if (!r.ok) throw new Error('setup');
  return r.fens.at(-1)!;
})();
const packet = buildFactPacket({ id: 'T', fen, you: 'white' });

describe('the scripted fallback', () => {
  it('reads every sentence it needs from the templates file', () => {
    expect(Object.keys(templates).sort()).toEqual(['hint.arrow', 'hint.captures', 'hint.nudge.danger', 'hint.nudge.improve', 'hint.nudge.piece', 'hint.question.loose', 'hint.question.routine', 'hint.question.threat', 'over', 'quiet']);
  });

  it('refuses a templates file with a sentence missing, naming it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cc-tpl-'));
    const broken = path.join(dir, 't.json');
    writeFileSync(broken, JSON.stringify({ ...templates, 'hint.arrow': '' }));
    expect(() => loadTemplates(broken)).toThrow(/no sentence for "hint\.arrow"/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('climbs the hint ladder with those sentences: a question, then the piece, then the arrow', () => {
    const question = scripted('hint', packet, 0, templates);
    expect(question.kind).toBe('question');
    expect([templates['hint.question.threat'], templates['hint.question.loose'], templates['hint.question.routine']]).toContain(question.text);
    const nudge = scripted('hint', packet, 1, templates);
    expect(nudge).toMatchObject({ kind: 'nudge', text: 'Look at the knight on {sq:e5}.' });
    const arrow = scripted('hint', packet, 2, templates);
    expect(arrow.text).toBe(templates['hint.arrow']);
    expect(arrow.shapes).toEqual([{ from: 'd4', to: 'e5', style: 'threat' }]);
  });

  it('uses the wording of the file, whatever it is', () => {
    const mine = { ...templates, 'hint.nudge.piece': 'Have a look at your {role} ({square}).' };
    expect(scripted('hint', packet, 1, mine).text).toBe('Have a look at your knight ({sq:e5}).');
  });
});
