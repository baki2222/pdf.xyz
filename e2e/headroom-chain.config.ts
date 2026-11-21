import { defineConfig } from "@playwright/test";

/**
 * The config `src/tests/e2e-headroom-chain.test.ts` runs a child Playwright
 * with: no webServer, no browser (the fixture never takes `page`), one
 * retry, a 1000 ms expect timeout, and ONLY the headroom reporter — so each
 * of its blocks is read back from what the reporter really printed.
 *
 * The fixture is named `*.chain.ts`, which the suite's default testMatch
 * does not select, so it never runs as part of the e2e suite.
 */
export default defineConfig({
  // The parent points this at a scratch copy for its mutation control.
  testDir: process.env.E2E_HEADROOM_CHAIN_DIR ?? "./headroom-chain",
  testMatch: /\.chain\.ts$/,
  workers: 1,
  retries: 1,
  timeout: 30_000,
  expect: { timeout: 1_000 },
  reporter: [
    [
      "./headroom-reporter.ts",
      {
        expectTimeoutMs: 1_000,
        github: true,
        ...(process.env.E2E_HEADROOM_CHAIN_SUMMARY
          ? { stepSummary: process.env.E2E_HEADROOM_CHAIN_SUMMARY }
          : {}),
      },
    ],
  ],
});
