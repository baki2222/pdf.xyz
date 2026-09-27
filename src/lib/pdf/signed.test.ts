import { describe, expect, it } from "vitest";
import * as lib from "pdf-lib";
import { PDFDocument, PDFName } from "pdf-lib";
import {
  makeSignedPdf,
  signedBytes,
  type SignaturePlacement,
} from "@/tests/signed-pdf";
import { countSignatures } from "./signed";

async function count(bytes: Uint8Array): Promise<number> {
  return countSignatures(lib, await PDFDocument.load(bytes));
}

describe("the signed fixture (health check for everything below)", () => {
  it("is a signature a validator accepts before anything touches it", async () => {
    // Positive control for `signedBytes`: if the fixture's /ByteRange did not
    // describe the file, every "the repack broke it" assertion elsewhere would
    // pass for the wrong reason.
    const covered = await signedBytes(await makeSignedPdf());
    expect(covered).toHaveLength(1);
    expect(covered[0]).not.toBeNull();
  });

  it("puts the signature field where a form walk has to find it", async () => {
    const doc = await PDFDocument.load(await makeSignedPdf());
    const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"), lib.PDFDict);
    const fields = acroForm.lookup(PDFName.of("Fields"), lib.PDFArray);
    expect(fields.size()).toBeGreaterThan(0);
  });
});

describe("countSignatures", () => {
  // Every placement the fixture can build, and what a validator would have to
  // re-check after a rewrite. Derived from the placement type's own members by
  // listing them once here; the `satisfies` makes a new member a type error.
  const EXPECTED = {
    field: 1,
    orphan: 1,
    "direct-value": 1,
    "unsigned-field": 0,
  } as const satisfies Record<SignaturePlacement, number>;

  for (const [placement, expected] of Object.entries(EXPECTED)) {
    it(`counts ${expected} for a ${placement} signature`, async () => {
      expect(
        await count(
          await makeSignedPdf({ placement: placement as SignaturePlacement }),
        ),
      ).toBe(expected);
    });
  }

  it("counts every signature, not whether there is one", async () => {
    expect(await count(await makeSignedPdf({ count: 3 }))).toBe(3);
  });

  it("finds nothing in an unsigned document — and leaves its catalog alone", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const loaded = await PDFDocument.load(await doc.save());
    expect(countSignatures(lib, loaded)).toBe(0);
    // doc.getForm() would have CREATED an /AcroForm here, changing the file
    // the caller is about to save.
    expect(loaded.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  });
});
