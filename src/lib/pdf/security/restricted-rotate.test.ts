// @native-canvas
import { describe, expect, it } from "vitest";
import {
  ASSEMBLE_COPY_FIXTURE,
  GRANT_FIXTURE_TEXT,
  NO_ASSEMBLE_COPY_FIXTURE,
  RESTRICTED_FIXTURES,
  VIEW_ONLY_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import { setPageRotations } from "../engine";
import { RestrictedChangeError } from "./incremental";
import { openProtectedPdf, type ProtectedPdf } from "./protected-pdf";

/**
 * Rotating the pages of a restricted PDF (audit rotate-pdf#2). An author who
 * withholds "change the document" (/P bit 4) may still grant "assemble the
 * document" (bit 11: insert, ROTATE or delete pages, revision 3 and later).
 * Under that grant Rotate PDF writes the new /Rotate as an incremental update
 * under the author's own encryption; without it the writer refuses, below the
 * page, whatever the tool asks.
 *
 * Read back by pdf.js, which shares no code with the handler; the fixtures
 * were encrypted by pypdf.
 */

async function open(file: string): Promise<ProtectedPdf> {
  const result = await openProtectedPdf(readRestrictedFixture(file));
  if (result.kind !== "opened")
    throw new Error(`${file}: ${JSON.stringify(result)}`);
  return result.pdf;
}

async function readAsViewer(bytes: Uint8Array) {
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  try {
    const { info } = await doc.getMetadata();
    const rotations: number[] = [];
    let text = "";
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      rotations.push(page.rotate);
      const content = await page.getTextContent();
      text += content.items.map((x) => ("str" in x ? x.str : "")).join(" ");
    }
    return {
      encrypted:
        (info as { EncryptFilterName?: unknown }).EncryptFilterName != null,
      permissions: await doc.getPermissions(),
      rotations,
      text,
    };
  } finally {
    await task.destroy();
  }
}

describe("rotation under the author's assembly grant", () => {
  it("grants rotation exactly when /P bit 11 is set (revision 3+)", async () => {
    expect((await open(ASSEMBLE_COPY_FIXTURE.file)).canAssemble).toBe(true);
    expect((await open(NO_ASSEMBLE_COPY_FIXTURE.file)).canAssemble).toBe(false);
    expect((await open(VIEW_ONLY_FIXTURE.file)).canAssemble).toBe(false);
    // Fill-only: bit 11 withheld (R3+). R2 has no bit 11, so it follows
    // bit 4 (change the document), which is withheld there too.
    for (const fixture of RESTRICTED_FIXTURES)
      expect((await open(fixture.file)).canAssemble, fixture.file).toBe(false);
  });

  it("rotates page 1 only: same encryption and grant, original bytes a prefix, read back by pdf.js", async () => {
    const original = readRestrictedFixture(ASSEMBLE_COPY_FIXTURE.file);
    const pdf = await open(ASSEMBLE_COPY_FIXTURE.file);
    const edited = await setPageRotations(pdf.plain, [90, 0]);
    const out = await pdf.saveChanges(edited);

    // An incremental update: the author's file, untouched, then the change.
    expect(out.bytes.length).toBeGreaterThan(original.length);
    expect(out.bytes.subarray(0, original.length)).toEqual(original);

    const read = await readAsViewer(out.bytes);
    expect(read.encrypted).toBe(true);
    expect(read.permissions).toEqual(ASSEMBLE_COPY_FIXTURE.permissions);
    expect(read.rotations).toEqual([90, 0]);
    expect(read.text).toContain(GRANT_FIXTURE_TEXT);

    // The owner password still opens it as the owner: it was never touched.
    const again = await openProtectedPdf(out.bytes);
    expect(again.kind).toBe("opened");
    if (again.kind === "opened") {
      expect(again.pdf.canAssemble).toBe(true);
      expect(await again.pdf.unlock(ASSEMBLE_COPY_FIXTURE.owner)).toBe(true);
    }
  });

  it("refuses the same rotation when the author withholds assembly", async () => {
    for (const file of [
      NO_ASSEMBLE_COPY_FIXTURE.file,
      RESTRICTED_FIXTURES[0]!.file,
    ]) {
      const pdf = await open(file);
      const edited = await setPageRotations(
        pdf.plain,
        await rotationsOf(pdf.plain, 90),
      );
      await expect(pdf.saveChanges(edited), file).rejects.toBeInstanceOf(
        RestrictedChangeError,
      );
    }
  });

  it("the grant covers /Rotate only: a content change on the same page is still refused", async () => {
    const pdf = await open(ASSEMBLE_COPY_FIXTURE.file);
    const { loadPdfLib } = await import("../pdf-lib");
    const lib = await loadPdfLib();
    const doc = await lib.PDFDocument.load(pdf.plain);
    const page = doc.getPage(0);
    page.setRotation(lib.degrees(90));
    page.setMediaBox(0, 0, 300, 300);
    const edited = await doc.save();
    await expect(pdf.saveChanges(edited)).rejects.toBeInstanceOf(
      RestrictedChangeError,
    );
  });
});

async function rotationsOf(bytes: Uint8Array, angle: 90) {
  const { loadPdfLib } = await import("../pdf-lib");
  const lib = await loadPdfLib();
  const doc = await lib.PDFDocument.load(bytes);
  return doc.getPages().map(() => angle);
}
