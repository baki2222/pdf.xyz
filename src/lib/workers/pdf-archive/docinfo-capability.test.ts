/**
 * `pdfaUnicodeDocInfo`'s start-up proof (audit wave 2, pdf-to-pdfa#3), on
 * this host where no Ghostscript exists: the production runner with a
 * stand-in Ghostscript that writes a PDF/A file WITHOUT the fields (as gs
 * 10.00.0 does) passes, because the runner writes them after; a Ghostscript
 * dep that hands back that file unrewritten (an older image) fails; no
 * Ghostscript at all fails. The real Ghostscript runs on the worker image.
 */
import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import {
  holdsProbeDocInfo,
  PDFA_DOCINFO_PROBE,
  provesPdfaUnicodeDocInfo,
} from "./docinfo-capability";
import { rewriteDocInfo } from "./docinfo-xmp";
import { createNativeGhostscriptPdfARunner } from "./native";
import {
  DEFAULT_PDFA_ICC_PROFILE,
  type NativePdfArchiveConfig,
} from "./native-config";
import type { PdfArchiveDeps } from "./engine";
import { gsLikePdfA } from "@/tests/pdfa-xmp-fixtures";

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

async function depsWith(
  ghostscript: PdfArchiveDeps["ghostscript"],
): Promise<PdfArchiveDeps> {
  return { ghostscript } as PdfArchiveDeps;
}

const stubRunner = async () =>
  createNativeGhostscriptPdfARunner(config, {
    exec: vi.fn(async () => ({ code: 0, timedOut: false })),
    fs: {
      mkdtemp: vi.fn(async () => "/tmp/pdfxyz-pdfa-1"),
      writeFile: vi.fn(async () => {}),
      readFile: vi.fn(async () => gsLikePdfA()),
      rm: vi.fn(async () => {}),
    } as never,
  });

describe("provesPdfaUnicodeDocInfo", () => {
  it("passes on the production runner (Ghostscript a stand-in that drops the fields)", async () => {
    expect(
      await provesPdfaUnicodeDocInfo({}, await depsWith(await stubRunner())),
    ).toBe(true);
  });

  it("fails on an image that hands back Ghostscript's file unrewritten", async () => {
    const old = {
      convertToPdfA: async () => ({ bytes: await gsLikePdfA(), notes: [] }),
    };
    expect(await provesPdfaUnicodeDocInfo({}, await depsWith(old))).toBe(false);
  });

  it("fails with no Ghostscript", async () => {
    expect(await provesPdfaUnicodeDocInfo({}, await depsWith(undefined))).toBe(
      false,
    );
  });

  it("CONTROL: the reader refuses a file without the fields", async () => {
    expect(await holdsProbeDocInfo(await gsLikePdfA())).toBe(false);
  });

  // Review of pdf-to-pdfa#3 (2026-11-28): the after-Ghostscript rewrite is a
  // whole-file pdf-lib re-save of a PDF/A file, and nothing checked that the
  // re-saved file still declares PDF/A. The reader now requires the
  // declarations too (`inspectPdfAMarkers`), so a rewrite that loses them
  // proves nothing. Not a validator: veraPDF is not in the image.
  it("POSITIVE: the probe's fields written into a PDF/A file are held", async () => {
    const rewritten = await rewriteDocInfo(
      await gsLikePdfA(),
      PDFA_DOCINFO_PROBE,
    );
    expect(await holdsProbeDocInfo(rewritten)).toBe(true);
  });

  it("the same file with its output intent removed is refused", async () => {
    const doc = await PDFDocument.load(
      await rewriteDocInfo(await gsLikePdfA(), PDFA_DOCINFO_PROBE),
      { updateMetadata: false },
    );
    doc.catalog.delete(PDFName.of("OutputIntents"));
    expect(await holdsProbeDocInfo(await doc.save())).toBe(false);
  });
});
