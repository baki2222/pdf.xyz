/**
 * EPUB to PDF: open the book within bounds (`./package`, `./zip`), print each
 * chapter in reading order with the HTML renderer's Chromium — scripts off,
 * nothing fetched but the book's own files — and join the chapters into one
 * PDF with bookmarks from the book's table of contents.
 *
 * Reflowable chapters print on the paper and margins chosen
 * (`@/lib/jobs/epub-render-options`, through the HTML renderer's own
 * `planPrint`); a fixed-layout page prints at the viewport it declares, edge
 * to edge, one PDF page each.
 */
import { describeByteCeiling } from "../engine-file-ceilings";
import { rethrowIfAttemptAbort, signalOption } from "../attempt-abort";
import { CSS_PX_PER_INCH } from "@/lib/jobs/html-render-options";
import {
  DEFAULT_EPUB_RENDER_OPTIONS,
  type EpubRenderOptions,
} from "@/lib/jobs/epub-render-options";
import { planPrint, PRINT_TO_PDF_OPTIONS } from "../html-render/print-params";
import type {
  ChromiumPackageRunner,
  PackageDocument,
} from "../html-render/engine";
import { HTML_DOCUMENT_URL } from "../html-render/document-url";
import {
  EPUB_MAX_ENTRIES,
  EPUB_MAX_ENTRY_RATIO,
  EPUB_MAX_SPINE_ITEMS,
  EPUB_MAX_UNPACKED_BYTES,
} from "./native-config";
import {
  chapterUrl,
  entryPathOfUrl,
  openEpub,
  type EpubBook,
  type EpubRefusal,
  type EpubTocEntry,
} from "./package";

export { EPUB_TO_PDF_TOOL, EPUB_TOOLS } from "./tools";

export const EPUB_RENDER_ENGINE = "chromium" as const;

export interface EpubRenderDeps {
  chromium?: ChromiumPackageRunner;
  limits?: { maxInputBytes?: number; timeoutMs?: number };
}

export interface EpubRenderResultMeta {
  engine: typeof EPUB_RENDER_ENGINE;
  inputBytes: number;
  outputBytes: number;
  chapters: number;
  pages: number;
  bookmarks: number;
  fixedLayoutPages: number;
  fontsLeftOut: number;
}

export type EpubRun =
  | { ok: true; output: Uint8Array; meta: EpubRenderResultMeta }
  | { ok: false; kind: "unsupported"; message: string }
  | { ok: false; kind: "too_large"; limitBytes: number; message: string }
  /** The book itself cannot be converted: final. */
  | { ok: false; kind: "refused"; refusal: EpubRefusal; message: string }
  /** Ran past the time bound: final, the same book runs as long again. */
  | { ok: false; kind: "timeout"; message: string }
  | { ok: false; kind: "failed"; message: string };

const MIB = 1024 * 1024;

/** The sentence a reader gets for each refusal. The one place it is written. */
export function epubRefusalMessage(refusal: EpubRefusal): string {
  const damaged =
    "The book is damaged; export it again from the program that made it and try again.";
  switch (refusal.kind) {
    case "not_epub":
      return "This file's contents are not an EPUB book (an EPUB is a ZIP archive whose first file names its type), so nothing was converted. Export the book again as EPUB and try again.";
    case "unreadable":
      return `This EPUB's ZIP archive could not be read, so nothing was converted. ${damaged}`;
    case "bomb":
      if (refusal.limit === "entries")
        return `This EPUB holds more than ${EPUB_MAX_ENTRIES.toLocaleString("en-US")} files, the most EPUB to PDF opens, so nothing was converted. Remove the files the book does not use, or split it into parts, and try again.`;
      if (refusal.limit === "unpacked")
        return `This EPUB unpacks to more than ${EPUB_MAX_UNPACKED_BYTES / MIB} MB, the most EPUB to PDF unpacks, so nothing was converted. Shrink its images, or split it into parts, and try again.`;
      return `A file inside this EPUB unpacks to more than ${EPUB_MAX_ENTRY_RATIO} times its packed size, the shape of a ZIP bomb, so nothing was converted. Books saved by e-book software do not do this; export it again and try again.`;
    case "drm":
      return "This book is protected by DRM (its contents are encrypted), so it cannot be converted. Only DRM-free EPUBs can be turned into PDFs.";
    case "no_package":
      return `This EPUB has no readable package file (META-INF/container.xml and the .opf file it names), so nothing was converted. ${damaged}`;
    case "missing_item":
      return `This EPUB's reading order names a file that is not in the book, so nothing was converted. ${damaged}`;
    case "escapes_root":
      return `This EPUB's reading order names a file outside the book, so nothing was converted. ${damaged}`;
    case "no_chapters":
      return "This EPUB's reading order lists no chapters, so there was nothing to convert.";
    case "too_many_chapters":
      return `This book has ${refusal.count.toLocaleString("en-US")} chapter files; EPUB to PDF prints at most ${EPUB_MAX_SPINE_ITEMS} per book, so nothing was converted. Split it into parts with an e-book editor and convert each one.`;
  }
}

