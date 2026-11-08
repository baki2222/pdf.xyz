/**
 * SIB-12 (hostile matrix, verify): an unsigned placeholder
 * `/ByteRange [0 /********** /********** /**********]` — countSignatures vs
 * countDigitalSignatures on the same bytes. Variants separate the routes in
 * countSignatures (dict shape vs `/Type /Sig` vs field `/V`), so the verdict
 * says WHICH predicate counts it, not only that something does.
 */
import { describe, expect, it } from "vitest";
import * as lib from "pdf-lib";
import { countSignatures } from "@/lib/pdf/signed";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { SECURITY_FIXTURES } from "./security-in-browser.cells";
import { rawPdf } from "./security-in-browser.fixtures";
import type { PdfLibModule } from "@/lib/pdf/pdf-lib";

const PH = "[0 /********** /********** /**********]";
const SIG_CONTENTS = `<${"00".repeat(64)}>`;

function objs(sigDict: string, field: string): Parameters<typeof rawPdf>[0] {
  return {
    objects: [
      "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] /SigFlags 3 >> >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Annots [6 0 R] >>",
      { dict: "", stream: new TextEncoder().encode("0 0 m 100 100 l S") },
      sigDict,
      field,
    ],
  } as Parameters<typeof rawPdf>[0];
}

async function both(bytes: Uint8Array) {
  const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  return {
    structural: countSignatures(lib as unknown as PdfLibModule, doc),
    bytes: countDigitalSignatures(bytes),
  };
}

const FIELD_V =
  "<< /FT /Sig /T (Signature1) /V 5 0 R /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R >>";
const FIELD_NOV =
  "<< /FT /Sig /T (Signature1) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R >>";

describe("SIB-12 placeholder /ByteRange", () => {
  it("repro: the matrix fixture as shipped", async () => {
    const f = SECURITY_FIXTURES.find(
      (x) => x.id === "H17-plain-placeholder-byterange",
    );
    expect(f).toBeDefined();
    const bytes = (await f!.build()) as Uint8Array;
    const latin = Buffer.from(bytes).toString("latin1");
    expect(latin).toContain(`/ByteRange ${PH}`); // health check: placeholder landed
    const r = await both(bytes);
    console.log("SIB-12 fixture", r);
    expect(r).toEqual({ structural: 1, bytes: 0 });
  }, 15_000);

  it("positive control: real integer ByteRange counts 1 on both", async () => {
    const r = await both(
      rawPdf(
        objs(
          `<< /Type /Sig /Filter /Adobe.PPKLite /ByteRange [0 100 228 300] /Contents ${SIG_CONTENTS} >>`,
          FIELD_V,
        ),
      ),
    );
    console.log("SIB-12 control", r);
    expect(r.structural).toBe(1);
    expect(r.bytes).toBe(1);
  }, 15_000);

  it("isolate route 1 shape: no /Type /Sig, no field /V", async () => {
    const r = await both(
      rawPdf(
        objs(`<< /ByteRange ${PH} /Contents ${SIG_CONTENTS} >>`, FIELD_NOV),
      ),
    );
    console.log("SIB-12 shape-only", r);
    expect(r).toEqual({ structural: 1, bytes: 0 });
  }, 15_000);

  it("isolate /Type /Sig without ByteRange, no field /V", async () => {
    const r = await both(
      rawPdf(objs(`<< /Type /Sig /Contents ${SIG_CONTENTS} >>`, FIELD_NOV)),
    );
    console.log("SIB-12 type-only", r);
    expect(r.structural).toBe(1);
  }, 15_000);

  it("isolate route 2: field /V to a dict with neither ByteRange nor Type", async () => {
    const r = await both(rawPdf(objs(`<< /Filter /Adobe.PPKLite >>`, FIELD_V)));
    console.log("SIB-12 field-V-only", r);
    expect(r.structural).toBe(1);
  }, 15_000);
});
