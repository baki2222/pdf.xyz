// @vitest-environment node
/**
 * Every PDF image an engine draws goes through `drawRasterImage`.
 *
 * `embedRasterImage` lifts a JPEG's EXIF turn out of the stream and records it
 * against the `PDFImage`; only `drawRasterImage` applies it. A module that
 * embeds through the boundary and then calls pdf-lib's own `page.drawImage`
 * lays the stored pixels down on their side — exactly the defect this pair
 * exists to fix (PNG/JPG to PDF drew every portrait phone photo sideways; Edit
 * PDF squeezed an inserted one into its box sideways). The turn is invisible
 * in the call, so the property is structural: **a module that embeds through
 * the boundary draws through it, and never calls `.drawImage(` itself.**
 *
 * ── THE CORPUS, DERIVED ─────────────────────────────────────────────────────
 *
 * Every non-test TypeScript file git would track (`--cached --others`, so a new
 * file is in the set before it is committed) — src/, e2e/ and scripts/ alike —
 * that imports pdf-lib or the boundary and CALLS `embedRasterImage`. Not a list
 * of engines: a list cannot see the engine written next month. Fixture
 * builders are in the set on purpose; one rule with no exemptions is cheaper
 * than a list of who may break it.
 *
 * Its size is bounded in both directions, and both halves of the relationship
 * are checked: no bare `drawImage`, and at least one `drawRasterImage` — so the
 * rule is exercised by the code it governs rather than vacuously true over it.
 *
 * ── WHAT IT CANNOT CATCH ────────────────────────────────────────────────────
 *
 * It is syntactic: `page["draw" + "Image"](…)` passes. And it follows the
 * image only as far as the module that embedded it: a `PDFImage` handed to a
 * helper in ANOTHER file and drawn there with `page.drawImage` is invisible.
 * On 2026-09-27 no such helper exists — the only other `.drawImage(` in a
 * pdf-lib-importing file is a canvas `ctx.drawImage` in the e2e harness, which
 * is exactly why the set is the embedders and not every importer.
 */
import { describe, expect, it } from "vitest";
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const ROOT = resolve(__dirname, "..", "..", "..");
const BOUNDARY = "src/lib/pdf/pdf-lib.ts";

const isTestFile = (file: string): boolean =>
  /\.(test|spec)\.(ts|tsx)$/.test(file);

function corpus(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\.(ts|tsx|mts|cts)$/.test(line));
}

/** Does this import specifier, written in `file`, name pdf-lib or the boundary? */
function namesPdfLib(file: string, spec: string): boolean {
  if (spec === "pdf-lib") return true;
  const target = spec.startsWith("@/")
    ? `src/${spec.slice(2)}`
    : spec.startsWith(".")
      ? posix.join(posix.dirname(file), spec)
      : null;
  return (
    target !== null && target.replace(/\.ts$/, "") === "src/lib/pdf/pdf-lib"
  );
}

interface Scan {
  importsPdfLib: boolean;
  /** `<expr>.drawImage(…)` calls, as line numbers. */
  drawImage: number[];
  /** Calls to a function named `name`. */
  calls: (name: string) => number;
}

export function scan(file: string, source: string): Scan {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let importsPdfLib = false;
  const drawImage: number[] = [];
  const called = new Map<string, number>();
  const visit = (node: TS.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      namesPdfLib(file, node.moduleSpecifier.text)
    ) {
      importsPdfLib = true;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        if (callee.name.text === "drawImage") {
          drawImage.push(
            sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          );
        }
      } else if (ts.isIdentifier(callee)) {
        called.set(callee.text, (called.get(callee.text) ?? 0) + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return {
    importsPdfLib,
    drawImage,
    calls: (name) => called.get(name) ?? 0,
  };
}

describe("the scanner itself", () => {
  it("POSITIVE CONTROL: flags the shape that shipped, and not its fix", () => {
    const shipped = [
      'import { embedRasterImage, loadPdfLib } from "./pdf-lib";',
      "const image = await embedRasterImage(doc, bytes, format);",
      "page.drawImage(image, fitRect(image.width, image.height));",
    ].join("\n");
    const before = scan("src/lib/pdf/image-to-pdf.ts", shipped);
    expect(before.importsPdfLib).toBe(true);
    expect(before.drawImage).toEqual([3]);

    const fixed = scan(
      "src/lib/pdf/image-to-pdf.ts",
      shipped.replace(
        "page.drawImage(image,",
        "await drawRasterImage(page, image,",
      ),
    );
    expect(fixed.drawImage).toEqual([]);
    expect(fixed.calls("drawRasterImage")).toBe(1);
  });

  it("recognises every way a module reaches pdf-lib", () => {
    const via = (file: string, spec: string) =>
      scan(file, `import type { PDFImage } from "${spec}";`).importsPdfLib;
    expect(via("src/lib/pdf/x.ts", "pdf-lib")).toBe(true);
    expect(via("src/lib/pdf/x.ts", "./pdf-lib")).toBe(true);
    expect(via("src/lib/workers/x.ts", "../pdf/pdf-lib")).toBe(true);
    expect(via("src/components/x.tsx", "@/lib/pdf/pdf-lib")).toBe(true);
    // …and not a sibling whose name merely starts the same way.
    expect(via("src/lib/pdf/x.ts", "./pdf-lib-extra")).toBe(false);
    expect(via("src/lib/pdf/x.ts", "pdfjs-dist")).toBe(false);
  });
});

describe("raster images are drawn through drawRasterImage", () => {
  const files = corpus().filter((f) => !isTestFile(f));
  const scans = new Map(
    files.map((f) => [f, scan(f, readFileSync(resolve(ROOT, f), "utf8"))]),
  );
  const pdfLibUsers = [...scans].filter(([, s]) => s.importsPdfLib);
  const embedders = pdfLibUsers.filter(
    ([f, s]) => f !== BOUNDARY && s.calls("embedRasterImage") > 0,
  );

  it("reads a plausible set", () => {
    // Measured 2026-09-27: 31 non-test files import pdf-lib or the boundary;
    // 7 of them embed raster images (five engines, two fixture builders).
    // Bounds catch a corpus that collapsed or stopped filtering — both
    // invisible to the assertions below.
    expect(pdfLibUsers.length).toBeGreaterThan(15);
    expect(pdfLibUsers.length).toBeLessThan(200);
    expect(pdfLibUsers.map(([f]) => f)).toContain(BOUNDARY);
    expect(embedders.length).toBeGreaterThanOrEqual(5);
    expect(embedders.length).toBeLessThan(40);
    // Health check on the scanner's other half: the boundary's own drawImage
    // call is seen, so a scanner blind to drawImage cannot pass.
    expect(scans.get(BOUNDARY)!.drawImage.length).toBeGreaterThan(0);
  });

  it("no module that embeds through the boundary calls drawImage itself", () => {
    const bare = embedders.flatMap(([f, s]) =>
      s.drawImage.map((line) => `${f}:${line}`),
    );
    expect(bare).toEqual([]);
  });

  it("every module that embeds through the boundary draws through it", () => {
    const silent = embedders
      .filter(([, s]) => s.calls("drawRasterImage") === 0)
      .map(([f]) => f);
    expect(silent).toEqual([]);
  });
});
