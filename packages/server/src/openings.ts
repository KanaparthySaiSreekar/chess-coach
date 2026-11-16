// The live opening name (feature A7), from the Lichess openings list (CC0) installed in Phase 1.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { START_FEN, playLine, positionKey } from '@chess-coach/core';

export type Opening = { eco: string; name: string };

export class OpeningBook {
  private byPosition = new Map<string, Opening>();
  /** every position on the way to a named opening: the theory a move can stay inside */
  private theory = new Set<string>();
  count = 0;

  static load(dir: string): OpeningBook {
    const book = new OpeningBook();
    if (!existsSync(dir)) return book;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsv')).sort()) {
      const lines = readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/).slice(1);
      for (const line of lines) {
        const [eco, name, pgn] = line.split('\t');
        if (!eco || !name || !pgn) continue;
        const moves = pgn.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);
        const played = playLine(START_FEN, moves);
        if (!played.ok) continue;
        book.byPosition.set(positionKey(played.fens.at(-1)!), { eco, name });
        for (const fen of played.fens.slice(1)) book.theory.add(positionKey(fen));
        book.count++;
      }
    }
    return book;
  }

  /**
   * Is this position opening theory? Returns the opening's name when the position has one of its
   * own, true when it only lies on the way to a named opening, and false when it is out of book.
   */
  at(fen: string): string | boolean {
    const key = positionKey(fen);
    return this.byPosition.get(key)?.name ?? this.theory.has(key);
  }

  /** The most specific named opening along a line of positions (last match wins). */
  lookup(fens: string[]): Opening | undefined {
    for (let i = fens.length - 1; i >= 0; i--) {
      const hit = this.byPosition.get(positionKey(fens[i]!));
      if (hit) return hit;
    }
    return undefined;
  }
}
