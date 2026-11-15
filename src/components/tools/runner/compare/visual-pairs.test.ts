import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import type { CapturePagesOptions, CapturedPage } from "@/lib/pdf/render";
import { PdfEngineError } from "@/lib/pdf/engine-errors";
import { diffPlanes } from "@/lib/pdf/compare/visual-diff";
import { canClaimNoVisualDiff } from "./visual-claim";
import {
  capturePairs,
  claimStateOf,
  mayBeEncrypted,
  planeOf,
  visualRender,
  type PairOutcome,
} from "./visual-pairs";

/**
 * The Overlay's rendezvous (S3, 2026-11-15), against a FAKE
 * `capturePdfPages` that keeps the real one's contract: it filters
 * out-of-range `pages` silently, resolves early on abort, reports a failed
 * page through `onPageFailed` and goes on, rejects a RangeError as itself,
 * releases the canvas only after the capture hook settles, and resolves
 * `[]` with no document. Every case asserts that capturePairs SETTLES:
 * a waiter left pending is a hang, and the test times out.
 *
 * The composed chain through the real `capturePdfPages` and pdf.js is
 * `visual-render.native.test.ts`.
 */

const W = 40;
const H = 30;

type Content = "blank" | "ink" | "stamp";

interface FakeSide {
  numPages: number;
  content?: (k: number) => Content;
  failPages?: number[];
  undecoded?: number[];
  /** Reject when page k is reached (before it is drawn). */
  rejectAt?: { page: number; error: Error };
  /** Resolve [] at once, as with no document. */
  empty?: boolean;
}

const sides = new Map<Uint8Array, FakeSide>();
const calls: {
  dpi?: number;
  maxDevicePx?: number;
  pages?: readonly number[];
}[] = [];
let inFlight = 0;
let maxInFlight = 0;
const zeroedAtAwait: boolean[] = [];
const original = visualRender.capture;

afterEach(() => {
  visualRender.capture = original;
  sides.clear();
  calls.length = 0;
  inFlight = 0;
  maxInFlight = 0;
  zeroedAtAwait.length = 0;
});

function rgba(content: Content): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  if (content === "blank") return data;
  for (let y = 5; y < 25; y++)
    for (let x = 5; x < (content === "stamp" ? 35 : 20); x++) {
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  return data;
}

function fakeCanvas(content: Content) {
  const canvas = {
    width: W,
    height: H,
    getContext: () => ({
      getImageData: () => ({ data: rgba(content) }),
    }),
  };
  return canvas as unknown as HTMLCanvasElement;
}

const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));

async function fakeCapture<T>(
  bytes: Uint8Array,
  o: CapturePagesOptions<T>,
): Promise<CapturedPage<T>[]> {
  const cfg = sides.get(bytes)!;
  calls.push({ dpi: o.dpi, maxDevicePx: o.maxDevicePx, pages: o.pages });
  if (cfg.empty) return [];
  const order = (o.pages ?? []).filter(
    (i) => Number.isInteger(i) && i >= 0 && i < cfg.numPages,
  );
  const out: CapturedPage<T>[] = [];
  let done = 0;
  for (const i of order) {
    if (o.signal?.aborted) break;
    await macrotask();
    if (o.signal?.aborted) break;
    if (cfg.rejectAt?.page === i) throw cfg.rejectAt.error;
    if (cfg.failPages?.includes(i)) {
      o.onPageFailed?.({
        index: i,
        message: `Page ${i + 1} could not be rendered.`,
      });
      o.onProgress?.(++done, order.length);
      continue;
    }
    const canvas = fakeCanvas(cfg.content?.(i) ?? "ink");
    const info = {
      index: i,
      width: W,
      height: H,
      pageWidth: 612,
      pageHeight: 792,
    };
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const pending = o.capture(canvas, info);
    zeroedAtAwait.push(canvas.width === 0 && canvas.height === 0);
    const captured = await pending;
    inFlight--;
    canvas.width = 0;
    canvas.height = 0;
    if (o.signal?.aborted) break;
    if (captured === null) {
      o.onPageFailed?.({ index: i, message: "x" });
      continue;
    }
    const page: CapturedPage<T> = {
      ...info,
      data: captured,
      dpi: o.dpi ?? 150,
      dpiCapped: false,
      undecodedImages: cfg.undecoded?.includes(i) ? 1 : 0,
    };
    out.push(page);
    o.onPage?.(page);
    o.onProgress?.(++done, order.length);
  }
  return out;
}

