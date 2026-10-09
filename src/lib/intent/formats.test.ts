// @vitest-environment node
/**
 * One notion of "what this file is" — and the catalogue held to it, both ways.
 *
 * BEFORE: four answers to the same question, each written next to the code
 * that needed it. `eligibleFilesFor` branched per slug (a regex for text, a
 * regex for Markdown, a MIME list for the two image tools, `isLikelyPdf` for
 * the rest); the home picker admitted WebP and GIF, which no tool takes; the
 * guides folded JPEG into JPG with a private ternary; and nothing tied a
 * tool's `accept` row to a recogniser at all. A format could be accepted with
 * no way to recognise it, or recognised with nowhere to go, and no test could
 * see either.
 *
 * NOW the formats are DERIVED from `MIME_BY_FORMAT` (the table the server
 * validates uploads with), every `accept` label must name one of them, and
 * every one of them must be accepted somewhere — or be listed as unsupported,
 * in which case no tool may accept it, because the site says so in writing
 * ("No tool here opens HEIC photos").
 */
import { describe, expect, it } from "vitest";
import {
  EXTENSIONS_BY_FORMAT,
  MIME_BY_FORMAT,
  normalizeFormatLabel,
} from "@/lib/jobs/mime-by-format";
import { isLikelyPdf } from "@/lib/pdf/files";
import {
  sniffRasterFormat,
  unsupportedImageMessage,
} from "@/lib/pdf/image-to-pdf";
import { tools } from "@/lib/tools";
import {
  FORMATS,
  UNSUPPORTED_FORMATS,
  converterToPdf,
  formatForToken,
  formatOf,
  toolAcceptsFormat,
  type FileFormat,
} from "./formats";
import { formatFromBytes, sniffFormat } from "./sniff";

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );

/** Real leading bytes of each container, enough for every signature. */
const HEADS = {
  pdf: bytes("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj"),
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  jpg: bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "JFIF\0"),
  gif: bytes("GIF89a", [1, 0, 1, 0]),
  webp: bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 "),
  heic: bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0], "mif1heic"),
  heif: bytes([0, 0, 0, 0x18], "ftypmif1", [0, 0, 0, 0], "mif1heic"),
  avif: bytes([0, 0, 0, 0x1c], "ftypavif", [0, 0, 0, 0], "avifmif1"),
  tiffLE: bytes("II", [0x2a, 0x00, 0x08, 0, 0, 0]),
  tiffBE: bytes("MM", [0x00, 0x2a, 0, 0, 0, 0x08]),
  bmp: bytes("BM", [0x36, 0x10, 0, 0], [0, 0, 0, 0], [0x36, 0, 0, 0]),
  rtf: bytes("{\\rtf1\\ansi\\deff0 {\\fonttbl"),
  zip: bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0], "\0\0"),
  epub: bytes(
    [0x50, 0x4b, 0x03, 0x04, 0x0a, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [8, 0, 0, 0],
    "mimetypeapplication/epub+zip",
  ),
  odt: bytes(
    [0x50, 0x4b, 0x03, 0x04, 0x0a, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [8, 0, 0, 0],
    "mimetypeapplication/vnd.oasis.opendocument.text",
  ),
  ole: bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
  text: bytes("Quarterly notes\nline two\n"),
  binary: bytes([0x00, 0x13, 0x37, 0x00, 0xff, 0x00]),
} as const;

describe("the format list is the server's, one spelling each", () => {
  it("FORMATS is exactly MIME_BY_FORMAT's labels, normalised (both ways)", () => {
    const fromTable = new Set(
      Object.keys(MIME_BY_FORMAT).map(normalizeFormatLabel),
    );
    expect([...new Set(FORMATS)].sort()).toEqual([...fromTable].sort());
    // Health: a vacuous table would make every check below pass.
    expect(FORMATS.length).toBeGreaterThanOrEqual(10);
  });

  it("EXTENSIONS_BY_FORMAT is keyed by the same labels, and no extension is claimed twice", () => {
    expect(Object.keys(EXTENSIONS_BY_FORMAT).sort()).toEqual(
      Object.keys(MIME_BY_FORMAT).sort(),
    );
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const [label, exts] of Object.entries(EXTENSIONS_BY_FORMAT)) {
      // Each label is recognised by its own spelling.
      expect(exts, label).toContain(label.toLowerCase());
      for (const ext of exts) {
        if (seen.has(ext)) twice.push(`${ext}: ${seen.get(ext)} and ${label}`);
        seen.set(ext, label);
      }
    }
    expect(twice).toEqual([]);
  });

  it("normalizeFormatLabel folds the three aliases and nothing else", () => {
    expect(normalizeFormatLabel("JPEG")).toBe("JPG");
    expect(normalizeFormatLabel("htm")).toBe("HTML");
    expect(normalizeFormatLabel("Markdown")).toBe("MD");
    expect(normalizeFormatLabel("pdf")).toBe("PDF");
    expect(normalizeFormatLabel("PDF/A")).toBe("PDF/A");
    expect(normalizeFormatLabel("DOC")).toBe("DOC");
  });
});

