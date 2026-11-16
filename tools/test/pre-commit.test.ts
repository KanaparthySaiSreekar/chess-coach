// The pre-commit guard, run by a real `git commit` in a throwaway repository (PLAN, WP 3.1:
// "the pre-commit check refuses a file under data/").

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tools = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let repo = '';
const git = (...args: string[]) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'chess-coach-hook-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  for (const [k, v] of [['user.name', 'test'], ['user.email', 'test@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', 'tools/git-hooks']]) execFileSync('git', ['config', k!, v!], { cwd: repo });
  mkdirSync(path.join(repo, 'tools'));
  cpSync(path.join(tools, 'check-staged.mjs'), path.join(repo, 'tools', 'check-staged.mjs'));
  cpSync(path.join(tools, 'git-hooks'), path.join(repo, 'tools', 'git-hooks'), { recursive: true });
  writeFileSync(path.join(repo, '.gitignore'), 'data/\n.env\n');
  writeFileSync(path.join(repo, 'README.md'), 'hello\n');
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('git commit with the guard installed', () => {
  it('lets an ordinary commit through', () => {
    git('add', '-A');
    const r = git('commit', '-q', '-m', 'first');
    expect(r.status, r.stderr).toBe(0);
  });

  it('refuses a course file under data/, even when it was added by force', () => {
    mkdirSync(path.join(repo, 'data', 'courses'), { recursive: true });
    writeFileSync(path.join(repo, 'data', 'courses', 'book.pgn'), '1. e4 *\n');
    git('add', '-f', 'data/courses/book.pgn');
    const r = git('commit', '-q', '-m', 'a course file');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Commit refused/);
    expect(r.stderr).toMatch(/data\/courses\/book\.pgn/);
    git('restore', '--staged', 'data/courses/book.pgn');
  });

  it('refuses .env', () => {
    writeFileSync(path.join(repo, '.env'), 'LICHESS_TOKEN=not-a-real-token\n');
    git('add', '-f', '.env');
    const r = git('commit', '-q', '-m', 'a secret');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/\.env: secrets/);
    git('restore', '--staged', '.env');
  });
});
