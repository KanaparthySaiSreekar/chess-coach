// The playbook harness (COACH §9, feature H17): scenarios for a coach agent, and the checks that
// score what it did. The checks are plain code: no model judges another model.
//
// A scenario sets up a position, does what the owner would do (ask, press a chip, move a piece,
// draw an arrow), and says what must be true of the coach's answer. `judge` scores a recorded
// run. The runner that starts the real coach is tools/coach-harness.ts; it uses the plan, so it
// runs on demand, not with the other tests.

import { lineSteps, parsePosition, playLine, plainText, repertoireLines, splitSentences, START_FEN, type Chip, type CoachMessage, type Color, type SayKind, type SettingValue } from '@chess-coach/core';

export type Step =
  | { ask: string }
  | { chip: Chip }
  /** the owner moves a piece on the board that is showing: "g5e6" */
  | { move: string }
  /** the owner draws on the board: an arrow (from and to) or a circle (from only) */
  | { draw: { from: string; to?: string }[] }
  /** the owner steps the coach's board back to its first position */
  | { demo: 'base' }
  /** going through the key moments of the game (a `game` scenario): start, go on to the next moment, stop */
  | { replay: 'start' | 'next' | 'stop' }
  /** on the puzzle board (a `puzzle` scenario): a move ("h2h3"), "Ask the coach", the answer, the worked example, the next puzzle */
  | { pmove: string }
  | { puzzle: 'ask' | 'show' | 'example' | 'next' }
  /** in a game against a bot (a `spar` scenario): the owner's move ("e2e4"), "Ask the coach", resigning, taking the offer back */
  | { gmove: string }
  | { game: 'ask' | 'resign' | 'take_offer' }
  /** in the opening drill (an `opening` scenario): a move on the drill board ("g1f3"), the owner's words for the why, whether they had the idea */
  | { omove: string }
  | { owhy: string }
  | { oknown: boolean }
  /** the opening card put on the board again (with the coach on: a new card wakes it) */
  | { oshow: true }
  /** on the Openings tab's Repertoire view: the owner walks the scenario's repertoire to these moves ("e2e4 e7e5"; "" for the start), then asks with `ask` (D12) */
  | { owalk: string }
  /** on the Endgames tab (an `endgame` scenario): the owner's move ("c5c7", "a7a8q"), "Ask the coach", "Try that move again", stopping */
  | { emove: string }
  | { endgame: 'ask' | 'retry_before' | 'resign' }
  | { wait: number };

export type Check =
  /** the coach itself answered (not the scripted fallback, unless `scripted` allows it) */
  | { type: 'replies'; scripted?: boolean }
  /** nothing was said at all */
  | { type: 'silent' }
  /** the first message is of one of these kinds ("asks before telling": question or nudge) */
  | { type: 'firstIs'; kinds: SayKind[] }
  /** some message is of this kind */
  | { type: 'someKind'; kind: SayKind }
  /** some message matches (case ignored) */
  | { type: 'says'; pattern: string }
  /** no message matches (case ignored) */
  | { type: 'never'; pattern: string }
  /** a tool was called; `args` must all be found in the call's arguments (a string value is a pattern) */
  | { type: 'tool'; name: string; args?: Record<string, string> }
  | { type: 'noTool'; name: string };

