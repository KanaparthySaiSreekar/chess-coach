// Re-validation (feature J7; CONTENT §11; PLAN WP 8.11). The engine checks behind live content are
// only as good as the engine and the thresholds they ran with. When either changes (a new Stockfish,
// a different node budget, a stricter "a repertoire move may lose at most…", other grading
// thresholds), V2 and V7 run again over the live repertoires and the gated puzzles; what now fails is
// quarantined, and its reason says what changed. Items keep their ids, so drill history stays with them.

import type { Db } from './db.ts';

/** What the engine checks ran with. */
export type GateBasis = {
  engine: string;
  /** V2's search (content.gateNodes) */
  nodes: number;
  /** V7's search (repertoire.secondNodes) */
  secondNodes: number;
  /** the most a repertoire move may lose, in points of winning chances (repertoire.maxDrop) */
  maxDrop: number;
  thresholds: { inaccuracy: number; mistake: number; blunder: number };
};

const KEY = 'content_basis';

/** What changed between two bases, in words; empty when nothing did. */
export function basisChanges(before: GateBasis | undefined, now: GateBasis): string[] {
  if (!before) return [];
  const out: string[] = [];
  const n = (x: number) => x.toLocaleString('en-US');
  if (before.engine !== now.engine) out.push(`the engine (${before.engine} → ${now.engine})`);
  if (before.nodes !== now.nodes) out.push(`the search that checks content (${n(before.nodes)} → ${n(now.nodes)} nodes)`);
  if (before.secondNodes !== now.secondNodes) out.push(`the second opinion's search (${n(before.secondNodes)} → ${n(now.secondNodes)} nodes)`);
  if (before.maxDrop !== now.maxDrop) out.push(`the most a repertoire move may lose (${before.maxDrop} → ${now.maxDrop} points of winning chances)`);
  for (const k of ['inaccuracy', 'mistake', 'blunder'] as const) if (before.thresholds[k] !== now.thresholds[k]) out.push(`the ${k} threshold (${before.thresholds[k]} → ${now.thresholds[k]})`);
  return out;
}

export function storedBasis(db: Db): GateBasis | undefined {
  return db.syncGet<GateBasis>(KEY)?.value;
}

export function storeBasis(db: Db, basis: GateBasis) {
  db.syncSet(KEY, basis);
}

/** "re-checked after a change of the most a repertoire move may lose (4 → 2 points of winning chances)" */
export function becauseText(changes: string[]): string | undefined {
  return changes.length ? `re-checked after a change of ${changes.join(', ')}` : undefined;
}
