// @vitest-environment node
/**
 * Guards the Playwright `webServer` command against the regression this branch
 * fixed: it launches through `/bin/sh`, so a bare `pnpm start` 127s ("pnpm: not
 * found") wherever pnpm isn't on PATH — e.g. sandboxes/CI images that only ship
 * `corepack pnpm`. The command must instead be built from the shared
 * `resolvePnpmInvocation` helper, exactly like the worker CLIs.
 */
import { describe, expect, it } from "vitest";
import config from "../../playwright.config";
import { resolvePnpmInvocation } from "@/lib/workers/exec-pnpm";

describe("playwright webServer command", () => {
  const command = config.webServer && !Array.isArray(config.webServer)
    ? config.webServer.command
    : undefined;

  it("is defined as a single shell command", () => {
    expect(typeof command).toBe("string");
  });

  it("invokes `next start` via the portable pnpm resolution, not a bare `pnpm`", () => {
    const { command: pnpmCommand, prefixArgs } = resolvePnpmInvocation();
    const expected = [pnpmCommand, ...prefixArgs]
      .map((part) => `'${part.replace(/'/g, `'\\''`)}'`)
      .join(" ");

    expect(command).toContain(`${expected} start --port `);
    // No bare, unquoted `pnpm` token that a non-PATH shell would fail to resolve.
    expect(command).not.toMatch(/(^|[^'\w-])pnpm\s/);
  });
});
