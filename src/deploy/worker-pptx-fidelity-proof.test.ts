// @vitest-environment node
/**
 * The in-image PDF to PowerPoint round-trip proof runs, from the workflow to
 * the call — walked through the chain it actually runs on, not searched for
 * by words:
 *
 *   `container.yml` runs `docker run … pdfxyz-worker:ci pnpm
 *   worker:pptx-fidelity-proof` → `package.json` maps that script to a file →
 *   that file calls `runPptxFidelityProof` with the worker's OWN deps
 *   (`pdfOfficeExportDeps`) and the LibreOffice runner PowerPoint to PDF uses
 *   (`nativeOfficeConversionDeps(…).libreoffice`), over every committed
 *   fixture, with both controls.
 *
 * Why it matters: `fidelity.roundtrip.test.ts` skips wherever LibreOffice is
 * absent — CI's unit job — and no vitest suite runs in the image. This step
 * is the ONE place in CI where the faithful export meets pdftotext, pdf.js
 * and LibreOffice together; a proof that silently stopped running would leave
 * the round trip untested everywhere, behind a green suite.
 *
 * Why an AST and not `toContain`: a guard that matches prose stays green while
 * the step runs something else. Comments are not nodes.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SCRIPT = "worker:pptx-fidelity-proof";

function walk(node: TS.Node, visit: (n: TS.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** Named imports of a file: local name → module specifier. */
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

/** `const name = <initializer>` anywhere in the file. */
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

describe("the in-image PDF to PowerPoint round-trip proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(runLines.some((l) => /pnpm worker:pdfa-proof$/.test(l))).toBe(true);
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
    expect(imports.get("runPptxFidelityProof")).toBe(
      "@/lib/workers/pdf-office-export/fidelity-proof",
    );
    expect(imports.get("pdfOfficeExportDeps")).toBe(
      "@/lib/workers/pdf-office-export/native",
    );
    expect(imports.get("nativeOfficeConversionDeps")).toBe(
      "@/lib/workers/office-conversion/native",
    );
    expect(imports.get("PPTX_FIDELITY_FIXTURES")).toBe(
      "@/tests/pptx-fidelity-fixtures",
    );
    expect(imports.get("pptxTextOnly20261010")).toBe(
      "@/tests/pptx-text-only-2026-10-10",
    );

    const calls: TS.CallExpression[] = [];
    walk(file, (n) => {
      if (ts.isCallExpression(n) && calleeName(n) === "runPptxFidelityProof")
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
    // Every part the proof needs is passed: the deps, the renderer, the
    // fixtures, and BOTH controls.
    for (const key of [
      "exportDeps",
      "toPdf",
      "fixtures",
      "textOnlyDeck",
      "blankDeck",
    ])
      expect(props.has(key), `runPptxFidelityProof is not given ${key}`).toBe(
        true,
      );
    // The deps are the worker's, built from the image's environment — not a
    // stub that would pass without pdftotext or pdf.js.
    expect(calleeName(initializerOf(file, "exportDeps"))).toBe(
      "pdfOfficeExportDeps",
    );
    // The renderer is LibreOffice's runner, from the office-conversion deps.
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
    // Every fixture, not a hand-picked few: derived from the fixtures list.
    expect(file.getFullText()).toMatch(/PPTX_FIDELITY_FIXTURES\.map\(/);
  });
});
