// @vitest-environment node
/**
 * What a tool page tells a reader to DO, and what it says the result IS, held
 * to the runner that does it and the engine that makes it.
 *
 * Audited at 67e8d0f, 39 of the 50 tool pages served the same default HowTo —
 * "Open the tool and pick your … file", "Choose your options.", "Run the tool
 * in your browser.", "Save the result to your device." — as JSON-LD and as the
 * visible "How it works". "Choose your options." was false on most of them:
 * Text to PDF, PNG to PDF, Delete Pages and Markdown to PDF have no options at
 * all, and "pick your file" (singular) described the two multi-image
 * converters. The pages under it carried two or three templated FAQs and
 * nothing a person searching "rotate pdf" or "pdf to png" came to find.
 *
 * Adding copy is the easy half; the defect this product keeps paying for is
 * copy that describes a UI or a result the code does not have. JPG to PDF's
 * catalogue entry and guide promised "control over orientation, margins, and
 * page size" for the life of the product, over an engine with a fixed US Letter
 * page. PDF to PNG promised "a transparent or white background" over a
 * renderer that always paints white. So every new sentence below is pinned:
 *
 *  - labels a step or answer quotes (“Apply rotation”) must exist in the
 *    runner the tool mounts — resolved slug → registry → dispatcher → module;
 *  - facts about the output are checked by RUNNING the engine the runner calls;
 *  - a ban on the two false promises, with the shipped sentences as corpus and
 *    a precondition that reads the runner (lift the ban by building the control).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFTextField,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import {
  STRUCTURED_FIELD_NAME,
  STRUCTURED_FIELD_VALUE,
  addDocumentStructure,
} from "@/tests/fixtures-structured-pdf";
import { tools } from "@/lib/tools";
import type { Tool } from "./types";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { getRunnerKind } from "@/lib/pdf/registry";
import {
  deletePages,
  extractPages,
  mergePdfs,
  organizePages,
  setPageRotations,
  splitPdf,
} from "@/lib/pdf/engine";
import { imagesToPdf, unsupportedImageMessage } from "@/lib/pdf/image-to-pdf";
import { MAX_IMAGE_MB } from "@/lib/tools/limits";
import { parseMarkdownBlocks } from "@/lib/pdf/markdown-to-pdf";
import { MARKDOWN_BLOCK_KINDS } from "@/lib/pdf/markdown-blocks";
import {
  IMAGE_PAGE_MARGIN_PT,
  US_LETTER_LABEL,
  US_LETTER_PT,
  inches,
} from "@/lib/pdf/page-geometry";
import {
  RASTER_MAX_DEVICE_PX,
  RASTER_PREVIEW_LIMIT,
  RASTER_RESOLUTIONS,
} from "@/lib/pdf/pdf-to-image";
import { parsePageList } from "@/lib/pdf/ranges";
import { guides } from "@/lib/guides/catalog";
import { withoutComments } from "./copy-surface";
import { pageIntro } from "./page-copy";
import {
  DOCUMENT_PARTS,
  EVERY_OTHER_PAGE_EXAMPLE,
  PAGE_TOOL_CARRIES,
  howToSteps,
  pageToolKeepsAnswer,
  toolFacts,
  toolFaq,
  type DocumentPart,
} from "./tool-facts";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

let pages: Map<string, RenderedToolPage>;
beforeAll(() => {
  pages = renderToolPages();
}, 180_000);

const page = (slug: string) => {
  const p = pages.get(slug);
  if (!p) throw new Error(`no rendered page for ${slug}`);
  return p;
};

const inBrowser = () =>
  tools.filter((t) => capabilityForMode(t.processing) === "in-browser");

/* ------------------------------------------------------------------ *
 *  Runner source, resolved the way the page mounts it
 * ------------------------------------------------------------------ */

const RUNNER_DIR = "src/components/tools/runner";

/**
 * slug → the runner module's source, plus the sources of its local value
 * imports one level down (a label can live in a shared section component).
 * Resolved through the registry and the dispatcher's own `case` arms, so a
 * renamed runner moves the check with it; an unresolvable slug is FATAL.
 */
function runnerSource(slug: string): string {
  const kind = getRunnerKind(slug);
  if (!kind) throw new Error(`${slug} mounts no runner`);
  const dispatch = read(`${RUNNER_DIR}/tool-runner.tsx`);
  const arm = new RegExp(
    `case\\s+"${kind}":[\\s\\S]{0,200}?<([A-Z][A-Za-z]*)`,
  ).exec(dispatch);
  if (!arm) throw new Error(`no dispatcher arm renders kind "${kind}"`);
  const component = arm[1]!;
  const imp = new RegExp(
    `import\\s+\\{[^}]*\\b${component}\\b[^}]*\\}\\s+from\\s+"\\./([^"]+)"`,
  ).exec(dispatch);
  if (!imp) throw new Error(`no import resolves ${component}`);
  const main = read(`${RUNNER_DIR}/${imp[1]}.tsx`);
  const nested = [
    ...main.matchAll(/import\s+\{[^}]*\}\s+from\s+"\.\/([^"]+)"/g),
  ].flatMap((m) => {
    for (const ext of [".tsx", ".ts"]) {
      try {
        return [read(`${RUNNER_DIR}/${m[1]}${ext}`)];
      } catch {
        /* try the next extension */
      }
    }
    return [];
  });
  return [main, ...nested]
    .join("\n")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'");
}

/** Every “quoted label” in a string. */
const quotedLabels = (text: string) =>
  [...text.matchAll(/“([^”]+)”/g)].map((m) => m[1]!);

/* ------------------------------------------------------------------ *
 *  1. Steps: no generic options step, and the default set only shrinks
 * ------------------------------------------------------------------ */

/** The generic step, verbatim as it shipped on 39 pages. */
const SHIPPED_GENERIC_STEPS = ["Choose your options."];
const GENERIC_OPTIONS_STEP = /^\s*choose (?:your|the) options\.?\s*$/i;

