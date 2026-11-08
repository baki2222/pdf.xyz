// @vitest-environment node
/**
 * “Redo existing OCR” says exactly which old text layers it takes away.
 *
 * Until 2026-11-08 every surface said "that text is removed and those pages
 * are recognised again" (OCR PDF's panel, the OCR-first panels) or told the
 * reader to turn Redo on "to replace a poor text layer" (both refusals). The
 * wave-3 production proof then put a scan with a stale invisible layer
 * through PDF to Word with Redo on, and the DOCX held both the scan's words
 * and the stale ones. `--redo-ocr` reached OCRmyPDF; OCRmyPDF 14.0.1 keeps
 * two of the three layer shapes measured, including its own
 * (`REDO_OCR_LAYER_OUTCOMES`). The copy now says the table
 * (`REDO_OCR_SCOPE`), and `pnpm worker:ocr-redo-proof` checks the table
 * against the image's engine.
 *
 * Pinned here:
 *  1. the scope sentence states each row of the table with that row's
 *     outcome — a relationship, so flipping a row without the copy is red;
 *  2. a ban list over the false claim, with its corpus in BOTH directions:
 *     every sentence that shipped is caught by some pattern, and every
 *     pattern catches some sentence that shipped;
 *  3. no source that names the option still makes the claim — the sources
 *     DISCOVERED by walking `src`, not listed, with a floor on their count
 *     and positive controls for the files known to carry the option;
 *  4. the reader's copy, as it is served: every string of every tool page's
 *     content and every guide is walked, and each entry that names the
 *     option and says it takes text away carries the scope sentence, as
 *     does every tool page that names the option at all. Added after review
 *     2026-11-08: a mutant FAQ "Redo removes the old OCR text and reads
 *     those pages again." passed every guard here, because the ban list is
 *     a list (a synonym walks past it) and the scope pin named only the two
 *     panels.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guides } from "@/lib/guides/catalog";
import { toolContent } from "@/lib/tools/content";
import {
  REDO_OCR_LAYER_OUTCOMES,
  REDO_OCR_SCOPE,
  type RedoOcrLayerShape,
} from "./ocr";

/**
 * What the reader is told each shape is called. A total record over the
 * table's shapes, so a new row does not compile until it has a name here
 * (and so a place in the sentence).
 */
const READER_NAME: Record<RedoOcrLayerShape, string> = {
  tesseract: "the way Tesseract writes it",
  ocrmypdf: "A layer added by OCRmyPDF",
  "mode-before-text": "Other hidden text",
};

const sentences = (text: string) =>
  text.split(/(?<=\.)\s+/).filter((s) => s.length > 0);

describe("REDO_OCR_SCOPE states REDO_OCR_LAYER_OUTCOMES", () => {
  it("health check: three sentences, one per row", () => {
    expect(sentences(REDO_OCR_SCOPE)).toHaveLength(
      Object.keys(REDO_OCR_LAYER_OUTCOMES).length,
    );
  });

  it.each(Object.entries(REDO_OCR_LAYER_OUTCOMES))(
    "the %s row (%s) is said with its outcome",
    (shape, outcome) => {
      const name = READER_NAME[shape as RedoOcrLayerShape];
      const sentence = sentences(REDO_OCR_SCOPE).find((s) => s.includes(name));
      expect(sentence, `no sentence names ${name}`).toBeDefined();
      if (outcome === "replaced") {
        expect(sentence).toMatch(/\breplaces\b/);
        expect(sentence).not.toMatch(/\bkept\b/);
      } else {
        expect(sentence).toMatch(/\bkept\b/);
        expect(sentence).not.toMatch(/\breplace/);
      }
    },
  );

  it("it names its subject, so it reads right after any sentence", () => {
    // Review 2026-11-08: an opening "It replaces…" sat after "text typed into
    // the document is kept either way" in OCR PDF's FAQ, and read as if the
    // typed text did the replacing.
    expect(REDO_OCR_SCOPE).toMatch(/^Redo replaces\b/);
  });

  it("the kept OCRmyPDF layer is said to stay BESIDE the new text, not instead of it", () => {
    expect(REDO_OCR_SCOPE).toMatch(/new text is added beside it/);
  });
});

/**
 * The false claim: the option takes away an old OCR layer, said of every
 * layer. Each pattern carries the sentence shape it was written for.
 */
