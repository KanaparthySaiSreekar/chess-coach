// The computer's load for the top bar (I18): what nvidia-smi and tasklist say, read; a sample made.
import { describe, expect, it } from 'vitest';
import { SystemMonitor, readNvidiaSmi, readTasklist } from '../src/system.ts';

describe("the computer's load (I18)", () => {
  it("reads nvidia-smi's line: use, memory in bytes, heat and power", () => {
    const g = readNvidiaSmi('NVIDIA GeForce RTX 4060 Laptop GPU, 7, 1024, 8188, 61, 13.40\r\n');
    expect(g).toEqual({ name: 'NVIDIA GeForce RTX 4060 Laptop GPU', util: 7, memUsed: 1024 * 1024 * 1024, memTotal: 8188 * 1024 * 1024, temp: 61, power: 13.4 });
    // a laptop that reports no power draw
    expect(readNvidiaSmi('GPU, 0, 10, 100, 40, [N/A]')).toMatchObject({ util: 0, temp: 40, power: undefined });
    expect(readNvidiaSmi('')).toBeNull();
    expect(readNvidiaSmi('NVIDIA-SMI has failed because it could not communicate with the NVIDIA driver')).toBeNull();
  });

  it("counts the Stockfish engines and their memory from tasklist's CSV", () => {
    const text = ['"stockfish-windows-x86-64-universal.exe","24504","Console","1","195,432 K"', '"stockfish-windows-x86-64-universal.exe","17392","Console","1","191,000 K"', 'INFO: No tasks are running which match the specified criteria.'].join('\r\n');
    expect(readTasklist(text)).toEqual({ count: 2, memory: (195_432 + 191_000) * 1024 });
    expect(readTasklist('INFO: No tasks are running which match the specified criteria.')).toEqual({ count: 0, memory: 0 });
  });

  it('samples only while someone looks, and leaves the GPU out when there is none', async () => {
    const seen: unknown[] = [];
    let wanted = false;
    const m = new SystemMonitor({ onView: (v) => seen.push(v), wanted: () => wanted, exec: async () => Promise.reject(new Error('no such program')) });
    await m.tick();
    expect(seen).toHaveLength(0);
    wanted = true;
    await m.tick();
    expect(seen).toHaveLength(1);
    const v = m.view!;
    expect(v.cpu).toBeGreaterThanOrEqual(0);
    expect(v.cpu).toBeLessThanOrEqual(100);
    expect(v.ram.total).toBeGreaterThan(v.ram.used);
    expect(v.app.memory).toBeGreaterThan(0);
    expect(v.gpu).toBeUndefined();
  });
});
