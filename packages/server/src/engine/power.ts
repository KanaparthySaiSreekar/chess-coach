// Is the laptop on mains power? Heavy engine jobs check first (ARCHITECTURE §10): on battery the
// CPU is held to about 45 W, so a long job crawls and drains the battery.

import { execFile } from 'node:child_process';

/** true = on AC, false = on battery, null = cannot tell (a desktop, or not Windows). */
export function onAcPower(): Promise<boolean | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Battery | Select-Object -First 1).BatteryStatus'],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        const text = String(stdout ?? '').trim();
        if (err || !text) return resolve(null);
        const status = Number(text);
        // Win32_Battery.BatteryStatus: 1, 4, 5 = running on the battery; 2, 3, 6–9 = mains
        if ([1, 4, 5].includes(status)) return resolve(false);
        if ([2, 3, 6, 7, 8, 9].includes(status)) return resolve(true);
        resolve(null);
      },
    );
  });
}

/** What a heavy job does when the laptop is on battery (the setting `engine.onBattery`). */
export type BatteryPolicy = 'lighter' | 'full' | 'wait';

/** The answer for one heavy job: whether to start it, and whether to use the deep search. */
export type HeavyPlan = {
  run: boolean;
  deep: boolean;
  onBattery: boolean;
  /** what to tell the owner, when the battery changed the plan */
  note?: string;
};

/**
 * The check every heavy engine job makes before it starts (labelling a whole game today; the
 * game-analysis pipeline, content validation and the builders later). Asking Windows takes about
 * half a second, so the answer is kept for a short while.
 */
export class PowerGate {
  private last: { at: number; value: boolean | null } | null = null;
  private readonly probe: () => Promise<boolean | null>;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(probe: () => Promise<boolean | null> = onAcPower, ttlMs = 30_000, now: () => number = Date.now) {
    this.probe = probe;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async onAc(): Promise<boolean | null> {
    if (this.last && this.now() - this.last.at < this.ttlMs) return this.last.value;
    const value = await this.probe().catch(() => null);
    this.last = { at: this.now(), value };
    return value;
  }

  /** `job` names the work in the note: "Labelling the game", "Analysing your games". */
  async plan(policy: BatteryPolicy, job: string): Promise<HeavyPlan> {
    const ac = await this.onAc();
    // on mains, or cannot tell (a desktop): run in full
    if (ac !== false) return { run: true, deep: true, onBattery: false };
    if (policy === 'full') return { run: true, deep: true, onBattery: true, note: `On battery: ${job} runs in full, as your settings say. It will be slower than on mains power.` };
    if (policy === 'wait') return { run: false, deep: false, onBattery: true, note: `On battery: ${job} was not started. Plug in and run it again (Settings → Engine decides what happens on battery).` };
    return { run: true, deep: false, onBattery: true, note: `On battery: ${job} uses the quick search. Plug in and run it again for the deeper one.` };
  }
}
