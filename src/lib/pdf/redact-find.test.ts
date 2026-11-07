// @native-canvas
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  degrees,
} from "pdf-lib";
import {
  MAX_FOUND,
  PII_CATEGORIES,
  detectInText,
  detectPersonalData,
  findTextMatches,
  ibanValid,
  luhnValid,
  readRedactText,
  type PiiCategory,
} from "./redact-find";
import { SCRUBBED_TEXT, redactPdfByRemoval } from "./redact-remove";
import { extractPdfText, type PdfTextReader } from "./text";

/**
 * Redact PDF's Find text / Detect personal data, and the removal they feed.
 * Every assertion about a redaction re-opens the OUTPUT with pdf.js — the
 * reader a person searching the file would use — and asks for the text.
 */

const legacy: PdfTextReader = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Awaited<
    ReturnType<PdfTextReader>
  >;

/** Each category's fixture strings — what detection must find. */
const POSITIVE: Record<PiiCategory, readonly string[]> = {
  email: ["jane.example@mail.test", "j.o'neil+bills@example.co.uk"],
  phone: [
    "+44 20 7946 0958",
    "(415) 555-0132",
    "020 7946 0018",
    "+1 415-555-0198",
  ],
  card: ["4111 1111 1111 1111", "5555-5555-5555-4444", "378282246310005"],
  iban: ["GB82 WEST 1234 5698 7654 32", "DE89370400440532013000"],
  dob: ["14/03/1987", "1990-07-02", "3 March 1975"],
};

/** Decoys — what detection must NOT find, in any category. */
const DECOYS = [
  "Joined in 2019.",
  "Order no. 48213907",
  "Order ORD-2024-118842",
  "Reference 0123456789",
  "Old card 4111 1111 1111 1112",
  "Appointment 02/05/2024",
  "Total 1,234,567.89",
  "IBAN GB82 WEST 1234 5698 7654 33",
  "Invoice 2024-03-15",
  "Room 101, floor 3",
];

const LINES_PAGE_1 = [
  "Patient: Jane Q. Example",
  "Email: jane.example@mail.test",
  "Mobile: +44 20 7946 0958",
  "Card on file: 4111 1111 1111 1111",
  "IBAN: GB82 WEST 1234 5698 7654 32",
  "Date of birth: 14/03/1987",
  "Joined in 2019. Order no. 48213907.",
  "Old card 4111 1111 1111 1112 was declined.",
  "Office: (415) 555-0132",
  "Appointment 02/05/2024 confirmed.",
  "Keep this sentence exactly.",
];
const LINES_PAGE_2 = [
  "Contact jane.example@mail.test again later.",
  "Second page stays readable.",
];

async function fixture(rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of [LINES_PAGE_1, LINES_PAGE_2]) {
    const page = doc.addPage([595, 842]);
    if (rotate) page.setRotation(degrees(rotate));
    lines.forEach((line, i) => {
      page.drawText(line, { x: 56, y: 780 - i * 24, size: 12, font });
    });
  }
  return doc.save();
}

async function textOf(bytes: Uint8Array): Promise<string[]> {
  const { pages } = await extractPdfText(bytes, legacy);
  return pages.map((p) => p.text.replace(/\s+/g, " "));
}

describe("detectInText", () => {
  for (const kind of PII_CATEGORIES) {
    for (const sample of POSITIVE[kind]) {
      it(`finds ${kind}: ${sample}`, () => {
        const text =
          kind === "dob" ? `DOB: ${sample} and more` : `See ${sample} today`;
        const hits = detectInText(text, PII_CATEGORIES);
        const hit = hits.find((h) => h.kind === kind);
        expect(hit, JSON.stringify(hits)).toBeDefined();
        expect(text.slice(hit!.start, hit!.end)).toBe(sample);
      });
    }
  }

  for (const decoy of DECOYS) {
    it(`does not match the decoy "${decoy}"`, () => {
      expect(detectInText(decoy, PII_CATEGORIES)).toEqual([]);
    });
  }

  it("dates need a date-of-birth label, and only the date is boxed", () => {
    expect(detectInText("Signed 14/03/1987", ["dob"])).toEqual([]);
    for (const label of ["Date of birth", "DOB", "D.O.B.", "Birth date"]) {
      const text = `${label}: 14/03/1987`;
      const [hit] = detectInText(text, ["dob"]);
      expect(text.slice(hit!.start, hit!.end)).toBe("14/03/1987");
    }
  });

  it("asks only for the categories ticked", () => {
    const text = "jane@example.com +44 20 7946 0958";
    expect(detectInText(text, ["phone"]).map((h) => h.kind)).toEqual(["phone"]);
    expect(detectInText(text, [])).toEqual([]);
  });

  it("checksums: Luhn and IBAN mod-97, both directions", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(ibanValid("GB82WEST12345698765432")).toBe(true);
    expect(ibanValid("GB82WEST12345698765433")).toBe(false);
  });

  it("health check: every category has fixtures and every fixture is matched by its own category", () => {
    // [] ⊆ X is vacuously true: an empty corpus would pass every test above.
    for (const kind of PII_CATEGORIES) {
      expect(POSITIVE[kind].length).toBeGreaterThan(1);
    }
    expect(DECOYS.length).toBeGreaterThanOrEqual(10);
  });
});

