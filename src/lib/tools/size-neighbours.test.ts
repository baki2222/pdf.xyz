// @vitest-environment node
/**
 * A surface that promises a smaller or faster PDF never sends the reader to a
 * tool that rebuilds the PDF out of page images.
 *
 * ── WHAT SHIPPED ────────────────────────────────────────────────────────────
 *
 * Compress PDF's related band, Optimize for Web's related band and the "How to
 * compress a PDF" guide all linked Grayscale PDF. Grayscale renders every page
 * to a JPEG and re-embeds it; measured through the same pdf.js + JPEG q=0.88
 * pipeline, a 13,707-byte, 10-page text PDF came back as 4,245,048 bytes at the
 * default 150 DPI (x310) and 1,997,791 at 96 DPI (x146). The link placement was
 * the only reason a reader who wanted a smaller file would go there.
 *
 * Nothing caught it because no check related the two ends: `tools.test.ts`
 * asks only that a related slug resolves, and the guide suite that a guide's
 * tool references resolve. Both were true.
 *
 * ── HOW BOTH SETS ARE DERIVED ───────────────────────────────────────────────
 *
 * The raster-to-PDF set is walked along the chain the page itself needs to
 * mount a runner (the output-honesty.test.ts walk):
 *
 *   slug → RUNNERS (registry.ts) → the JSX arm in tool-runner.tsx
 *        → that component's module → its value imports, one level
 *        → does anything there CALL `rasterizePdf(`?
 *
 * and the tool must hand back a PDF (`outputs` includes "PDF"). A tool that
 * rasterizes into JPG/PNG files is doing what it says; one that rasterizes
 * INTO A PDF trades text and vectors for pixels, which is where the size goes.
 * `import type` edges are not followed; the call, not the import, counts.
 *
 * The size-promising set is read from each surface's OWN copy — a tool whose
 * name, tagline, description or keywords sell compression, shrinking, a
 * smaller file or fast loading; a guide whose title, description or keywords
 * do. The property is the promise, so the promise is the corpus.
 *
 * Both sets are bounded in both directions, and each has a positive control
 * run through the same walk: a set that silently collapsed would make every
 * assertion vacuously true.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guides } from "@/lib/guides";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { getRelatedTools, getToolBySlug, tools } from "./index";
import { withoutComments } from "./copy-surface";
import type { Tool } from "./types";
import { runnerModuleOf } from "@/tests/tool-panel-modules";

const ROOT = process.cwd();
const RUNNER_DIR = "src/components/tools/runner";
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** A promise of a smaller or faster file, in the surface's own words. */
const SIZE_PROMISE =
  /\b(?:compress\w*|shrink\w*|smaller|reduc\w* (?:the )?(?:file )?size|fast[- ]loading)\b/i;

function resolveModule(fromRel: string, spec: string): string | undefined {
  let base: string;
  if (spec.startsWith("@/")) base = path.join("src", spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../"))
    base = path.join(path.dirname(fromRel), spec);
  else return undefined;
  for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    try {
      readFileSync(path.join(ROOT, base + suffix));
      return (base + suffix).replace(/\\/g, "/");
    } catch {
      /* next suffix */
    }
  }
  return undefined;
}

/** Value (not type-only) import specifiers of a module. */
function valueImports(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(
    /import\s+(type\s+)?(?:[\w*\s{},]+?)\s+from\s+"([^"]+)"/g,
  )) {
    if (m[1]) continue;
    if (m[2]) specs.push(m[2]);
  }
  return specs;
}

/**
 * A CALL of the rasterizer — not its definition. The first run of this walk
 * counted `export async function rasterizePdf(` in render.ts as a call, and so
 * enrolled Merge PDF (which imports render.ts for a first-page thumbnail) as a
 * page-image rebuilder: the set quietly widened to answer an easier question.
 */
