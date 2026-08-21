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
import { execFileSync } from "node:child_process";
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
   * The corpus: every TypeScript file THIS REPOSITORY TRACKS.
   *
   * DERIVED, not listed — and the previous version was listed. It walked
   * `["src", "scripts"]`, under a docblock arguing that "the surface has to be
   * as wide as the place the mistake can be made". Two roots is not that: the
   * e2e proof harness lives in `e2e/`, and `e2e/client-proof/artifacts.ts`
   * became the first `getDocument` call site outside those two roots — so the
   * guard that exists to stop a pdfjs asset option from going unset could not
   * see the newest place one is configured. CLAUDE.md rule 4: a right command
   * over the wrong set.
   *
   * `git ls-files` is the derivation because it is a fact that must ALREADY be
   * true — the repository's own answer to "what source do we have". A new
   * top-level directory is covered the day it is committed, generated output
   * (`.next`, `test-results`) is excluded because git already ignores it, and
   * nobody has to remember to widen a list. It is FATAL if git cannot answer:
   * an instrument that silently returns fewer files reports the strongest
   * possible pass.
   */
  const sourceFiles = (): string[] => {
    const listed = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return listed
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && !f.includes(".test."))
      .map((f) => path.join(process.cwd(), f));
  };

  /**
   * The arguments of every `getDocument(...)` call in `source`, matched by
   * counting parentheses rather than by a regex.
   *
   * `getDocument\(([^)]*)\)` stops at the FIRST `)`, so a perfectly ordinary
   * call — `getDocument({ data: new Uint8Array(buf), ...DEFAULTS })` — was read
   * as `{ data: new Uint8Array(buf` and would have been reported as an offender
   * the moment the corpus grew to include one. The matcher was as narrow as the
   * set it had only ever been pointed at, which is the same defect one layer in.
   */
  const getDocumentArgs = (source: string): string[] => {
    const out: string[] = [];
    const needle = "getDocument(";
    let at = source.indexOf(needle);
    while (at !== -1) {
      let depth = 0;
      let i = at + needle.length - 1;
      for (; i < source.length; i++) {
        const ch = source[i];
        if (ch === "(") depth += 1;
        else if (ch === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      out.push(source.slice(at + needle.length, i));
      at = source.indexOf(needle, i);
    }
    return out;
  };

  const relFiles = (): string[] =>
    sourceFiles().map((f) =>
      path.relative(process.cwd(), f).replace(/\\/g, "/"),
    );

  it("HEALTH CHECK: the corpus is the repository, not a directory", () => {
    const files = relFiles();
    expect(
      files.length,
      "git listed implausibly little TypeScript — the corpus collapsed and every " +
        "assertion below would pass over almost nothing",
    ).toBeGreaterThanOrEqual(200);
    // Reach-proof: a call site could legitimately appear in any of these
    // shapes, so the walk must demonstrably reach all of them.
    expect(files).toContain("src/lib/pdf/render.ts");
    expect(
      files.some((f) => f.startsWith("src/components/") && f.endsWith(".tsx")),
    ).toBe(true);
    expect(files.some((f) => f.startsWith("src/lib/workers/"))).toBe(true);
    expect(files.some((f) => f.startsWith("scripts/"))).toBe(true);
    // The directory the previous list could not see.
    expect(
      files.some((f) => f.startsWith("e2e/")),
      "the corpus does not reach e2e/, where the proof harness configures pdfjs",
    ).toBe(true);
  });

  it("reaches EVERY file that calls getDocument, wherever it lives", () => {
    // The property, stated independently of any one root: no file in this
    // repository may call getDocument without the guard seeing it. This is the
    // arm that was red before the corpus was derived —
    // `e2e/client-proof/artifacts.ts` called getDocument and nothing here
    // could reach it.
    const callers = sourceFiles().filter((f) =>
      readFileSync(f, "utf8").includes("getDocument("),
    );
    expect(
      callers.length,
      "no getDocument callers found at all — this guard has stopped reading the engines",
    ).toBeGreaterThan(0);
    const roots = new Set(
      callers.map(
        (f) =>
          path.relative(process.cwd(), f).replace(/\\/g, "/").split("/")[0],
      ),
    );
    expect(
      roots.has("e2e"),
      "no e2e getDocument call site is visible; if the harness stopped opening " +
        "documents this assertion should be revisited deliberately, not deleted",
    ).toBe(true);
    expect(
      roots.size,
      "every call site sits under one root again — the corpus may have narrowed",
    ).toBeGreaterThan(1);
  });

  it("CONTROL: the argument matcher survives a nested call", () => {
    // The regex this replaced stopped at the first `)`, so this exact shape —
    // the one the e2e harness actually uses — read as
    // `{ data: new Uint8Array(buf` and would have been reported as an offender.
    const args = getDocumentArgs(
      "const t = getDocument({ data: new Uint8Array(buf), ...PDFJS_DOCUMENT_DEFAULTS });",
    );
    expect(args).toHaveLength(1);
    expect(args[0]).toContain("PDFJS_DOCUMENT_DEFAULTS");
    // And it still separates two independent calls rather than swallowing both.
    expect(getDocumentArgs("getDocument(a); getDocument(b(c));")).toEqual([
      "a",
      "b(c)",
    ]);
  });

  it("has no getDocument call that builds its own options", () => {
    const offenders: string[] = [];
    let callSites = 0;
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const args of getDocumentArgs(source)) {
        callSites += 1;
        if (!args.includes("PDFJS_DOCUMENT_DEFAULTS")) {
          offenders.push(
            `${rel(file)}: getDocument(${args.trim()}) does not spread ` +
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