describe("readRedactText → matches → boxes", () => {
  it("finds every fixture category on the page, and none of the decoys", async () => {
    const index = await readRedactText(await fixture(), legacy);
    expect(index.pagesWithoutText).toEqual([]);
    // Boxes come from the drawn glyphs, not an estimate, for a plain font.
    expect(index.placement.estimated).toBe(0);
    expect(index.placement.glyphs).toBeGreaterThan(10);
    const found = detectPersonalData(index, PII_CATEGORIES).matches;
    const byKind = (k: PiiCategory) =>
      found.filter((f) => f.kind === k).map((f) => `${f.page}:${f.text}`);
    expect(byKind("email")).toEqual([
      "1:jane.example@mail.test",
      "2:jane.example@mail.test",
    ]);
    expect(byKind("phone")).toEqual(["1:+44 20 7946 0958", "1:(415) 555-0132"]);
    expect(byKind("card")).toEqual(["1:4111 1111 1111 1111"]);
    expect(byKind("iban")).toEqual(["1:GB82 WEST 1234 5698 7654 32"]);
    expect(byKind("dob")).toEqual(["1:14/03/1987"]);
    expect(found.every((f) => f.rects.length > 0)).toBe(true);
  });

  it("search: match case and whole word", async () => {
    const index = await readRedactText(await fixture(), legacy);
    const count = (q: string, matchCase: boolean, wholeWord: boolean) =>
      findTextMatches(index, q, { matchCase, wholeWord }).matches.length;
    expect(count("jane", false, false)).toBe(3); // Jane + 2 × jane.example
    expect(count("jane", true, false)).toBe(2);
    expect(count("Jane", true, true)).toBe(1);
    expect(count("card", false, true)).toBe(2);
    expect(count("ca", false, true)).toBe(0);
    expect(count("   ", false, false)).toBe(0);
  });

  it("a box covers the match and not the label before it", async () => {
    const index = await readRedactText(await fixture(), legacy);
    const [email] = findTextMatches(index, "jane.example@mail.test", {
      matchCase: true,
      wholeWord: false,
    }).matches;
    const rect = email!.rects[0]!;
    // "Email: " in 12 pt Helvetica is ~38 pt wide, drawn from x = 56.
    expect(rect.x).toBeGreaterThan(56 + 30);
    expect(rect.y).toBeGreaterThan(780 - 24 - 6);
    expect(rect.y + rect.height).toBeLessThan(780 - 24 + 14);
  });
});