/**
 * In-browser tools that still render the default steps. It may only SHRINK:
 * an entry whose tool gains authored steps must be removed (the second test
 * fails until it is), and a tool may not join it (the first fails).
 *
 * SHRUNK 2026-09-27 at the merge with L05, which gave seven of these their
 * own steps: pdf-to-markdown, pdf-to-text, header-footer and compare-pdf as
 * authored `how`, grayscale-pdf, page-numbers and overlay-pdf as DERIVED_STEPS
 * built from their runners' constants.
 *
 * EMPTIED 2026-09-28 at the seo/content merge: the authored content gave the
 * last four (extract-pages, watermark-pdf, fill-forms, create-forms) steps of
 * their own. It stays, empty, so a tool that falls back to the template again
 * fails the test above by name.
 */
const DEFAULT_STEPS_BASELINE = new Set<string>([]);

/**
 * The template, as a tool with NO steps of its own would get it. The slug is
 * one no table can key: L05's DERIVED_STEPS are keyed by slug, so stripping
 * `how` alone still returned grayscale's own steps, and the detector read
 * three tool-specific HowTos as the template.
 */
const TEMPLATE_SLUG = "⟦template⟧";
const rendersDefaultSteps = (tool: Tool) =>
  JSON.stringify(page(tool.slug).howTo) ===
  JSON.stringify(howToSteps({ ...tool, slug: TEMPLATE_SLUG, how: undefined }));

describe("How it works says what the runner does", () => {
  it("the generic options step is caught by its detector, and served on no page", () => {
    for (const s of SHIPPED_GENERIC_STEPS)
      expect(GENERIC_OPTIONS_STEP.test(s)).toBe(true);
    expect(pages.size).toBe(tools.length);
    const offenders = [...pages].flatMap(([slug, p]) =>
      p.howTo.filter((s) => GENERIC_OPTIONS_STEP.test(s)).map(() => slug),
    );
    expect(offenders).toEqual([]);
  });

  it("no in-browser tool joins the default-steps baseline", () => {
    const now = inBrowser().filter(rendersDefaultSteps);
    // Positive control THROUGH the detector: a tool with authored steps,
    // stripped of them, must read as default.
    const rotate = tools.find((t) => t.slug === "rotate-pdf")!;
    expect(JSON.stringify(howToSteps({ ...rotate, how: undefined }))).not.toBe(
      JSON.stringify(page("rotate-pdf").howTo),
    );
    const joined = now
      .map((t) => t.slug)
      .filter((slug) => !DEFAULT_STEPS_BASELINE.has(slug));
    expect(
      joined,
      "these in-browser pages serve the generic steps — give them `how`",
    ).toEqual([]);
  });

  it("the baseline only shrinks", () => {
    const stale = [...DEFAULT_STEPS_BASELINE].filter((slug) => {
      const tool = tools.find((t) => t.slug === slug);
      return !tool || !rendersDefaultSteps(tool);
    });
    expect(stale, "these now have authored steps — drop them").toEqual([]);
  });

  it("every label a step or answer quotes exists in the runner it mounts", () => {
    let checked = 0;
    const missing: string[] = [];
    for (const tool of inBrowser()) {
      if (!getRunnerKind(tool.slug)) continue;
      const source = runnerSource(tool.slug);
      const texts = [
        ...page(tool.slug).howTo,
        ...page(tool.slug).faq.map((e) => e.answer),
      ];
      for (const label of texts.flatMap(quotedLabels)) {
        checked += 1;
        if (!source.includes(label)) missing.push(`${tool.slug}: “${label}”`);
      }
    }
    expect(
      checked,
      "implausibly few quoted labels were checked",
    ).toBeGreaterThan(20);
    expect(missing, missing.join("\n")).toEqual([]);
    // Positive control, through the same resolver.
    expect(runnerSource("rotate-pdf").includes("Rotate to landscape")).toBe(
      false,
    );
  });
});

/* ------------------------------------------------------------------ *
 *  2. The page tools: what an export keeps, run through the engine
 * ------------------------------------------------------------------ */

/**
 * A three-page PDF with drawn text and the document-level parts a real file
 * has: a bookmark that opens page 1, a filled form field on page 1, a title
 * and author, page labels, a language, accessibility tags and an attached file.
 *
 * CHANGED 2026-10-06 (history kept). This fixture's outline used to be an
 * empty `{Type: Outlines, Count: 0}` with no items and no title. The page
 * assembler (`document-structure.ts`) does not write an outline with nothing
 * in it, so every engine read as `outline: false` and the bookmarks answer
 * "No" passed for every engine — while every one of them, run on a file with
 * a REAL bookmark, carried it. A fixture with nothing to lose cannot see what
 * is kept, either.
 */
async function richPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i += 1) {
    const p = doc.addPage([300, 400]);
    p.drawText(`Page ${i}`, { x: 20, y: 350, size: 18, font });
  }
  await addDocumentStructure(doc);
  await doc.attach(new TextEncoder().encode("notes"), "notes.txt", {
    mimeType: "text/plain",
  });
  return doc.save();
}

/**
 * Which of the source's document-level parts `bytes` still carries, read off
 * the output (the source's own values, not merely the keys, for the ones a
 * reader sees).
 */
async function keepsDocumentParts(
  bytes: Uint8Array,
  sourceBytes: Uint8Array,
): Promise<Record<DocumentPart, boolean>> {
  const src = await PDFDocument.load(sourceBytes);
  const doc = await PDFDocument.load(bytes);
  const catalog = doc.catalog;
  const outlines = catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  // Read BEFORE getForm(): pdf-lib creates an /AcroForm on a file without one.
  const hasForm = catalog.has(PDFName.of("AcroForm"));
  const field = hasForm
    ? doc
        .getForm()
        .getFields()
        .find((f) => f.getName() === STRUCTURED_FIELD_NAME)
    : undefined;
  const text = (d: PDFDocument, key: string) =>
    String(d.catalog.lookup(PDFName.of(key)) ?? "");
  return {
    bookmarks: outlines?.has(PDFName.of("First")) === true,
    form:
      field instanceof PDFTextField &&
      field.getText() === STRUCTURED_FIELD_VALUE,
    titleAuthor:
      src.getTitle() !== undefined &&
      doc.getTitle() === src.getTitle() &&
      doc.getAuthor() === src.getAuthor(),
    pageLabels: catalog.has(PDFName.of("PageLabels")),
    language:
      text(src, "Lang") !== "" && text(doc, "Lang") === text(src, "Lang"),
    attachments: names?.has(PDFName.of("EmbeddedFiles")) === true,
    tags: catalog.has(PDFName.of("StructTreeRoot")),
  };
}

