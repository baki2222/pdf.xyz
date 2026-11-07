// @native-canvas
import { PDFDocument, degrees } from "pdf-lib";
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
 * Audit #27 (2026-11-06): the text's width went straight to placeStamp with
 * no bound. A 151-character confidentiality notice, centred on A4 at 10 pt,
 * measured 682.8 pt on a 595.3 pt page: x = -43.8, so about 44 pt was cut off
 * each side (right-aligned, ~120 pt off the left), and the run reported
 * success. A long notice is the page's headline use case.
 */
describe("header-footer: text that does not fit the page", () => {
  const NOTICE =
    "CONFIDENTIAL - This document contains proprietary information of Acme Corporation Ltd and must not be copied, disclosed or distributed to third parties";
  async function a4(rotate = 0): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    if (rotate) page.setRotation(degrees(rotate));
    return doc.save();
  }

  it("health: the notice is the audited one, 151 characters", () => {
    expect(NOTICE).toHaveLength(151);
  });

  it("refuses it in every slot, saying how much of it fits", async () => {
    for (const slot of ["left", "center", "right"] as const) {
      const run = addHeaderFooter(await a4(), { header: { [slot]: NOTICE } });
      await expect(run, slot).rejects.toBeInstanceOf(PdfEngineError);
      await expect(
        addHeaderFooter(await a4(), { header: { [slot]: NOTICE } }),
      ).rejects.toThrow(
        new RegExp(
          `header's ${slot} text is too wide for page 1.*room for [0-9]+ of its 151 characters`,
        ),
      );
    }
    await expect(
      addHeaderFooter(await a4(), { footer: { center: NOTICE } }),
    ).rejects.toThrow(/footer's center/);
  });

  it("measures the page as a reader sees it: a quarter-turned A4 is wide enough", async () => {
    // Landscape on screen: 841.9 pt across, so the notice fits at 10 pt.
    const output = await addHeaderFooter(await a4(90), {
      header: { center: NOTICE },
    });
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1);
  });

  it("control: the count the refusal names is exact — that many characters fit, one more does not", async () => {
    let room = -1;
    try {
      await addHeaderFooter(await a4(), { header: { center: NOTICE } });
    } catch (err) {
      room = Number(/room for (\d+) of/.exec(String(err))?.[1]);
    }
    expect(room).toBeGreaterThan(50);
    expect(room).toBeLessThan(NOTICE.length);
    await expect(
      addHeaderFooter(await a4(), {
        header: { center: NOTICE.slice(0, room) },
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
    await expect(
      addHeaderFooter(await a4(), {
        header: { center: NOTICE.slice(0, room + 1) },
      }),
    ).rejects.toThrow(/too wide/);
    await expect(
      addHeaderFooter(await a4(), { header: { center: "Acme Report" } }),
    ).resolves.toBeInstanceOf(Uint8Array);
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

/**
 * Audit header-footer#2 (2026-11-06): every page got the text, {n} always
 * started at 1 and {total} was always the file's page count, so the most
 * common header request — leave the cover alone — had a FAQ answer of "Not
 * here". The pages a band goes on now come from Page Numbers' own
 * `numberingPlan`, so the two tools cannot disagree about what Start on page,
 * First number, a blank cover or skipped last pages mean.
 */
describe("header-footer: which pages, and what {n} and {total} count", () => {
  async function stamped(
    pages: number,
    options: Parameters<typeof addHeaderFooter>[1],
  ): Promise<string[]> {
    const out = await addHeaderFooter(await blankPdf(pages), options);
    return (await readAsViewer(out)).map((p) =>
      p.runs.map((r) => r.str).join(" "),
    );
  }

  it("health: with no page options every page is stamped, counting from 1", async () => {
    expect(
      await stamped(3, { footer: { center: "Page {n} of {total}" } }),
    ).toEqual(["Page 1 of 3", "Page 2 of 3", "Page 3 of 3"]);
  });

  it("a blank cover is counted but carries nothing", async () => {
    expect(
      await stamped(3, {
        footer: { center: "Page {n} of {total}" },
        skipCover: true,
      }),
    ).toEqual(["", "Page 2 of 3", "Page 3 of 3"]);
  });

  it("Start on page leaves earlier pages alone and counts from First number", async () => {
    expect(
      await stamped(4, {
        header: { center: "Acme" },
        footer: { center: "{n}/{total}" },
        startPage: 2,
        startAt: 1,
      }),
    ).toEqual(["", "Acme 1/3", "Acme 2/3", "Acme 3/3"]);
    expect(
      await stamped(2, { footer: { center: "{n}/{total}" }, startAt: 10 }),
    ).toEqual(["10/11", "11/11"]);
  });

  it("skipped last pages are neither stamped nor counted", async () => {
    expect(
      await stamped(4, { footer: { center: "{n}/{total}" }, skipLast: 2 }),
    ).toEqual(["1/2", "2/2", "", ""]);
  });

  it("refuses settings that leave no page to stamp", async () => {
    await expect(
      addHeaderFooter(await blankPdf(2), {
        footer: { center: "x" },
        startPage: 2,
        skipLast: 1,
      }),
    ).rejects.toThrow(/No page gets the header or footer/);
  });
});

/**
 * Audit header-footer#3 (2026-11-06): the runner filled one slot per band, so
 * "Acme Ltd" at the left with the date at the right could not be made. With
 * three slots in use, two of them can meet: each alone fits the page, and the
 * pair would be drawn over each other. That is refused, like a slot too wide
 * for the page, rather than shipped as an unreadable overprint.
 */
describe("header-footer: three slots in one band", () => {
  it("draws left, center and right in their places on the same line", async () => {
    const out = await addHeaderFooter(await blankPdf(1), {
      header: { left: "LEFTMARK", center: "MIDMARK", right: "RIGHTMARK" },
    });
    const [page] = await readAsViewer(out);
    const at = (s: string) => page!.runs.find((r) => r.str === s)!;
    expect(at("LEFTMARK").x).toBeLessThan(at("MIDMARK").x);
    expect(at("MIDMARK").x).toBeLessThan(at("RIGHTMARK").x);
    expect(at("LEFTMARK").y).toBeCloseTo(at("RIGHTMARK").y, 0);
  });

  it("refuses two slots that would overlap, naming both", async () => {
    const long = "Acme Corporation quarterly financial statement draft";
    await expect(
      addHeaderFooter(await blankPdf(1), {
        footer: { left: long, center: long },
      }),
    ).rejects.toThrow(/footer's left and center text overlap on page 1/);
  });

  it("control: the same two lines in different bands are fine", async () => {
    const long = "Acme Corporation quarterly financial statement draft";
    const out = await addHeaderFooter(await blankPdf(1), {
      header: { left: long },
      footer: { center: long },
    });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});
