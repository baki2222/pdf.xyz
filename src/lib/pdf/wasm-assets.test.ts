// @vitest-environment node
/**
 * The decoders are reachable, and every document opened asks for them.
 *
 * Three separate ways the JPEG2000/JBIG2 blank-output defect could return:
 *  1. the pinned version drifts from the installed package, so the browser
 *     fetches decoders from a directory the build never wrote;
 *  2. a new `getDocument` call site hand-writes its options and omits
 *     `wasmUrl` — the original defect was exactly one missing option, spread
 *     across four call sites that each wrote their own;
 *  3. the asset list names a file pdfjs does not ship (a rename in a future
 *     release), so the copy step ships less than the library asks for.
 *
 * None of these is visible at runtime: a missing decoder produces a blank
 * region and no error, which is why they are pinned here rather than trusted
 * to review.
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PDFJS_CMAP_URL,
  PDFJS_DOCUMENT_DEFAULTS,
  PDFJS_UNSET_ASSET_OPTIONS,
  PDFJS_WASM_ASSETS,
  PDFJS_WASM_URL,
  PDFJS_WASM_VERSION,
} from "./wasm-assets";

const require = createRequire(import.meta.url);
const PDFJS_PKG = require.resolve("pdfjs-dist/package.json");
const PDFJS_DIR = path.dirname(PDFJS_PKG);

/** Repo-relative, forward-slashed — so a failure message reads the same on any OS. */
const rel = (file: string) =>
  path.relative(process.cwd(), file).replace(/\\/g, "/");

describe("the pinned pdfjs decoders match the installed package", () => {
  it("pins the version actually installed", () => {
    const installed = (
      JSON.parse(readFileSync(PDFJS_PKG, "utf8")) as { version: string }
    ).version;
    expect(
      PDFJS_WASM_VERSION,
      `pdfjs-dist is ${installed} but the wasm URL is stamped ${PDFJS_WASM_VERSION} — ` +
        "the browser would fetch decoders from a directory the build never wrote, " +
        "and a PDF carrying a JPEG2000 or JBIG2 image would render blank with no error",
    ).toBe(installed);
  });

  it("names only files the package actually ships", () => {
    const shipped = new Set(readdirSync(path.join(PDFJS_DIR, "wasm")));
    for (const asset of PDFJS_WASM_ASSETS) {
      expect(
        shipped.has(asset),
        `pdfjs ${PDFJS_WASM_VERSION} has no wasm/${asset} — the copy step would ship ` +
          "less than the library asks for",
      ).toBe(true);
      expect(
        statSync(path.join(PDFJS_DIR, "wasm", asset)).size,
      ).toBeGreaterThan(0);
    }
  });

  it("ships every decoder the worker asks for by name", () => {
    // The worker names its wasm and its JS fallback in `_filename` /
    // `_noWasmFilename` fields. Whatever it names, we must serve — this is the
    // reach-proof for the asset list: a new decoder appearing in a future
    // pdfjs release fails here instead of silently decoding to nothing.
    const worker = readFileSync(
      path.join(PDFJS_DIR, "build", "pdf.worker.mjs"),
      "utf8",
    );
    const named = [
      ...worker.matchAll(/_(?:noWasm)?[Ff]ilename\s*=\s*"([^"]+)"/g),
    ].map((m) => m[1]!);
    expect(
      named.length,
      "found no decoder filenames in the worker — the pattern that reads them has " +
        "gone stale, so this proof is no longer proving anything",
    ).toBeGreaterThan(0);
    for (const name of new Set(named)) {
      expect(
        PDFJS_WASM_ASSETS as readonly string[],
        `the worker fetches "${name}" but it is not in PDFJS_WASM_ASSETS, so nothing ` +
          "copies it into public/ — that decoder would fail silently",
      ).toContain(name);
    }
  });

  it("excludes the PDF-scripting engine deliberately", () => {
    // Not an oversight, and the docblock argues the case. quickjs-eval belongs
    // to pdf.sandbox.mjs, which executes JavaScript embedded in a user's PDF.
    expect(PDFJS_WASM_ASSETS as readonly string[]).not.toContain(
      "quickjs-eval.wasm",
    );
    const sandboxOnly = readFileSync(
      path.join(PDFJS_DIR, "build", "pdf.worker.mjs"),
      "utf8",
    );
    expect(
      sandboxOnly.includes("quickjs"),
      "quickjs is now referenced by the WORKER, not just the sandbox — the exclusion " +
        "was argued on the basis that we never load pdf.sandbox.mjs; re-argue it",
    ).toBe(false);
  });
});

