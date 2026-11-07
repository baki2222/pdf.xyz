// @vitest-environment node
// @native-canvas
/**
 * Audit sign-pdf#5 (2026-11-06): signing a PDF someone had already signed
 * with a certificate rewrote the whole file, so the bytes their signature's
 * /ByteRange covers were gone and a viewer reported the document altered —
 * behind what looked like a successful download. The countersigning flow.
 *
 * Now the edit is APPENDED to such a file as an incremental update (ISO
 * 32000-1 §7.5.6): the original bytes first, untouched, then only what
 * changed. Read back as a validator and a viewer read it: every signature's
 * covered bytes are identical in the output, and pdf.js shows the new
 * signature on the page.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { exportEditedPdf } from "@/lib/pdf/editor-export";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { readAsViewer } from "@/tests/pdf-viewer-read";
import { hashedBytes, signedPdf, signedRanges } from "@/tests/signed-pdf";
import { typedSignatureObject } from "./model";
import { loadPdfLib } from "../pdf-lib";
import { readXref } from "../security/document";
import { appendEditsAsUpdate } from "./append-update";

/**
 * What a STRICT reader needs, which neither pdf.js (it rebuilds a broken
 * table silently) nor pdf-lib (it parses linearly) proves: the chain of
 * cross-reference sections from the last startxref, through /Prev, finds
 * every object the file holds, and each in-file entry points at that very
 * object's header.
 */
async function strictXrefHolds(bytes: Uint8Array): Promise<string[]> {
  const lib = await loadPdfLib();
  const xref = await readXref(lib, bytes);
  const text = new TextDecoder("latin1").decode(bytes);
  const problems: string[] = [];
  for (const [num, e] of xref.entries) {
    if (e.type !== 1 || num === 0 || e.offset < 0) continue; // free entries
    const head = text.slice(e.offset, e.offset + 24);
    if (!new RegExp(`^${num}\\s+${e.gen}\\s+obj\\b`).test(head))
      problems.push(`${num}: offset ${e.offset} reads ${JSON.stringify(head)}`);
  }
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [ref] of doc.context.enumerateIndirectObjects())
    if (!xref.entries.has(ref.objectNumber))
      problems.push(`${ref.objectNumber}: in the file, not in the xref chain`);
  // Health: the walk saw the objects (an empty table passes vacuously).
  if (xref.entries.size < 4) problems.push(`only ${xref.entries.size} entries`);
  return problems;
}

const NAME = "Grace Hopper";

async function countersign(original: Uint8Array) {
  const edited = await exportEditedPdf(original, [
    typedSignatureObject("t", 0, 60, 80, 300, NAME, "print"),
  ]);
  return { edited, out: await appendEditsAsUpdate(original, edited.bytes) };
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe("appendEditsAsUpdate on a certificate-signed PDF", () => {
  it("keeps every byte each signature covers, and adds the new signature", async () => {
    const original = await signedPdf({ signatures: 2 });
    const ranges = signedRanges(original);
    expect(ranges).toHaveLength(2);
    const { edited, out } = await countersign(original);

    // The original file is an untouched prefix of the output.
    expect(out.length).toBeGreaterThan(original.length);
    expect(same(out.subarray(0, original.length), original)).toBe(true);
    // What each validator hashes is byte-for-byte what was signed.
    for (const r of ranges)
      expect(same(hashedBytes(out, r), hashedBytes(original, r))).toBe(true);
    expect(countDigitalSignatures(out)).toBe(2);
    expect(await strictXrefHolds(out)).toEqual([]);

    // A viewer reads the update: the countersignature is on the page.
    const read = await readAsViewer(out);
    expect(read.texts.map((t) => t.str).join(" ")).toContain(NAME);

    // Control — the defect this replaces: the plain rewrite moved the bytes.
    const moved = ranges.some(
      (r) =>
        r[2] + r[3] > edited.bytes.length ||
        !same(hashedBytes(edited.bytes, r), hashedBytes(original, r)),
    );
    expect(moved).toBe(true);
  });

  it("writes only what changed, not the whole document again", async () => {
    const original = await signedPdf({ signatures: 1 });
    const { edited, out } = await countersign(original);
    // The appended section is smaller than the rewrite it replaces.
    expect(out.length - original.length).toBeLessThan(edited.bytes.length);
    // pdf-lib reads it as one document with the original page count.
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    // Positive control on the strict check: a table pointing one byte off
    // is caught.
    const broken = Uint8Array.from(out);
    const tail = new TextDecoder("latin1").decode(
      out.subarray(original.length),
    );
    const m = /\n(\d{10}) 00000 n\r\n/.exec(tail)!;
    const at = original.length + m.index + 1;
    const off = String(Number(m[1]) + 1).padStart(10, "0");
    broken.set(new TextEncoder().encode(off), at);
    expect((await strictXrefHolds(broken)).length).toBeGreaterThan(0);
  });

  it("works on a file whose newest cross-reference is a stream", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    doc.addPage([400, 400]);
    const original = await doc.save({ useObjectStreams: true });
    expect(new TextDecoder("latin1").decode(original)).toMatch(/\/XRef\b/);
    const { out } = await countersign(original);
    expect(same(out.subarray(0, original.length), original)).toBe(true);
    expect(await strictXrefHolds(out)).toEqual([]);
    const read = await readAsViewer(out);
    expect(read.texts.map((t) => t.str).join(" ")).toContain(NAME);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });
});

describe("what the editor's pages say about a signed PDF", () => {
  it("say the earlier signature is kept, no longer that it breaks", async () => {
    const { default: sign } = await import("@/lib/tools/content/sign-pdf");
    const { default: annotate } =
      await import("@/lib/tools/content/annotate-pdf");
    const { guides } = await import("@/lib/guides/catalog");
    const highlight = guides.find(
      (g) => g.slug === "how-to-highlight-text-in-a-pdf",
    )!;
    const signFaq = sign.faqs.map((f) => f.a).join(" ");
    const annotateFaq = annotate.faqs.map((f) => f.a).join(" ");
    const guideText = highlight.sections.flatMap((s) => s.body).join(" ");
    expect(signFaq).toMatch(/still verifies for the version they signed/);
    expect(annotateFaq).toMatch(/signature still verifies/);
    expect(guideText).toMatch(/signature still verifies/);
    // Inverted from what shipped until 2026-11-08.
    for (const text of [signFaq, annotateFaq, guideText]) {
      expect(text).not.toMatch(/rewritten rather than appended/);
      expect(text).not.toMatch(/signature will no longer validate/);
    }
  });
});
