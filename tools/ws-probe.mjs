// Development aid: send a few messages to the running server over its WebSocket and print what
// comes back. Handy for checking a server-side flow without the page.
//   PORT=5174 node tools/ws-probe.mjs '{"type":"demo","action":"goto","line":null,"ply":0}' '{"type":"move","from":"f2","to":"f4"}'
import WebSocket from 'ws';
const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT ?? 5174}/ws`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let state = null;
const seen = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'state') state = m.state;
  else if (m.type === 'toast') seen.push(`toast(${m.level}): ${m.text}`);
  else if (m.type === 'coach_msg') seen.push(`${m.message.from}${m.message.source ? `/${m.message.source}` : ''}: ${m.message.text}`);
  else if (m.type === 'insight') seen.push(`insight: ${m.insight ? `${m.insight.arrows.map((a) => a.san).join(', ') || 'no arrows'}${m.insight.held ? ' (held)' : ''}` : 'off'}`);
  else if (m.type === 'game') seen.push(`game: ${m.game.status}${m.game.thinking ? ', bot thinking' : ''}${m.game.problem ? `, ${m.game.problem}` : ''}`);
});
await new Promise((r) => ws.once('open', r));
ws.send(JSON.stringify({ type: 'hello' }));
await sleep(400);
for (const arg of process.argv.slice(2)) {
  ws.send(arg);
  await sleep(Number(process.env.WAIT ?? 2500));
}
const node = state?.tree.nodes[state.focus];
console.log(`seq ${state?.seq} · layer ${state?.layer} · focus ${node?.san ?? '(start)'} · label ${node?.judged?.label ?? '-'} · bar ${node?.gauge ? Math.round(node.gauge.white) : '-'}`);
if (state?.demo) {
  console.log(`demo "${state.demo.label}" at ${state.demo.cursor.line ?? 'base'}:${state.demo.cursor.ply}`);
  for (const l of state.demo.lines) console.log(`  ${l.id} [${l.kind ?? '?'}] ${l.label}: ${l.moves.map((m) => `${m.san}${m.judged ? `(${m.judged.label})` : ''}`).join(' ')}${l.parent ? `  ← ${l.parent.line}:${l.parent.ply}` : ''}`);
}
for (const line of seen.slice(-12)) console.log(line);
ws.close();
