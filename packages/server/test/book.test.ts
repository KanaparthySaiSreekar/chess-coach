// The content job lock (WP 8.12): one long job on the content at a time, across processes.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { otherJob } from '../src/book.ts';

const lock = (value?: { pid: number; what: string }) => ({
  syncGet: <T,>() => (value ? { value: value as T } : undefined),
});

describe('otherJob', () => {
  it('is nothing when no job was ever started', () => {
    expect(otherJob(lock())).toBeNull();
  });

  it('is nothing after a job finished (process 0, which Windows calls alive)', () => {
    expect(otherJob(lock({ pid: 0, what: '' }))).toBeNull();
  });

  it('is nothing for the asking process itself', () => {
    expect(otherJob(lock({ pid: process.pid, what: 'building x' }))).toBeNull();
  });

  it('names a job whose process is still running', () => {
    expect(otherJob(lock({ pid: process.ppid, what: 'building reti' }))).toBe('building reti');
    expect(otherJob(lock({ pid: process.ppid, what: '' }))).toBe('another job');
  });

  it('is nothing when the process that held it is gone (stopped hard)', () => {
    const gone = spawnSync(process.execPath, ['-e', '0']).pid;
    expect(gone).toBeGreaterThan(0);
    expect(otherJob(lock({ pid: gone!, what: 'building reti' }))).toBeNull();
  });
});
