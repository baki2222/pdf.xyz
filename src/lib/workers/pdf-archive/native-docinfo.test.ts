/**
 * Audit wave 2, pdf-to-pdfa#3, through the PRODUCTION runner
 * (`createNativeGhostscriptPdfARunner`): Ghostscript is a stand-in that
 * "writes" a PDF/A file without the fields (as gs 10.00.0 does for a value
 * with a bracket or an accent), and the runner's output must hold the input's
 * exact Unicode Title and Author in Info and XMP. A plain-ASCII input, which
 * Ghostscript carries itself through the prefix, comes back byte for byte as
 * Ghostscript wrote it (the rewrite runs only when it is needed).
 *
 * The real Ghostscript is run by the start-up proof on the worker image
 * (`provesPdfaUnicodeDocInfo`); this file cannot reach one on Windows.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { createNativeGhostscriptPdfARunner } from "./native";
import {
  DEFAULT_PDFA_ICC_PROFILE,
  type NativePdfArchiveConfig,
} from "./native-config";
import { gsLikePdfA, readXmp } from "@/tests/pdfa-xmp-fixtures";

const config: NativePdfArchiveConfig = {
  enabled: true,
  binary: "gs",
  overridden: false,
  iccProfile: DEFAULT_PDFA_ICC_PROFILE,
  qpdfBinary: "qpdf",
  timeoutMs: 10_000,
  maxInputBytes: 10_000_000,
  maxOutputBytes: 10_000_000,
  tmpDir: "/tmp",
};

async function input(title: string, author: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  doc.setTitle(title);
  doc.setAuthor(author);
  return doc.save();
}

function runner(gsOutput: Uint8Array) {
  return createNativeGhostscriptPdfARunner(config, {
    exec: vi.fn(async () => ({ code: 0, timedOut: false })),
    fs: {
      mkdtemp: vi.fn(async () => "/tmp/pdfxyz-pdfa-1"),
      writeFile: vi.fn(async () => {}),
      readFile: vi.fn(async () => gsOutput),
      rm: vi.fn(async () => {}),
    } as never,
  });
}

describe("PDF to PDF/A: fields Ghostscript drops reach the copy", () => {
  it("a bracket and accents: Info and XMP hold the exact strings", async () => {
    const out = await runner(await gsLikePdfA()).convertToPdfA(
      await input("Annual report (2025)", "José Müller"),
      { standard: "PDF/A-2b" },
    );
    const doc = await PDFDocument.load(out.bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBe("Annual report (2025)");
    expect(doc.getAuthor()).toBe("José Müller");
    const xmp = await readXmp(out.bytes);
    expect(xmp.title).toEqual(["Annual report (2025)"]);
    expect(xmp.creator).toEqual(["José Müller"]);
  });

  it("CONTROL: plain ASCII is Ghostscript's to carry, and the file is untouched", async () => {
    const gs = await gsLikePdfA();
    const out = await runner(gs).convertToPdfA(
      await input("Annual report 2025", "Jose Muller"),
      { standard: "PDF/A-2b" },
    );
    expect(Buffer.from(out.bytes).equals(Buffer.from(gs))).toBe(true);
  });
});
