import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The engine is pure arithmetic; no browser or DOM shims are wanted.
    environment: 'node',
  },
});