function contentBytes(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  return streams
    .map((s) =>
      s instanceof PDFRawStream
        ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")
        : "",
    )
    .join("\n");
}

/** The engine each page runner calls to build its download. */
const ENGINE_FOR_RUNNER: Record<
  string,
  {
    call: string;
    run: (bytes: Uint8Array) => Promise<Uint8Array>;
    /** The same engine on a plan that only turns pages, for a runner whose
     * page says such a plan is saved in place. */
    inPlace?: (bytes: Uint8Array) => Promise<Uint8Array>;
  }
> = {
  organize: {
    call: "organizePages(",
    run: (b) =>
      organizePages(b, [
        { sourceIndex: 2, rotation: 0 },
        { sourceIndex: 0, rotation: 90 },
      ]),
    inPlace: (b) =>
      organizePages(b, [
        { sourceIndex: 0, rotation: 90 },
        { sourceIndex: 1, rotation: 0 },
        { sourceIndex: 2, rotation: 180 },
      ]),
  },
  "delete-pages": { call: "deletePages(", run: (b) => deletePages(b, [1]) },
  // Added with the merge, split and extract answers: their bookmarks question
  // is discovered by the test below, which fails for a runner not mapped here.
  merge: { call: "mergePdfs(", run: (b) => mergePdfs([b, b]) },
  split: {
    call: "splitPdf(",
    run: async (b) =>
      (await splitPdf(b, [{ name: "part.pdf", indices: [0, 1] }]))[0]!.bytes,
  },
  "extract-pages": {
    call: "extractPages(",
    run: (b) => extractPages(b, [0, 2]),
  },
  // Since L08 (0045616) the rotate runner turns the pages of the document it
  // loaded instead of rebuilding it through organizePages, which dropped the
  // outline, the form, the title and the language. This entry followed it:
  // the check below reads the call from the runner, so a runner that went
  // back to rebuilding would fail on the call, not pass on a stale mapping.
  rotate: {
    call: "setPageRotations(",
    run: (b) => setPageRotations(b, [90, 0, 0]),
  },
};

/** Every answer the derived bookmarks question can give, by what it claims. */
const PAGE_TOOL_ANSWER_CHOICES = (
  Object.keys(PAGE_TOOL_CARRIES) as (keyof typeof PAGE_TOOL_CARRIES)[]
).flatMap((state) =>
  [false, true].map((inPlaceWhenOnlyTurned) => ({
    state,
    inPlaceWhenOnlyTurned,
    answer: pageToolKeepsAnswer(state, { inPlaceWhenOnlyTurned }),
  })),
);

/** Every part, kept — what a file saved in place must still have. */
const ALL_KEPT = Object.fromEntries(
  DOCUMENT_PARTS.map((part) => [part, true]),
) as Record<DocumentPart, boolean>;

/**
 * Served sentences that said a page tool drops a part its engine keeps,
 * verbatim at e89479e — the authored intros and FAQ of all six page tools,
 * and the derived answer (`PAGE_REBUILD_KEEPS`) on five pages and the
 * Delete Pages guide. Wave 1's L01/L08 engines made every one false: the
 * subset tools carry bookmarks, the kept pages' form, title and author, page
 * labels and language; Merge carries every file's bookmarks and form; Rotate
 * saves in place. Nothing went red, because this file's only check of them
 * read a fixture with no bookmark in it.
 */
const SHIPPED_LOSS: readonly { slug: string; sentence: string }[] = [
  {
    slug: "rotate-pdf",
    sentence:
      "One trade-off: the rotated copy is rebuilt from the pages alone.",
  },
  {
    slug: "rotate-pdf",
    sentence:
      "Web links and comments stay on their pages, but bookmarks, the document's title and author properties, and the form definition that makes fields fillable are left behind.",
  },
  {
    slug: "rotate-pdf",
    sentence:
      "Document-level items are not: bookmarks, the title and author, page labels such as i, ii, iii, attached files, the accessibility tags of a tagged PDF, and the form structure; the copy lists pdf.xyz as its producer.",
  },
  {
    slug: "merge-pdf",
    sentence:
      "What belongs to a document rather than to its pages does not come along: the bookmarks panel, the title and author fields, and the form definition.",
  },
  {
    slug: "split-pdf",
    sentence:
      "What belongs to the document rather than to a page stays behind: the pieces carry no bookmarks, no title or author entry and no AcroForm.",
  },
  {
    slug: "extract-pages",
    sentence:
      "Document-level parts such as bookmarks, the form definition behind fillable fields, and the original title and author properties do not come across with the pages.",
  },
  {
    slug: "remove-pages",
    sentence:
      "Document-wide extras such as bookmarks do not, and any encrypted PDF is refused until it has been unlocked, including a file your viewer shows with no password prompt.",
  },
  {
    slug: "organize-pages",
    sentence:
      "What belongs to the file as a whole stays behind, including the bookmark tree and the form dictionary that fillable fields depend on.",
  },
  {
    slug: "remove-pages",
    sentence:
      "The pages themselves — text, images and drawings — are copied as they are, but the export is rebuilt from the pages alone, so the document's bookmarks and its fillable form are not carried over.",
  },
];

/** A sentence that says something does not reach the export. */
const LOSS = [
  /\bleft behind\b/i,
  /\b(?:items|parts|extras)\b[^.;:]*?\b(?:are|do|does) not\b/i,
  /\bdo(?:es)? not come (?:along|across)\b/i,
  /\bstays? behind\b/i,
  /\bcarr(?:y|ies) no\b/i,
  /\bnot carried\b/i,
];

