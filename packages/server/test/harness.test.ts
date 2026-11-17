// The playbook harness's own checks (COACH §9, PLAN WP 4.10): the scenarios are well-formed, and
// the scoring code says what it should about a recorded run. The runs themselves use the plan and
// are started by hand (tools/coach-harness.ts).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { START_FEN, type CoachMessage } from '@chess-coach/core';
import { judge, lintScenarios, scenarioStart, summarise, type Scenario, type ScenarioResult, type Transcript } from '../src/coach/harness.ts';
import { config } from '../src/config.ts';

const scenarios = JSON.parse(readFileSync(path.join(config.repoRoot, 'coach', 'fixtures', 'coach-analysis', 'scenarios.json'), 'utf8')) as Scenario[];
const budget = { short: 2, explain: 4 };
const msg = (kind: string, text: string, source: 'coach' | 'scripted' = 'coach'): CoachMessage => ({ id: 1, at: '', seq: 1, from: 'coach', source, kind: kind as CoachMessage['kind'], text, segments: [] });
const run = (over: Partial<Transcript>): Transcript => ({ messages: [], says: [], tools: [], ms: 1000, timedOut: false, ...over });
const failed = (s: Scenario, t: Transcript) => judge(s, t, budget).filter((o) => !o.pass).map((o) => o.check);
const base: Scenario = { id: 'x', about: 'x', covers: 'explains from facts', side: 'white', moves: 'e4 e5', steps: [{ ask: 'q' }], checks: [] };

describe('the scenarios for coach-spar', () => {
  it('are ten games against a scripted bot, one of them "never suggests a move unasked" (PLAN 7.7)', () => {
    const spar = JSON.parse(readFileSync(path.join(config.repoRoot, 'coach', 'fixtures', 'coach-spar', 'scenarios.json'), 'utf8')) as Scenario[];
    expect(spar).toHaveLength(10);
    expect(lintScenarios(spar)).toEqual([]);
    expect(spar.every((s) => !!s.spar)).toBe(true);
    expect(spar.find((s) => s.id === 'never-suggests')!.covers).toBe('hard rules');
    expect(lintScenarios([{ ...base, id: 'loose', steps: [{ gmove: 'e2e4' }], checks: [{ type: 'silent' }] }])).toEqual(['loose: a game step needs a spar scenario']);
  });
});

describe('the scenarios for coach-drill', () => {
  it('are twelve, each with a legal puzzle or drill, and a puzzle step needs a puzzle (PLAN 6.11, D105)', () => {
    const drill = JSON.parse(readFileSync(path.join(config.repoRoot, 'coach', 'fixtures', 'coach-drill', 'scenarios.json'), 'utf8')) as Scenario[];
    expect(drill).toHaveLength(12);
    expect(lintScenarios(drill)).toEqual([]);
    expect(drill.every((s) => (s.puzzle || s.drill) && scenarioStart(s).ok)).toBe(true);
    // the other drills (D105): the safety check and a won game, asked while they are open
    expect(drill.filter((s) => s.drill).map((s) => s.drill!.kind).sort()).toEqual(['convert', 'safety']);
    expect(lintScenarios([{ ...base, id: 'turn', drill: { kind: 'convert', body: { fen: '4k3/8/2n5/8/8/8/8/3QK3 w - - 0 1' } }, side: 'black', steps: [{ ask: 'What now?' }], checks: [{ type: 'replies' }] }])).toEqual(["turn: the drill's position is not the owner's move"]);
    expect(lintScenarios([{ ...base, id: 'drillmove', drill: { kind: 'safety', body: { fen: START_FEN } }, side: 'white', steps: [{ move: 'e2e4' }], checks: [{ type: 'replies' }] }])).toEqual(['drillmove: a drill scenario\'s steps are questions ("ask") and waits']);
    for (const line of ['hard rules', 'asks before telling', 'quiet when it should be', 'explains from facts']) expect(new Set(drill.map((s) => s.covers)), line).toContain(line);
    const first = drill[0]!;
    expect(lintScenarios([{ ...first, id: 'bad', puzzle: { ...first.puzzle!, solution: ['Rd9'] } }])).toEqual(["bad: the puzzle's move Rd9 is not legal"]);
    expect(lintScenarios([{ ...base, id: 'loose', steps: [{ puzzle: 'ask' }], checks: [{ type: 'silent' }] }])).toEqual(['loose: a puzzle step needs a puzzle scenario']);
  });
});

describe('the scenarios for coach-analysis', () => {
  it('are 30, each with a legal position, steps and valid checks (PLAN 4.10)', () => {
    expect(scenarios).toHaveLength(30);
    expect(lintScenarios(scenarios)).toEqual([]);
    for (const s of scenarios) expect(scenarioStart(s).ok, s.id).toBe(true);
  });

  it('cover every line of the table in COACH §9', () => {
    const covers = new Set(scenarios.map((s) => s.covers));
    for (const line of ['hard rules', 'asks before telling', 'uses the tag', 'quiet when it should be', 'fair play']) expect(covers, line).toContain(line);
    // the owner's report is one of them: a queen hung in a lost position must be called a mistake
    expect(scenarios.find((s) => s.id === 'qe6-label')!.checks).toContainEqual({ type: 'says', pattern: 'mistake' });
  });

  it('a broken scenario is reported, not run', () => {
    expect(lintScenarios([{ ...base, moves: 'e4 e5 Ke3', checks: [{ type: 'replies' }] }])).toEqual(['x: illegal move Ke3']);
    expect(lintScenarios([base])).toEqual(['x: no checks']);
    expect(lintScenarios([{ ...base, checks: [{ type: 'says', pattern: '(' }] }])).toEqual(['x: /(/ is not a valid pattern']);
    expect(lintScenarios([{ ...base, checks: [{ type: 'replies' }] }, { ...base, checks: [{ type: 'replies' }] }])).toEqual(['x: used twice']);
    expect(lintScenarios([{ ...base, steps: [{ move: 'Nf3' }], checks: [{ type: 'replies' }] }])[0]).toMatch(/a move step must be like/);
  });
});