export type Scenario = {
  id: string;
  about: string;
  /** which line of the table in COACH §9 this scenario is mainly there for */
  covers: 'hard rules' | 'asks before telling' | 'uses the tag' | 'quiet when it should be' | 'fair play' | 'board powers' | 'explains from facts' | 'stop rules';
  /** the side the owner plays */
  side: Color;
  /** SAN moves from the starting position, or a FEN */
  moves?: string;
  fen?: string;
  /**
   * The moves are a finished game of the owner's, with this result: it is put in the library, the
   * engine goes through it, and the steps can then `replay` its key moments (the review agent).
   */
  game?: '1-0' | '0-1' | '1/2-1/2';
  /**
   * A puzzle on the Puzzles tab (the drill coach): its position, the opponent's set-up move, the
   * solution, its themes; `set` is how it is practised (from the owner's games, or a mixed set
   * with the theme hidden). The side is the solver's.
   */
  puzzle?: { fen: string; setup?: string; solution: string[]; themes: string[]; set?: 'games' | 'mixed' };
  /** A game against a bot (the sparring coach): the bot's replies in turn (engine-style moves; its first legal move when one does not fit), or a mini-game by its id. The side is the owner's. */
  spar?: { bot: string[]; mini?: string };
  /**
   * The opening drill (the opening coach): a repertoire for the scenario's side (a PGN), the words
   * written for some of its positions (by the line that reaches the move, "1.e4 e5 2.Nf3"), and the
   * card in hand: the `card`-th position of mine along the first line (0 = the first), new (shown)
   * or `due` (asked).
   */
  opening?: { pgn: string; words?: { line: string; why?: string; idea?: string }[]; card: number; due?: boolean; trap?: string };
  /** The Endgames tab (the endgame coach): a position of content/endgames.json by its id. The side is the owner's (the position's side to move). */
  endgame?: { position: string };
  /**
   * One of the other drills on the Puzzles tab (the drill coach, D105): the safety check or a won game
   * played out, with its item as the app stores it (`body`: its position and, for the safety check,
   * the question and the candidates). The side is the owner's.
   */
  drill?: { kind: 'safety' | 'convert'; body: { fen: string } & Record<string, unknown> };
  settings?: Record<string, SettingValue>;
  /** start the coach before the steps (default true) */
  coach?: boolean;
  steps: Step[];
  checks: Check[];
};

/** One `say` the coach made. An accepted one carries the id of the message it put on the page. */
export type SayCall = { kind: string; text: string; ok: boolean; problems?: string[]; messageId?: number };
export type ToolCall = { name: string; args: Record<string, unknown>; ok: boolean };
/** What one run of a scenario recorded. */
export type Transcript = {
  /** what reached the page from the coach or the scripted fallback, in order */
  messages: CoachMessage[];
  says: SayCall[];
  tools: ToolCall[];
  ms: number;
  timedOut: boolean;
};

export type Outcome = { check: string; pass: boolean; detail?: string };

const SHORT_KINDS: ReadonlySet<string> = new Set(['question', 'nudge', 'praise']);

