import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js', 'tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    // Tests are pure-function level — no need for jsdom or happy-dom.
    environment: 'node',
  },
});