/** "Rebuilt from the pages alone" denies EVERY document-level part at once. */
const LOSS_OF_EVERYTHING = /\b(?:re)?built from the pages alone\b/i;

/**
 * The one loss a subset export makes of a part it otherwise keeps: a bookmark
 * that opens only a page the reader left out. A sentence that says so is
 * true, and is not read as a claim about the part as a whole.
 */
const ONLY_PAGES_LEFT_OUT =
  /\bpages? you (?:left out|leave out|removed|remove|dropped|did not keep)\b/i;

/** How the served copy names each part. Every term catches a shipped sentence. */
const PART_TERMS: Partial<Record<DocumentPart, RegExp>> = {
  bookmarks: /\bbookmark/i,
  form: /\b(?:fillable|AcroForm|form (?:definition|structure|dictionary|fields?))\b/i,
  titleAuthor: /\b(?:title|author)\b/i,
  pageLabels: /\bpage labels?\b/i,
  attachments: /\b(?:attached files?|attachments?)\b/i,
  tags: /\b(?:accessibility )?tags\b/i,
};

/** The parts `sentence` says are lost that the engine, measured, keeps. */
function falselyLost(
  sentence: string,
  kept: Record<DocumentPart, boolean>,
): DocumentPart[] {
  if (LOSS_OF_EVERYTHING.test(sentence))
    return DOCUMENT_PARTS.filter((part) => kept[part]);
  if (!LOSS.some((p) => p.test(sentence)) || ONLY_PAGES_LEFT_OUT.test(sentence))
    return [];
  return DOCUMENT_PARTS.filter(
    (part) => kept[part] && PART_TERMS[part]?.test(sentence) === true,
  );
}

const sentencesOf = (text: string) =>
  text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);

/** The tools whose runner calls one of the page engines above — discovered. */
const pageTools = () =>
  tools.filter((t) => ENGINE_FOR_RUNNER[getRunnerKind(t.slug) ?? ""]);

/** What the engine `slug`'s runner calls keeps of {@link richPdf}. */
async function measuredFor(slug: string) {
  const engine = ENGINE_FOR_RUNNER[getRunnerKind(slug)!]!;
  const rich = await richPdf();
  return keepsDocumentParts(await engine.run(rich), rich);
}

