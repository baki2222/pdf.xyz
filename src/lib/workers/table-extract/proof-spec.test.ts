// @vitest-environment node
/**
 * The deployment proof for Extract Tables must read the CELLS it gets back.
 *
 * Until 2026-09-27 `scripts/worker-prove-tools.ts` proved extract-tables with
 * `expect: isZipContainer` alone — a `PK` at byte 0 — while the engine
 * returned the proof fixture's title as a data row and an empty column in
 * every row; the ledger recorded the tool as proven. The verdict that reads
 * the cells (`tablesProofVerdict`) is tested beside the engine, and on real
 * poppler; this pins that the proof CALLS it, on the fixture whose answer it
 * holds. The script runs on import, so it is read as source, through the
 * TypeScript parser — the spec object itself, not a string that could sit in
 * a comment.
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
const FIXTURES = "@/tests/table-extract-fixtures";

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
 * What is wrong with the extract-tables proof spec in `source`: every spec
 * object literal whose `tool` is "extract-tables" must build its input with
 * `reportTablesPdf` and judge its output with `tablesProofVerdict`, both
 * imported from the fixtures module that holds the report's answer.
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
      n.moduleSpecifier.text === FIXTURES
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
          p.initializer.text === "extract-tables",
      )
    )
      specs.push(n);
    ts.forEachChild(n, walk);
  };
  walk(file);

  if (specs.length === 0) return ["no extract-tables spec"];
  const problems: string[] = [];
  const property = (spec: TS.ObjectLiteralExpression, name: string) =>
    spec.properties.find((p) => p.name?.getText(file) === name);
  specs.forEach((spec, i) => {
    for (const [name, fn] of [
      ["make", "reportTablesPdf"],
      ["verify", "tablesProofVerdict"],
    ] as const) {
      const prop = property(spec, name);
      if (!prop) problems.push(`spec ${i + 1}: no \`${name}\``);
      else if (!calls(prop).has(fn))
        problems.push(`spec ${i + 1}: \`${name}\` does not call ${fn}`);
      if (!imported.has(fn))
        problems.push(`${fn} not imported from ${FIXTURES}`);
    }
  });
  return [...new Set(problems)];
}

describe("worker-prove-tools: the extract-tables proof reads the cells", () => {
  const source = readFileSync(SCRIPT, "utf8");

  it("builds the report fixture and judges the ZIP with its answer", () => {
    expect(proofSpecProblems(source)).toEqual([]);
  });

  it("POSITIVE CONTROL: the spec as it shipped — a PK check on tablePdf — fails", () => {
    const shipped = `
      import JSZip from "jszip";
      const SPECS = [
        {
          tool: "extract-tables",
          make: tablePdf,
          name: "table.pdf",
          type: PDF_MIME,
          expect: isZipContainer,
          want: "ZIP of CSV+XLSX",
        },
      ];`;
    expect(proofSpecProblems(shipped)).toEqual([
      "spec 1: `make` does not call reportTablesPdf",
      `reportTablesPdf not imported from ${FIXTURES}`,
      "spec 1: no `verify`",
      `tablesProofVerdict not imported from ${FIXTURES}`,
    ]);
    // A verdict named only in a comment is not a call.
    const commented = source.replace(
      /verify: \(bytes\) => tablesProofVerdict\(bytes\),/,
      "// verify: (bytes) => tablesProofVerdict(bytes),",
    );
    expect(commented).not.toBe(source);
    expect(proofSpecProblems(commented)).toEqual(["spec 1: no `verify`"]);
    expect(proofSpecProblems("const SPECS = [];")).toEqual([
      "no extract-tables spec",
    ]);
  });
});
