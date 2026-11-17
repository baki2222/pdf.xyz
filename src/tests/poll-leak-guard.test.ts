// @vitest-environment node
/**
 * The guard in `./poll-leak-guard.ts`, held to a leak planted on purpose.
 *
 * A guard that never fires reads exactly like a suite with no leaks, so the
 * predicate is shown a real `pollJobToTerminal` loop that nobody stops
 * (positive control) and the same loop stopped (it must then pass), and the
 * wiring — the setup file every project runs, and the `afterAll` in it that
 * calls the guard — is read from the code, comments excluded, with a mutant
 * of that code that must fail the same reading.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import type { Job } from "@/lib/jobs/types";
import { pollJobToTerminal, pollsInFlight } from "@/lib/workers/job-polling";
import { sharedTestOptions } from "../../vitest.config";
import { assertNoPollLeft, pollsLeftAfter } from "./poll-leak-guard";

const RUNNING = { jobId: "j_leak", status: "running" } as unknown as Job;

/** A loop like the one that leaked: a job that never ends, on real timers. */
function plantLoop() {
  const controller = new AbortController();
  let reads = 0;
  const done = pollJobToTerminal({
    job: RUNNING,
    fetchImpl: async () => {
      reads += 1;
      // Ignores the signal, as the stubs that leaked did.
      return { ok: true, status: 200, json: async () => RUNNING };
    },
    pollIntervalMs: 5,
    maxPollAttempts: 100_000,
    signal: controller.signal,
  });
  return { controller, done, reads: () => reads };
}

describe("the poll-leak guard", () => {
  it("POSITIVE CONTROL: sees a loop left running, and passes once it is stopped", async () => {
    const before = pollsInFlight();
    const planted = plantLoop();
    try {
      // Health: the counter counts this loop, and the loop is really polling.
      expect(pollsInFlight()).toBe(before + 1);
      await expect.poll(planted.reads).toBeGreaterThan(2);
      await expect(assertNoPollLeft(150)).rejects.toThrow(
        /1 worker poll loop\(s\) \(pollJobToTerminal\) still running 150 ms/,
      );
    } finally {
      planted.controller.abort();
    }
    expect(await planted.done).toMatchObject({ ok: false });
    expect(pollsInFlight()).toBe(before);
    await expect(assertNoPollLeft(150)).resolves.toBeUndefined();
  });

  it("waits out a loop that is already stopping, rather than failing it", async () => {
    let left = 1;
    setTimeout(() => (left = 0), 50);
    expect(await pollsLeftAfter(1_000, () => left)).toBe(0);
  });

  it("a loop that ends in error still leaves the count", async () => {
    const before = pollsInFlight();
    const result = await pollJobToTerminal({
      job: RUNNING,
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
      pollIntervalMs: 1,
      maxPollAttempts: 10,
      sleepImpl: async () => {},
    });
    expect(result).toMatchObject({ ok: false, stillRunning: true });
    expect(pollsInFlight()).toBe(before);
  });
});

describe("the guard is wired into every file", () => {
  const ts = createRequire(import.meta.url)("typescript") as typeof TS;
  const ROOT = fileURLToPath(new URL("../..", import.meta.url));
  const SETUP = "./src/tests/setup.ts";

  /** True when `source` imports the guard and calls it inside an `afterAll`. */
  function registersGuard(source: string): boolean {
    const file = ts.createSourceFile(
      "setup.ts",
      source,
      ts.ScriptTarget.Latest,
    );
    let imported = false;
    let called = false;
    const visit = (node: TS.Node, inAfterAll: boolean): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "./poll-leak-guard" &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.some(
          (e) => e.name.text === "assertNoPollLeft",
        )
      )
        imported = true;
      let inside = inAfterAll;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === "afterAll") inside = true;
        if (node.expression.text === "assertNoPollLeft" && inAfterAll)
          called = true;
      }
      ts.forEachChild(node, (child) => visit(child, inside));
    };
    visit(file, false);
    return imported && called;
  }

  it("setup.ts is a setup file of every project (they spread these options)", () => {
    expect(sharedTestOptions.setupFiles).toContain(SETUP);
  });

  it("setup.ts calls the guard in an afterAll — and a mutant without it does not", () => {
    const source = readFileSync(path.join(ROOT, SETUP), "utf8");
    expect(registersGuard(source)).toBe(true);
    // Mutants, each checked to have landed before it is trusted.
    const unhooked = source.replace(
      /afterAll\(async \(\) => \{\s*await assertNoPollLeft\(\);\s*\}\);/,
      "",
    );
    expect(unhooked).not.toBe(source);
    expect(registersGuard(unhooked)).toBe(false);
    const commented = source.replace(
      /await assertNoPollLeft\(\);/,
      "// await assertNoPollLeft();",
    );
    expect(commented).not.toBe(source);
    expect(registersGuard(commented)).toBe(false);
  });
});
