// @native-canvas
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import {
  PII_CATEGORIES,
  detectInText,
  detectPersonalData,
  findTextMatches,
  ibanValid,
  luhnValid,
  readRedactText,
  type PiiCategory,
} from "./redact-find";
import { redactPdfByRemoval } from "./redact-remove";
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
    const found = detectPersonalData(index, PII_CATEGORIES);
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
    const found = detectPersonalData(index, PII_CATEGORIES);
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
    const [card] = detectPersonalData(index, ["card"]);
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
    const found = detectPersonalData(index, ["email", "card"]);
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
