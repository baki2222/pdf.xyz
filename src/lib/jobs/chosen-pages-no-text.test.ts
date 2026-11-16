// @vitest-environment node
/**
 * `./chosen-pages-no-text` holds ONE sentence map, and NO PANEL loads it at
 * first load (Translate S6 review, 2026-11-16).
 *
 * The map lived in `./summarize-pages`, which the Summarize panel imports
 * statically; Translate's key rode Summarize's first load and Translate's
 * lazy measure made `summarize-pages` ship in two chunks (measured on the
 * merged build, recorded in bundle-budget.test.ts). Moving it was the fix;
 * this test is what keeps it moved. Three relationships, each DISCOVERED:
 *
 *  1. one author: the sentence's text appears in exactly one non-test source
 *     file, the leaf (a copy in a second module is the defect the map was
 *     keyed by tool to prevent);
 *  2. the importers are the two measures and the two engines, none a
 *     component;
 *  3. no tool panel reaches the leaf by a STATIC import, at any depth: the
 *     closure is walked from every panel module the tool page mounts
 *     (`ownPanelModules`), following `import` / `export … from` but not
 *     `import()` (a lazy chunk is not first load) and not `import type`
 *     (erased).
 * Each has a health check or a positive control, because `[] ⊆ X` passes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "@/tests/chunk-markers";
import {
  ROOT,
  ownPanelModules,
  parsedSource,
  rel,
  resolveSpecifier,
  valueClosure,
} from "@/tests/tool-panel-modules";
import { NO_TEXT_IN_CHOSEN_PAGES_MESSAGE } from "./chosen-pages-no-text";

const LEAF = path.join(ROOT, "src", "lib", "jobs", "chosen-pages-no-text.ts");
const posix = (f: string) => rel(f).split(path.sep).join("/");

/** Static VALUE edges only: no `import()`, no `import type`. */
function staticEdges(file: string): string[] {
  const out: string[] = [];
  for (const n of parsedSource(file).statements) {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const typeOnly =
        !!c &&
        (c.isTypeOnly ||
          (!c.name &&
            !!c.namedBindings &&
            ts.isNamedImports(c.namedBindings) &&
            c.namedBindings.elements.length > 0 &&
            c.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (typeOnly) continue;
      const r = resolveSpecifier(file, n.moduleSpecifier.text);
      if (r) out.push(r);
    } else if (
      ts.isExportDeclaration(n) &&
      !n.isTypeOnly &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      const r = resolveSpecifier(file, n.moduleSpecifier.text);
      if (r) out.push(r);
    }
  }
  return out;
}

function staticClosure(entry: string): Set<string> {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length)
    for (const next of staticEdges(queue.pop()!))
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  return seen;
}

const sources = sourceFiles();

describe("chosen-pages-no-text: one author, no panel's first load", () => {
  it("health: the source corpus is plausible and holds the leaf", () => {
    expect(sources.length).toBeGreaterThan(500);
    expect(sources.length).toBeLessThan(5000);
    expect(sources).toContain(LEAF);
  });

  it("one author: the sentence's text is written in the leaf and nowhere else", () => {
    const sentences = new Set(Object.values(NO_TEXT_IN_CHOSEN_PAGES_MESSAGE));
    expect(sentences.size).toBeGreaterThan(0);
    for (const sentence of sentences) {
      const holders = sources
        .filter((f) => readFileSync(f, "utf8").includes(sentence))
        .map(posix);
      expect(holders).toEqual(["src/lib/jobs/chosen-pages-no-text.ts"]);
    }
  });

  it("the importers are both measures and both engines, and no component", () => {
    const importers = sources
      .filter((f) => f !== LEAF && staticEdges(f).includes(LEAF))
      .map(posix)
      .sort();
    expect(importers).toEqual([
      "src/lib/workers/summarize-measure.ts",
      "src/lib/workers/summarize/engine.ts",
      "src/lib/workers/translate-measure.ts",
      "src/lib/workers/translate/engine.ts",
    ]);
  });

  it("no tool panel reaches the leaf by a static import", () => {
    const { modules } = ownPanelModules();
    // Health: the corpus of panels is the catalogue's, not a handful.
    expect(modules.length).toBeGreaterThan(20);
    const files = modules.map((m) => posix(m.file));
    expect(files).toContain("src/components/tools/summarize-worker-panel.tsx");
    expect(files).toContain("src/components/tools/translate-worker-panel.tsx");
    const reaching = modules
      .filter((m) => staticClosure(m.file).has(LEAF))
      .map((m) => posix(m.file));
    expect(reaching).toEqual([]);
  });

  it("POSITIVE CONTROLS: the static walk sees static edges, and stops at import()", () => {
    const panel = path.join(
      ROOT,
      "src",
      "components",
      "tools",
      "translate-worker-panel.tsx",
    );
    const summarizePanel = path.join(
      ROOT,
      "src",
      "components",
      "tools",
      "summarize-worker-panel.tsx",
    );
    // A static edge several hops deep is seen: the Summarize panel's rollback
    // sentence module, and Translate's sentences module.
    expect(
      staticClosure(summarizePanel).has(
        path.join(ROOT, "src", "lib", "jobs", "summarize-pages.ts"),
      ),
    ).toBe(true);
    expect(
      staticClosure(panel).has(
        path.join(ROOT, "src", "lib", "jobs", "translate-pages.ts"),
      ),
    ).toBe(true);
    // The lazy measure reaches the leaf statically...
    expect(
      staticClosure(
        path.join(ROOT, "src", "lib", "workers", "translate-measure.ts"),
      ).has(LEAF),
    ).toBe(true);
    // ...and the panel reaches it through `import()`: the full value closure
    // (which follows `import()`) holds it, so the exclusion above is the
    // static/lazy distinction, not a walker that never gets there.
    expect(valueClosure(panel)).toContain(LEAF);
    expect(valueClosure(summarizePanel)).toContain(LEAF);
  });
});