describe("the page tools' answers are what their engines produce", () => {
  it("the fixture really has every part, and the reader sees each one go (controls)", async () => {
    const rich = await richPdf();
    expect(await keepsDocumentParts(rich, rich)).toEqual(ALL_KEPT);
    const bare = await PDFDocument.create();
    bare.addPage([300, 400]);
    expect(await keepsDocumentParts(await bare.save(), rich)).toEqual(
      Object.fromEntries(DOCUMENT_PARTS.map((part) => [part, false])),
    );
  });

  it("a bookmarks answer says exactly what the runner's engine keeps", async () => {
    // Health: the candidate answers are distinct, so an answer names ONE claim.
    expect(new Set(PAGE_TOOL_ANSWER_CHOICES.map((c) => c.answer)).size).toBe(
      PAGE_TOOL_ANSWER_CHOICES.length,
    );
    // Discovered from what the page SERVES as well as the derived FAQ.
    const answered = tools.filter(
      (t) =>
        toolFaq(t).some((e) => /bookmarks/.test(e.question)) ||
        page(t.slug).faq.some((e) => /bookmarks/.test(e.question)),
    );
    expect(
      answered.map((t) => t.slug).sort(),
      "the bookmarks answer is on no page — blind",
    ).toEqual(
      expect.arrayContaining([
        "organize-pages",
        "remove-pages",
        "merge-pdf",
        "split-pdf",
        "extract-pages",
      ]),
    );
    const rich = await richPdf();
    for (const tool of answered) {
      const kind = getRunnerKind(tool.slug)!;
      const engine = ENGINE_FOR_RUNNER[kind];
      expect(
        engine,
        `${tool.slug}: no engine mapped for ${kind}`,
      ).toBeDefined();
      expect(
        withoutComments(runnerSource(tool.slug)),
        `${tool.slug}'s runner no longer calls ${engine!.call}`,
      ).toContain(engine!.call);
      const kept = await keepsDocumentParts(await engine!.run(rich), rich);
      const answer = page(tool.slug).faq.find((e) =>
        /bookmarks/.test(e.question),
      )!.answer;
      // INVERTED 2026-10-06 (history kept). Over the empty-outline fixture this
      // expected "No" of all five engines and passed; over a real bookmark
      // every engine keeps both, so the same predicate now requires "Yes".
      expect(
        answer.startsWith(kept.bookmarks && kept.form ? "Yes" : "No"),
        `${tool.slug}: the engine keeps ${JSON.stringify(kept)}; the page says "${answer.slice(0, 60)}…"`,
      ).toBe(true);
      // The rest of the answer, part by part: it is one of the composed
      // answers, and the table that composed it is what the engine does.
      const claimed = PAGE_TOOL_ANSWER_CHOICES.filter(
        (c) => c.answer === answer,
      );
      expect(
        claimed.length,
        `${tool.slug}: the served answer is not composed from PAGE_TOOL_CARRIES: "${answer}"`,
      ).toBe(1);
      expect(kept, `${tool.slug}: ${claimed[0]!.state}`).toEqual(
        PAGE_TOOL_CARRIES[claimed[0]!.state],
      );
      if (claimed[0]!.state === "merge") {
        // "two copies of one form keep separate answers": the engine ran on
        // two copies of the fixture, so two distinct fields must come out.
        const merged = await PDFDocument.load(await engine!.run(rich));
        const names = merged
          .getForm()
          .getFields()
          .map((f) => f.getName());
        expect(new Set(names).size, names.join(", ")).toBe(2);
      }
      if (claimed[0]!.inPlaceWhenOnlyTurned) {
        expect(
          engine!.inPlace,
          `${tool.slug} says turning alone saves in place; nothing runs it`,
        ).toBeDefined();
        expect(
          await keepsDocumentParts(await engine!.inPlace!(rich), rich),
        ).toEqual(ALL_KEPT);
      }
    }
  });

  it("the loss patterns and the sentences that shipped catch each other (both directions)", async () => {
    for (const { slug, sentence } of SHIPPED_LOSS) {
      expect(
        falselyLost(sentence, await measuredFor(slug)),
        `${slug}: not caught — "${sentence}"`,
      ).not.toEqual([]);
    }
    const shipped = SHIPPED_LOSS.map((s) => s.sentence);
    const idle = [...LOSS, LOSS_OF_EVERYTHING, ...Object.values(PART_TERMS)]
      .filter((p) => !shipped.some((s) => p.test(s)))
      .map(String);
    expect(idle, "a pattern no shipped sentence exercises").toEqual([]);
    // The exemption, through the same predicate: qualified it passes, and the
    // same sentence without the qualifier is caught.
    const kept = await measuredFor("remove-pages");
    expect(
      falselyLost(
        "A bookmark that opens only a page you left out is not carried.",
        kept,
      ),
    ).toEqual([]);
    expect(falselyLost("A bookmark is not carried.", kept)).toEqual([
      "bookmarks",
    ]);
  });

  it("no served sentence about a page tool says it drops what its engine keeps", async () => {
    const subjects = pageTools();
    expect(subjects.map((t) => t.slug)).toEqual(
      expect.arrayContaining([
        "rotate-pdf",
        "organize-pages",
        "remove-pages",
        "merge-pdf",
        "split-pdf",
        "extract-pages",
      ]),
    );
    expect(
      subjects.length,
      "the page-tool set is implausibly large",
    ).toBeLessThanOrEqual(10);
    const offenders: string[] = [];
    let exempted = 0;
    for (const tool of subjects) {
      const kept = await measuredFor(tool.slug);
      const served = copyAbout(tool).flatMap(sentencesOf);
      // Health: each page talks about bookmarks somewhere, so a blind reader
      // (an empty page, a wrong slug) cannot report a clean pass.
      expect(
        served.some((s) => PART_TERMS.bookmarks!.test(s)),
        `${tool.slug}: no served sentence mentions bookmarks`,
      ).toBe(true);
      for (const sentence of served) {
        if (
          LOSS.some((p) => p.test(sentence)) &&
          ONLY_PAGES_LEFT_OUT.test(sentence)
        )
          exempted += 1;
        const lost = falselyLost(sentence, kept);
        if (lost.length > 0)
          offenders.push(`${tool.slug} [${lost.join(", ")}]: "${sentence}"`);
      }
    }
    const unique = [...new Set(offenders)];
    expect(unique, unique.join("\n")).toEqual([]);
    // The exemption is not decoration: some served sentence relies on it.
    expect(exempted).toBeGreaterThan(0);
  });

  it("rotation sets /Rotate and leaves the page's drawing untouched", async () => {
    const tool = tools.find((t) => getRunnerKind(t.slug) === "rotate")!;
    expect(withoutComments(runnerSource(tool.slug))).toContain(
      ENGINE_FOR_RUNNER.rotate!.call,
    );
    const before = await PDFDocument.load(await richPdf());
    const after = await PDFDocument.load(
      await ENGINE_FOR_RUNNER.rotate!.run(await richPdf()),
    );
    expect(after.getPage(0).getRotation().angle).toBe(90);
    expect(contentBytes(after, 0)).toBe(contentBytes(before, 0));
    const answer = page(tool.slug).faq.find((e) =>
      /quality/.test(e.question),
    )!.answer;
    expect(answer).toMatch(/^No\b/);
    expect(answer).toMatch(/not re-rendered/);
  });

  it("the every-other-page example selects every other page", () => {
    const picked = parsePageList(EVERY_OTHER_PAGE_EXAMPLE, 8).map((i) => i + 1);
    expect(picked.length).toBeGreaterThan(2);
    for (let i = 1; i < picked.length; i += 1)
      expect(picked[i]! - picked[i - 1]!).toBe(2);
    expect(
      page("remove-pages")
        .faq.map((e) => e.answer)
        .join(" "),
    ).toContain(EVERY_OTHER_PAGE_EXAMPLE);
  });
});

/* ------------------------------------------------------------------ *
 *  3. The converters: page geometry, transparency, raster output
 * ------------------------------------------------------------------ */

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ),
);

/** Promises of a control the image runner does not have. */
const PAGE_SETUP_CONTROL =
  /\b(?:control over|choose|set|adjust|pick|select)\b[^.]{0,40}\b(?:orientation|margins?|page size)\b/i;

/** Verbatim from the jpg-to-pdf catalogue entry and guide at 67e8d0f. */
const SHIPPED_PAGE_SETUP = [
  "Combine JPG images into a PDF with control over orientation, margins, and page size.",
  "Set the page size for the finished PDF.",
  "Choose the orientation, so pages run tall or wide to match your photos.",
  "Adjust the margins to control how much space surrounds each image.",
];

/** Everything a reader gets about `tool`: page, catalogue, its own guides. */
function copyAbout(tool: Tool): string[] {
  const p = page(tool.slug);
  return [
    tool.description,
    ...howToSteps(tool),
    ...toolFacts(tool.slug).map((f) => f.value),
    p.text,
    ...p.faq.flatMap((e) => [e.question, e.answer]),
    ...guides
      .filter((g) => g.tools[0] === tool.slug)
      .flatMap((g) => [
        g.description,
        ...g.intro,
        ...g.steps,
        ...g.sections.flatMap((s) => [s.heading, ...s.body]),
        ...g.faq.flatMap((f) => [f.question, f.answer]),
      ]),
  ];
}

/**
 * WHAT SHIPPED until 2026-10-07: Rotate PDF's intro opened "Nothing else in the
 * file changes", and its FAQ said "The one other change is the producer entry".
 * Its engine also rewrites the Creator and the modification date, and saving
 * the whole file breaks a certificate signature (the runner warns before
 * Apply). The rewritten entries are MEASURED here by running the engine the
 * runner calls, and the served page must name each one; a rewritten entry
 * this file has no term for is fatal, not skipped.
 */
