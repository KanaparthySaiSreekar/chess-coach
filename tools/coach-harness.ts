// The playbook harness runner (COACH §9, feature H17; PLAN WP 4.10).
//
// Starts a private server (its own port and a throwaway data folder, so the owner's board and
// data are untouched), starts the real coach on it for each scenario in
// coach/fixtures/<agent>/scenarios.json, does what the owner would do, records every message that
// reached the page and every tool call, and scores the run with plain code (coach/harness.ts).
//
//   node tools/coach-harness.ts --model haiku            all scenarios
//   node tools/coach-harness.ts --model sonnet --only qe6-label,fair-play
//   node tools/coach-harness.ts --list                   the scenarios, without running anything
//
// It uses the plan (the coach is a real headless Claude Code session), so it runs on demand. Run
// it on AC power. The result is saved as coach/results/<date>-<model>.json, so a change of wording
// that lowers a score shows up beside the earlier runs.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gateV1Convert, gateV1Safety, legalMoves, lineKey, lineSteps, lineText, makeScheduler, mustPosition, playLine, positionKey, readEndgame, readTrap, repertoireLines, review as reviewCard, type ClientMsg, type CoachMessage, type CoachStatus, type ServerMsg } from '@chess-coach/core';
import type { MoveSource } from '../packages/server/src/bots/service.ts';
import { App } from '../packages/server/src/app.ts';
import { judge, lintScenarios, scenarioStart, summarise, type SayCall, type Scenario, type ScenarioResult, type Step, type ToolCall, type Transcript } from '../packages/server/src/coach/harness.ts';
import { config } from '../packages/server/src/config.ts';
import { serve } from '../packages/server/src/http.ts';
import { SETTINGS } from '../packages/server/src/settings.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const agent = arg('agent') ?? 'coach-analysis';
const model = arg('model') ?? 'haiku';
const only = arg('only')?.split(',');
const port = Number(arg('port') ?? 5194);
const WAIT_MS = Number(arg('wait') ?? 75_000);

