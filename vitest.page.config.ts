import { defineConfig } from 'vitest/config';

// The page driven in a real browser (Chrome) against a real server and Stockfish.
// `npm run test:page` builds the page first. Slower; run on AC power.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.page.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
