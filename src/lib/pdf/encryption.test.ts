import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  ENCRYPTED_FIXTURE_ROTATIONS,
  ENCRYPTED_FIXTURE_TEXT,
  OBJSTM_FIXTURE_TEXT,
  OWNER_ONLY_OBJSTM_PDF_BASE64,
  OWNER_ONLY_PDF_BASE64,
  USER_PASSWORD_PDF_BASE64,
} from "@/tests/fixtures-encrypted";
import { readPageBoard } from "@/components/tools/runner/use-single-pdf";
import { analyzePdf } from "./analyze";
import {
  getPageRotations,
  mergePdfs,
  PdfPasswordRequiredError,
  PdfRestrictedError,
} from "./engine";
import { inspectFormFields } from "./forms";
import { overlayPdf } from "./overlay";
import { loadPdfjs } from "./pdfjs";
import { extractPdfText } from "./text";

/**
 * Owner-only ("permissions") encryption is not a password. The file opens in
 * every viewer with no prompt; it only restricts editing. pdf-lib refuses it
 * exactly like a file that needs a password to open, and every tool used to
 * pass that refusal on as "This PDF is password-protected. Unlock it first" —
 * false to the person holding the file, and a dead end, since Unlock PDF then
 * asked for a password they did not have.
 *
 * What this pins, at the point of consumption:
 *  - read-only tools (to image / text / Markdown) READ the owner-only file:
 *    page board and extracted text, through the same reader the runner uses;
 *  - writing tools still refuse it (pdf-lib cannot decrypt) but say what is
 *    true: editing restrictions, not a password;
 *  - a file that really needs a password is still refused as one, everywhere,
 *    and never with pdfjs's raw "No password given".
 */

const ownerOnly = () =>
  new Uint8Array(Buffer.from(OWNER_ONLY_PDF_BASE64, "base64"));
const ownerOnlyObjStm = () =>
  new Uint8Array(Buffer.from(OWNER_ONLY_OBJSTM_PDF_BASE64, "base64"));
const userPassword = () =>
  new Uint8Array(Buffer.from(USER_PASSWORD_PDF_BASE64, "base64"));

const RESTRICTED = /editing restrictions/;
const PASSWORD = /password-protected/;

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected a rejection, got a result");
}

describe("the fixtures are the population in question (health check)", () => {
  it("pdf-lib refuses BOTH files the same way — the ambiguity being resolved", async () => {
    for (const bytes of [ownerOnly(), userPassword()]) {
      const err = await rejection(PDFDocument.load(bytes));
      // The string loadPdf classifies on (pdf-lib's error class does not
      // survive instanceof — it is compiled to ES5).
      expect(err.message).toMatch(/encrypt/i);
    }
  });

  it("pdfjs opens the owner-only file and asks the other for a password", async () => {
    const pdfjs = await loadPdfjs();
    const open = pdfjs.getDocument({ data: ownerOnly(), verbosity: 0 });
    expect((await open.promise).numPages).toBe(3);
    await open.destroy();
    const locked = pdfjs.getDocument({ data: userPassword(), verbosity: 0 });
    expect((await rejection(locked.promise)).name).toBe("PasswordException");
    await locked.destroy();
  });
});

describe("read-only tools read an owner-only file", () => {
  it("the pdfjs page board reads its page count and rotations", async () => {
    expect(await readPageBoard(ownerOnly(), "pdfjs")).toEqual({
      pageCount: 3,
      rotations: ENCRYPTED_FIXTURE_ROTATIONS,
    });
  });

  it("and the extractor behind PDF to Text / Markdown reads every page", async () => {
    const board = await readPageBoard(ownerOnly(), "pdfjs");
    const extracted = await extractPdfText(ownerOnly());
    expect(extracted.pageCount).toBe(board.pageCount);
    expect(extracted.pages.map((p) => p.text)).toEqual(ENCRYPTED_FIXTURE_TEXT);
  });

  it("a file that needs a password is refused as one — never 'No password given'", async () => {
    for (const run of [
      () => readPageBoard(userPassword(), "pdfjs"),
      () => extractPdfText(userPassword()),
    ]) {
      const err = await rejection(run());
      expect(err).toBeInstanceOf(PdfPasswordRequiredError);
      expect(err.message).toMatch(PASSWORD);
      expect(err.message).not.toMatch(/No password given/);
    }
  });
});