describe("redactPdfByRemoval", () => {
  it("removes every detected string from the text, and leaves the rest", async () => {
    const bytes = await fixture();
    const index = await readRedactText(bytes, legacy);
    const found = detectPersonalData(index, PII_CATEGORIES).matches;
    expect(found.length).toBe(7);
    const result = await redactPdfByRemoval(
      bytes,
      {
        rects: found.flatMap((f) =>
          f.rects.map((r) => ({ ...r, fromText: true })),
        ),
        verify: found,
        loadReader: legacy,
      },
      { decodeJpeg: null },
    );
    expect(result.verified).toBe(7);
    const [p1, p2] = await textOf(result.bytes);
    for (const f of found) {
      expect(f.page === 1 ? p1 : p2).not.toContain(f.text);
    }
    // The positive control: the same strings ARE in the input's text.
    const [in1] = await textOf(bytes);
    expect(in1).toContain("4111 1111 1111 1111");
    // What was not chosen is still text.
    expect(p1).toContain("Patient: Jane Q. Example");
    expect(p1).toContain("Email:");
    expect(p1).toContain("Date of birth:");
    expect(p1).toContain("Old card 4111 1111 1111 1112 was declined.");
    expect(p1).toContain("Joined in 2019. Order no. 48213907.");
    expect(p1).toContain("Appointment 02/05/2024 confirmed.");
    expect(p1).toContain("Keep this sentence exactly.");
    expect(p2).toContain("Contact");
    expect(p2).toContain("again later.");
    expect(p2).toContain("Second page stays readable.");
  });

  it("an unticked second copy stays, and the check does not count it as a miss", async () => {
    const bytes = await fixture();
    const index = await readRedactText(bytes, legacy);
    const { matches } = findTextMatches(index, "jane.example@mail.test", {
      matchCase: true,
      wholeWord: false,
    });
    const first = matches.filter((m) => m.page === 1);
    const result = await redactPdfByRemoval(
      bytes,
      {
        rects: first.flatMap((f) =>
          f.rects.map((r) => ({ ...r, fromText: true })),
        ),
        verify: first,
        loadReader: legacy,
      },
      { decodeJpeg: null },
    );
    const [p1, p2] = await textOf(result.bytes);
    expect(p1).not.toContain("jane.example@mail.test");
    expect(p2).toContain("jane.example@mail.test");
  });

  it("refuses a file whose chosen text survives (the check can fail)", async () => {
    const bytes = await fixture();
    const index = await readRedactText(bytes, legacy);
    const [card] = detectPersonalData(index, ["card"]).matches;
    // A box somewhere else entirely: nothing under it is the card number.
    await expect(
      redactPdfByRemoval(
        bytes,
        {
          rects: [{ page: 1, x: 300, y: 100, width: 50, height: 20 }],
          verify: [card!],
          loadReader: legacy,
        },
        { decodeJpeg: null },
      ),
    ).rejects.toThrow(/still in the text of page 1/);
  });

  it("places boxes on a rotated page so the removal still lands", async () => {
    const bytes = await fixture(90);
    const index = await readRedactText(bytes, legacy);
    const found = detectPersonalData(index, ["email", "card"]).matches;
    expect(found.length).toBe(3);
    const result = await redactPdfByRemoval(
      bytes,
      {
        rects: found.flatMap((f) =>
          f.rects.map((r) => ({ ...r, fromText: true })),
        ),
        verify: found,
        loadReader: legacy,
      },
      { decodeJpeg: null },
    );
    const [p1] = await textOf(result.bytes);
    expect(p1).not.toContain("4111 1111 1111 1111");
    expect(p1).toContain("Keep this sentence exactly.");
  });
});

/**
 * Audit #3 (2026-11-06): "Remove text under boxes" re-checked only the PAGE
 * text, so a chosen name survived in the Title, Author, XMP, a bookmark and a
 * comment while the result said it was "not in its text".
 */
