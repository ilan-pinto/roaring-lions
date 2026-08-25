import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // vite-plugin-cursors.ts (and its test) live at the package root rather
    // than under src/ -- deliberately, so a build-time Vite plugin holding
    // colour never sits inside a validate:ui scan root. That means the
    // package-root glob below is not redundant with the src/ one above it.
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/*.test.ts',
      'tools/src/**/*.test.ts',
    ],
  },
});
