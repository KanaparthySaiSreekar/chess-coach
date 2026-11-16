// Spike S1: coach bridge. Throwaway code (docs/PLAN.md, Phase 2).
//
// Question: can a script drive a headless Claude Code coach quickly and reliably?
// Method:   a two-tool MCP server (get_state, say) on localhost; spawn `claude -p` in stream-json
//           mode; send 10 events and time each reply; send two events back to back; kill and
//           restart; send an event that goes stale before the reply.
// Pass:     median < 4 s on Haiku; no lost or misordered events; the stale reply is refused.
//
// Usage: node spikes/s1-bridge/run.mjs <haiku|sonnet> <agent|prompt> [events=10]

import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const model = process.argv[2] ?? 'haiku';
const variant = process.argv[3] ?? 'prompt';
const nEvents = Number(process.argv[4] ?? 10);
const CLAUDE = process.env.CLAUDE_BIN ?? path.join(process.env.USERPROFILE ?? '', '.local', 'bin', 'claude.exe');

// ---------------------------------------------------------------- the fake board + MCP server
const board = { seq: 0, fen: 'startpos', lastMove: null };
const calls = []; // every tool call, with a timestamp
const shown = []; // says that were accepted (what the page would show)
const sayLog = new Map(); // seq -> {t, seq, stale}
const sayWaiters = new Map();
function onSay(rec) {
  if (!sayLog.has(rec.seq)) sayLog.set(rec.seq, rec);
  const w = sayWaiters.get(rec.seq);
  if (w) { sayWaiters.delete(rec.seq); w(rec); }
}
const waitSay = (seq) => (sayLog.has(seq) ? Promise.resolve(sayLog.get(seq)) : new Promise((r) => sayWaiters.set(seq, r)));

function buildMcp() {
  const server = new McpServer({ name: 'chess', version: '0.0.1' });
  server.registerTool(
    'get_state',
    { description: 'The current board: seq, position, last move.', inputSchema: {} },
    async () => {
      calls.push({ t: Date.now(), tool: 'get_state' });
      return { content: [{ type: 'text', text: JSON.stringify(board) }] };
    },
  );
  server.registerTool(
    'say',
    {
      description:
        'Say one short message to the owner on the page. The only way to speak. `seq` must be the seq of the event you are answering.',
      inputSchema: { seq: z.number().int(), kind: z.enum(['question', 'nudge', 'answer', 'praise']), text: z.string() },
    },
    async ({ seq, kind, text }) => {
      const t = Date.now();
      const stale = seq !== board.seq;
      calls.push({ t, tool: 'say', seq, kind, text, stale });
      if (stale) {
        onSay({ t, seq, stale: true });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                problems: [`stale: the board has moved on to seq ${board.seq}. Drop this reply and wait for the next event.`],
              }),
            },
          ],
        };
      }
      shown.push({ t, seq, kind, text });
      onSay({ t, seq, stale: false });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, id: shown.length }) }] };
    },
  );
  return server;
}

const token = randomBytes(24).toString('hex');
const httpServer = http.createServer(async (req, res) => {
  try {
    if (!req.url?.startsWith('/mcp')) return void res.writeHead(404).end();
    if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'content-type': 'application/json' });
      return void res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const server = buildMcp();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error('mcp error', e);
    if (!res.headersSent) res.writeHead(500).end();
  }
});
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
const port = httpServer.address().port;