describe("redactPdfByRemoval: the chosen text outside the page text", () => {
  const NAME = "Jane Q. Example";

  async function withHiddenCopies(
    extra?: (doc: PDFDocument) => void,
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.load(await fixture());
    doc.setTitle(`Report on ${NAME}`);
    doc.setAuthor(NAME);
    doc.setSubject("Kept subject");
    const ctx = doc.context;
    doc.catalog.set(
      PDFName.of("Metadata"),
      ctx.register(
        ctx.stream(
          `<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>${NAME}</dc:creator><dc:format>application/pdf</dc:format></x:xmpmeta>`,
          { Type: "Metadata", Subtype: "XML" },
        ),
      ),
    );
    const outlinesRef = ctx.nextRef();
    const itemRef = ctx.nextRef();
    const keptRef = ctx.nextRef();
    const page1 = doc.getPage(0).ref;
    ctx.assign(
      itemRef,
      ctx.obj({
        Title: PDFHexString.fromText(NAME),
        Parent: outlinesRef,
        Next: keptRef,
        Dest: [page1, "Fit"],
      }),
    );
    ctx.assign(
      keptRef,
      ctx.obj({
        Title: PDFString.of("Kept bookmark"),
        Parent: outlinesRef,
        Prev: itemRef,
        Dest: [page1, "Fit"],
      }),
    );
    ctx.assign(
      outlinesRef,
      ctx.obj({ Type: "Outlines", First: itemRef, Last: keptRef, Count: 2 }),
    );
    doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
    const note = ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Text",
        Rect: [400, 40, 420, 60],
        Contents: PDFString.of(`Call ${NAME} back`),
      }),
    );
    const kept = ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Text",
        Rect: [440, 40, 460, 60],
        Contents: PDFString.of("Kept comment"),
      }),
    );
    doc.getPage(0).node.set(PDFName.of("Annots"), ctx.obj([note, kept]));
    extra?.(doc);
    return doc.save();
  }

  function catalogXmp(doc: PDFDocument): string {
    const xmp = doc.catalog.lookup(PDFName.of("Metadata"));
    if (!(xmp instanceof PDFRawStream))
      throw new Error("no catalog XMP stream");
    return new TextDecoder().decode(decodePDFRawStream(xmp).decode());
  }

  function bookmarkTitles(doc: PDFDocument): string[] {
    const outlines = doc.catalog.lookup(PDFName.of("Outlines"), PDFDict);
    const titles: string[] = [];
    for (
      let item = outlines.lookup(PDFName.of("First"));
      item instanceof PDFDict;
      item = item.lookup(PDFName.of("Next"))
    ) {
      titles.push(text(item.lookup(PDFName.of("Title"))));
    }
    return titles;
  }

  function text(o: unknown): string {
    return o instanceof PDFString || o instanceof PDFHexString
      ? o.decodeText()
      : "";
  }

  async function removeName(
    bytes: Uint8Array,
    query = NAME,
    options = { matchCase: true, wholeWord: false },
  ) {
    const index = await readRedactText(bytes, legacy);
    const { matches } = findTextMatches(index, query, options);
    expect(matches.length).toBe(1);
    return redactPdfByRemoval(
      bytes,
      {
        rects: matches.flatMap((f) =>
          f.rects.map((r) => ({ ...r, fromText: true })),
        ),
        verify: matches,
        loadReader: legacy,
      },
      { decodeJpeg: null },
    );
  }

  it("takes it out of the properties, XMP, bookmark titles and comments, and keeps the rest", async () => {
    const source = await withHiddenCopies();
    const result = await removeName(source);
    const out = await PDFDocument.load(result.bytes, { updateMetadata: false });
    // The page text check still holds.
    expect((await textOf(result.bytes))[0]).not.toContain(NAME);
    expect(out.getTitle() ?? "").not.toContain(NAME);
    expect(out.getAuthor() ?? "").not.toContain(NAME);
    expect(out.getSubject()).toBe("Kept subject");
    // Unconditional (it was behind `if (xmp instanceof PDFRawStream)`, so a
    // packet deleted outright passed): the packet is there, keeps the rest
    // of its content, and no longer holds the name.
    const packet = catalogXmp(out);
    expect(packet).toContain("<dc:format>application/pdf</dc:format>");
    expect(packet).toContain(SCRUBBED_TEXT);
    expect(packet).not.toContain(NAME);
    const outlines = out.catalog.lookup(PDFName.of("Outlines"), PDFDict);
    const titles: string[] = [];
    for (
      let item = outlines.lookup(PDFName.of("First"));
      item instanceof PDFDict;
      item = item.lookup(PDFName.of("Next"))
    ) {
      titles.push(text(item.lookup(PDFName.of("Title"))));
    }
    expect(titles.length).toBe(2);
    expect(titles.join("|")).not.toContain(NAME);
    expect(titles).toContain("Kept bookmark");
    const annots = out.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const comments = annots
      .asArray()
      .map((a) =>
        text(out.context.lookup(a, PDFDict).lookup(PDFName.of("Contents"))),
      );
    expect(comments.join("|")).not.toContain(NAME);
    expect(comments).toContain("Kept comment");
    // Positive control: every one of those held the name in the input.
    const src = await PDFDocument.load(source, { updateMetadata: false });
    expect(src.getAuthor()).toBe(NAME);
    expect(src.getTitle()).toContain(NAME);
  });

  it("refuses when the name is still somewhere it cannot take it out (a form field's value)", async () => {
    const source = await withHiddenCopies((doc) => {
      const form = doc.getForm();
      const field = form.createTextField("guardian");
      field.setText(`Guardian ${NAME}`);
      field.addToPage(doc.getPage(1), {
        x: 56,
        y: 100,
        width: 200,
        height: 20,
      });
    });
    await expect(removeName(source)).rejects.toThrow(
      /still in the file outside the page text \(in a form field\)/,
    );
  });

  /**
   * Review of the #3 fix: the off-page scrub and check matched case-SENSITIVE
   * substrings of the page slice, whatever options Find ran with. Find opens
   * case-insensitive, so a Title in capitals kept the name while the result
   * said it was checked; and a whole-word "Jane" rewrote "Janeway".
   */
  it("matches off the page the way Find matched on it: case-insensitive", async () => {
    const source = await withHiddenCopies((doc) => {
      doc.setTitle("Report on JANE Q. EXAMPLE");
      doc.setAuthor("jane q. example");
    });
    const result = await removeName(source, "jane q. example", {
      matchCase: false,
      wholeWord: false,
    });
    const out = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(out.getTitle()).toBe(`Report on ${SCRUBBED_TEXT}`);
    expect(out.getAuthor()).toBe(SCRUBBED_TEXT);
    // Positive control: the input held both, in other cases than the page.
    const src = await PDFDocument.load(source, { updateMetadata: false });
    expect(src.getTitle()).toBe("Report on JANE Q. EXAMPLE");
    expect(src.getAuthor()).toBe("jane q. example");
  });

  it("matches off the page the way Find matched on it: whole words only", async () => {
    const source = await withHiddenCopies((doc) => {
      doc.setTitle("Janeway notes");
      const outlines = doc.catalog.lookup(PDFName.of("Outlines"), PDFDict);
      outlines
        .lookup(PDFName.of("First"), PDFDict)
        .set(PDFName.of("Title"), PDFHexString.fromText("Janeway chapter"));
      const field = doc.getForm().createTextField("ship");
      field.setText("Janeway");
      field.addToPage(doc.getPage(1), {
        x: 56,
        y: 100,
        width: 200,
        height: 20,
      });
    });
    // Whole word: the page has "Jane" once as a word ("jane.example" is
    // lower case), and the off-page strings have it only inside "Janeway".
    const result = await removeName(source, "Jane", {
      matchCase: true,
      wholeWord: true,
    });
    const out = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(out.getTitle()).toBe("Janeway notes");
    expect(bookmarkTitles(out)).toEqual(["Janeway chapter", "Kept bookmark"]);
    expect(out.getForm().getTextField("ship").getText()).toBe("Janeway");
    // The whole word "Jane" off the page still goes.
    expect(out.getAuthor()).toBe(`${SCRUBBED_TEXT} Q. Example`);
  });

  it("Detect items match off the page as whole words, in any case", async () => {
    const EMAIL = "jane.example@mail.test";
    const source = await withHiddenCopies((doc) => {
      doc.setSubject("Write to JANE.EXAMPLE@MAIL.TEST");
      doc.setKeywords(["jane.example@mail.testing"]);
    });
    const index = await readRedactText(source, legacy);
    const emails = detectPersonalData(index, ["email"]).matches;
    expect(emails.map((e) => e.text)).toEqual([EMAIL, EMAIL]);
    const result = await redactPdfByRemoval(
      source,
      {
        rects: emails.flatMap((f) =>
          f.rects.map((r) => ({ ...r, fromText: true })),
        ),
        verify: emails,
        loadReader: legacy,
      },
      { decodeJpeg: null },
    );
    const out = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(out.getSubject()).toBe(`Write to ${SCRUBBED_TEXT}`);
    expect(out.getKeywords()).toBe("jane.example@mail.testing");
  });

  it("finds the name in XMP where it is written XML-escaped", async () => {
    const FIRM = "O'Neil & Sons";
    const source = await withHiddenCopies((doc) => {
      doc.getPage(1).drawText(`Agent: ${FIRM}`, {
        x: 56,
        y: 600,
        size: 12,
        font: doc.embedStandardFont(StandardFonts.Helvetica),
      });
      const ctx = doc.context;
      doc.catalog.set(
        PDFName.of("Metadata"),
        ctx.register(
          ctx.stream(
            `<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:publisher>O&apos;Neil &amp; Sons</dc:publisher><dc:rights>O&#39;Neil &#x26; Sons</dc:rights><dc:format>application/pdf</dc:format></x:xmpmeta>`,
            { Type: "Metadata", Subtype: "XML" },
          ),
        ),
      );
    });
    const result = await removeName(source, FIRM, {
      matchCase: false,
      wholeWord: false,
    });
    const out = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const packet = catalogXmp(out);
    expect(packet).not.toMatch(/Neil/);
    expect(packet).toContain(
      `<dc:publisher>${SCRUBBED_TEXT}</dc:publisher><dc:rights>${SCRUBBED_TEXT}</dc:rights><dc:format>application/pdf</dc:format>`,
    );
    // Positive control: the input packet held both escaped forms.
    const src = await PDFDocument.load(source, { updateMetadata: false });
    expect(catalogXmp(src)).toContain("O&apos;Neil &amp; Sons");
    expect(catalogXmp(src)).toContain("O&#39;Neil &#x26; Sons");
  });

  it("refuses when the name is in a page's own XMP packet", async () => {
    const source = await withHiddenCopies((doc) => {
      const ctx = doc.context;
      doc
        .getPage(1)
        .node.set(
          PDFName.of("Metadata"),
          ctx.register(
            ctx.stream(
              `<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>${NAME}</dc:creator></x:xmpmeta>`,
              { Type: "Metadata", Subtype: "XML" },
            ),
          ),
        );
    });
    await expect(removeName(source)).rejects.toThrow(
      /still in the file outside the page text \(in the document's XMP metadata\)/,
    );
  });
});

