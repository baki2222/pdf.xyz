import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  ALL_PERMISSIONS_ALLOWED,
  PDF_PERMISSIONS,
  PDF_PERMISSION_KEYS,
  permissionMismatches,
  permissionsFromP,
} from "@/lib/jobs/pdf-permissions";
import {
  ownerOnlyEncryptedPdf,
  ownerOnlyObjectStreamPdf,
} from "@/tests/encrypted-pdf-fixture";
import { readEncryptPermissions } from "./permission-bits";

const enc = (s: string) => new TextEncoder().encode(s);

/** A file whose only content that matters is an /Encrypt dict with this /P. */
function withP(p: string, opts: { direct?: boolean } = {}): Uint8Array {
  const dict = `<< /Filter /Standard /V 5 /R 6 /Length 256 /P ${p} /CF << /StdCF << /CFM /AESV3 /Length 32 >> >> >>`;
  return enc(
    opts.direct
      ? `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt ${dict} >>\n%%EOF\n`
      : `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n14 0 obj\n${dict}\nendobj\ntrailer\n<< /Root 1 0 R /Prev 999 /Encrypt 14 0 R >>\n%%EOF\n`,
  );
}

describe("readEncryptPermissions — /P read from the bytes, no password", () => {
  it("reads the fixture's /P through an indirect /Encrypt and a classic trailer", () => {
    // The fixture writes /P -3900 (src/tests/encrypted-pdf-fixture.ts).
    expect(readEncryptPermissions(ownerOnlyEncryptedPdf())).toBe(-3900);
  });

  it("reads it through a cross-reference STREAM, the shape qpdf and modern writers use", () => {
    expect(readEncryptPermissions(ownerOnlyObjectStreamPdf())).toBe(-3900);
  });

  it("reads a direct /Encrypt dictionary, nested /CF and all", () => {
    expect(readEncryptPermissions(withP("-3392", { direct: true }))).toBe(
      -3392,
    );
  });

  it("does not mistake /Prev or /Perms for /P", () => {
    expect(readEncryptPermissions(withP("-4"))).toBe(-4);
  });

  it("folds an unsigned 32-bit /P to the signed value", () => {
    expect(readEncryptPermissions(withP("4294967292"))).toBe(-4);
  });

  it("returns null for an unencrypted file — never a guess", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(readEncryptPermissions(await doc.save())).toBeNull();
  });
});

describe("permissionsFromP — the switches a /P grants", () => {
  it("-4 (every bit but 1-2) grants everything", () => {
    expect(permissionsFromP(-4)).toEqual(ALL_PERMISSIONS_ALLOWED);
  });

  it("each switch's bits, cleared alone, deny that switch and only that one", () => {
    for (const info of PDF_PERMISSIONS) {
      let p = -4;
      for (const bit of info.bits) p &= ~(1 << (bit - 1));
      const got = permissionsFromP(p);
      for (const key of PDF_PERMISSION_KEYS)
        expect(got[key], `${info.key} cleared, reading ${key}`).toBe(
          key !== info.key,
        );
      expect(permissionMismatches(p, ALL_PERMISSIONS_ALLOWED)).toEqual([
        info.key,
      ]);
    }
  });

  it("printing needs BOTH bit 3 and bit 12 — low-resolution-only is not 'Printing allowed'", () => {
    expect(permissionsFromP(-4 & ~(1 << 11)).print).toBe(false);
    expect(permissionsFromP(-4 & ~(1 << 2)).print).toBe(false);
  });

  it("the fixture's -3900 reads as print, copy, modify, annotate, forms and assembly denied", () => {
    expect(permissionsFromP(-3900)).toEqual({
      print: false,
      copy: false,
      modify: false,
      annotate: false,
      fillForms: false,
      accessibility: false,
      assemble: false,
    });
  });
});
