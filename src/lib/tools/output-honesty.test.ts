// @vitest-environment node
/**
 * Drift guard between what a tool page PROMISES a user will get and what the engine
 * actually writes.
 *
 * `Tool.outputs` is user-facing: the tool page renders it as "Out: PDF" and it is
 * baked into the OpenGraph card. It was written by hand, next to the marketing copy,
 * and never checked against the code that produces the bytes — so it drifted:
 *
 *   - `request-signatures` promised `["PDF"]` and delivered a ZIP.
 *   - `ai-extract` promised `["JSON", "CSV"]` and has never written a single CSV.
 *   - `summarize`, `translate` and `chat-with-pdf` named their contents but not the
 *     ZIP they arrive in, so a user expecting a .txt got an archive.
 *
 * This reads the engine sources as text, the same technique
 * `src/deploy/ocr-languages.test.ts` uses against the Dockerfile: the check has to
 * fail in CI, before a page that misstates the deliverable ships.
 *
 * BUNDLE_TOOLS below is explicit rather than discovered, and for the WORKER engines
 * that is deliberate. Several engines call `zip.file(...)` without producing a ZIP
 * *deliverable* — `docx`, `xlsx` and `pptx` are themselves ZIP containers, so
 * `pdf-office-export` builds one to emit a Word document. Scanning for `zip.file`
 * alone would demand those tools advertise "ZIP", which would be exactly the kind of
 * confident, wrong claim this file exists to prevent.
 *
 * THAT REASONING WAS THEN APPLIED WHERE IT DID NOT HOLD. The in-browser tools were
 * excluded on the same grounds and the grounds were different: `zipFiles(` has exactly
 * one meaning, and `compress-pdf` spent the life of the product promising `["PDF"]`
 * while handing the user `pdfxyz-compressed.zip`. The third test below therefore
 * DERIVES the client-side set by walking slug → registry → runner → imports, and the
 * file now holds both kinds of corpus on purpose: typed where a human judgement about
 * "is this really a deliverable" is load-bearing, walked where it is not.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getToolBySlug, tools } from "./index";
import { modeUploadsFiles } from "./processing-split";
import { withoutComments } from "./copy-surface";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";

/** Tools whose downloadable artifact is a ZIP bundle, and the engine that writes it. */
const BUNDLE_TOOLS: readonly { slug: string; engine: string }[] = [
  { slug: "summarize-pdf", engine: "src/lib/workers/summarize/engine.ts" },
  { slug: "translate-pdf", engine: "src/lib/workers/translate/engine.ts" },
  { slug: "chat-with-pdf", engine: "src/lib/workers/chat-with-pdf/engine.ts" },
  { slug: "ai-extract", engine: "src/lib/workers/ai-extract/engine.ts" },
  {
    slug: "request-signatures",
    engine: "src/lib/workers/request-signatures/engine.ts",
  },
  { slug: "extract-tables", engine: "src/lib/workers/table-extract/engine.ts" },
];

/**
 * The file extensions an engine writes into its bundle, upper-cased to match the
 * catalogue's format tokens. Only top-level entries count: `xl/worksheets/sheet1.xml`
 * is OOXML plumbing inside a nested workbook, not something a user receives as XML.
 */
