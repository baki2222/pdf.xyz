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
import { spliceStartxrefPastEnd } from "@/tests/damaged-xref";
import { type EditorObject, type RedactObject } from "./model";
import { typedSignatureObject } from "./typed-signature";
import { sourcePages } from "./pages";
import { loadPdfLib } from "../pdf-lib";
import { readXref } from "../security/document";
import {
  appendEditsAsUpdate,
  saveSignedEdit,
  signaturesKept,
} from "./append-update";
import { REMOVALS, listRemovals, removalsIn } from "./signed-edit";

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
    // The exception is named from the same list the editor decides by,
    // and a protected file is not promised the append (review, 2026-11-08).
    const removals = listRemovals(REMOVALS, "disjunction");
    expect(signFaq).toContain(removals);
    expect(annotateFaq).toContain(removals);
    expect(signFaq).toMatch(/earlier signature no longer verifies/);
    expect(annotateFaq).toMatch(/signature no longer verifies/);
    expect(annotateFaq).toMatch(
      /digital signature and is not password-protected/,
    );
    expect(guideText).toMatch(
      /digital signature, and is not password-protected/,
    );
    // Inverted from what shipped until 2026-11-08.
    for (const text of [signFaq, annotateFaq, guideText]) {
      expect(text).not.toMatch(/rewritten rather than appended/);
      expect(text).not.toMatch(/signature will no longer validate/);
    }
  });
});

/*
 * Review of sign-pdf#5 (2026-11-08). Appending was applied to EVERY edit of
 * a signed file — redaction, retyped text and deleted pages included — and
 * an appended update keeps the original bytes as its prefix: the redacted
 * words stayed in the download as the earlier revision. And the result
 * said "1 existing signature left intact" after the signed page was
 * deleted, because the claim was the INPUT's count.
 */
