// @vitest-environment node
/**
 * The in-image Translate page-map proof runs, from the workflow to the call —
 * walked through the chain it actually runs on, not searched for by words:
 *
 *   `container.yml` runs `docker run … pdfxyz-worker:ci pnpm
 *   worker:translate-page-map-proof` → `package.json` maps that script to a
 *   file → that file awaits the PDF-language memo, then calls
 *   `probeTranslatePageMap` TWICE with the image's real deps
 *   (`translateDeps(…).extract`, `.pdf`, and `resolveNativePdfTextReader`):
 *   once as shipped, once with arm A's model dropping the markers
 *   (`answerA: stripSeparatorsAnswer`), the control, whose `failed` list must
 *   be EXACTLY [control, pdf_a, wire_a]; then the heartbeat's entry point
 *   `provesTranslatePageMap`.
 *
 * An AST and not `toContain`, as in `worker-translate-reading-order-proof
 * .test.ts`: a guard that matches prose stays green while the step runs
 * something else.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SCRIPT = "worker:translate-page-map-proof";

function walk(node: TS.Node, visit: (n: TS.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

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

/** Each `probeTranslatePageMap({...})` call's property names, in source order. */
function probeCalls(file: TS.SourceFile): string[][] {
  const calls: string[][] = [];
  walk(file, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "probeTranslatePageMap"
    ) {
      const arg = n.arguments[0];
      if (!arg || !ts.isObjectLiteralExpression(arg)) {
        calls.push(["?"]);
        return;
      }
      calls.push(
        arg.properties.map((p) =>
          ts.isPropertyAssignment(p)
            ? `${p.name.getText(file)}=${p.initializer.getText(file)}`
            : p.getText(file),
        ),
      );
    }
  });
  return calls;
}

describe("the in-image Translate page-map proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(
      runLines.some((l) =>
        /pnpm worker:translate-reading-order-proof$/.test(l),
      ),
    ).toBe(true);
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step, `no container.yml step runs ${SCRIPT}`).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
  });

  it("package.json points it at a file that probes with the image's real deps, and a control that must fail exactly on headings", () => {
    const file = scriptFile();
    const imports = importsOf(file);
    expect(imports.get("probeTranslatePageMap")).toBe(
      "@/lib/workers/translate/page-map-capability",
    );
    expect(imports.get("provesTranslatePageMap")).toBe(
      "@/lib/workers/translate/page-map-capability",
    );
    expect(imports.get("stripSeparatorsAnswer")).toBe(
      "@/lib/workers/translate/page-map-capability",
    );
    expect(imports.get("translateDeps")).toBe("@/lib/workers/translate/native");
    expect(imports.get("translatePdfLanguages")).toBe(
      "@/lib/workers/translate/pdf-capability",
    );
    expect(imports.get("resolveNativePdfTextReader")).toBe(
      "@/lib/workers/pdf-text/native",
    );

    const calls = probeCalls(file);
    // Health: the walk found both calls, or every assertion below is vacuous.
    expect(calls.length).toBe(2);
    for (const call of calls) {
      expect(call).toContain("extract=deps.extract");
      expect(call).toContain("pdf=deps.pdf");
      expect(call.some((p) => p === "readPdfText")).toBe(true);
    }
    const controls = calls.filter((c) =>
      c.includes("answerA=stripSeparatorsAnswer"),
    );
    expect(controls.length).toBe(1);
    // The probe itself overrides neither model.
    expect(
      calls.filter((c) => c.some((p) => /^answer[AB]=/.test(p))).length,
    ).toBe(1);

    const text = file.getFullText();
    for (const needed of [
      /const CONTROL_FAILED = \["control", "pdf_a", "wire_a"\];/,
      /await translatePdfLanguages\(process\.env\)/,
      /if \(!probe\.ok\)/,
      /if \(control\.ok\)/,
      /probe\.failed\.includes\("pdf_unavailable"\)/,
      /await provesTranslatePageMap\(process\.env\)/,
      /return 2;/,
      /return 1;/,
    ])
      expect(text).toMatch(needed);
  });
});
