// Authoring a repertoire's words (PLAN WP 8.6, 8.13; the author-repertoire skill, COACH §8).
//
//   node tools/author.ts list                       the repertoires, with their ids
//   node tools/author.ts chapters <id>              its chapters, in teaching order, with how many
//                                                   positions of mine have their words
//   node tools/author.ts sheet <id> [file.json]     the worksheet: every position of mine once, with the
//        [--chapter "<name>"] [--missing]           move, the opponent's last move, and the facts the words
//        [--depth N]                                may state (printed, or written to the file to fill in);
//                                                   one chapter, only the positions still without words,
//                                                   only my first N moves of each line
//   node tools/author.ts apply <id> <file.json>     keep the words written in the file; V3 checks every
//        [--full]                                   sentence, on the lines through those positions (every
//                                                   gate on every line with --full)
//
// The words are written by a person or by Claude in a terminal session, from the facts on the sheet
// only; they are checked like live coach messages (V3), and a position whose words fail quarantines
// the lines through it. Engine work: run it on mains power. CHESS_COACH_DATA picks the data folder.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXPLORER_SPEEDS, buildProfile, compileLadder, depthFor, levelBuckets, readExplorer, type ConceptLadderFile, type ReplySource, type VocabularyLevel } from '@chess-coach/core';
import { config } from '../packages/server/src/config.ts';
import { Db } from '../packages/server/src/db.ts';
import { EngineService } from '../packages/server/src/engine/service.ts';
import { LichessExplorer } from '../packages/server/src/explorer.ts';
import { FactService } from '../packages/server/src/facts-service.ts';
import { realHttp } from '../packages/server/src/importers.ts';
import { OpeningBook } from '../packages/server/src/openings.ts';
import { RepertoireService } from '../packages/server/src/repertoire.ts';
import { mastersBook } from '../packages/server/src/book.ts';
import { Settings } from '../packages/server/src/settings.ts';

const argv = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, v !== undefined && !v.startsWith('--') ? 2 : 1);
  return v !== undefined && !v.startsWith('--') ? v : '';
};
const chapter = option('--chapter');
const missing = option('--missing') !== undefined;
const depthOnly = option('--depth');
const full = option('--full') !== undefined;
const [command, idText, file] = argv;
const usage = () => {
  console.error('usage: node tools/author.ts list | chapters <id> | sheet <id> [file.json] [--chapter "<name>"] [--missing] [--depth N] | apply <id> <file.json> [--full]');
  process.exit(1);
};
if (!command || !['list', 'chapters', 'sheet', 'apply'].includes(command)) usage();

const dbFile = path.join(config.dataDir, 'chess-coach.sqlite');
const db = new Db(dbFile);
if (command === 'list') {
  for (const r of db.repertoires()) console.log(`${r.id}  ${r.name} (${r.colour})  ${r.source}  updated ${r.updatedAt.slice(0, 10)}`);
  db.close();
  process.exit(0);
}
const id = Number(idText);
if (!Number.isInteger(id) || !db.repertoire(id)) {
  console.error(`there is no repertoire ${idText ?? ''}: node tools/author.ts list`);
  process.exit(1);
}
if (command === 'apply' && !file) usage();

const settings = new Settings(db);
const engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 2, analysisWorkers: 6, expectedBench: config.expectedBench, cache: db.engineCache });
await engine.verify();
const facts = new FactService(engine, { nodes: settings.get<number>('engine.quickNodes'), verdictNodes: settings.get<number>('engine.verdictNodes') });
const book = OpeningBook.load(config.openingsDir);
facts.book = (fen) => book.at(fen);
facts.useCloud = false;
const ladder = compileLadder(JSON.parse(readFileSync(config.ladderFile, 'utf8')) as ConceptLadderFile);
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
const depth = settings.get<string>('repertoire.depth');
const reps = new RepertoireService({
  db,
  engine,
  replies,
  // a repertoire built from the book is checked against the masters' games (kept; asked only for a position never seen)
  book: mastersBook(explorer),
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
  onProgress: (p) => process.stderr.write(`\r${p.step} ${p.done}/${p.total}      `),
});

let exit = 0;
if (command === 'chapters') {
  let positions = 0;
  let written = 0;
  for (const c of reps.wordsByChapter(id)) {
    positions += c.positions;
    written += c.written;
    console.log(`${String(c.written).padStart(5)}/${String(c.positions).padEnd(5)} ${String(c.lines).padStart(4)} lines  ${c.chapter}`);
  }
  console.log(`\n${written} of ${positions} positions of mine have their words.`);
} else if (command === 'sheet') {
  const sheet = await reps.worksheet(id, { chapter: chapter || undefined, missing, depth: depthOnly ? Number(depthOnly) : undefined });
  if (file) {
    writeFileSync(file, `${JSON.stringify(sheet.map((x) => ({ key: x.key, chapter: x.chapter, line: x.line, move: x.move, last: x.last, facts: x.facts, why: x.why ?? '', idea: x.idea ?? '' })), null, 2)}\n`);
    console.log(`${sheet.length} positions written to ${file}: fill in "why" (and "idea" where the opponent has just moved), then: node tools/author.ts apply ${id} ${file}`);
  } else {
    for (const x of sheet) {
      console.log(`\n${x.line}   (my move: ${x.move}${x.last ? `; their last move: ${x.last}` : ''})`);
      for (const f of x.facts) console.log(`   · ${f}`);
      if (x.why || x.idea) console.log(`   why: ${x.why ?? ''}\n   idea: ${x.idea ?? ''}`);
    }
  }
} else {
  const entries = JSON.parse(readFileSync(file!, 'utf8')) as { key: string; why?: string; idea?: string }[];
  const r = await reps.setWords(id, entries, { full });
  process.stderr.write('\n');
  if (!r.ok) {
    console.error(r.reason);
    exit = 1;
  } else {
    if (r.unknown.length) console.log(`${r.unknown.length} entries are not positions of mine in this repertoire (left out).`);
    const words = r.report.quarantine.filter((q) => q.reasons.some((x) => x.startsWith('V3')));
    console.log(words.length ? `The words failed at ${words.length} ${words.length === 1 ? 'line' : 'lines'}:` : 'Every sentence passed V3.');
    for (const q of words) console.log(`   ✗ ${q.line}\n     ${q.reasons.filter((x) => x.startsWith('V3')).join('\n     ')}`);
    console.log(`${r.report.lines} lines: ${r.report.quarantined} in quarantine, ${r.report.verified} waiting, ${r.report.live} live.`);
    exit = words.length ? 2 : 0;
  }
}
explorer.stop();
await engine.stop();
db.close();
process.exit(exit);
