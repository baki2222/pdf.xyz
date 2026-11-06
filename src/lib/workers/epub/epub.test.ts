// @vitest-environment node
/**
 * EPUB to PDF without a browser: the bounded ZIP, the package chain, the
 * refusals, and what the engine hands Chromium — each against books BUILT by
 * `@/tests/epub-fixtures`. The real-Chromium half is `epub.chromium.test.ts`.
 *
 * Every refusal is also checked to happen BEFORE Chromium: the runner stand-in
 * counts its calls, and a refusal that still rendered is a failure.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  bookDocuments,
  epubRefusalMessage,
  fixedLayoutPrintParams,
  runEpubToPdf,
  type EpubRenderDeps,
} from "./engine";
import {
  chapterUrl,
  entryPathOfUrl,
  openEpub,
  resolveInBook,
  type EpubBook,
} from "./package";
import { openBoundedZip, ZipEntryError } from "./zip";
import {
  EPUB_MAX_ENTRIES,
  EPUB_MAX_ENTRY_RATIO,
  EPUB_MAX_SPINE_ITEMS,
  EPUB_MAX_UNPACKED_BYTES,
} from "./native-config";
import { DEFAULT_EPUB_RENDER_OPTIONS } from "@/lib/jobs/epub-render-options";
import { HTML_DOCUMENT_URL } from "../html-render/document-url";
import {
  docxNamedEpub,
  drmBook,
  epub2Book,
  epub3Book,
  escapingSpineBook,
  fixedLayoutBook,
  fontObfuscatedBook,
  zipBombBook,
} from "@/tests/epub-fixtures";

function open(bytes: Uint8Array): EpubBook {
  const opened = openEpub(bytes);
  if (!opened.ok) throw new Error(`refused: ${opened.refusal.kind}`);
  return opened.book;
}

/** A runner stand-in: one tiny PDF per document, and a call count. */
function counting() {
  let calls = 0;
  const deps: EpubRenderDeps = {
    chromium: {
      renderPackage: async (pkg) => {
        calls += 1;
        const { PDFDocument } = await import("pdf-lib");
        return Promise.all(
          pkg.documents.map(async () => {
            const doc = await PDFDocument.create();
            doc.addPage([300, 400]);
            return doc.save();
          }),
        );
      },
    },
    limits: { maxInputBytes: 50 * 1024 * 1024, timeoutMs: 120_000 },
  };
  return { deps, calls: () => calls };
}

async function refusalOf(bytes: Uint8Array) {
  const { deps, calls } = counting();
  const run = await runEpubToPdf(bytes, deps);
  expect(run.ok).toBe(false);
  expect(calls(), "a refused book still reached Chromium").toBe(0);
  return run as Extract<typeof run, { ok: false }>;
}

describe("paths inside the book", () => {
  it("resolves relative, encoded and dotted references within the root", () => {
    expect(resolveInBook("OEBPS/Text/", "../Images/a%20b.png")).toBe(
      "OEBPS/Images/a b.png",
    );
    expect(resolveInBook("OEBPS/", "./Text/c.xhtml#frag")).toBe(
      "OEBPS/Text/c.xhtml",
    );
    expect(resolveInBook("OEBPS/", "/META-INF/container.xml")).toBe(
      "META-INF/container.xml",
    );
  });

  it("REFUSES a reference that climbs above the root — never clamps it", () => {
    expect(resolveInBook("OEBPS/", "../../outside.xhtml")).toBeNull();
    expect(resolveInBook("", "../x")).toBeNull();
    // Encoded dots and slashes are decoded BEFORE the dots are applied.
    expect(resolveInBook("OEBPS/", "%2e%2e%2f%2e%2e%2fx")).toBeNull();
    expect(resolveInBook("a/", "..%2F..%2Fx")).toBeNull();
    // Not paths at all.
    expect(resolveInBook("", "https://example.com/x")).toBeNull();
    expect(resolveInBook("", "file:///etc/passwd")).toBeNull();
    expect(resolveInBook("", "a\\..\\b")).toBeNull();
  });

  it("a URL is served only at the synthetic origin, and its decoded path may not escape", () => {
    expect(entryPathOfUrl(`${HTML_DOCUMENT_URL}OEBPS/a.css`)).toBe(
      "OEBPS/a.css",
    );
    expect(entryPathOfUrl(`${HTML_DOCUMENT_URL}a%2F..%2F..%2Fx`)).toBeNull();
    expect(entryPathOfUrl("https://example.com/OEBPS/a.css")).toBeNull();
    expect(entryPathOfUrl(chapterUrl("OEBPS/Text/a b.xhtml"))).toBe(
      "OEBPS/Text/a b.xhtml",
    );
  });
});

