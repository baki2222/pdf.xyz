// @vitest-environment node
/**
 * Every page board offers "View page N larger" (backlog #9, 2026-11-17).
 *
 * Until then only Delete / Extract Pages had it (audit remove-pages#3); Split,
 * PDF to PNG / JPG, Resize, Organize and Rotate drew the same small tiles with
 * no way to look closer. The boards are not named here: they are FOUND, as
 * every source file that renders `<PageTile>` or calls `usePdfThumbnails()`,
 * read through the TypeScript parser so a mention in a comment or a string is
 * not a use. Each must render the shared `<ZoomButton>` and
 * `<LazyPageZoomDialog>` from page-zoom-lazy.tsx, or be listed below with the
 * reason it does not.
 *
 * Health checks: the found set is bounded both ways (a walk that finds
 * nothing would pass everything), and each predicate is first run on a
 * source that must fail it.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../..");
const ZOOM_MODULE = "page-zoom-lazy";

/** Boards that draw page tiles and do not offer the zoom, with why. */
const WITHOUT_ZOOM: Record<string, string> = {
  "components/tools/runner/viewer/viewer-sidebar.tsx":
    "the PDF Viewer's page rail: pressing a thumbnail already shows that page large in the viewer beside it",
};

/** Where the tiles and the thumbnail hook are defined, not used. */
const DEFINITIONS = new Set([
  "components/tools/runner/page-tile.tsx",
  "components/tools/runner/use-pdf-thumbnails.ts",
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      sourceFiles(full, out);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

interface Uses {
  /** JSX tag names rendered. */
  tags: Set<string>;
  /** Plain function names called. */
  calls: Set<string>;
  /** Imported binding -> module specifier. */
  imports: Map<string, string>;
}

function usesOf(fileName: string, text: string): Uses {
  const file = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const uses: Uses = { tags: new Set(), calls: new Set(), imports: new Map() };
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      uses.tags.add(node.tagName.getText(file));
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      uses.calls.add(node.expression.text);
    } else if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.importClause?.isTypeOnly
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          if (!el.isTypeOnly) {
            uses.imports.set(el.name.text, node.moduleSpecifier.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return uses;
}

const drawsTiles = (u: Uses) =>
  u.tags.has("PageTile") || u.calls.has("usePdfThumbnails");

const fromZoomModule = (u: Uses, name: string) =>
  path.posix.basename(u.imports.get(name) ?? "") === ZOOM_MODULE;

/** Renders the shared enlarge button AND the dialog it opens. */
const offersZoom = (u: Uses) =>
  u.tags.has("ZoomButton") &&
  u.tags.has("LazyPageZoomDialog") &&
  fromZoomModule(u, "ZoomButton") &&
  fromZoomModule(u, "LazyPageZoomDialog");

const rel = (full: string) =>
  path.relative(SRC, full).split(path.sep).join("/");

const boards = sourceFiles(SRC)
  .map((full) => ({ file: rel(full), text: readFileSync(full, "utf8") }))
  .filter(({ file }) => !DEFINITIONS.has(file))
  .map(({ file, text }) => ({ file, text, uses: usesOf(file, text) }))
  .filter(({ uses }) => drawsTiles(uses));

describe("page boards · view a page larger", () => {
  it("finds a plausible set of boards (health check)", () => {
    const found = boards.map((b) => b.file).sort();
    // Printed, not counted: a set that shrinks or grows shows its members.
    expect(found).toEqual(
      expect.arrayContaining([
        "components/tools/runner/organize-runner.tsx",
        "components/tools/runner/page-picker.tsx",
        "components/tools/runner/page-select-runner.tsx",
        "components/tools/runner/rotate-runner.tsx",
      ]),
    );
    expect(found.length, found.join("\n")).toBeLessThanOrEqual(20);
  });

  it("the predicates fail a board that lacks the zoom (positive control)", () => {
    const bare = usesOf(
      "bare.tsx",
      `import { PageTile } from "./page-tile";
       // <ZoomButton /> and <LazyPageZoomDialog /> are only mentioned here.
       export const B = () => <PageTile label="Page 1" />;`,
    );
    expect(drawsTiles(bare)).toBe(true);
    expect(offersZoom(bare)).toBe(false);

    const own = usesOf(
      "own.tsx",
      `import { ZoomButton, LazyPageZoomDialog } from "./somewhere-else";
       const n = usePdfThumbnails(bytes, 3);
       export const B = () => <><ZoomButton /><LazyPageZoomDialog /></>;`,
    );
    expect(drawsTiles(own)).toBe(true);
    expect(offersZoom(own), "a look-alike from another module").toBe(false);

    const good = usesOf(
      "good.tsx",
      `import { ZoomButton, LazyPageZoomDialog } from "./page-zoom-lazy";
       export const B = () => <><PageTile /><ZoomButton /><LazyPageZoomDialog /></>;`,
    );
    expect(offersZoom(good)).toBe(true);
  });

  it("every board offers it, or says why not", () => {
    const missing = boards
      .filter((b) => !WITHOUT_ZOOM[b.file] && !offersZoom(b.uses))
      .map((b) => b.file);
    expect(missing).toEqual([]);
  });

  it("every listed exception is still a board, and still without the zoom", () => {
    const byFile = new Map(boards.map((b) => [b.file, b]));
    for (const [file, reason] of Object.entries(WITHOUT_ZOOM)) {
      expect(byFile.has(file), `${file} no longer draws page tiles`).toBe(true);
      expect(offersZoom(byFile.get(file)!.uses), `${file}: ${reason}`).toBe(
        false,
      );
    }
  });

  it("the button's name is defined once", () => {
    const shape = /View page \$\{/;
    const defs = sourceFiles(SRC)
      .filter((full) => shape.test(readFileSync(full, "utf8")))
      .map(rel);
    expect(defs).toEqual([`components/tools/runner/${ZOOM_MODULE}.tsx`]);
  });
});