/** Score one recorded run. The first two checks apply to every scenario; the rest are the scenario's own. */
export function judge(scenario: Scenario, t: Transcript, budget: { short: number; explain: number }): Outcome[] {
  const out: Outcome[] = [];
  const said = t.messages.filter((m) => m.from === 'coach');
  const fromCoach = said.filter((m) => m.source !== 'scripted');
  const texts = said.map((m) => plainText(m.text));

  // hard rules: nothing the validator refused is on the page, and everything the coach put there was accepted
  // every message of the coach's on the page must be the result of a `say` the validator accepted
  const accepted = new Set(t.says.filter((s) => s.ok && s.messageId !== undefined).map((s) => s.messageId));
  const unaccounted = fromCoach.filter((m) => !accepted.has(m.id));
  out.push({ check: 'hard rules: only accepted messages reach the page', pass: !unaccounted.length, detail: unaccounted.length ? `a message on the page was never accepted: ${unaccounted[0]!.text}` : undefined });

  // stays in budget: the app lets a message through that is one sentence over (length is style, not truth), so the same margin applies here
  const long = said.find((m) => m.source !== 'scripted' && splitSentences(plainText(m.text)).length > (SHORT_KINDS.has(m.kind ?? '') ? budget.short : budget.explain) + 1);
  out.push({ check: 'stays in budget', pass: !long, detail: long ? `${splitSentences(plainText(long.text)).length} sentences in a ${long.kind}: ${plainText(long.text)}` : undefined });

  if (t.timedOut) out.push({ check: 'answers in time', pass: false, detail: 'the coach had not finished when the wait ran out' });

  for (const c of scenario.checks) {
    switch (c.type) {
      case 'replies': {
        const pool = c.scripted ? said : fromCoach;
        out.push({ check: 'replies', pass: pool.length > 0, detail: pool.length ? undefined : said.length ? 'only the scripted fallback spoke' : 'nothing was said' });
        break;
      }
      case 'silent':
        out.push({ check: 'quiet when it should be', pass: said.length === 0, detail: said.length ? `said: ${texts[0]}` : undefined });
        break;
      case 'firstIs': {
        const first = said[0];
        out.push({ check: `first message is ${c.kinds.join(' or ')}`, pass: !!first && c.kinds.includes(first.kind as SayKind), detail: first ? `it was ${first.kind}: ${texts[0]}` : 'nothing was said' });
        break;
      }
      case 'someKind':
        out.push({ check: `a message of kind ${c.kind}`, pass: said.some((m) => m.kind === c.kind), detail: `kinds: ${said.map((m) => m.kind).join(', ') || 'none'}` });
        break;
      case 'says': {
        const re = new RegExp(c.pattern, 'i');
        out.push({ check: `says /${c.pattern}/`, pass: texts.some((x) => re.test(x)), detail: texts.join(' | ').slice(0, 400) || 'nothing was said' });
        break;
      }
      case 'never': {
        const re = new RegExp(c.pattern, 'i');
        const hit = texts.find((x) => re.test(x));
        out.push({ check: `never says /${c.pattern}/`, pass: !hit, detail: hit });
        break;
      }
      case 'tool': {
        // "play_line|check_move": either tool answers the check
        const fits = (call: ToolCall) => c.name.split('|').includes(call.name) && Object.entries(c.args ?? {}).every(([k, v]) => new RegExp(v, 'i').test(String(call.args[k] ?? '')));
        out.push({ check: `calls ${c.name}${c.args ? ` ${JSON.stringify(c.args)}` : ''}`, pass: t.tools.some(fits), detail: `calls: ${t.tools.map((x) => `${x.name}${x.args.what ? `(${String(x.args.what)}${x.args.move ? ` ${String(x.args.move)}` : ''})` : x.args.show ? `(${String(x.args.show)})` : ''}`).join(', ') || 'none'}` });
        break;
      }
      case 'noTool':
        out.push({ check: `does not call ${c.name}`, pass: !t.tools.some((x) => x.name === c.name), detail: undefined });
        break;
    }
  }
  return out;
}

/** The position a scenario starts from, or what is wrong with the scenario. */
export function scenarioStart(s: Scenario): { ok: true; text: string; fen: string } | { ok: false; reason: string } {
  if (s.spar) return { ok: true, text: '', fen: START_FEN };
  if (s.opening?.trap) return { ok: true, text: '', fen: START_FEN }; // a trap of the pack: checked when it is set up
  if (s.endgame) return { ok: true, text: '', fen: START_FEN }; // a position of the endgame pack: checked when it is set up
  if (s.drill) {
    const pos = parsePosition(s.drill.body.fen);
    if (!pos) return { ok: false, reason: `${s.id}: the drill's FEN is not a legal position` };
    if (pos.turn !== s.side) return { ok: false, reason: `${s.id}: the drill's position is not the owner's move` };
    return { ok: true, text: s.drill.body.fen, fen: s.drill.body.fen };
  }
  if (s.opening) {
    const lines = repertoireLines(s.opening.pgn, s.side).lines;
    if (!lines.length) return { ok: false, reason: `${s.id}: the repertoire has no line for ${s.side}` };
    const steps = lineSteps(lines[0]!);
    if (steps.illegalAt !== undefined) return { ok: false, reason: `${s.id}: the first line has an illegal move` };
    const mine = steps.steps.filter((x) => x.mine);
    if (!mine[s.opening.card]) return { ok: false, reason: `${s.id}: the first line has no ${s.opening.card + 1}th move of the owner's` };
    return { ok: true, text: '', fen: mine[s.opening.card]!.fenBefore };
  }
  if (s.puzzle) {
    const p = s.puzzle;
    const start = parsePosition(p.fen);
    if (!start) return { ok: false, reason: `${s.id}: the puzzle's FEN is not a legal position` };
    const r = playLine(p.fen, [...(p.setup ? [p.setup] : []), ...p.solution]);
    if (!r.ok) return { ok: false, reason: `${s.id}: the puzzle's move ${r.move} is not legal` };
    return { ok: true, text: p.fen, fen: p.fen };
  }
  if (s.fen) return parsePosition(s.fen) ? { ok: true, text: s.fen, fen: s.fen } : { ok: false, reason: `${s.id}: the FEN is not a legal position` };
  const moves = (s.moves ?? '').split(/\s+/).filter(Boolean);
  const r = playLine(START_FEN, moves);
  if (!r.ok) return { ok: false, reason: `${s.id}: illegal move ${r.move}` };
  return { ok: true, text: moves.join(' '), fen: r.fens.at(-1)! };
}

