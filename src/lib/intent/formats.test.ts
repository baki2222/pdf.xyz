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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UNSUPPORTED_ANSWERS } from "@/lib/tools/intents";
import { unsupportedAnswer, unsupportedWords } from "./unsupported";
import {
  EXTENSIONS_BY_FORMAT,
  MIME_BY_FORMAT,
  normalizeFormatLabel,
} from "@/lib/jobs/mime-by-format";
import { isLikelyPdf } from "@/lib/pdf/files";
import {
  sniffImageFormat,
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
  type UnsupportedFormat,
} from "./formats";
import { formatFromBytes, sniffFormat } from "./sniff";

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );

/**
 * A ZIP's first local header holding a `mimetype` entry, as OpenDocument and
 * EPUB write it. INVERTED 2026-11-04: the fixtures here recorded a size of 0
 * and a sniffer that read 60 bytes past the name passed them; the sniffer now
 * reads the stored size, so the fixtures carry one.
 */
function storedMimetype(
  type: string,
  method = 0,
  streamed = false,
): Uint8Array {
  const size = streamed
    ? [0, 0, 0, 0]
    : [type.length & 0xff, type.length >> 8, 0, 0];
  return bytes(
    [0x50, 0x4b, 0x03, 0x04, 0x0a, 0, streamed ? 8 : 0, 0, method, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    size,
    size,
    [8, 0, 0, 0],
    "mimetype" + type,
    // What follows the value: a streamed entry's data descriptor.
    streamed ? [0x50, 0x4b, 0x07, 0x08] : [],
  );
}

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
  epub: storedMimetype("application/epub+zip"),
  odt: storedMimetype("application/vnd.oasis.opendocument.text"),
  ods: storedMimetype("application/vnd.oasis.opendocument.spreadsheet"),
  odp: storedMimetype("application/vnd.oasis.opendocument.presentation"),
  // A template's type begins with the document's: it is not the document.
  ott: storedMimetype("application/vnd.oasis.opendocument.text-template"),
  // The right type, DEFLATED: the spec says stored, so it is not read.
  odtDeflated: storedMimetype("application/vnd.oasis.opendocument.text", 8),
  // Streamed (sizes after the data, flag bit 3), as some writers store it.
  odtStreamed: storedMimetype(
    "application/vnd.oasis.opendocument.text",
    0,
    true,
  ),
  // An RTF memo that quotes a PDF header in its first kilobyte.
  rtfQuotingPdf: bytes("{\\rtf1\\ansi see %PDF-1.4 in the appendix}"),
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
    ["odt", "essay.odt", "ODT"],
    ["ods", "budget.ods", "ODS"],
    ["odp", "deck.odp", "ODP"],
    // The stored type wins over the name, both ways (2026-11-04).
    ["ods", "essay.odt", "ODS"],
    ["odt", "letter.docx", "ODT"],
    ["zip", "essay.odt", "ZIP"],
    ["ott", "essay.odt", "ZIP"],
    ["odtDeflated", "essay.odt", "ZIP"],
    ["odtStreamed", "essay.odt", "ODT"],
    ["rtfQuotingPdf", "memo.rtf", "RTF"],
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
    // HISTORY: WebP, GIF and BMP were rows here until 2026-10-30, when the
    // image tools began converting them; the test below now holds those
    // three to the engine's sniffer instead. TIFF (both byte orders) left
    // the same way on 2026-11-04, when `pdf/tiff.ts` began reading it.
    const engineLabel: Partial<Record<FileFormat, string>> = {
      AVIF: "AVIF",
      HEIC: "HEIC",
      HEIF: "HEIC",
    };
    const rows = (["avif", "heic", "heif"] as const).map((key) => {
      const ours = sniffFormat(HEADS[key], "x")!;
      return [key, ours, unsupportedImageMessage("x", HEADS[key])] as const;
    });
    for (const [key, ours, message] of rows) {
      expect(engineLabel[ours], key).toBeDefined();
      expect(message, key).toMatch(
        new RegExp(`is an? ${engineLabel[ours]} image`),
      );
    }
  });

  it("the images the image tools convert are the same images to both recognisers", () => {
    // Ours says WEBP / GIF / BMP; the engine's must say the same, or a file
    // the hand-off sends to JPG to PDF is refused there (and the reverse).
    for (const key of ["webp", "gif", "bmp"] as const) {
      const ours = sniffFormat(HEADS[key], "x");
      expect(ours, key).toBe(key.toUpperCase());
      expect(sniffImageFormat(HEADS[key]), key).toBe(key);
    }
    // TIFF since 2026-11-04, in both byte orders: the same four bytes.
    for (const key of ["tiffLE", "tiffBE"] as const) {
      expect(sniffFormat(HEADS[key], "x"), key).toBe("TIFF");
      expect(sniffImageFormat(HEADS[key]), key).toBe("tiff");
    }
    // …and a header one byte off is neither's (the 42 is in the wrong place).
    const offByOne = bytes("II", [0x00, 0x2a, 0x08, 0, 0, 0]);
    expect(sniffFormat(offByOne, "x")).toBeNull();
    expect(sniffImageFormat(offByOne)).toBeNull();
    // Positive control: a still-unsupported one is the engine's null.
    // (It was TIFF here until 2026-11-04.)
    expect(sniffImageFormat(HEADS.avif)).toBeNull();
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

/**
 * EVERY picker's `accept`, not only the catalogue's. Surface review round 2
 * (2026-11-14): HTML to PDF's picker takes `.zip` when the worker proves it
 * can (`ZIP_ACCEPT` in html-source-area.tsx), while ZIP stayed in
 * UNSUPPORTED_FORMATS and the desk said "Unzip it first" — and the test
 * above, reading `tools.flatMap(t => t.accept)`, could not see a picker
 * whose accept is written in a component. So the set is DISCOVERED: every
 * string literal in the app's source that is an `accept` list (a comma list
 * of MIME types and .extensions), read with the site's own recogniser.
 */
describe("every picker's accept, discovered, agrees with what the site says no tool opens", () => {
  const TOKEN = String.raw`(?:[a-z]+\/[a-z0-9.+-]+|\.[a-z0-9]+)`;
  const ACCEPT_LITERAL = new RegExp(
    String.raw`["'\x60](${TOKEN}(?:\s*,\s*${TOKEN})+)["'\x60]`,
    "gi",
  );

  /** The unsupported formats one accept list takes. */
  const unsupportedIn = (accept: string): UnsupportedFormat[] => {
    const out = new Set<UnsupportedFormat>();
    for (const raw of accept.split(",")) {
      const token = raw.trim();
      const verdict = token.startsWith(".")
        ? formatOf({ name: `x${token}` })
        : formatOf({ name: "", type: token });
      const f = verdict.format;
      if (f && (UNSUPPORTED_FORMATS as readonly string[]).includes(f))
        out.add(f as UnsupportedFormat);
    }
    return [...out];
  };

  function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sources(full, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        out.push(full);
    }
    return out;
  }

  const found = sources(path.join(process.cwd(), "src")).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(ACCEPT_LITERAL)].map((m) => ({
      file: path.relative(process.cwd(), file).replaceAll("\\", "/"),
      accept: m[1]!,
    }));
  });
  const takenBy = new Map<UnsupportedFormat, string[]>();
  for (const { file, accept } of found)
    for (const f of unsupportedIn(accept))
      takenBy.set(f, [...(takenBy.get(f) ?? []), file]);
  for (const t of tools)
    for (const f of UNSUPPORTED_FORMATS)
      if (toolAcceptsFormat(t.accept, f))
        takenBy.set(f, [...(takenBy.get(f) ?? []), `catalogue ${t.slug}`]);

  it("health: the scan finds the hand-written accept lists, HTML to PDF's among them", () => {
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found.length).toBeLessThan(200);
    expect(
      found.some((f) => f.file.endsWith("html-source-area.tsx")),
      found.map((f) => `${f.file}: ${f.accept}`).join("\n"),
    ).toBe(true);
  });

  it("POSITIVE CONTROL: the reader sees an unsupported format by extension and by type, and a supported one not at all", () => {
    expect(unsupportedIn("image/heic,.heic")).toEqual(["HEIC"]);
    expect(unsupportedIn("application/zip,.pdf")).toEqual(["ZIP"]);
    expect(unsupportedIn("text/html,.html,.htm")).toEqual([]);
    const sample = `const A = "text/html,.html,application/zip,.zip";`;
    expect([...sample.matchAll(ACCEPT_LITERAL)].map((m) => m[1])).toEqual([
      "text/html,.html,application/zip,.zip",
    ]);
  });

  it("a format some picker takes is answered with the tool that takes it; one no picker takes, never", () => {
    const wrong: string[] = [];
    for (const f of UNSUPPORTED_FORMATS) {
      const takers = takenBy.get(f) ?? [];
      const onlyIn = UNSUPPORTED_ANSWERS[f].onlyIn;
      // Given together, or not at all.
      if (
        (onlyIn === undefined) !==
        (UNSUPPORTED_ANSWERS[f].headline === undefined)
      )
        wrong.push(`${f} has only one of onlyIn and headline`);
      if (takers.length > 0 && !onlyIn)
        wrong.push(
          `${f} is taken by ${takers.join(", ")} but answered "No tool here opens"`,
        );
      if (takers.length === 0 && onlyIn)
        wrong.push(`${f} names ${onlyIn}, but no picker takes it`);
    }
    expect(wrong).toEqual([]);
  });

  it("an onlyIn answer names a real tool, by its name, and never says no tool opens the format", () => {
    for (const f of UNSUPPORTED_FORMATS) {
      const { onlyIn, headline: written } = UNSUPPORTED_ANSWERS[f];
      if (!onlyIn) continue;
      const tool = tools.find((t) => t.slug === onlyIn);
      expect(tool, onlyIn).toBeDefined();
      const { headline } = unsupportedWords(f);
      expect(headline).toBe(written);
      expect(headline).toContain(tool!.name);
      expect(headline).not.toMatch(/^No tool here opens/);
      expect(unsupportedAnswer(f, tools).onlyIn?.slug).toBe(onlyIn);
    }
  });
});