describe("Rotate PDF names every document entry its engine rewrites", () => {
  const SHIPPED = [
    "Nothing else in the file changes. Rotation updates one entry on each page and saves the same document, so bookmarks, the title and author, page labels, the fillable form and anything typed into it, attached files and a tagged PDF's accessibility tags all stay as they were, and links keep pointing where they did.",
    "No. Rotation saves the same document with a new angle on its pages. Page content, dimensions and order stay as they were, and so do web links, links between pages, comments, bookmarks, the title and author, page labels such as i, ii, iii, attached files, the accessibility tags of a tagged PDF, and the fillable form with any values already typed into it. The one other change is the producer entry, which now names pdf.xyz.",
  ];
  /** How the copy names each /Info entry. */
  const TERMS: Record<string, RegExp> = {
    Producer: /\bproducer\b/i,
    Creator: /\bcreator\b/i,
    ModDate: /\bmodification date\b/i,
  };
  /** The page's copy names the signature that saving breaks. */
  const SIGNATURE =
    /\b(?:digital|certificate) (?:\(certificate\) )?signature\b[^.]*\b(?:no longer verify|stops? verifying)\b/i;

  async function rewrittenEntries(
    run: (bytes: Uint8Array) => Promise<Uint8Array> = ENGINE_FOR_RUNNER[
      getRunnerKind("rotate-pdf")!
    ]!.run,
  ): Promise<string[]> {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([300, 400]);
    doc.addPage([300, 400]);
    doc.addPage([300, 400]);
    doc.setTitle("Title");
    doc.setAuthor("Author");
    doc.setProducer("Producer");
    doc.setCreator("Creator");
    doc.setCreationDate(new Date("2000-01-01T00:00:00Z"));
    doc.setModificationDate(new Date("2001-01-01T00:00:00Z"));
    const before = await doc.save();
    const info = async (bytes: Uint8Array) => {
      const d = await PDFDocument.load(bytes, { updateMetadata: false });
      const dict = d.context.lookup(d.context.trailerInfo.Info) as PDFDict;
      return new Map(
        dict.entries().map(([k, v]) => [k.decodeText(), v.toString()]),
      );
    };
    const [was, now] = [await info(before), await info(await run(before))];
    // Health: the fixture set six entries, and the engine kept them all present.
    expect(was.size).toBe(6);
    return [...now.keys()].filter((k) => now.get(k) !== was.get(k));
  }

  const names = (text: string, keys: readonly string[]) =>
    keys.filter((k) => {
      const term = TERMS[k];
      if (!term) throw new Error(`the engine rewrites /${k}; name it in TERMS`);
      return term.test(text);
    });

  it("the engine rewrites entries beyond the angle, and the shipped copy missed some", async () => {
    const changed = await rewrittenEntries();
    expect(changed).toEqual(expect.arrayContaining(["Producer", "Creator"]));
    expect(changed).not.toContain("Title");
    expect(changed).not.toContain("Author");
    for (const s of SHIPPED)
      expect(names(s, changed).length, s).toBeLessThan(changed.length);
  });

  it("the served page names every rewritten entry and the broken signature", async () => {
    const changed = await rewrittenEntries();
    const served = page("rotate-pdf");
    const intro = pageIntro(tools.find((t) => t.slug === "rotate-pdf")!).join(
      " ",
    );
    const lost = served.faq.find((e) => /anything get lost/i.test(e.question));
    expect(lost, "the what-is-lost answer is not served").toBeDefined();
    for (const [where, text] of [
      ["intro", intro],
      ["FAQ", lost!.answer],
    ] as const) {
      expect(names(text, changed), where).toEqual(changed);
      expect(text, where).toMatch(SIGNATURE);
    }
    // The served HTML carries the intro as written.
    expect(served.text).toContain(intro.slice(0, 80));
  });

  /**
   * Organize saves a plan that only turns pages in place, through the same
   * stamp() — and its derived answer said the file "keeps everything", and
   * its intro "with everything in it", until 2026-10-08. The in-place plan is RUN here and the served sentence must
   * name each entry it rewrote.
   */
  const SHIPPED_IN_PLACE = [
    "If you only turn pages, the export is not rebuilt at all: the file is saved in place and keeps everything, attached files and tags included.",
    "Attached files and a tagged PDF's accessibility tags are left out of a rebuilt export; if you only turned pages, the file is saved in place with everything in it.",
  ];

  it("Organize's in-place sentence names every entry its in-place plan rewrites", async () => {
    const inPlace = ENGINE_FOR_RUNNER.organize!.inPlace!;
    const changed = await rewrittenEntries(inPlace);
    expect(changed).toEqual(expect.arrayContaining(["Producer", "Creator"]));
    expect(changed).not.toContain("Title");
    for (const shipped of SHIPPED_IN_PLACE)
      expect(names(shipped, changed).length, shipped).toBeLessThan(
        changed.length,
      );
    const subjects = tools.filter((t) => getRunnerKind(t.slug) === "organize");
    expect(subjects.length, "no tool mounts the organize runner").toBe(1);
    for (const tool of subjects) {
      // Every served sentence about the in-place save: the derived FAQ
      // answer AND the authored intro, which said "with everything in it".
      const served = [
        ...new Set(
          copyAbout(tool)
            .flatMap(sentencesOf)
            .filter((s) => /\bsaved in place\b/.test(s)),
        ),
      ];
      expect(
        served.length,
        `${tool.slug}: the intro and the FAQ should each say it`,
      ).toBeGreaterThanOrEqual(2);
      for (const sentence of served)
        expect(names(sentence, changed), sentence).toEqual(changed);
    }
  });
});

