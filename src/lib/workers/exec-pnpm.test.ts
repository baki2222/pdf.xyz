// @vitest-environment node
/**
 * `resolvePnpmInvocation` — the seam every worker CLI and the Playwright
 * webServer resolve pnpm through.
 *
 * The PATH-probe case is the one that was broken on Windows: `execFileSync`
 * without a shell cannot execute `pnpm.CMD`, so a machine with a perfectly
 * good pnpm on PATH fell through to the corepack fallback — which is dead
 * under Node >= 24 (corepack no longer ships with Node) — and Playwright's
 * webServer could not start from a bare shell. On Windows this test FAILS on
 * pre-fix `main` (the probe threw and resolution answered `corepack`); on
 * Linux CI it passes on both, because a shell-less `pnpm` spawn works there —
 * an environment-conditional behavioural pin, stated as such.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OLD_EXECPATH = process.env.npm_execpath;

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  if (OLD_EXECPATH === undefined) delete process.env.npm_execpath;
  else process.env.npm_execpath = OLD_EXECPATH;
});

async function resolve() {
  const { resolvePnpmInvocation } = await import("./exec-pnpm");
  return resolvePnpmInvocation();
}

describe("resolvePnpmInvocation", () => {
  it("reuses the pnpm entrypoint of the run that launched this process", async () => {
    process.env.npm_execpath = "/somewhere/pnpm/bin/pnpm.cjs";
    expect(await resolve()).toEqual({
      command: process.execPath,
      prefixArgs: ["/somewhere/pnpm/bin/pnpm.cjs"],
    });
  });

  it("finds a pnpm on PATH when launched outside a pnpm run", async () => {
    // The bare-shell case (a direct `node`/`npx` launch, or Playwright's
    // webServer resolution at config load): the probe must find the pnpm this
    // machine demonstrably has, not fall through to a dead corepack.
    delete process.env.npm_execpath;
    expect(await resolve()).toEqual({ command: "pnpm", prefixArgs: [] });
  });
});
