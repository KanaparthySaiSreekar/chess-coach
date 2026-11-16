// The position-keyed graph (feature J1; PLAN WP 8.1): moves filed under the position they are played
// from, so two move orders that reach the same position share it (a transposition merges). The base
// of the repertoire (Phase 8) and of studies' combined view.

import { positionKey } from './chess.ts';
import { addMove, newTree, type MoveTree, type NodeId } from './tree.ts';

export type GraphMove = { san: string; to: string; comment?: string; nags?: number[] };
export type GraphNode = { fen: string; moves: GraphMove[]; comment?: string };
/** Positions by their key (the FEN without the move counters). */
export type PosGraph = Map<string, GraphNode>;

/** Every move of a tree, mainline and side lines, added to the graph; the first comment on a position or a move stays. */
export function addTree(graph: PosGraph, tree: MoveTree): PosGraph {
  const visit = (id: NodeId) => {
    const node = tree.nodes[id]!;
    const key = positionKey(node.fen);
    const entry = graph.get(key) ?? { fen: node.fen, moves: [] };
    if (!entry.comment && node.comment && id === tree.root) entry.comment = node.comment;
    graph.set(key, entry);
    for (const childId of node.children) {
      const child = tree.nodes[childId]!;
      const to = positionKey(child.fen);
      const have = entry.moves.find((m) => m.san === child.san);
      if (!have) entry.moves.push({ san: child.san!, to, ...(child.comment ? { comment: child.comment } : {}), ...(child.nags?.length ? { nags: [...child.nags] } : {}) });
      else if (!have.comment && child.comment) have.comment = child.comment;
      // the position the move leads to is filed too, with its own moves
      if (!graph.has(to)) graph.set(to, { fen: child.fen, moves: [] });
      visit(childId);
    }
  };
  visit(tree.root);
  return graph;
}

/** The moves known from a position. */
export function graphMoves(graph: PosGraph, fen: string): GraphMove[] {
  return graph.get(positionKey(fen))?.moves ?? [];
}

/**
 * The graph from one position as a tree: every way on, each position opened once along a line, so a
 * transposition shows once under each line that reaches it and a repetition does not loop.
 */
export function treeFromGraph(graph: PosGraph, fen: string, maxPly = 60): MoveTree {
  const tree = newTree(fen);
  const grow = (id: NodeId, onLine: Set<string>) => {
    const node = tree.nodes[id]!;
    if (node.ply >= maxPly) return;
    for (const m of graphMoves(graph, node.fen)) {
      if (onLine.has(m.to)) continue;
      const r = addMove(tree, id, m.san);
      if (!r.ok) continue;
      const child = tree.nodes[r.id]!;
      if (m.comment) child.comment = m.comment;
      if (m.nags) child.nags = [...m.nags];
      grow(r.id, new Set([...onLine, m.to]));
    }
  };
  grow(tree.root, new Set([positionKey(fen)]));
  return tree;
}

/** How many positions and moves the graph holds. */
export function graphSize(graph: PosGraph): { positions: number; moves: number } {
  let moves = 0;
  for (const n of graph.values()) moves += n.moves.length;
  return { positions: graph.size, moves };
}

