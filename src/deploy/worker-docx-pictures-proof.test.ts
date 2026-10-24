// @vitest-environment node
/**
 * The in-image PDF to Word pictures proof runs, from the workflow to the
 * call — walked through the chain it actually runs on, not searched for by
 * words:
 *
 *   `container.yml` runs `docker run … pdfxyz-worker:ci pnpm
 *   worker:docx-pictures-proof` → `package.json` maps that script to a file
 *   → that file calls `runDocxPicturesProof` with the worker's OWN deps
 *   (`pdfOfficeExportDeps`) and the LibreOffice runner Word to PDF uses
 *   (`nativeOfficeConversionDeps(…).libreoffice`), over every committed
 *   fixture, with both controls and the damaged fixture.
 *
 * Why it matters: the unit suites stand poppler in, and no vitest suite runs
 * in the image. This step is the ONE place in CI where PDF to Word's text
 * (poppler) and pictures (pdf.js) meet, and where a word processor lays the
 * .docx out; a proof that silently stopped running would leave that seam
 * untested everywhere, behind a green suite.
 *
 * And the production proof asks the deployed worker the same question:
 * its pdf-to-word spec sends the Word proof PDF and judges the picture, and
 * the round trip through Word to PDF is judged by the round-trip verdict.
 *
 * An AST and not `toContain`, as in `worker-pptx-fidelity-proof.test.ts`:
 * a guard that matches prose stays green while the step runs something
 * else. Comments are not nodes.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SCRIPT = "worker:docx-pictures-proof";

function walk(node: TS.Node, visit: (n: TS.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** Named value imports of a file: local name → module specifier. */
function importsOf(file: TS.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of file.statements) {
    if (!ts.isImportDeclaration(stmt) || stmt.importClause?.isTypeOnly)
      continue;
    const from = (stmt.moduleSpecifier as TS.StringLiteral).text;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const el of bindings.elements)
        if (!el.isTypeOnly) out.set(el.name.text, from);
  }
  return out;
}

function initializerOf(
  file: TS.SourceFile,
  name: string,
): TS.Expression | undefined {
  let found: TS.Expression | undefined;
  walk(file, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer
    )
      found = n.initializer;
  });
  return found;
}

const calleeName = (e: TS.Expression | undefined): string | undefined =>
  e && ts.isCallExpression(e) && ts.isIdentifier(e.expression)
    ? e.expression.text
    : undefined;

/** Executable `run:` lines of the container workflow (comments dropped). */
const runLines = read(".github/workflows/container.yml")
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n")
  .split(/\n(?=\s*- name:)/)
  .flatMap((step) => {
    const m = /\brun:\s*([^\n]+)/.exec(step);
    return m ? [m[1]!.trim()] : [];
  });

