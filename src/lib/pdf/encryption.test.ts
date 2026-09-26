import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import {
  ownerOnlyEncryptedPdf,
  userPasswordEncryptedPdf,
} from "@/tests/encrypted-pdf-fixture";
import { optimizeLossless } from "./analyze";
import {
  ENCRYPTED_PDF_MESSAGES,
  PDF_ENCRYPTED_UNKNOWN_MESSAGE,
  PDF_NEEDS_PASSWORD_MESSAGE,
  PDF_RESTRICTED_MESSAGE,
  UNLOCK_TOOL_HREF,
  UNLOCK_TOOL_NAME,
  probePdfEncryption,
  type PdfjsOpener,
} from "./encryption";
import {
  PdfEncryptedError,
  getPageRotations,
  pdfLoadError,
  UNREADABLE_PDF_MESSAGE,
} from "./engine";
import { extractPdfImages } from "./extract-images";
import { overlayPdf } from "./overlay";

/**
 * An encrypted PDF that OPENS WITHOUT A PASSWORD (only its author's editing
 * restrictions are set) was refused by every in-browser tool with "This PDF is
 * password-protected" and sent to Unlock PDF — which then demanded a password
 * the user never had. The fixtures are real Standard-security-handler files
 * (see `@/tests/encrypted-pdf-fixture`), so each case below runs a file
 * through the same reader a user's file meets.
 *
 * pdf.js's modern build needs `DOMMatrix`, which Node lacks, so the probe is
 * driven here with the legacy build via the loader seam. The same function,
 * with the browser loader, is what the runners call.
 */
const legacyPdfjs = async (): Promise<PdfjsOpener> =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsOpener;
const legacyProbe = (bytes: Uint8Array) =>
  probePdfEncryption(bytes, legacyPdfjs);

async function pdfLibRefusal(bytes: Uint8Array): Promise<unknown> {
  try {
    await PDFDocument.load(bytes);
  } catch (err) {
    return err;
  }
  throw new Error("fixture health: pdf-lib loaded an encrypted fixture");
}

describe("the fixtures are what they claim (health check)", () => {
  it("pdf-lib refuses BOTH — the refusal alone cannot tell them apart", async () => {
    for (const bytes of [ownerOnlyEncryptedPdf(), userPasswordEncryptedPdf()]) {
      const err = await pdfLibRefusal(bytes);
      expect(String((err as Error).message)).toMatch(/encrypt/i);
    }
  });

  it("pdf.js opens the owner-only file with no password and refuses the other", async () => {
    expect(await legacyProbe(ownerOnlyEncryptedPdf())).toBe(
      "opens-without-password",
    );
    expect(await legacyProbe(userPasswordEncryptedPdf())).toBe(
      "needs-password",
    );
  });

  it("an unencrypted PDF opens (positive control), junk is unknown, not a guess", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(await legacyProbe(await doc.save())).toBe("opens-without-password");
    expect(
      await legacyProbe(new TextEncoder().encode("PK\u0003\u0004 not a pdf")),
    ).toBeNull();
  });

  it("a probe whose pdf.js cannot load reports null", async () => {
    expect(
      await probePdfEncryption(ownerOnlyEncryptedPdf(), () =>
        Promise.reject(new Error("chunk load failed")),
      ),
    ).toBeNull();
  });
});

describe("the composed chain: pdf-lib refusal → probe → the copy a user reads", () => {
  it("owner-only: says it opens without a password, and to leave Unlock's password blank", async () => {
    const bytes = ownerOnlyEncryptedPdf();
    const err = await pdfLoadError(
      await pdfLibRefusal(bytes),
      bytes,
      legacyProbe,
    );
    expect(err).toBeInstanceOf(PdfEncryptedError);
    expect(err.message).toBe(PDF_RESTRICTED_MESSAGE);
    expect(err.message).not.toMatch(/password-protected/i);
    expect(err.message).toMatch(/leave the password blank/i);
  });

  it("user password: keeps the password copy (the old copy was right HERE)", async () => {
    const bytes = userPasswordEncryptedPdf();
    const err = await pdfLoadError(
      await pdfLibRefusal(bytes),
      bytes,
      legacyProbe,
    );
    expect(err).toBeInstanceOf(PdfEncryptedError);
    expect(err.message).toBe(PDF_NEEDS_PASSWORD_MESSAGE);
  });

  it("a non-encryption failure is still 'couldn't be read', with no probe", async () => {
    let probed = false;
    const err = await pdfLoadError(
      new Error("Failed to parse"),
      new Uint8Array(),
      async () => {
        probed = true;
        return null;
      },
    );
    expect(err).not.toBeInstanceOf(PdfEncryptedError);
    expect(err.message).toBe(UNREADABLE_PDF_MESSAGE);
    expect(probed).toBe(false);
  });
});

