import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setup.ts'],
    // The suites share one throwaway database, so files run one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: 'test' },
  },
});