const tmp = mkdtempSync(path.join(tmpdir(), 's1-'));
const mcpConfig = path.join(tmp, 'mcp.json');
writeFileSync(
  mcpConfig,
  JSON.stringify({ mcpServers: { chess: { type: 'http', url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }),
);

const PROMPT = `You are a chess coach speaking on a web page. Each user message is one JSON event from the page.
Act only through the chess tools; text you write outside a tool is never shown.
For every event: call the tool mcp__chess__say exactly once, with the event's seq, kind "question", and one short question (max 15 words) about the first fact in the event. Then stop.
If say returns ok:false with a "stale" problem, do nothing more for that event: do not retry.
Never invent chess facts: use only the event's facts.`;
const promptFile = path.join(tmp, 'prompt.md');
writeFileSync(promptFile, PROMPT);

// ---------------------------------------------------------------- the coach process
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_')) delete env[k];
  // keep the repo's and the home folder's CLAUDE.md out of the coach's context (measured: 7.2k -> 0.7k tokens)
  if (variant === 'lean') env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1';
  return env;
}

function startCoach() {
  const common = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--mcp-config', mcpConfig, '--strict-mcp-config',
    '--permission-mode', 'dontAsk', '--allowedTools', 'mcp__chess__*',
    '--no-session-persistence', '--model', model,
  ];
  const extra =
    variant === 'agent'
      ? ['--agent', 'coach-spike']
      : variant === 'lean'
        ? ['--system-prompt-file', promptFile, '--tools', '', '--setting-sources', 'project', '--disable-slash-commands']
        : ['--system-prompt-file', promptFile, '--tools', ''];
  const t0 = Date.now();
  const child = spawn(CLAUDE, [...common, ...extra], { cwd: here, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const coach = { child, t0, init: null, results: [], stderr: '', onResult: () => {}, onInit: () => {} };
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.type === 'system' && o.subtype === 'init') {
        coach.init = { t: Date.now(), model: o.model, tools: o.tools, mcp: o.mcp_servers, skills: o.skills?.length, plugins: o.plugins?.length };
        coach.onInit(coach.init);
      } else if (o.type === 'result') {
        const r = { t: Date.now(), usage: o.usage, cost: o.total_cost_usd, isError: o.is_error, apiMs: o.duration_api_ms, turns: o.num_turns };
        coach.results.push(r);
        coach.onResult(r);
      }
    }
  });
  child.stderr.on('data', (d) => (coach.stderr += d.toString('utf8')));
  return coach;
}

function send(coach, event) {
  coach.child.stdin.write(
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: JSON.stringify(event) }] } }) + '\n',
  );
}

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms))]);
// a result line that arrives at or after time t
const resultAfter = (coach, t) => {
  const hit = coach.results.find((r) => r.t >= t);
  return hit ? Promise.resolve(hit) : new Promise((res) => (coach.onResult = (r) => { if (r.t >= t) res(r); }));
};

const FACTS = [
  'Your knight on f3 has no defender.',
  'Their bishop on b4 attacks your knight on c3.',
  'After the capture on e5 you win a pawn.',
  'Their queen on h4 attacks the pawn on f2.',
  'Your rook on a1 is not yet in the game.',
  'Their knight on g4 attacks the pawn on f2.',
  'Your king is still in the centre.',
  'Their pawn on e4 attacks your knight on f3.',
  'Your bishop on c4 attacks the pawn on f7.',
  'Their rook on e8 is on the same file as your king.',
  'Your queen on d1 is defended by the rook.',
  'Their pawn on d5 attacks your bishop on c4.',
  'Your pawn on h2 is attacked twice.',
];
function makeEvent() {
  board.seq += 1;
  return { seq: board.seq, kind: 'owner_move', mode: 'analysis', facts: [{ id: `P${board.seq}.F1`, text: FACTS[board.seq % FACTS.length] }], budget: { sentences: 1 } };
}

