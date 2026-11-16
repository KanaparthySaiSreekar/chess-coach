// The move tree: a root position plus moves, with variations. Plain data, so it can be saved
// as JSON and sent to the page unchanged.

import { ChildNode, Node, defaultGame, makeComment, makePgn, parseComment, parsePgn, startingPosition, type Evaluation, type PgnNodeData } from 'chessops/pgn';
import { makeFen } from 'chessops/fen';
import { START_FEN, anyToMove, describeMove, makeSquare, mustPosition, parsePosition, parseSquare, type MoveInfo } from './chess.ts';
import { standardCastling } from './setup.ts';
import type { Gauge, Judged } from './labels.ts';

export type NodeId = string;

/**
 * An arrow (from → to) or a circled square (no `to`) kept with a position, in one of Lichess's
 * four colours. In a PGN these are the `[%cal Ge2e4]` and `[%csl Rd5]` tags inside a comment, so a
 * study exported from Lichess keeps its drawings and ours open there (CONTENT §4).
 */
export type DrawingColor = 'green' | 'red' | 'yellow' | 'blue';
export type Drawing = { from: string; to?: string; color: DrawingColor };
export const DRAWING_COLORS: readonly DrawingColor[] = ['green', 'red', 'yellow', 'blue'];

/** The marks a PGN can put on a move (its NAGs), as they are written after the move. */
export const NAG_GLYPH: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };

export type TreeNode = {
  id: NodeId;
  parent: NodeId | null;
  ply: number; // plies from the root
  fen: string; // the position after this node's move (the root: the starting position)
  san?: string;
  uci?: string;
  from?: string;
  to?: string;
  check?: boolean;
  children: NodeId[]; // children[0] is the main continuation
  comment?: string;
  /** arrows and circles drawn on this position (the owner's, or a study's) */
  drawings?: Drawing[];
  /** the marks on this node's move as the PGN gave them: 1 "!", 2 "?", 3 "!!", 4 "??", 5 "!?", 6 "?!", and the rest */
  nags?: number[];
  /** from the PGN, kept so it is exported as it came: the mover's clock after the move and the time spent, in seconds */
  clock?: number;
  emt?: number;
  /** the evaluation the PGN's source wrote beside the move. Never used for a verdict here: the app asks its own engine */
  sourceEval?: Evaluation;
  /** the eval bar's reading for this position, once the engine has looked (feature A6) */
  gauge?: Gauge;
  /** this node's move, labelled by the engine's grading (feature A17) */
  judged?: Judged;
};

export type MoveTree = {
  rootFen: string;
  root: NodeId;
  next: number;
  nodes: Record<NodeId, TreeNode>;
  headers?: Record<string, string>;
};

export function newTree(rootFen: string = START_FEN): MoveTree {
  const pos = mustPosition(rootFen);
  const fen = makeFen(pos.toSetup());
  return { rootFen: fen, root: 'n0', next: 1, nodes: { n0: { id: 'n0', parent: null, ply: 0, fen, children: [] } } };
}

export type AddResult = { ok: true; id: NodeId; created: boolean; info: MoveInfo } | { ok: false; reason: string };

/** Add a move (SAN or UCI) after `parent`. An existing child with the same move is reused. */
export function addMove(tree: MoveTree, parent: NodeId, moveText: string): AddResult {
  const node = tree.nodes[parent];
  if (!node) return { ok: false, reason: 'no such node' };
  const pos = parsePosition(node.fen);
  if (!pos) return { ok: false, reason: 'bad position' };
  const move = anyToMove(pos, moveText);
  if (!move) return { ok: false, reason: `illegal move: ${moveText}` };
  const info = describeMove(pos, move);
  for (const childId of node.children) {
    if (tree.nodes[childId]!.uci === info.uci) return { ok: true, id: childId, created: false, info };
  }
  const id = `n${tree.next++}`;
  tree.nodes[id] = {
    id,
    parent,
    ply: node.ply + 1,
    fen: info.fenAfter,
    san: info.san,
    uci: info.uci,
    from: info.from,
    to: info.to,
    check: info.check,
    children: [],
  };
  node.children.push(id);
  return { ok: true, id, created: true, info };
}

/** The nodes from the root down to `id`, root first. */
export function pathTo(tree: MoveTree, id: NodeId): TreeNode[] {
  const out: TreeNode[] = [];
  let cur: TreeNode | undefined = tree.nodes[id];
  while (cur) {
    out.push(cur);
    cur = cur.parent ? tree.nodes[cur.parent] : undefined;
  }
  return out.reverse();
}

/** SAN moves from the root to `id`. */
export function movesTo(tree: MoveTree, id: NodeId): string[] {
  return pathTo(tree, id)
    .slice(1)
    .map((n) => n.san!);
}

/** The last node of the main line that starts at `from`. */
export function mainlineEnd(tree: MoveTree, from: NodeId = tree.root): NodeId {
  let cur = tree.nodes[from]!;
  while (cur.children.length) cur = tree.nodes[cur.children[0]!]!;
  return cur.id;
}

