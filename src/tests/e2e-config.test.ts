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
import config from "../../playwright.config";
import { resolvePnpmInvocation } from "@/lib/workers/exec-pnpm";
import { shellQuote } from "@/lib/workers/shell-quote";

describe("playwright webServer command", () => {
  const command = config.webServer && !Array.isArray(config.webServer)
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
