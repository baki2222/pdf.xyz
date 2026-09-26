// @vitest-environment node
/**
 * Two technical claims the in-browser pages made that the runners do not keep.
 *
 * 1. "WITH WEBASSEMBLY". Every in-browser tool's FAQ — shipped as FAQPage
 *    JSON-LD — answered "This tool runs entirely in your browser with
 *    WebAssembly and browser APIs", and so did the capability descriptor, the
 *    home page's security band, /status and eighteen guide sentences. Split,
 *    Merge, JPG to PDF, the form tools and Sign are pdf-lib + JSZip: pure
 *    JavaScript, no wasm module anywhere in their path. The only WebAssembly in
 *    the client is pdf.js's optional decoders (JPEG 2000, JBIG2, ICC), fetched
 *    only when a page's images need one — so even the raster tools do not "run
 *    with WebAssembly" for most files.
 *
 *    EXIT CONDITION (a property, not a mechanism): the word may return for a
 *    tool only when that tool's run INSTANTIATES a WebAssembly module on every
 *    file — shown by a runner test that fails with `WebAssembly` removed from
 *    the global scope. A bundled `.wasm` asset, a `wasmUrl` option or an import
 *    of a wasm-capable library is a mechanism and does not satisfy it.
 *
 * 2. "AS A ZIP". Split PDF's steps said "Download the resulting files as a ZIP",
 *    and its guide said the results "download together as a single ZIP". Every
 *    in-browser runner that can build an archive does so only for MORE THAN ONE
 *    output — `split-runner.tsx` saves a single part as a bare PDF — so a copy
 *    sentence that names the ZIP must say when.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { guides } from "@/lib/guides/catalog";
import type { Guide } from "@/lib/guides/types";
import { flattenForPhraseSearch, withoutComments } from "./copy-surface";
import { howToSteps, toolFacts, toolFaq } from "./tool-facts";
import type { Tool } from "./types";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";

const ROOT = process.cwd();

let pages: Map<string, RenderedToolPage>;
beforeAll(() => {
  pages = renderToolPages();
}, 180_000);

/* ------------------------------------------------------------------ *
 *  1. WebAssembly
 * ------------------------------------------------------------------ */

const WASM_CLAIM = /\bWebAssembly\b/i;

/** Verbatim sentences the product shipped, one per surface kind. */
const SHIPPED_WASM = [
  "No. This tool runs entirely in your browser with WebAssembly and browser APIs — the file stays on your device from start to finish.",
  "Runs entirely on your device with WebAssembly and browser APIs. Files are never uploaded.",
  "Most tools run with WebAssembly on your own device. Those tools never upload your files.",
];

/**
 * Every non-test source file under `src`, walked — the claim sat in five
 * directories, including `components/status`, which no copy-file list named.
 */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
        out.push(full);
    }
  };
  walk(path.join(ROOT, "src"));
  return out;
}

/**
 * Prose, not code: the text inside string and template literals and JSX text,
 * with comments gone. `typeof WebAssembly` in code is not a claim to anyone.
 */
