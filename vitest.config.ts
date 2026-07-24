import { defineConfig } from 'vitest/config';

// Standalone from vite.config.ts: the electron plugin spawns a dev server /
// builds the main process, neither of which should run during unit tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{src,shared,electron}/**/*.test.ts'],
  },
});
