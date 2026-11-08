// @vitest-environment node
/**
 * Lane l10 of the hostile-input matrix: signature counting and linearization
 * verdicts. Each test is named for the finding it closes (PS-14, SIB-10..14,
 * EDIT-12) and was seen RED on the code before its fix.
 *
 * The CAUTION every test here is written under: signature counts drive the
 * signed-file protections (batch hold-back, the pre-Run warning, the edit
 * verdict). Under-counting a REAL signature is worse than over-counting it —
 * a false 0 lets a tool break a real signature without a word — so every
 * negative below sits beside a positive control that must keep counting.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import * as lib from "pdf-lib";
import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { openForBatch } from "@/components/tools/runner/batch/open-for-batch";
import { compressBatchFile } from "@/components/tools/runner/compress-batch";
import { errorMessage } from "@/components/tools/runner/runner-kit";
import { analyzePdf } from "@/lib/pdf/analyze";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { saveSignedEdit, signaturesKept } from "@/lib/pdf/editor/append-update";
import {
  PdfEngineError,
  UNREADABLE_PDF_MESSAGE,
} from "@/lib/pdf/engine-errors";
import { isLinearized, linearizationVerdict } from "@/lib/pdf/linearization";
import { countSignatures } from "@/lib/pdf/signed";
import { signedPdf as realisticSignedPdf } from "@/tests/signed-pdf";
import {
  appendUpdate,
  signedPdf as editingSignedPdf,
} from "./editing.fixtures";
import { ONE_PAGE, latin1, rawPdf } from "./page-structure.raw";
import {
  ONE_PAGE as SIB_ONE_PAGE,
  concatBytes,
  rawPdf as sibRawPdf,
  startxrefOf,
  type RawObject,
} from "./security-in-browser.fixtures";

const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const asFile = (b: Uint8Array, name: string) =>
  new File([new Uint8Array(b)], name);

/**
 * `./digital-signatures`'s two limits, restated here rather than exported:
 * that module is in the single-file runner's first load, which takes no new
 * exports. The boundary tests below pin both values (16 hits places, 17 does
 * not), so a change to either goes red here and has to be restated.
 */
const OBJECT_REACH = 1 << 20;
const MAX_PLACED_HITS = 16;

const CORPUS = join(process.cwd(), "src/tests/fixtures/legit-corpus");
const readCorpus = (f: string) => new Uint8Array(readFileSync(join(CORPUS, f)));

async function structuralCount(bytes: Uint8Array): Promise<number> {
  return countSignatures(lib, await PDFDocument.load(bytes));
}

/* ------------------------------------------------------------------ *
 *  Builders (the matrix's own, from security-in-browser.cells.ts).
 * ------------------------------------------------------------------ */

const SHOWN = "BT /F1 10 Tf 10 100 Td (/ByteRange [0 10 20 30]) Tj ET";

/** One page whose (uncompressed unless `dict` says so) content stream is `stream`. */
const contentPdf = (contents: { dict: string; stream: Uint8Array }) =>
  rawPdf({
    objects: [
      ONE_PAGE[0]!,
      ONE_PAGE[1]!,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
      contents,
    ],
  });

const SIG_CONTENTS = `<${"00".repeat(64)}>`;

/** One page plus a signature dictionary (5) on a field (6). */
function signedObjects(byteRange: string): RawObject[] {
  return [
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] /SigFlags 3 >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Annots [6 0 R] >>",
    { dict: "", stream: latin1("0 0 m 100 100 l S") },
    `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange ${byteRange} /Contents ${SIG_CONTENTS} >>`,
    "<< /FT /Sig /T (Signature1) /V 5 0 R /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R >>",
  ];
}

/** `base` plus an incremental update that rewrites object 5 with a new array. */
function signedThenResigned(): Uint8Array {
  const base = sibRawPdf({ objects: signedObjects("[0 100 228 300]") });
  const x1 = startxrefOf(base);
  const objAt = base.length;
  const obj = latin1(
    `5 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 120 248 400] /Contents ${SIG_CONTENTS} >>\nendobj\n`,
  );
  const xrefAt = objAt + obj.length;
  const update = latin1(
    `xref\n0 1\n0000000000 65535 f \n5 1\n${String(objAt).padStart(10, "0")} 00000 n \n` +
      `trailer\n<< /Size 7 /Root 1 0 R /Prev ${x1} >>\nstartxref\n${xrefAt}\n%%EOF\n`,
  );
  return concatBytes(base, obj, update);
}

