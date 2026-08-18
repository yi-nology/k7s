// Playwright e2e configuration — the P1 usability smoke (e2e/p1-usability.spec.ts).
//
// The app under test is the plain Vite dev server (`pnpm dev`, port 1420 per
// vite.config.ts, strictPort). No k7s-web backend is started: the HttpProvider
// boot fails open (LoginGate renders children when /api/auth/status is
// unreachable, useBootstrap parks the connection in the error phase), so the
// shell — sidebar rail, section routing, SubNav, tools catalog — renders
// exactly as a "no cluster connected" session would. That is the state the
// smoke asserts against.

import { defineConfig, devices } from '@playwright/test';

/** Vite dev-server port (vite.config.ts > server.port, strictPort: true). */
const PORT = 1420;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
