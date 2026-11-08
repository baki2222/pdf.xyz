// @vitest-environment node
/**
 * The in-image OCR redo proof runs — checked by walking the chain it runs
 * through: `container.yml` step → `package.json` script → a file that calls
 * `runOcrRedoProof` with the registry's OCR processor on the REAL native
 * deps and poppler. A broken link is fatal. It is the only place the table
 * behind “Redo existing OCR”'s copy (`REDO_OCR_LAYER_OUTCOMES`: which old
 * layers OCRmyPDF replaces and which it keeps) meets OCRmyPDF, and a table of
 * engine behaviour has nothing else to check it: the argv was right on
 * 2026-11-08 while the copy promised a removal the engine does not do.
 * An AST, not `toContain`: comments are not nodes.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SCRIPT = "worker:ocr-redo-proof";

function walk(node: TS.Node, visit: (n: TS.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

const runLines = read(".github/workflows/container.yml")
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n")
  .split(/\n(?=\s*- name:)/)
  .flatMap((step) => {
    const m = /\brun:\s*([^\n]+)/.exec(step);
    return m ? [m[1]!.trim()] : [];
  });

function scriptFile(): TS.SourceFile {
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };
  const target = /^tsx (\S+\.ts)$/.exec(pkg.scripts[SCRIPT] ?? "")?.[1];
  expect(target, `${SCRIPT} must run a .ts file with tsx`).toBeDefined();
  expect(existsSync(path.join(ROOT, target!))).toBe(true);
  return ts.createSourceFile(
    target!,
    read(target!),
    ts.ScriptTarget.Latest,
    true,
  );
}

function callsOf(file: TS.SourceFile, name: string): TS.CallExpression[] {
  const calls: TS.CallExpression[] = [];
  walk(file, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === name
    )
      calls.push(n);
  });
  return calls;
}

describe("the in-image OCR redo proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(
      runLines.some((l) => /pnpm worker:ocr-languages-proof$/.test(l)),
    ).toBe(true);
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
  });

  it("package.json points it at a file that calls the proof once", () => {
    expect(callsOf(scriptFile(), "runOcrRedoProof")).toHaveLength(1);
  });

  it("the OCR processor is the registry's, on the REAL native deps; poppler is the image's", () => {
    const file = scriptFile();
    const registries = callsOf(file, "createProcessorRegistry");
    expect(registries).toHaveLength(1);
    const arg = registries[0]!.arguments[0];
    expect(arg && ts.isObjectLiteralExpression(arg)).toBe(true);
    const ocrProp = (arg as TS.ObjectLiteralExpression).properties.find(
      (q) => q.name?.getText(file) === "ocr",
    );
    const init =
      ocrProp && ts.isPropertyAssignment(ocrProp)
        ? ocrProp.initializer
        : undefined;
    expect(
      init && ts.isCallExpression(init) && ts.isIdentifier(init.expression)
        ? init.expression.text
        : undefined,
    ).toBe("nativeOcrDeps");
    // Resolved by the slug a job carries.
    const resolved = new Set<string>();
    walk(file, (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "resolve" &&
        n.arguments[0] &&
        ts.isStringLiteral(n.arguments[0])
      )
        resolved.add(n.arguments[0].text);
    });
    expect(resolved).toEqual(new Set(["ocr-pdf"]));
    expect(callsOf(file, "resolveNativePdfTextExtractor")).toHaveLength(1);
    // No stand-in engine: the proof spawns nothing of its own.
    expect(callsOf(file, "execFile")).toHaveLength(0);
    // A real scan (pixels only), the one the OCR-first proofs use.
    expect(callsOf(file, "scannedTextPdf")).toHaveLength(1);
  });
});
