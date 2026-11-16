// Development aid: put the running app back to a clean start (empty conversation, start position,
// White at the bottom, coach stopped, Haiku). Settings other than the model are left alone.
import WebSocket from 'ws';
const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT ?? 5174}/ws`);
const send = (m) => ws.send(JSON.stringify(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let state = null;
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'state') state = m.state;
});
await new Promise((r) => ws.once('open', r));
send({ type: 'hello' });
await sleep(300);
send({ type: 'coach', action: 'stop' });
send({ type: 'demo', action: 'close' });
send({ type: 'new' });
send({ type: 'clear_thread' });
send({ type: 'setting', key: 'coach.model.analysis', value: 'haiku' });
await sleep(300);
if (state?.orientation !== 'white') send({ type: 'flip' });
await sleep(300);
console.log('reset: seq', state?.seq, 'orientation', state?.orientation, 'layer', state?.layer);
ws.close();