describe("the bounded ZIP", () => {
  it("refuses more entries than the limit, before inflating anything", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    for (let i = 0; i < EPUB_MAX_ENTRIES; i++) zip.file(`f${i}`, "");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(openBoundedZip(bytes)).toMatchObject({
      ok: false,
      refusal: { kind: "bomb", limit: "entries" },
    });
    // Control: one fewer is opened.
    zip.remove(`f${EPUB_MAX_ENTRIES - 1}`);
    const fewer = await zip.generateAsync({ type: "uint8array" });
    expect(openBoundedZip(fewer).ok).toBe(true);
  });

  it("refuses a file that grows past the ratio, and opens one just under it", async () => {
    const bomb = openBoundedZip(await zipBombBook());
    expect(bomb).toMatchObject({
      ok: false,
      refusal: { kind: "bomb", limit: "ratio" },
    });
    // Control: the same book without the bomb opens.
    expect(openBoundedZip(await epub3Book()).ok).toBe(true);
  });

  it("refuses more unpacked bytes than the limit, summed from the directory", async () => {
    const bytes = await epub3Book();
    // Declare one entry's unpacked size as the whole limit: the sum crosses it.
    const patched = patchDeclaredSize(bytes, "OEBPS/content.opf", EPUB_MAX_UNPACKED_BYTES);
    expect(openBoundedZip(patched)).toMatchObject({
      ok: false,
      refusal: { kind: "bomb", limit: "unpacked" },
    });
  });

  it("a file whose directory understates its size is never inflated past it", async () => {
    const bytes = await epub3Book();
    const lying = patchDeclaredSize(bytes, "OEBPS/content.opf", 10);
    const opened = openBoundedZip(lying);
    if (!opened.ok) throw new Error("expected the directory to open");
    expect(() => opened.zip.read("OEBPS/content.opf")).toThrow(ZipEntryError);
    // And the book is refused, as unreadable, before Chromium.
    const run = await refusalOf(lying);
    expect(run).toMatchObject({ kind: "refused", refusal: { kind: "no_package" } });
  });

  it("a chapter whose directory understates its size is refused, not printed as a 404", async () => {
    const lying = patchDeclaredSize(await epub3Book(), "OEBPS/Text/m-ch.xhtml", 10);
    const run = await refusalOf(lying);
    expect(run).toMatchObject({ kind: "refused", refusal: { kind: "unreadable" } });
  });
});

/** Rewrite one entry's declared unpacked size in the central directory. */
function patchDeclaredSize(bytes: Uint8Array, name: string, size: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  const want = new TextEncoder().encode(name);
  for (let i = 0; i + 46 < out.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(i + 28, true);
    const entry = out.subarray(i + 46, i + 46 + nameLength);
    if (entry.length === want.length && entry.every((c, k) => c === want[k])) {
      view.setUint32(i + 24, size, true);
      return out;
    }
  }
  throw new Error(`no central entry ${name}`);
}

