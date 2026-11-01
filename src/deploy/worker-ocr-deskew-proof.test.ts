// @vitest-environment node
/**
 * The in-image OCR deskew proof runs — checked by walking the chain it runs
 * through: `container.yml` step → `package.json` script → a file that calls
 * `runOcrDeskewProof` with the registry's OCR processor on the REAL native
 * deps, poppler, and the image's own `ocrmypdf`. A broken link is fatal. It
 * is the only place "Straighten crooked pages" meets OCRmyPDF before a user
 * does, so a proof that quietly stopped running would leave the page's
 * claim that it straightens anything resting on argv tests alone.
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
const SCRIPT = "worker:ocr-deskew-proof";

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

describe("the in-image OCR deskew proof runs, from the workflow to the call", () => {
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
    expect(callsOf(scriptFile(), "runOcrDeskewProof")).toHaveLength(1);
  });

  it("the OCR processor is the registry's, on the REAL native deps; poppler and ocrmypdf are the image's", () => {
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
    const literals = new Set<string>();
    walk(file, (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "resolve" &&
        n.arguments[0] &&
        ts.isStringLiteral(n.arguments[0])
      )
        resolved.add(n.arguments[0].text);
      if (ts.isStringLiteral(n)) literals.add(n.text);
    });
    expect(resolved).toEqual(new Set(["ocr-pdf"]));
    expect(callsOf(file, "resolveNativePdfTextExtractor")).toHaveLength(1);
    // The pair check runs the image's own binary, not a stand-in.
    expect(callsOf(file, "execFile")).toHaveLength(1);
    expect(literals).toContain("ocrmypdf");
    // What a viewer paints, through the same renderer the unit test uses.
    expect(callsOf(file, "renderPdfPages")).toHaveLength(1);
    expect(callsOf(file, "greyOf")).toHaveLength(1);
  });
});
