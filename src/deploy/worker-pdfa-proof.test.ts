// @vitest-environment node
/**
 * The two PDF/A proofs are wired to the question the engine asks — checked by
 * walking the chain each one actually runs through, not by searching for words.
 *
 *   1. The in-image proof. `container.yml` runs a `docker run … pdfxyz-worker`
 *      step → `package.json` maps that `pnpm` script to a file → that file calls
 *      `runPdfAImageProof(nativePdfArchiveDeps(…), { encrypt })`. Any broken
 *      link (step renamed, script repointed, call removed) is fatal here. This
 *      is the only place the PDF/A argv meets a real Ghostscript before
 *      production, so a proof that silently stopped running would leave the
 *      recipe untested everywhere.
 *
 *   2. The production proof. Every `scripts/worker-prove-tools.ts` spec for a
 *      PDF/A tool must `verify` with `proveDeclaredPdfA`. Before, its only check
 *      was `expect: isPdf`, which a file with a false PDF/A claim passes. The
 *      tools are DERIVED from the engine's `PDF_ARCHIVE_TOOLS`, so a second
 *      PDF/A tool arrives already covered.
 *
 * Why an AST and not `toContain`: a guard that matches prose stays green while
 * the step runs something else (see the coolify-migration lesson). Comments are
 * not nodes.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import { PDF_ARCHIVE_TOOLS } from "@/lib/workers/pdf-archive/engine";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function parse(rel: string): TS.SourceFile {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true);
}

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

const calleeName = (call: TS.CallExpression) =>
  ts.isIdentifier(call.expression) ? call.expression.text : undefined;

describe("the in-image PDF/A proof runs, from the workflow to the call", () => {
  const SCRIPT = "worker:pdfa-proof";

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

  it("health check: the workflow parse found the steps it already has", () => {
    // If this collapses, every assertion below fails for the wrong reason.
    expect(runLines.length).toBeGreaterThan(5);
    expect(runLines.some((l) => /pnpm worker:ocrmypdf-proof$/.test(l))).toBe(
      true,
    );
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
    // …and the tag it runs is the one the worker build step produced.
    expect(read(".github/workflows/container.yml")).toMatch(
      /target:\s*worker\s*\n\s*tags:\s*pdfxyz-worker:ci/,
    );
  });

  it("package.json points it at a file that calls the proof on the REAL native deps", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    const command = pkg.scripts[SCRIPT];
    const target = /^tsx (\S+\.ts)$/.exec(command ?? "")?.[1];
    expect(target, `${SCRIPT} must run a .ts file with tsx`).toBeDefined();
    expect(existsSync(path.join(ROOT, target!))).toBe(true);

    const file = parse(target!);
    const imports = importsOf(file);
    expect(imports.get("runPdfAImageProof")).toBe(
      "@/lib/workers/pdf-archive/image-proof",
    );
    expect(imports.get("nativePdfArchiveDeps")).toBe(
      "@/lib/workers/pdf-archive/native",
    );

    const calls: TS.CallExpression[] = [];
    walk(file, (n) => {
      if (ts.isCallExpression(n) && calleeName(n) === "runPdfAImageProof")
        calls.push(n);
    });
    expect(calls).toHaveLength(1);
    const [depsArg, seamsArg] = calls[0]!.arguments;
    // The deps are the native ones, built from the image's environment — not a
    // stub that would make the proof pass without Ghostscript.
    expect(depsArg && ts.isCallExpression(depsArg) && calleeName(depsArg)).toBe(
      "nativePdfArchiveDeps",
    );
    // qpdf is wired, so the password checks run rather than fail as unwired.
    const seamKeys =
      seamsArg && ts.isObjectLiteralExpression(seamsArg)
        ? seamsArg.properties.map((p) => p.name?.getText(file))
        : [];
    expect(seamKeys).toContain("encrypt");
  });
});

describe("the production proof asks every PDF/A artifact the engine's question", () => {
  const FILE = "scripts/worker-prove-tools.ts";
  const file = parse(FILE);

  /** Every object literal in the SPECS array, with its `tool` string. */
  const specs: { tool: string; node: TS.ObjectLiteralExpression }[] = [];
  walk(file, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText(file) === "SPECS" &&
      n.initializer &&
      ts.isArrayLiteralExpression(n.initializer)
    ) {
      for (const el of n.initializer.elements) {
        if (!ts.isObjectLiteralExpression(el)) continue;
        const tool = el.properties.find(
          (p): p is TS.PropertyAssignment =>
            ts.isPropertyAssignment(p) && p.name.getText(file) === "tool",
        );
        if (tool && ts.isStringLiteral(tool.initializer))
          specs.push({ tool: tool.initializer.text, node: el });
      }
    }
  });

  const verifyOf = (node: TS.ObjectLiteralExpression) =>
    node.properties.find(
      (p): p is TS.PropertyAssignment =>
        ts.isPropertyAssignment(p) && p.name.getText(file) === "verify",
    );

  it("health check: SPECS was found and is the size it plausibly is", () => {
    expect(specs.length).toBeGreaterThan(15);
    expect(specs.length).toBeLessThan(200);
  });

  it("controls: the predicate can see a verify, and can see its absence", () => {
    // Positive: some spec already has one (the AI proofs verify their ZIPs).
    expect(specs.some((s) => verifyOf(s.node) !== undefined)).toBe(true);
    // Negative: a spec with only `expect` is reported as having none.
    expect(specs.some((s) => verifyOf(s.node) === undefined)).toBe(true);
  });

  it.each(PDF_ARCHIVE_TOOLS.map((t) => [t]))(
    "every %s proof verifies with proveDeclaredPdfA",
    (tool) => {
      const mine = specs.filter((s) => s.tool === tool);
      expect(mine.length, `${tool} has no proof spec`).toBeGreaterThan(0);
      for (const spec of mine) {
        const verify = verifyOf(spec.node);
        expect(verify?.initializer.getText(file)).toBe("proveDeclaredPdfA");
      }
      expect(importsOf(file).get("proveDeclaredPdfA")).toBe(
        "@/lib/workers/pdf-archive/pdfa-markers",
      );
    },
  );
});
