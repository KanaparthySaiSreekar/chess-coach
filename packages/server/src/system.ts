// The computer's load, for the top bar (feature I18; the owner, 2026-11-17: "show the hardware insights
// like RAM used GPU used CPU used memory beside Game, View and settings"). Sampled every few seconds while
// a page is open and the setting is on: the CPU's use since the last sample, the memory in use, this
// app's own memory, the Stockfish engines running (on Windows, from tasklist), and the NVIDIA GPU (from
// nvidia-smi, when there is one). Nothing leaves the machine.

import { execFile } from 'node:child_process';
import os from 'node:os';
import type { SystemView } from '@chess-coach/core';

type Run = (file: string, args: string[]) => Promise<string>;

const run: Run = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 4000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** nvidia-smi's one line ("name, util, mem used, mem total, temp, power") → the GPU's numbers, or null. */
export function readNvidiaSmi(text: string): SystemView['gpu'] | null {
  const line = text.split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const [name, util, used, total, temp, power] = line.split(',').map((x) => x.trim());
  const num = (x: string | undefined) => (x !== undefined && /^[\d.]+$/.test(x) ? Number(x) : undefined);
  if (num(util) === undefined || num(used) === undefined || num(total) === undefined) return null;
  return { name: name || undefined, util: num(util)!, memUsed: num(used)! * 1024 * 1024, memTotal: num(total)! * 1024 * 1024, temp: num(temp), power: num(power) };
}

/** tasklist's CSV lines for the Stockfish image → how many run and the memory they hold (bytes). */
export function readTasklist(text: string): { count: number; memory: number } {
  let count = 0;
  let memory = 0;
  for (const line of text.split(/\r?\n/)) {
    const cells = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
    if (cells.length < 5 || !/^stockfish/i.test(cells[0]!)) continue;
    count++;
    memory += Number(cells[4]!.replace(/[^\d]/g, '')) * 1024; // "195,432 K"
  }
  return { count, memory };
}

export class SystemMonitor {
  private readonly onView: (v: SystemView) => void;
  private readonly wanted: () => boolean;
  private readonly every: number;
  private readonly exec: Run;
  private last = cpuTimes();
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  /** no GPU to ask (nvidia-smi missing or failing): asked again only after a while */
  private gpuQuietUntil = 0;
  view: SystemView | null = null;

  constructor(o: { onView: (v: SystemView) => void; wanted: () => boolean; every?: number; exec?: Run }) {
    this.onView = o.onView;
    this.wanted = o.wanted;
    this.every = o.every ?? 3000;
    this.exec = o.exec ?? run;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.every);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy || !this.wanted()) return;
    this.busy = true;
    try {
      this.view = await this.sample();
      this.onView(this.view);
    } finally {
      this.busy = false;
    }
  }

  async sample(): Promise<SystemView> {
    const now = cpuTimes();
    const dTotal = now.total - this.last.total;
    const cpu = dTotal > 0 ? Math.max(0, Math.min(100, 100 * (1 - (now.idle - this.last.idle) / dTotal))) : 0;
    this.last = now;
    const total = os.totalmem();
    const view: SystemView = {
      at: new Date().toISOString(),
      cpu: Math.round(cpu),
      cores: os.cpus().length,
      ram: { used: total - os.freemem(), total },
      app: { memory: process.memoryUsage().rss },
    };
    const [engines, gpu] = await Promise.all([this.engines(), this.gpu()]);
    if (engines) view.engines = engines;
    if (gpu) view.gpu = gpu;
    return view;
  }

  private async engines(): Promise<SystemView['engines'] | undefined> {
    if (process.platform !== 'win32') return undefined;
    try {
      return readTasklist(await this.exec('tasklist', ['/FI', 'IMAGENAME eq stockfish*', '/FO', 'CSV', '/NH']));
    } catch {
      return undefined;
    }
  }

  private async gpu(): Promise<SystemView['gpu'] | undefined> {
    if (Date.now() < this.gpuQuietUntil) return undefined;
    try {
      const g = readNvidiaSmi(await this.exec('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw', '--format=csv,noheader,nounits']));
      if (!g) this.gpuQuietUntil = Date.now() + 60_000;
      return g ?? undefined;
    } catch {
      this.gpuQuietUntil = Date.now() + 60_000;
      return undefined;
    }
  }
}