describe("every document we open asks for the decoders", () => {
  /**
   * The whole source tree, recursively — NOT `src/lib/pdf`.
   *
   * The first version of this guard read one flat directory, because that is
   * where all four call sites happen to live today. It would have been blind
   * to a `getDocument` in a `.tsx` runner, under `src/lib/workers`, or in
   * `scripts/` — a private, narrow walk written inside the fix for the defect
   * that narrow private walks keep causing. The surface has to be as wide as
   * the place the mistake can be made, not as wide as the mistakes made so far.
   */
  const sourceFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
          out.push(full);
      }
    };
    for (const root of ["src", "scripts"]) {
      const dir = path.join(process.cwd(), root);
      if (statSync(dir).isDirectory()) walk(dir);
    }
    return out;
  };

  it("scans the whole source tree, not one directory", () => {
    const files = sourceFiles().map((f) =>
      path.relative(process.cwd(), f).replace(/\\/g, "/"),
    );
    expect(files.length).toBeGreaterThanOrEqual(200);
    // Reach-proof: a call site could legitimately appear in any of these
    // shapes, so the walk must demonstrably reach all of them.
    expect(files).toContain("src/lib/pdf/render.ts");
    expect(
      files.some((f) => f.startsWith("src/components/") && f.endsWith(".tsx")),
    ).toBe(true);
    expect(files.some((f) => f.startsWith("src/lib/workers/"))).toBe(true);
    expect(files.some((f) => f.startsWith("scripts/"))).toBe(true);
  });

  it("has no getDocument call that builds its own options", () => {
    const offenders: string[] = [];
    let callSites = 0;
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/getDocument\(([^)]*)\)/g)) {
        callSites += 1;
        if (!match[1]!.includes("PDFJS_DOCUMENT_DEFAULTS")) {
          offenders.push(
            `${rel(file)}: getDocument(${match[1]!.trim()}) does not spread ` +
              "PDFJS_DOCUMENT_DEFAULTS — without wasmUrl this document's JPEG2000 and " +
              "JBIG2 images decode to nothing, silently",
          );
        }
      }
    }
    expect(
      callSites,
      "no getDocument call sites found — this guard has stopped reading the engines",
    ).toBeGreaterThan(0);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("points at a directory URL pdfjs can append filenames to", () => {
    // pdfjs builds `${wasmUrl}${filename}` — a missing trailing slash silently
    // produces "/pdfjs-wasm/6.1.200openjpeg.wasm".
    for (const url of [PDFJS_WASM_URL, PDFJS_CMAP_URL]) {
      expect(url.endsWith("/")).toBe(true);
      expect(url).toContain(PDFJS_WASM_VERSION);
    }
    expect(PDFJS_DOCUMENT_DEFAULTS.wasmUrl).toBe(PDFJS_WASM_URL);
    expect(PDFJS_DOCUMENT_DEFAULTS.cMapUrl).toBe(PDFJS_CMAP_URL);
  });
});

describe("the convention the undecoded-image counter rests on", () => {
  it("still resolves a failed image decode to null, and only then", () => {
    // `countUndecodedImages` reads pdfjs's own verdict: a failed decode is
    // reported by resolving the image object to null. That is real but
    // UNDOCUMENTED, so a pdfjs upgrade could change it — and the counter's
    // failure mode is a SILENT ZERO, which is worse than the absence it
    // replaced, because every tool would then confidently report a clean run
    // on a document it had blanked. This assertion is the only thing that
    // makes such an upgrade fail loudly, so it ships with the counter rather
    // than after it.
    const worker = readFileSync(
      path.join(PDFJS_DIR, "build", "pdf.worker.mjs"),
      "utf8",
    );
    const nullSends = [
      ...worker.matchAll(/_sendImgData\(\s*[A-Za-z_$][\w$]*\s*,\s*null/g),
    ];
    expect(
      nullSends.length,
      "pdfjs no longer resolves a failed image decode to null in exactly the two " +
        "known places (found " +
        nullSends.length +
        "). countUndecodedImages may now silently report zero on documents it " +
        "should be warning about — re-read buildPaintImageXObject before trusting it.",
    ).toBe(2);
  });
});

describe("character maps, without which CJK documents render blank", () => {
  it("asks for the packed maps, because packed is what ships", () => {
    // The package ships `.bcmap`. With cMapPacked false pdfjs requests the
    // unpacked spelling and every request 404s — the same blank page, one
    // option over.
    expect(
      PDFJS_DOCUMENT_DEFAULTS.cMapPacked,
      "cMapUrl without cMapPacked makes pdfjs request unpacked maps the package " +
        "does not ship, and a non-embedded CJK page renders blank again",
    ).toBe(true);
    const packed = readdirSync(path.join(PDFJS_DIR, "cmaps")).filter((n) =>
      n.endsWith(".bcmap"),
    );
    expect(packed.length).toBeGreaterThanOrEqual(100);
  });

  it("records the sibling options measured NOT to matter", () => {
    // The point of the list is that it is SHORT: each entry was probed, not
    // assumed. If someone later measures one of these as live, it moves out of
    // this list and into the defaults — and this test is where they will look.
    expect(PDFJS_UNSET_ASSET_OPTIONS).toEqual([
      "standardFontDataUrl",
      "iccUrl",
    ]);
    for (const option of PDFJS_UNSET_ASSET_OPTIONS) {
      expect(
        Object.keys(PDFJS_DOCUMENT_DEFAULTS),
        `${option} is now set, but it is still listed as deliberately unset — ` +
          "the measurement that justified leaving it out needs updating too",
      ).not.toContain(option);
    }
  });
});
