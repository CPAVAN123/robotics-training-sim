import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run the production build in Chromium with software WebGL (SwiftShader), so they
 * work on machines without a GPU. Set PLAYWRIGHT_CHROMIUM to use a specific Chromium binary; the
 * sandbox's preinstalled browser is used when present, otherwise Playwright's own.
 */
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const chromium = process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  // Physics and software rendering share the CPU: run one browser at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: chromium,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    // CI builds (and type-checks) in its own step first, so there it only serves dist/.
    command: `${process.env.CI ? '' : 'npm run build && '}npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