async function roundTrip(coach) {
  const ev = makeEvent();
  const t0 = Date.now();
  send(coach, ev);
  const say = await withTimeout(waitSay(ev.seq), 90_000, `say for seq ${ev.seq}`);
  const res = await withTimeout(resultAfter(coach, say.t), 90_000, `result for seq ${ev.seq}`);
  return { seq: ev.seq, saySeq: say.seq, sayMs: say.t - t0, resultMs: res.t - t0, usage: res.usage, cost: res.cost };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ---------------------------------------------------------------- the run
const report = { model, variant, when: new Date().toISOString() };
let coach = startCoach();
try {
  // 1. sequential events
  const trips = [];
  for (let i = 0; i < nEvents; i++) {
    const r = await roundTrip(coach);
    if (i === 0) r.spawnToInitMs = coach.init ? coach.init.t - coach.t0 : null;
    trips.push(r);
    console.error(`event ${r.seq}: say ${r.sayMs} ms, result ${r.resultMs} ms, in ${r.usage?.input_tokens}+${r.usage?.cache_read_input_tokens}r+${r.usage?.cache_creation_input_tokens}w out ${r.usage?.output_tokens}`);
  }
  report.init = coach.init;
  report.trips = trips.map(({ seq, saySeq, sayMs, resultMs }) => ({ seq, saySeq, sayMs, resultMs }));
  report.firstSayMs = trips[0].sayMs;
  report.medianSayMs = median(trips.map((t) => t.sayMs));
  report.medianSayMsWarm = median(trips.slice(1).map((t) => t.sayMs));
  report.medianResultMs = median(trips.map((t) => t.resultMs));
  report.maxSayMs = Math.max(...trips.map((t) => t.sayMs));
  const u = (x) => x && { in: x.input_tokens, cacheRead: x.cache_read_input_tokens, cacheWrite: x.cache_creation_input_tokens, out: x.output_tokens };
  report.usageFirst = u(trips[0].usage);
  report.usageLast = u(trips.at(-1).usage);
  report.costTotalUsd = trips.at(-1).cost;
  report.misordered = trips.filter((t) => t.seq !== t.saySeq).length;

  // 2. two events back to back (the second is written while the first is being answered)
  const before = shown.length;
  const resultsBefore = coach.results.length;
  const a = makeEvent();
  send(coach, a);
  const b = makeEvent(); // the board moves on at once: the reply to A is now stale by the app's own rule
  send(coach, b);
  const sayB = await withTimeout(waitSay(b.seq), 90_000, 'back-to-back B');
  await withTimeout(resultAfter(coach, sayB.t), 90_000, 'result after B');
  await new Promise((r) => setTimeout(r, 1500));
  const sayA = sayLog.get(a.seq);
  report.backToBack = {
    a: a.seq, b: b.seq,
    aAnswered: !!sayA, aRefusedAsStale: sayA ? sayA.stale : null, bAccepted: sayB.stale === false,
    acceptedCount: shown.length - before, aBeforeB: sayA ? sayA.t <= sayB.t : null,
    resultLines: coach.results.length - resultsBefore,
  };

  // 3. stale: the owner moves on before the coach answers
  const staleEv = makeEvent();
  const shownBefore = shown.length;
  send(coach, staleEv);
  board.seq += 1; // the board moved on; no event sent for it yet
  const staleSay = await withTimeout(waitSay(staleEv.seq), 90_000, 'stale say');
  await withTimeout(resultAfter(coach, staleSay.t), 90_000, 'stale result');
  const callsAfter = calls.filter((c) => c.t >= staleSay.t).map((c) => ({ tool: c.tool, seq: c.seq, stale: c.stale }));
  report.stale = { eventSeq: staleEv.seq, boardSeq: board.seq, refused: staleSay.stale === true, shownAdded: shown.length - shownBefore, callsAfterRefusal: callsAfter };

  // 4. kill and restart
  const tKill = Date.now();
  coach.child.kill();
  await new Promise((r) => coach.child.once('exit', r));
  coach = startCoach();
  const again = await roundTrip(coach);
  report.restart = { killToSayMs: Date.now() - tKill, spawnToInitMs: coach.init.t - coach.t0, sayMs: again.sayMs, ordered: again.seq === again.saySeq, };

  report.shownCount = shown.length;
  report.toolCalls = calls.length;
  report.sample = shown.slice(0, 3).map((s) => s.text);
  report.pass = {
    medianUnder4s: model.includes('haiku') ? report.medianSayMs < 4000 : null,
    noLostOrMisordered: report.misordered === 0 && report.backToBack.bAccepted && report.backToBack.aBeforeB !== false,
    staleRefused: report.stale.refused && report.stale.shownAdded === 0,
    restartWorks: report.restart.ordered,
  };
} catch (e) {
  report.error = String(e?.message ?? e);
  report.stderrTail = coach.stderr.slice(-800);
  report.calls = calls.slice(-5);
} finally {
  coach.child.kill();
  httpServer.close();
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.error ? 1 : 0);
