import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    hookTimeout: 10000,
    testTimeout: 10000,
    env: {
      DB_PATH: ':memory:',
      LOG_LEVEL: 'error',
    },
  },
});