const all = JSON.parse(readFileSync(path.join(config.repoRoot, 'coach', 'fixtures', agent, 'scenarios.json'), 'utf8')) as Scenario[];
const problems = lintScenarios(all);
if (problems.length) {
  console.error('the scenarios have problems:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
const scenarios = only ? all.filter((s) => only.includes(s.id)) : all;
if (process.argv.includes('--list')) {
  for (const s of all) console.log(`${s.id.padEnd(24)} [${s.covers}] ${s.about}`);
  process.exit(0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** what went wrong with the coach process itself during the scenario in hand (the plan's limit reached, no login, a crash) */
let coachProblems: string[] = [];
const dataDir = mkdtempSync(path.join(tmpdir(), 'cc-harness-'));
// the bot of a game scenario plays its script (its first legal move when a scripted one does not fit), so every run is the same game
let botScript: string[] = [];
/** The position at the end of the game being played (its main line). */
const gameEndFen = () => {
  const t = app.play.game.tree;
  let n = t.nodes[t.root]!;
  while (n.children[0]) n = t.nodes[n.children[0]]!;
  return n.fen;
};
const scriptedBot: MoveSource = {
  state: 'ready',
  probabilities: async (req) => {
    const r = playLine(req.startFen, req.moves);
    const fen = r.fens.at(-1) ?? req.startFen;
    const legal = legalMoves(mustPosition(fen)).map((m) => m.uci);
    // the same stand-in also answers for "Maia's guess" in the explorer and the findable move (D6, H12); only the
    // game's own position takes a move from the script, or those calls use it up and the game goes another way
    // (seen 2026-11-26: blunder-asks played 1...a5 for its scripted 1...d5, so 2.Qg4 hung nothing)
    const forGame = app.play.game.status === 'playing' && fen === gameEndFen() && mustPosition(fen).turn !== app.play.game.you;
    const want = forGame ? botScript.shift() : undefined;
    return [{ uci: want && legal.includes(want) ? want : legal[0]!, p: 1 }];
  },
  stop: () => {},
};
const app = new App({
  repoRoot: config.repoRoot,
  dataDir,
  stockfish: config.stockfish,
  syzygy: config.syzygy,
  expectedBench: config.expectedBench,
  claudePath: config.claude,
  openingsDir: config.openingsDir,
  mcpUrl: `http://${config.host}:${port}/mcp`,
  // Stockfish alone: the harness is about the coach's behaviour, and this keeps Lichess out of a batch run
  cloud: null,
  powerProbe: async () => true,
  botSource: scriptedBot,
  botNoDelay: true,
  log: (m) => {
    // a coach process that dies or cannot start is not the playbook's fault: it is reported as itself
    if (/coach process ended unexpectedly|could not (?:prepare|start) the coach|could not reach its chess tools/.test(m)) coachProblems.push(m);
    if (process.argv.includes('--verbose')) console.error(`[server] ${m}`);
  },
});
const served = await serve(app, { host: config.host, port });

// what the page would receive
let status: CoachStatus | null = null;
let messages: CoachMessage[] = [];
let lastActivity = Date.now();
const client = {
  send: (m: ServerMsg) => {
    if (m.type === 'coach_status') {
      if (status?.state !== m.status.state) lastActivity = Date.now();
      status = m.status;
    } else if (m.type === 'coach_msg' && m.message.from === 'coach') {
      messages.push(m.message);
      lastActivity = Date.now();
    }
  },
};
app.addClient(client);
const send = (m: ClientMsg) => app.onClientMessage(client, m);

// every tool call the coach makes, recorded on its way through
let says: SayCall[] = [];
let tools: ToolCall[] = [];
for (const [name, fn] of Object.entries(app.tools) as [string, (a: any) => Promise<any>][]) {
  (app.tools as any)[name] = async (a: any) => {
    lastActivity = Date.now();
    const r = await fn(a);
    lastActivity = Date.now();
    const ok = r?.ok !== false;
    tools.push({ name, args: a ?? {}, ok });
    if (name === 'say') says.push({ kind: String(a?.kind ?? ''), text: String(a?.text ?? ''), ok: r?.ok === true, problems: r?.problems, messageId: typeof r?.id === 'number' ? r.id : undefined });
    return r;
  };
}

const coachIdle = () => !status || status.state === 'ready' || status.state === 'off' || status.state === 'error';

/** Wait until the coach has finished: idle, and nothing new for a moment. `atLeast` gives a wake-up time to happen. */
async function settle(atLeast: number): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    await sleep(150);
    const now = Date.now();
    if (now - start > WAIT_MS) return false;
    if (now - start >= atLeast && coachIdle() && now - lastActivity > 1500) return true;
  }
}

async function doStep(step: Step): Promise<boolean> {
  lastActivity = Date.now();
  if ('wait' in step) {
    await sleep(step.wait);
    return settle(0);
  }
  const before = messages.length;
  if ('ask' in step) await send({ type: 'ask', text: step.ask });
  else if ('chip' in step) await send({ type: 'chip', chip: step.chip });
  else if ('move' in step) await send({ type: 'move', from: step.move.slice(0, 2), to: step.move.slice(2, 4) });
  else if ('draw' in step) await send({ type: 'shapes', shapes: step.draw.map((d) => ({ from: d.from, to: d.to, style: 'owner' as const })) });
  else if ('demo' in step) await send({ type: 'demo', action: 'goto', line: null, ply: 0 });
  else if ('gmove' in step) {
    // a move in the game: the bot answers at once, and the owner's turn (or a blunder) may wake the coach
    await send({ type: 'game', action: 'move', from: step.gmove.slice(0, 2), to: step.gmove.slice(2, 4), promotion: step.gmove[4] ? ({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' } as const)[step.gmove[4] as 'q'] : undefined });
    return settle(7000);
  } else if ('game' in step) {
    await send({ type: 'game', action: step.game === 'ask' ? 'ask_coach' : step.game });
    if (step.game === 'ask') {
      const t0 = Date.now();
      while (status?.state !== 'thinking' && status?.state !== 'retrying' && messages.length === before && Date.now() - t0 < 30_000) await sleep(100);
      return settle(500);
    }
    return settle(5000);
  } else if ('pmove' in step) {
    // a move on the puzzle board: a miss wakes the coach once the engine has judged it
    await send({ type: 'puzzle', action: 'move', from: step.pmove.slice(0, 2), to: step.pmove.slice(2, 4) });
    return settle(6000);
  } else if ('puzzle' in step) {
    await send({ type: 'puzzle', action: step.puzzle === 'ask' ? 'ask_coach' : step.puzzle });
    if (step.puzzle === 'ask') {
      const t0 = Date.now();
      while (status?.state !== 'thinking' && status?.state !== 'retrying' && messages.length === before && Date.now() - t0 < 30_000) await sleep(100);
      return settle(500);
    }
    return settle(5000);
  }
  else if ('omove' in step) {
    // a move on the opening drill's board: a miss wakes the coach once the engine has judged it
    await send({ type: 'opening', action: 'move', from: step.omove.slice(0, 2), to: step.omove.slice(2, 4) });
    return settle(6000);
  } else if ('owhy' in step) {
    await send({ type: 'opening', action: 'why', text: step.owhy });
    return settle(step.owhy.trim() ? 6000 : 1500);
  } else if ('oshow' in step) {
    await send({ type: 'opening', action: 'next' });
    return settle(6000);
  } else if ('oknown' in step) {
    await send({ type: 'opening', action: 'why_known', known: step.oknown });
    return settle(1500);
  } else if ('owalk' in step) {
    // the Repertoire view of the Openings tab: the walk is the board the coach sees (D12)
    const rep = app.db.repertoires()[0];
    await send({ type: 'opening', action: 'walk', repertoire: rep?.id ?? null, moves: step.owalk.split(' ').filter(Boolean) });
    return settle(400);
  }
  else if ('emove' in step) {
    // a move on the endgame board: the engine judges it and answers; the end of a go wakes the coach
    await send({ type: 'endgame', action: 'move', from: step.emove.slice(0, 2), to: step.emove.slice(2, 4), promotion: step.emove[4] ? ({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' } as const)[step.emove[4] as 'q'] : undefined });
    return settle(7000);
  } else if ('endgame' in step) {
    await send({ type: 'endgame', action: step.endgame });
    if (step.endgame === 'ask') {
      const t0 = Date.now();
      while (status?.state !== 'thinking' && status?.state !== 'retrying' && messages.length === before && Date.now() - t0 < 30_000) await sleep(100);
      return settle(500);
    }
    return settle(3000);
  }
  else if ('replay' in step) {
    await send({ type: 'replay', action: step.replay });
    if (step.replay === 'stop') return settle(400);
    // the coach is handed the moment (or the end of the review): wait for it to start on it, or for an answer
    const t0 = Date.now();
    while (status?.state !== 'thinking' && status?.state !== 'retrying' && messages.length === before && Date.now() - t0 < 45_000) await sleep(100);
    return settle(500);
  }
  // a question or a chip always gets an answer (from the coach, or scripted): wait for the coach to start
  // on it, or for the answer itself, before looking for the end. The engine searches first, which takes a moment.
  if ('ask' in step || 'chip' in step) {
    const t0 = Date.now();
    while (status?.state !== 'thinking' && status?.state !== 'retrying' && messages.length === before && Date.now() - t0 < 30_000) await sleep(100);
    return settle(500);
  }
  // a move may wake the coach only after the engine has looked at it: give that time before calling it quiet
  return settle('move' in step ? 6000 : 400);
}

/** A puzzle scenario (the drill coach): the puzzle alone in the library, the Puzzles tab, the coach, and the puzzle on its board. */
async function setUpPuzzle(s: Scenario): Promise<void> {
  const p = s.puzzle!;
  for (const x of app.db.listContent({ status: 'live', limit: 10_000 })) app.db.setContentStatus(x.id, 'quarantined');
  const mixed = p.set === 'mixed';
  const stamp = Date.now();
  const id = app.db.saveContent(`harness:${s.id}:${stamp}`, { type: mixed ? 'puzzle_db' : 'puzzle_game', status: 'live', source: mixed ? `puzzle:harness-${stamp}` : `game:${stamp % 100_000}#11`, licence: 'own', level: '400–700', gates: [], body: { fen: p.fen, setup: p.setup, solution: p.solution, themes: p.themes, kind: mixed ? 'theme' : 'mistake' } } as never);
  await send({ type: 'mode', mode: 'puzzles' });
  await send({ type: 'puzzle', action: 'close' });
  await send({ type: 'coach', action: 'start' });
  for (let i = 0; i < 120 && status?.state !== 'ready'; i++) await sleep(250);
  // a mixed set with no database to draw from keeps its kind: the puzzle is started in it by its id
  if (mixed) {
    await send({ type: 'puzzle', action: 'set', set: { kind: 'mixed' } });
    await send({ type: 'puzzle', action: 'start', id });
  } else await send({ type: 'puzzle', action: 'set', set: { kind: 'games' } });
  for (let i = 0; i < 40 && !(app.puzzles.view.id === id && app.puzzles.view.yourTurn); i++) await sleep(100);
  if (app.puzzles.view.id !== id) throw new Error(`${s.id}: the puzzle did not start`);
}

/**
 * An opening scenario (the opening coach): the repertoire alone in the app, its lines live, the
 * words written; the cards before the one in hand answered (due later), the card itself new or due
 * now; then the Puzzles tab, the coach, and the Openings set, which puts that card on the board.
 */
async function setUpOpening(s: Scenario): Promise<void> {
  const o = s.opening!;
  for (const x of app.db.listContent({ status: 'live', limit: 10_000 })) app.db.setContentStatus(x.id, 'quarantined');
  for (const r of app.db.repertoires()) app.db.removeRepertoire(r.id);
  for (const k of app.db.contentKeys('opening')) app.db.deleteContent(k.id);
  for (const k of app.db.contentKeys('trap')) app.db.deleteContent(k.id);
  const rep = app.db.addRepertoire({ name: 'Harness repertoire', colour: s.side, source: 'pasted:2026-11-15', licence: 'own', level: '400–700' });
  const lines = repertoireLines(o.pgn, s.side).lines.map((l) => ({ ...l, repertoire: rep }));
  for (const line of lines) app.db.saveContent(lineKey(line), { type: 'repertoire', status: 'live', source: 'pasted:2026-11-15', licence: 'own', level: '400–700', engine: 'harness', gates: [], body: line } as never);
  for (const w of o.words ?? []) {
    const at = lines.flatMap((l) => lineSteps(l).steps.filter((x) => x.mine && lineText(l.startFen, l.moves, x.index + 1) === w.line))[0];
    if (!at) throw new Error(`${s.id}: no move of the owner's at "${w.line}"`);
    app.db.setRepText(rep, positionKey(at.fenBefore), { fen: at.fenBefore, uci: at.uci, san: at.san, why: w.why, idea: w.idea });
  }
  // a trap of the pack: the trap alone, live, is the card (its gates are the pack's own test, WP 8.9)
  if (o.trap) {
    const t = app.traps.read().find((x) => x.id === o.trap);
    const read = t ? readTrap(t) : null;
    if (!read?.ok) throw new Error(`${s.id}: no trap "${o.trap}" in content/traps.json`);
    app.db.saveContent(`trap:${read.item.id}`, { type: 'trap', status: 'live', source: `file:content/traps.json#${read.item.id}`, licence: 'project', level: '400–700', engine: 'harness', gates: [], body: read.item } as never);
  }
  app.openings.sync();
  const target = o.trap ?? positionKey(lineSteps(lines[0]!).steps.filter((x) => x.mine)[o.card]!.fenBefore);
  const sched = await makeScheduler(365);
  const now = new Date();
  for (const k of app.db.contentKeys('opening')) {
    const isTarget = k.key.endsWith(`|${target}`);
    if (isTarget && !o.due) continue; // the card in hand, new: it is shown
    // every other card was answered today and comes back later; the card in hand, when due, was answered weeks ago
    app.db.addAttempt({ contentId: k.id, result: 'solved', hints: 0, misses: 0, ms: 3000, again: false });
    app.db.saveCard(k.id, reviewCard(sched, null, 'good', isTarget ? new Date(now.getTime() - 60 * 86_400_000) : now).card);
  }
  // the Openings tab, where the owner drills (D85): Practice puts the next card on the board
  // (the card first, then the coach: a new card put up with the coach on would wake it before the steps)
  await send({ type: 'mode', mode: 'openings' });
  await send({ type: 'opening', action: 'close' });
  await send({ type: 'opening', action: 'next' });
  await send({ type: 'coach', action: 'start' });
  for (let i = 0; i < 120 && status?.state !== 'ready'; i++) await sleep(250);
  const card = app.db.contentKeys('opening').find((k) => k.key.endsWith(`|${target}`));
  for (let i = 0; i < 40 && app.openings.view.id !== card?.id; i++) await sleep(100);
  if (app.openings.view.id !== card?.id) throw new Error(`${s.id}: the card did not come up (${app.openings.view.status}: ${app.openings.view.problem ?? ''})`);
}

/** An endgame scenario (the endgame coach): the position alone on the ladder, live; the Endgames tab, the coach, and the position on the board. */
async function setUpEndgame(s: Scenario): Promise<void> {
  const file = app.endgamePack.read();
  const p = file.positions.find((x) => x.id === s.endgame!.position);
  const read = p ? readEndgame(p, file.topics, file.positions.indexOf(p)) : null;
  if (!read?.ok) throw new Error(`${s.id}: no usable position "${s.endgame!.position}" in content/endgames.json`);
  if (read.item.side !== s.side) throw new Error(`${s.id}: the position is played by ${read.item.side}, the scenario says ${s.side}`);
  for (const k of app.db.contentKeys('endgame')) app.db.setContentStatus(k.id, 'quarantined');
  // its gates are the pack's own test (endgames.engine.test.ts): here it is simply live
  const id = app.db.saveContent(`endgame:${read.item.id}`, { type: 'endgame', status: 'live', source: `file:content/endgames.json#${read.item.id}`, licence: 'project', level: '400–700', engine: 'harness', gates: [], body: read.item } as never);
  app.db.setContentStatus(id, 'live');
  await send({ type: 'mode', mode: 'endgames' });
  await send({ type: 'endgame', action: 'close' });
  await send({ type: 'coach', action: 'start' });
  for (let i = 0; i < 120 && status?.state !== 'ready'; i++) await sleep(250);
  await send({ type: 'endgame', action: 'start', id });
  for (let i = 0; i < 40 && !(app.endgames.view.id === id && app.endgames.view.status === 'playing'); i++) await sleep(100);
  if (app.endgames.view.id !== id) throw new Error(`${s.id}: the position did not start`);
}

/** A drill scenario (the drill coach on the other drills, D105): the item alone in the library, the Puzzles tab, the coach, and the item on its board. */
async function setUpDrill(s: Scenario): Promise<void> {
  const d = s.drill!;
  for (const x of app.db.listContent({ status: 'live', limit: 10_000 })) app.db.setContentStatus(x.id, 'quarantined');
  const stamp = Date.now();
  const gate = d.kind === 'safety' ? gateV1Safety(d.body as never) : gateV1Convert(d.body as never);
  const id = app.db.saveContent(`harness:${s.id}:${stamp}|${d.kind}`, { type: d.kind, status: 'live', source: `game:${stamp % 100_000}#7`, licence: 'own', level: '400–700', gates: [gate, { gate: 'V6', result: 'pass' }], body: d.body } as never);
  await send({ type: 'mode', mode: 'puzzles' });
  await send({ type: 'puzzle', action: 'close' });
  await send({ type: 'coach', action: 'start' });
  for (let i = 0; i < 120 && status?.state !== 'ready'; i++) await sleep(250);
  await send({ type: 'puzzle', action: 'set', set: { kind: d.kind } });
  const view = () => (d.kind === 'safety' ? app.safety.view : app.convert.view);
  if (view().id !== id) await send({ type: d.kind, action: 'next' } as ClientMsg);
  if (view().id !== id) throw new Error(`${s.id}: the drill did not start`);
}

/** A game scenario (the sparring coach): the Play tab, the coach, and the game started with the bot's script. */
async function setUpSpar(s: Scenario): Promise<void> {
  await send({ type: 'game', action: 'new' });
  await send({ type: 'mode', mode: 'play' });
  await send({ type: 'coach', action: 'start' });
  for (let i = 0; i < 120 && status?.state !== 'ready'; i++) await sleep(250);
  botScript = [...s.spar!.bot];
  if (s.spar!.mini) await send({ type: 'game', action: 'mini', id: s.spar!.mini });
  else await send({ type: 'game', action: 'start', bot: app.play.botsView().bots[0]!.id, color: s.side });
  for (let i = 0; i < 40 && app.play.game.status !== 'playing'; i++) await sleep(100);
  if (app.play.game.status !== 'playing') throw new Error(`${s.id}: the game did not start`);
}

/** the settings the last scenario set */
let changedKeys: string[] = [];

async function run(s: Scenario): Promise<ScenarioResult> {
  await send({ type: 'coach', action: 'stop' });
  await send({ type: 'mode', mode: 'analysis' });
  await send({ type: 'new' });
  await send({ type: 'clear_thread' });
  await send({ type: 'preset', id: 'default' });
  await send({ type: 'setting', key: 'coach.model.analysis', value: model });
  await send({ type: 'setting', key: 'coach.model.review', value: model });
  await send({ type: 'setting', key: 'coach.model.drill', value: model });
  await send({ type: 'setting', key: 'coach.model.spar', value: model });
  await send({ type: 'setting', key: 'coach.model.opening', value: model });
  await send({ type: 'setting', key: 'coach.model.endgame', value: model });
  // what the scenario before set goes back to its default, so no scenario runs with another one's settings
  for (const key of changedKeys) await send({ type: 'setting', key, value: SETTINGS.find((d) => d.key === key)!.default });
  changedKeys = Object.keys(s.settings ?? {});
  for (const [key, value] of Object.entries(s.settings ?? {})) await send({ type: 'setting', key, value });
  if (app.session.state.orientation !== s.side) await send({ type: 'flip' });
  const start = scenarioStart(s);
  if (!start.ok) throw new Error(start.reason);
  if (s.spar) {
    // nothing here: the game starts with the coach on, below, so its first event is the start of the game
  } else if (s.puzzle) {
    await setUpPuzzle(s);
  } else if (s.opening) {
    await setUpOpening(s);
  } else if (s.endgame) {
    await setUpEndgame(s);
  } else if (s.drill) {
    await setUpDrill(s);
  } else if (s.game) {
    // a finished game of the owner's: into the library, onto the board with the owner's side facing them, and through the engine
    await send({ type: 'setting', key: 'review.ownFirst', value: false });
    await send({ type: 'setting', key: 'review.auto', value: false });
    await send({ type: 'setting', key: 'puzzles.fromGames', value: false });
    for (const g of app.library.view().games) await send({ type: 'library', action: 'remove', id: g.id });
    const numbered = (s.moves ?? '').split(/\s+/).filter(Boolean).map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m)).join(' ');
    await send({ type: 'library', action: 'import', text: `[White "${s.side === 'white' ? 'You' : 'Opponent'}"]\n[Black "${s.side === 'black' ? 'You' : 'Opponent'}"]\n[Result "${s.game}"]\n\n${numbered} ${s.game}` });
    if (app.session.state.orientation !== s.side) await send({ type: 'flip' });
    await send({ type: 'library', action: 'analyse' });
    if (app.review?.status !== 'done') throw new Error(`${s.id}: the engine did not get through the game`);
  } else if (s.fen) await send({ type: 'setup', fen: s.fen });
  else {
    await send({ type: 'load', text: start.text });
    await send({ type: 'nav', to: 'end' });
  }
  if (!s.game && !s.puzzle && !s.spar && !s.opening && !s.endgame && !s.drill && app.session.focusFen().split(' ').slice(0, 2).join(' ') !== start.fen.split(' ').slice(0, 2).join(' ')) throw new Error(`${s.id}: the board did not reach the scenario's position`);
  await sleep(300);
  messages = [];
  says = [];
  tools = [];
  coachProblems = [];
  const t0 = Date.now();
  let timedOut = false;
  if (s.spar) {
    await setUpSpar(s);
    // the start of the game wakes the coach: wait for it to have its say before the steps
    await settle(4000);
  }
  // a game scenario starts its coach with the replay: the review has an agent of its own
  if (s.coach !== false && !s.game && !s.puzzle && !s.spar && !s.opening && !s.endgame && !s.drill) {
    await send({ type: 'coach', action: 'start' });
    for (let i = 0; i < 120 && status?.state !== 'ready'; i++) await sleep(250);
    messages = []; // nothing said while starting counts
  }
  for (const step of s.steps) if (!(await doStep(step))) timedOut = true;
  const transcript: Transcript = { messages: [...messages], says: [...says], tools: [...tools], ms: Date.now() - t0, timedOut };
  if (s.game) await send({ type: 'replay', action: 'stop' });
  await send({ type: 'coach', action: 'stop' });
  if (s.puzzle) {
    await send({ type: 'puzzle', action: 'close' });
    await send({ type: 'mode', mode: 'analysis' });
  }
  if (s.opening) {
    await send({ type: 'opening', action: 'walk', repertoire: null });
    await send({ type: 'opening', action: 'close' });
    await send({ type: 'mode', mode: 'analysis' });
  }
  if (s.endgame) {
    await send({ type: 'endgame', action: 'close' });
    await send({ type: 'mode', mode: 'analysis' });
  }
  if (s.drill) {
    if (s.drill.kind === 'safety') await send({ type: 'safety', action: 'close' });
    else await send({ type: 'convert', action: 'resign' });
    await send({ type: 'puzzle', action: 'set', set: { kind: 'games' } });
    await send({ type: 'mode', mode: 'analysis' });
  }
  if (s.spar) {
    await send({ type: 'game', action: 'new' });
    await send({ type: 'mode', mode: 'analysis' });
  }
  const budget = { short: app.settings.get<number>('coach.sentences.short'), explain: app.settings.get<number>('coach.sentences.explain') };
  const outcomes = judge(s, transcript, budget);
  if (coachProblems.length) outcomes.push({ check: 'the coach process ran', pass: false, detail: coachProblems.join(' | ').slice(0, 400) });
  return {
    id: s.id,
    covers: s.covers,
    pass: outcomes.every((o) => o.pass),
    outcomes,
    ms: transcript.ms,
    says: { ok: transcript.says.filter((x) => x.ok).length, total: transcript.says.length },
    messages: transcript.messages.map((m) => ({ kind: m.kind, source: m.source, text: m.text })),
    refused: transcript.says.filter((x) => !x.ok).map((x) => ({ kind: x.kind, text: x.text, problems: x.problems ?? [] })),
    tools: transcript.tools.map((x) => `${x.name}${x.args.what ? `(${String(x.args.what)}${x.args.move ? ` ${String(x.args.move)}` : ''})` : x.args.show ? `(${String(x.args.show)})` : x.args.move ? `(${String(x.args.move)})` : ''}${x.ok ? '' : ' ✗'}`),
  };
}

console.log(`playbook harness: ${agent} on ${model}, ${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'} (private server on port ${served.port})`);
await app.verifyEngine();
const results: ScenarioResult[] = [];
for (const s of scenarios) {
  try {
    const r = await run(s);
    results.push(r);
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${s.id.padEnd(24)} ${(r.ms / 1000).toFixed(1).padStart(5)} s  says ${r.says.ok}/${r.says.total}  ${r.tools.filter((x) => !x.startsWith('say') && !x.startsWith('get_')).join(' ') || '-'}`);
    for (const m of r.messages) console.log(`        ${m.source === 'scripted' ? '(scripted) ' : ''}[${m.kind}] ${m.text}`);
    for (const o of r.outcomes.filter((x) => !x.pass)) console.log(`      ✗ ${o.check}${o.detail ? `: ${o.detail}` : ''}`);
    for (const x of r.refused ?? []) console.log(`      refused [${x.kind}] ${x.text}\n          because: ${x.problems.join(' | ')}`);
  } catch (e) {
    console.log(`ERROR ${s.id}: ${(e as Error).message}`);
    results.push({ id: s.id, covers: s.covers, pass: false, outcomes: [{ check: 'runs', pass: false, detail: (e as Error).message }], ms: 0, says: { ok: 0, total: 0 }, messages: [], tools: [] });
  }
}

const summary = summarise(results);
const usage = app.coach.status.usage;
const date = new Date().toISOString().slice(0, 10);
const outDir = path.join(config.repoRoot, 'coach', 'results');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${date}-${agent}-${model}${only ? '-partial' : ''}.json`);
writeFileSync(outFile, JSON.stringify({ when: new Date().toISOString(), agent, model, engine: app.engineInfo, usage, summary, results }, null, 1));

console.log(`\n${summary.scenarios.pass} of ${summary.scenarios.total} scenarios passed · first-try validity ${summary.firstTryValidity.ok}/${summary.firstTryValidity.total}${summary.firstTryValidity.pct === null ? '' : ` (${summary.firstTryValidity.pct}%, bar ${summary.firstTryValidity.bar}%)`} · median ${(summary.medianMs / 1000).toFixed(1)} s a scenario`);
for (const [name, b] of Object.entries(summary.byCheck)) console.log(`  ${name.padEnd(38)} ${b.pass}/${b.total}`);
if (Object.keys(summary.refusedBy).length) console.log(`refused messages by reason: ${Object.entries(summary.refusedBy).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`usage: ${usage.turns} turns, ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.cacheReadTokens} cached, about $${usage.costUsd.toFixed(3)}`);
console.log(`saved ${path.relative(config.repoRoot, outFile)}`);

await served.close();
await app.stop().catch(() => {});
rmSync(dataDir, { recursive: true, force: true });
process.exit(0);
