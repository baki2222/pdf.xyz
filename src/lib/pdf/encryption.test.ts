import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { encryptPdf } from "@/tests/encrypted-pdf";
import { classifyPdfAccess, type PdfjsForAccess } from "./encryption";
import { loadPdf, PdfEngineError } from "./engine";

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
