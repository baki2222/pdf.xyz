// @vitest-environment node
// @native-canvas
/**
 * Redact PDF's page and guide, held to the file the engine writes.
 *
 * WHAT SHIPPED (audited at 67e8d0f): /tools/redact-pdf answered only the three
 * templated questions every in-browser page carries. Nothing said whether the
 * redaction is permanent, what survives, or that the result is no longer
 * searchable — and the one sentence about the output ("the text and vectors
 * underneath are permanently removed") undersold the cost, because `redactPdf`
 * rasterizes EVERY page, not only the pages with a box. The runner's own
 * warning said "Every redacted page is flattened", the same understatement.
 *
 * The new answers make five claims about the output. Each is checked here on a
 * real redacted file built by `assembleRedactedPdf` — the function `redactPdf`
 * hands its page images to — from real JPEG bytes. (The rasterizer itself needs
 * a browser canvas; its "every page" contract is pinned at the type level
 * below: `rasterizePdf` has no page-subset option to pass.)
 *
 * The page is read as served (`renderToolPages`), and the guide through its
 * catalogue, so a sentence that is right in `tool-facts.ts` but never reaches
 * the reader does not pass.
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
  PDFString,
  PDFHexString,
  StandardFonts,
} from "pdf-lib";
import { assembleRedactedPdf } from "@/lib/pdf/redact";
import type { RasterizeOptions } from "@/lib/pdf/render";
import {
  DEFAULT_REDACT_METHOD,
  DEFAULT_REDACT_PRESET_ID,
  REDACTED_PDF_TITLE,
  REDACT_DPI_PRESETS,
  REDACT_METHODS,
} from "@/lib/pdf/redact-output";
import { redactPdfByRemoval } from "@/lib/pdf/redact-remove";
import { extractPdfText, type PdfTextReader } from "@/lib/pdf/text";
import { REDACT_REMOVE_FACT } from "./tool-facts";
import { guides } from "@/lib/guides/catalog";
import { withoutComments } from "./copy-surface";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";

const JPG_1X1 = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
    "base64",
  ),
);

/** What a reader calls each image encoding the assembler can embed. */
const FILTER_NAME: Record<string, string> = {
  DCTDecode: "JPEG",
  FlateDecode: "PNG",
};

/**
 * WAS a compile-time tripwire: `rasterizePdf` rendered every page because it
 * could not be told to skip one, and a `NoPageSubset` type stopped compiling
 * the day a page-subset option arrived. It fired on 2026-10-24, when PDF to
 * JPG/PNG gained page selection (`RasterizeOptions.pages`), and the "every
 * page" sentences were re-checked against how redact calls it: redact passes
 * no `pages`, so every page still comes back.
 *
 * So the check now pins THAT — the property, at redact's own call site —
 * rather than the option's absence: the options object redact hands the
 * rasterizer must not name `pages`. `pagesOptionPassed` is the predicate,
 * with a positive control in the test below.
 */
type HasPageSubset = Extract<keyof RasterizeOptions, "pages">;
const pageSubsetExists: [HasPageSubset] extends [never] ? false : true = true;

