import { defineConfig } from 'vitest/config';

// Tests against the real Stockfish install (C:\Tools\Stockfish). Slower; run on AC power.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.engine.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
