// Development aid: the coach's last messages with the validator's verdicts.
//   node tools/coach-log.mjs 20
//   CHESS_COACH_DATA=some/other/data node tools/coach-log.mjs 20     (a server run with another data folder)
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const file = path.join(process.env.CHESS_COACH_DATA ?? 'data', 'chess-coach.sqlite');
const db = new DatabaseSync(file, { readOnly: true });
const n = Number(process.argv[2] ?? 20);
const rows = db.prepare('SELECT at, source, kind, text, claims, verdict, problems FROM coach_messages ORDER BY id DESC LIMIT ?').all(n).reverse();
for (const r of rows) {
  console.log(`${r.at.slice(11, 19)} ${r.verdict === 'ok' ? 'OK      ' : 'REJECTED'} ${r.source}/${r.kind}  claims ${r.claims}`);
  console.log(`   ${r.text}`);
  if (r.verdict !== 'ok') for (const p of JSON.parse(r.problems)) console.log(`   ✗ ${p.rule}: ${p.message}`);
}
db.close();