/** First object `<< dict(len) >>`, with `/L` solved for the file's own length. */
function linearizedBy(dict: (len: string) => string): Uint8Array {
  const build = (len: number) =>
    sibRawPdf({
      objects: [
        `<< ${dict(String(len).padStart(10, "0"))} >>`,
        ...SIB_ONE_PAGE,
      ],
      numbers: [99, 1, 2, 3, 4],
    });
  let len = build(0).length;
  for (let i = 0; i < 3; i++) len = build(len).length;
  return build(len);
}

/* ------------------------------------------------------------------ *
 *  PS-14 / SIB-11: /ByteRange text that is not a dictionary key.
 * ------------------------------------------------------------------ */

describe("PS-14 / SIB-11: only a /ByteRange KEY counts, not text that spells one", () => {
  it("HEALTH: the hostile bytes really carry the literal text, and no signature", () => {
    const bytes = contentPdf({ dict: "", stream: latin1(SHOWN) });
    expect(text(bytes)).toContain("(/ByteRange [0 10 20 30])");
    expect(text(bytes)).not.toContain("/Sig");
  });

  it("PS-14: openForBatch counts 0 for an unsigned page that SHOWS '/ByteRange [0 10 20 30]'", async () => {
    const bytes = contentPdf({ dict: "", stream: latin1(SHOWN) });
    const opened = await openForBatch(asFile(bytes, "x.pdf"));
    expect(opened.signatures).toBe(0);
  });

  it("PS-14: a /ByteRange inside a literal string of a dictionary (/Info /Subject) counts 0", () => {
    const bytes = rawPdf({
      objects: [...ONE_PAGE, "<< /Subject (/ByteRange [0 10 20 30]) >>"],
    });
    expect(countDigitalSignatures(bytes)).toBe(0);
  });

  it("PS-14: an escaped paren in the string does not end it early", () => {
    const bytes = rawPdf({
      objects: [
        ...ONE_PAGE,
        "<< /Subject (a \\) b ( nested ) /ByteRange [0 10 20 30]) >>",
      ],
    });
    expect(countDigitalSignatures(bytes)).toBe(0);
  });

  it("SIB-11: countDigitalSignatures counts 0 for the same text in an uncompressed content stream", () => {
    const bytes = contentPdf({
      dict: "",
      stream: latin1("BT /F1 12 Tf 10 10 Td (/ByteRange [0 10 20 30]) Tj ET"),
    });
    expect(countDigitalSignatures(bytes)).toBe(0);
  });

  it("control: the Flate-compressed stream was never counted", () => {
    const bytes = contentPdf({
      dict: "/Filter /FlateDecode",
      stream: new Uint8Array(deflateSync(latin1(SHOWN))),
    });
    expect(countDigitalSignatures(bytes)).toBe(0);
  });

  it("POSITIVE CONTROL: a real signed file, and the same after an incremental update, still count 1 through openForBatch", async () => {
    const signed = await realisticSignedPdf();
    expect((await openForBatch(asFile(signed, "s.pdf"))).signatures).toBe(1);
    const updated = appendUpdate(signed, [{ num: 900, body: "(appended)" }]);
    expect(text(updated).startsWith(text(signed))).toBe(true);
    expect((await openForBatch(asFile(updated, "u.pdf"))).signatures).toBe(1);
  });

  it("POSITIVE CONTROL: a signature dictionary in the same file as the hostile text still counts", () => {
    const bytes = sibRawPdf({
      objects: [
        ...signedObjects("[0 100 228 300]").slice(0, 3),
        { dict: "", stream: latin1(SHOWN) },
        ...signedObjects("[0 100 228 300]").slice(4),
      ],
    });
    expect(countDigitalSignatures(bytes)).toBe(1);
  });

  it("POSITIVE CONTROL: a signature dictionary whose /Contents comes first, in compact syntax, counts", () => {
    const bytes = sibRawPdf({
      objects: [
        ...SIB_ONE_PAGE,
        `<</Type/Sig/Contents ${SIG_CONTENTS}/M(D:2026\\)x(y))/ByteRange[0 100 228 300]>>`,
      ],
    });
    expect(countDigitalSignatures(bytes)).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 *  SIB-10: a later revision rewriting the same signature object.
 * ------------------------------------------------------------------ */

describe("SIB-10: one signature object rewritten by a later revision is one signature", () => {
  it("HEALTH: the fixture carries two different arrays for object 5", () => {
    const t = text(signedThenResigned());
    expect(t).toContain("/ByteRange [0 100 228 300]");
    expect(t).toContain("/ByteRange [0 120 248 400]");
    expect(t.match(/^5 0 obj/gm)).toHaveLength(2);
  });

  it("SIB-10: countDigitalSignatures counts 1, as the structural counter and a reader do", async () => {
    const bytes = signedThenResigned();
    expect(await structuralCount(bytes)).toBe(1);
    expect(countDigitalSignatures(bytes)).toBe(1);
  });

  it("POSITIVE CONTROL: two signature objects with different arrays are two signatures", () => {
    const objects = signedObjects("[0 100 228 300]");
    const bytes = sibRawPdf({
      objects: [
        ...objects,
        `<< /Type /Sig /ByteRange [0 120 248 400] /Contents ${SIG_CONTENTS} >>`,
      ],
    });
    expect(countDigitalSignatures(bytes)).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 *  SIB-12: a placeholder /ByteRange is not a signature.
 * ------------------------------------------------------------------ */

describe("SIB-12: a placeholder /ByteRange is not a signature, by either counter", () => {
  const placeholder = () =>
    sibRawPdf({
      objects: signedObjects("[0 /********** /********** /**********]"),
    });

  it("HEALTH: the placeholder array is in the bytes, on a signed-looking field", () => {
    expect(text(placeholder())).toContain(
      "/ByteRange [0 /********** /********** /**********]",
    );
    expect(text(placeholder())).toContain("/V 5 0 R");
  });

  it("SIB-12: countSignatures counts 0, agreeing with countDigitalSignatures", async () => {
    expect(countDigitalSignatures(placeholder())).toBe(0);
    expect(await structuralCount(placeholder())).toBe(0);
  });

  it("SIB-12: Compress's analysis (the composed path that warned) reports 0 signatures", async () => {
    expect((await analyzePdf(placeholder())).analysis.signatureCount).toBe(0);
  });

  it("SIB-12: an odd-count or negative integer array is not a signature either", async () => {
    for (const range of ["[0 100 228]", "[0 -100 228 300]", "[0 100]"]) {
      const bytes = sibRawPdf({ objects: signedObjects(range) });
      expect(await structuralCount(bytes), range).toBe(0);
      expect(countDigitalSignatures(bytes), range).toBe(0);
    }
  });

  it("POSITIVE CONTROL: an integer /ByteRange counts 1 on both counters and in the analysis", async () => {
    const bytes = sibRawPdf({ objects: signedObjects("[0 100 228 300]") });
    expect(countDigitalSignatures(bytes)).toBe(1);
    expect(await structuralCount(bytes)).toBe(1);
    expect((await analyzePdf(bytes)).analysis.signatureCount).toBe(1);
  });

  it("POSITIVE CONTROL: a DIRECT signature value with an integer /ByteRange still counts (route 2)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ctx = doc.context;
    const field = ctx.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      T: PDFString.of("Signature1"),
      Rect: [0, 0, 0, 0],
      P: page.ref,
      V: ctx.obj({
        Type: "Sig",
        ByteRange: [0, 10, 20, 30],
        Contents: PDFHexString.of("00"),
      }),
    });
    const ref = ctx.register(field);
    doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [ref] }));
    expect(countSignatures(lib, await PDFDocument.load(await doc.save()))).toBe(
      1,
    );
  });
});

/* ------------------------------------------------------------------ *
 *  SIB-13: nested dictionaries inside the linearization dictionary.
 * ------------------------------------------------------------------ */

describe("SIB-13: the linearization dictionary's own /L, not a nested one", () => {
  it("SIB-13: a nested dictionary before /L does not hide the outer /L", () => {
    const bytes = linearizedBy(
      (l) => `/Linearized 1 /X << /L 5 >> /L ${l} /N 1`,
    );
    expect(text(bytes)).toContain("/X << /L 5 >>");
    expect(linearizationVerdict(bytes).detail).toContain(
      `/L=${bytes.byteLength}`,
    );
    expect(isLinearized(bytes)).toBe(true);
  });

  it("SIB-13 mirror: an inner /L equal to the file length does not stand in for a wrong outer /L", () => {
    const bytes = linearizedBy(
      (l) => `/Linearized 1 /X << /L ${l} >> /L 0000000005 /N 1`,
    );
    expect(isLinearized(bytes)).toBe(false);
  });

  it("SIB-13: a /Linearized flag that sits only in a nested dictionary does not count", () => {
    const bytes = linearizedBy((l) => `/X << /Linearized 1 >> /L ${l} /N 1`);
    expect(isLinearized(bytes)).toBe(false);
  });

  it("SIB-13: a '>>' inside a string in the dictionary does not end it", () => {
    const bytes = linearizedBy(
      (l) => `/Linearized 1 /Note (a >> b) /L ${l} /N 1`,
    );
    expect(isLinearized(bytes)).toBe(true);
  });

  it("POSITIVE CONTROL: the flat dictionary qpdf writes", () => {
    expect(
      isLinearized(linearizedBy((l) => `/Linearized 1 /L ${l} /N 1`)),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 *  SIB-14: a document with no catalog.
 * ------------------------------------------------------------------ */

describe("SIB-14: a file with no catalog gets the unreadable-PDF copy, never a TypeError", () => {
  const HEADER_ONLY = () => latin1("%PDF-1.7\n");

  it("HEALTH: pdf-lib loads the header-only file, with no catalog", async () => {
    const doc = await PDFDocument.load(HEADER_ONLY());
    expect(doc.catalog as unknown).toBeUndefined();
  });

  it("SIB-14: countSignatures throws a typed PdfEngineError (unreadable)", async () => {
    const doc = await PDFDocument.load(HEADER_ONLY());
    let err: unknown;
    try {
      countSignatures(lib, doc);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PdfEngineError);
    expect((err as PdfEngineError).kind).toBe("unreadable");
    expect((err as Error).message).toBe(UNREADABLE_PDF_MESSAGE);
  });

  it("SIB-14: the Compress batch row (compressBatchFile) says the file is unreadable", async () => {
    const err = await compressBatchFile(
      asFile(HEADER_ONLY(), "header-only.pdf"),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfEngineError);
    expect(errorMessage(err)).toBe(UNREADABLE_PDF_MESSAGE);
  });
});

/* ------------------------------------------------------------------ *
 *  EDIT-12: a forged /ByteRange is not "kept".
 * ------------------------------------------------------------------ */

describe("EDIT-12: a signature whose /ByteRange covers nothing is not kept by a rewrite", () => {
  const rewrite = async (bytes: Uint8Array) =>
    (await PDFDocument.load(bytes)).save({ useObjectStreams: false });

  it("EDIT-12: [0 0 0 0] after a full rewrite: kept 0", async () => {
    const zero = editingSignedPdf(() => [0, 0, 0, 0]);
    const rewritten = await rewrite(zero);
    expect(text(rewritten)).not.toBe(text(zero));
    expect(await signaturesKept(zero, rewritten)).toEqual({
      total: 1,
      kept: 0,
    });
  });

  it("EDIT-12: through saveSignedEdit (the save the editor runs), a removal's rewrite reports 0 kept", async () => {
    const zero = editingSignedPdf(() => [0, 0, 0, 0]);
    const saved = await saveSignedEdit(zero, await rewrite(zero), ["pages"]);
    expect(saved.mode).toBe("rewritten");
    expect(saved.signatures).toEqual({ total: 1, kept: 0 });
  });

  it("EDIT-12: ranges that do not start at 0, or stop short of a revision's end, are not kept even when appended", async () => {
    for (const forge of [
      (h: number[]) => [5, h[1]! - 5, h[2]!, h[3]!],
      (h: number[]) => [0, h[1]!, h[2]!, h[3]! - 7],
      (h: number[]) => [0, h[1]!, h[1]!, h[3]! + h[2]! - h[1]!],
      (h: number[]) => [0, 0, h[2]!, h[3]!],
    ]) {
      const forged = editingSignedPdf(forge);
      const appended = appendUpdate(forged, [{ num: 7, body: "(appended)" }]);
      expect(await signaturesKept(forged, appended)).toEqual({
        total: 1,
        kept: 0,
      });
    }
  });

  it("POSITIVE CONTROL: the honest range is kept by an append, and broken by a rewrite", async () => {
    const honest = editingSignedPdf();
    const appended = appendUpdate(honest, [{ num: 7, body: "(appended)" }]);
    expect(await signaturesKept(honest, appended)).toEqual({
      total: 1,
      kept: 1,
    });
    expect(await signaturesKept(honest, await rewrite(honest))).toEqual({
      total: 1,
      kept: 0,
    });
  });

  it("POSITIVE CONTROL: a signature of an EARLIER revision (ends at that revision's %%EOF) is kept by a further append", async () => {
    const honest = editingSignedPdf();
    const later = appendUpdate(honest, [{ num: 7, body: "(later)" }]);
    const again = appendUpdate(later, [{ num: 8, body: "(again)" }]);
    expect(await signaturesKept(later, again)).toEqual({ total: 1, kept: 1 });
  });
});

/* ------------------------------------------------------------------ *
 *  Thresholds: each constant fails toward COUNTING, on both sides.
 * ------------------------------------------------------------------ */

describe("countDigitalSignatures limits fail toward counting a real signature", () => {
  /** A signature object whose /Contents (before /ByteRange) is `hexChars` long. */
  const bigSignature = (hexChars: number) =>
    sibRawPdf({
      objects: [
        ...SIB_ONE_PAGE,
        `<< /Type /Sig /Contents <${"0".repeat(hexChars)}> /ByteRange [0 100 228 300] >>`,
      ],
    });

  it(`a signature whose header is beyond OBJECT_REACH (${OBJECT_REACH} B) is still counted, unplaced`, () => {
    expect(countDigitalSignatures(bigSignature(OBJECT_REACH + 1024))).toBe(1);
  });

  it("a signature just inside OBJECT_REACH is placed and counted", () => {
    expect(countDigitalSignatures(bigSignature(OBJECT_REACH - 1024))).toBe(1);
  });

  it("the realistic fixtures sit far inside OBJECT_REACH (header to /ByteRange)", async () => {
    for (const bytes of [
      await realisticSignedPdf(),
      await realisticSignedPdf({ signatures: 3 }),
    ]) {
      const t = text(bytes);
      let checked = 0;
      for (const m of t.matchAll(/\/ByteRange\s*\[/g)) {
        const header = t.lastIndexOf(" obj", m.index);
        expect(header).toBeGreaterThan(0);
        expect(m.index - header).toBeLessThan(OBJECT_REACH / 64);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  it(`more than MAX_PLACED_HITS (${MAX_PLACED_HITS}) hits: none are placed, every distinct array counts (the old behaviour)`, () => {
    const strings = Array.from(
      { length: MAX_PLACED_HITS + 1 },
      (_, i) => `<< /Subject (/ByteRange [0 10 20 ${30 + i}]) >>`,
    );
    const over = rawPdf({ objects: [...ONE_PAGE, ...strings] });
    expect(countDigitalSignatures(over)).toBe(MAX_PLACED_HITS + 1);
    const at = rawPdf({
      objects: [...ONE_PAGE, ...strings.slice(0, MAX_PLACED_HITS)],
    });
    expect(countDigitalSignatures(at)).toBe(0);
  });

  it("legit corpus: no real-producer file counts a signature", () => {
    const files = readdirSync(CORPUS).filter((f) => f.endsWith(".pdf"));
    expect(files.length).toBeGreaterThanOrEqual(14);
    for (const f of files) {
      expect(countDigitalSignatures(readCorpus(f)), f).toBe(0);
    }
  });
});

describe("SIB-13 positive control: the legit corpus's linearization verdicts", () => {
  it("exactly the two qpdf --linearize files are linearized", () => {
    const files = readdirSync(CORPUS).filter((f) => f.endsWith(".pdf"));
    expect(files.length).toBeGreaterThanOrEqual(14);
    const linearized = files.filter((f) => isLinearized(readCorpus(f)));
    expect(linearized.sort()).toEqual([
      "qpdf-linearized.pdf",
      "qpdf-objstm-linearized.pdf",
    ]);
  });
});