function rasterizeCallOptions(source: string): string | null {
  return (
    /\brasterize\(\s*bytes,\s*\{([\s\S]*?)\n\s*\}\);/.exec(source)?.[1] ?? null
  );
}
function pagesOptionPassed(options: string): boolean {
  return /(?:^|[\s,{])(?:pages\s*[:,]|\.\.\.)/.test(withoutComments(options));
}

let pages: Map<string, RenderedToolPage>;
let output: PDFDocument;
const SOURCE_PAGES = 3;

beforeAll(async () => {
  pages = renderToolPages();
  const raster = Array.from({ length: SOURCE_PAGES }, () => ({
    bytes: JPG_1X1,
    width: 1,
    height: 1,
    pageWidth: 300,
    pageHeight: 400,
  }));
  output = await PDFDocument.load(await assembleRedactedPdf(raster), {
    updateMetadata: false,
  });
}, 180_000);

function served(): RenderedToolPage {
  const page = pages.get("redact-pdf");
  if (!page) throw new Error("redact-pdf was not rendered");
  return page;
}

function answer(question: RegExp): string {
  const entry = served().faq.find((e) => question.test(e.question));
  if (!entry) {
    throw new Error(`the served redact page asks nothing matching ${question}`);
  }
  return entry.answer;
}

/** The parts a PDF can carry that the answers say a redacted file does not. */
function documentParts(doc: PDFDocument) {
  const perPage = doc.getPages().map((page) => {
    const resources = page.node.Resources();
    const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const images = (xobjects?.entries() ?? []).map(([, ref]) => {
      const stream = doc.context.lookup(ref) as PDFRawStream;
      const filter = stream.dict.get(PDFName.of("Filter"));
      return {
        subtype: String(stream.dict.get(PDFName.of("Subtype"))),
        filter: filter ? String(filter).replace(/^\//, "") : "",
      };
    });
    // pdf-lib gives every page an EMPTY /Font dictionary; a font is an entry.
    const fonts = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
    return {
      fonts: (fonts?.entries().length ?? 0) > 0,
      annots:
        (page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.size() ?? 0) >
        0,
      images,
    };
  });
  return {
    perPage,
    form: doc.catalog.get(PDFName.of("AcroForm")) !== undefined,
    outline: doc.catalog.get(PDFName.of("Outlines")) !== undefined,
  };
}

function infoString(doc: PDFDocument, key: string): string | undefined {
  const info = doc.context.lookup(doc.context.trailerInfo.Info) as
    PDFDict | undefined;
  const value = info?.get(PDFName.of(key));
  return value instanceof PDFString || value instanceof PDFHexString
    ? value.decodeText()
    : undefined;
}

describe("the detectors can see what the answers say is gone (positive control)", () => {
  it("a PDF with text, a form, a link and an outline shows all four", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 400]);
    page.drawText("Account 12345678", { x: 20, y: 350, size: 14, font });
    doc
      .getForm()
      .createTextField("name")
      .addToPage(page, { x: 20, y: 200, width: 200, height: 24 });
    doc.catalog.set(
      PDFName.of("Outlines"),
      doc.context.register(doc.context.obj({ Type: "Outlines", Count: 0 })),
    );
    doc.setAuthor("Jane Doe");
    const parts = documentParts(
      await PDFDocument.load(await doc.save(), { updateMetadata: false }),
    );
    expect(parts.perPage[0]!.fonts).toBe(true);
    expect(parts.perPage[0]!.annots).toBe(true);
    expect(parts.form).toBe(true);
    expect(parts.outline).toBe(true);
    expect(pageSubsetExists).toBe(true);
  });

  it("redact asks the rasterizer for every page: it passes no page subset", () => {
    const options = rasterizeCallOptions(
      readFileSync("src/lib/pdf/redact.ts", "utf8"),
    );
    // Health: the call site was found, and it is the one with the paint hook.
    expect(options, "redact's rasterize(bytes, {…}) call").not.toBeNull();
    expect(options).toMatch(/onCanvas/);
    expect(pagesOptionPassed(options!)).toBe(false);
    // Positive controls: the predicate sees a subset, or a spread that could
    // carry one.
    expect(pagesOptionPassed(`${options}\n    pages: [0],`)).toBe(true);
    expect(pagesOptionPassed(`${options}\n    pages,`)).toBe(true);
    expect(pagesOptionPassed(`    ...opts,${options}`)).toBe(true);
  });
});

describe("the served answers are what the assembler writes", () => {
  it("every page comes back, as one image and nothing else", () => {
    const parts = documentParts(output);
    expect(parts.perPage).toHaveLength(SOURCE_PAGES);
    for (const page of parts.perPage) {
      expect(page.fonts, "a page carries a font — text survived").toBe(false);
      expect(page.annots, "a page carries annotations").toBe(false);
      expect(page.images).toHaveLength(1);
      expect(page.images[0]!.subtype).toBe("/Image");
    }
    expect(parts.form).toBe(false);
    expect(parts.outline).toBe(false);
  });

  it("the image format the page names is the one embedded", () => {
    const filters = new Set(
      documentParts(output).perPage.flatMap((p) =>
        p.images.map((i) => i.filter),
      ),
    );
    expect(filters.size).toBe(1);
    const name = FILTER_NAME[[...filters][0]!];
    expect(name, `no reader name for ${[...filters][0]}`).toBeDefined();
    expect(answer(/recovered/i)).toContain(`${name} image`);
    const fact = served().text;
    expect(fact).toContain(`flat ${name} image`);
  });

  it("the only title is the one the answer names, and none of the original's info survives", () => {
    expect(infoString(output, "Title")).toBe(REDACTED_PDF_TITLE);
    expect(answer(/recovered/i)).toContain(`“${REDACTED_PDF_TITLE}”`);
    for (const key of ["Author", "Subject", "Keywords"]) {
      expect(infoString(output, key), key).toBeUndefined();
    }
  });

  /*
   * INVERTED 2026-10-25, history kept. This held the answer to `/^No\b/`:
   * true while flattening was the only method. "Remove text under boxes"
   * keeps the rest of the text, so an unqualified "No" became false for one
   * of the two methods the runner offers. The answer now names each method
   * with its own outcome; the removal half is held to a real removal below.
   */
  it("the page says, per method, whether the result is searchable, and names OCR for the flattened one", () => {
    const text = answer(/searchable/i);
    expect(text).not.toMatch(/^No\b/);
    const [flatten, remove] = REDACT_METHODS.map((m) => m.label);
    const flatAt = text.indexOf(`With “${flatten}”, no`);
    const removeAt = text.indexOf(`With “${remove}”, yes`);
    expect(flatAt, text).toBeGreaterThanOrEqual(0);
    expect(removeAt, text).toBeGreaterThan(flatAt);
    expect(text.slice(flatAt, removeAt)).toMatch(/every page/);
    expect(text.slice(flatAt, removeAt)).toContain("OCR PDF");
  });

  it("the method the page says is selected is the one the runner opens with", () => {
    const initial = REDACT_METHODS.find((m) => m.id === DEFAULT_REDACT_METHOD)!;
    expect(served().text).toContain(
      `“${initial.label}” is selected when the tool opens`,
    );
    const runner = withoutComments(
      readFileSync(
        path.join(
          process.cwd(),
          "src/components/tools/runner/redact-runner.tsx",
        ),
        "utf8",
      ),
    );
    expect(runner).toMatch(/useState<RedactMethod>\(DEFAULT_REDACT_METHOD\)/);
  });

  it("the resolutions are the runner's presets, and the default is the one it opens with", () => {
    const text = served().text;
    for (const preset of REDACT_DPI_PRESETS) {
      expect(text).toContain(`${preset.label} (${preset.dpi} DPI)`);
    }
    const initial = REDACT_DPI_PRESETS.find(
      (p) => p.id === DEFAULT_REDACT_PRESET_ID,
    )!;
    expect(text).toContain(`${initial.label} is selected when the tool opens`);
    // The runner starts on that constant — read as code, comments stripped.
    const runner = withoutComments(
      readFileSync(
        path.join(
          process.cwd(),
          "src/components/tools/runner/redact-runner.tsx",
        ),
        "utf8",
      ),
    );
    expect(runner).toMatch(/useState<string>\(DEFAULT_REDACT_PRESET_ID\)/);
  });

  it("the guide that teaches redaction says the same things, and is linked from the tool", () => {
    const teaching = guides.filter((g) => g.tools[0] === "redact-pdf");
    expect(teaching.length, "no guide teaches Redact PDF").toBeGreaterThan(0);
    const servedFaq = new Map(served().faq.map((e) => [e.answer, e.question]));
    for (const guide of teaching) {
      const answers = guide.faq.map((f) => f.answer);
      expect(answers).toContain(answer(/recovered/i));
      expect(answers).toContain(answer(/searchable/i));
      expect(served().text).toContain(guide.title);
    }
    expect(servedFaq.size).toBeGreaterThan(3);
  });
});

