// The coach director (ARCHITECTURE §5.3, feature H14): plain code that decides whether an event
// goes to the coach at all, so a small model never has to decide when to stay quiet.

import type { FactPacket } from '@chess-coach/core';

export type Verbosity = 'silent' | 'key_moments' | 'every_move';

export type WakeDecision = { wake: boolean; reason: string };

/** Should the coach be woken for a move that was just played on the board? */
export function wakeOnMove(verbosity: Verbosity, packet: FactPacket): WakeDecision {
  if (verbosity === 'silent') return { wake: false, reason: 'silent: the coach only speaks when asked' };
  if (verbosity === 'every_move') return { wake: true, reason: 'every move' };
  const g = packet.graded;
  if (packet.over) return { wake: true, reason: 'the game ended' };
  if (g && g.live && (g.cls === 'mistake' || g.cls === 'blunder')) return { wake: true, reason: `the owner's move was a ${g.cls} in a live position` };
  return { wake: false, reason: 'not a key moment' };
}

/** Does the owner's typed question ask for a move to play (so "ask first" applies)? */
export function asksForMove(text: string): boolean {
  return /\b(?:what|which)\b.{0,30}\b(?:should|do|would|can|could|shall)\b.{0,12}\b(?:i|we|you)\b.{0,20}\b(?:play|move|do)\b|\bbest move\b|\bwhat (?:now|next)\b|\bwhat(?:'s| is) the (?:right|correct|strongest) move\b|\bsuggest (?:a|me a) move\b/i.test(text);
}