describe("every in-browser loader routes an encrypted file through the classifier", () => {
  /**
   * Behavioural: the loaders the runners actually call, fed the owner-only
   * file, with the DEFAULT (browser) probe. Whether that pdf.js can run under
   * Node depends on which globals an earlier import left behind (the legacy
   * build polyfills `DOMMatrix`), so the verdict may be either "opens" or
   * "could not tell" — and BOTH sentences are true of this file. What must
   * never come back is the "password-protected" claim this file retires.
   */
  const entryPoints: [string, (b: Uint8Array) => Promise<unknown>][] = [
    ["engine.getPageRotations (useSinglePdf on file open)", getPageRotations],
    ["analyze.optimizeLossless", optimizeLossless],
    ["extract-images.extractPdfImages", extractPdfImages],
  ];

  it.each(entryPoints)("%s", async (_name, fn) => {
    const err = await fn(ownerOnlyEncryptedPdf()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfEncryptedError);
    expect([PDF_RESTRICTED_MESSAGE, PDF_ENCRYPTED_UNKNOWN_MESSAGE]).toContain(
      (err as Error).message,
    );
    expect((err as Error).message).not.toMatch(/password-protected/i);
  });

  it("overlay: the same verdict, said about the overlay file", async () => {
    const base = await PDFDocument.create();
    base.addPage();
    const err = await overlayPdf(
      await base.save(),
      ownerOnlyEncryptedPdf(),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfEncryptedError);
    const message = (err as Error).message;
    expect(message).toMatch(/^The overlay PDF /);
    expect(message).not.toMatch(/password-protected/i);
    expect(message).toContain(UNLOCK_TOOL_NAME);
  });

  /**
   * Structural, and DISCOVERED: every `PDFDocument.load(` in src/lib/pdf must
   * either read past encryption on purpose (`ignoreEncryption: true`) or send
   * its failure through `pdfLoadError`. A new loader that maps the error by
   * hand is exactly how three copies of the old sentence came to exist.
   */
  const PDF_DIR = path.join(process.cwd(), "src", "lib", "pdf");

  function loadSites(source: string): { line: number; ok: boolean }[] {
    const lines = source.split("\n");
    const sites: { line: number; ok: boolean }[] = [];
    lines.forEach((text, i) => {
      if (!/PDFDocument\.load\(/.test(text)) return;
      const window = lines.slice(i, i + 8).join("\n");
      sites.push({
        line: i + 1,
        ok:
          /ignoreEncryption:\s*true/.test(window) ||
          /pdfLoadError\(/.test(window),
      });
    });
    return sites;
  }

  it("finds the loaders (size floor) and each one is classified", () => {
    const files = readdirSync(PDF_DIR).filter(
      (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
    );
    const offenders: string[] = [];
    let count = 0;
    for (const f of files) {
      for (const site of loadSites(
        readFileSync(path.join(PDF_DIR, f), "utf8"),
      )) {
        count++;
        if (!site.ok) offenders.push(`${f}:${site.line}`);
      }
    }
    // engine, analyze, extract-images, page-count at the time of writing.
    expect(count).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
  });

  it("positive control: a hand-mapped loader is flagged", () => {
    const handMapped = [
      "  try {",
      "    return await PDFDocument.load(bytes);",
      "  } catch (err) {",
      '    throw new PdfEngineError("This PDF is password-protected.");',
      "  }",
    ].join("\n");
    expect(loadSites(handMapped)).toEqual([{ line: 2, ok: false }]);
  });
});

describe("the way out is real", () => {
  it("every encrypted-file message names the tool the link opens, and that tool exists", () => {
    const tool = getToolBySlug(UNLOCK_TOOL_HREF.replace(/^\/tools\//, ""));
    expect(tool?.name).toBe(UNLOCK_TOOL_NAME);
    expect(ENCRYPTED_PDF_MESSAGES.length).toBe(3);
    for (const message of ENCRYPTED_PDF_MESSAGES) {
      expect(message).toContain(UNLOCK_TOOL_NAME);
    }
  });

  it("the Unlock tool's own description admits the blank-password path the copy sends people to", () => {
    const tool = getToolBySlug("unlock-pdf");
    expect(tool?.description).toMatch(/leave it blank/i);
    expect(tool?.description).not.toMatch(/can't recover or bypass/i);
  });
});
