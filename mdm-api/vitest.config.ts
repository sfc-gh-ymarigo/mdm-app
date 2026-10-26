import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setupEnv.ts'],
    include: ['test/**/*.test.ts'],
    // One database for the run; files share it, so run them one after another
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
