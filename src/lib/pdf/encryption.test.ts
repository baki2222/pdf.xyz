// @native-canvas
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { encryptPdf } from "@/tests/encrypted-pdf";
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
import { classifyPdfAccess, type PdfjsForAccess } from "./encryption";
import {
  getPageRotations,
  loadPdf,
  mergePdfs,
  PdfEncryptedError,
  PdfEngineError,
} from "./engine";
import { inspectFormFields } from "./forms";
import { overlayPdf } from "./overlay";
import { loadPdfjs } from "./pdfjs";
import { extractPdfText } from "./text";

/**
 * The browser build of pdf.js needs a worker URL that only the bundler can
 * produce; under Node the legacy build runs its own fake worker. Same parser,
 * same decryption.
 */
const require = createRequire(import.meta.url);
let pdfjsPromise: Promise<PdfjsForAccess> | null = null;
function pdfjs(): Promise<PdfjsForAccess> {
  pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<PdfjsForAccess>;
  return pdfjsPromise;
}

async function plainPdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    doc.addPage([300, 300]).drawText(`Statement page ${i + 1}`, {
      x: 20,
      y: 150,
      size: 14,
      font,
    });
  }
  return doc.save({ useObjectStreams: false });
}

describe("encrypted fixtures (health check: pdf-lib must refuse them)", () => {
  it("both kinds are encrypted in the sense that stops the in-browser engine", async () => {
    // If the fixture were not really encrypted, every classification below
    // would be about a plain file.
    for (const userPassword of ["", "open-me"]) {
      const bytes = await encryptPdf(await plainPdf(), {
        userPassword,
        ownerPassword: "owner-secret",
      });
      const err = await loadPdf(bytes).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PdfEngineError);
      expect((err as PdfEngineError).kind).toBe("encrypted");
    }
  });
});

describe("the object-stream layout (a modern producer's encrypted file)", () => {
  // The oracle is pdf.js, which has its own implementation of object streams,
  // cross-reference streams and the security handler. A layout bug here makes
  // pdf.js refuse the file, and these fail.
  it("pdf.js opens the owner-only file with its real page count, and refuses the user-password one", async () => {
    const lib = await pdfjs();
    const restricted = await encryptPdf(await plainPdf(4), {
      userPassword: "",
      ownerPassword: "owner-secret",
      objectStreams: true,
    });
    expect(await classifyPdfAccess(restricted, lib)).toEqual({
      kind: "restricted",
      pageCount: 4,
    });
    const locked = await encryptPdf(await plainPdf(2), {
      userPassword: "open-me",
      ownerPassword: "owner-secret",
      objectStreams: true,
    });
    expect(await classifyPdfAccess(locked, lib)).toEqual({
      kind: "password-required",
    });
  });

  it("pdf.js reads the page TEXT back through the decryption, not just the page count", async () => {
    const bytes = await encryptPdf(await plainPdf(2), {
      userPassword: "",
      ownerPassword: "owner-secret",
      objectStreams: true,
    });
    const lib = (await pdfjs()) as unknown as typeof import("pdfjs-dist");
    const task = lib.getDocument({ data: bytes.slice() });
    const doc = await task.promise;
    const page = await doc.getPage(2);
    const text = (await page.getTextContent()).items
      .map((i) => ("str" in i ? i.str : ""))
      .join("");
    await task.destroy();
    expect(text).toContain("Statement page 2");
  });

  it("is the shape pdf-lib cannot read even with ignoreEncryption — and the classic layout is not (control)", async () => {
    // This is the property the layout exists for: the page tree is ciphertext.
    const modern = await encryptPdf(await plainPdf(3), {
      userPassword: "",
      ownerPassword: "owner-secret",
      objectStreams: true,
    });
    await expect(
      PDFDocument.load(modern, { ignoreEncryption: true }).then((d) =>
        d.getPageCount(),
      ),
    ).rejects.toThrow();
    // Control: the classic layout keeps its dictionaries in plaintext, so
    // pdf-lib counts it — which is why it could not see this failure.
    const classic = await encryptPdf(await plainPdf(3), {
      userPassword: "",
      ownerPassword: "owner-secret",
    });
    const doc = await PDFDocument.load(classic, { ignoreEncryption: true });
    expect(doc.getPageCount()).toBe(3);
  });
});

describe("classifyPdfAccess", () => {
  it("an owner-password-only PDF is RESTRICTED: it opens, with its real page count", async () => {
    const bytes = await encryptPdf(await plainPdf(3), {
      userPassword: "",
      ownerPassword: "owner-secret",
    });
    expect(await classifyPdfAccess(bytes, await pdfjs())).toEqual({
      kind: "restricted",
      pageCount: 3,
    });
  });

  it("a user-password PDF is PASSWORD-REQUIRED", async () => {
    const bytes = await encryptPdf(await plainPdf(3), {
      userPassword: "open-me",
      ownerPassword: "owner-secret",
    });
    expect(await classifyPdfAccess(bytes, await pdfjs())).toEqual({
      kind: "password-required",
    });
  });

  it("positive control: a plain PDF is UNENCRYPTED, not restricted", async () => {
    // Without this arm, a classifier that answered "restricted" for every file
    // it could open would pass the first test.
    expect(await classifyPdfAccess(await plainPdf(2), await pdfjs())).toEqual({
      kind: "unencrypted",
      pageCount: 2,
    });
  });

  it("bytes that are not a PDF are UNREADABLE, and never throw", async () => {
    expect(
      await classifyPdfAccess(new Uint8Array([1, 2, 3, 4]), await pdfjs()),
    ).toEqual({ kind: "unreadable" });
  });

  it("leaves the caller's bytes intact (pdf.js may detach what it is given)", async () => {
    const bytes = await encryptPdf(await plainPdf(1), {
      userPassword: "",
      ownerPassword: "o",
    });
    const before = bytes.byteLength;
    await classifyPdfAccess(bytes, await pdfjs());
    expect(bytes.byteLength).toBe(before);
  });
});

