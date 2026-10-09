// @vitest-environment node
/**
 * The probe behind "No selectable text on pages 1–3" — held to the reader
 * that decides whether text is selectable, not to the probe's own idea of it.
 *
 * `probePdf` never opens pdf.js for an ordinary file (the home page cannot
 * afford it), so the claim it feeds rests on a structural argument: a page
 * with no text operators and no font resource has no text layer to extract.
 * An argument is not a guard. These tests BIND the probe to the extractor
 * `pdf-to-text` uses (`extractPdfText`, run here on pdf.js's legacy build):
 *
 *  - every page the probe calls `image-only` extracts to empty text — the
 *    direction the claim needs (rule: conservative in the claim direction);
 *  - a page whose only text sits inside a Form XObject is NOT image-only —
 *    the negative control, and the one a missing recursion would fail;
 *  - the scan fixture yields image-only pages — the positive control, so a
 *    probe that never says image-only cannot pass the subset check vacuously.
 *
 * Encryption has TWO verdicts, not one (addendum WP-04 #71): the lock kind is
 * asked of pdf.js, the reader every viewer behaves like, and bound here both
 * ways to `loadPdf`'s refusal and to `probePdfEncryption`'s verdict. An
 * encrypted file yields no pdf-lib facts at all: in a PDF 1.5+ file the page
 * tree sits inside encrypted object streams, so pdf-lib reads garbage there.
 */
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  ownerOnlyEncryptedPdf,
  ownerOnlyObjectStreamPdf,
  unknownHandlerObjectStreamPdf,
  userPasswordEncryptedPdf,
  userPasswordObjectStreamPdf,
} from "@/tests/encrypted-pdf-fixture";
import {
  OWNER_ONLY_OBJSTM_PDF_BASE64,
  OWNER_ONLY_PDF_BASE64,
  USER_PASSWORD_PDF_BASE64,
} from "@/tests/fixtures-encrypted";
import { imageOnlyPdf, PNG_1PX, textPdf } from "@/tests/pdf-text-fixtures";
import {
  PDF_ENCRYPTED_UNKNOWN_MESSAGE,
  PDF_NEEDS_PASSWORD_MESSAGE,
  PDF_RESTRICTED_MESSAGE,
  probePdfEncryption,
} from "./encryption";
import { loadPdf, PdfEncryptedError } from "./engine";
import { inspectFormFields } from "./forms";
import { countPdfPagesDetailed } from "./page-count";
import { drawRasterImage, embedRasterImage } from "./pdf-lib";
import { imageOnlyRange, probePdf, type PdfProbe } from "./probe";
import { extractPdfText } from "./text";

const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

const NO_CEILING = { maxBytes: Number.POSITIVE_INFINITY };
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

/* ------------------------------------------------------------------ *
 *  Fixtures, built at test time with pdf-lib
 * ------------------------------------------------------------------ */

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

/** An image drawn at the top level, and text ONLY inside a Form XObject. */
async function textInFormXObjectPdf(): Promise<Uint8Array> {
  const inner = await PDFDocument.load(await textPdf([160]));
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const image = await embedRasterImage(doc, PNG_1PX, "png");
  await drawRasterImage(page, image, { x: 0, y: 0, width: 300, height: 300 });
  const [embedded] = await doc.embedPdf(inner, [0]);
  page.drawPage(embedded!, { x: 0, y: 320, width: 300, height: 300 });
  return doc.save();
}

/** An inline image (`BI … ID … EI`) and nothing else. */
async function inlineImagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const content = doc.context.stream(
    "q 100 0 0 100 0 0 cm BI /W 1 /H 1 /CS /G /BPC 8 ID \u0080 EI Q",
  );
  page.node.set(PDFName.of("Contents"), doc.context.register(content));
  return doc.save();
}

