// @vitest-environment node
/**
 * The in-image options proof (Grayscale through Ghostscript, permissions
 * through qpdf) runs — checked by walking the chain it runs through:
 * `container.yml` step → `package.json` script → a file that calls
 * `runWorkerOptionsProof` with the REAL native deps. A broken link is fatal.
 * It is the only place either option meets its binary before production, so
 * a proof that quietly stopped running would leave both untested everywhere.
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
const SCRIPT = "worker:options-proof";

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

describe("the in-image options proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(runLines.some((l) => /pnpm worker:pdfa-proof$/.test(l))).toBe(true);
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
  });

  it("package.json points it at a file that calls the proof on the REAL native deps", () => {
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
    const calls: TS.CallExpression[] = [];
    walk(file, (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "runWorkerOptionsProof"
      )
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
    const callee = (key: string) => {
      const p = props.get(key);
      const init = p && ts.isPropertyAssignment(p) ? p.initializer : undefined;
      return init &&
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression)
        ? init.expression.text
        : undefined;
    };
    // The real engines from the image's environment, not stubs that would
    // make the proof pass without either binary.
    expect(callee("compression")).toBe("nativeCompressionDeps");
    expect(callee("pdfSecurity")).toBe("nativePdfSecurityDeps");
    // The image's Chromium, for the page layout checks (2026-10-25).
    expect(callee("htmlRender")).toBe("nativeHtmlRenderDeps");
    expect(props.has("qpdfShowP")).toBe(true);
  });
});
