import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  addHeaderFooter,
  hasHeaderFooterContent,
  headerFooterOutputName,
  resolveStampDate,
  stampDateCandidates,
  validateHeaderFooter,
} from "./header-footer";
import { canDrawInOneFace } from "./unicode-font";
import { allWinAnsi } from "./winansi";
import { readAsViewer } from "@/tests/pdfjs-viewer";

async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return doc.save();
}

describe("header-footer", () => {
  it("detects whether any slot carries text", () => {
    expect(hasHeaderFooterContent({})).toBe(false);
    expect(hasHeaderFooterContent({ header: { center: "   " } })).toBe(false);
    expect(hasHeaderFooterContent({ footer: { right: "Page {n}" } })).toBe(
      true,
    );
  });

  it("rejects an empty configuration", () => {
    expect(() => validateHeaderFooter({})).toThrow(PdfEngineError);
    expect(() => validateHeaderFooter({ header: { left: "" } })).toThrow(
      /header or footer/i,
    );
  });

  it("stamps header and footer while preserving the page count", async () => {
    const input = await blankPdf(3);
    const output = await addHeaderFooter(input, {
      header: { center: "Acme Report" },
      footer: { left: "Confidential", right: "Page {n} of {total}" },
      date: "2026-07-12",
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(3);
    expect(output.byteLength).toBeGreaterThan(input.byteLength);
  });

  it("stamps our creator metadata", async () => {
    const output = await addHeaderFooter(await blankPdf(1), {
      footer: { center: "Printed {date}" },
      date: "2026-07-12",
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getCreator()).toBe("pdf.xyz");
  });

  it("tolerates a slot that resolves to empty after token substitution", async () => {
    // {date} with no date supplied resolves to "" — that slot is simply skipped.
    const output = await addHeaderFooter(await blankPdf(1), {
      header: { center: "Report" },
      footer: { center: "{date}" },
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(1);
  });

  it("names the download from the source", () => {
    expect(headerFooterOutputName("brief.pdf")).toBe("brief-header-footer.pdf");
  });
});

/**
 * `{date}` must draw in every locale a browser can run in.
 *
 * The defect (audit 2026-09): the runner filled `{date}` with
 * `new Date().toLocaleDateString()`. In `ar-EG` that is "٢٧/٩/٢٠٢٦" —
 * Arabic-Indic digits and U+200F marks — and in `fa-IR` "۱۴۰۵/۷/۵". No face we
 * ship draws either, so a user who typed "Printed {date}" in English saw a good
 * preview, clicked Run, and was refused for Arabic text they never typed.
 *
 * Why nothing caught it: every test passed an ASCII `date` straight in, so the
 * only value ever exercised was one the tests had typed.
 *
 * THE CORPUS is the runtime's own locale list, not a typed one: every two-letter
 * language ICU supports, its likely-subtags form (`ar` → `ar-Arab-EG`), and
 * its language-region form (`ar-EG`), which is the shape a browser reports —
 * and not the same locale to ICU: `ar` and `ar-Arab-EG` write Latin digits,
 * `ar-EG` writes Arabic-Indic ones. The first version of this corpus had only
 * the first two and so did not contain the defect it was written for. The
 * reader is `addHeaderFooter` itself, and for the locales that used to fail,
 * pdf.js reading the output.
 */
const NOW = new Date(2026, 8, 27, 12, 0, 0);
const TEMPLATE = "Printed {date}";

function icuLocales(): string[] {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const codes: string[] = [];
  for (const a of letters) for (const b of letters) codes.push(a + b);
  const supported = Intl.DateTimeFormat.supportedLocalesOf(codes);
  const out = new Set<string>();
  for (const code of supported) {
    out.add(code);
    try {
      const full = new Intl.Locale(code).maximize();
      out.add(full.toString());
      if (full.region) out.add(`${full.language}-${full.region}`);
    } catch {
      // A code ICU formats but cannot maximize: the bare form is still tested.
    }
  }
  return [...out].sort();
}

/** The value the runner used to stamp: the locale's own date, verbatim. */
const beforeFix = (locale: string) => NOW.toLocaleDateString(locale);

/** Does the real tool draw this date, or refuse it? Memoised per string. */
const verdicts = new Map<string, Promise<boolean>>();
function toolDraws(date: string): Promise<boolean> {
  let verdict = verdicts.get(date);
  if (!verdict) {
    verdict = blankPdf(1)
      .then((input) =>
        addHeaderFooter(input, { footer: { center: TEMPLATE }, date }),
      )
      .then(
        () => true,
        (error: unknown) => {
          if (error instanceof PdfEngineError) return false;
          throw error;
        },
      );
    verdicts.set(date, verdict);
  }
  return verdict;
}

describe("header-footer {date} draws in every locale", () => {
  const locales = icuLocales();

  it("HEALTH CHECK: the corpus is ICU's locale list, and it contains the locales that failed", async () => {
    expect(
      locales.length,
      "ICU reported implausibly few locales — the corpus collapsed",
    ).toBeGreaterThan(100);
    // Positive control: the corpus must contain dates the old code could not
    // draw, or every assertion below passes over nothing.
    const refusedBefore: string[] = [];
    for (const locale of locales) {
      if (!(await toolDraws(beforeFix(locale)))) refusedBefore.push(locale);
    }
    expect(refusedBefore).toEqual(expect.arrayContaining(["ar-EG", "fa-IR"]));
  });

  it("stamps a date for every locale ICU supports", async () => {
    const refused: string[] = [];
    for (const locale of locales) {
      const date = await resolveStampDate([TEMPLATE], NOW, locale);
      if (!(await toolDraws(date))) refused.push(`${locale}: ${date}`);
    }
    expect(refused).toEqual([]);
  });

  it("keeps the reader's own format whenever the tool can draw it", async () => {
    // No regression for the scripts we DO draw: a Bengali reader keeps Bengali
    // digits, a Thai reader keeps the Buddhist year.
    const changed: string[] = [];
    for (const locale of locales) {
      const [own] = stampDateCandidates(NOW, locale);
      if (own === undefined || !(await toolDraws(own))) continue;
      const chosen = await resolveStampDate([TEMPLATE], NOW, locale);
      if (chosen !== own) changed.push(`${locale}: ${own} → ${chosen}`);
    }
    expect(changed).toEqual([]);
    expect(await resolveStampDate([TEMPLATE], NOW, "bn-BD")).toBe("২৭/৯/২০২৬");
  });

  it("writes the SAME day, legibly, where the old value was refused", async () => {
    for (const locale of ["ar-EG", "ar-SA", "fa-IR", "ur-IN"]) {
      expect(await toolDraws(beforeFix(locale)), locale).toBe(false);
      const date = await resolveStampDate([TEMPLATE], NOW, locale);
      // Gregorian, Latin digits — fa-IR must not become "1405/7/5".
      const parts = (date.match(/[0-9]+/g) ?? [])
        .map(Number)
        .sort((a, b) => a - b);
      expect(parts, `${locale}: ${date}`).toEqual([9, 27, 2026]);
      const input = await blankPdf(1);
      const output = await addHeaderFooter(input, {
        footer: { center: TEMPLATE },
        date,
      });
      const [page] = await readAsViewer(output);
      expect(page!.runs.map((r) => r.str).join(" "), locale).toContain(
        `Printed ${date}`,
      );
    }
  });

  it("strips the invisible bidi marks, so a Latin-digit date keeps the built-in face", () => {
    const FORMAT_CONTROL = /\p{Cf}/u;
    // Positive control: the corpus contains a raw date carrying such a mark
    // (`ar` wraps its Latin-digit separators in U+200F).
    const marked = locales.filter((l) => FORMAT_CONTROL.test(beforeFix(l)));
    expect(marked).toContain("ar");
    const leaked = locales.flatMap((l) =>
      stampDateCandidates(NOW, l)
        .filter((d) => FORMAT_CONTROL.test(d))
        .map((d) => `${l}: ${JSON.stringify(d)}`),
    );
    expect(leaked).toEqual([]);
    // What the stripping buys: an all-Latin date stays on WinAnsi, the free
    // built-in face, instead of a downloaded Unicode one.
    expect(allWinAnsi(stampDateCandidates(NOW, "ar"))).toBe(true);
  });

  it("chooses the date against the WHOLE run: one face must draw every slot", async () => {
    // A Japanese header and a Bengali date are each drawable, but not by one
    // face. The date gives way, not the header the user typed.
    const templates = ["機密文書", TEMPLATE];
    const date = await resolveStampDate(templates, NOW, "bn-BD");
    expect(date).not.toBe("২৭/৯/২০২৬");
    await expect(
      addHeaderFooter(await blankPdf(1), {
        header: { center: templates[0] },
        footer: { center: TEMPLATE },
        date,
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it("canDrawInOneFace agrees with the tool on every candidate it is asked about", async () => {
    // The predicate chooses; the embed is the authority. Held equal over the
    // whole candidate corpus, so the chooser cannot drift from the thing it
    // predicts. Both verdicts are exercised, or the equality is vacuous.
    const seen = { yes: 0, no: 0 };
    const disagreements: string[] = [];
    const dates = new Set<string>();
    for (const locale of locales) {
      for (const d of stampDateCandidates(NOW, locale)) dates.add(d);
      dates.add(beforeFix(locale));
    }
    for (const date of dates) {
      const predicted = await canDrawInOneFace([`Printed ${date}`]);
      const actual = await toolDraws(date);
      if (predicted) seen.yes += 1;
      else seen.no += 1;
      if (predicted !== actual) {
        disagreements.push(`${JSON.stringify(date)}: said ${predicted}`);
      }
    }
    expect(disagreements).toEqual([]);
    expect(seen.yes).toBeGreaterThan(0);
    expect(seen.no).toBeGreaterThan(0);
  });
});
