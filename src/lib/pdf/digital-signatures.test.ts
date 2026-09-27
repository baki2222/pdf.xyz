import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { hashedBytes, signedPdf, signedRanges } from "@/tests/signed-pdf";
import { countDigitalSignatures } from "./digital-signatures";
import { signPdf } from "./signature";

/**
 * The audit (at 67e8d0f): signing a PDF that already carried a digital
 * signature silently invalidated it. pdf-lib only writes whole files, so the
 * bytes the counterparty's signature hashes are gone, and Acrobat shows it as
 * "document has been altered". Nothing on the sign path looked for one.
 */

const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

/** The fixture's AcroForm fields, read the way pdf-lib parses the file. */
async function sigFields(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const form = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const fields = form?.lookupMaybe(PDFName.of("Fields"), PDFArray);
  const out: { ft: string; signed: boolean }[] = [];
  for (let i = 0; i < (fields?.size() ?? 0); i += 1) {
    const f = fields!.lookup(i, PDFDict);
    out.push({
      ft: String(f.get(PDFName.of("FT"))),
      signed: f.has(PDFName.of("V")),
    });
  }
  return out;
}

describe("the signed fixture is what it claims (health check)", () => {
  it("has a /Sig field with a value, and a /ByteRange that excludes exactly /Contents", async () => {
    const bytes = await signedPdf();
    expect(await sigFields(bytes)).toEqual([{ ft: "/Sig", signed: true }]);
    const ranges = signedRanges(bytes);
    expect(ranges.length).toBe(1);
    const [a, b, c, d] = ranges[0]!;
    const text = latin1(bytes);
    expect(a).toBe(0);
    expect(text[b]).toBe("<");
    expect(text[c - 1]).toBe(">");
    expect(c + d).toBe(bytes.length);
    expect(text.slice(b + 1, c - 1)).toMatch(/^0+$/);
  });
});

describe("countDigitalSignatures", () => {
  it("counts a signed signature field (positive control)", async () => {
    expect(countDigitalSignatures(await signedPdf())).toBe(1);
  });

  it("counts each signature once", async () => {
    expect(countDigitalSignatures(await signedPdf({ signatures: 2 }))).toBe(2);
  });

  it("counts a signature dictionary written again in a later revision once", async () => {
    // An incremental update may re-write the signature's object (a viewer
    // adding validation data, say); it is still one signature over one range.
    const bytes = await signedPdf();
    const [[a, b, c, d]] = signedRanges(bytes) as [
      [number, number, number, number],
    ];
    const revision = Buffer.from(
      `\n99 0 obj\n<< /Type /Sig /ByteRange [${a} ${b} ${c} ${d}] >>\nendobj\n`,
      "latin1",
    );
    const updated = new Uint8Array(Buffer.concat([bytes, revision]));
    expect(signedRanges(updated).length).toBe(2);
    expect(countDigitalSignatures(updated)).toBe(1);
  });

  it("does not count an unsigned PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(countDigitalSignatures(await doc.save())).toBe(0);
  });

  it("does not count a signature field nobody has signed", async () => {
    const bytes = await signedPdf({ signatures: 0, unsignedFields: 1 });
    // Health: the field is really there, and really empty.
    expect(await sigFields(bytes)).toEqual([{ ft: "/Sig", signed: false }]);
    expect(countDigitalSignatures(bytes)).toBe(0);
    // And beside a signed one it adds nothing.
    expect(
      countDigitalSignatures(
        await signedPdf({ signatures: 1, unsignedFields: 2 }),
      ),
    ).toBe(1);
  });

  it("does not count a placeholder written before signing, or a longer name", () => {
    const decoys = [
      "%PDF-1.7\n1 0 obj << /ByteRange [0 /********** /********** /**********] >> endobj",
      "%PDF-1.7\n1 0 obj << /ByteRangeX [0 10 20 30] >> endobj",
      "%PDF-1.7\n1 0 obj << /ByteRange [0 10 20] >> endobj",
    ];
    for (const d of decoys) {
      expect(countDigitalSignatures(new Uint8Array(Buffer.from(d)))).toBe(0);
    }
    // Control: the same shape, well-formed, is counted.
    const real = "%PDF-1.7\n1 0 obj << /ByteRange[0 10 20 30] >> endobj";
    expect(countDigitalSignatures(new Uint8Array(Buffer.from(real)))).toBe(1);
  });
});

describe("why the warning exists: a tool's save breaks the signature", () => {
  it("Sign PDF's output no longer holds the bytes the signature hashed", async () => {
    // The warning's premise, pinned. If our save ever becomes an incremental
    // update — the original bytes kept as a prefix — the signature survives,
    // this goes red, and the notice must be re-worded rather than kept.
    const original = await signedPdf();
    const out = await signPdf(
      original,
      { kind: "typed", text: "Ada Lovelace", style: "print" },
      { pageIndex: 0, position: "bottom-right", width: 160 },
    );
    const [range] = signedRanges(original);
    const before = hashedBytes(original, range!);
    const prefix = out.subarray(0, original.length);
    expect(Buffer.compare(prefix, original)).not.toBe(0);
    // Whatever now sits at the old ranges is not what was signed. (pdf-lib
    // also moves the signature dictionary into a compressed object stream, so
    // it is no longer literal bytes at all — a layout no signer produces, and
    // one the detector rightly does not count: there is nothing left intact
    // for a second tool to warn about.)
    const now =
      range![2] + range![3] <= out.length ? hashedBytes(out, range!) : null;
    expect(now === null || Buffer.compare(now, before) !== 0).toBe(true);
    expect(signedRanges(out)).toEqual([]);
    expect(countDigitalSignatures(out)).toBe(0);
  });
});