describe("the removal method's sentences are what a real removal writes", () => {
  const legacy: PdfTextReader = async () =>
    (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Awaited<
      ReturnType<PdfTextReader>
    >;

  it("the text under the box is gone, the rest is still text, and the bookmarks and properties stay", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 400]);
    page.drawText("Account 12345678", { x: 20, y: 350, size: 14, font });
    page.drawText("Kept line of text", { x: 20, y: 300, size: 14, font });
    doc.catalog.set(
      PDFName.of("Outlines"),
      doc.context.register(doc.context.obj({ Type: "Outlines", Count: 0 })),
    );
    doc.setAuthor("Jane Doe");
    const source = await doc.save();
    // "Account " is ~58 pt wide at 14 pt; the box covers the number only.
    const { bytes } = await redactPdfByRemoval(
      source,
      { rects: [{ page: 1, x: 85, y: 344, width: 80, height: 18 }] },
      { decodeJpeg: null },
    );
    const text = (await extractPdfText(bytes, legacy)).text;
    // Positive control: the number was text before.
    expect((await extractPdfText(source, legacy)).text).toContain("12345678");
    expect(text).not.toContain("12345678");
    expect(text).toContain("Account");
    expect(text).toContain("Kept line of text");
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(out.catalog.get(PDFName.of("Outlines"))).toBeDefined();
    expect(infoString(out, "Author")).toBe("Jane Doe");
    // And that is what the page says of this method.
    expect(REDACT_REMOVE_FACT).toMatch(/still selectable and searchable/);
    expect(REDACT_REMOVE_FACT).toMatch(/bookmarks and properties/);
    expect(served().text).toContain(REDACT_REMOVE_FACT);
  });
});

describe("no redact sentence says only the redacted pages are flattened", () => {
  /**
   * The runner's warning said "Every redacted page is flattened into an
   * image". Every page is. The shipped sentence is the corpus; the pattern
   * must catch it and nothing shipped now.
   */
  const SHIPPED = [
    "Every redacted page is flattened into an image, so selectable text, form fields, and vectors are converted to pixels.",
  ];
  const ONLY_REDACTED = /\bevery redacted page\b/i;

  it("the pattern catches the sentence that shipped", () => {
    for (const s of SHIPPED) expect(ONLY_REDACTED.test(s), s).toBe(true);
  });

  it("the runner, the page and the guide no longer say it", () => {
    const runner = readFileSync(
      path.join(process.cwd(), "src/components/tools/runner/redact-runner.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    const guideText = guides
      .filter((g) => g.tools.includes("redact-pdf"))
      .flatMap((g) => [
        ...g.intro,
        ...g.steps,
        ...g.sections.flatMap((s) => s.body),
        ...g.faq.map((f) => f.answer),
      ])
      .join(" ");
    expect(runner).not.toMatch(ONLY_REDACTED);
    expect(served().text).not.toMatch(ONLY_REDACTED);
    expect(guideText).not.toMatch(ONLY_REDACTED);
  });
});