/** The print arguments of a fixed-layout page: its viewport, edge to edge. */
export function fixedLayoutPrintParams(viewport: {
  width: number;
  height: number;
}): Record<string, unknown> {
  return {
    ...PRINT_TO_PDF_OPTIONS,
    preferCSSPageSize: false,
    landscape: false,
    paperWidth: viewport.width / CSS_PX_PER_INCH,
    paperHeight: viewport.height / CSS_PX_PER_INCH,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    // One page: what overflows the viewport is cut, as a reader shows it.
    pageRanges: "1",
  };
}

/** What Chromium is asked to print, chapter by chapter, in reading order. */
export function bookDocuments(
  book: EpubBook,
  options: EpubRenderOptions,
): PackageDocument[] {
  const reflow = planPrint({
    pageSize: options.pageSize,
    orientation: "portrait",
    margin: options.margin,
    viewport: "auto",
    onePage: false,
  }).printParams();
  return book.chapters.map((chapter) => ({
    url: chapterUrl(chapter.path),
    viewport: chapter.viewport,
    printParams: chapter.viewport
      ? fixedLayoutPrintParams(chapter.viewport)
      : reflow,
  }));
}

/**
 * Run EPUB to PDF. Every refusal is decided before Chromium starts, except a
 * timeout and a crash.
 */
export async function runEpubToPdf(
  input: Uint8Array,
  deps: EpubRenderDeps,
  options: EpubRenderOptions = DEFAULT_EPUB_RENDER_OPTIONS,
  signal?: AbortSignal,
): Promise<EpubRun> {
  const limit = deps.limits?.maxInputBytes;
  if (limit !== undefined && input.byteLength > limit)
    return {
      ok: false,
      kind: "too_large",
      limitBytes: limit,
      message: `This EPUB is larger than ${describeByteCeiling(limit)}, the most EPUB to PDF converts per file. Shrink its images, or split it into parts, and try again.`,
    };
  const opened = openEpub(input);
  if (!opened.ok)
    return {
      ok: false,
      kind: "refused",
      refusal: opened.refusal,
      message: epubRefusalMessage(opened.refusal),
    };
  if (!deps.chromium)
    return {
      ok: false,
      kind: "unsupported",
      message:
        "EPUB conversion requires the native Chromium renderer, which is not installed in this environment.",
    };
  const book = opened.book;
  const documents = bookDocuments(book, options);
  let parts: Uint8Array[];
  try {
    parts = await deps.chromium.renderPackage(
      { documents, serve: (url) => book.serve(url) },
      signalOption(signal),
    );
  } catch (error) {
    rethrowIfAttemptAbort(error);
    if (error instanceof Error && /timed out/i.test(error.message)) {
      const seconds = Math.round((deps.limits?.timeoutMs ?? 0) / 1000);
      return {
        ok: false,
        kind: "timeout",
        message: `This book took longer than ${seconds > 0 ? `${seconds} seconds` : "the time limit"} to print, the most one conversion may take, so nothing was converted. Split it into parts with an e-book editor and convert each one.`,
      };
    }
    return {
      ok: false,
      kind: "failed",
      message: "Chromium could not render this book.",
    };
  }
  if (parts.length !== documents.length)
    return {
      ok: false,
      kind: "failed",
      message: "Chromium could not render this book.",
    };
  let joined: Awaited<ReturnType<typeof joinChapters>>;
  try {
    joined = await joinChapters(book, parts);
  } catch {
    return {
      ok: false,
      kind: "failed",
      message: "Chromium produced no usable PDF output.",
    };
  }
  return {
    ok: true,
    output: joined.bytes,
    meta: {
      engine: EPUB_RENDER_ENGINE,
      inputBytes: input.byteLength,
      outputBytes: joined.bytes.byteLength,
      chapters: book.chapters.length,
      pages: joined.pages,
      bookmarks: joined.bookmarks,
      fixedLayoutPages: book.chapters.filter((c) => c.viewport).length,
      fontsLeftOut: book.obfuscatedFonts.size,
    },
  };
}

/**
 * The chapters' PDFs as one, through the ONE page copier (`@/lib/pdf/page-copy`),
 * then: the book's title and language on the document, a bookmark per
 * table-of-contents entry opening its chapter's first page, and every link
 * that pointed at another file of the book (Chromium writes those as links
 * to the synthetic origin) pointed at that chapter's first page instead —
 * or removed, when it names no chapter, so no link in the PDF leads to an
 * address that does not exist.
 */