describe("a guide targets only searches its tool can answer", () => {
  // The delete-pages guide targeted "remove blank pages from pdf" over a
  // runner with no blank-page detection: the searcher lands on manual
  // selection. A first draft of this guard let the keyword back "when the
  // runner mentions blank" — and it passed with the keyword restored, because
  // runner-kit's render-failure notice says pages "are blank in this output".
  // A word in a file is not a detector, so there is no automatic exit: whoever
  // builds blank-page detection lifts this ban in the same change, next to a
  // test that runs the detector on a PDF with a blank page.
  const BLANK_PAGE_INTENT = /\bblank pages?\b/i;
  const SHIPPED = ["remove blank pages from pdf"];

  it("no guide targets blank-page removal", () => {
    for (const k of SHIPPED) expect(BLANK_PAGE_INTENT.test(k)).toBe(true);
    const keywords = guides.flatMap((g) =>
      g.keywords.map((k) => [g.slug, k] as const),
    );
    // Health: the corpus is every keyword of every guide, not a few.
    expect(keywords.length).toBeGreaterThan(guides.length * 2);
    expect(
      keywords
        .filter(([, k]) => BLANK_PAGE_INTENT.test(k))
        .map(([g, k]) => `${g}: "${k}"`),
    ).toEqual([]);
  });
});

