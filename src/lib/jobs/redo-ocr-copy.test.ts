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
 * CHANGED later on 2026-11-08: the worker now takes every invisible text
 * layer out before OCRmyPDF runs (src/lib/workers/strip-invisible-text.ts),
 * every row of the table is "replaced", and the scope sentence says so. The
 * #290 sentences that said OCRmyPDF's layer "is kept, and the new text is
 * added beside it" went false the same day; they joined the ban list below,
 * with their corpus, and the test that pinned "beside" is inverted.
 *
 * CHANGED again before merge (review 2026-11-08): the first rewrite said
 * Redo replaces hidden text "whichever way it was stored … or other hidden
 * text", and this guard let it through: the `mode-before-text` row was
 * given the reader name "other hidden text", so ONE measured shape licensed
 * a claim about every shape (CLAUDE.md rule 2), and the ban on "hidden text
 * may be kept" forbade the honest qualifier. Now each row has a name that
 * describes its own shape, the scope must carry the qualifier, the ban on
 * the qualifier is lifted, and the universal phrase is banned instead.
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
  ocrmypdf: "a layer added by OCRmyPDF",
  // CHANGED 2026-11-08: was "other hidden text", a name for every shape.
  "mode-before-text":
    "made invisible by a setting placed before the text block",
};

/**
 * The table lists the shapes MEASURED, not every way hidden text can be
 * stored, and the pre-pass leaves some by design (its docblock lists them).
 * So the scope must say, in a sentence of its own that names no row, that
 * other hidden text may be kept.
 */
const QUALIFIER = /\bhidden text stored some other way may be kept\b/i;

const sentences = (text: string) =>
  text.split(/(?<=\.)\s+/).filter((s) => s.length > 0);

describe("REDO_OCR_SCOPE states REDO_OCR_LAYER_OUTCOMES", () => {
  it("health check: every row's name is in the scope exactly once, and no sentence is spare", () => {
    // CHANGED 2026-11-08: "three sentences, one per row". With every row
    // "replaced" one sentence names all three; the relationship below is
    // per row either way. The one sentence that names no row is the
    // qualifier, pinned next.
    for (const name of Object.values(READER_NAME))
      expect(REDO_OCR_SCOPE.split(name).length - 1, name).toBe(1);
    const all = sentences(REDO_OCR_SCOPE);
    const naming = all.filter((sentence) =>
      Object.values(READER_NAME).some((name) => sentence.includes(name)),
    );
    expect(naming.length).toBeGreaterThanOrEqual(1);
    expect(naming.length).toBeLessThanOrEqual(
      Object.keys(REDO_OCR_LAYER_OUTCOMES).length,
    );
    expect(all.filter((s) => !naming.includes(s))).toEqual(
      all.filter((s) => QUALIFIER.test(s)),
    );
  });

  it("says, in a sentence naming no row, that hidden text stored some other way may be kept", () => {
    const qualifiers = sentences(REDO_OCR_SCOPE).filter((s) =>
      QUALIFIER.test(s),
    );
    expect(qualifiers).toHaveLength(1);
    for (const name of Object.values(READER_NAME))
      expect(qualifiers[0], name).not.toContain(name);
  });

  it("no reader name stands for every shape: each describes one", () => {
    // Rule 2: the name is what the row's measurement licenses. A catch-all
    // ("other hidden text", "any hidden text") would let one row speak for
    // shapes nobody measured.
    for (const [shape, name] of Object.entries(READER_NAME))
      expect(name, shape).not.toMatch(
        /\b(?:other|any|all|every|whatever|whichever)\b/i,
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
        expect(sentence).not.toMatch(/\bkept\b|\bbeside\b/);
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

  // INVERTED 2026-11-08: this pinned "new text is added beside it", true
  // while OCRmyPDF kept its own layer. The worker's pre-pass removes it, so
  // saying "beside" would now be the false claim.
  it("the OCRmyPDF layer is no longer said to stay beside the new text", () => {
    expect(REDO_OCR_LAYER_OUTCOMES.ocrmypdf).toBe("replaced");
    expect(REDO_OCR_SCOPE).not.toMatch(/beside/);
    const sentence = sentences(REDO_OCR_SCOPE).find((s) =>
      s.includes(READER_NAME.ocrmypdf),
    );
    expect(sentence).not.toMatch(/\bkept\b/);
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
  // The opposite claim, false since the worker's pre-pass (2026-11-08):
  // that an earlier layer survives Redo. #290 shipped these, true that day.
  {
    name: "'is kept, and the new text is added beside it' (the #290 scope)",
    pattern: /\bkept,?\s+and\s+the\s+new\s+text\s+is\s+added\s+beside\b/i,
  },
  // LIFTED 2026-11-08 (review): "'Other hidden text may be kept' (the #290
  // scope)", /hidden\s+text\s+may\s+be\s+kept/. It is still TRUE, and the
  // ban pushed the copy toward claiming every hidden text was replaced.
  {
    // The pre-pass's first draft of the scope, committed on its branch and
    // never served: a universal claim from three measured shapes.
    name: "'whichever way it was stored' (the pre-pass's first scope)",
    pattern: /whichever\s+way\s+it\s+was\s+stored/i,
  },
  {
    name: "'takes away only the old layers OCRmyPDF can detect' (the option's docblock, #290)",
    pattern:
      /takes\s+away\s+only\s+the\s+old\s+layers\s+OCRmyPDF\s+can\s+detect/i,
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
  "Redo replaces hidden OCR text written the way Tesseract writes it. A layer added by OCRmyPDF, the engine our OCR PDF uses on PDFs, is kept, and the new text is added beside it. Other hidden text may be kept as well.",
  "Turning it on recognizes the pages with hidden OCR text again; it takes away only the old layers OCRmyPDF can detect, which is NOT the layer OCRmyPDF itself adds.",
  // Committed (0e57989b) and caught by review before merge; never served.
  "Redo replaces the hidden text already in the PDF, whichever way it was stored: text written the way Tesseract writes it, a layer added by OCRmyPDF (the engine our OCR PDF uses on PDFs), or other hidden text.",
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