const RASTER_CALL = /(?<!function\s*)(?<![\w$])rasterizePdf\(/;

function callsRasterize(rel: string, depth: number): boolean {
  let source: string;
  try {
    source = read(rel);
  } catch {
    return false;
  }
  if (RASTER_CALL.test(withoutComments(source))) return true;
  if (depth === 0) return false;
  return valueImports(source).some((spec) => {
    const next = resolveModule(rel, spec);
    return next !== undefined && callsRasterize(next, depth - 1);
  });
}

/** slug → runner module, along the dispatch the tool page mounts. */
function runnerModules(): Map<string, string> {
  const dispatch = read(`${RUNNER_DIR}/tool-runner.tsx`);
  const kindToComponent = new Map<string, string>();
  for (const m of dispatch.matchAll(
    /case\s+"([a-z-]+)":[\s\S]{0,200}?<([A-Z][A-Za-z]*)/g,
  )) {
    if (m[1] && m[2] && !kindToComponent.has(m[1]))
      kindToComponent.set(m[1], m[2]);
  }
  // component → module, through the dispatcher's own bindings: a static
  // import, or the `next/dynamic` loader every runner has been since
  // 2026-10-09. An import-statement table here went blind to the loaders and
  // the walk resolved 0 of 30 (the health check below caught it); this throws
  // on a component it cannot follow instead of dropping it.
  const out = new Map<string, string>();
  for (const slug of supportedToolSlugs) {
    const kind = getRunnerKind(slug);
    const component = kind ? kindToComponent.get(kind) : undefined;
    if (component) out.set(slug, runnerModuleOf(component));
  }
  return out;
}

const modules = runnerModules();
const rasterizing = [...modules]
  .filter(([, file]) => callsRasterize(file, 1))
  .map(([slug]) => slug)
  .sort();
const rasterToPdf = new Set(
  rasterizing.filter((slug) => getToolBySlug(slug)?.outputs.includes("PDF")),
);

const promisesSize = (tool: Tool) =>
  SIZE_PROMISE.test(
    [tool.name, tool.tagline, tool.description, ...tool.keywords].join(" | "),
  );
const sizeTools = tools.filter(promisesSize);
const sizeGuides = guides.filter((g) =>
  SIZE_PROMISE.test([g.title, g.description, ...g.keywords].join(" | ")),
);

describe("size-promising surfaces never link a raster-to-PDF tool", () => {
  it("the walk and the promise corpus are healthy, in both directions", () => {
    expect(modules.size, "the slug→runner walk resolved too little").toBe(
      supportedToolSlugs.length,
    );
    // Positive control THROUGH the walk: pdf-to-jpg rasterizes in the runner
    // itself, grayscale one import down; the outputs filter must then drop
    // the image converters and keep the PDF rebuilders.
    expect(rasterizing.length, rasterizing.join(", ")).toBeGreaterThanOrEqual(
      3,
    );
    expect(rasterToPdf.size, [...rasterToPdf].join(", ")).toBeGreaterThan(0);
    expect(rasterToPdf.size).toBeLessThan(rasterizing.length);
    expect(rasterToPdf.size).toBeLessThanOrEqual(6);
    // Negative control for the widening described at RASTER_CALL: the module
    // that DEFINES the rasterizer is not, by that alone, a caller of it.
    expect(callsRasterize("src/lib/pdf/render.ts", 0)).toBe(false);
    expect(RASTER_CALL.test("const pages = await rasterizePdf(bytes, {")).toBe(
      true,
    );
    expect(RASTER_CALL.test("export async function rasterizePdf(")).toBe(false);

    const names = sizeTools.map((t) => t.slug);
    expect(names.length, names.join(", ")).toBeGreaterThanOrEqual(2);
    expect(names.length, names.join(", ")).toBeLessThanOrEqual(8);
    expect(sizeGuides.length).toBeGreaterThanOrEqual(1);
    // The rebuilders do not promise size themselves — if one ever does, it is
    // its own copy that is wrong, and this says so first.
    expect(
      names.filter((slug) => rasterToPdf.has(slug)),
      "a tool that rebuilds pages as images promises a smaller file",
    ).toEqual([]);
  });

  it("no size-promising tool's related band links one", () => {
    const linked = (tool: Tool) =>
      getRelatedTools(tool)
        .filter((r) => rasterToPdf.has(r.slug))
        .map((r) => `${tool.slug} → ${r.slug}`);
    const bad = sizeTools.flatMap(linked);
    expect(bad, bad.join("\n")).toEqual([]);
    // Positive control, through the same detector and the same accessor the
    // page renders from: put a rebuilder in a size tool's band and it is seen.
    const [rebuilder] = [...rasterToPdf];
    const [sizeTool] = sizeTools;
    expect(
      linked({
        ...sizeTool!,
        related: [rebuilder!, ...(sizeTool!.related ?? [])],
      }),
    ).toEqual([`${sizeTool!.slug} → ${rebuilder}`]);
  });

  it("no size-promising guide lists one as a tool it uses", () => {
    const bad = sizeGuides.flatMap((guide) =>
      guide.tools
        .filter((slug) => rasterToPdf.has(slug))
        .map((slug) => `${guide.slug} → ${slug}`),
    );
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