describe("opening a book", () => {
  it("EPUB 3: spine order (not file or manifest order), nav outline, title, types", async () => {
    const book = open(await epub3Book());
    expect(book.chapters.map((c) => c.path)).toEqual([
      "OEBPS/Text/m-ch.xhtml",
      "OEBPS/Text/z-ch.xhtml",
      "OEBPS/Text/a-ch.xhtml",
    ]);
    expect(book.title).toBe("The Lanternfly Proof");
    expect(book.language).toBe("en");
    expect(book.tocSource).toBe("nav");
    expect(
      book.toc.map((e) => [e.title, e.chapter, e.children.map((c) => [c.title, c.chapter])]),
    ).toEqual([
      ["Part One Quillfeather", 0, []],
      [
        "Later parts",
        1,
        [
          ["Part Two Marrowgate", 1],
          ["Part Three Zephyrine", 2],
        ],
      ],
    ]);
    expect(book.serve(`${HTML_DOCUMENT_URL}OEBPS/Styles/book.css`)?.contentType).toBe("text/css");
    expect(book.serve(`${HTML_DOCUMENT_URL}OEBPS/Images/blue.png`)?.contentType).toBe("image/png");
    expect(book.serve(chapterUrl("OEBPS/Text/m-ch.xhtml"))?.contentType).toBe(
      "application/xhtml+xml",
    );
    expect(book.serve(`${HTML_DOCUMENT_URL}OEBPS/nope.css`)).toBeNull();
  });

  it("EPUB 2: the NCX is the outline, nested", async () => {
    const book = open(await epub2Book());
    expect(book.tocSource).toBe("ncx");
    expect(book.chapters.map((c) => c.path)).toEqual(["one.html", "two.html"]);
    expect(book.toc.map((e) => [e.title, e.chapter, e.children.length])).toEqual([
      ["Part One Quillfeather", 0, 1],
      ["Part Two Marrowgate", 1, 0],
    ]);
  });

  it("a DRM'd book is refused, with the DRM sentence, before Chromium", async () => {
    const run = await refusalOf(await drmBook());
    expect(run).toMatchObject({ kind: "refused", refusal: { kind: "drm" } });
    expect(run.message).toMatch(/protected by DRM/);
  });

  it("a font-obfuscated book is NOT DRM: it opens, and the font is never served", async () => {
    const book = open(await fontObfuscatedBook());
    expect([...book.obfuscatedFonts]).toEqual(["OEBPS/Fonts/body.otf"]);
    expect(book.serve(`${HTML_DOCUMENT_URL}OEBPS/Fonts/body.otf`)).toBeNull();
    // Control: the same path is served when it is not obfuscated.
    const plain = open(
      await epub3Book({ extra: { "OEBPS/Fonts/body.otf": new Uint8Array(8) } }),
    );
    expect(plain.serve(`${HTML_DOCUMENT_URL}OEBPS/Fonts/body.otf`)).not.toBeNull();
    const { deps, calls } = counting();
    const run = await runEpubToPdf(await fontObfuscatedBook(), deps);
    expect(run.ok).toBe(true);
    expect(calls()).toBe(1);
    if (run.ok) expect(run.meta.fontsLeftOut).toBe(1);
  });

  it("a ZIP bomb is refused, before Chromium", async () => {
    const run = await refusalOf(await zipBombBook());
    expect(run).toMatchObject({ kind: "refused", refusal: { kind: "bomb", limit: "ratio" } });
    expect(run.message).toContain(`${EPUB_MAX_ENTRY_RATIO} times`);
  });

  it("a .docx named .epub is refused by its CONTENTS, before Chromium", async () => {
    const run = await refusalOf(await docxNamedEpub());
    expect(run).toMatchObject({ kind: "refused", refusal: { kind: "not_epub" } });
  });

  it("a spine reference that escapes the root is refused, and the file it reaches is never served", async () => {
    const run = await refusalOf(await escapingSpineBook());
    expect(run).toMatchObject({ kind: "refused", refusal: { kind: "escapes_root" } });
    // The file the escape would have clamped to exists at the root of the ZIP.
    const zip = openBoundedZip(await escapingSpineBook());
    expect(zip.ok && zip.zip.has("outside.xhtml")).toBe(true);
  });

  it("too many chapters is refused with the number and the limit", async () => {
    const hrefs = Array.from({ length: EPUB_MAX_SPINE_ITEMS + 1 }, () => "Text/m-ch.xhtml");
    const run = await refusalOf(await epub3Book({ spineHrefs: hrefs }));
    expect(run).toMatchObject({ kind: "refused", refusal: { kind: "too_many_chapters" } });
    expect(run.message).toContain(String(EPUB_MAX_SPINE_ITEMS));
    // Control: exactly the limit opens.
    expect(openEpub(await epub3Book({ spineHrefs: hrefs.slice(1) })).ok).toBe(true);
  });

  it("a file over the ceiling is refused with the ceiling, before it is opened", async () => {
    const { deps, calls } = counting();
    const run = await runEpubToPdf(new Uint8Array(11), {
      ...deps,
      limits: { maxInputBytes: 10 },
    });
    expect(run).toMatchObject({ ok: false, kind: "too_large", limitBytes: 10 });
    expect(calls()).toBe(0);
  });
});

