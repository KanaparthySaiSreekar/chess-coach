// The gate runner's command (CONTENT §12; features J2, J3).
//
//   npm run content:validate -- <file.json>        run the gates over the items in a file and print the report
//   npm run content:validate -- <id>               run them again over a stored item
//   npm run content:validate -- <file.json> --save also keep the items, with their status, in the database
//   npm run content:validate -- --repertoire <white|black> <file.pgn> [--save]   a repertoire PGN through V1–V7 (WP 8.3)
//
// A file holds one item or a list of items: { type, source, licence, level, body }. For a puzzle
// the body is { fen, setup?, solution, accepted?, themes, kind, explanation? }.
// Engine work: run it on mains power. It uses the same engine, facts and validator as the app,
// on Stockfish alone (no Lichess cloud), so a report depends only on the item and the settings.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EXPLORER_SPEEDS, buildProfile, compileLadder, depthFor, levelBuckets, quarantineReasons, readExplorer, type ConceptLadderFile, type ContentItem, type Puzzle, type ReplySource, type VocabularyLevel } from '@chess-coach/core';
import { config } from '../packages/server/src/config.ts';
import { ContentService } from '../packages/server/src/content.ts';
import { Db } from '../packages/server/src/db.ts';
import { EngineService } from '../packages/server/src/engine/service.ts';
import { LichessExplorer } from '../packages/server/src/explorer.ts';
import { realHttp } from '../packages/server/src/importers.ts';
import { RepertoireService } from '../packages/server/src/repertoire.ts';
import { FactService } from '../packages/server/src/facts-service.ts';
import { OpeningBook } from '../packages/server/src/openings.ts';
import { Settings } from '../packages/server/src/settings.ts';

const args = process.argv.slice(2);
const what = args.find((a) => !a.startsWith('--'));
const save = args.includes('--save');
if (!what) {
  console.error('usage: npm run content:validate -- <file.json | id> [--save]');
  process.exit(1);
}

const dbFile = path.join(config.dataDir, 'chess-coach.sqlite');
const db = new Db(dbFile);
const settings = new Settings(db);
const engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 2, analysisWorkers: 6, expectedBench: config.expectedBench, cache: db.engineCache });
await engine.verify();
const facts = new FactService(engine, { nodes: settings.get<number>('engine.quickNodes'), verdictNodes: settings.get<number>('engine.verdictNodes') });
const book = OpeningBook.load(config.openingsDir);
facts.book = (fen) => book.at(fen);
facts.useCloud = false;
const ladder = compileLadder(JSON.parse(readFileSync(config.ladderFile, 'utf8')) as ConceptLadderFile);
const content = new ContentService({
  db,
  engine,
  facts,
  ladder,
  dataDir: config.dataDir,
  dbFile,
  options: () => ({ nodes: settings.get<number>('content.gateNodes'), vocabulary: settings.get<VocabularyLevel>('coach.vocabulary'), autoApprove: settings.get<boolean>('content.autoApprovePuzzles') }),
});

