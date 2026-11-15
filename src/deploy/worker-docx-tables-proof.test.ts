// @vitest-environment node
/**
 * #28 slice 2 (tables): the in-image PDF to Word tables proof runs, walked
 * through the chain it runs on, not searched for by words:
 *
 *   `container.yml` runs `docker run … pdfxyz-worker:ci pnpm
 *   worker:docx-tables-proof` → `package.json` maps that script to a file
 *   → that file calls `provesDocxTables` on the worker's OWN deps
 *   (`pdfOfficeExportDeps(process.env)`) and exits non-zero when it is false.
 *
 * Why it matters: the unit suites stand poppler in, and the stand-in joins
 * every same-baseline word into one line — real poppler does not. This step
 * is the one place in CI where the image's poppler groups a table's words
 * before the Word table writer reads them. An AST, as in
 * `worker-docx-pictures-proof.test.ts`: comments are not nodes.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SCRIPT = "worker:docx-tables-proof";

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

describe("the in-image PDF to Word tables proof runs, from the workflow to the call", () => {
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

  it("package.json points it at a file that calls provesDocxTables on the worker's own deps, and fails when it is false", () => {
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
    const imports = new Map<string, string>();
    for (const stmt of file.statements)
      if (
        ts.isImportDeclaration(stmt) &&
        !stmt.importClause?.isTypeOnly &&
        stmt.importClause?.namedBindings &&
        ts.isNamedImports(stmt.importClause.namedBindings)
      )
        for (const el of stmt.importClause.namedBindings.elements)
          if (!el.isTypeOnly)
            imports.set(
              el.name.text,
              (stmt.moduleSpecifier as TS.StringLiteral).text,
            );
    expect(imports.get("provesDocxTables")).toBe(
      "@/lib/workers/pdf-office-export/capability",
    );
    expect(imports.get("pdfOfficeExportDeps")).toBe(
      "@/lib/workers/pdf-office-export/native",
    );
    // provesDocxTables(deps), where deps = pdfOfficeExportDeps(process.env),
    // and its verdict folded into the exit code.
    let depsInit = "";
    const proofArgs: string[] = [];
    walk(file, (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        n.name.getText(file) === "deps" &&
        n.initializer
      )
        depsInit = n.initializer.getText(file);
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "provesDocxTables"
      )
        proofArgs.push(n.arguments.map((a) => a.getText(file)).join(","));
    });
    expect(depsInit).toBe("pdfOfficeExportDeps(process.env)");
    expect(proofArgs).toEqual(["deps"]);
    expect(file.getFullText()).toMatch(/ok &&= proven;/);
    expect(file.getFullText()).toMatch(/return ok \? 0 : 1;/);
  });

  /**
   * #28 slice 4 (2026-11-15): the same step proves the typefaces — the
   * heartbeat's `docxTypefaces` on the image's own deps, and the inline-code
   * line through real poppler — rather than a new step. Same chain, same
   * shape as `provesDocxTables` above: imported from the capability module,
   * called on `deps`, its verdict folded into the exit code.
   */
  it("the same file calls provesDocxTypefaces on the worker's own deps, and fails when it is false", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    const target = /^tsx (\S+\.ts)$/.exec(pkg.scripts[SCRIPT] ?? "")![1]!;
    const file = ts.createSourceFile(
      target,
      read(target),
      ts.ScriptTarget.Latest,
      true,
    );
    let imported = "";
    for (const stmt of file.statements)
      if (
        ts.isImportDeclaration(stmt) &&
        !stmt.importClause?.isTypeOnly &&
        stmt.importClause?.namedBindings &&
        ts.isNamedImports(stmt.importClause.namedBindings) &&
        stmt.importClause.namedBindings.elements.some(
          (el) => !el.isTypeOnly && el.name.text === "provesDocxTypefaces",
        )
      )
        imported = (stmt.moduleSpecifier as TS.StringLiteral).text;
    expect(imported).toBe("@/lib/workers/pdf-office-export/capability");
    // const <verdict> = await provesDocxTypefaces(deps); … ok &&= <verdict>;
    const verdicts: string[] = [];
    const args: string[] = [];
    walk(file, (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "provesDocxTypefaces"
      ) {
        args.push(n.arguments.map((a) => a.getText(file)).join(","));
        let up: TS.Node = n.parent;
        while (up && !ts.isVariableDeclaration(up)) up = up.parent;
        if (up && ts.isVariableDeclaration(up))
          verdicts.push(up.name.getText(file));
      }
    });
    expect(args).toEqual(["deps"]);
    expect(verdicts).toHaveLength(1);
    const folded: string[] = [];
    walk(file, (n) => {
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken &&
        n.left.getText(file) === "ok"
      )
        folded.push(n.right.getText(file));
    });
    expect(folded).toContain(verdicts[0]);
  });
});
