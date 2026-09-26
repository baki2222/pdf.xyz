import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  ownerOnlyEncryptedPdf,
  userPasswordEncryptedPdf,
} from "@/tests/encrypted-pdf-fixture";
import {
  translateFailureMessage,
  pickedFileProblem,
} from "@/components/tools/translate-worker-panel";
import { PDF_NEEDS_PASSWORD_MESSAGE } from "./encryption";
import {
  PdfEncryptedError,
  PdfEngineError,
  UNREADABLE_PDF_MESSAGE,
  pdfjsLoadError,
} from "./engine";
import { extractPdfText } from "./text";

/**
 * pdf.js load failures used to escape `extractPdfText` raw. Translate caught
 * every throw as "Lost the connection before the job finished. Check your
 * network" — for a password-protected bank statement, a damaged PDF, or a
 * .docx dropped by mistake, none of which ever touched the network. Compare,
 * PDF to Text and PDF to Markdown showed pdf.js's raw "No password given".
 *
 * The modern pdf.js build needs `DOMMatrix`, so these drive the REAL
 * `extractPdfText` with the legacy build through its loader seam.
 */
const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

const thrown = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

async function textPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  page.drawText("Hello world", {
    x: 20,
    y: 100,
    size: 18,
    font: await doc.embedFont(StandardFonts.Helvetica),
  });
  return doc.save();
}

describe("extractPdfText turns a load failure into the copy a user can act on", () => {
  it("a PDF that needs a password: the password copy (with the Unlock way out)", async () => {
    const err = await thrown(
      extractPdfText(userPasswordEncryptedPdf(), legacy),
    );
    expect(err).toBeInstanceOf(PdfEncryptedError);
    expect((err as Error).message).toBe(PDF_NEEDS_PASSWORD_MESSAGE);
  });

  it("not a PDF at all: 'couldn't be read as a PDF'", async () => {
    const err = await thrown(
      extractPdfText(new TextEncoder().encode("PK\u0003\u0004 a docx"), legacy),
    );
    expect(err).toBeInstanceOf(PdfEngineError);
    expect(err).not.toBeInstanceOf(PdfEncryptedError);
    expect((err as Error).message).toBe(UNREADABLE_PDF_MESSAGE);
  });

  it("positive controls: a real PDF extracts, and so does an owner-only one", async () => {
    const plain = await extractPdfText(await textPdf(), legacy);
    expect(plain.text).toContain("Hello world");
    // Opens without a password, so pdf.js reads it: no error to map.
    const restricted = await extractPdfText(ownerOnlyEncryptedPdf(), legacy);
    expect(restricted.pageCount).toBe(1);
  });

  it("a failure that is not about the file passes through untouched", () => {
    const workerDied = Object.assign(
      new Error("Setting up fake worker failed"),
      {
        name: "Error",
      },
    );
    expect(pdfjsLoadError(workerDied)).toBe(workerDied);
  });
});

describe("Translate says what actually happened (the composed chain)", () => {
  it("a password-protected PDF is not a lost connection", async () => {
    const err = await thrown(
      extractPdfText(userPasswordEncryptedPdf(), legacy),
    );
    const message = translateFailureMessage(err);
    expect(message).toBe(PDF_NEEDS_PASSWORD_MESSAGE);
    expect(message).not.toMatch(/connection|network/i);
  });

  it("a damaged file is not a lost connection", async () => {
    const good = await textPdf();
    const err = await thrown(extractPdfText(good.slice(0, 40), legacy));
    expect(translateFailureMessage(err)).toBe(UNREADABLE_PDF_MESSAGE);
  });

  it("control: a real transport failure keeps the network copy", () => {
    expect(translateFailureMessage(new TypeError("Failed to fetch"))).toMatch(
      /Lost the connection/,
    );
  });

  it("a dropped non-PDF is refused at the pick, before any parse", () => {
    expect(
      pickedFileProblem({
        name: "letter.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toMatch(/isn't a PDF/);
    expect(
      pickedFileProblem({ name: "a.pdf", type: "application/pdf" }),
    ).toBeNull();
    expect(pickedFileProblem({ name: "scan.PDF", type: "" })).toBeNull();
  });
});