/** Everything that can be checked about a set of scenarios without running a coach. */
export function lintScenarios(list: Scenario[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const s of list) {
    if (seen.has(s.id)) problems.push(`${s.id}: used twice`);
    seen.add(s.id);
    const start = scenarioStart(s);
    if (!start.ok) problems.push(start.reason);
    if (!s.steps.length) problems.push(`${s.id}: no steps`);
    if (!s.checks.length) problems.push(`${s.id}: no checks`);
    for (const c of s.checks) {
      const patterns = c.type === 'says' || c.type === 'never' ? [c.pattern] : c.type === 'tool' ? Object.values(c.args ?? {}) : [];
      for (const p of patterns) {
        try {
          new RegExp(p, 'i');
        } catch {
          problems.push(`${s.id}: /${p}/ is not a valid pattern`);
        }
      }
    }
    for (const step of s.steps) if ('move' in step && !/^[a-h][1-8][a-h][1-8]$/.test(step.move)) problems.push(`${s.id}: a move step must be like "g5e6", not "${step.move}"`);
    if (s.game && !s.moves) problems.push(`${s.id}: a game scenario needs its moves`);
    if (!s.game && s.steps.some((step) => 'replay' in step)) problems.push(`${s.id}: a replay step needs a game scenario ("game": the result)`);
    if (!s.puzzle && s.steps.some((step) => 'pmove' in step || 'puzzle' in step)) problems.push(`${s.id}: a puzzle step needs a puzzle scenario`);
    if (!s.spar && s.steps.some((step) => 'gmove' in step || 'game' in step)) problems.push(`${s.id}: a game step needs a spar scenario`);
    if (!s.opening && s.steps.some((step) => 'omove' in step || 'owhy' in step || 'oknown' in step || 'oshow' in step || 'owalk' in step)) problems.push(`${s.id}: an opening step needs an opening scenario`);
    for (const step of s.steps) if ('owalk' in step && !/^([a-h][1-8][a-h][1-8][qrbn]?( |$))*$/.test(step.owalk)) problems.push(`${s.id}: a walk is moves like "e2e4 e7e5", not "${step.owalk}"`);
    for (const step of s.steps) if ('omove' in step && !/^[a-h][1-8][a-h][1-8]$/.test(step.omove)) problems.push(`${s.id}: an opening move must be like "g1f3", not "${step.omove}"`);
    for (const step of s.steps) if ('gmove' in step && !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(step.gmove)) problems.push(`${s.id}: a game move must be like "e2e4", not "${step.gmove}"`);
    for (const step of s.steps) if ('pmove' in step && !/^[a-h][1-8][a-h][1-8]$/.test(step.pmove)) problems.push(`${s.id}: a puzzle move must be like "h2h3", not "${step.pmove}"`);
    if (!s.endgame && s.steps.some((step) => 'emove' in step || 'endgame' in step)) problems.push(`${s.id}: an endgame step needs an endgame scenario`);
    if (s.drill && !['safety', 'convert'].includes(s.drill.kind)) problems.push(`${s.id}: a drill is the safety check ("safety") or a won game ("convert")`);
    if (s.drill && s.steps.some((step) => !('ask' in step) && !('wait' in step))) problems.push(`${s.id}: a drill scenario's steps are questions ("ask") and waits`);
    for (const step of s.steps) if ('emove' in step && !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(step.emove)) problems.push(`${s.id}: an endgame move must be like "c5c7" or "a7a8q", not "${step.emove}"`);
  }
  return problems;
}

