// @native-canvas
/**
 * THE POINT OF CONSUMPTION for EPUB to PDF: the fixture books through the
 * REAL engine (`runEpubToPdf`) and the production Chromium runner, and the PDF
 * read back with pdf.js (`./proof`). Every verdict has a NEGATIVE control —
 * the same verdict run on a deliberately wrong book must find a problem — so
 * a pass cannot come from a reader that saw nothing.
 *
 * Runs wherever a Chromium exists (`findChromium`); SKIPPED, visibly, where
 * none does. In the worker image the same verdicts run through
 * `pnpm worker:epub-proof`, and on a deployment through
 * `pnpm worker:prove-tools`.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createNativeChromiumPdfRunner,
  resolveOnPath,
} from "../html-render/native";
import { findChromium } from "../html-render/test-chromium";
import { HTML_DOCUMENT_URL } from "../html-render/document-url";
import { runEpubToPdf, type EpubRenderDeps } from "./engine";
import {
  EPUB_REMOTE_IMAGE,
  EPUB_WEB_LINK,
  epub2Verdict,
  epub3Verdict,
  fixedLayoutVerdict,
  readEpubPdf,
} from "./proof";
import {
  epub2Book,
  epub3Book,
  fixedLayoutBook,
  fontObfuscatedBook,
} from "@/tests/epub-fixtures";

const BIN = findChromium(resolveOnPath);

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-epub-"));
afterAll(() => {
  try {
    rmSync(work, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch {
    /* the OS temp cleaner owns it now */
  }
});

const requests: string[] = [];
let fetches = 0;

function deps(): EpubRenderDeps {
  return {
    chromium: createNativeChromiumPdfRunner(
      {
        enabled: true,
        candidates: [BIN ?? "chromium"],
        overridden: true,
        timeoutMs: 60_000,
        maxInputBytes: 10 * 1024 * 1024,
        maxOutputBytes: 50 * 1024 * 1024,
        tmpDir: work,
      },
      {
        onRequest: (r) => requests.push(r.url),
        // Never to be reached: a package is never fetched for.
        network: {
          resolve: async () => {
            fetches += 1;
            throw new Error("the EPUB render reached the network");
          },
          fetch: async () => {
            fetches += 1;
            throw new Error("the EPUB render reached the network");
          },
        },
      },
    ),
    limits: { maxInputBytes: 50 * 1024 * 1024, timeoutMs: 60_000 },
  };
}

/** Every link annotation: URI targets, and page-to-page destinations. */
async function linksOf(pdf: Uint8Array) {
  const lib = await import("pdf-lib");
  const { PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRef } = lib;
  const doc = await lib.PDFDocument.load(pdf);
  const pages = doc.getPages();
  const indexOf = (ref: unknown) => pages.findIndex((p) => p.ref === ref);
  const uris: string[] = [];
  const dests: { from: number; to: number }[] = [];
  pages.forEach((page, from) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const annot = annots!.lookupMaybe(i, PDFDict);
      const uri = annot
        ?.lookupMaybe(PDFName.of("A"), PDFDict)
        ?.lookup(PDFName.of("URI"));
      if (uri instanceof PDFString || uri instanceof PDFHexString)
        uris.push(uri.decodeText());
      const dest = annot?.lookupMaybe(PDFName.of("Dest"), PDFArray);
      const target = dest?.get(0);
      if (target instanceof PDFRef) dests.push({ from, to: indexOf(target) });
    }
  });
  return { uris, dests };
}

async function convert(bytes: Uint8Array) {
  const run = await runEpubToPdf(bytes, deps());
  if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
  return { run, reading: await readEpubPdf(run.output) };
}