function proseOf(source: string): string {
  const code = withoutComments(source);
  const literals = [
    ...code.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`/g),
  ].map((m) => m[0]);
  // JSX text runs from a tag OR an expression to the next tag or expression.
  // The first version read only `>text<`, and walked straight past /status's
  // `{localTools.length} tool{…} run entirely on your device with
  // WebAssembly…` — text that begins after a `}`. The control below holds it.
  const jsxText = [...code.matchAll(/[>}]([^<>{}]+)[<{]/g)].map((m) => m[1]!);
  return flattenForPhraseSearch([...literals, ...jsxText].join(" "));
}

describe("no page says the in-browser tools run with WebAssembly", () => {
  it("the detector catches every shipped sentence, through the same prose reader", () => {
    for (const sentence of SHIPPED_WASM) {
      expect(WASM_CLAIM.test(proseOf(`const s = "${sentence}";`))).toBe(true);
    }
    // JSX text that starts after an expression, the shape /status shipped.
    expect(
      WASM_CLAIM.test(
        proseOf(
          '<p>\n  {n} tool{n === 1 ? "" : "s"} run\n  entirely on your device with WebAssembly and browser APIs\n</p>',
        ),
      ),
    ).toBe(true);
    // …and ignores code that merely names the global.
    expect(
      WASM_CLAIM.test(proseOf("if (typeof WebAssembly === 'undefined') {}")),
    ).toBe(false);
  });

  it("no source file puts the word in front of a reader", () => {
    const files = sourceFiles();
    expect(files.length, "the walk is implausibly small").toBeGreaterThan(300);
    const offenders = files
      .filter((f) => WASM_CLAIM.test(proseOf(readFileSync(f, "utf8"))))
      .map((f) => path.relative(ROOT, f));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no rendered tool page says it, in its text or its JSON-LD", () => {
    expect(pages.size).toBe(tools.length);
    const offenders = [...pages].flatMap(([slug, page]) =>
      [page.text, ...page.faq.map((e) => e.answer), ...page.howTo]
        .filter((t) => WASM_CLAIM.test(t))
        .map(() => slug),
    );
    expect([...new Set(offenders)]).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  2. ZIP
 * ------------------------------------------------------------------ */

/** A ZIP sentence must say it is the MANY-output case. */
const SAYS_WHEN =
  /\b(?:more than one|two or more|several|multiple|individually|only when|when there (?:is|are) more)\b/i;

/** Verbatim from src/lib/tools/catalog.ts and the split guide at 67e8d0f. */
const SHIPPED_ZIP = [
  "Download the resulting files as a ZIP.",
  "The results download together as a single ZIP, so a split that produces many pieces still arrives as one download instead of a scatter of separate saves.",
  "The results download together as a ZIP so you get everything in one save.",
  "The split runs immediately and the resulting PDFs download together as a ZIP.",
];

const sentences = (text: string) =>
  text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);

const unqualifiedZip = (text: string) =>
  sentences(text).filter((s) => /\bZIP\b/.test(s) && !SAYS_WHEN.test(s));

/** Every string a reader receives about `tool`: its page and its own guides. */
function copyAbout(tool: Tool): string[] {
  const guideStrings = (g: Guide) => [
    g.description,
    ...g.intro,
    ...g.steps,
    ...g.sections.flatMap((s) => s.body),
    ...g.faq.map((f) => f.answer),
  ];
  const page = pages.get(tool.slug)!;
  return [
    tool.description,
    ...howToSteps(tool),
    ...toolFaq(tool).map((e) => e.answer),
    ...toolFacts(tool.slug).map((f) => f.value),
    ...page.howTo,
    ...page.faq.map((e) => e.answer),
    ...guides.filter((g) => g.tools[0] === tool.slug).flatMap(guideStrings),
  ];
}

describe("an in-browser page names the ZIP only for more than one output", () => {
  it("the detector catches every shipped sentence", () => {
    const missed = SHIPPED_ZIP.filter((s) => unqualifiedZip(s).length === 0);
    expect(missed).toEqual([]);
  });

  it("holds for every in-browser tool that can hand over an archive", () => {
    // Subjects: in-browser tools that declare a ZIP output.
    // `output-honesty.test.ts` already derives "runner builds an archive ⇒
    // declares ZIP" from the registry and the runner imports, so this set
    // cannot silently lose a tool whose runner zips.
    const subjects = tools.filter(
      (t) =>
        capabilityForMode(t.processing) === "in-browser" &&
        t.outputs.includes("ZIP"),
    );
    expect(
      subjects.map((t) => t.slug),
      "the archive-capable in-browser set is implausibly small",
    ).toEqual(expect.arrayContaining(["split-pdf"]));
    expect(subjects.length).toBeGreaterThanOrEqual(3);
    const offenders = subjects.flatMap((tool) =>
      copyAbout(tool).flatMap((text) =>
        unqualifiedZip(text).map((s) => `${tool.slug}: "${s}"`),
      ),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
