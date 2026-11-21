// @vitest-environment node
/**
 * Guards the Playwright `webServer` command against the regression this branch
 * fixed: it launches through a shell, so a bare `pnpm start` 127s ("pnpm: not
 * found") wherever pnpm isn't on PATH — e.g. sandboxes/CI images that only ship
 * `corepack pnpm`. The command must instead be built from the shared
 * `resolvePnpmInvocation` helper, exactly like the worker CLIs.
 *
 * Quoting comes from the shared `shellQuote` rather than being spelled out
 * again here. It was spelled out here once, and when the config learned that
 * Windows parses the command with `cmd.exe` this test kept asserting POSIX
 * quotes — passing on the Linux runner while failing on the platform that had
 * just been fixed.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import config, {
  EXPECT_TIMEOUT_MS,
  e2eReporters,
} from "../../playwright.config";
import { resolvePnpmInvocation } from "@/lib/workers/exec-pnpm";
import { shellQuote } from "@/lib/workers/shell-quote";

describe("playwright webServer command", () => {
  const command =
    config.webServer && !Array.isArray(config.webServer)
      ? config.webServer.command
      : undefined;

  it("is defined as a single shell command", () => {
    expect(typeof command).toBe("string");
  });

  it("invokes `next start` via the portable pnpm resolution, not a bare `pnpm`", () => {
    const { command: pnpmCommand, prefixArgs } = resolvePnpmInvocation();
    const expected = [pnpmCommand, ...prefixArgs].map(shellQuote).join(" ");

    expect(command).toContain(`${expected} start --port `);
    // No bare, unquoted `pnpm` token that a non-PATH shell would fail to resolve.
    expect(command).not.toMatch(/(^|[^'\w-])pnpm\s/);
  });
});

describe("the e2e headroom reporter is wired into CI", () => {
  it("is in the CI reporter list, handed the suite's own expect timeout", () => {
    const ci = e2eReporters(true);
    const entry = ci.find(([name]) => name === "./e2e/headroom-reporter.ts");
    expect(entry, JSON.stringify(ci)).toBeDefined();
    // One constant spread two ways: the reporter cannot read the config's
    // expect timeout itself, so the two must be the same value.
    expect(entry![1]).toEqual({ expectTimeoutMs: EXPECT_TIMEOUT_MS });
    expect(config.expect?.timeout).toBe(EXPECT_TIMEOUT_MS);
    expect(
      existsSync(path.resolve(__dirname, "../..", entry![0])),
      entry![0],
    ).toBe(true);
    // The CI list keeps the reporters it had (github annotates failures).
    expect(ci.map(([name]) => name)).toEqual([
      "github",
      "html",
      "list",
      "./e2e/headroom-reporter.ts",
    ]);
  });

  it("runs locally only when asked", () => {
    expect(e2eReporters(false).map(([name]) => name)).toEqual(["list"]);
    expect(e2eReporters(false, true).map(([name]) => name)).toEqual([
      "list",
      "./e2e/headroom-reporter.ts",
    ]);
  });
});
