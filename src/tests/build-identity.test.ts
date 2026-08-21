// @vitest-environment node
/**
 * The adopted-server build-identity check: an e2e run must never silently test
 * another checkout's code — nor its OWN code from before the last rebuild.
 *
 * THE HISTORY, kept because the hole is the instructive part. The first version
 * probed the freshest local content-hashed chunk and accepted a `200`. That is
 * a MECHANISM, not the property: `next start` serves `/_next/static/*` straight
 * off disk, so after a rebuild in the same worktree the OLD process serves the
 * NEW chunk files from its OLD manifests and the check passed. It cost a full
 * e2e run — 30 cases red for the wrong reason.
 *
 * Measured live on 2026-08-16 rather than argued (see the module docblock):
 * the same stale server that the old check accepted is refused by this one,
 * and a server built from the current tree is still accepted.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localBuildId, verifyAdoptedServerBuild } from "./build-identity";

let tmp: string | null = null;

/** A `.next` directory carrying just the one file that identifies the build. */
function makeBuild(buildId: string): string {
  tmp = mkdtempSync(path.join(os.tmpdir(), "build-id-"));
  const nextDir = path.join(tmp, ".next");
  mkdirSync(nextDir, { recursive: true });
  writeFileSync(path.join(nextDir, "BUILD_ID"), buildId);
  return nextDir;
}

/** A response whose body embeds `servedId` the way a rendered page does. */
function page(servedId: string, status = 200) {
  return async () => ({
    status,
    text: async () =>
      `<!DOCTYPE html><script>self.__next_f.push([1,"{\\"b\\":\\"${servedId}\\"}"])</script>`,
  });
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe("localBuildId", () => {
  it("reads this checkout's build id", () => {
    expect(localBuildId(makeBuild("abc123"))).toBe("abc123");
  });

  it("returns null when there is no local build", () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "build-id-"));
    expect(localBuildId(path.join(tmp, ".next"))).toBeNull();
  });

  it("treats an empty BUILD_ID as no build, never as a wildcard", () => {
    expect(localBuildId(makeBuild("   "))).toBeNull();
  });
});

describe("verifyAdoptedServerBuild", () => {
  it("accepts a server whose document carries this build's id", async () => {
    const nextDir = makeBuild("SAME_BUILD_ID_0001");
    const asked: string[] = [];
    const verdict = await verifyAdoptedServerBuild(
      "http://127.0.0.1:3100",
      nextDir,
      async (url) => {
        asked.push(url);
        return page("SAME_BUILD_ID_0001")();
      },
    );
    expect(verdict).toEqual({ ok: true });
    // The document, not a static asset — a static asset is served off disk and
    // is therefore the same bytes for a stale process and a fresh one.
    expect(asked).toEqual(["http://127.0.0.1:3100/"]);
  });

  it("REFUSES a stale server in the same worktree — the rebuild-in-place hole", async () => {
    // THE CASE THE OLD CHECK COULD NOT SEE. Every static file on disk belongs
    // to the new build (so the old chunk probe answered 200 and passed), but
    // the process answering was started from the previous build and still
    // reports the id it booted with.
    const nextDir = makeBuild("NEW_BUILD_AFTER_REBUILD");
    const verdict = await verifyAdoptedServerBuild(
      "http://127.0.0.1:3100",
      nextDir,
      page("OLD_BUILD_STILL_RUNNING"),
    );
    expect(verdict).toEqual({ ok: false, reason: "build-id-mismatch" });
  });

  it("refuses another checkout's build", async () => {
    const nextDir = makeBuild("THIS_CHECKOUT");
    const verdict = await verifyAdoptedServerBuild(
      "http://127.0.0.1:3100",
      nextDir,
      page("SOME_OTHER_CHECKOUT"),
    );
    expect(verdict).toEqual({ ok: false, reason: "build-id-mismatch" });
  });

  it("refuses adoption entirely when this checkout has no build to compare", async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "build-id-"));
    const verdict = await verifyAdoptedServerBuild(
      "http://127.0.0.1:3100",
      path.join(tmp, ".next"),
      page("ANYTHING"),
    );
    expect(verdict).toEqual({ ok: false, reason: "no-local-build" });
  });

  it("treats a non-200 as unreachable, never as a pass", async () => {
    const nextDir = makeBuild("SAME");
    const verdict = await verifyAdoptedServerBuild(
      "http://127.0.0.1:3100",
      nextDir,
      page("SAME", 503),
    );
    expect(verdict).toEqual({ ok: false, reason: "unreachable" });
  });

  it("treats a transport failure as unreachable, never as a pass", async () => {
    const nextDir = makeBuild("SAME");
    const verdict = await verifyAdoptedServerBuild(
      "http://127.0.0.1:3100",
      nextDir,
      async () => {
        throw new Error("refused");
      },
    );
    expect(verdict).toEqual({ ok: false, reason: "unreachable" });
  });

  it("FAILS CLOSED when the document stops carrying a build id at all", async () => {
    // The fragility this design accepts deliberately: the id is found by a
    // literal search, so a future Next that stops embedding it turns this RED
    // on the next run rather than matching nothing and passing.
    const nextDir = makeBuild("SAME");
    const verdict = await verifyAdoptedServerBuild(
      "http://127.0.0.1:3100",
      nextDir,
      async () => ({ status: 200, text: async () => "<!DOCTYPE html>hello" }),
    );
    expect(verdict).toEqual({ ok: false, reason: "build-id-mismatch" });
  });
});
