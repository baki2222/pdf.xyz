// @vitest-environment node
/**
 * What AI Data Extraction's page and panel SAY about saved schemas, held to
 * the code that makes it true (competitor audit #16, 2026-11-17).
 *
 *  1. "kept in this browser … never uploaded": every module the saved-schemas
 *     chunk loads — DERIVED, the value-import closure of the chunk, not a
 *     list — makes no request. Health: the closure holds the modules it must
 *     and is a plausible size; positive control: the predicate catches each
 *     request API in a fixture, through the same comment stripper.
 *  2. The one place it keeps anything is localStorage under the registered
 *     key, and `/privacy`'s registry says so (`browser-storage.test.ts`
 *     holds every key both ways; this pins the entry's area and words).
 *  3. The page's step names every control the chunk draws, and every figure
 *     in it is the constant that enforces it. The control set is derived
 *     from the chunk's own `<button>` text, so a new button the copy does
 *     not mention fails, and so does a step naming a button that is gone.
 *  4. "Pressing Extract data sends only the fields on screen" is held at the
 *     wire by `components/tools/ai-extract-schemas.test.tsx` (found here by
 *     its assertion string, so moving it cannot orphan the claim).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { BROWSER_STORAGE } from "@/lib/browser-storage";
import { SAVED_SCHEMAS_KEY } from "@/lib/jobs/ai-extract-schema-key";
import { MAX_SAVED_SCHEMAS } from "@/lib/jobs/ai-extract-schemas";
import { getToolContent } from "@/lib/tools/content";
import { withoutComments } from "@/lib/tools/copy-surface";
import { ROOT, SRC, rel, valueClosure } from "@/tests/tool-panel-modules";

const CHUNK = path.join(SRC, "components", "tools", "ai-extract-schemas.tsx");
const PANEL = path.join(
  SRC,
  "components",
  "tools",
  "ai-extract-worker-panel.tsx",
);

/** A request leaving the page, in any of the shapes a browser offers. */
const REQUESTS =
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bnew\s+WebSocket\b|\bnew\s+EventSource\b|\bimportScripts\b|\bnew\s+Image\s*\(/;
const requestsIn = (source: string) => REQUESTS.test(withoutComments(source));

describe("saved schemas make no request", () => {
  const closure = valueClosure(CHUNK).map(rel);

  it("health: the closure is the chunk's, and a plausible size", () => {
    for (const must of [
      "src/components/tools/ai-extract-schemas.tsx",
      "src/components/tools/ai-extract-schemas-chunk.ts",
      "src/lib/jobs/ai-extract-schemas.ts",
      "src/lib/jobs/ai-extract-schema-key.ts",
      "src/lib/jobs/ai-extract.ts",
      "src/lib/jobs/ai-extract-options.ts",
    ])
      expect(closure).toContain(must);
    expect(closure.length).toBeGreaterThanOrEqual(5);
    expect(closure.length, closure.join("\n")).toBeLessThanOrEqual(15);
  });

  it("positive control: the predicate sees every request shape, and not a comment", () => {
    for (const code of [
      'await fetch("/api/x");',
      "const x = new XMLHttpRequest();",
      'navigator.sendBeacon("/x", body);',
      'new WebSocket("wss://x");',
      'new EventSource("/x");',
      'new Image().src = "/x";',
    ])
      expect(requestsIn(code), code).toBe(true);
    expect(requestsIn('// await fetch("/x")\nconst a = 1;')).toBe(false);
    // And the panel, which runs jobs, does request: the walk can see one.
    const panelClosure = valueClosure(PANEL);
    expect(panelClosure.some((f) => requestsIn(readFileSync(f, "utf8")))).toBe(
      true,
    );
  });

  it("no module the chunk loads makes a request", () => {
    expect(
      closure.filter((f) =>
        requestsIn(readFileSync(path.join(ROOT, f), "utf8")),
      ),
    ).toEqual([]);
  });

  it("the chunk is reached from the panel only through import(), so it is lazy", () => {
    const sf = ts.createSourceFile(
      PANEL,
      readFileSync(PANEL, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const statics: string[] = [];
    const dynamics: string[] = [];
    const visit = (n: ts.Node) => {
      if (
        ts.isImportDeclaration(n) &&
        ts.isStringLiteral(n.moduleSpecifier) &&
        !n.importClause?.isTypeOnly
      )
        statics.push(n.moduleSpecifier.text);
      if (
        ts.isCallExpression(n) &&
        n.expression.kind === ts.SyntaxKind.ImportKeyword &&
        n.arguments[0] &&
        ts.isStringLiteral(n.arguments[0])
      )
        dynamics.push(n.arguments[0].text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(statics.length).toBeGreaterThan(10);
    expect(dynamics).toContain("./ai-extract-schemas");
    expect(statics.filter((s) => /ai-extract-schemas/.test(s))).toEqual([]);
  });
});

describe("where saved schemas are kept", () => {
  it("the schema module touches localStorage only", () => {
    const lib = withoutComments(
      readFileSync(
        path.join(SRC, "lib", "jobs", "ai-extract-schemas.ts"),
        "utf8",
      ),
    );
    expect(lib).toMatch(/\blocalStorage\b/);
    expect(lib).not.toMatch(
      /\b(?:sessionStorage|indexedDB|document\.cookie)\b/,
    );
  });

  it("/privacy lists the key as localStorage, and says it is never uploaded", () => {
    const entry = BROWSER_STORAGE.find((s) => s.key === SAVED_SCHEMAS_KEY);
    expect(entry).toBeDefined();
    expect(entry!.area).toBe("localStorage");
    expect(entry!.holds).toMatch(/never uploaded/);
    expect(entry!.holds).toMatch(/AI Data Extraction/);
  });
});

describe("the page's step about saving", () => {
  const content = getToolContent("ai-extract")!;
  const step = content.steps.find((s) => /Save schema/.test(s.body));

  /** The visible text of every `<button>` in a module, JSX text only. */
  function buttonTexts(file: string): string[] {
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const out: string[] = [];
    const visit = (n: ts.Node) => {
      if (
        ts.isJsxElement(n) &&
        n.openingElement.tagName.getText(sf) === "button"
      ) {
        const text = n.children
          .filter(ts.isJsxText)
          .map((t) => t.text.trim())
          .filter(Boolean)
          .join(" ");
        if (text) out.push(text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  it("health: the step exists and the chunk draws its buttons", () => {
    expect(step).toBeDefined();
    expect(buttonTexts(CHUNK).length).toBeGreaterThanOrEqual(5);
    // Positive control: the reader finds the panel's own buttons too.
    expect(buttonTexts(PANEL)).toContain("Add field");
  });

  it("names every control the saved-schemas chunk draws, and the panel's toggle", () => {
    const controls = [
      ...buttonTexts(CHUNK),
      ...buttonTexts(PANEL).filter((t) => /schema/i.test(t)),
    ];
    expect(controls).toContain("Saved schemas");
    expect(controls.filter((c) => !step!.body.includes(c))).toEqual([]);
  });

  it("its one figure is the cap the code enforces", () => {
    expect(step!.body.match(/\d+/g)).toEqual([String(MAX_SAVED_SCHEMAS)]);
    expect(step!.body).toContain(`up to ${MAX_SAVED_SCHEMAS} schemas`);
  });

  it("says what a job sends, and that claim is held at the wire", () => {
    expect(step!.body).toContain(
      "Pressing Extract data sends only the fields on screen.",
    );
    const wire = readFileSync(
      path.join(SRC, "components", "tools", "ai-extract-schemas.test.tsx"),
      "utf8",
    );
    expect(wire).toContain("the job carries exactly those fields");
    expect(wire).toContain("network.jobBodies");
  });
});