describe("the in-image PDF to Word pictures proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(
      runLines.some((l) => /pnpm worker:pptx-fidelity-proof$/.test(l)),
    ).toBe(true);
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step, `no container.yml step runs ${SCRIPT}`).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
    expect(read(".github/workflows/container.yml")).toMatch(
      /target:\s*worker\s*\n\s*tags:\s*pdfxyz-worker:ci/,
    );
  });

  it("package.json points it at a file that calls the proof on the worker's own deps and LibreOffice", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    const target = /^tsx (\S+\.ts)$/.exec(pkg.scripts[SCRIPT] ?? "")?.[1];
    expect(target, `${SCRIPT} must run a .ts file with tsx`).toBeDefined();
    expect(existsSync(path.join(ROOT, target!))).toBe(true);
    const file = ts.createSourceFile(
      target!,
      read(target!),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = importsOf(file);
    expect(imports.get("runDocxPicturesProof")).toBe(
      "@/lib/workers/pdf-office-export/docx-pictures-proof",
    );
    expect(imports.get("pdfOfficeExportDeps")).toBe(
      "@/lib/workers/pdf-office-export/native",
    );
    expect(imports.get("nativeOfficeConversionDeps")).toBe(
      "@/lib/workers/office-conversion/native",
    );
    expect(imports.get("DOCX_PICTURE_FIXTURES")).toBe(
      "@/tests/docx-picture-fixtures",
    );
    expect(imports.get("docxTextOnly20261017")).toBe(
      "@/tests/docx-text-only-2026-10-17",
    );
    expect(imports.get("junkAfterEofPdf")).toBe(
      "@/tests/pptx-fidelity-fixtures",
    );

    const calls: TS.CallExpression[] = [];
    walk(file, (n) => {
      if (ts.isCallExpression(n) && calleeName(n) === "runDocxPicturesProof")
        calls.push(n);
    });
    expect(calls).toHaveLength(1);
    const arg = calls[0]!.arguments[0];
    expect(arg && ts.isObjectLiteralExpression(arg)).toBe(true);
    const props = new Map(
      (arg as TS.ObjectLiteralExpression).properties.map((p) => [
        p.name?.getText(file) ?? "",
        p,
      ]),
    );
    for (const key of [
      "exportDeps",
      "toPdf",
      "fixtures",
      "damaged",
      "textOnlyDocx",
      "dropOnePicture",
    ])
      expect(props.has(key), `runDocxPicturesProof is not given ${key}`).toBe(
        true,
      );
    // The worker's own deps, from the image's environment.
    expect(calleeName(initializerOf(file, "exportDeps"))).toBe(
      "pdfOfficeExportDeps",
    );
    const lo = initializerOf(file, "libreoffice");
    expect(
      lo &&
        ts.isPropertyAccessExpression(lo) &&
        lo.name.text === "libreoffice" &&
        calleeName(lo.expression),
    ).toBe("nativeOfficeConversionDeps");
    expect(props.get("toPdf")!.getText(file)).toMatch(
      /libreoffice\.convertToPdf\(/,
    );
    // Every fixture, derived from the list; the damaged one a committed
    // fixture, damaged; and no poppler, page reader or qpdf, no conclusion.
    expect(file.getFullText()).toMatch(/DOCX_PICTURE_FIXTURES\.map\(/);
    expect(props.get("damaged")!.getText(file)).toMatch(/junkAfterEofPdf\(/);
    for (const needed of [
      /!exportDeps\.extractFlow/,
      /!exportDeps\.scanPages/,
      /!exportDeps\.repairPdf/,
      /!libreoffice/,
    ])
      expect(file.getFullText()).toMatch(needed);
  });
});

describe("the production proof asks PDF to Word about its picture, and LibreOffice lays it out", () => {
  const FILE = "scripts/worker-prove-tools.ts";
  const file = ts.createSourceFile(
    FILE,
    read(FILE),
    ts.ScriptTarget.Latest,
    true,
  );
  const specs: TS.ObjectLiteralExpression[] = [];
  walk(file, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText(file) === "SPECS" &&
      n.initializer &&
      ts.isArrayLiteralExpression(n.initializer)
    )
      for (const el of n.initializer.elements)
        if (ts.isObjectLiteralExpression(el)) specs.push(el);
  });
  const prop = (node: TS.ObjectLiteralExpression, name: string) =>
    node.properties.find(
      (p): p is TS.PropertyAssignment =>
        ts.isPropertyAssignment(p) && p.name.getText(file) === name,
    );
  const str = (node: TS.ObjectLiteralExpression, name: string) => {
    const p = prop(node, name);
    return p && ts.isStringLiteral(p.initializer) ? p.initializer.text : null;
  };

  it("health check: SPECS was found and is the size it plausibly is", () => {
    expect(specs.length).toBeGreaterThan(15);
    expect(specs.length).toBeLessThan(200);
  });

  // The unlabelled pdf-to-word spec is the pictures proof; since 2026-10-24
  // a second, labelled one proves the OCR option (asserted below), so "the
  // pdf-to-word spec" is the one with no label.
  const picturesSpecs = () =>
    specs.filter(
      (s) => str(s, "tool") === "pdf-to-word" && prop(s, "label") === undefined,
    );

  it("the OCR spec sends a real scan with OCR on and reads the scan's words back as text", () => {
    const ocr = specs.filter((s) => str(s, "label") === "pdf-to-word (ocr)");
    expect(ocr).toHaveLength(1);
    const spec = ocr[0]!;
    expect(str(spec, "tool")).toBe("pdf-to-word");
    expect(prop(spec, "make")?.initializer.getText(file)).toMatch(
      /^scannedTextPdf$/,
    );
    expect(prop(spec, "options")?.initializer.getText(file)).toMatch(
      /\bocr:\s*true\b/,
    );
    expect(prop(spec, "verify")?.initializer.getText(file)).toMatch(
      /\bscannedDocxVerdict\(/,
    );
    for (const name of ["scannedDocxVerdict", "scannedTextPdf"])
      expect(importsOf(file).get(name)).toBe("@/tests/word-ocr-proof-fixtures");
    // Control: every pdf-to-word spec is either the pictures one or this.
    expect(specs.filter((s) => str(s, "tool") === "pdf-to-word").length).toBe(
      picturesSpecs().length + ocr.length,
    );
  });

  it("the pdf-to-word spec sends the Word proof PDF and verifies the picture", () => {
    const mine = picturesSpecs();
    expect(mine).toHaveLength(1);
    const spec = mine[0]!;
    expect(prop(spec, "make")?.initializer.getText(file)).toMatch(
      /\bdocxProofPdf\(\)/,
    );
    expect(prop(spec, "verify")?.initializer.getText(file)).toMatch(
      /\bdocxDeploymentVerdict\(/,
    );
    for (const name of ["docxDeploymentVerdict", "docxProofPdf"])
      expect(importsOf(file).get(name)).toBe(
        "@/lib/workers/pdf-office-export/deployment-proof",
      );
  });

  it("the .docx it returns is laid out by Word to PDF, and judged by the round-trip verdict", () => {
    const keptAs = picturesSpecs().map((s) => str(s, "keepArtifactAs"));
    expect(keptAs).toHaveLength(1);
    expect(keptAs[0]).toBeTruthy();
    const trips = specs.filter((s) => str(s, "from") === keptAs[0]);
    expect(trips).toHaveLength(1);
    expect(str(trips[0]!, "tool")).toBe("word-to-pdf");
    expect(prop(trips[0]!, "verify")?.initializer.getText(file)).toMatch(
      /\bdocxRoundTripVerdict\(/,
    );
    expect(importsOf(file).get("docxRoundTripVerdict")).toBe(
      "@/lib/workers/pdf-office-export/deployment-proof",
    );
  });
});
