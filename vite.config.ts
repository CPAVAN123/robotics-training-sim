import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built site works from any sub-path (e.g. GitHub Pages).
  base: './',
  optimizeDeps: {
    // The MuJoCo package ships its own .wasm next to the JS loader; pre-bundling breaks that lookup.
    exclude: ['@mujoco/mujoco'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