describe("what Chromium is asked to print", () => {
  it("reflowable chapters on the chosen paper; fixed-layout pages at their viewport, edge to edge, one page", async () => {
    const reflow = bookDocuments(open(await epub3Book()), DEFAULT_EPUB_RENDER_OPTIONS);
    expect(reflow.map((d) => d.url)).toEqual([
      chapterUrl("OEBPS/Text/m-ch.xhtml"),
      chapterUrl("OEBPS/Text/z-ch.xhtml"),
      chapterUrl("OEBPS/Text/a-ch.xhtml"),
    ]);
    expect(reflow[0]!.printParams).toMatchObject({
      paperWidth: 148 / 25.4,
      paperHeight: 210 / 25.4,
      marginTop: 0.4,
      preferCSSPageSize: false,
    });
    const fixed = bookDocuments(open(await fixedLayoutBook()), DEFAULT_EPUB_RENDER_OPTIONS);
    expect(fixed.map((d) => d.viewport)).toEqual([
      { width: 600, height: 800 },
      { width: 600, height: 800 },
    ]);
    expect(fixed[0]!.printParams).toEqual(fixedLayoutPrintParams({ width: 600, height: 800 }));
    expect(fixed[0]!.printParams).toMatchObject({ paperWidth: 6.25, pageRanges: "1", marginLeft: 0 });
  });

  it("joins the chapters in order, with the book's title and an outline", async () => {
    const { deps } = counting();
    const run = await runEpubToPdf(await epub3Book(), deps);
    if (!run.ok) throw new Error(run.message);
    expect(run.meta).toMatchObject({ chapters: 3, pages: 3, bookmarks: 4 });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(run.output);
    expect(doc.getTitle()).toBe("The Lanternfly Proof");
    expect(doc.getPageCount()).toBe(3);
  });

  it("every refusal has its own sentence, and each names what to do or why", () => {
    const kinds = [
      { kind: "not_epub" },
      { kind: "unreadable" },
      { kind: "bomb", limit: "entries" },
      { kind: "bomb", limit: "unpacked" },
      { kind: "bomb", limit: "ratio" },
      { kind: "drm" },
      { kind: "no_package" },
      { kind: "missing_item" },
      { kind: "escapes_root" },
      { kind: "no_chapters" },
      { kind: "too_many_chapters", count: 999 },
    ] as const;
    const messages = kinds.map((k) => epubRefusalMessage(k));
    expect(new Set(messages).size).toBe(kinds.length);
    expect(messages[2]).toContain(EPUB_MAX_ENTRIES.toLocaleString("en-US"));
    expect(messages[3]).toContain(`${EPUB_MAX_UNPACKED_BYTES / 1024 / 1024} MB`);
  });
});
