// @vitest-environment node
/**
 * The in-image Chat with PDF page-selection proof runs, from the workflow to
 * the call — walked through the chain it actually runs on, not searched for
 * by words (competitor audit wave 2 #30, slice 3):
 *
 *   `container.yml` runs `docker run … pdfxyz-worker:ci pnpm
 *   worker:chat-retrieval-proof` → `package.json` maps that script to a file
 *   → that file calls `runChatRetrievalProof` from the module the daemon's
 *   `PROVED_CAPABILITIES.chatRetrieval` proves with, on the process's own env
 *   (so the image's REAL pdftotext, not an injected one), and exits non-zero
 *   unless the result is ok.
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
const SCRIPT = "worker:chat-retrieval-proof";
const PROOF_MODULE = "@/lib/workers/chat-with-pdf/retrieval-capability";

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

describe("the in-image chat page-selection proof runs, from the workflow to the call", () => {
  it("health check: the workflow parse found the steps it already has", () => {
    expect(runLines.length).toBeGreaterThan(5);
    expect(runLines.some((l) => /pnpm worker:epub-proof$/.test(l))).toBe(true);
  });

  it("container.yml runs it inside the built WORKER image", () => {
    const step = runLines.find((l) => l.endsWith(`pnpm ${SCRIPT}`));
    expect(step, `no container.yml step runs ${SCRIPT}`).toBeDefined();
    expect(step).toMatch(/^docker run --rm pdfxyz-worker:ci pnpm /);
  });

  it("package.json points it at a file that runs the daemon's own proof on the process env and fails the step on a FAIL", () => {
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
    expect(importsOf(file).get("runChatRetrievalProof")).toBe(PROOF_MODULE);

    const calls: TS.CallExpression[] = [];
    walk(file, (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "runChatRetrievalProof"
      )
        calls.push(n);
    });
    expect(calls).toHaveLength(1);
    // ONE argument, `process.env`: no injected extractor, selector or gate,
    // so the step proves the image's own pdftotext and ICU.
    expect(calls[0]!.arguments.map((a) => a.getText(file))).toEqual([
      "process.env",
    ]);
    const text = file.getFullText();
    for (const needed of [
      /return result\.ok \? 0 : 1;/,
      /process\.exit\(code\)/,
      /process\.exit\(1\)/,
    ])
      expect(text).toMatch(needed);
  });

  it("the module the script runs is the module the daemon proves chatRetrieval with", () => {
    // The same proof the heartbeat publishes, not a sibling written for CI.
    const daemon = ts.createSourceFile(
      "proved-capabilities.ts",
      read("src/lib/workers/daemon/proved-capabilities.ts"),
      ts.ScriptTarget.Latest,
      true,
    );
    expect(importsOf(daemon).get("provesChatRetrieval")).toBe(PROOF_MODULE);
    const proof = read("src/lib/workers/chat-with-pdf/retrieval-capability.ts");
    // provesChatRetrieval's verdict IS runChatRetrievalProof's.
    expect(proof).toMatch(
      /export async function provesChatRetrieval\([\s\S]*?const result = await runChatRetrievalProof\([\s\S]*?return result\.ok;/,
    );
  });
});
