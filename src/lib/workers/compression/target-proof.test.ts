// @vitest-environment node
/**
 * The deployment proof for Target size (2026-10-31) must be able to FAIL on
 * each way a target job can be wrong at the wire — and the proof script must
 * call it. The script runs on import, so its specs are read through the
 * TypeScript parser, as `pdf-structure/proof-spec.test.ts` reads its own.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import { colourImagePdf } from "./colour-image-pdf";
import { targetProofVerdict } from "./target-proof";
import type { JobResults } from "@/lib/jobs/results";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const SCRIPT = fileURLToPath(
  new URL("../../../../scripts/worker-prove-tools.ts", import.meta.url),
);

describe("targetProofVerdict", async () => {
  const pdf = await colourImagePdf({ components: 3, size: 8 });
  const n = pdf.byteLength;
  const record = (
    over: Partial<NonNullable<JobResults["compression"]>["target"]> = {},
  ): JobResults => ({
    compression: {
      pageCheck: "verified",
      pagesIn: 1,
      pagesOut: 1,
      target: {
        targetBytes: n + 10,
        met: true,
        attempts: 2,
        outputBytes: n,
        ...over,
      },
    },
  });

  it("passes a met download its record describes", () => {
    expect(
      targetProofVerdict(pdf, record(), { targetBytes: n + 10, met: true }).ok,
    ).toBe(true);
  });
  it("passes a not-met download, when not-met was expected", () => {
    const r = record({ targetBytes: n - 10, met: false });
    expect(
      targetProofVerdict(pdf, r, { targetBytes: n - 10, met: false }).ok,
    ).toBe(true);
  });
  it.each([
    [
      "no target block (a stale worker)",
      {
        compression: { pageCheck: "verified", pagesIn: 1, pagesOut: 1 },
      } as JobResults,
      { targetBytes: n + 10, met: true },
    ],
    ["no results at all", undefined, { targetBytes: n + 10, met: true }],
    [
      "a record for another target",
      record({ targetBytes: n + 99 }),
      { targetBytes: n + 10, met: true },
    ],
    [
      "a record describing another file",
      record({ outputBytes: n - 1 }),
      { targetBytes: n + 10, met: true },
    ],
    [
      "a record claiming met over the target",
      record({ targetBytes: n - 10, met: true }),
      { targetBytes: n - 10, met: true },
    ],
    ["the wrong outcome", record(), { targetBytes: n + 10, met: false }],
  ])("FAILS %s", (_name, results, want) => {
    expect(targetProofVerdict(pdf, results, want).ok).toBe(false);
  });
  it("FAILS a download that is not a PDF", () => {
    const junk = new Uint8Array(n);
    expect(
      targetProofVerdict(junk, record(), { targetBytes: n + 10, met: true }).ok,
    ).toBe(false);
  });
});

describe("the proof script judges every target-size job with targetProofVerdict", () => {
  it("each compress-pdf spec that sends targetBytes calls it, and both outcomes are proven", () => {
    const file = ts.createSourceFile(
      "worker-prove-tools.ts",
      readFileSync(SCRIPT, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const specs: { label: string; calls: boolean; met: string }[] = [];
    const walk = (n: TS.Node) => {
      if (ts.isObjectLiteralExpression(n)) {
        const prop = (name: string) =>
          n.properties.find(
            (p): p is TS.PropertyAssignment =>
              ts.isPropertyAssignment(p) && p.name.getText(file) === name,
          );
        const options = prop("options")?.initializer;
        const sendsTarget =
          prop("tool")?.initializer.getText(file) === '"compress-pdf"' &&
          !!options &&
          ts.isObjectLiteralExpression(options) &&
          options.properties.some(
            (p) => p.name?.getText(file) === "targetBytes",
          );
        if (sendsTarget) {
          const verify = prop("verify")?.initializer.getText(file) ?? "";
          specs.push({
            label: prop("label")?.initializer.getText(file) ?? "",
            calls: /\btargetProofVerdict\(/.test(verify),
            met: /met:\s*(true|false)/.exec(verify)?.[1] ?? "",
          });
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(file);
    // Health: the walk found the specs it must (not a vacuous pass).
    expect(specs.map((s) => s.label)).toEqual([
      '"compress-pdf (target size)"',
      '"compress-pdf (target size, not met)"',
    ]);
    expect(specs.every((s) => s.calls)).toBe(true);
    expect(specs.map((s) => s.met).sort()).toEqual(["false", "true"]);
  });
});
