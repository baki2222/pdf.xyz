// @vitest-environment node
/**
 * The in-image EPUB to PDF proof runs, from the workflow to the call, and the
 * production proof asks the deployed worker the same question — walked
 * through the chain it actually runs on, not searched for by words:
 *
 *   `container.yml` runs `docker run … pdfxyz-worker:ci pnpm
 *   worker:epub-proof` → `package.json` maps that script to a file → that
 *   file calls `runEpubImageProof` with the Chromium runner EPUB to PDF uses
 *   (`nativeEpubRenderDeps(…).chromium`) and a render network that throws.
 *
 * An AST and not `toContain`, as in `worker-office-input-proof.test.ts`: a
 * guard that matches prose stays green while the step runs something else.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SCRIPT = "worker:epub-proof";

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

describe("the in-image EPUB to PDF proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(
      runLines.some((l) => /pnpm worker:office-input-proof$/.test(l)),
    ).toBe(true);
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step, `no container.yml step runs ${SCRIPT}`).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
  });

  it("package.json points it at a file that calls the proof on EPUB to PDF's own Chromium, with a network that throws", () => {
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
    expect(imports.get("runEpubImageProof")).toBe(
      "@/lib/workers/epub/image-proof",
    );
    expect(imports.get("nativeEpubRenderDeps")).toBe(
      "@/lib/workers/epub/native",
    );
    const calls: TS.CallExpression[] = [];
    let chromiumFrom: string | undefined;
    walk(file, (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "runEpubImageProof"
      )
        calls.push(n);
      if (
        ts.isVariableDeclaration(n) &&
        n.name.getText(file) === "chromium" &&
        n.initializer &&
        ts.isPropertyAccessExpression(n.initializer) &&
        n.initializer.name.text === "chromium" &&
        ts.isCallExpression(n.initializer.expression) &&
        ts.isIdentifier(n.initializer.expression.expression)
      )
        chromiumFrom = n.initializer.expression.expression.text;
    });
    expect(calls).toHaveLength(1);
    expect(chromiumFrom).toBe("nativeEpubRenderDeps");
    const text = file.getFullText();
    // The network seam throws and counts; no Chromium, no conclusion.
    for (const needed of [
      /network: \{ resolve: refuse, fetch: refuse \}/,
      /!chromium/,
      /return 2;/,
    ])
      expect(text).toMatch(needed);
  });
});

describe("the production proof converts the EPUB 3 book and expects the DRM refusal", () => {
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
  const epub = () => specs.filter((s) => str(s, "tool") === "epub-to-pdf");

  it("health check: SPECS was found and is the size it plausibly is", () => {
    expect(specs.length).toBeGreaterThan(15);
    expect(specs.length).toBeLessThan(200);
  });

  it("the happy path builds the EPUB 3 fixture and judges it with epub3Verdict", () => {
    const mine = epub().filter((s) => prop(s, "verify"));
    expect(mine).toHaveLength(1);
    expect(prop(mine[0]!, "make")?.initializer.getText(file)).toMatch(
      /epub3Book\(\)/,
    );
    expect(prop(mine[0]!, "verify")?.initializer.getText(file)).toMatch(
      /epub3Verdict\(await readEpubPdf\(/,
    );
    expect(str(mine[0]!, "type")).toBe("application/epub+zip");
  });

  it("the refusal builds the DRM fixture and expects the DRM sentence, final", () => {
    const mine = epub().filter((s) => prop(s, "expectFailure"));
    expect(mine).toHaveLength(1);
    expect(prop(mine[0]!, "make")?.initializer.getText(file)).toMatch(
      /drmBook\(\)/,
    );
    const failure = prop(mine[0]!, "expectFailure")!.initializer.getText(file);
    expect(failure).toMatch(/code: "unprocessable_entity"/);
    expect(failure).toMatch(/retryable: false/);
    expect(failure).toMatch(/protected by DRM/);
  });
});