/**
 * The two owner-only fixtures above have no object streams, and on those
 * pdf-lib with `ignoreEncryption` reads the page board exactly — so the
 * page-board test could not tell the pdfjs reader from that shortcut (only the
 * user-password control, which the shortcut opens without complaint, did).
 * This file keeps its page tree in an ENCRYPTED object stream, as modern
 * generators write it: the shortcut cannot read it, a decrypting reader can.
 */
describe("an owner-only file whose page tree is in an encrypted object stream", () => {
  it("health check: pdf-lib refuses it, and ignoreEncryption cannot read its pages", async () => {
    expect(
      (await rejection(PDFDocument.load(ownerOnlyObjStm()))).message,
    ).toMatch(/encrypt/i);
    let board: string;
    try {
      const doc = await PDFDocument.load(ownerOnlyObjStm(), {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
      });
      board = JSON.stringify(
        doc.getPages().map((page) => page.getRotation().angle),
      );
    } catch (err) {
      board = `threw: ${(err as Error).message}`;
    }
    // Positive control of the same predicate: the plain-dictionary fixture IS
    // read by the shortcut — which is why this fixture exists.
    const plain = await PDFDocument.load(ownerOnly(), {
      ignoreEncryption: true,
    });
    expect(
      JSON.stringify(plain.getPages().map((page) => page.getRotation().angle)),
    ).toBe(JSON.stringify(ENCRYPTED_FIXTURE_ROTATIONS));
    expect(board).not.toBe(JSON.stringify(ENCRYPTED_FIXTURE_ROTATIONS));
  });

  it("the read-only page board and the text extractor read it", async () => {
    expect(await readPageBoard(ownerOnlyObjStm(), "pdfjs")).toEqual({
      pageCount: 3,
      rotations: ENCRYPTED_FIXTURE_ROTATIONS,
    });
    const extracted = await extractPdfText(ownerOnlyObjStm());
    expect(extracted.pages.map((p) => p.text)).toEqual(OBJSTM_FIXTURE_TEXT);
  });

  it("writing tools refuse it as restricted, not password-protected", async () => {
    const err = await rejection(getPageRotations(ownerOnlyObjStm()));
    expect(err).toBeInstanceOf(PdfRestrictedError);
    expect(err.message).toMatch(RESTRICTED);
  });
});

describe("writing tools refuse an owner-only file, and say why truthfully", () => {
  const WRITERS: {
    tool: string;
    run: (bytes: Uint8Array) => Promise<unknown>;
  }[] = [
    { tool: "every single-PDF tool's upload gate", run: getPageRotations },
    { tool: "merge-pdf", run: (b) => mergePdfs([b]) },
    { tool: "compress-pdf analysis", run: analyzePdf },
    { tool: "fill-forms", run: inspectFormFields },
  ];

  for (const { tool, run } of WRITERS) {
    it(`${tool}: owner-only -> restrictions; user password -> password-protected`, async () => {
      const restricted = await rejection(run(ownerOnly()));
      expect(restricted).toBeInstanceOf(PdfRestrictedError);
      expect(restricted.message).toMatch(RESTRICTED);
      // The claim that was false: this file has no password to open.
      expect(restricted.message).not.toMatch(PASSWORD);

      const locked = await rejection(run(userPassword()));
      expect(locked).toBeInstanceOf(PdfPasswordRequiredError);
      expect(locked.message).toMatch(PASSWORD);
    });
  }

  it("overlay: the overlay FILE's verdict is kept, not re-read from its wording", async () => {
    const base = await (await PDFDocument.create()).save();
    const fresh = await PDFDocument.load(base);
    fresh.addPage([100, 100]);
    const baseBytes = await fresh.save();
    const restricted = await rejection(overlayPdf(baseBytes, ownerOnly()));
    expect(restricted.message).toMatch(
      /^The overlay PDF has editing restrictions/,
    );
    const locked = await rejection(overlayPdf(baseBytes, userPassword()));
    expect(locked.message).toMatch(/^The overlay PDF is password-protected/);
  });
});