describe("the converters' pages describe the page they produce", () => {
  it("image to PDF offers no page setup while its runner has none", () => {
    for (const s of SHIPPED_PAGE_SETUP)
      expect(PAGE_SETUP_CONTROL.test(s), s).toBe(true);
    const subjects = tools.filter(
      (t) => getRunnerKind(t.slug) === "image-to-pdf",
    );
    expect(subjects.length).toBeGreaterThanOrEqual(2);
    for (const tool of subjects) {
      // Precondition: lift the ban by building the control, not by deleting it.
      expect(
        withoutComments(runnerSource(tool.slug)),
        "the image runner now has a page-setup control — update the copy and this ban together",
      ).not.toMatch(/orientation|margin|pageSize|page size/i);
      const offenders = copyAbout(tool).filter((t) =>
        PAGE_SETUP_CONTROL.test(t),
      );
      expect(offenders, `${tool.slug}`).toEqual([]);
    }
  });

  it("the stated page is the page the engine draws", async () => {
    const doc = await PDFDocument.load(
      await imagesToPdf("png", [
        { name: "a.png", type: "image/png", bytes: PNG_1X1 },
      ]),
    );
    const { width, height } = doc.getPage(0).getSize();
    expect([width, height]).toEqual([US_LETTER_PT.width, US_LETTER_PT.height]);
    const ops = contentBytes(doc, 0);
    // White fill over the whole page, before the image is drawn.
    expect(ops.indexOf("1 1 1 rg")).toBeGreaterThanOrEqual(0);
    expect(ops.indexOf("1 1 1 rg")).toBeLessThan(ops.indexOf(" Do"));
    // A 1×1 image is drawn at 1×1 — never enlarged.
    expect(ops).toMatch(/\b1 0 0 1 [\d.]+ [\d.]+ cm\b/);
    for (const slug of ["jpg-to-pdf", "png-to-pdf"]) {
      const answer = page(slug).faq.find((e) =>
        /page size/.test(e.question),
      )!.answer;
      expect(answer).toContain(US_LETTER_LABEL);
      expect(answer).toContain(`${inches(IMAGE_PAGE_MARGIN_PT)} in margin`);
      expect(answer).toMatch(/never enlarged/);
    }
    expect(
      page("png-to-pdf").faq.find((e) => /transparent/.test(e.question))!
        .answer,
    ).toMatch(/white/);
  });

  /*
   * WHAT SHIPPED: JPG to PDF's first step quoted “Choose JPG images only.” and
   * PNG to PDF's answers quoted “Choose PNG images only.”, months after the
   * runner started saying “Choose PNG or JPG images.” and reading each file's
   * bytes on add. The quoted-label guard above could not see it: it reads
   * curly quotes, and both pages quote with straight ones.
   *
   * So the refusals are DISCOVERED from the runner (every `reason:` it pushes)
   * and each served image page must name every one, in the runner's words:
   * a page that names a stale message necessarily omits the live one.
   */
  it("the image pages name every refusal the runner gives, in its words", () => {
    const subjects = tools.filter(
      (t) => getRunnerKind(t.slug) === "image-to-pdf",
    );
    expect(subjects.length).toBeGreaterThanOrEqual(2);
    const source = withoutComments(runnerSource(subjects[0]!.slug));
    const all = [
      ...source.matchAll(
        /\breason:\s*("[^"\n]*"|`[^`\n]*`|[A-Za-z_][\w.]*\([^)\n]*\))/g,
      ),
    ].map((m) => m[1]!);
    // Every value a `reason:` is given was read — none skipped for its shape
    // (the one `reason: string` is the Rejection type's annotation).
    expect(all.length).toBe(
      [...source.matchAll(/\breason:(?!\s*string\b)/g)].length,
    );
    const literal = all.flatMap((r) => {
      const m = /^(["`])(.+)\1$/.exec(r);
      if (!m) return [];
      const text = m[2]!.replace("${MAX_IMAGE_MB}", String(MAX_IMAGE_MB));
      // A placeholder this reader does not fill is a broken link, not a pass.
      if (text.includes("${")) throw new Error(`unfilled reason: ${r}`);
      return [text];
    });
    const computed = all.filter((r) => !/^["`]/.test(r));
    // Health: four worded refusals plus the one that names a real format.
    expect(literal.length, all.join("\n")).toBeGreaterThanOrEqual(4);
    expect(computed).toEqual(["unsupportedImageMessage(file.name, bytes)"]);
    const webp = new Uint8Array(12);
    webp.set([...Buffer.from("RIFF")], 0);
    webp.set([...Buffer.from("WEBP")], 8);
    const named = unsupportedImageMessage("NAME", webp).split(". ")[0]! + ".";
    expect(named).toBe('"NAME" is a WebP image.');
    const namedShape = new RegExp(
      named.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("NAME", '[^"]+'),
    );
    // Positive control: the step JPG to PDF shipped names a stale refusal.
    const shipped = `Anything turned away is listed by name in an alert below the box: "Choose JPG images only." for another type, "File is empty." for a zero-byte file, and "Max ${MAX_IMAGE_MB} MB per image." for one that is too big.`;
    expect(literal.filter((r) => !shipped.includes(r)).length).toBeGreaterThan(
      0,
    );
    expect(namedShape.test(shipped)).toBe(false);
    for (const tool of subjects) {
      const served = [
        ...page(tool.slug).howTo,
        ...page(tool.slug).faq.map((e) => e.answer),
      ].join("\n");
      expect(
        literal.filter((r) => !served.includes(r)),
        tool.slug,
      ).toEqual([]);
      expect(served, tool.slug).toMatch(namedShape);
    }
  });

  it("PDF to PNG claims no transparency while its renderer paints white", () => {
    const tool = tools.find((t) => t.slug === "pdf-to-png")!;
    // Precondition: the runner passes no background, and the renderer's
    // default is white.
    expect(withoutComments(runnerSource(tool.slug))).not.toMatch(/background/);
    expect(withoutComments(read("src/lib/pdf/render.ts"))).toMatch(
      /background = "#ffffff"/,
    );
    const shipped =
      "Render PDF pages as crisp, lossless PNG images with a transparent or white background.";
    expect(/transparen/i.test(shipped)).toBe(true);
    expect(copyAbout(tool).filter((t) => /transparen/i.test(t))).toEqual([]);
  });

  it("the raster pages name every preset, and the cap the renderer uses", () => {
    const render = withoutComments(read("src/lib/pdf/render.ts"));
    expect(render, "render.ts keeps its own copy of the cap").not.toMatch(
      /const RASTER_MAX_DEVICE_PX/,
    );
    expect(render).toContain("RASTER_MAX_DEVICE_PX");
    for (const tool of tools.filter(
      (t) => getRunnerKind(t.slug) === "pdf-to-image",
    )) {
      const text = [
        ...page(tool.slug).howTo,
        ...page(tool.slug).faq.map((e) => e.answer),
      ].join(" ");
      for (const r of RASTER_RESOLUTIONS)
        expect(text).toContain(`${r.label} (${r.dpi} DPI)`);
      expect(text).toContain(RASTER_MAX_DEVICE_PX.toLocaleString("en-US"));
      const runner = withoutComments(runnerSource(tool.slug));
      expect(runner).toContain("shouldZipPages(");
      expect(runner).toContain("pageImageName(");
      // The per-page buttons stop at the preview limit, so the page says so,
      // with the number the runner reads.
      expect(runner).not.toMatch(/const PREVIEW_LIMIT\s*=/);
      expect(runner).toContain("RASTER_PREVIEW_LIMIT");
      expect(text).toContain(`first ${RASTER_PREVIEW_LIMIT} pages`);
    }
  });

  it("a step that promises a single-page save says which pages have one", () => {
    // Shipped: "…and a page can also be saved on its own from its preview."
    // Only the first RASTER_PREVIEW_LIMIT pages get a preview (and so a
    // button); the FAQ said so, the HowTo step did not.
    const subjects = tools.filter(
      (t) => getRunnerKind(t.slug) === "pdf-to-image",
    );
    const steps = [
      ...subjects.flatMap((t) =>
        page(t.slug).howTo.map((s) => [t.slug, s] as const),
      ),
      ...guides
        .filter((g) => getRunnerKind(g.tools[0]!) === "pdf-to-image")
        .flatMap((g) => g.steps.map((s) => [g.slug, s] as const)),
    ];
    const promising = steps.filter(([, s]) => /\bon its own\b/.test(s));
    // Positive control: both tool pages and the guide carry the step.
    expect(promising.length).toBeGreaterThanOrEqual(subjects.length + 1);
    expect(
      promising
        .filter(([, s]) => !s.includes(`first ${RASTER_PREVIEW_LIMIT} pages`))
        .map(([where]) => where),
    ).toEqual([]);
  });

  it("the Markdown syntax answer is what the parser produces", () => {
    const blocks = parseMarkdownBlocks(
      [
        "# Title",
        "",
        "Some **bold** text with [a link](https://example.com).",
        "",
        "- item",
        "",
        "> quoted",
        "",
        "```",
        "code",
        "```",
        "",
        "---",
        "",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
      ].join("\n"),
    );
    const kinds = new Set(blocks.map((b) => b.kind));
    for (const kind of MARKDOWN_BLOCK_KINDS)
      expect(kinds.has(kind), `no ${kind} block parsed`).toBe(true);
    // INVERTED at the merge with L09 (20ba6ce), history kept. This asserted
    // `table?.kind === "paragraph"` — "a GFM table is not a plain paragraph"
    // — and that its text kept the "|" dividers, because the guide said "A
    // table's rows print as plain text, cell dividers included". That pinned
    // the defect L09 fixed: the renderer now draws the table as a grid. What
    // the page must say is what the parser produces, so the table is a table,
    // with its cells and no pipe left in any text block.
    const table = blocks.find((b) => b.kind === "table");
    expect(table, "a GFM table parsed as no table").toBeDefined();
    expect(table && "header" in table && table.header).toEqual(["a", "b"]);
    expect(table && "rows" in table && table.rows).toEqual([["1", "2"]]);
    expect(
      blocks.some((b) => "text" in b && b.text.includes("|")),
      "table syntax survived into a text block",
    ).toBe(false);
    const para = blocks.find(
      (b) => b.kind === "paragraph" && b.text.startsWith("Some"),
    )!;
    expect("text" in para && para.text).toBe(
      "Some bold text with a link (https://example.com).",
    );
    const answer = page("markdown-to-pdf").faq.find((e) =>
      /Which Markdown/.test(e.question),
    )!.answer;
    expect(answer).toMatch(/Bold and italics print as plain text/);
    expect(answer).toMatch(/address in parentheses/);
    // The sentence that shipped until the merge, false once tables are drawn.
    expect(answer).not.toMatch(/\btables?\b[^.]*\bplain text\b/i);
    const guideAnswer = guides
      .flatMap((g) => g.faq)
      .find((e) => /Does it support tables\?/.test(e.question))?.answer;
    expect(
      guideAnswer,
      "the Markdown guide lost its tables answer",
    ).toBeDefined();
    expect(guideAnswer).not.toMatch(/plain text|cell dividers/);
  });
});

/*
 * 4. Offline: moved to `offline-answer.test.ts`, which discovers every mid-run
 *    fetch site (fonts AND pdfjs decoders/character maps) instead of only the
 *    `embedDrawingFont` callers this section once walked.
 */
