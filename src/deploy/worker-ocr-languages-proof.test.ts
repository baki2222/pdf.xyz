// @vitest-environment node
/**
 * The in-image OCR languages proof runs — checked by walking the chain it
 * runs through: `container.yml` step → `package.json` script → a file that
 * calls `runOcrLanguagesProof` with the REAL native deps and the registry's
 * own processors. A broken link is fatal. It is the only place the language
 * packs meet the image's Tesseract before production, so a proof that quietly
 * stopped running would leave every language after English untested.
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
const SCRIPT = "worker:ocr-languages-proof";

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

/** Every call `name(...)` in the file. */
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

describe("the in-image OCR languages proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(runLines.some((l) => /pnpm worker:ocr-proof$/.test(l))).toBe(true);
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
  });

  it("package.json points it at a file that calls the proof once", () => {
    expect(callsOf(scriptFile(), "runOcrLanguagesProof")).toHaveLength(1);
  });

  it("the processors are the registry's, built on the REAL native OCR and export deps", () => {
    const file = scriptFile();
    const registries = callsOf(file, "createProcessorRegistry");
    expect(registries).toHaveLength(1);
    const arg = registries[0]!.arguments[0];
    expect(arg && ts.isObjectLiteralExpression(arg)).toBe(true);
    const callee = (key: string) => {
      const p = (arg as TS.ObjectLiteralExpression).properties.find(
        (q) => q.name?.getText(file) === key,
      );
      const init = p && ts.isPropertyAssignment(p) ? p.initializer : undefined;
      return init &&
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression)
        ? init.expression.text
        : undefined;
    };
    expect(callee("ocr")).toBe("nativeOcrDeps");
    expect(callee("pdfOfficeExport")).toBe("pdfOfficeExportDeps");
    // Resolved by the tool slugs a job carries, so the chain is the one a
    // job reaches — not a processor constructed beside it.
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
    expect(resolved).toEqual(new Set(["ocr-pdf", "pdf-to-word"]));
    // Chromium and poppler from the image, not stubs.
    expect(callsOf(file, "nativeHtmlRenderDeps")).toHaveLength(1);
    expect(callsOf(file, "resolveNativePdfTextExtractor")).toHaveLength(1);
  });
});