/** Remove a node and everything after it. The root cannot be removed. */
export function deleteNode(tree: MoveTree, id: NodeId): NodeId | null {
  const node = tree.nodes[id];
  if (!node || !node.parent) return null;
  const parent = tree.nodes[node.parent]!;
  parent.children = parent.children.filter((c) => c !== id);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    stack.push(...tree.nodes[cur]!.children);
    delete tree.nodes[cur];
  }
  return parent.id;
}

/** Make `id` the main continuation of its parent. */
export function promote(tree: MoveTree, id: NodeId): boolean {
  const node = tree.nodes[id];
  if (!node?.parent) return false;
  const parent = tree.nodes[node.parent]!;
  parent.children = [id, ...parent.children.filter((c) => c !== id)];
  return true;
}

// ---------------------------------------------------------------- PGN

/** Put a PGN comment's parts on a node: the words, Lichess's drawings, the clock, the source's evaluation. */
function readComments(node: TreeNode, comments: string[]) {
  const words: string[] = [];
  const drawings: Drawing[] = [];
  for (const raw of comments) {
    const c = parseComment(raw);
    if (c.text.trim()) words.push(c.text.trim());
    for (const s of c.shapes) {
      const d: Drawing = s.from === s.to ? { from: makeSquare(s.from), color: s.color } : { from: makeSquare(s.from), to: makeSquare(s.to), color: s.color };
      if (!drawings.some((x) => x.from === d.from && x.to === d.to)) drawings.push(d);
    }
    if (c.clock !== undefined) node.clock = c.clock;
    if (c.emt !== undefined) node.emt = c.emt;
    if (c.evaluation) node.sourceEval = c.evaluation;
  }
  if (words.length) node.comment = words.join(' ');
  if (drawings.length) node.drawings = drawings;
}

/** A node's comment for a PGN: its words, then its drawings and clock as Lichess writes them. */
function writeComment(node: TreeNode): string {
  const shapes = [];
  for (const d of node.drawings ?? []) {
    const from = parseSquare(d.from);
    const to = d.to ? parseSquare(d.to) : from;
    if (from !== undefined && to !== undefined) shapes.push({ color: d.color, from, to });
  }
  return makeComment({ text: node.comment ?? '', shapes, clock: node.clock, emt: node.emt, evaluation: node.sourceEval }).trim();
}

export type PgnImport = { ok: true; tree: MoveTree; games: number; result: string } | { ok: false; reason: string };

/** Read the first game of a PGN (with variations and comments). A bare FEN is accepted too. */
export function importPgn(text: string): PgnImport {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'nothing to import' };
  // a bare FEN: a set-up position. Castling that standard chess does not allow is dropped from it
  if (parsePosition(trimmed)) return { ok: true, tree: newTree(standardCastling(trimmed)), games: 0, result: '*' };
  const games = parsePgn(trimmed);
  if (!games.length) return { ok: false, reason: 'no game found in the text' };
  const game = games[0]!;
  const start = startingPosition(game.headers);
  if (start.isErr) return { ok: false, reason: 'the PGN starts from an invalid position' };
  const tree = newTree(standardCastling(makeFen(start.value.toSetup())));
  tree.headers = Object.fromEntries(game.headers);
  // a comment before the first move belongs to the starting position (a study chapter's drawings live there)
  readComments(tree.nodes[tree.root]!, game.comments ?? []);
  let bad: string | null = null;
  const walk = (pgnNode: Node<PgnNodeData>, treeId: NodeId) => {
    for (const child of pgnNode.children) {
      const r = addMove(tree, treeId, child.data.san);
      if (!r.ok) {
        bad ??= `${child.data.san} (after ${movesTo(tree, treeId).join(' ') || 'the start'})`;
        continue; // skip this branch, keep the rest
      }
      const node = tree.nodes[r.id]!;
      readComments(node, [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])]);
      if (child.data.nags?.length) node.nags = [...child.data.nags];
      walk(child, r.id);
    }
  };
  walk(game.moves, tree.root);
  if (bad && Object.keys(tree.nodes).length === 1) return { ok: false, reason: `illegal move in the PGN: ${bad}` };
  return { ok: true, tree, games: games.length, result: game.headers.get('Result') ?? '*' };
}

export function exportPgn(tree: MoveTree, headers: Record<string, string> = {}): string {
  const game = defaultGame<PgnNodeData>();
  for (const [k, v] of Object.entries({ ...tree.headers, ...headers })) game.headers.set(k, v);
  if (tree.rootFen !== START_FEN) {
    game.headers.set('SetUp', '1');
    game.headers.set('FEN', tree.rootFen);
  } else {
    game.headers.delete('SetUp');
    game.headers.delete('FEN');
  }
  const rootComment = writeComment(tree.nodes[tree.root]!);
  if (rootComment) game.comments = [rootComment];
  const build = (treeId: NodeId, pgnNode: Node<PgnNodeData>) => {
    for (const childId of tree.nodes[treeId]!.children) {
      const child = tree.nodes[childId]!;
      const data: PgnNodeData = { san: child.san! };
      const comment = writeComment(child);
      if (comment) data.comments = [comment];
      if (child.nags?.length) data.nags = [...child.nags];
      const next = new ChildNode<PgnNodeData>(data);
      pgnNode.children.push(next);
      build(childId, next);
    }
  };
  build(tree.root, game.moves);
  return makePgn(game);
}
