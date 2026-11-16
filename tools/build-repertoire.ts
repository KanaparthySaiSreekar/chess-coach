// Building a repertoire from the book around an outline (PLAN WP 8.12; features D10, D11).
//
//   npm run content:build -- --check                 read and check every outline in content/repertoires/
//   npm run content:build -- <outline id or file>     build it (or build it again): the masters' games at the
//                                                     explorer's pace, the engine on every move of mine, then
//                                                     every gate; the lines wait for the owner's approval
//   npm run content:build -- remove <id> --yes        remove a repertoire for good (logged first)
//
// Long engine work and thousands of paced explorer calls (hours, the first time): on mains power (it
// pauses on battery; --battery runs anyway). Stop it with Ctrl+C and run it again: every answer is kept,
// so it picks up where it was. CHESS_COACH_DATA picks the data folder.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { EXPLORER_SPEEDS, REPLY_FLOOR, buildProfile, compileLadder, depthFor, levelBuckets, type ConceptLadderFile, type VocabularyLevel } from '@chess-coach/core';
import { levelReplies, mastersBook, otherJob, outlineFiles } from '../packages/server/src/book.ts';
import { config } from '../packages/server/src/config.ts';
import { ContentDesk } from '../packages/server/src/content-desk.ts';
import { Db } from '../packages/server/src/db.ts';
import { onAcPower } from '../packages/server/src/engine/power.ts';
import { EngineService } from '../packages/server/src/engine/service.ts';
import { LichessExplorer } from '../packages/server/src/explorer.ts';
import { FactService } from '../packages/server/src/facts-service.ts';
import { realHttp } from '../packages/server/src/importers.ts';
import { OpeningBook } from '../packages/server/src/openings.ts';
import { RepertoireService } from '../packages/server/src/repertoire.ts';
import { Settings } from '../packages/server/src/settings.ts';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const words = args.filter((a) => !a.startsWith('--'));
const dir = path.join(config.repoRoot, 'content', 'repertoires');
const usage = () => {
  console.error('usage: npm run content:build -- --check | <outline id or file> [--battery] | remove <repertoire id> --yes');
  process.exit(1);
};

if (flags.has('--check')) {
  let bad = 0;
  for (const o of outlineFiles(dir)) {
    if (o.problems.length) bad++;
    console.log(`${o.problems.length ? '✗' : '✓'} ${o.id}: ${o.name}${o.outline ? ` (${o.outline.colour}, ${o.outline.chapters.length} chapters)` : ''}`);
    for (const p of o.problems) console.log(`    ${p}`);
  }
  process.exit(bad ? 2 : 0);
}

const dbFile = path.join(config.dataDir, 'chess-coach.sqlite');
const db = new Db(dbFile);

if (words[0] === 'remove') {
  const id = Number(words[1]);
  const rep = Number.isInteger(id) ? db.repertoire(id) : undefined;
  if (!rep) {
    console.error(`there is no repertoire ${words[1] ?? ''}`);
    process.exit(1);
  }
  if (!flags.has('--yes')) {
    console.error(`this removes "${rep.name}" (${db.repertoireItems(id).length} lines, its words and its drill cards) for good: add --yes`);
    process.exit(1);
  }
  const r = new ContentDesk(db).removeRepertoire(id);
  console.log(r.ok ? `removed "${rep.name}": ${r.lines} lines, ${r.cards} drill cards (logged as repertoire_removed)` : r.reason);
  db.close();
  process.exit(r.ok ? 0 : 1);
}

if (!words[0]) usage();
const pick = words[0]!.replace(/\\/g, '/').split('/').at(-1)!.replace(/\.json$/, '');
const entry = outlineFiles(dir).find((o) => o.id === pick);
if (!entry) {
  console.error(`no outline "${pick}" in content/repertoires/: npm run content:build -- --check`);
  process.exit(1);
}
if (!entry.outline) {
  console.error(`${entry.id} cannot be built:\n  ${entry.problems.join('\n  ')}`);
  process.exit(2);
}
const outline = entry.outline;

if (!config.lichessToken()) {
  console.error("there is no Lichess token in .env: the masters' games cannot be asked for");
  process.exit(1);
}

// only one long job on the content at a time (the server asks the same question). A finished job
// leaves process 0 behind, which is no job: on Windows, asking whether process 0 is alive says yes.
const busy = otherJob(db);
if (busy) {
  console.error(`another job is working on the content (${busy}): wait for it`);
  process.exit(1);
}
db.syncSet('content.job', { pid: process.pid, what: `building ${outline.id}` });

const battery = flags.has('--battery');
if ((await onAcPower()) === false && !battery) {
  console.error('the laptop is on battery: this is hours of engine work. Plug it in, or add --battery to run anyway.');
  db.syncSet('content.job', { pid: 0, what: '' });
  process.exit(1);
}

