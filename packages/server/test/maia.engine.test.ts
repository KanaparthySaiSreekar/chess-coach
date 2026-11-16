// PLAN WP 7.1: the real Maia-3 sidecar, killed while it runs, comes back on the next request.
// Needs Python and Maia-3 installed (C:\Tools\Maia3, Phase 1); skipped when they are not.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { START_FEN, legalMoves, mustPosition } from '@chess-coach/core';
import { MaiaSidecar } from '../src/bots/service.ts';
import { config } from '../src/config.ts';

const model = path.join(config.maiaModels, 'maia3-5m.pt');
const installed = existsSync(config.maiaPython) && existsSync(model);

describe.skipIf(!installed)('the Maia-3 sidecar (real)', () => {
  const states: string[] = [];
  const maia = new MaiaSidecar({
    python: config.maiaPython,
    script: config.maiaSidecar,
    spec: () => ({ model: 'maia3-5m', checkpoint: model, device: 'cpu' }),
    onState: (s) => states.push(s),
  });
  afterAll(() => maia.stop());

  it('answers with legal moves, and after being killed starts again on the next request', async () => {
    const legal = new Set(legalMoves(mustPosition(START_FEN)).map((m) => m.uci));
    const first = await maia.probabilities({ startFen: START_FEN, moves: [], selfElo: 600, oppoElo: 600 });
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((m) => legal.has(m.uci))).toBe(true);
    expect(maia.state).toBe('ready');
    // the process dies under it
    const child = (maia as unknown as { child: { pid?: number; kill: () => boolean } | null }).child;
    expect(child?.pid).toBeGreaterThan(0);
    child!.kill();
    await new Promise((r) => setTimeout(r, 500));
    // the next request brings it back
    const again = await maia.probabilities({ startFen: START_FEN, moves: ['e2e4'], selfElo: 600, oppoElo: 600 });
    expect(again.length).toBeGreaterThan(0);
    const afterE4 = new Set(legalMoves(mustPosition('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).map((m) => m.uci));
    expect(again.every((m) => afterE4.has(m.uci))).toBe(true);
    expect(maia.state).toBe('ready');
    expect(states.filter((s) => s === 'starting').length).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
