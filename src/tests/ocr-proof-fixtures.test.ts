// @vitest-environment node
/**
 * The OCR deployment proof must be able to FAIL on the defect it exists for,
 * and must be wired where it can run.
 *
 * `mixedSidecarVerdict` is what `pnpm worker:prove-tools` reads from the .txt a
 * mixed document yields; the chain test in `ocr-native.test.ts` shows it passes
 * on a correct run. Here: it fails on the two wrong ones — OCRmyPDF's skip
 * placeholder where the typed page belongs, and a sidecar missing the page.
 *
 * Then the script itself, read through the TypeScript parser because it runs
 * on import: the ocr-pdf specs must use that fixture and verdict, and the
 * encrypted-refusal spec must come AFTER the spec that produces its input —
 * `worker:prove-tools` hands artifacts forward in SPECS order, so a consumer
 * placed first would report UNPROVEN on every run, forever, for a reason that
 * says nothing about OCR.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import {
  MIXED_TYPED_LINE,
  mixedScanPdf,
  mixedSidecarVerdict,
} from "./ocr-proof-fixtures";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const encode = (text: string) => new TextEncoder().encode(text);

describe("mixedSidecarVerdict — fails on the defect, passes on the fix", () => {
  it("fails on the placeholder OCRmyPDF writes for the page it kept", async () => {
    const verdict = await mixedSidecarVerdict(
      encode("[OCR skipped on page 1]\fsome scan text"),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/placeholder/);
  });

  it("fails when the typed page's words are simply absent", async () => {
    expect((await mixedSidecarVerdict(encode("scan text only"))).ok).toBe(
      false,
    );
  });

  it("passes when the typed page arrives as its own words", async () => {
    expect(
      (await mixedSidecarVerdict(encode(`${MIXED_TYPED_LINE}\n\fscan`))).ok,
    ).toBe(true);
  });

  it("builds a two-page PDF: one typed page, one scan", async () => {
    const bytes = await mixedScanPdf();
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });
});

const SCRIPT = fileURLToPath(
  new URL("../../scripts/worker-prove-tools.ts", import.meta.url),
);

interface SpecView {
  index: number;
  props: Map<string, TS.Expression>;
  text: string;
}

/** Every object literal inside `const SPECS = [...]`, in array order. */
function specs(source: string): SpecView[] {
  const file = ts.createSourceFile(
    "worker-prove-tools.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let array: TS.ArrayLiteralExpression | null = null;
  const walk = (n: TS.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText(file) === "SPECS" &&
      n.initializer &&
      ts.isArrayLiteralExpression(n.initializer)
    )
      array = n.initializer;
    ts.forEachChild(n, walk);
  };
  walk(file);
  if (!array) return [];
  return (array as TS.ArrayLiteralExpression).elements
    .filter(ts.isObjectLiteralExpression)
    .map((obj, index) => {
      const props = new Map<string, TS.Expression>();
      for (const p of obj.properties)
        if (ts.isPropertyAssignment(p))
          props.set(p.name.getText(file), p.initializer);
      return { index, props, text: obj.getText(file) };
    });
}

const str = (e: TS.Expression | undefined) =>
  e && ts.isStringLiteral(e) ? e.text : undefined;

describe("worker-prove-tools — the OCR proofs are wired where they can run", () => {
  const all = specs(readFileSync(SCRIPT, "utf8"));
  const ocr = all.filter((s) => str(s.props.get("tool")) === "ocr-pdf");

  it("found the SPECS array and its OCR specs (health check)", () => {
    // A parser that finds nothing would make every assertion below vacuous.
    expect(all.length).toBeGreaterThan(20);
    expect(ocr.length).toBeGreaterThanOrEqual(4);
  });

  it("proves a mixed document through its fixture and sidecar verdict", () => {
    const mixed = ocr.filter(
      (s) =>
        s.props.get("make")?.getText().includes("mixedScanPdf") &&
        s.props.get("verify")?.getText().includes("mixedSidecarVerdict"),
    );
    expect(mixed).toHaveLength(1);
    // The verdict reads the .txt, so the spec must pick that artifact.
    expect(mixed[0]!.props.get("artifact")?.getText()).toMatch(/\.txt/);
  });

  it("proves the encrypted refusal AFTER the spec that produces its input", () => {
    const refusals = ocr.filter((s) => s.props.has("expectFailure"));
    expect(refusals).toHaveLength(1);
    const refusal = refusals[0]!;
    const from = str(refusal.props.get("from"));
    expect(from).toBeDefined();
    const producer = all.find(
      (s) => str(s.props.get("keepArtifactAs")) === from,
    );
    expect(producer, `no spec keeps an artifact as "${from}"`).toBeDefined();
    expect(producer!.index).toBeLessThan(refusal.index);
    expect(refusal.props.get("expectFailure")!.getText()).toMatch(/Unlock PDF/);
  });
});