const BAN: readonly { name: string; pattern: RegExp }[] = [
  {
    name: "'that text is removed' (the panels' hint)",
    pattern: /that\s+text\s+is\s+removed/i,
  },
  {
    name: "'to replace a poor text layer' (the refusals)",
    pattern: /Redo existing OCR[”"]?\s+to\s+replace\b/i,
  },
  {
    name: "'strips invisible OCR text' (the option's docblock)",
    pattern: /strips\s+invisible\s+OCR\s+text/i,
  },
  {
    name: "'invisible OCR text is replaced' (the argv docblock)",
    pattern: /invisible\s+OCR\s+text\s+is\s+replaced/i,
  },
  {
    // Found by review 2026-11-08: the opening line of the same docblock the
    // fix corrected lower down, missed because no pattern had its shape.
    name: "'Replace a PDF's existing OCR text layer' (the option's docblock, line 1)",
    pattern: /replace\s+(?:a\s+PDF['’]s\s+)?existing\s+OCR\s+text\s+layer/i,
  },
];

/** Every sentence that shipped with the claim, verbatim from git history. */
const SHIPPED: readonly string[] = [
  "For a PDF whose earlier OCR text is poor: that text is removed and those pages are recognised again. Text typed into the document is kept. Not with Straighten crooked pages.",
  "Turn this on when a PDF's existing OCR text is poor: that text is removed and those pages are recognized again. Text typed into the document is kept either way. PDFs only.",
  "This PDF already has a text layer, and the OCR engine would not add a second one. Turn on “Redo existing OCR” to replace a poor text layer. Nothing was processed.",
  "This PDF already has a text layer, and the OCR engine would not add a second one. Turn on “Redo existing OCR” to replace a poor text layer, or turn off “Recognise text in scans (OCR)” to convert the text it has. Nothing was converted.",
  "Turning it on strips invisible OCR text and recognizes those pages again, while text typed into the document itself is kept.",
  "or `--redo-ocr` (the opt-in: invisible OCR text is replaced, typed text is kept) is always passed.",
  "Replace a PDF's existing OCR text layer instead of keeping it (OCRmyPDF `--redo-ocr`). Off by default.",
];

const banned = (text: string) =>
  BAN.filter((b) => b.pattern.test(text.replace(/\s+/g, " "))).map(
    (b) => b.name,
  );

describe("the ban list and its corpus", () => {
  it("every sentence that shipped is caught", () => {
    for (const s of SHIPPED) expect(banned(s), s).not.toEqual([]);
  });

  it("every pattern catches a sentence that shipped", () => {
    for (const b of BAN)
      expect(
        SHIPPED.some((s) => b.pattern.test(s)),
        b.name,
      ).toBe(true);
  });

  it("the copy that replaced them is not caught", () => {
    expect(banned(REDO_OCR_SCOPE)).toEqual([]);
    expect(
      banned(
        "Turn on “Redo existing OCR” to have its pages read again. Nothing was processed.",
      ),
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  The sources, discovered
 * ------------------------------------------------------------------ */

const SRC = path.join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
      out.push(full);
  }
  return out;
}

/** Every non-test source that names the option or its flag. */
const SOURCES = walk(SRC)
  .map((file) => ({
    rel: path.relative(process.cwd(), file).split(path.sep).join("/"),
    text: readFileSync(file, "utf8"),
  }))
  .filter(({ text }) => /Redo existing OCR|redo-ocr|redoOcr/.test(text));

/**
 * Where `text` still makes the claim. Comments count: a docblock is where
 * the next author learns what the option does. The file is searched with
 * comment markers and line breaks folded to spaces, since a phrase search
 * misses every wrap. A history note that QUOTES the old claim is dated or
 * marked CHANGED within the 200 characters before it.
 */
function offendersIn(rel: string, text: string): string[] {
  const flat = text
    .replace(/^\s*(?:\/\/|\/\*\*?|\*\/?)\s?/gm, " ")
    .replace(/\s+/g, " ");
  return BAN.flatMap(({ name, pattern }) =>
    [...flat.matchAll(new RegExp(pattern.source, "gi"))]
      .filter(
        (m) =>
          !/CHANGED|until 20\d\d|20\d\d-\d\d-\d\d/i.test(
            flat.slice(Math.max(0, m.index - 200), m.index),
          ),
      )
      .map(() => `${rel}: ${name}`),
  );
}

describe("no source that names the option makes the claim", () => {
  it("health check: the walk found the option where it is known to be", () => {
    const rels = SOURCES.map((s) => s.rel);
    for (const known of [
      "src/components/tools/ocr-first-switch.tsx",
      "src/components/tools/ocr-worker-panel.tsx",
      "src/lib/workers/ocr-engine-errors.ts",
      "src/lib/workers/processor/ocr-first.ts",
      "src/lib/workers/ocr-native.ts",
      "src/lib/jobs/ocr.ts",
      "src/lib/tools/content/pdf-to-word.ts",
      "src/lib/tools/content/ocr-pdf.ts",
    ])
      expect(rels).toContain(known);
    // A floor and a ceiling: a walk that shrank, or one that matched every
    // file, would both report a pass.
    expect(rels.length).toBeGreaterThanOrEqual(15);
    expect(rels.length).toBeLessThan(120);
  });

  it("the two panels show the scope sentence itself", () => {
    for (const rel of [
      "src/components/tools/ocr-first-switch.tsx",
      "src/components/tools/ocr-worker-panel.tsx",
    ])
      expect(SOURCES.find((s) => s.rel === rel)!.text, rel).toMatch(
        /\{REDO_OCR_SCOPE\}/,
      );
  });

  it("none still says it, even where a line break splits the phrase", () => {
    expect(SOURCES.flatMap(({ rel, text }) => offendersIn(rel, text))).toEqual(
      [],
    );
  });

  it("positive controls: a claim split across comment lines is seen, and only a dated note is exempt", () => {
    const split =
      "/**\n * For a PDF: that text\n * is removed and read again.\n */";
    expect(offendersIn("x.ts", split)).toHaveLength(1);
    const jsx =
      "<span>\n  Turn on “Redo existing OCR”\n  to replace it.\n</span>";
    expect(offendersIn("x.tsx", jsx)).toHaveLength(1);
    const dated = `// CHANGED 2026-11-08: it said "that text\n// is removed".`;
    expect(offendersIn("x.ts", dated)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  The reader's copy, as served: tool pages and guides
 * ------------------------------------------------------------------ */

interface Entry {
  /** `tool:<slug>` or `guide:<slug>`, then the path to the string. */
  where: string;
  /** The tool page this string is on, when it is on one. */
  tool?: string;
  text: string;
}

function leaves(
  value: unknown,
  where: string,
  tool: string | undefined,
  out: Entry[],
): Entry[] {
  if (typeof value === "string") out.push({ where, tool, text: value });
  else if (Array.isArray(value))
    value.forEach((v, i) => leaves(v, `${where}[${i}]`, tool, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value))
      leaves(v, `${where}.${k}`, tool, out);
  return out;
}

const ENTRIES: Entry[] = [
  ...Object.entries(toolContent).flatMap(([slug, content]) =>
    leaves(content, `tool:${slug}`, slug, []),
  ),
  ...guides.flatMap((guide) =>
    leaves(guide, `guide:${guide.slug}`, undefined, []),
  ),
];

const NAMES_OPTION = /Redo existing OCR/;
/** Any verb of taking text away: the claim, in whatever words. */
const TAKES_AWAY =
  /\b(?:remov|replac|strip|delet|discard|eras|wip|clear|clean|drop|throw)\w*/i;
const fold = (text: string) => text.replace(/\s+/g, " ").toLowerCase();
const hasScope = (text: string) => fold(text).includes(fold(REDO_OCR_SCOPE));

/** Where the reader's copy describes the option without its scope. */
function unscoped(entries: readonly Entry[]): string[] {
  const naming = entries.filter((e) => NAMES_OPTION.test(e.text));
  const perEntry = naming
    .filter((e) => TAKES_AWAY.test(e.text) && !hasScope(e.text))
    .map((e) => `${e.where}: says what it takes away, without the scope`);
  const tools = [...new Set(naming.flatMap((e) => (e.tool ? [e.tool] : [])))];
  const perTool = tools
    .filter((tool) => !entries.some((e) => e.tool === tool && hasScope(e.text)))
    .map((tool) => `tool:${tool}: names the option, never its scope`);
  return [...perEntry, ...perTool];
}

describe("the reader's copy states the scope wherever it names the option", () => {
  it("health check: the walk reached the served copy, and the option in it", () => {
    expect(ENTRIES.length).toBeGreaterThan(2000);
    expect(ENTRIES.length).toBeLessThan(50000);
    const naming = ENTRIES.filter((e) => NAMES_OPTION.test(e.text));
    expect(naming.length).toBeGreaterThanOrEqual(6);
    const tools = new Set(naming.map((e) => e.tool));
    expect(tools).toContain("ocr-pdf");
    expect(tools).toContain("pdf-to-word");
    // and a guide, so the guide half of the walk is not blind
    expect(naming.some((e) => e.where.startsWith("guide:"))).toBe(true);
  });

  it("every entry and every tool page that names the option carries the scope sentence", () => {
    expect(unscoped(ENTRIES)).toEqual([]);
  });

  it("positive control: the review's mutant FAQ is seen, twice over", () => {
    const faq = ENTRIES.find((e) => e.where === "tool:pdf-to-word.faqs[2].a");
    expect(faq && hasScope(faq.text)).toBe(true);
    const mutant = ENTRIES.map((e) =>
      e === faq
        ? {
            ...e,
            text: e.text.replace(
              REDO_OCR_SCOPE,
              "Redo removes the old OCR text and reads those pages again.",
            ),
          }
        : e,
    );
    expect(mutant).not.toEqual(ENTRIES);
    expect(unscoped(mutant)).toEqual([
      "tool:pdf-to-word.faqs[2].a: says what it takes away, without the scope",
      "tool:pdf-to-word: names the option, never its scope",
    ]);
  });

  it("positive control: the scope in other case or wrapping counts; a bare mention needs none; a synonym is seen", () => {
    const lower =
      REDO_OCR_SCOPE.charAt(0).toLowerCase() + REDO_OCR_SCOPE.slice(1);
    expect(hasScope(`Redo existing OCR: ${lower.replace(/ /g, "\n ")}`)).toBe(
      true,
    );
    expect(
      unscoped([
        {
          where: "guide:x",
          text: "It cannot be combined with “Redo existing OCR”.",
        },
      ]),
    ).toEqual([]);
    expect(
      unscoped([
        {
          where: "guide:x",
          text: "“Redo existing OCR” wipes the earlier text first.",
        },
      ]),
    ).toEqual(["guide:x: says what it takes away, without the scope"]);
  });
});
