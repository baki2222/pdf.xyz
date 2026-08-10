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
  PDFJS_DOCUMENT_DEFAULTS,
  PDFJS_WASM_ASSETS,
  PDFJS_WASM_URL,
  PDFJS_WASM_VERSION,
} from "./wasm-assets";

const require = createRequire(import.meta.url);
const PDFJS_PKG = require.resolve("pdfjs-dist/package.json");
const PDFJS_DIR = path.dirname(PDFJS_PKG);

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
  const engineFiles = () =>
    readdirSync(path.join(process.cwd(), "src", "lib", "pdf"))
      .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
      .map((f) => path.join(process.cwd(), "src", "lib", "pdf", f));

  it("scans a meaningful number of engine modules", () => {
    expect(engineFiles().length).toBeGreaterThanOrEqual(10);
  });

  it("has no getDocument call that builds its own options", () => {
    const offenders: string[] = [];
    let callSites = 0;
    for (const file of engineFiles()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/getDocument\(([^)]*)\)/g)) {
        callSites += 1;
        if (!match[1]!.includes("PDFJS_DOCUMENT_DEFAULTS")) {
          offenders.push(
            `${path.basename(file)}: getDocument(${match[1]!.trim()}) does not spread ` +
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
    expect(PDFJS_WASM_URL.endsWith("/")).toBe(true);
    expect(PDFJS_WASM_URL).toContain(PDFJS_WASM_VERSION);
    expect(PDFJS_DOCUMENT_DEFAULTS.wasmUrl).toBe(PDFJS_WASM_URL);
  });
});
