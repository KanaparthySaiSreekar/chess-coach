// Golden files for the fact builder (PLAN WP 4.3: "golden files for 30 positions").
//
// For 30 positions this keeps two things in packages/core/test/fixtures/golden/:
//   inputs.json   exactly what the fact builder was given (the engine's lines, searched once at a
//                 fixed node count, with Stockfish alone: no Lichess cloud);
//   packets.json  what the coach is handed for each (the facts in words, and the verdicts).
// The test (golden.test.ts) builds every packet again from inputs.json, with no engine, and
// compares it with packets.json. A difference means the facts changed: if that was meant, run
//
//   node tools/make-golden.ts            rebuild packets.json from the stored inputs, print what changed
//   node tools/make-golden.ts --engine   search every position again first (after an engine change)
//
// and read the changes before keeping them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { START_FEN, buildFactPacket, describeMove, mustPosition, packetForCoach, playLine, uciToMove, type Color, type FactInput, type FactPacket } from '@chess-coach/core';
import { config } from '../packages/server/src/config.ts';
import { EngineService } from '../packages/server/src/engine/service.ts';
import { FactService } from '../packages/server/src/facts-service.ts';
import { OpeningBook } from '../packages/server/src/openings.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'packages', 'core', 'test', 'fixtures', 'golden');
const inputsFile = path.join(dir, 'inputs.json');
const packetsFile = path.join(dir, 'packets.json');

type Position = { key: string; about: string; fen: string; you: Color; lastMove?: { san: string; by: 'owner' | 'opponent'; fenBefore: string } };

const fromMoves = (key: string, about: string, you: Color, moves: string): Position => {
  const r = playLine(START_FEN, moves.split(/\s+/).filter(Boolean));
  if (!r.ok) throw new Error(`${key}: illegal move ${r.move}`);
  const mover: Color = r.infos.at(-1)!.color;
  return { key, about, you, fen: r.fens.at(-1)!, lastMove: { san: r.infos.at(-1)!.san, by: mover === you ? 'owner' : 'opponent', fenBefore: r.fens.at(-2)! } };
};
const setUp = (key: string, about: string, you: Color, fen: string): Position => ({ key, about, you, fen });
/** A position from the Lichess puzzle sample: after the puzzle's first move, the solver (the owner) to play. */
const fromPuzzle = (key: string, about: string, id: string): Position => {
  const sample = JSON.parse(readFileSync(path.join(root, 'packages', 'core', 'test', 'fixtures', 'puzzles', 'sample.json'), 'utf8')) as { tagged: Record<string, { id: string; fen: string; moves: string[] }[]>; pool: { id: string; fen: string; moves: string[] }[] };
  const row = [...sample.pool, ...Object.values(sample.tagged).flat()].find((r) => r.id === id);
  if (!row) throw new Error(`puzzle ${id} is not in the sample`);
  const pos = mustPosition(row.fen);
  const info = describeMove(pos, uciToMove(pos, row.moves[0]!)!);
  return { key, about, you: info.color === 'white' ? 'black' : 'white', fen: info.fenAfter, lastMove: { san: info.san, by: 'opponent', fenBefore: row.fen } };
};