describe("every accept label names a format, every format is accepted somewhere", () => {
  const labels = [...new Set(tools.flatMap((t) => t.accept))];

  it("finds the catalogue (health)", () => {
    expect(tools.length).toBeGreaterThanOrEqual(40);
    expect(labels.length).toBeGreaterThanOrEqual(10);
  });

  it("every accept label is a known format, except the inputs that are not files", () => {
    // URL is the one input that is not a file (Webpage to PDF takes an
    // address). Pinned as an exact list, as the upload test pins it: a filter
    // would hide a typo'd label that silently accepts nothing.
    const notFormats = labels.filter(
      (label) =>
        !(FORMATS as readonly string[]).includes(normalizeFormatLabel(label)),
    );
    expect(notFormats).toEqual(["URL"]);
  });

  it("every format is accepted by some tool", () => {
    const accepted = new Set(labels.map(normalizeFormatLabel));
    expect(FORMATS.filter((f) => !accepted.has(f))).toEqual([]);
  });

  it("no tool accepts a format the site says no tool opens", () => {
    const offenders = tools.flatMap((t) =>
      UNSUPPORTED_FORMATS.filter((f) => toolAcceptsFormat(t.accept, f)).map(
        (f) => `${t.slug} accepts ${f}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("positive control: an accept row naming an unsupported format is caught", () => {
    expect(toolAcceptsFormat(["PDF", "HEIC"], "HEIC")).toBe(true);
    expect(toolAcceptsFormat(["JPG", "JPEG", "PNG"], "JPG")).toBe(true);
    expect(toolAcceptsFormat(["JPEG"], "JPG")).toBe(true);
    expect(toolAcceptsFormat(["PDF"], "PNG")).toBe(false);
    expect(toolAcceptsFormat(["PDF"], null)).toBe(false);
  });

  it("supported and unsupported never overlap", () => {
    expect(
      UNSUPPORTED_FORMATS.filter((f) =>
        (FORMATS as readonly string[]).includes(f),
      ),
    ).toEqual([]);
  });
});

describe("formatOf reads the name, then the declared type", () => {
  it.each<[string, string, FileFormat | null]>([
    ["report.pdf", "application/pdf", "PDF"],
    ["REPORT.PDF", "", "PDF"],
    ["scan", "application/pdf", "PDF"],
    ["photo.jpeg", "image/jpeg", "JPG"],
    ["photo.JPG", "", "JPG"],
    ["logo.png", "image/png", "PNG"],
    ["letter.docx", "", "DOCX"],
    ["sheet.csv", "text/csv", "CSV"],
    ["page.htm", "text/html", "HTML"],
    ["notes.txt", "text/plain", "TXT"],
    ["readme.TEXT", "", "TXT"],
    ["README.md", "text/markdown", "MD"],
    ["draft.md", "text/plain", "MD"],
    ["notes.markdown", "", "MD"],
    ["guide.mdown", "", "MD"],
    ["no-extension", "text/x-markdown", "MD"],
    ["IMG_0042.HEIC", "image/heic", "HEIC"],
    ["photo.webp", "", "WEBP"],
    ["scan.tif", "", "TIFF"],
    ["essay.odt", "", "ODT"],
    ["archive.zip", "application/zip", "ZIP"],
    ["mystery", "image/webp", "WEBP"],
    ["payload.exe", "application/x-msdownload", null],
    ["nothing", "", null],
  ])("%s (%s) → %s", (name, type, expected) => {
    expect(formatOf({ name, type }).format).toBe(expected);
  });

  it("the extension wins over a contradicting declared type", () => {
    // Browsers derive the type FROM the extension, so the two disagree only
    // for a synthesised File. The name is the more specific claim.
    expect(
      formatOf({ name: "letter.docx", type: "application/pdf" }).format,
    ).toBe("DOCX");
    expect(formatOf({ name: "data.bin", type: "application/pdf" }).format).toBe(
      "PDF",
    );
  });

  it("agrees with isLikelyPdf on files as browsers hand them over", () => {
    const corpus = [
      { name: "a.pdf", type: "application/pdf" },
      { name: "b.PDF", type: "" },
      { name: "c", type: "application/pdf" },
      { name: "d.png", type: "image/png" },
      {
        name: "e.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      { name: "f.txt", type: "text/plain" },
      { name: "g.pdf.zip", type: "application/zip" },
      { name: "h.zip.pdf", type: "application/pdf" },
      { name: "i", type: "" },
      { name: "j.heic", type: "image/heic" },
    ];
    const disagreements = corpus
      .filter((f) => (formatOf(f).format === "PDF") !== isLikelyPdf(f))
      .map((f) => f.name);
    expect(disagreements).toEqual([]);
    // Positive control: the corpus holds both verdicts.
    expect(corpus.filter((f) => isLikelyPdf(f)).length).toBeGreaterThanOrEqual(
      3,
    );
    expect(corpus.filter((f) => !isLikelyPdf(f)).length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("never calls a file a PDF that the PDF runners would refuse (subset, any input)", () => {
    // The one direction that matters for a hand-off: a file carried as a PDF
    // must be one validatePdfFile accepts. The reverse (a runner taking a file
    // this does not carry) costs a pick, never a refusal.
    const adversarial = [
      { name: "x.docx", type: "application/pdf" },
      { name: "x.bin", type: "application/pdf" },
      { name: "x", type: "application/pdf" },
      { name: "x.pdf", type: "image/png" },
      { name: ".pdf", type: "" },
      { name: "x.pdf ", type: "" },
    ];
    expect(
      adversarial
        .filter((f) => formatOf(f).format === "PDF" && !isLikelyPdf(f))
        .map((f) => f.name),
    ).toEqual([]);
  });
});

describe("the bytes win when there are bytes", () => {
  it.each<[keyof typeof HEADS, string, FileFormat | null]>([
    ["pdf", "report.pdf", "PDF"],
    ["png", "logo.png", "PNG"],
    ["jpg", "photo.jpg", "JPG"],
    ["gif", "anim.gif", "GIF"],
    ["webp", "photo.webp", "WEBP"],
    ["heic", "IMG_1.heic", "HEIC"],
    ["heif", "IMG_1.heif", "HEIF"],
    ["avif", "pic.avif", "AVIF"],
    ["tiffLE", "scan.tif", "TIFF"],
    ["tiffBE", "scan.tiff", "TIFF"],
    ["bmp", "old.bmp", "BMP"],
    ["rtf", "memo.rtf", "RTF"],
    ["zip", "letter.docx", "DOCX"],
    ["zip", "sheet.xlsx", "XLSX"],
    ["zip", "deck.pptx", "PPTX"],
    ["zip", "bundle.zip", "ZIP"],
    ["zip", "mystery", "ZIP"],
    ["epub", "book.zip", "EPUB"],
    ["odt", "essay", "ODT"],
    ["ole", "old.doc", "DOC"],
    ["ole", "old.xls", "XLS"],
    ["ole", "old.ppt", "PPT"],
    ["ole", "mail.msg", null],
    ["text", "notes.txt", "TXT"],
    ["text", "README.md", "MD"],
    ["text", "data.csv", "CSV"],
    ["text", "page.html", "HTML"],
    ["text", "mystery", null],
    ["binary", "notes.txt", null],
  ])("%s bytes named %s → %s", (head, name, expected) => {
    expect(sniffFormat(HEADS[head], name)).toBe(expected);
  });

  it("finds a PDF header anywhere in the first 1024 bytes, and not after", () => {
    const at = (offset: number) => {
      const head = new Uint8Array(offset + 16).fill(0x20);
      head.set(HEADS.pdf.subarray(0, 8), offset);
      return head;
    };
    expect(sniffFormat(at(0), "x")).toBe("PDF");
    expect(sniffFormat(at(1000), "x")).toBe("PDF");
    expect(sniffFormat(at(1100), "x")).toBeNull();
  });

  it("does not read a text file that happens to start with BM as a bitmap", () => {
    expect(sniffFormat(bytes("BMW fleet report\n2024\n"), "fleet.txt")).toBe(
      "TXT",
    );
  });

  it("records the name a renamed file was wearing", () => {
    expect(
      formatFromBytes(
        { name: "report.pdf", type: "application/pdf" },
        HEADS.png,
      ),
    ).toEqual({
      format: "PNG",
      renamedFrom: "PDF",
      by: "bytes",
    });
    expect(
      formatFromBytes({ name: "notes.txt", type: "text/plain" }, HEADS.binary),
    ).toEqual({
      format: null,
      renamedFrom: "TXT",
      by: "bytes",
    });
    // Agreement is not a rename.
    expect(
      formatFromBytes({ name: "report.pdf", type: "" }, HEADS.pdf),
    ).toEqual({
      format: "PDF",
      renamedFrom: null,
      by: "bytes",
    });
    // Bytes with no signature cannot overrule a name that has none to show.
    expect(
      formatFromBytes({ name: "letter.docx", type: "" }, HEADS.text).format,
    ).toBe("DOCX");
  });

  it("agrees with the image engine about PNG and JPEG bytes", () => {
    // `sniffRasterFormat` chooses the decoder in imagesToPdf. A file this
    // module calls a PNG must be one the engine decodes as a PNG.
    const corpus = Object.values(HEADS);
    const disagreements = corpus.filter((head) => {
      const engine = sniffRasterFormat(head);
      const ours = sniffFormat(head, "x");
      return (
        (engine === "png") !== (ours === "PNG") ||
        (engine === "jpg") !== (ours === "JPG")
      );
    });
    expect(disagreements).toEqual([]);
  });

  it("names an unsupported image the way the image tools' refusal names it", () => {
    // The image runners refuse with `"x" is a WebP image.` — read from the
    // engine's own message, so the two recognisers cannot drift apart.
    const engineLabel: Partial<Record<FileFormat, string>> = {
      WEBP: "WebP",
      GIF: "GIF",
      BMP: "BMP",
      TIFF: "TIFF",
      AVIF: "AVIF",
      HEIC: "HEIC",
      HEIF: "HEIC",
    };
    const rows = (
      [
        "webp",
        "gif",
        "bmp",
        "tiffLE",
        "tiffBE",
        "avif",
        "heic",
        "heif",
      ] as const
    ).map((key) => {
      const ours = sniffFormat(HEADS[key], "x")!;
      return [key, ours, unsupportedImageMessage("x", HEADS[key])] as const;
    });
    for (const [key, ours, message] of rows) {
      expect(engineLabel[ours], key).toBeDefined();
      expect(message, key).toContain(`is a ${engineLabel[ours]} image`);
    }
  });
});

describe("tokens a person types for a format", () => {
  it("maps extensions and labels to formats, case-insensitively", () => {
    expect(formatForToken("jpeg")).toBe("JPG");
    expect(formatForToken("HTM")).toBe("HTML");
    expect(formatForToken("heic")).toBe("HEIC");
    expect(formatForToken("tif")).toBe("TIFF");
    expect(formatForToken("docx")).toBe("DOCX");
    expect(formatForToken("word")).toBeNull();
    expect(formatForToken("webpage")).toBeNull();
  });
});

describe("the tool that turns a format into a PDF", () => {
  it("is the tool whose own format it is, else the first that takes it", () => {
    const slug = (format: FileFormat) =>
      converterToPdf(format, tools)?.slug ?? null;
    expect(slug("JPG")).toBe("jpg-to-pdf");
    expect(slug("PNG")).toBe("png-to-pdf");
    expect(slug("DOCX")).toBe("word-to-pdf");
    expect(slug("DOC")).toBe("word-to-pdf");
    expect(slug("CSV")).toBe("excel-to-pdf");
    expect(slug("PPTX")).toBe("powerpoint-to-pdf");
    expect(slug("HTML")).toBe("html-to-pdf");
    expect(slug("MD")).toBe("markdown-to-pdf");
    expect(slug("TXT")).toBe("text-to-pdf");
    // A PDF needs no converter, and nothing here opens HEIC.
    expect(slug("PDF")).toBeNull();
    expect(slug("HEIC")).toBeNull();
  });
});