describe("saveSignedEdit: what may be appended, and what was kept", () => {
  const SECRET = "ACCOUNT 4417-SECRET";

  /** Every revision a reader can recover: each prefix ending at a %%EOF. */
  function revisions(bytes: Uint8Array): Uint8Array[] {
    const text = new TextDecoder("latin1").decode(bytes);
    const out: Uint8Array[] = [];
    for (const m of text.matchAll(/%%EOF/g))
      out.push(bytes.subarray(0, m.index + 5));
    return out;
  }
  async function revisionsShowing(bytes: Uint8Array, needle: string) {
    const hits: number[] = [];
    for (const [i, rev] of revisions(bytes).entries()) {
      const read = await readAsViewer(rev);
      if (
        read.texts
          .map((t) => t.str)
          .join(" ")
          .includes(needle)
      )
        hits.push(i);
    }
    return hits;
  }
  const redactOver = (): RedactObject => ({
    id: "r",
    kind: "redact",
    page: 0,
    // Viewer points from the top: the 14 pt line at baseline y = 700.
    x: 60,
    y: 60,
    width: 400,
    height: 60,
    fill: "black",
  });

  it("a redaction is not appended: the secret is in no revision of the output", async () => {
    const original = await signedPdf({ signatures: 1, text: SECRET });
    // Health: the fixture shows the secret, in its one revision.
    expect(await revisionsShowing(original, SECRET)).toEqual([0]);
    const objects = [redactOver()];
    const removals = removalsIn(
      { objects, pages: sourcePages(1), removedLinks: [] },
      1,
    );
    expect(removals).toEqual(["redact"]);
    const edited = await exportEditedPdf(original, objects);
    const saved = await saveSignedEdit(original, edited.bytes, removals);

    expect(saved.mode).toBe("rewritten");
    expect(saved.reason).toBe("removes");
    expect(revisions(saved.bytes).length).toBeGreaterThan(0);
    expect(await revisionsShowing(saved.bytes, SECRET)).toEqual([]);
    // Said honestly: the signature is not kept.
    expect(saved.signatures).toEqual({ total: 1, kept: 0 });

    // Control — the defect: appended, the first revision still has it.
    const appended = await saveSignedEdit(original, edited.bytes, []);
    expect(appended.mode).toBe("appended");
    expect(await revisionsShowing(appended.bytes, SECRET)).toEqual([0]);
  });

  it("retyped text, deleted pages and deleted links count as removals; added things do not", () => {
    const pages = sourcePages(2);
    const sig = typedSignatureObject("t", 0, 60, 80, 300, NAME, "print");
    const base = { objects: [sig], pages, removedLinks: [] as string[] };
    expect(removalsIn(base, 2)).toEqual([]);
    expect(
      removalsIn(
        { ...base, objects: [{ kind: "textedit" } as EditorObject] },
        2,
      ),
    ).toEqual(["textedit"]);
    expect(removalsIn({ ...base, pages: pages.slice(1) }, 2)).toEqual([
      "pages",
    ]);
    // A reorder or a turn removes nothing.
    expect(
      removalsIn(
        {
          ...base,
          pages: [{ ...pages[1]!, rotate: 90 }, pages[0]!],
        },
        2,
      ),
    ).toEqual([]);
    expect(removalsIn({ ...base, removedLinks: ["12 0 R"] }, 2)).toEqual([
      "links",
    ]);
    // Every removal has a label the notices list.
    expect(listRemovals(REMOVALS, "disjunction")).toBe(
      "a redaction, a change to the page's own text (Edit text or Find & replace), a deleted page, or a deleted link",
    );
  });

  it("deleting the signed page: rewritten, and the output's count says 0 kept", async () => {
    const original = await signedPdf({ signatures: 1, extraPages: 1 });
    const pages = sourcePages(2).filter((p) => p.source !== 0);
    const removals = removalsIn({ objects: [], pages, removedLinks: [] }, 2);
    expect(removals).toEqual(["pages"]);
    const edited = await exportEditedPdf(original, [], undefined, { pages });
    const saved = await saveSignedEdit(original, edited.bytes, removals);
    expect(saved.mode).toBe("rewritten");
    expect(saved.signatures).toEqual({ total: 1, kept: 0 });

    // Even forced through the append, the claim is read from the output:
    // the field is gone from the current revision, so it is not "kept" —
    // though a count of /ByteRange still finds the orphaned dictionary.
    const forced = await saveSignedEdit(original, edited.bytes, []);
    expect(forced.mode).toBe("appended");
    expect(countDigitalSignatures(forced.bytes)).toBe(1);
    expect(forced.signatures).toEqual({ total: 1, kept: 0 });
  });

  it("a countersignature is appended, and the output keeps every signature", async () => {
    const original = await signedPdf({ signatures: 2 });
    const { edited } = await countersign(original);
    const saved = await saveSignedEdit(original, edited.bytes, []);
    expect(saved.mode).toBe("appended");
    expect(saved.signatures).toEqual({ total: 2, kept: 2 });
    // Positive control on the check: the plain rewrite keeps none.
    expect(await signaturesKept(original, edited.bytes)).toEqual({
      total: 2,
      kept: 0,
    });
  });

  it("a file whose cross-reference chain is damaged falls back to the rewrite, and says so", async () => {
    const original = spliceStartxrefPastEnd(await signedPdf({ signatures: 1 }));
    expect(countDigitalSignatures(original)).toBe(1);
    const edited = await exportEditedPdf(original, [
      typedSignatureObject("t", 0, 60, 80, 300, NAME, "print"),
    ]);
    // Health: the strict append really does refuse this file.
    await expect(appendEditsAsUpdate(original, edited.bytes)).rejects.toThrow();
    const saved = await saveSignedEdit(original, edited.bytes, []);
    expect(saved.mode).toBe("rewritten");
    expect(saved.reason).toBe("unreadable");
    expect(saved.bytes).toBe(edited.bytes);
    expect(saved.signatures.kept).toBe(0);
    const read = await readAsViewer(saved.bytes);
    expect(read.texts.map((t) => t.str).join(" ")).toContain(NAME);
  });
});
