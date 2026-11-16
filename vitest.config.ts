import { defineConfig } from 'vitest/config';

// Fast tests: no engine, no model. `npm run test:engine` runs the ones that need real Stockfish.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tools/test/**/*.test.ts'],
    exclude: ['**/*.engine.test.ts', '**/*.page.test.ts', '**/node_modules/**'],
  },
});
