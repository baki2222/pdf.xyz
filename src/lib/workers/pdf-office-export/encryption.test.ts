// @vitest-environment node
/**
 * `pdfHasEncryptionDictionary` has two readers: pdf-lib, and a byte scan for
 * the trailer's `/Encrypt` entry when pdf-lib cannot parse the file at all.
 * The scan was unexercised: the RC4 fixture is well-formed, so pdf-lib alone
 * answered every test, and deleting the fallback turned nothing red. These
 * cases are built so that ONLY the scan can answer — pdf-lib throws on them
 * (checked, not assumed) — with a control that has no `/Encrypt` at all.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { rc4EncryptedPdf } from "@/tests/pdf-office-fixtures";
import { pdfHasEncryptionDictionary } from "./encryption";

/** The file with its `%PDF-1.4` header line cut off — pdf-lib refuses it. */
const headerless = (bytes: Uint8Array) => {
  const eol = bytes.indexOf(0x0a);
  return bytes.slice(eol + 1);
};

const pdfLibRefuses = (bytes: Uint8Array) =>
  PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    .then(() => false)
    .catch(() => true);

async function plainPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save({ useObjectStreams: false });
}

describe("pdfHasEncryptionDictionary", () => {
  it("answers from pdf-lib when pdf-lib can read the file", async () => {
    const locked = rc4EncryptedPdf({ userPassword: "x", ownerPassword: "y" });
    expect(await pdfLibRefuses(locked)).toBe(false);
    await expect(pdfHasEncryptionDictionary(locked)).resolves.toBe(true);
    await expect(pdfHasEncryptionDictionary(await plainPdf())).resolves.toBe(
      false,
    );
  });

  it("finds /Encrypt in a file pdf-lib cannot parse", async () => {
    const damaged = headerless(
      rc4EncryptedPdf({ userPassword: "x", ownerPassword: "y" }),
    );
    // Health check: pdf-lib really cannot answer, so only the scan can.
    expect(await pdfLibRefuses(damaged)).toBe(true);
    await expect(pdfHasEncryptionDictionary(damaged)).resolves.toBe(true);
  });

  it("POSITIVE CONTROL: a file pdf-lib cannot parse, with no /Encrypt, is not called encrypted", async () => {
    const damaged = headerless(await plainPdf());
    expect(await pdfLibRefuses(damaged)).toBe(true);
    await expect(pdfHasEncryptionDictionary(damaged)).resolves.toBe(false);
  });
});