/**
 * Audit #13 (2026-11-06): Find and Detect read only the page content, so a
 * name in a filled form field or a comment got "No matches" with no word that
 * those were never searched; and Detect stopped at MAX_FOUND with no sign of
 * it, so a long document read as "500 items found" and nothing more.
 */
describe("what Find and Detect cannot see is said, not silent", () => {
  it("names the pages with filled form fields and with comments", async () => {
    const doc = await PDFDocument.load(await fixture());
    const form = doc.getForm();
    const field = form.createTextField("guardian");
    field.setText("Guardian John Roe");
    field.addToPage(doc.getPage(1), { x: 56, y: 100, width: 200, height: 20 });
    const empty = form.createTextField("blank");
    empty.addToPage(doc.getPage(0), { x: 56, y: 60, width: 200, height: 20 });
    const ctx = doc.context;
    doc.getPage(0).node.set(
      PDFName.of("Annots"),
      ctx.obj([
        ...(doc
          .getPage(0)
          .node.lookup(PDFName.of("Annots"), PDFArray)
          ?.asArray() ?? []),
        ctx.register(
          ctx.obj({
            Type: "Annot",
            Subtype: "Text",
            Rect: [400, 40, 420, 60],
            Contents: PDFString.of("Call John Roe back"),
          }),
        ),
      ]),
    );
    const index = await readRedactText(await doc.save(), legacy);
    // Positive control: the name really is not in what Find searches.
    expect(
      findTextMatches(index, "John Roe", { matchCase: false, wholeWord: false })
        .matches,
    ).toEqual([]);
    expect(index.notSearched).toEqual({ formFields: [2], comments: [1] });
    // And a plain page reports nothing.
    expect((await readRedactText(await fixture(), legacy)).notSearched).toEqual(
      { formFields: [], comments: [] },
    );
  });

  it("Detect says when it stopped at the cap", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const perPage = 10;
    const pages = Math.ceil((MAX_FOUND + 100) / perPage);
    for (let p = 0; p < pages; p++) {
      const page = doc.addPage([595, 842]);
      for (let i = 0; i < perPage; i++) {
        page.drawText(`person${p}x${i}@mail.test`, {
          x: 56,
          y: 780 - i * 24,
          size: 12,
          font,
        });
      }
    }
    const index = await readRedactText(await doc.save(), legacy);
    const all = detectPersonalData(index, ["email"]);
    expect(all.matches.length).toBe(MAX_FOUND);
    expect(all.capped).toBe(true);
    const few = detectPersonalData(
      await readRedactText(await fixture(), legacy),
      ["email"],
    );
    expect(few.capped).toBe(false);
    expect(few.matches.length).toBe(2);
  });
});