function setup(left: FakeSide, right: FakeSide) {
  const l = new Uint8Array([1]);
  const r = new Uint8Array([2]);
  sides.set(l, left);
  sides.set(r, right);
  visualRender.capture = fakeCapture as typeof visualRender.capture;
  return { l, r };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const scope = (n: number, unpaired = 0) => ({
  pairsTotal: n,
  unpaired,
  hasText: () => false,
});

describe("capturePairs", () => {
  it("(a) both sides deliver: each pair is checked, with its dpi", async () => {
    const { l, r } = setup({ numPages: 2 }, { numPages: 2 });
    const res = await capturePairs(l, r, [0, 1]);
    expect(res.outcomes.map((o) => o.status)).toEqual(["checked", "checked"]);
    const first = res.outcomes[0] as Extract<
      PairOutcome,
      { status: "checked" }
    >;
    expect(first.left.dpi).toBe(150);
    expect(first.diff.regions).toHaveLength(0);
    expect(canClaimNoVisualDiff(claimStateOf(res, scope(2)))).toBe(true);
  });

  it("a stamped page is a pair with regions, and closes the gate", async () => {
    const { l, r } = setup(
      { numPages: 2 },
      { numPages: 2, content: (k) => (k === 1 ? "stamp" : "ink") },
    );
    const res = await capturePairs(l, r, [0, 1]);
    const s = claimStateOf(res, scope(2));
    expect(s.withRegions).toBe(1);
    expect(canClaimNoVisualDiff(s)).toBe(false);
  });

  it("(b) a side that resolves [] makes every pair failed, never clean", async () => {
    const { l, r } = setup({ numPages: 2 }, { numPages: 2, empty: true });
    const res = await capturePairs(l, r, [0, 1]);
    const s = claimStateOf(res, scope(2));
    expect(s.failed).toBe(2);
    expect(s.pairsChecked).toBe(0);
    expect(canClaimNoVisualDiff(s)).toBe(false);
  });

  it("(c) a page that fails on one side fails its pair and releases the partner", async () => {
    const { l, r } = setup({ numPages: 3 }, { numPages: 3, failPages: [1] });
    const res = await capturePairs(l, r, [0, 1, 2]);
    expect(res.outcomes.map((o) => o.status)).toEqual([
      "checked",
      "failed",
      "checked",
    ]);
    expect(canClaimNoVisualDiff(claimStateOf(res, scope(3)))).toBe(false);
  });

  it("(d) a refusal on one side aborts the other, and no waiter is left", async () => {
    const message =
      "Page 2 of this PDF has more image data than one page can draw.";
    const { l, r } = setup(
      { numPages: 4 },
      {
        numPages: 4,
        rejectAt: { page: 1, error: new PdfEngineError(message) },
      },
    );
    const res = await capturePairs(l, r, range(4));
    expect(res.refused).toEqual({ side: "right", message });
    expect(res.memory).toBeNull();
    const s = claimStateOf(res, scope(4));
    expect(s.refused).toBe(message);
    expect(s.pairsChecked).toBeLessThan(4);
    expect(canClaimNoVisualDiff(s)).toBe(false);
  });

  it("(e) a stop after 3 of 10 checks exactly 3 and settles every waiter", async () => {
    const { l, r } = setup({ numPages: 10 }, { numPages: 10 });
    const stop = new AbortController();
    let checked = 0;
    const res = await capturePairs(l, r, range(10), {
      signal: stop.signal,
      onPair: (o) => {
        if (o.status === "checked" && ++checked === 3) stop.abort();
      },
    });
    const s = claimStateOf(res, scope(10));
    expect(s.aborted).toBe(true);
    expect(s.pairsChecked).toBe(3);
    expect(canClaimNoVisualDiff(s)).toBe(false);
  });

  it("(f) 200 pairs hold at most one page per side, and each hook zeroes its canvas before it waits", async () => {
    const { l, r } = setup({ numPages: 200 }, { numPages: 200 });
    const res = await capturePairs(l, r, range(200));
    expect(res.outcomes).toHaveLength(200);
    // Health: the hook ran on every page of both sides.
    expect(zeroedAtAwait).toHaveLength(400);
    expect(zeroedAtAwait.every(Boolean)).toBe(true);
    // At most one hook per side in flight: two planes alive at once.
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThanOrEqual(1);
    // Planes are dropped once diffed, unless the caller keeps them.
    expect(
      res.outcomes.every((o) => o.status !== "checked" || o.planes === null),
    ).toBe(true);
    const kept = await capturePairs(l, r, [5], { keep: true });
    const one = kept.outcomes[0] as Extract<PairOutcome, { status: "checked" }>;
    expect(one.planes?.left.w).toBe(W);
  }, 60_000);

  it("(g) both calls draw at 150 dpi, at most 2,000 px a side, over the same pages", async () => {
    const { l, r } = setup({ numPages: 5 }, { numPages: 5 });
    await capturePairs(l, r, [1, 3]);
    expect(calls).toEqual([
      { dpi: 150, maxDevicePx: 2000, pages: [1, 3] },
      { dpi: 150, maxDevicePx: 2000, pages: [1, 3] },
    ]);
  });

  it("(h) an undecoded image on either side is counted", async () => {
    const { l, r } = setup({ numPages: 2, undecoded: [1] }, { numPages: 2 });
    const s = claimStateOf(await capturePairs(l, r, [0, 1]), scope(2));
    expect(s.undecoded).toBe(1);
    expect(canClaimNoVisualDiff(s)).toBe(false);
  });

  it("(i) a page one side does not have fails its pair, with no deadlock", async () => {
    const { l, r } = setup({ numPages: 3 }, { numPages: 2 });
    const res = await capturePairs(l, r, [0, 1, 2]);
    expect(res.outcomes.map((o) => o.status)).toEqual([
      "checked",
      "checked",
      "failed",
    ]);
    // And the mirror.
    const m = setup({ numPages: 2 }, { numPages: 3 });
    const mirror = await capturePairs(m.l, m.r, [0, 1, 2]);
    expect(mirror.outcomes.map((o) => o.status)).toEqual([
      "checked",
      "checked",
      "failed",
    ]);
  });

  it("(j) out of memory is a failure with its page, not a refusal", async () => {
    const { l, r } = setup(
      { numPages: 4, rejectAt: { page: 2, error: new RangeError("oom") } },
      { numPages: 4 },
    );
    const res = await capturePairs(l, r, range(4));
    expect(res.refused).toBeNull();
    expect(res.memory).toEqual({ side: "left", index: 2 });
    const s = claimStateOf(res, scope(4));
    expect(s.failed).toBeGreaterThanOrEqual(1);
    expect(s.refused).toBeNull();
    expect(canClaimNoVisualDiff(s)).toBe(false);
  });

  it("both pages drawn blank where the text layer has text are not compared", async () => {
    const { l, r } = setup(
      { numPages: 1, content: () => "blank" },
      { numPages: 1, content: () => "blank" },
    );
    const res = await capturePairs(l, r, [0]);
    const s = claimStateOf(res, { ...scope(1), hasText: () => true });
    expect(s.blankWithText).toBe(1);
    expect(canClaimNoVisualDiff(s)).toBe(false);
    // Blank on both sides with no text there is two blank pages: clean.
    expect(canClaimNoVisualDiff(claimStateOf(res, scope(1)))).toBe(true);
  });
});

describe("the plane the overlay compares", () => {
  /** A 60 × 40 RGBA patch of one colour on white. */
  const patch = (r: number, g: number, b: number) => {
    const data = new Uint8ClampedArray(80 * 60 * 4).fill(255);
    for (let y = 10; y < 50; y++)
      for (let x = 10; x < 70; x++) {
        const i = (y * 80 + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
    return planeOf(data, 80, 60);
  };

  it("scope probe: a hue change at equal lightness is no region; a lightness change is", () => {
    // (255, 0, 0) and (0, 130, 0) have the same Rec. 601 luma, 76.
    expect(diffPlanes(patch(255, 0, 0), patch(0, 130, 0)).regions).toHaveLength(
      0,
    );
    expect(
      diffPlanes(patch(255, 0, 0), patch(0, 0, 0)).regions.length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("mayBeEncrypted", () => {
  it("says yes for /Encrypt anywhere, no without it", () => {
    const enc = new TextEncoder();
    expect(mayBeEncrypted(enc.encode("trailer << /Encrypt 5 0 R >>"))).toBe(
      true,
    );
    expect(
      mayBeEncrypted(enc.encode("trailer << /Root 1 0 R >> /Encryp")),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 *  The overlay-path guard
 * ------------------------------------------------------------------ */

const ROOT = process.cwd();
const COMPARE_DIR = path.join(ROOT, "src/components/tools/runner/compare");

/** Resolve an import specifier to a source file, or null for a package. */
function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(ROOT, "src", spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec)
      : null;
  if (!base) return null;
  for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
    if (existsSync(c)) return c;
  return null;
}

/** Static VALUE edges: `import type` and all-type named imports are erased. */
function valueImports(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  for (const st of sf.statements) {
    let spec: string | null = null;
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      if (
        clause &&
        !clause.name &&
        named &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((e) => e.isTypeOnly)
      )
        continue;
      spec = (st.moduleSpecifier as ts.StringLiteral).text;
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier) {
      if (st.isTypeOnly) continue;
      spec = (st.moduleSpecifier as ts.StringLiteral).text;
    }
    if (spec === null) continue;
    const target = resolve(file, spec);
    if (target) out.push(target);
  }
  return out;
}

function graphFrom(
  start: string,
  read = (f: string) => readFileSync(f, "utf8"),
) {
  const seen = new Map<string, string>();
  const queue = [start];
  while (queue.length) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    const src = read(f);
    seen.set(f, src);
    queue.push(...valueImports(f, src));
  }
  return seen;
}

const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The preview opens the overlay must never reach. */
const PREVIEW_NAMES =
  /\b(?:openViewerPdf|acquireComparePdf|createThumbnailRenderer)\b/;
const PREVIEW_MODULES = ["compare-open.ts", "compare-docs.ts", "viewer.ts"];

/**
 * What breaks the property in a module graph: a preview module reached, or
 * a preview open named by a module that does not define it. (render.ts
 * defines `createThumbnailRenderer` and its own thumbnails call it; that
 * module being LOADED is not the overlay calling it, and the overlay's one
 * call into render.ts is pinned to `capturePdfPages` below.)
 */
function violations(graph: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [file, src] of graph) {
    const rel = path.relative(ROOT, file);
    if (PREVIEW_MODULES.includes(path.basename(file)))
      out.push(`reaches ${rel}`);
    const body = code(src);
    const defines = new Set(
      [...body.matchAll(/\bfunction\s+(\w+)|\b(?:const|let)\s+(\w+)\s*=/g)].map(
        (m) => m[1] ?? m[2]!,
      ),
    );
    const named = [...body.matchAll(new RegExp(PREVIEW_NAMES.source, "g"))]
      .map((m) => m[0])
      .filter((n) => !defines.has(n));
    if (named.length > 0) out.push(`${rel} names ${named[0]}`);
  }
  return out;
}

describe("the overlay draws only through a refuse-judged open", () => {
  const start = path.join(COMPARE_DIR, "compare-overlay.tsx");

  it("health: its graph holds the drawing and the output path, and is not implausibly small", () => {
    const graph = graphFrom(start);
    const names = [...graph.keys()].map((f) =>
      path.relative(ROOT, f).replace(/\\/g, "/"),
    );
    expect(names).toContain(
      "src/components/tools/runner/compare/visual-pairs.ts",
    );
    expect(names).toContain("src/lib/pdf/render.ts");
    expect(graph.size).toBeGreaterThanOrEqual(3);
  });

  it("reaches no preview open", () => {
    const graph = graphFrom(start);
    expect(violations(graph), [...graph.keys()].join(", ")).toEqual([]);
  });

  it("positive control: a module importing acquireComparePdf is caught", () => {
    const fixture = path.join(COMPARE_DIR, "fixture-overlay.tsx");
    const graph = graphFrom(fixture, (f) =>
      f === fixture
        ? `import { acquireComparePdf } from "./compare-docs";\nexport const x = acquireComparePdf;`
        : readFileSync(f, "utf8"),
    );
    const found = violations(graph);
    expect(found.some((v) => v.includes("compare-docs.ts"))).toBe(true);
    expect(found.some((v) => v.includes("names acquireComparePdf"))).toBe(true);
  });

  it("takes capturePdfPages from @/lib/pdf/render, and reads pixels only in a capture hook", () => {
    const pairs = readFileSync(
      path.join(COMPARE_DIR, "visual-pairs.ts"),
      "utf8",
    );
    expect(code(pairs)).toMatch(
      /import\s*\{[^}]*\bcapturePdfPages\b[^}]*\}\s*from\s*"@\/lib\/pdf\/render"/,
    );
    expect(code(pairs)).toMatch(/capture:\s*capturePdfPages/);
    // Every getImageData in the compare directory sits in a function that is
    // passed as `capture`, directly or as the call that makes it.
    const files = [...graphFrom(start).keys()].filter(
      (f) => path.dirname(f) === COMPARE_DIR,
    );
    let reads = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
      const capturedNames = new Set<string>();
      const sites: ts.Node[] = [];
      const visit = (n: ts.Node) => {
        if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "capture") {
          const init = n.initializer;
          if (ts.isIdentifier(init)) capturedNames.add(init.text);
          if (ts.isCallExpression(init) && ts.isIdentifier(init.expression))
            capturedNames.add(init.expression.text);
        }
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === "getImageData"
        )
          sites.push(n);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      for (const site of sites) {
        reads++;
        // The function the read sits in, then the variable that holds it
        // (through any function that makes it: `hook(side)` returns it).
        let p: ts.Node | undefined = site.parent;
        while (p && !ts.isFunctionLike(p)) p = p.parent;
        let owner: string | null = null;
        while (p) {
          if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
            owner = p.name.text;
            break;
          }
          p = p.parent;
        }
        expect(
          owner !== null && capturedNames.has(owner),
          `${path.basename(f)}: getImageData outside a capture hook`,
        ).toBe(true);
      }
    }
    // Health: the hook's own read was found.
    expect(reads).toBeGreaterThanOrEqual(1);
  });
});
