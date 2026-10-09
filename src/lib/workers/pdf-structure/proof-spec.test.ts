// @vitest-environment node
/**
 * The deployment proof for Optimize for Web must read the one property the
 * tool sells.
 *
 * Until 2026-09-27 `scripts/worker-prove-tools.ts` proved optimize-web with
 * `expect: isPdf` — `%PDF-` at byte 0 — and printed "linearized PDF" beside
 * it. A worker that rewrote the file without `--linearize` would have been
 * recorded as proven. The verdict (`linearizationVerdict`) is tested beside
 * its helper, including on the proof's own unlinearized input; this pins that
 * the proof CALLS it. The script runs on import, so it is read as source,
 * through the TypeScript parser — the spec object itself, not a string that
 * could sit in a comment.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const SCRIPT = fileURLToPath(
  new URL("../../../../scripts/worker-prove-tools.ts", import.meta.url),
);
const HELPER = "@/lib/pdf/linearization";
const VERDICT = "linearizationVerdict";
const TOOL = "optimize-web";

/** Identifiers a node calls, anywhere inside it. */
function calls(node: TS.Node): Set<string> {
  const out = new Set<string>();
  const walk = (n: TS.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression))
      out.add(n.expression.text);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return out;
}

/**
 * What is wrong with the optimize-web proof specs in `source`: every spec
 * object literal whose `tool` is "optimize-web" must judge its artifact with
 * `linearizationVerdict`, imported from the helper the worker and the panel use.
 */
function proofSpecProblems(source: string): string[] {
  const file = ts.createSourceFile(
    "worker-prove-tools.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const imported = new Set<string>();
  const specs: TS.ObjectLiteralExpression[] = [];
  const walk = (n: TS.Node) => {
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      n.moduleSpecifier.text === HELPER
    ) {
      const bindings = n.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const el of bindings.elements) imported.add(el.name.text);
    }
    if (
      ts.isObjectLiteralExpression(n) &&
      n.properties.some(
        (p) =>
          ts.isPropertyAssignment(p) &&
          p.name.getText(file) === "tool" &&
          ts.isStringLiteral(p.initializer) &&
          p.initializer.text === TOOL,
      )
    )
      specs.push(n);
    ts.forEachChild(n, walk);
  };
  walk(file);

  if (specs.length === 0) return [`no ${TOOL} spec`];
  const problems: string[] = [];
  specs.forEach((spec, i) => {
    const verify = spec.properties.find(
      (p) => p.name?.getText(file) === "verify",
    );
    if (!verify) problems.push(`spec ${i + 1}: no \`verify\``);
    else if (!calls(verify).has(VERDICT))
      problems.push(`spec ${i + 1}: \`verify\` does not call ${VERDICT}`);
  });
  if (!imported.has(VERDICT))
    problems.push(`${VERDICT} not imported from ${HELPER}`);
  return problems;
}

describe("worker-prove-tools: the optimize-web proof reads the linearization", () => {
  const source = readFileSync(SCRIPT, "utf8");

  it("judges every optimize-web artifact with linearizationVerdict", () => {
    expect(proofSpecProblems(source)).toEqual([]);
  });

  it("POSITIVE CONTROL: the spec as it shipped — a %PDF- check — fails", () => {
    const shipped = `
      const SPECS = [
        {
          tool: "optimize-web",
          make: textPdf,
          name: "web.pdf",
          type: PDF_MIME,
          expect: isPdf,
          want: "linearized PDF",
        },
      ];`;
    expect(proofSpecProblems(shipped)).toEqual([
      "spec 1: no `verify`",
      `${VERDICT} not imported from ${HELPER}`,
    ]);
    // A verdict named only in a comment is not a call.
    const commented = source.replace(
      /verify: async \(bytes\) => linearizationVerdict\(bytes\),/,
      "// verify: async (bytes) => linearizationVerdict(bytes),",
    );
    expect(commented).not.toBe(source);
    expect(proofSpecProblems(commented)).toEqual(["spec 1: no `verify`"]);
    expect(proofSpecProblems("const SPECS = [];")).toEqual([`no ${TOOL} spec`]);
  });
});