describe('scoring a recorded run', () => {
  it('hard rules: a message the validator refused must not be on the page', () => {
    const text = 'Play {m:Qh5}: it wins a rook.';
    const leaked = run({ messages: [msg('explain', 'Play Qh5: it wins a rook.')], says: [{ kind: 'explain', text, ok: false }] });
    expect(failed(base, leaked)).toContain('hard rules: only accepted messages reach the page');
    // the page shows plain words, the coach wrote tokens: they are the same message
    const fine = run({ messages: [msg('explain', 'Your knight Ne5 can be taken.')], says: [{ kind: 'explain', text: 'Your knight {pc:Ne5} can be taken.', ok: true, messageId: 1 }] });
    expect(failed(base, fine)).toEqual([]);
    // the scripted fallback is not the coach's say: it needs no accepted call
    expect(failed(base, run({ messages: [msg('explain', 'Your knight can be taken.', 'scripted')] }))).toEqual([]);
  });

  it('stays in budget: a question is short, an explanation may be longer', () => {
    // the app lets one sentence over through, so the same margin applies: a question may run to three
    const long = 'One. Two. Three. Four.';
    const ok = [{ kind: 'x', text: long, ok: true, messageId: 1 }];
    expect(failed(base, run({ messages: [msg('question', long)], says: ok }))).toContain('stays in budget');
    expect(failed(base, run({ messages: [msg('explain', long)], says: ok }))).toEqual([]);
    expect(failed(base, run({ messages: [msg('question', 'One. Two. Three.')], says: [{ kind: 'x', text: 'One. Two. Three.', ok: true, messageId: 1 }] }))).toEqual([]);
  });

  it('asks before telling, and never names the move it must not give', () => {
    const s: Scenario = { ...base, checks: [{ type: 'firstIs', kinds: ['question', 'nudge'] }, { type: 'never', pattern: '\\bNg4\\b' }] };
    const told = run({ messages: [msg('answer', 'Play {m:Ng4}.')], says: [{ kind: 'answer', text: 'Play {m:Ng4}.', ok: true, messageId: 1 }] });
    expect(failed(s, told)).toEqual(['first message is question or nudge', 'never says /\\bNg4\\b/']);
    const asked = run({ messages: [msg('question', 'What does their queen attack?')], says: [{ kind: 'question', text: 'What does their queen attack?', ok: true, messageId: 1 }] });
    expect(failed(s, asked)).toEqual([]);
  });

  it('quiet when it should be, replies when it should, and the scripted fallback only counts when allowed', () => {
    expect(failed({ ...base, checks: [{ type: 'silent' }] }, run({}))).toEqual([]);
    expect(failed({ ...base, checks: [{ type: 'silent' }] }, run({ messages: [msg('explain', 'Hello.', 'scripted')] }))).toEqual(['quiet when it should be']);
    const scripted = run({ messages: [msg('explain', 'Your knight can be taken.', 'scripted')] });
    expect(failed({ ...base, checks: [{ type: 'replies' }] }, scripted)).toEqual(['replies']);
    expect(failed({ ...base, checks: [{ type: 'replies', scripted: true }] }, scripted)).toEqual([]);
    expect(failed({ ...base, checks: [{ type: 'replies' }] }, run({}))).toEqual(['replies']);
  });

  it('tool calls: the right tool with the right arguments, and none where none is allowed', () => {
    const t = run({ tools: [{ name: 'play_line', args: { what: 'move', move: 'Nxe5' }, ok: true }, { name: 'say', args: {}, ok: true }] });
    expect(failed({ ...base, checks: [{ type: 'tool', name: 'play_line', args: { move: 'Nxe5' } }] }, t)).toEqual([]);
    expect(failed({ ...base, checks: [{ type: 'tool', name: 'play_line', args: { what: 'threat' } }] }, t)).toHaveLength(1);
    expect(failed({ ...base, checks: [{ type: 'noTool', name: 'play_line' }] }, t)).toEqual(['does not call play_line']);
    expect(failed({ ...base, checks: [{ type: 'noTool', name: 'check_move' }] }, t)).toEqual([]);
  });

  it('a run that did not finish in time fails, and says so', () => {
    expect(failed(base, run({ timedOut: true }))).toEqual(['answers in time']);
  });

  it('adds a run up: scenarios passed, first-try validity against its bar, and each line of the table', () => {
    const r = (id: string, pass: boolean, ok: number, total: number, covers = 'hard rules'): ScenarioResult => ({ id, covers, pass, outcomes: [{ check: 'hard rules: only accepted messages reach the page', pass: true }, { check: 'stays in budget', pass }], ms: 4000, says: { ok, total }, messages: [], tools: [] });
    const s = summarise([r('a', true, 2, 2), r('b', false, 1, 2, 'fair play'), r('c', true, 3, 3)]);
    expect(s.scenarios).toEqual({ pass: 2, total: 3 });
    expect(s.firstTryValidity).toMatchObject({ ok: 6, total: 7, pct: 85.7, bar: 85 });
    expect(s.byCheck['hard rules']).toEqual({ pass: 3, total: 3 });
    expect(s.byCheck['stays in budget']).toEqual({ pass: 2, total: 3 });
    expect(s.byCovers['fair play']).toEqual({ pass: 0, total: 1 });
    expect(s.failed).toEqual([{ id: 'b', why: ['stays in budget'] }]);
  });
});