/** An image page whose tiling pattern carries text operators and a font. */
async function textInTilingPatternPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const image = await embedRasterImage(doc, PNG_1PX, "png");
  await drawRasterImage(page, image, { x: 0, y: 0, width: 100, height: 100 });
  const pattern = doc.context.stream(
    "BT /F1 12 Tf 2 2 Td (patterned) Tj ET",
    {
      Type: "Pattern",
      PatternType: 1,
      PaintType: 1,
      TilingType: 1,
      BBox: [0, 0, 60, 20],
      XStep: 60,
      YStep: 20,
      Resources: { Font: { F1: font.ref } },
    },
  );
  const resources = page.node.Resources()!;
  resources.set(
    PDFName.of("Pattern"),
    doc.context.obj({ P1: doc.context.register(pattern) }),
  );
  return doc.save();
}

/** A content stream behind a filter pdf-lib cannot decode. */
async function undecodablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const content = doc.context.stream("not really a JPEG", {
    Filter: "JBIG2Decode",
  });
  page.node.set(PDFName.of("Contents"), doc.context.register(content));
  return doc.save();
}

/** One page, two AcroForm text fields. */
async function twoFieldPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const form = doc.getForm();
  form.createTextField("probe.name").addToPage(page, { x: 20, y: 120 });
  form.createTextField("probe.date").addToPage(page, { x: 20, y: 60 });
  return doc.save();
}

/** Page 1 a scan, page 2 typed — a mixed document. */
async function scanThenTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = await embedRasterImage(doc, PNG_1PX, "png");
  await drawRasterImage(doc.addPage([200, 200]), image, {
    x: 0,
    y: 0,
    width: 200,
    height: 200,
  });
  const typed = doc.addPage([200, 200]);
  typed.drawText("typed", {
    x: 20,
    y: 100,
    size: 12,
    font: await doc.embedFont(StandardFonts.Helvetica),
  });
  return doc.save();
}

interface Fixture {
  readonly name: string;
  readonly bytes: () => Promise<Uint8Array>;
}

/** Unencrypted fixtures: the corpus the pdf.js binding runs over. */
const PLAIN: readonly Fixture[] = [
  { name: "text page", bytes: () => textPdf([200]) },
  { name: "scan, 1 page", bytes: () => imageOnlyPdf(1) },
  { name: "scan, 5 pages", bytes: () => imageOnlyPdf(5) },
  { name: "text inside a Form XObject", bytes: textInFormXObjectPdf },
  { name: "inline image", bytes: inlineImagePdf },
  { name: "text inside a tiling pattern", bytes: textInTilingPatternPdf },
  { name: "undecodable content", bytes: undecodablePdf },
  { name: "blank page", bytes: blankPdf },
  { name: "two form fields", bytes: twoFieldPdf },
  { name: "scan then text", bytes: scanThenTextPdf },
];

const probeOf = async (f: Fixture): Promise<[Uint8Array, PdfProbe]> => {
  const bytes = await f.bytes();
  return [bytes, await probePdf(bytes, NO_CEILING)];
};

/* ------------------------------------------------------------------ *
 *  What the probe reports
 * ------------------------------------------------------------------ */

