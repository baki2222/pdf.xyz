import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright runs the smoke suite against a real production build served by
 * `next start`, so the tests exercise the exact security headers / CSP and
 * statically-generated output that ship to users — not the dev server. Run
 * `pnpm build` before this suite (CI does this explicitly).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `rm -f .next/lock && pnpm start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
