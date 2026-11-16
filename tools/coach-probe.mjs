// A terminal probe for the live coach: connects to a running server like the page does, sets up
// a position, asks a question, and prints everything that comes back. For development only.
//
//   node tools/coach-probe.mjs "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4" "why is my knight in danger?" [more questions…]
//   options (env): PORT=5174  CHIPS=hint,tell_me  MODEL=haiku|sonnet  WAIT=45000

import WebSocket from 'ws';

const port = process.env.PORT ?? 5174;
const [movesArg = '', ...questions] = process.argv.slice(2);
const waitMs = Number(process.env.WAIT ?? 45000);
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
const send = (m) => ws.send(JSON.stringify(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = null;
let status = null;
const seen = [];
let waiters = [];
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'state') {
    state = m.state;
    if (state.layer === 'demo' && state.demo) {
      const d = state.demo;
      const lines = d.lines.map((l) => `${l.id}${l.parent ? `<${l.parent.line}:${l.parent.ply}` : ''} "${l.label}": ${l.moves.map((x) => x.san + x.mark).join(' ')}`).join(' | ');
      const key = `demo:${lines}`;
      if (!seen.includes(key)) {
        seen.push(key);
        console.log(`${stamp()} [demo board] "${d.label}"  ${lines}`);
      }
    }
    const shapes = state.shapes.coach.map((s) => `${s.style}:${s.from}${s.to ? '→' + s.to : ''}`).join(' ');
    if (shapes && !seen.includes('sh:' + shapes)) {
      seen.push('sh:' + shapes);
      console.log(`${stamp()} [coach draws] ${shapes}`);
    }
  } else if (m.type === 'coach_status') {
    if (!status || status.state !== m.status.state) console.log(`${stamp()} [status] ${m.status.state}${m.status.model ? ' ' + m.status.model : ''}${m.status.detail ? ' — ' + m.status.detail : ''}`);
    status = m.status;
  } else if (m.type === 'coach_msg') {
    const x = m.message;
    const tag = x.from === 'owner' ? 'OWNER' : x.from === 'system' ? 'SYSTEM' : `COACH/${x.source}/${x.kind}${x.expect && x.expect !== 'none' ? ' expects ' + x.expect : ''}`;
    console.log(`${stamp()} [${tag}] ${x.text}`);
    waiters.forEach((w) => w(x));
  } else if (m.type === 'toast') console.log(`${stamp()} [toast] ${m.text}`);
});

const coachReply = () =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), waitMs);
    waiters.push((x) => {
      if (x.from !== 'coach') return;
      clearTimeout(timer);
      resolve(x);
    });
  });
// wait until the coach has been quiet (status ready, no new message) for a moment
async function settle() {
  let last = Date.now();
  waiters.push(() => (last = Date.now()));
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    await sleep(300);
    if (status && (status.state === 'ready' || status.state === 'off' || status.state === 'error') && Date.now() - last > 1500) return;
  }
}

await new Promise((r) => ws.once('open', r));
send({ type: 'hello' });
await sleep(300);
send({ type: 'new' });
await sleep(200);
// SIDE=white|black sets which side the owner plays (the board remembers it between runs)
const side = process.env.SIDE ?? 'white';
if (state.orientation !== side) send({ type: 'flip' });
if (process.env.MODEL) send({ type: 'setting', key: 'coach.model.analysis', value: process.env.MODEL });
if (process.env.VERBOSITY) send({ type: 'setting', key: 'coach.verbosity.analysis', value: process.env.VERBOSITY });
if (process.env.ASKFIRST) send({ type: 'setting', key: 'coach.askFirst', value: process.env.ASKFIRST === 'true' });
await sleep(200);
if (movesArg.trim()) {
  send({ type: 'load', text: movesArg });
  await sleep(300);
  send({ type: 'nav', to: 'end' });
  await sleep(500);
}
console.log(`${stamp()} position: ${state.tree.nodes[state.focus].fen}  (owner plays ${state.orientation})`);
for (const q of questions) {
  waiters = [];
  if (q === 'start') {
    send({ type: 'coach', action: 'start' });
    for (let i = 0; i < 60 && status?.state !== 'ready'; i++) await sleep(250);
    continue;
  }
  if (q.startsWith('wait:')) {
    await sleep(Number(q.slice(5)));
    continue;
  }
  // demo:base steps the coach's board back to its first position (then "move:f2f4" tries a move of your own there)
  if (q === 'demo:base') {
    send({ type: 'demo', action: 'goto', line: null, ply: 0 });
    await sleep(400);
    continue;
  }
  if (q.startsWith('chip:')) send({ type: 'chip', chip: q.slice(5) });
  else if (q.startsWith('move:')) send({ type: 'move', from: q.slice(5, 7), to: q.slice(7, 9) });
  else send({ type: 'ask', text: q });
  const first = await coachReply();
  if (!first) console.log(`${stamp()} (no coach message within ${waitMs / 1000}s)`);
  await settle();
}
if (status) console.log(`${stamp()} usage: ${JSON.stringify(status.usage)} firstTry ${JSON.stringify(status.firstTry)}`);
if (process.env.STOP !== 'false') send({ type: 'coach', action: 'stop' });
await sleep(300);
ws.close();
