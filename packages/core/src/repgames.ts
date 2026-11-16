// The owner's real games against their repertoire (features B6, D5, D7, G3; CONTENT §7 "In real
// games"; PLAN WP 8.10). Each finished game is walked through the repertoire's positions: where it
// left the repertoire, who left it (the owner, with the move the repertoire plays there; or the
// opponent, with the replies it prepares), or where the preparation ran out; and, over all games,
// how each line has gone. Counting only: what to play after an opponent's new move is the engine's,
// on the server.

import { describeMove, mustPosition, positionKey, sanToMove, START_FEN, type Color } from './chess.ts';
import { lineSteps, lineText, type RepLine } from './repertoire.ts';

/** A repertoire for one side as positions: my move in each of my positions, the replies prepared in each of theirs. */
export type RepGraph = {
  colour: Color;
  mine: Map<string, { uci: string; san: string; repertoire: number }>;
  theirs: Map<string, Map<string, string>>;
  lines: RepLine[];
  /** one repertoire's graph (a side can have several: a collection, WP 8.15) */
  repertoire?: number;
  name?: string;
};

export function repertoireGraph(colour: Color, lines: readonly RepLine[], who?: { repertoire: number; name: string }): RepGraph {
  const g: RepGraph = { colour, mine: new Map(), theirs: new Map(), lines: lines.filter((l) => l.colour === colour), repertoire: who?.repertoire, name: who?.name };
  for (const line of g.lines) {
    const { steps, illegalAt } = lineSteps(line);
    if (illegalAt !== undefined) continue;
    for (const s of steps) {
      const key = positionKey(s.fenBefore);
      if (s.mine) {
        if (!g.mine.has(key)) g.mine.set(key, { uci: s.uci, san: s.san, repertoire: line.repertoire });
      } else {
        let m = g.theirs.get(key);
        if (!m) g.theirs.set(key, (m = new Map()));
        m.set(s.uci, s.san);
      }
    }
  }
  return g;
}

export type Deviation = {
  /** you: the owner played another move; them: the opponent played a move not prepared; end: the preparation ran out; outside: the game never entered the repertoire; stayed: the whole game was in it */
  by: 'you' | 'them' | 'end' | 'outside' | 'stayed';
  /** the index in the game's moves of the move that left (or of the first move past the preparation) */
  ply: number;
  /** "3.Bb5", "2...d6" */
  moveText: string;
  /** the position before that move */
  fenBefore: string;
  played?: { san: string; uci: string };
  /** the owner left: the move the repertoire plays there */
  expected?: { san: string; uci: string };
  /** the opponent left: the replies the repertoire prepares there */
  prepared?: string[];
  /** how many moves of the game were in the repertoire */
  inBook: number;
  /** the repertoire line the game followed longest (its index in the graph's lines), for results per line */
  line?: number;
};

function moveNumber(fenBefore: string): string {
  const parts = fenBefore.split(' ');
  return `${parts[5] ?? '1'}${parts[1] === 'b' ? '...' : '.'}`;
}

/** Walk one game (SAN from the start) through the repertoire. */
export function gameDeviation(g: RepGraph, sans: readonly string[], startFen = START_FEN): Deviation {
  const pos = mustPosition(startFen);
  let fen = startFen;
  let inBook = 0;
  const path: string[] = [];
  const finish = (d: Omit<Deviation, 'inBook' | 'line'>): Deviation => ({ ...d, inBook, line: longestLine(g, path) });
  for (let i = 0; i < sans.length; i++) {
    const m = sanToMove(pos, sans[i]!);
    if (!m) break;
    const info = describeMove(pos, m);
    const key = positionKey(fen);
    const at = { ply: i, moveText: `${moveNumber(fen)}${info.san}`, fenBefore: fen, played: { san: info.san, uci: info.uci } };
    if (pos.turn === g.colour) {
      const mine = g.mine.get(key);
      if (!mine) return finish({ by: i === 0 || inBook === 0 ? 'outside' : 'end', ...at });
      if (mine.uci !== info.uci) return finish({ by: 'you', ...at, expected: { san: mine.san, uci: mine.uci } });
    } else {
      const theirs = g.theirs.get(key);
      if (!theirs) return finish({ by: inBook === 0 ? 'outside' : 'end', ...at });
      if (!theirs.has(info.uci)) return finish({ by: 'them', ...at, prepared: [...theirs.values()] });
    }
    inBook++;
    path.push(info.uci);
    pos.play(m);
    fen = info.fenAfter;
  }
  return { by: inBook ? 'stayed' : 'outside', ply: sans.length, moveText: '', fenBefore: fen, inBook, line: longestLine(g, path) };
}