export type ScenarioResult = {
  id: string;
  covers: string;
  pass: boolean;
  outcomes: Outcome[];
  ms: number;
  says: { ok: number; total: number };
  messages: { kind?: string; source?: string; text: string }[];
  tools: string[];
  /** what the validator refused, and why: the material for improving a playbook's wording */
  refused?: { kind: string; text: string; problems: string[] }[];
};

/** A short name for a refusal, from the validator's message: the kind of problem, so refusals can be counted. */
function ruleOf(problem: string): string {
  if (problem.startsWith('stale')) return 'stale';
  if (/limit|already been answered|no event is open/.test(problem)) return 'too many messages';
  if (/is a concept kept for later/.test(problem)) return 'R5 vocabulary';
  if (/Too long/.test(problem)) return 'R6 length';
  if (/engine number/.test(problem)) return 'R4 numbers';
  if (/outside a token|looks like/.test(problem)) return 'R1 bare notation';
  if (/not legal|is not on|no .* on |does not match|not in (the )?fact/i.test(problem)) return 'R2 token not on the board';
  if (/cite|claims|no fact|backs|backed/i.test(problem)) return 'R3 claim without a fact';
  if (/may not give|not name|the answer/i.test(problem)) return 'R7 answer too early';
  return 'other';
}

/** The table at the end of a run: how each line of COACH §9 did. */
export function summarise(results: ScenarioResult[]) {
  const says = results.reduce((a, r) => ({ ok: a.ok + r.says.ok, total: a.total + r.says.total }), { ok: 0, total: 0 });
  const byCheck: Record<string, { pass: number; total: number }> = {};
  for (const r of results)
    for (const o of r.outcomes) {
      const name = o.check.startsWith('hard rules') ? 'hard rules' : o.check.startsWith('stays in budget') ? 'stays in budget' : o.check.startsWith('first message is') ? 'asks before telling (first message)' : o.check.startsWith('quiet') ? 'quiet when it should be' : 'scenario checks';
      const b = (byCheck[name] ??= { pass: 0, total: 0 });
      b.total++;
      if (o.pass) b.pass++;
    }
  const byCovers: Record<string, { pass: number; total: number }> = {};
  for (const r of results) {
    const b = (byCovers[r.covers] ??= { pass: 0, total: 0 });
    b.total++;
    if (r.pass) b.pass++;
  }
  return {
    scenarios: { pass: results.filter((r) => r.pass).length, total: results.length },
    firstTryValidity: { ...says, pct: says.total ? Math.round((1000 * says.ok) / says.total) / 10 : null, bar: 85 },
    byCheck,
    byCovers,
    medianMs: results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? 0,
    failed: results.filter((r) => !r.pass).map((r) => ({ id: r.id, why: r.outcomes.filter((o) => !o.pass).map((o) => `${o.check}${o.detail ? `: ${o.detail}` : ''}`) })),
    // which of the validator's rules the refused messages broke, most often first (R1 a bare move … R8)
    refusedBy: Object.fromEntries(
      Object.entries(
        results
          .flatMap((r) => r.refused ?? [])
          .flatMap((x) => x.problems.map(ruleOf))
          .reduce<Record<string, number>>((m, rule) => ((m[rule] = (m[rule] ?? 0) + 1), m), {}),
      ).sort((a, b) => b[1] - a[1]),
    ),
  };
}