function bundledFormats(engineFile: string): Set<string> {
  const source = readFileSync(path.join(process.cwd(), engineFile), "utf8");
  const formats = new Set<string>();
  for (const match of source.matchAll(/zip\.file\(\s*[`"']([^`"']+)[`"']/g)) {
    const name = match[1]!;
    if (name.includes("/")) continue;
    const ext = name.split(".").pop();
    if (ext && ext !== name) formats.add(ext.toUpperCase());
  }
  return formats;
}

describe("a tool's advertised outputs match what its engine writes", () => {
  it.each(BUNDLE_TOOLS)(
    "$slug advertises the ZIP it actually delivers",
    ({ slug }) => {
      const tool = getToolBySlug(slug);
      expect(tool, `${slug} is missing from the catalogue`).toBeDefined();
      // The artifact a user downloads is an archive. Naming only its contents reads as
      // a promise of a bare .txt or .pdf, which is what request-signatures did.
      expect(tool!.outputs).toContain("ZIP");
    },
  );

  it.each(BUNDLE_TOOLS)(
    "$slug promises no format it never writes",
    ({ slug, engine }) => {
      const tool = getToolBySlug(slug)!;
      const written = bundledFormats(engine);
      const phantom = tool.outputs.filter(
        (format) => format !== "ZIP" && !written.has(format),
      );
      // `ai-extract` sat here for the life of the product advertising CSV export while
      // its engine wrote extraction.json and extraction.md and nothing else.
      expect(
        phantom,
        `${slug} advertises ${phantom.join(", ")}, but ${engine} writes only ${[...written].join(", ")}`,
      ).toEqual([]);
    },
  );

  /**
   * Every tool a user can download an archive from declares ZIP.
   *
   * ── WHAT THIS REPLACED, AND WHY IT WAS WORSE THAN NO CHECK ─────────────────
   *
   * The test that stood here checked that every catalogue tool ALREADY
   * DECLARING ZIP appeared in BUNDLE_TOOLS. Read the filter: it selected on
   * `t.outputs.includes("ZIP")`, so it could only ever see tools whose
   * declaration was already right. Under-declaration — the one direction that
   * misleads a reader — was structurally invisible to it. That is CLAUDE.md
   * rule 2 exactly: the exit condition named the MECHANISM ("does the
   * catalogue already say ZIP") instead of the PROPERTY ("can a user download
   * an archive").
   *
   * Beside it sat a comment excluding the in-browser tools, and the comment
   * was the part that made the hole feel managed:
   *
   *   "In-browser tools are excluded, not overlooked. split-pdf,
   *    extract-images, pdf-to-jpg and pdf-to-png all deliver a ZIP too ...
   *    (All four already declare ZIP correctly; the drift was only ever in the
   *    worker tools, whose output lived a repo away from its description.)"
   *
   * There were FIVE. `compress-pdf` declared `["PDF"]` and handed the user
   * `pdfxyz-compressed.zip` the moment they dropped two files
   * (compress-runner.tsx: `if (files.length >= 2)` → compress-batch.tsx:
   * `zipFiles(named)` → `downloadBlob(blob, "pdfxyz-compressed.zip")`). That is
   * `request-signatures`' defect — the one this whole file was written for —
   * one tool over, shipping, while the file that exists to catch it said in
   * writing that the drift was only ever somewhere else.
   *
   * ── THE DERIVATION ─────────────────────────────────────────────────────────
   *
   * The set is no longer typed. It is walked along the chain the app itself
   * depends on to render a runner at all:
   *
   *   slug → RUNNERS (src/lib/pdf/registry.ts)
   *        → RunnerKind → the JSX arm in tool-runner.tsx
   *        → that component's module → its local value-imports, one level
   *        → does anything there CALL `zipFiles(`?
   *
   * Rename a runner, re-point a slug, or add a tool and the walk follows,
   * because every hop is a thing the page needs in order to work. One level of
   * import because `compress-pdf`'s zip lives in a sibling module, not in the
   * component the switch names — which is precisely why eyeballing the runner
   * files would have missed it too.
   *
   * `import type` edges are NOT followed: they are erased at runtime and would
   * add reachability the product does not have. And the call, not the import,
   * is what counts — `zipFiles(` with the paren.
   */
  it("every tool whose runner can build an archive declares ZIP", () => {
    const RUNNER_DIR = "src/components/tools/runner";
    const read = (rel: string) =>
      readFileSync(path.join(process.cwd(), rel), "utf8");

    // kind → component name, from the switch the page actually mounts.
    const dispatch = read(`${RUNNER_DIR}/tool-runner.tsx`);
    const kindToComponent = new Map<string, string>();
    for (const m of dispatch.matchAll(
      /case\s+"([a-z-]+)":[\s\S]{0,200}?<([A-Z][A-Za-z]*)/g,
    )) {
      const kind = m[1];
      const component = m[2];
      if (kind && component && !kindToComponent.has(kind))
        kindToComponent.set(kind, component);
    }

    // component name → module path, from that file's own value imports.
    const componentToFile = new Map<string, string>();
    for (const m of dispatch.matchAll(
      /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+"(\.\/[^"]+)"/g,
    )) {
      if (/import\s+type/.test(m[0])) continue;
      const named = m[1] ?? "";
      const from = m[2] ?? "";
      for (const name of named.split(",").map((n) => n.trim())) {
        if (/^[A-Z]/.test(name))
          componentToFile.set(name, `${RUNNER_DIR}/${from.slice(2)}.tsx`);
      }
    }

    const callsZip = (rel: string, depth: number): boolean => {
      let source: string;
      try {
        source = read(rel);
      } catch {
        return false;
      }
      if (withoutComments(source).includes("zipFiles(")) return true;
      if (depth === 0) return false;
      for (const m of source.matchAll(
        /import\s+(?:type\s+)?\{[^}]*\}\s+from\s+"(\.\/[^"]+)"/g,
      )) {
        if (/import\s+type/.test(m[0])) continue;
        const rel2 = m[1] ?? "";
        if (rel2 && callsZip(`${RUNNER_DIR}/${rel2.slice(2)}.tsx`, depth - 1))
          return true;
      }
      return false;
    };

    // Health check FIRST: a walk that resolved nothing would make the
    // assertion below vacuously true, which is the strongest possible pass.
    expect(kindToComponent.size, "no runner kinds parsed").toBeGreaterThan(20);
    expect(componentToFile.size, "no runner modules resolved").toBeGreaterThan(
      20,
    );

    const archiveSlugs = new Set<string>();
    let resolved = 0;
    for (const slug of supportedToolSlugs) {
      const kind = getRunnerKind(slug);
      const component = kind ? kindToComponent.get(kind) : undefined;
      const file = component ? componentToFile.get(component) : undefined;
      if (!file) continue;
      resolved += 1;
      if (callsZip(file, 1)) archiveSlugs.add(slug);
    }
    expect(
      resolved,
      "the slug→component walk resolved nothing",
    ).toBeGreaterThan(20);

    // Positive control THROUGH the walk, not beside it: these two are the
    // reason the walk follows imports and reads the registry at all.
    expect([...archiveSlugs].sort()).toContain("compress-pdf"); // one level down
    expect([...archiveSlugs].sort()).toContain("split-pdf"); // in the component

    const underDeclared = [...archiveSlugs]
      .filter((slug) => !getToolBySlug(slug)?.outputs.includes("ZIP"))
      .sort();
    expect(
      underDeclared,
      "these tools hand the user a .zip and do not say so — the tool page " +
        "renders `Out: {outputs}` and the share card bakes it in: " +
        underDeclared.join(", "),
    ).toEqual([]);
  });

  it("covers every WORKER-backed catalogue tool that claims to deliver a ZIP", () => {
    // Unchanged in intent: keeps BUNDLE_TOOLS from going stale in the other
    // direction, so a new worker bundle tool cannot be added to the catalogue
    // and get neither of the two checks above it. Its filter is the
    // already-declares-ZIP one, which is fine HERE — over-declaration by a
    // worker tool is what it is for. Under-declaration is the test above.
    const claimed = tools
      .filter(
        (t) => modeUploadsFiles(t.processing) && t.outputs.includes("ZIP"),
      )
      .map((t) => t.slug)
      .filter((slug) => getRunnerKind(slug) === undefined);
    const covered = new Set(BUNDLE_TOOLS.map((t) => t.slug));
    expect(claimed.filter((slug) => !covered.has(slug))).toEqual([]);
  });
});
