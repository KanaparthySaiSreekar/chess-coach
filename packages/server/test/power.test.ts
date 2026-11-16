// The check heavy engine jobs make before they start (PLAN WP 3.5, ARCHITECTURE §10).

import { describe, expect, it } from 'vitest';
import { PowerGate } from '../src/engine/power.ts';

describe('the power check before a heavy engine job', () => {
  it('runs in full on mains power, and when it cannot tell (a desktop)', async () => {
    for (const answer of [true, null]) {
      const gate = new PowerGate(async () => answer);
      for (const policy of ['lighter', 'full', 'wait'] as const) {
        expect(await gate.plan(policy, 'labelling the game')).toEqual({ run: true, deep: true, onBattery: false });
      }
    }
  });

  it('on battery follows the setting: the quick search, in full, or not at all', async () => {
    const gate = new PowerGate(async () => false);
    const lighter = await gate.plan('lighter', 'labelling the game');
    expect(lighter).toMatchObject({ run: true, deep: false, onBattery: true });
    expect(lighter.note).toMatch(/On battery: labelling the game uses the quick search/);
    const full = await gate.plan('full', 'labelling the game');
    expect(full).toMatchObject({ run: true, deep: true, onBattery: true });
    expect(full.note).toMatch(/runs in full/);
    const wait = await gate.plan('wait', 'labelling the game');
    expect(wait).toMatchObject({ run: false, onBattery: true });
    expect(wait.note).toMatch(/was not started/);
  });

  it('asks Windows once and keeps the answer for a while, then asks again', async () => {
    let asked = 0;
    let clock = 0;
    let answer = true;
    const gate = new PowerGate(
      async () => {
        asked++;
        return answer;
      },
      30_000,
      () => clock,
    );
    expect(await gate.onAc()).toBe(true);
    clock = 20_000;
    answer = false; // unplugged, but the kept answer still stands
    expect(await gate.onAc()).toBe(true);
    expect(asked).toBe(1);
    clock = 31_000;
    expect(await gate.onAc()).toBe(false);
    expect(asked).toBe(2);
  });

  it('treats a failed check as "cannot tell", so the job still runs', async () => {
    const gate = new PowerGate(async () => {
      throw new Error('powershell is missing');
    });
    expect(await gate.plan('wait', 'labelling the game')).toMatchObject({ run: true, deep: true });
  });
});