/**
 * The repertoire a game is matched with when a side has several (a collection, WP 8.15): the one the
 * game stayed in longest; on a tie, the first. Each repertoire is its own graph, so one repertoire's
 * move never stands in for another's.
 */
export function matchGame(graphs: readonly RepGraph[], you: Color, sans: readonly string[], startFen = START_FEN): { graph: RepGraph; deviation: Deviation } | null {
  let best: { graph: RepGraph; deviation: Deviation } | null = null;
  for (const g of graphs) {
    if (g.colour !== you || !g.lines.length) continue;
    const d = gameDeviation(g, sans, startFen);
    if (!best || d.inBook > best.deviation.inBook) best = { graph: g, deviation: d };
  }
  return best;
}

const lineUcis = new WeakMap<RepGraph, string[][]>();

/** The line whose moves the game followed longest (by moves, from the start). */
function longestLine(g: RepGraph, path: readonly string[]): number | undefined {
  let best: number | undefined;
  let bestLen = 0;
  let all = lineUcis.get(g);
  if (!all) lineUcis.set(g, (all = g.lines.map((l) => lineSteps(l).steps.map((s) => s.uci))));
  all.forEach((steps, i) => {
    let n = 0;
    while (n < steps.length && n < path.length && steps[n] === path[n]) n++;
    if (n > bestLen) {
      bestLen = n;
      best = i;
    }
  });
  return best;
}

export type GameForRep = { id: number; you: Color; result: '1-0' | '0-1' | '1/2-1/2' | '*'; sans: string[] };

export type LineResult = {
  /** the line as moves, as far as games followed it */
  line: string;
  colour: Color;
  games: number;
  won: number;
  drawn: number;
  lost: number;
  /** of those games, how many left it by the owner's move, by the opponent's, or ran past the preparation */
  leftByYou: number;
  leftByThem: number;
  prepRanOut: number;
};

/** Results per repertoire line over the owner's games (G3), and where each game left. */
export function lineResults(graphs: readonly RepGraph[], games: readonly GameForRep[]): { lines: LineResult[]; deviations: Map<number, Deviation> } {
  const byKey = new Map<string, LineResult>();
  const deviations = new Map<number, Deviation>();
  for (const game of games) {
    if (game.result === '*') continue;
    const m = matchGame(graphs, game.you, game.sans);
    if (!m) continue;
    const { graph: g, deviation: d } = m;
    deviations.set(game.id, d);
    if (d.by === 'outside' || d.line === undefined) continue;
    const line = g.lines[d.line]!;
    const key = `${game.you}|${d.line}|${line.repertoire}`;
    let r = byKey.get(key);
    if (!r) byKey.set(key, (r = { line: lineText(line.startFen, line.moves), colour: game.you, games: 0, won: 0, drawn: 0, lost: 0, leftByYou: 0, leftByThem: 0, prepRanOut: 0 }));
    r.games++;
    const won = (game.result === '1-0' && game.you === 'white') || (game.result === '0-1' && game.you === 'black');
    if (game.result === '1/2-1/2') r.drawn++;
    else if (won) r.won++;
    else r.lost++;
    if (d.by === 'you') r.leftByYou++;
    else if (d.by === 'them') r.leftByThem++;
    else if (d.by === 'end') r.prepRanOut++;
  }
  return { lines: [...byKey.values()].sort((a, b) => b.games - a.games || a.line.localeCompare(b.line)), deviations };
}