describe.skipIf(!BIN)("EPUB to PDF through a real Chromium", () => {
  it("EPUB 3: chapters in spine order, image drawn, CSS applied, nav outline, no script, no web", async () => {
    requests.length = 0;
    fetches = 0;
    const { run, reading } = await convert(await epub3Book());
    expect(epub3Verdict(reading)).toEqual([]);
    expect(run.meta).toMatchObject({ chapters: 3, bookmarks: 4 });
    // The remote image was ASKED for, and refused before any fetch.
    expect(requests).toContain(EPUB_REMOTE_IMAGE);
    expect(fetches).toBe(0);
    // Links: the web link stays a link; the link to chapter one opens
    // chapter one's page; no link leads to the synthetic origin.
    const links = await linksOf(run.output);
    expect(links.uris).toContain(EPUB_WEB_LINK);
    expect(links.uris.filter((u) => u.startsWith(HTML_DOCUMENT_URL))).toEqual(
      [],
    );
    const chapterOne = reading.pages.findIndex((t) =>
      t.includes("Quillfeather opening chapter"),
    );
    expect(links.dests).toContainEqual({ from: 2, to: chapterOne });
    // A5 by default: 148 x 210 mm = 419.5 x 595.3 pt.
    for (const [w, h] of reading.sizes) {
      expect(Math.abs(w - 419.5)).toBeLessThanOrEqual(1);
      expect(Math.abs(h - 595.3)).toBeLessThanOrEqual(1);
    }
  }, 120_000);

  it("negative controls: the same verdict fails a book printed out of order, unstyled, or without its image", async () => {
    const reversed = epub3Verdict(
      (await convert(await epub3Book({ reverseSpine: true }))).reading,
    );
    expect(reversed.join("\n")).toMatch(/out of spine order/);
    const unstyled = epub3Verdict(
      (await convert(await epub3Book({ dropCss: true }))).reading,
    );
    expect(unstyled.join("\n")).toMatch(/heading colour/);
    const imageless = epub3Verdict(
      (await convert(await epub3Book({ dropImage: true }))).reading,
    );
    expect(imageless.join("\n")).toMatch(/draws no 24x24 image/);
  }, 180_000);

  it("EPUB 2: the NCX becomes the outline", async () => {
    const { reading } = await convert(await epub2Book());
    expect(epub2Verdict(reading)).toEqual([]);
  }, 60_000);

  it("a font-obfuscated book converts (the font is left out, the text is not)", async () => {
    requests.length = 0;
    const { run, reading } = await convert(await fontObfuscatedBook());
    expect(epub3Verdict(reading)).toEqual([]);
    expect(run.meta.fontsLeftOut).toBe(1);
  }, 60_000);

  it("fixed layout: one PDF page per page, at its declared viewport", async () => {
    const { reading } = await convert(await fixedLayoutBook());
    expect(fixedLayoutVerdict(reading)).toEqual([]);
    // Control: the same verdict on the reflowable book.
    const reflow = (await convert(await epub3Book())).reading;
    expect(fixedLayoutVerdict(reflow).length).toBeGreaterThan(0);
  }, 60_000);
});

describe.skipIf(!BIN)(
  "the in-image proof (`pnpm worker:epub-proof`), run here",
  () => {
    it("is PROVEN on a real Chromium", async () => {
      requests.length = 0;
      fetches = 0;
      const { runEpubImageProof } = await import("./image-proof");
      const fixtures = await import("@/tests/epub-fixtures");
      const result = await runEpubImageProof({
        chromium: deps().chromium!,
        requests: () => requests,
        fetches: () => fetches,
        books: {
          epub3: () => fixtures.epub3Book(),
          epub3Reversed: () => fixtures.epub3Book({ reverseSpine: true }),
          epub2: fixtures.epub2Book,
          fixedLayout: fixtures.fixedLayoutBook,
          fontObfuscated: fixtures.fontObfuscatedBook,
          drm: fixtures.drmBook,
          zipBomb: fixtures.zipBombBook,
          docxNamedEpub: fixtures.docxNamedEpub,
          escapingSpine: fixtures.escapingSpineBook,
        },
      });
      expect(result.lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
      expect(result.ok).toBe(true);
      // Health: every check reported a line.
      expect(result.lines.length).toBeGreaterThanOrEqual(10);
    }, 180_000);
  },
);