async function joinChapters(
  book: EpubBook,
  parts: Uint8Array[],
): Promise<{ bytes: Uint8Array; pages: number; bookmarks: number }> {
  const lib = await import("pdf-lib");
  const { assemblePages } = await import("@/lib/pdf/page-copy");
  const docs = await Promise.all(
    parts.map((bytes) => lib.PDFDocument.load(bytes)),
  );
  const { out, pages } = await assemblePages(
    lib,
    docs.map((doc) => ({ doc, indices: doc.getPageIndices() })),
    { documentState: "merge" },
  );
  const firstPage: number[] = [];
  let at = 0;
  for (const doc of docs) {
    firstPage.push(at);
    at += doc.getPageCount();
  }
  const pageRef = (chapter: number) =>
    pages[firstPage[chapter] ?? -1]?.ref ?? null;

  if (book.title) out.setTitle(book.title);
  if (book.language) out.setLanguage(book.language);
  out.setProducer("pdf.xyz EPUB to PDF (Chromium)");

  const chapterOfPath = new Map<string, number>();
  book.chapters.forEach((c, i) => {
    if (!chapterOfPath.has(c.path)) chapterOfPath.set(c.path, i);
  });
  relinkBookLinks(lib, pages, (url) => {
    const path = entryPathOfUrl(url);
    const chapter = path === null ? undefined : chapterOfPath.get(path);
    return chapter === undefined ? null : pageRef(chapter);
  });
  const bookmarks = writeBookmarks(lib, out, book.toc, pageRef);
  return {
    bytes: await out.save({ useObjectStreams: false }),
    pages: pages.length,
    bookmarks,
  };
}

type PdfLib = typeof import("pdf-lib");
type PdfRef = import("pdf-lib").PDFRef;

function relinkBookLinks(
  lib: PdfLib,
  pages: import("pdf-lib").PDFPage[],
  target: (url: string) => PdfRef | null,
): void {
  const { PDFName, PDFDict, PDFArray, PDFString, PDFHexString } = lib;
  for (const page of pages) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i -= 1) {
      const annot = annots.lookupMaybe(i, PDFDict);
      const action = annot?.lookupMaybe(PDFName.of("A"), PDFDict);
      if (!annot || !action) continue;
      if (action.get(PDFName.of("S")) !== PDFName.of("URI")) continue;
      const uri = action.lookup(PDFName.of("URI"));
      const text =
        uri instanceof PDFString || uri instanceof PDFHexString
          ? uri.decodeText()
          : "";
      if (!text.startsWith(HTML_DOCUMENT_URL)) continue;
      const ref = target(text);
      if (ref) {
        annot.delete(PDFName.of("A"));
        annot.set(
          PDFName.of("Dest"),
          page.doc.context.obj([ref, PDFName.of("Fit")]),
        );
      } else annots.remove(i);
    }
  }
}

/** Write the table of contents as the PDF outline; returns entries written. */
function writeBookmarks(
  lib: PdfLib,
  out: import("pdf-lib").PDFDocument,
  toc: EpubTocEntry[],
  pageRef: (chapter: number) => PdfRef | null,
): number {
  const { PDFName, PDFHexString } = lib;
  const ctx = out.context;
  let written = 0;
  const write = (items: EpubTocEntry[], parent: PdfRef): PdfRef[] => {
    const usable = items.filter((item) => pageRef(item.chapter));
    const refs = usable.map(() => ctx.nextRef());
    usable.forEach((item, i) => {
      written += 1;
      const dict = ctx.obj({});
      dict.set(PDFName.of("Title"), PDFHexString.fromText(item.title));
      dict.set(PDFName.of("Parent"), parent);
      if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]!);
      if (i < usable.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]!);
      const kids = write(item.children, refs[i]!);
      if (kids.length > 0) {
        dict.set(PDFName.of("First"), kids[0]!);
        dict.set(PDFName.of("Last"), kids[kids.length - 1]!);
        // Closed: a long book's outline opens at its top level.
        dict.set(PDFName.of("Count"), ctx.obj(-kids.length));
      }
      dict.set(
        PDFName.of("Dest"),
        ctx.obj([pageRef(item.chapter)!, PDFName.of("Fit")]),
      );
      ctx.assign(refs[i]!, dict);
    });
    return refs;
  };
  const rootRef = ctx.nextRef();
  const top = write(toc, rootRef);
  if (top.length === 0) return 0;
  ctx.assign(
    rootRef,
    ctx.obj({
      Type: "Outlines",
      First: top[0]!,
      Last: top[top.length - 1]!,
      Count: top.length,
    }),
  );
  out.catalog.set(PDFName.of("Outlines"), rootRef);
  return written;
}