// a repertoire PGN for one side (WP 8.3): every line through V1–V7, the report printed
const repAt = args.indexOf('--repertoire');
if (repAt >= 0) {
  const colour = args[repAt + 1];
  const file = args.find((a, i) => !a.startsWith('--') && i !== repAt + 1);
  if ((colour !== 'white' && colour !== 'black') || !file) {
    console.error('usage: npm run content:validate -- --repertoire <white|black> <file.pgn> [--save]');
    process.exit(1);
  }
  // the explorer's answers are kept in the app's database either way, so nothing is asked twice
  const explorer = new LichessExplorer({ db, http: realHttp, token: config.lichessToken });
  const band = buildProfile(db.profileGames(['rapid', 'classical', 'daily', 'unknown'])).band;
  const pick = settings.get<string>('explorer.ratings');
  const ratings = pick === 'auto' ? levelBuckets(band?.about) : [Number(pick)];
  const speeds = EXPLORER_SPEEDS[settings.get<'yours' | 'all'>('explorer.speeds')] ?? EXPLORER_SPEEDS.yours;
  const replies = async (fen: string): Promise<ReplySource | null> => {
    const r = await explorer.ask({ db: 'lichess', fen, ratings, speeds }, { batch: true });
    const t = r.ok ? readExplorer(fen, r.raw) : null;
    return t && t.games >= 20 ? { source: 'explorer', games: t.games, replies: t.rows.map((x) => ({ uci: x.uci, san: x.san, share: x.share })) } : null;
  };
  const repDb = save ? db : new Db(':memory:');
  const depth = settings.get<string>('repertoire.depth');
  const reps = new RepertoireService({
    db: repDb,
    engine,
    replies,
    dataDir: config.dataDir,
    dbFile: save ? dbFile : ':memory:',
    options: () => ({
      nodes: settings.get<number>('content.gateNodes'),
      secondNodes: settings.get<number>('repertoire.secondNodes'),
      maxDrop: settings.get<number>('repertoire.maxDrop'),
      minCovered: settings.get<number>('repertoire.minCovered'),
      flagShare: settings.get<number>('repertoire.flagShare'),
      depthMoves: depth === 'auto' ? depthFor(band?.band) : Number(depth),
      thresholds: { inaccuracy: settings.get<number>('grading.inaccuracy'), mistake: settings.get<number>('grading.mistake'), blunder: settings.get<number>('grading.blunder') },
      autoApprove: settings.get<boolean>('repertoire.autoApprove'),
    }),
    onProgress: (p) => process.stderr.write(`\r${p.step} ${p.done}/${p.total}      `),
  });
  const report = await reps.importPgn(readFileSync(file, 'utf8'), { name: path.basename(file, path.extname(file)), colour, source: `file:${path.basename(file)}#1`, licence: 'private', level: band?.band ?? '400–700' });
  process.stderr.write('\n');
  console.log(`\n${report.name} (${colour}): ${report.lines} lines, ${report.quarantined} quarantined, ${report.flagged} with a gap flagged, ${report.duplicates} duplicates dropped${save ? ` · saved as repertoire ${report.id}` : ''}`);
  for (const s of report.skipped) console.log(`   left out: ${s.chapter}: ${s.reason}`);
  for (const q of report.quarantine) console.log(`\n   ✗ ${q.line}\n     ${q.reasons.join('\n     ')}`);
  const gaps = report.coverage.filter((c) => !c.ok);
  if (gaps.length) console.log(`\n   Gaps (V4):`);
  for (const c of gaps) console.log(`     after ${c.at}: ${c.covered}% covered${c.missing.length ? `; missing ${c.missing.map((m) => `${m.san} ${m.share}%`).join(', ')}` : ''}`);
  console.log(`\n   For your spot check: ${report.sample.map((x) => x.line).join(' · ') || 'nothing passed'}`);
  console.log(`   ${Object.entries(report.gates).map(([g, t]) => `${g} ${t!.pass}✓ ${t!.fail}✗${t!.flag ? ` ${t!.flag}⚑` : ''}`).join('  ')}`);
  explorer.stop();
  await engine.stop();
  if (!save) repDb.close();
  db.close();
  process.exit(report.quarantined ? 2 : 0);
}

let items: ContentItem<Puzzle>[];
if (/^\d+$/.test(what)) {
  const stored = db.getContent(Number(what));
  if (!stored) {
    console.error(`there is no content item ${what}`);
    process.exit(1);
  }
  items = [stored];
} else {
  const raw = JSON.parse(readFileSync(what, 'utf8')) as Partial<ContentItem<Puzzle>> | Partial<ContentItem<Puzzle>>[];
  items = (Array.isArray(raw) ? raw : [raw]).map((x) => ({ status: 'draft', gates: [], ...x }) as ContentItem<Puzzle>);
}

let quarantined = 0;
for (const [i, item] of items.entries()) {
  const out = save || item.id !== undefined ? await content.submit(item) : await content.validate(item);
  if (out.status === 'quarantined') quarantined++;
  console.log(`\n${i + 1}. ${out.type} · ${out.source}${'id' in out && out.id !== undefined ? ` · id ${out.id}` : ''}`);
  console.log(`   ${out.body.solution.join(' ')}${out.body.setup ? `  (after ${out.body.setup})` : ''}  from  ${out.body.fen}`);
  for (const g of out.gates) console.log(`   ${g.gate}  ${g.result.padEnd(4)} ${g.detail ?? ''}`);
  console.log(`   → ${out.status}${out.status === 'quarantined' ? `\n     ${quarantineReasons(out).join('\n     ')}` : ''}`);
}
console.log(`\n${items.length} ${items.length === 1 ? 'item' : 'items'}: ${items.length - quarantined} passed, ${quarantined} quarantined${save ? ' (saved)' : ''}`);
await engine.stop();
db.close();
process.exit(quarantined ? 2 : 0);
