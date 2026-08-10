// @vitest-environment node
/**
 * Guards the `qa` gate against the regression this branch fixed: the old
 * `pnpm typecheck && pnpm lint && pnpm test && pnpm build` string runs through
 * `/bin/sh`, so a bare `pnpm` 127s ("pnpm: not found") wherever pnpm isn't on PATH —
 * e.g. sandboxes/CI images that only ship `corepack pnpm`, where `corepack pnpm qa`
 * died on the very first `pnpm typecheck`. `qa` must instead delegate to the portable
 * `scripts/qa.ts` runner, which spawns each step through the shared
 * `resolvePnpmInvocation` helper (exactly like the worker CLIs and the Playwright
 * webServer command).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { QA_STEPS } from "../../scripts/qa";

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../package.json", import.meta.url)),
    "utf8",
  ),
) as { scripts: Record<string, string> };

const qaSource = readFileSync(
  fileURLToPath(new URL("../../scripts/qa.ts", import.meta.url)),
  "utf8",
);

describe("qa gate", () => {
  it("delegates to the portable runner, not a bare-`pnpm` shell chain", () => {
    expect(pkg.scripts.qa).toBe("tsx scripts/qa.ts");
    // No bare, unquoted `pnpm <word>` token that a non-PATH shell would fail to resolve.
    expect(pkg.scripts.qa).not.toMatch(/(^|[^'\w-])pnpm\s/);
  });

  it("runs the full pre-push gate in order (cheapest first, build last)", () => {
    expect([...QA_STEPS]).toEqual(["typecheck", "lint", "test", "build"]);
  });

  it("spawns steps through the shared portable pnpm resolver", () => {
    expect(qaSource).toContain("resolvePnpmInvocation");
    // The runner must not hard-code a bare `pnpm` binary — resolution goes through the helper.
    expect(qaSource).not.toMatch(/spawnSync\(\s*["']pnpm["']/);
  });
});