const settings = new Settings(db);
const engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 2, analysisWorkers: 12, expectedBench: config.expectedBench, cache: db.engineCache });
await engine.verify();
const facts = new FactService(engine, { nodes: settings.get<number>('engine.quickNodes'), verdictNodes: settings.get<number>('engine.verdictNodes') });
const names = OpeningBook.load(config.openingsDir);
facts.book = (fen) => names.at(fen);
facts.useCloud = false;
const ladder = compileLadder(JSON.parse(readFileSync(config.ladderFile, 'utf8')) as ConceptLadderFile);
const explorer = new LichessExplorer({ db, http: realHttp, token: config.lichessToken });
const band = buildProfile(db.profileGames(['rapid', 'classical', 'daily', 'unknown'])).band;
const ratingPick = settings.get<string>('explorer.ratings');
const ratings = ratingPick === 'auto' ? levelBuckets(band?.about) : [Number(ratingPick)];
const speeds = EXPLORER_SPEEDS[settings.get<'yours' | 'all'>('explorer.speeds')] ?? EXPLORER_SPEEDS.yours;
const depth = settings.get<string>('repertoire.depth');
const reps = new RepertoireService({
  db,
  engine,
  replies: async () => null,
  book: mastersBook(explorer),
  level: levelReplies(explorer, () => ({ ratings, speeds })),
  openingName: (fens) => names.lookup(fens)?.name,
  words: { facts, ladder, vocabulary: () => settings.get<VocabularyLevel>('coach.vocabulary') },
  dataDir: config.dataDir,
  dbFile,
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
  onProgress: (p) => {
    if (p.step !== 'build') process.stderr.write(`\r  gates: ${p.step} ${p.done}/${p.total}          `);
  },
});

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.error('\nstopping after this batch (Ctrl+C again to quit at once); run it again to pick up where it was');
});
const started = Date.now();
let lastPower = 0;
const wait = async (): Promise<'go' | 'stop'> => {
  for (;;) {
    if (stopping) return 'stop';
    if (battery || Date.now() - lastPower < 60_000) return 'go';
    lastPower = Date.now();
    if ((await onAcPower()) !== false) return 'go';
    process.stderr.write('\r  on battery: paused until the laptop is plugged in…          ');
    await new Promise((r) => setTimeout(r, 60_000));
    lastPower = 0;
  }
};
const minutes = () => `${Math.round((Date.now() - started) / 60_000)} min`;
const budget = settings.get<number>('repertoire.outlineLines');
console.log(`building ${outline.name}: up to ${budget} lines, ${settings.get<string>('repertoire.buildDepth')} of my moves deep, every move in at least ${settings.get<number>('repertoire.bookMinGames')} of the masters' games`);
let exit = 0;
try {
  const r = await reps.buildFromOutline(outline, {
    hash: entry.hash,
    level: band?.band ?? '400–700',
    depth: Number(settings.get<string>('repertoire.buildDepth')),
    budget,
    minGames: settings.get<number>('repertoire.bookMinGames'),
    outlineReach: settings.get<number>('repertoire.outlineReach'),
    bookRule: { minCovered: settings.get<number>('repertoire.bookCovered'), flagShare: settings.get<number>('repertoire.flagShare'), floor: settings.get<number>('repertoire.bookFloor') },
    levelRule: { minCovered: settings.get<number>('repertoire.minCovered'), flagShare: settings.get<number>('repertoire.flagShare'), floor: REPLY_FLOOR },
    batch: 16,
    wait,
    progress: (p) => process.stderr.write(`\r  ${minutes()}: ${p.lines} lines, ${p.prepared} positions prepared, ${p.waiting} waiting; engine ${engine.stats.searches} searches (${engine.stats.cacheHits} kept)          `),
  });
  process.stderr.write('\n');
  if (r.stopped) {
    console.log(`stopped after ${minutes()}: nothing saved. Run it again to pick up where it was.`);
    exit = 3;
  } else {
    const rep = r.report;
    console.log(`\n${rep.name}: ${rep.lines} lines in ${minutes()}: ${rep.quarantined} in quarantine, ${rep.verified} waiting for your approval, ${rep.live} live, ${rep.flagged} flagged.`);
    console.log(`the book: ${r.plan.built.prepared} positions prepared${r.plan.built.cut !== null ? `; positions met in under ${r.plan.built.cut.toFixed(2)}% of the masters' games were left out for the ${budget}-line budget` : '; the book ran out before the budget'}`);
    console.log('\nchapters:');
    for (const c of r.plan.built.chapters) console.log(`  ${String(c.lines).padStart(4)}  ${c.name}${c.auto ? '  (not in the outline)' : ''}`);
    if (r.plan.built.notes.length) {
      console.log(`\nnotes (${r.plan.built.notes.length}):`);
      for (const n of r.plan.built.notes.slice(0, 40)) console.log(`  · ${n}`);
      if (r.plan.built.notes.length > 40) console.log(`  … and ${r.plan.built.notes.length - 40} more (kept with the repertoire)`);
    }
    if (rep.quarantine.length) {
      console.log('\nin quarantine:');
      for (const q of rep.quarantine.slice(0, 30)) console.log(`  ✗ ${q.line}\n    ${q.reasons.join('\n    ')}`);
    }
    console.log(`\nspot check (${rep.sample.length} lines): ${rep.sample.slice(0, 10).map((s) => s.line).join(' | ')}${rep.sample.length > 10 ? ' …' : ''}`);
    console.log(`\nengine: ${engine.stats.searches} searches, ${engine.stats.cacheHits} answers kept from before. Look the lines over under Review content, chapter by chapter.`);
  }
} catch (e) {
  process.stderr.write('\n');
  console.error(`the build stopped: ${(e as Error).message}`);
  exit = 1;
} finally {
  db.syncSet('content.job', { pid: 0, what: '' });
}
explorer.stop();
await engine.stop();
db.close();
process.exit(exit);