describe("probePdf: what each kind of page reads as", () => {
  it("a text page is text, and a scan is image-only across its sample", async () => {
    const text = await probePdf(await textPdf([200]), NO_CEILING);
    expect(text).toMatchObject({ read: "ok", lock: "none", pages: 1 });
    expect(text.sample).toEqual(["text"]);
    expect(imageOnlyRange(text)).toBeNull();

    const scan = await probePdf(await imageOnlyPdf(1), NO_CEILING);
    expect(scan.sample).toEqual(["image-only"]);
    expect(imageOnlyRange(scan)).toEqual({ from: 1, to: 1 });
  });

  it("samples at most the first three pages, and the claim names only those", async () => {
    const scan = await probePdf(await imageOnlyPdf(5), NO_CEILING);
    expect(scan.pages).toBe(5);
    expect(scan.sample).toEqual(["image-only", "image-only", "image-only"]);
    expect(imageOnlyRange(scan)).toEqual({ from: 1, to: 3 });
    const two = await probePdf(await imageOnlyPdf(5), {
      ...NO_CEILING,
      samplePages: 2,
    });
    expect(two.sample).toHaveLength(2);
  });

  it("negative control: text only inside a Form XObject is text, not a scan", async () => {
    const probe = await probePdf(await textInFormXObjectPdf(), NO_CEILING);
    expect(probe.sample).toEqual(["text"]);
    expect(imageOnlyRange(probe)).toBeNull();
  });

  it("an inline image counts as an image; a tiling pattern's text suppresses the claim", async () => {
    expect((await probePdf(await inlineImagePdf(), NO_CEILING)).sample).toEqual(
      ["image-only"],
    );
    expect(
      (await probePdf(await textInTilingPatternPdf(), NO_CEILING)).sample,
    ).toEqual(["text"]);
  });

  it("a stream it cannot decode is unknown — never a claim", async () => {
    const probe = await probePdf(await undecodablePdf(), NO_CEILING);
    expect(probe.sample).toEqual(["unknown"]);
    expect(imageOnlyRange(probe)).toBeNull();
  });

  it("past the per-page decode budget a page is unknown", async () => {
    const probe = await probePdf(await imageOnlyPdf(1), {
      ...NO_CEILING,
      maxDecodedPerPage: 4,
    });
    expect(probe.sample).toEqual(["unknown"]);
  });

  it("a blank page is blank, and one scan page among typed ones makes no claim", async () => {
    expect((await probePdf(await blankPdf(), NO_CEILING)).sample).toEqual([
      "blank",
    ]);
    const mixed = await probePdf(await scanThenTextPdf(), NO_CEILING);
    expect(mixed.sample).toEqual(["image-only", "text"]);
    expect(imageOnlyRange(mixed)).toBeNull();
  });

  it("counts form fields", async () => {
    expect((await probePdf(await twoFieldPdf(), NO_CEILING)).formFields).toBe(
      2,
    );
    expect((await probePdf(await blankPdf(), NO_CEILING)).formFields).toBe(0);
  });

  it("over the ceiling it reads nothing; unreadable bytes say so; it never throws", async () => {
    const bytes = await textPdf([50]);
    expect(
      await probePdf(bytes, { maxBytes: bytes.byteLength - 1 }),
    ).toMatchObject({ read: "too-large", pages: null, sample: [] });
    const junk = new TextEncoder().encode("%PDF-1.7\nthis is not a pdf at all");
    expect(await probePdf(junk, NO_CEILING)).toMatchObject({
      read: "unreadable",
      pages: null,
      formFields: null,
      sample: [],
    });
    expect(await probePdf(new Uint8Array(), NO_CEILING)).toMatchObject({
      read: "unreadable",
    });
  });
});

/* ------------------------------------------------------------------ *
 *  Bound to the readers that decide each fact
 * ------------------------------------------------------------------ */

describe("probePdf is bound to pdf.js, the extractor pdf-to-text uses", () => {
  it("health: the corpus exercises every page class", async () => {
    const seen = new Set<string>();
    for (const f of PLAIN) for (const c of (await probeOf(f))[1].sample) seen.add(c);
    expect([...seen].sort()).toEqual(
      ["blank", "image-only", "text", "unknown"].sort(),
    );
  });

  it("every page it calls image-only extracts to EMPTY text (image-only ⊆ no text)", async () => {
    const violations: string[] = [];
    let imageOnly = 0;
    for (const f of PLAIN) {
      const [bytes, probe] = await probeOf(f);
      if (!probe.sample.includes("image-only")) continue;
      const extracted = await extractPdfText(bytes, legacy);
      probe.sample.forEach((kind, i) => {
        if (kind !== "image-only") return;
        imageOnly += 1;
        const text = extracted.pages[i]?.text.trim() ?? "";
        if (text !== "") violations.push(`${f.name} p${i + 1}: "${text}"`);
      });
    }
    // Positive control: the subset check above ran over real members.
    expect(imageOnly).toBeGreaterThanOrEqual(5);
    expect(violations).toEqual([]);
  });

  it("negative control under the extractor: the Form XObject page HAS text", async () => {
    const extracted = await extractPdfText(await textInFormXObjectPdf(), legacy);
    expect(extracted.pages[0]!.text.trim()).not.toBe("");
  });

  it("pages and form fields agree with the page counter, pdf.js and inspectFormFields", async () => {
    for (const f of PLAIN) {
      const [bytes, probe] = await probeOf(f);
      const counted = await countPdfPagesDetailed(bytes, NO_CEILING.maxBytes);
      expect(probe.pages, f.name).toBe(counted.ok ? counted.count : null);
      expect(probe.pages, f.name).toBe(
        (await extractPdfText(bytes, legacy)).pageCount,
      );
      expect(probe.formFields, f.name).toBe(
        (await inspectFormFields(bytes)).fields.length,
      );
    }
  });
});

