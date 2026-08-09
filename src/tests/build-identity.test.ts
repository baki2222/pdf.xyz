// @vitest-environment node
/**
 * The adopted-server build-identity check: an e2e run must never silently test
 * another checkout's code. These import the new helper, so they cannot fail on
 * pre-fix `main` — the behavioural incident they encode was measured live
 * (a worktree suite adopted the main tree's stale `next start` and failed new
 * specs against last week's build) rather than reproduced in vitest.
 */
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discriminatingChunk, verifyAdoptedServerBuild } from "./build-identity";

let tmp: string | null = null;

function makeBuild(): string {
  tmp = mkdtempSync(path.join(os.tmpdir(), "build-id-"));
  const chunks = path.join(tmp, ".next", "static", "chunks");
  mkdirSync(path.join(chunks, "app"), { recursive: true });
  writeFileSync(path.join(chunks, "framework-aaaa.js"), "old");
  writeFileSync(path.join(chunks, "app", "page-bbbb.js"), "new");
  // Make mtimes deterministic: the app page chunk is strictly newer.
  utimesSync(path.join(chunks, "framework-aaaa.js"), new Date(1000), new Date(1000));
  utimesSync(path.join(chunks, "app", "page-bbbb.js"), new Date(2000), new Date(2000));
  return path.join(tmp, ".next");
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe("discriminatingChunk", () => {
  it("picks the newest content-hashed chunk, as a served URL path", () => {
    const nextDir = makeBuild();
    expect(discriminatingChunk(nextDir)).toBe("/_next/static/chunks/app/page-bbbb.js");
  });

  it("returns null when there is no local build", () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "build-id-"));
    expect(discriminatingChunk(path.join(tmp, ".next"))).toBeNull();
  });
});

describe("verifyAdoptedServerBuild", () => {
  it("accepts a server that serves this build's freshest chunk", async () => {
    const nextDir = makeBuild();
    const asked: string[] = [];
    const verdict = await verifyAdoptedServerBuild(
      "http://127.0.0.1:3100",
      nextDir,
      async (url) => {
        asked.push(url);
        return { status: 200 };
      },
    );
    expect(verdict).toEqual({ ok: true });
    expect(asked).toEqual([
      "http://127.0.0.1:3100/_next/static/chunks/app/page-bbbb.js",
    ]);
  });

  it("refuses a server that 404s the chunk — another checkout's build", async () => {
    const nextDir = makeBuild();
    const verdict = await verifyAdoptedServerBuild(
      "http://127.0.0.1:3100",
      nextDir,
      async () => ({ status: 404 }),
    );
    expect(verdict).toEqual({ ok: false, reason: "chunk-not-served" });
  });

  it("refuses adoption entirely when this checkout has no build to compare", async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "build-id-"));
    const verdict = await verifyAdoptedServerBuild(
      "http://127.0.0.1:3100",
      path.join(tmp, ".next"),
      async () => ({ status: 200 }),
    );
    expect(verdict).toEqual({ ok: false, reason: "no-local-build" });
  });

  it("treats a transport failure as not-served, never as a pass", async () => {
    const nextDir = makeBuild();
    const verdict = await verifyAdoptedServerBuild(
      "http://127.0.0.1:3100",
      nextDir,
      async () => {
        throw new Error("refused");
      },
    );
    expect(verdict).toEqual({ ok: false, reason: "chunk-not-served" });
  });
});