describe("the pdf.js test seam", () => {
  it("is swapped only by test support, never by shipped code", () => {
    // The browser path depends on `classifyPdfAccess` using the bundled
    // browser build. A shipped caller of the setter would silently route real
    // users somewhere else. Corpus: every tracked TS file, derived from git.
    const files = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    expect(files.length, "git listed implausibly few files").toBeGreaterThan(
      500,
    );
    // Assembled, so this file is not itself a caller of what it searches for.
    const call = ["setPdfjsForAccess", "Source("].join("");
    const callers = files.filter(
      (f) =>
        !f.endsWith("src/lib/pdf/encryption.ts") &&
        readFileSync(f, "utf8").includes(call),
    );
    // Positive control: the one legitimate caller is found.
    expect(callers).toContain("src/tests/setup.ts");
    expect(callers.filter((f) => !f.startsWith("src/tests/"))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  The same population read through the TOOLS (wave1/l01-page-leak).
 *  Written against its own error classes; integrated onto the engine's
 *  one `PdfEncryptedError`, asserted by verdict as well as by copy.
 * ------------------------------------------------------------------ */

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

const ownerOnlyPdf = () =>
  new Uint8Array(Buffer.from(OWNER_ONLY_PDF_BASE64, "base64"));
const ownerOnlyObjStm = () =>
  new Uint8Array(Buffer.from(OWNER_ONLY_OBJSTM_PDF_BASE64, "base64"));
const userPasswordPdf = () =>
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
    for (const bytes of [ownerOnlyPdf(), userPasswordPdf()]) {
      const err = await rejection(PDFDocument.load(bytes));
      // The string loadPdf classifies on (pdf-lib's error class does not
      // survive instanceof — it is compiled to ES5).
      expect(err.message).toMatch(/encrypt/i);
    }
  });

  it("pdfjs opens the owner-only file and asks the other for a password", async () => {
    const pdfjs = await loadPdfjs();
    const open = pdfjs.getDocument({ data: ownerOnlyPdf(), verbosity: 0 });
    expect((await open.promise).numPages).toBe(3);
    await open.destroy();
    const locked = pdfjs.getDocument({ data: userPasswordPdf(), verbosity: 0 });
    expect((await rejection(locked.promise)).name).toBe("PasswordException");
    await locked.destroy();
  });
});

describe("read-only tools read an owner-only file", () => {
  it("the pdfjs page board reads its page count and rotations", async () => {
    expect(await readPageBoard(ownerOnlyPdf(), "pdfjs")).toEqual({
      pageCount: 3,
      rotations: ENCRYPTED_FIXTURE_ROTATIONS,
    });
  });

  it("and the extractor behind PDF to Text / Markdown reads every page", async () => {
    const board = await readPageBoard(ownerOnlyPdf(), "pdfjs");
    const extracted = await extractPdfText(ownerOnlyPdf());
    expect(extracted.pageCount).toBe(board.pageCount);
    expect(extracted.pages.map((p) => p.text)).toEqual(ENCRYPTED_FIXTURE_TEXT);
  });

  it("a file that needs a password is refused as one — never 'No password given'", async () => {
    for (const run of [
      () => readPageBoard(userPasswordPdf(), "pdfjs"),
      () => extractPdfText(userPasswordPdf()),
    ]) {
      const err = await rejection(run());
      expect(err).toBeInstanceOf(PdfEncryptedError);
      expect((err as PdfEncryptedError).verdict).toBe("needs-password");
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
    const plain = await PDFDocument.load(ownerOnlyPdf(), {
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
    expect(err).toBeInstanceOf(PdfEncryptedError);
    expect((err as PdfEncryptedError).verdict).toBe("opens-without-password");
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
      const restricted = await rejection(run(ownerOnlyPdf()));
      expect(restricted).toBeInstanceOf(PdfEncryptedError);
      expect((restricted as PdfEncryptedError).verdict).toBe(
        "opens-without-password",
      );
      expect(restricted.message).toMatch(RESTRICTED);
      // The claim that was false: this file has no password to open.
      expect(restricted.message).not.toMatch(PASSWORD);

      const locked = await rejection(run(userPasswordPdf()));
      expect(locked).toBeInstanceOf(PdfEncryptedError);
      expect((locked as PdfEncryptedError).verdict).toBe("needs-password");
      expect(locked.message).toMatch(PASSWORD);
    });
  }

  it("overlay: the overlay FILE's verdict is kept, not re-read from its wording", async () => {
    const base = await (await PDFDocument.create()).save();
    const fresh = await PDFDocument.load(base);
    fresh.addPage([100, 100]);
    const baseBytes = await fresh.save();
    const restricted = await rejection(overlayPdf(baseBytes, ownerOnlyPdf()));
    expect(restricted.message).toMatch(
      /^The overlay PDF has editing restrictions/,
    );
    const locked = await rejection(overlayPdf(baseBytes, userPasswordPdf()));
    expect(locked.message).toMatch(/^The overlay PDF is password-protected/);
  });
});