describe("the lock is asked of pdf.js, and bound to the loaders' refusal", () => {
  const LOCKED: readonly (Fixture & { pages: number | null })[] = [
    { name: "owner-only", bytes: async () => ownerOnlyEncryptedPdf(), pages: 1 },
    {
      name: "user password",
      bytes: async () => userPasswordEncryptedPdf(),
      pages: null,
    },
    {
      name: "owner-only, object streams",
      bytes: async () => ownerOnlyObjectStreamPdf(),
      pages: 3,
    },
    {
      name: "user password, object streams",
      bytes: async () => userPasswordObjectStreamPdf(),
      pages: null,
    },
    {
      name: "unknown security handler",
      bytes: async () => unknownHandlerObjectStreamPdf(),
      pages: null,
    },
    {
      name: "owner-only, checked in",
      bytes: async () => b64(OWNER_ONLY_PDF_BASE64),
      pages: 3,
    },
    {
      name: "user password, checked in",
      bytes: async () => b64(USER_PASSWORD_PDF_BASE64),
      pages: null,
    },
    {
      name: "owner-only object streams, checked in",
      bytes: async () => b64(OWNER_ONLY_OBJSTM_PDF_BASE64),
      pages: 3,
    },
  ];
  const UNLOCKED: Fixture = { name: "control", bytes: () => textPdf([80]) };

  const LOCK_OF = {
    "needs-password": "password-required",
    "opens-without-password": "restricted",
  } as const;

  it("lock ≠ none ⇔ loadPdf refuses with PdfEncryptedError; the kind is the probe's verdict", async () => {
    const kinds = new Set<string>();
    for (const f of [...LOCKED, UNLOCKED]) {
      const bytes = await f.bytes();
      const probe = await probePdf(bytes, NO_CEILING);
      const refusal = await loadPdf(bytes).then(
        () => null,
        (e: unknown) => e,
      );
      expect(probe.lock !== "none", f.name).toBe(
        refusal instanceof PdfEncryptedError,
      );
      if (!(refusal instanceof PdfEncryptedError)) continue;
      const verdict = await probePdfEncryption(bytes);
      expect(refusal.verdict, f.name).toBe(verdict);
      expect(probe.lock, f.name).toBe(
        verdict === null ? "unknown" : LOCK_OF[verdict],
      );
      expect(refusal.message, f.name).toBe(
        verdict === "needs-password"
          ? PDF_NEEDS_PASSWORD_MESSAGE
          : verdict === "opens-without-password"
            ? PDF_RESTRICTED_MESSAGE
            : PDF_ENCRYPTED_UNKNOWN_MESSAGE,
      );
      kinds.add(probe.lock);
    }
    // Both kinds a person can act on are exercised, not just one.
    expect(kinds).toContain("password-required");
    expect(kinds).toContain("restricted");
  });

  it("an encrypted file yields no pdf-lib facts: pages only from pdf.js, no fields, no sample", async () => {
    for (const f of LOCKED) {
      const probe = await probePdf(await f.bytes(), NO_CEILING);
      expect(probe.formFields, f.name).toBeNull();
      expect(probe.sample, f.name).toEqual([]);
      expect(probe.pages, f.name).toBe(f.pages);
      expect(imageOnlyRange(probe), f.name).toBeNull();
    }
  });

  it("does not expose an `encrypted` field — consumers derive it from the lock", async () => {
    const probe = await probePdf(ownerOnlyEncryptedPdf(), NO_CEILING);
    expect(Object.keys(probe)).not.toContain("encrypted");
  });
});