// Thirty positions that between them touch every kind of fact: openings, hung pieces, threats,
// forks and pins, mates, the owner's and the other side's last move graded, lost and won games,
// endgames the tablebases know, and puzzle positions for each motif.
const samplePuzzle = (theme: string, n: number): string => {
  const sample = JSON.parse(readFileSync(path.join(root, 'packages', 'core', 'test', 'fixtures', 'puzzles', 'sample.json'), 'utf8')) as { tagged: Record<string, { id: string }[]> };
  return sample.tagged[theme]![n]!.id;
};
const POSITIONS: Position[] = [
  { key: 'start', about: 'The starting position', fen: START_FEN, you: 'white' },
  fromMoves('e4', 'After 1.e4: Black (the owner) to move', 'black', 'e4'),
  fromMoves('italian', 'A quiet Italian Game: White (the owner) to move', 'white', 'e4 e5 Nf3 Nc6 Bc4 Bc5'),
  fromMoves('scholar', "Scholar's Mate threat: Black (the owner) to move", 'black', 'e4 e5 Bc4 Nc6 Qh5'),
  fromMoves('scholar-missed', 'Black (the owner) ignored the mate threat', 'black', 'e4 e5 Bc4 Nc6 Qh5 Nf6'),
  fromMoves('legal', "Legal's trap: White (the owner) to move, the knight can take on e5", 'white', 'e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6'),
  fromMoves('queenfork', 'Black queen attacks the knight on e5 and the pawn on e4: White (the owner) to move', 'white', 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 Nxe5 Qd4'),
  fromMoves('pin', 'Ruy Lopez: the knight on c6 is pinned; the owner is Black and just played d6', 'black', 'e4 e5 Nf3 Nc6 Bb5 d6'),
  fromMoves('hung', 'The owner (White) just put a knight where a pawn takes it', 'white', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Ne6'),
  fromMoves('wayward-queen', 'An early queen raid: Black (the owner) to move', 'black', 'e4 e5 Qh5'),
  fromMoves('fried-liver', 'The Fried Liver: White (the owner) has just sacrificed on f7', 'white', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7'),
  fromMoves('castled', 'Both sides castled in the Italian: White (the owner) to move', 'white', 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3 O-O'),
  fromMoves('qe6-before', "The owner's game, a knight down: Black to move, the owner sits on White's side", 'white', 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 Re1 Nd6 Bf1 f6 d4 Nc4 Bd3 d6 Bxc4 Qe7 a4'),
  fromMoves('qe6', "The owner's game: Black has just hung the queen on e6; the owner sits on White's side", 'white', 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 Re1 Nd6 Bf1 f6 d4 Nc4 Bd3 d6 Bxc4 Qe7 a4 Qe6'),
  fromMoves('qe6-own', 'The same queen hung by the owner, playing Black', 'black', 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 Re1 Nd6 Bf1 f6 d4 Nc4 Bd3 d6 Bxc4 Qe7 a4 Qe6'),
  fromMoves('fools-mate', "Fool's Mate: the game is over", 'white', 'f3 e5 g4 Qh4#'),
  setUp('backrank', 'A back-rank mate in one: White (the owner) to move', 'white', '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1'),
  setUp('knightfork', 'A knight fork of king and rook: White (the owner) to move', 'white', 'r3k3/8/8/1N6/8/8/PPP5/2K5 w - - 0 1'),
  setUp('stalemate', 'Stalemate: Black has no move and is not in check', 'white', '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'),
  setUp('kpk-draw', 'King and pawn against king, a draw: Black (the owner) to move', 'black', '4k3/8/8/4P3/4K3/8/8/8 b - - 0 1'),
  setUp('kpk-win', 'King and pawn against king, a win: White (the owner) to move', 'white', '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1'),
  setUp('kqk', 'King and queen against king: White (the owner) to move', 'white', '8/8/8/4k3/8/8/8/4K2Q w - - 0 1'),
  setUp('krk-defender', 'King and rook against king: the owner defends with Black', 'black', '8/8/8/4k3/8/8/8/4K2R b - - 0 1'),
  setUp('check', 'The owner (Black) is in check and must answer it', 'black', 'rnbqkbnr/ppp2ppp/8/1B1pp3/4P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 3'),
  fromPuzzle('puzzle-fork', 'A fork from the Lichess puzzle database', samplePuzzle('fork', 0)),
  fromPuzzle('puzzle-pin', 'A pin from the Lichess puzzle database', samplePuzzle('pin', 0)),
  fromPuzzle('puzzle-skewer', 'A skewer from the Lichess puzzle database', samplePuzzle('skewer', 0)),
  fromPuzzle('puzzle-hanging', 'A hanging piece from the Lichess puzzle database', samplePuzzle('hangingPiece', 0)),
  fromPuzzle('puzzle-mate2', 'A mate in two from the Lichess puzzle database', samplePuzzle('mateIn2', 0)),
  fromPuzzle('puzzle-trapped', 'A trapped piece from the Lichess puzzle database', samplePuzzle('trappedPiece', 0)),
];
if (POSITIONS.length !== 30) throw new Error(`expected 30 positions, have ${POSITIONS.length}`);

type Stored = { key: string; about: string; input: FactInput };
/** What is compared: the packet as the coach receives it, and the verdict fields code reads. */
export const goldenView = (p: FactPacket) => ({ forCoach: packetForCoach(p), over: p.over, tablebase: p.tablebase, graded: p.graded ? { san: p.graded.san, cls: p.graded.cls, isBest: p.graded.isBest, best: p.graded.best, lost: p.graded.lost } : undefined, lastVerdict: p.lastVerdict ? { san: p.lastVerdict.san, by: p.lastVerdict.by, cls: p.lastVerdict.cls } : undefined, skippedStep: p.skippedStep, hanging: p.hanging });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(dir, { recursive: true });
  let stored: Stored[];
  if (process.argv.includes('--engine') || !existsSync(inputsFile)) {
    const engine = new EngineService({ path: config.stockfish, syzygyPath: config.syzygy, quickWorkers: 4 });
    engine.signature = 'golden';
    const facts = new FactService(engine, { nodes: 250_000 });
    const book = OpeningBook.load(config.openingsDir);
    stored = [];
    for (const p of POSITIONS) {
      let input: FactInput | undefined;
      facts.onInput = (i) => (input = i);
      await facts.packet({ fen: p.fen, you: p.you, lastMove: p.lastMove, opening: book.lookup([p.fen]) });
      if (!input) throw new Error(`${p.key}: nothing was handed to the fact builder`);
      // one id per position, so the facts' ids do not depend on the order of the search
      stored.push({ key: p.key, about: p.about, input: { ...input, id: `G.${p.key}` } });
    }
    await engine.stop();
    writeFileSync(inputsFile, JSON.stringify(stored, null, 1));
    console.log(`searched ${stored.length} positions (250,000 nodes each, Stockfish alone) -> inputs.json`);
  } else {
    stored = JSON.parse(readFileSync(inputsFile, 'utf8')) as Stored[];
  }
  const before: Record<string, unknown> = existsSync(packetsFile) ? JSON.parse(readFileSync(packetsFile, 'utf8')) : {};
  const after: Record<string, unknown> = {};
  let changed = 0;
  for (const s of stored) {
    after[s.key] = goldenView(buildFactPacket(s.input));
    if (JSON.stringify(before[s.key]) !== JSON.stringify(after[s.key])) {
      changed++;
      const was = new Map(((before[s.key] as any)?.forCoach?.facts ?? []).map((f: any) => [f.id, f.text]));
      const now = (after[s.key] as any).forCoach.facts as { id: string; text: string }[];
      console.log(`\n${s.key}: ${s.about}`);
      for (const f of now) if (was.get(f.id) !== f.text) console.log(`  ${was.has(f.id) ? 'changed' : 'new    '} ${f.id}: ${f.text}`);
      for (const [id, text] of was) if (!now.some((f) => f.id === id)) console.log(`  gone    ${id}: ${text}`);
    }
  }
  writeFileSync(packetsFile, JSON.stringify(after, null, 1));
  console.log(`\n${stored.length} packets written; ${changed} differ from what was there before`);
  process.exit(0);
}
