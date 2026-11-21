// @vitest-environment node
/**
 * Standing controls for `supportCorpus`'s two reaches OUTSIDE the
 * test-side folders, run on a tree written to the OS temp directory (never
 * under src/ or e2e/, where a tree walk running at the same moment would
 * list it: see chain-scratch.test.ts).
 *
 * HISTORY (verifier, 2026-11-21): the "calls the test framework" reach had
 * no real member and no control — replacing its condition with `false`
 * kept every test green — and a timing helper in `src/lib/` that threw on
 * `performance.now() - t0 > 250` without calling `expect` or `vi` was
 * never scanned. The second reach (a module only the corpus imports is
 * test support) closes that hole; both are held here, each with a member
 * that must be IN and members that must stay OUT (widening is a defect
 * too: product deadlines, route handlers, dynamic imports).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lexicalEdges, supportCorpus } from "./wall-clock-corpus";
import { scanSource } from "./wall-clock-detector";

const TREE: Record<string, string> = {
  // The roots supportCorpus walks must exist (a missing one is fatal there).
  "e2e/README.md": "",
  "scripts/README.md": "",
  "src/tests/entry.ts": [
    `import { under } from "../lib/helper/expect-under";`,
    `import { check } from "../lib/plant/timing-util";`,
    `import { late } from "../lib/prod/deadline";`,
    `import { GET } from "../app/api/x/route";`,
    `import { mid } from "@/lib/chain/mid";`,
    `import { t } from "../lib/prod/typed";`,
    `import { lazy } from "../lib/prod/lazy";`,
    `test("a", () => { under(0); check(performance.now()); late(0); GET(); mid(); void t; void lazy; });`,
  ].join("\n"),
  "src/lib/helper/expect-under.ts": `export const under = (n: number) => expect(n).toBeLessThan(1);\n`,
  "src/lib/plant/timing-util.ts": [
    `export function check(t0: number) {`,
    `  if (performance.now() - t0 > 250) throw new Error("too slow");`,
    `}`,
  ].join("\n"),
  "src/lib/prod/deadline.ts": `export const late = (d: number) => Date.now() > d;\n`,
  "src/lib/prod/typed.ts": `export type X = number;\nexport const t = 1;\n`,
  "src/lib/prod/lazy.ts": `export const lazy = () => Date.now();\n`,
  "src/lib/prod/user.ts": [
    `import { late } from "./deadline";`,
    `import type { X } from "./typed";`,
    `export const u = async (x: X) => late(x) && (await import("./lazy")).lazy();`,
  ].join("\n"),
  "src/app/api/x/route.ts": `export async function GET() { return new Response(String(Date.now())); }\n`,
  "src/lib/chain/mid.ts": `import { leaf } from "./leaf";\nexport const mid = () => leaf();\n`,
  "src/lib/chain/leaf.ts": `export const leaf = () => performance.now();\n`,
};

let root = "";
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "wall-clock-corpus-"));
  for (const [file, text] of Object.entries(TREE)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("supportCorpus outside the test-side folders", () => {
  it("reaches a helper that calls the test framework (the `outside` reach)", () => {
    const c = supportCorpus(["src/tests/entry.ts"], { root });
    expect(c.outside).toEqual(["src/lib/helper/expect-under.ts"]);
    expect(c.modules).toContain("src/lib/helper/expect-under.ts");
    expect(c.broken).toEqual([]);
  });

  it("reaches every module only the corpus imports, transitively, and nothing product code loads (the `testOnly` reach)", () => {
    const c = supportCorpus(["src/tests/entry.ts"], { root });
    console.log(`[wall-clock-corpus] testOnly: ${c.testOnly.join(", ")}`);
    expect(c.testOnly).toEqual([
      "src/lib/chain/leaf.ts",
      "src/lib/chain/mid.ts",
      "src/lib/plant/timing-util.ts",
      // Product code imports it only as a type: erased at runtime.
      "src/lib/prod/typed.ts",
    ]);
    for (const out of [
      "src/lib/prod/deadline.ts", // a static product importer
      "src/lib/prod/lazy.ts", // a dynamic `import("./lazy")` from product
      "src/app/api/x/route.ts", // a Next.js convention entry, importer-less
    ])
      expect(c.modules, out).not.toContain(out);
  });

  it("the planted helper is a member the detector flags (the composed chain, not the unit)", () => {
    const c = supportCorpus(["src/tests/entry.ts"], { root });
    const file = "src/lib/plant/timing-util.ts";
    expect(c.modules).toContain(file);
    const r = scanSource(TREE[file]!, file);
    expect(r.comparisons.map((m) => m.snippet)).toEqual([
      expect.stringContaining("performance.now() - t0 > 250"),
    ]);
  });

  it("lexicalEdges: static, re-export, dynamic and require edges, never a type-only one", () => {
    expect(
      lexicalEdges(
        [
          `import a from "./a";`,
          `import { b } from "./b";`,
          `import type { C } from "./c";`,
          `import type {\n  D,\n} from "./d";`,
          `export * from "./e";`,
          `export type { F } from "./f";`,
          `const g = await import("./g");`,
          `const h = require("./h");`,
          `import "./i";`,
        ].join("\n"),
      ),
    ).toEqual(["./a", "./b", "./e", "./g", "./h", "./i"]);
  });
});
