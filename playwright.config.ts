import { defineConfig, devices } from "@playwright/test";
import { resolvePnpmInvocation } from "./src/lib/workers/exec-pnpm";

/**
 * Playwright runs the smoke suite against a real production build served by
 * `next start`, so the tests exercise the exact security headers / CSP and
 * statically-generated output that ship to users — not the dev server. Run
 * `pnpm build` before this suite (CI does this explicitly).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;

// Playwright launches `webServer.command` through `/bin/sh` on POSIX but
// through `cmd.exe` on Windows, so a bare `pnpm` 127s wherever pnpm isn't on
// PATH (this cron sandbox has only `corepack pnpm`). Resolve it the same way
// the worker CLIs do — reusing the shared helper — and shell-quote each part so
// a resolved node/pnpm path containing spaces survives. Quote for whichever
// shell actually parses the string: `cmd.exe` does not treat `'` as a quote
// character at all, so POSIX quoting there splits `C:\Program Files\...` back
// into separate tokens and the spawn fails before Next ever starts.
const isWindows = process.platform === "win32";
const shQuote = (s: string): string =>
  isWindows ? `"${s.replace(/"/g, '""')}"` : `'${s.replace(/'/g, `'\\''`)}'`;
const { command: pnpmCommand, prefixArgs } = resolvePnpmInvocation();
const pnpm = [pnpmCommand, ...prefixArgs].map(shQuote).join(" ");

// `rm` is not a `cmd.exe` builtin, so clear the stale Next lock through node
// instead — one spelling that both shells parse identically.
const clearNextLock = `node -e "require('fs').rmSync('.next/lock',{force:true,recursive:true})"`;

export default defineConfig({
  testDir: "./e2e",
  // Fail fast when the port is already held by a dev server, instead of
  // silently adopting it via `webServer.reuseExistingServer`.
  globalSetup: "./e2e/global-setup.ts",
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${clearNextLock} && ${pnpm} start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
