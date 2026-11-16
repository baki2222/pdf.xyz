// @vitest-environment node
/**
 * The in-image Translate reading-order proof runs, from the workflow to the
 * call — walked through the chain it actually runs on, not searched for by
 * words:
 *
 *   `container.yml` runs `docker run … pdfxyz-worker:ci pnpm
 *   worker:translate-reading-order-proof` → `package.json` maps that script
 *   to a file → that file calls `probeTranslateReadingOrder` TWICE: once on
 *   Translate's own extractor (`translateDeps(…).extract`) and once on the
 *   shared resolver (`resolveNativePdfTextExtractor`), the control, whose
 *   `failed` list it requires to include "order_sent" and "order_delivered".
 *
 * An AST and not `toContain`, as in `worker-epub-proof.test.ts`: a guard that
 * matches prose stays green while the step runs something else.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SCRIPT = "worker:translate-reading-order-proof";

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

describe("the in-image Translate reading-order proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(
      runLines.some((l) => /pnpm worker:translate-pdf-proof$/.test(l)),
    ).toBe(true);
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step, `no container.yml step runs ${SCRIPT}`).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
  });

  it("package.json points it at a file that probes Translate's composite AND the shared-resolver control, requiring the control to fail on order", () => {
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
    expect(imports.get("probeTranslateReadingOrder")).toBe(
      "@/lib/workers/translate/reading-order-capability",
    );
    expect(imports.get("translateDeps")).toBe("@/lib/workers/translate/native");
    expect(imports.get("resolveNativePdfTextExtractor")).toBe(
      "@/lib/workers/pdf-text/native",
    );

    // Each probe call's `extract`: one is `translateDeps(...).extract`, the
    // other an identifier bound to `resolveNativePdfTextExtractor(...)`.
    const extracts: string[] = [];
    const bound = new Map<string, string>();
    walk(file, (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        ts.isCallExpression(n.initializer) &&
        ts.isIdentifier(n.initializer.expression)
      )
        bound.set(n.name.text, n.initializer.expression.text);
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "probeTranslateReadingOrder"
      ) {
        const arg = n.arguments[0];
        if (!arg || !ts.isObjectLiteralExpression(arg)) return;
        for (const p of arg.properties)
          if (
            ts.isPropertyAssignment(p) &&
            p.name.getText(file) === "extract"
          ) {
            const init = p.initializer;
            if (
              ts.isPropertyAccessExpression(init) &&
              init.name.text === "extract" &&
              ts.isCallExpression(init.expression) &&
              ts.isIdentifier(init.expression.expression)
            )
              extracts.push(`${init.expression.expression.text}().extract`);
            else if (ts.isIdentifier(init))
              extracts.push(`${bound.get(init.text) ?? "?"}()`);
            else extracts.push("?");
          }
      }
    });
    expect(extracts.sort()).toEqual([
      "resolveNativePdfTextExtractor()",
      "translateDeps().extract",
    ]);

    const text = file.getFullText();
    for (const needed of [
      /control\.failed\.includes\("order_sent"\)/,
      /control\.failed\.includes\("order_delivered"\)/,
      /if \(control\.ok\)/,
      /if \(!probe\.ok\)/,
      /return 2;/,
      /return 1;/,
    ])
      expect(text).toMatch(needed);
  });
});
