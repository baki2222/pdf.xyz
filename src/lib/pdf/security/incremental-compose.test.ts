// @native-canvas
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  ASSEMBLE_COPY_FIXTURE,
  NO_ASSEMBLE_COPY_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { setPageRotations } from "../engine";
import { loadPdfLib } from "../pdf-lib";
import { readXref } from "./document";
import { RestrictedChangeError, writeIncrementalUpdate } from "./incremental";
import { openProtectedPdf, type ProtectedPdf } from "./protected-pdf";

/**
 * `writeIncrementalUpdate` was changed by two lanes on 2026-11-08 and the
 * merge composed them (feat/w3-client):
 *
 *  - audit rotate-pdf#2 (w3-l04): under a handler, the author's "assemble"
 *    grant (`allowRotation`) lets a page whose /Rotate is ALL that changed
 *    be rewritten; anything else on a page stays refused.
 *  - audit sign-pdf#5 (w3-l09): with `handler: null` (an unencrypted,
 *    certificate-signed file) nothing is guarded, whatever the grant flags.
 *
 * One file holds both, so a resolution that drops either side goes red here
 * and not only in the lane's own test.
 */

async function open(file: string): Promise<ProtectedPdf> {
  const result = await openProtectedPdf(readRestrictedFixture(file));
  if (result.kind !== "opened")
    throw new Error(`${file}: ${JSON.stringify(result)}`);
  return result.pdf;
}

async function rotationsOf(bytes: Uint8Array): Promise<number[]> {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  try {
    const out: number[] = [];
    for (let i = 1; i <= doc.numPages; i += 1)
      out.push((await doc.getPage(i)).rotate);
    return out;
  } finally {
    await task.destroy();
  }
}

async function drawOnFirstPage(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPage(0).drawText("added", { x: 40, y: 40, size: 12, font });
  return doc.save({ useObjectStreams: false });
}

describe("writeIncrementalUpdate: the rotation grant and the unencrypted append, composed", () => {
  it("unencrypted (handler null): a page rotation AND a page drawing append with no grant flags", async () => {
    const made = await PDFDocument.create();
    made.addPage([300, 300]);
    made.addPage([300, 300]);
    const original = await made.save({ useObjectStreams: false });
    const lib = await loadPdfLib();
    const xref = await readXref(lib, original);

    const rotated = await setPageRotations(original, [90, 0]);
    const drawn = await drawOnFirstPage(rotated);
    const out = await writeIncrementalUpdate({
      original,
      handler: null,
      xref,
      plain: original,
      edited: drawn,
    });

    // Health: the update carries the page change, not an empty append.
    expect(out.changed).toBeGreaterThan(0);
    expect(out.bytes.subarray(0, original.length)).toEqual(original);
    expect(await rotationsOf(out.bytes)).toEqual([90, 0]);
  });

  it("encrypted, assembly granted: rotation is appended, a drawing on the page is still refused", async () => {
    const original = readRestrictedFixture(ASSEMBLE_COPY_FIXTURE.file);
    const pdf = await open(ASSEMBLE_COPY_FIXTURE.file);
    expect(pdf.canAssemble).toBe(true);

    const rotated = await pdf.saveChanges(
      await setPageRotations(pdf.plain, [90, 0]),
    );
    expect(rotated.bytes.subarray(0, original.length)).toEqual(original);
    expect(await rotationsOf(rotated.bytes)).toEqual([90, 0]);

    await expect(
      pdf.saveChanges(await drawOnFirstPage(pdf.plain)),
    ).rejects.toBeInstanceOf(RestrictedChangeError);
  });

  it("encrypted, assembly withheld: even a rotation is refused", async () => {
    const pdf = await open(NO_ASSEMBLE_COPY_FIXTURE.file);
    expect(pdf.canAssemble).toBe(false);
    await expect(
      pdf.saveChanges(await setPageRotations(pdf.plain, [90, 0])),
    ).rejects.toBeInstanceOf(RestrictedChangeError);
  });
});
