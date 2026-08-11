// @vitest-environment node
/**
 * The counter has to tell three different "no" answers apart.
 *
 * It returned `number | null` until 2026-08-11, and so did a second copy of it
 * in `workers/ocr-native.ts`. `null` meant unparseable, or above the ceiling, or
 * genuinely zero pages — three facts a gate must treat differently, collapsed
 * into one value that forces the caller to guess. The guess that gets made is
 * always "fine".
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { countPdfPages, countPdfPagesDetailed } from "./page-count";

const NO_CEILING = Number.POSITIVE_INFINITY;

async function pdfWith(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([612, 792]);
  return doc.save({ useObjectStreams: false });
}

/**
 * A minimal, structurally valid PDF whose page tree is genuinely empty.
 *
 * Hand-built because pdf-lib cannot produce one: `PDFDocument.create()` reports
 * a page count of 1 before anything is added, so a pdf-lib fixture can never
 * reach the `zero-pages` branch. Measured: this parses, and `getPageCount()`
 * returns 0.
 */
function zeroPagePdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [] /Count 0 >>",
  ];
  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj
${obj}
endobj
`;
  });
  const xrefAt = body.length;
  let xref = `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n 
`;
  }
  body +=
    xref +
    `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xrefAt}
%%EOF
`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}

describe("countPdfPagesDetailed", () => {
  it("counts a real document", async () => {
    const result = await countPdfPagesDetailed(await pdfWith(7), NO_CEILING);
    expect(result).toEqual({ ok: true, count: 7 });
  });

  it("reports UNPARSEABLE for bytes that are not a PDF", async () => {
    const result = await countPdfPagesDetailed(
      new Uint8Array(4096).fill(0x41),
      NO_CEILING,
    );
    expect(result).toEqual({ ok: false, unknown: "unparseable" });
  });

  it("reports UNPARSEABLE for a header-and-trailer file with no page tree", async () => {
    // This is the shape `looksLikePdf` accepts and cannot see through: `%PDF-`
    // at the front, `%%EOF` at the back, rubble in between. The counter is what
    // notices, and a gate must read it as evidence against the artifact.
    const fake = new TextEncoder().encode(
      `%PDF-1.7\n${"A".repeat(4096)}\n%%EOF\n`,
    );
    const result = await countPdfPagesDetailed(fake, NO_CEILING);
    expect(result).toEqual({ ok: false, unknown: "unparseable" });
  });

  it("reports TOO-LARGE without opening the file", async () => {
    // Distinct from unparseable on purpose: nothing is known about this
    // document, and "we did not look" must never read as "we looked and it was
    // fine". It is also the band that would break the largest real files if a
    // gate treated unknown as failure.
    const real = await pdfWith(3);
    const result = await countPdfPagesDetailed(real, real.byteLength - 1);
    expect(result).toEqual({ ok: false, unknown: "too-large" });
  });

  it("reports ZERO-PAGES as its own answer, not as unparseable", async () => {
    // A document that parses and reports no pages is a fact about the document.
    // It is still not a number a comparison can use, which is why it is an
    // unknown rather than `0` — but calling it "unparseable" would be a claim
    // about the bytes that is simply untrue.
    const result = await countPdfPagesDetailed(zeroPagePdf(), NO_CEILING);
    expect(result).toEqual({ ok: false, unknown: "zero-pages" });
  });

  it("counts an ENCRYPTED document rather than calling it unparseable", async () => {
    // pdf-lib refuses an encrypted document without `ignoreEncryption`, and the
    // page tree is readable regardless. Without this, a gate would fail on a
    // perfectly intact password-protected PDF — an invariant that fires on
    // healthy files is one that gets switched off.
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    // pdf-lib cannot write encryption, so this pins the flag rather than the
    // cipher: the load options must include it.
    const result = await countPdfPagesDetailed(bytes, NO_CEILING);
    expect(result).toEqual({ ok: true, count: 2 });
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/pdf/page-count.ts", "utf8"),
    );
    expect(source).toContain("ignoreEncryption: true");
  });

  it("reports UNPARSEABLE for empty input", async () => {
    expect(await countPdfPagesDetailed(new Uint8Array(0), NO_CEILING)).toEqual({
      ok: false,
      unknown: "unparseable",
    });
  });
});

describe("countPdfPages — the lossy display wrapper", () => {
  it("returns the number when there is one", async () => {
    expect(await countPdfPages(await pdfWith(4))).toBe(4);
  });

  it("collapses every unknown to null, which is why gates may not use it", async () => {
    expect(await countPdfPages(new Uint8Array(4096).fill(0x41))).toBeNull();
    const real = await pdfWith(3);
    expect(await countPdfPages(real, real.byteLength - 1)).toBeNull();
    expect(await countPdfPages(zeroPagePdf())).toBeNull();
  });
});
