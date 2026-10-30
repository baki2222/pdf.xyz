// @vitest-environment node
/**
 * The in-image restricted-PDF proof runs — checked by walking the chain it
 * runs through: `container.yml` step → `package.json` script → a file that
 * saves through the REAL handler and asks the REAL qpdf. A broken link is
 * fatal. It is the only place the in-browser save meets qpdf before a user
 * does, so a proof that quietly stopped running would leave it unchecked.
 * An AST, not `toContain`: comments are not nodes.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SCRIPT = "worker:restricted-edit-proof";

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

describe("the in-image restricted-PDF proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(runLines.some((l) => /pnpm worker:options-proof$/.test(l))).toBe(
      true,
    );
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
  });

  it("package.json points it at a file that saves through the handler and execs qpdf", () => {
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
    const called = new Set<string>();
    const literals = new Set<string>();
    walk(file, (n) => {
      if (ts.isCallExpression(n)) {
        const e = n.expression;
        if (ts.isIdentifier(e)) called.add(e.text);
        else if (ts.isPropertyAccessExpression(e)) called.add(e.name.text);
      }
      if (ts.isStringLiteral(n)) literals.add(n.text);
    });
    // The real save, and the real binary — not a stand-in for either.
    for (const fn of ["openProtectedPdf", "saveChanges", "execFile"])
      expect(called, fn).toContain(fn);
    expect(literals).toContain("qpdf");
    for (const flag of ["--check", "--show-encryption", "--json"])
      expect(literals, flag).toContain(flag);
  });
});
