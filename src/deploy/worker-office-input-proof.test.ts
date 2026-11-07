// @vitest-environment node
/**
 * The in-image OpenDocument / RTF proof runs, from the workflow to the call,
 * and the production proof asks the deployed worker the same question —
 * walked through the chain it actually runs on, not searched for by words:
 *
 *   `container.yml` runs `docker run … pdfxyz-worker:ci pnpm
 *   worker:office-input-proof` → `package.json` maps that script to a file
 *   → that file calls `runOfficeInputProof` with the LibreOffice runner the
 *   three Office tools use (`nativeOfficeConversionDeps(…).libreoffice`), the
 *   image's pdftotext (`pdfOfficeExportDeps(…).extract`) and every fixture.
 *
 * An AST and not `toContain`, as in `worker-docx-pictures-proof.test.ts`: a
 * guard that matches prose stays green while the step runs something else.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import { OFFICE_INPUT_FIXTURES } from "@/tests/office-input-fixtures";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SCRIPT = "worker:office-input-proof";

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

describe("the in-image OpenDocument / RTF proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(
      runLines.some((l) => /pnpm worker:docx-pictures-proof$/.test(l)),
    ).toBe(true);
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step, `no container.yml step runs ${SCRIPT}`).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
  });

  it("package.json points it at a file that calls the proof on LibreOffice and pdftotext", () => {
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
    expect(imports.get("runOfficeInputProof")).toBe(
      "@/lib/workers/office-conversion/input-proof",
    );
    expect(imports.get("nativeOfficeConversionDeps")).toBe(
      "@/lib/workers/office-conversion/native",
    );
    expect(imports.get("pdfOfficeExportDeps")).toBe(
      "@/lib/workers/pdf-office-export/native",
    );
    expect(imports.get("OFFICE_INPUT_FIXTURES")).toBe(
      "@/tests/office-input-fixtures",
    );
    expect(imports.get("CSV_CHARSET_CASES")).toBe(
      "@/tests/csv-charset-fixtures",
    );

    const calls: TS.CallExpression[] = [];
    walk(file, (n) => {
      if (ts.isCallExpression(n) && calleeName(n) === "runOfficeInputProof")
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
      "libreoffice",
      "extract",
      "fixtures",
      "spreadsheetBytes",
      "csv",
    ])
      expect(props.has(key), `runOfficeInputProof is not given ${key}`).toBe(
        true,
      );
    const lo = initializerOf(file, "libreoffice");
    expect(
      lo &&
        ts.isPropertyAccessExpression(lo) &&
        lo.name.text === "libreoffice" &&
        calleeName(lo.expression),
    ).toBe("nativeOfficeConversionDeps");
    const ex = initializerOf(file, "extract");
    expect(
      ex &&
        ts.isPropertyAccessExpression(ex) &&
        ex.name.text === "extract" &&
        calleeName(ex.expression),
    ).toBe("pdfOfficeExportDeps");
    expect(props.get("fixtures")!.getText(file)).toBe(
      "fixtures: OFFICE_INPUT_FIXTURES",
    );
    expect(props.get("csv")!.getText(file)).toBe("csv: CSV_CHARSET_CASES");
    // No LibreOffice or pdftotext, no conclusion: exit 2, never a pass.
    for (const needed of [/!libreoffice/, /!extract/, /return 2;/])
      expect(file.getFullText()).toMatch(needed);
  });
});

describe("the production proof converts every OpenDocument / RTF fixture and the renamed-file control", () => {
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
    expect(OFFICE_INPUT_FIXTURES.length).toBeGreaterThanOrEqual(4);
  });

  it.each(OFFICE_INPUT_FIXTURES.map((f) => [f.kind, f] as const))(
    "%s: one spec, on its tool and name, judged by its own proof word",
    (kind, fixture) => {
      const label = `${fixture.tool} (${kind})`;
      const mine = specs.filter((s) => str(s, "label") === label);
      expect(mine, `no spec labelled "${label}"`).toHaveLength(1);
      const spec = mine[0]!;
      expect(str(spec, "tool")).toBe(fixture.tool);
      expect(str(spec, "name")).toBe(fixture.name);
      expect(str(spec, "type")).toBe(fixture.type);
      expect(prop(spec, "make")?.initializer.getText(file)).toBe(
        `() => officeInput("${kind}").build()`,
      );
      expect(prop(spec, "verify")?.initializer.getText(file)).toBe(
        `(bytes) => officeInputVerdict(bytes, "${kind}")`,
      );
    },
  );

  it("the renamed-file control expects the content refusal, final", () => {
    const mine = specs.filter(
      (s) => str(s, "label") === "word-to-pdf (ods named odt)",
    );
    expect(mine).toHaveLength(1);
    const failure = prop(mine[0]!, "expectFailure")?.initializer.getText(file);
    expect(failure).toMatch(/code: "unprocessable_entity"/);
    expect(failure).toMatch(/retryable: false/);
    expect(failure).toMatch(/not an OpenDocument text document/);
    expect(str(mine[0]!, "name")).toBe("essay.odt");
    expect(prop(mine[0]!, "make")?.initializer.getText(file)).toMatch(
      /^\(\) => odsWith\(/,
    );
  });
});
