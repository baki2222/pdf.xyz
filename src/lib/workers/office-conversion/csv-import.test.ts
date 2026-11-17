// @vitest-environment node
/**
 * The CSV import choices' parser, and the copy that names them.
 */
import { describe, expect, it } from "vitest";
import { guides } from "@/lib/guides";
import { getToolBySlug } from "@/lib/tools";
import {
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "@/lib/tools/page-copy";
import {
  CSV_CHARSETS,
  CSV_CHARSET_LABEL,
  CSV_CHARSET_OPTION,
  CSV_DELIMITERS,
  CSV_DELIMITER_LABEL,
  CSV_DELIMITER_OPTION,
  acceptsCsvImport,
  carriesCsvImportOptions,
  choosesCsvImport,
  parseCsvImportChoice,
} from "./csv-import";
import { officeJobOptions } from "../office-conversion-client";

describe("parseCsvImportChoice: strict, never coerced", () => {
  it("absent, or auto, is Auto", () => {
    expect(parseCsvImportChoice({})).toEqual({
      ok: true,
      value: { delimiter: null, charset: null },
    });
    expect(
      parseCsvImportChoice({
        [CSV_DELIMITER_OPTION]: "auto",
        [CSV_CHARSET_OPTION]: "auto",
      }),
    ).toEqual({ ok: true, value: { delimiter: null, charset: null } });
  });

  it("every listed value is read as itself", () => {
    for (const d of CSV_DELIMITERS.filter((x) => x.value))
      expect(parseCsvImportChoice({ [CSV_DELIMITER_OPTION]: d.value })).toEqual(
        { ok: true, value: { delimiter: d.value, charset: null } },
      );
    for (const c of CSV_CHARSETS.filter((x) => x.value))
      expect(parseCsvImportChoice({ [CSV_CHARSET_OPTION]: c.value })).toEqual({
        ok: true,
        value: { delimiter: null, charset: c.value },
      });
  });

  it("an unknown value, another case, or another type is refused with its field named", () => {
    for (const bad of [
      "colon",
      "Semicolon",
      ";",
      "",
      59,
      true,
      null,
      ["comma"],
    ]) {
      const r = parseCsvImportChoice({ [CSV_DELIMITER_OPTION]: bad });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) {
        expect(r.field).toBe(`options.${CSV_DELIMITER_OPTION}`);
        expect(r.message).toContain('"semicolon"');
      }
    }
    for (const bad of ["koi8-r", "UTF-8", "utf8", 76]) {
      const r = parseCsvImportChoice({ [CSV_CHARSET_OPTION]: bad });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) {
        expect(r.field).toBe(`options.${CSV_CHARSET_OPTION}`);
        expect(r.message).toContain('"windows-1251"');
      }
    }
  });

  it("the predicates the panel, client and route use", () => {
    expect(acceptsCsvImport("Rows.CSV")).toBe(true);
    expect(acceptsCsvImport("rows.csv.xlsx")).toBe(false);
    expect(acceptsCsvImport("csv")).toBe(false);
    expect(choosesCsvImport({ delimiter: null, charset: null })).toBe(false);
    expect(choosesCsvImport({ delimiter: "tab", charset: null })).toBe(true);
    expect(choosesCsvImport(undefined)).toBe(false);
    expect(carriesCsvImportOptions({})).toBe(false);
    expect(carriesCsvImportOptions(undefined)).toBe(false);
    expect(carriesCsvImportOptions({ [CSV_CHARSET_OPTION]: "auto" })).toBe(
      true,
    );
  });
});

/**
 * The copy names the choices the panel offers, in both directions (house
 * rule 1): every delimiter and character set the reader can pick is named
 * where the page and the guide explain the settings, and every name of that
 * shape the copy uses is one the panel offers. The guide spells its lists
 * out, so this is what holds them to the selects.
 */
describe("the copy names exactly the choices the selects offer", () => {
  const guide = guides.find((g) => g.slug === "how-to-convert-excel-to-pdf");
  const tool = getToolBySlug("excel-to-pdf");
  const guideText = guide
    ? [
        ...guide.sections.flatMap((s) => s.body),
        ...guide.faq.map((f) => f.answer),
      ].join("\n")
    : "";
  // Through the accessors the page renders.
  const pageText = tool
    ? [
        ...pageIntro(tool),
        ...pageSteps(tool).map(stepText),
        ...pageUseCases(tool).map((u) => u.body),
        ...pageFaq(tool).map((f) => f.answer),
      ].join("\n")
    : "";
  /** A character set's short name: its label up to any bracket. */
  const short = (label: string) => label.replace(/\s*\(.*\)$/, "");
  const CHARSET_SHAPE = /\b(?:UTF-\d+|Windows-\d+|ISO-\d+-\d+|Shift-JIS)\b/g;

  it("health: both texts exist and talk about the settings", () => {
    expect(guide).toBeDefined();
    expect(guideText).toContain(CSV_DELIMITER_LABEL);
    expect(guideText).toContain(CSV_CHARSET_LABEL);
    expect(pageText).toContain(CSV_DELIMITER_LABEL);
    expect(pageText).toContain(CSV_CHARSET_LABEL);
  });

  it("every delimiter choice is named in each", () => {
    for (const d of CSV_DELIMITERS.filter((x) => x.value)) {
      expect(guideText, `guide: ${d.label}`).toContain(d.label);
      expect(pageText, `page: ${d.label}`).toContain(d.label);
    }
  });

  it("every character set the copy names is one the select offers", () => {
    const offered = new Set(CSV_CHARSETS.map((c) => short(c.label)));
    for (const [where, text] of [
      ["guide", guideText],
      ["page", pageText],
    ] as const) {
      const named = [...text.matchAll(CHARSET_SHAPE)].map((m) => m[0]);
      // Health: the shape finds names, or the check below is vacuous.
      expect(named.length, where).toBeGreaterThanOrEqual(3);
      for (const name of named)
        expect(offered.has(name), `${where} names ${name}`).toBe(true);
    }
  });

  it("every character set the select offers is named on the page", () => {
    for (const c of CSV_CHARSETS.filter((x) => x.value))
      expect(pageText, c.label).toContain(c.label);
  });

  it("positive control: a name the select does not offer is caught", () => {
    const offered = new Set(CSV_CHARSETS.map((c) => short(c.label)));
    const planted = "choose Windows-1250 or KOI8-R";
    const named = [...planted.matchAll(CHARSET_SHAPE)].map((m) => m[0]);
    expect(named).toEqual(["Windows-1250"]);
    expect(named.some((n) => !offered.has(n))).toBe(true);
  });
});

describe("officeJobOptions: what the page sends", () => {
  const base = {
    tool: "excel-to-pdf" as const,
    filename: "rows.csv",
    bytes: new Uint8Array(),
  };

  it("a .csv's non-Auto choices, under their keys", () => {
    expect(
      officeJobOptions({
        ...base,
        csv: { delimiter: "semicolon", charset: "windows-1251" },
      }),
    ).toEqual({
      [CSV_DELIMITER_OPTION]: "semicolon",
      [CSV_CHARSET_OPTION]: "windows-1251",
    });
    expect(
      officeJobOptions({
        ...base,
        csv: { delimiter: null, charset: "utf-16" },
        layout: {
          onePagePerSheet: true,
          orientation: null,
          fitColumnsToWidth: false,
        },
      }),
    ).toEqual({ onePagePerSheet: true, [CSV_CHARSET_OPTION]: "utf-16" });
  });

  it("Auto, another file, or another tool sends no CSV key (an older worker is never sent one)", () => {
    expect(
      officeJobOptions({ ...base, csv: { delimiter: null, charset: null } }),
    ).toEqual({});
    expect(
      officeJobOptions({
        ...base,
        filename: "book.xlsx",
        csv: { delimiter: "tab", charset: "utf-8" },
      }),
    ).toEqual({});
    expect(
      officeJobOptions({
        ...base,
        tool: "word-to-pdf",
        csv: { delimiter: "tab", charset: "utf-8" },
      } as unknown as Parameters<typeof officeJobOptions>[0]),
    ).toEqual({});
  });
});

/**
 * The sentence these settings retired, and its synonyms, may not come back
 * (mutation control M15, 2026-11-17: restoring "There is no delimiter
 * option." to the page passed every other guard, because the hedge rule
 * reads deferrals and a bare present-tense denial is not one). A ban list
 * with its corpus in both directions (house rule 1): every denial below is
 * caught by some pattern, and every pattern catches some denial.
 */
describe("no sentence denies the CSV settings", () => {
  const DENIALS: readonly RegExp[] = [
    /\bno (?:csv )?(?:delimiter|separator|character[- ]set|encoding) (?:option|setting|choice|picker)s?\b/i,
    /\b(?:cannot|can't|can ?not) (?:choose|pick|set|change) (?:the |a |its )?(?:csv )?(?:delimiter|separator|character set|encoding)\b/i,
    /\b(?:delimiter|separator|character set|encoding) (?:is|are) (?:always|fixed|assumed)\b/i,
  ];
  const CORPUS: readonly string[] = [
    // Shipped on the Excel to PDF page until 2026-11-17 (its CSV use case).
    "There is no delimiter option, so check the columns split as expected.",
    // The synonyms the same claim would be written in.
    "There is no separator setting.",
    "You cannot choose the delimiter.",
    "The delimiter is always a comma.",
  ];

  it("the corpus and the patterns cover each other", () => {
    for (const sentence of CORPUS)
      expect(
        DENIALS.some((re) => re.test(sentence)),
        sentence,
      ).toBe(true);
    for (const re of DENIALS)
      expect(
        CORPUS.some((sentence) => re.test(sentence)),
        String(re),
      ).toBe(true);
  });

  it("nothing on the page or in the guide matches", () => {
    const tool = getToolBySlug("excel-to-pdf")!;
    const guide = guides.find((g) => g.slug === "how-to-convert-excel-to-pdf")!;
    const texts = [
      ...pageIntro(tool),
      ...pageSteps(tool).map(stepText),
      ...pageUseCases(tool).map((u) => u.body),
      ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
      ...guide.intro,
      ...guide.steps,
      ...guide.sections.flatMap((s) => s.body),
      ...guide.faq.flatMap((f) => [f.question, f.answer]),
    ];
    // Health: the corpus read is the page and the guide, not nothing.
    expect(texts.length).toBeGreaterThanOrEqual(20);
    const offenders = texts.filter((t) => DENIALS.some((re) => re.test(t)));
    expect(offenders).toEqual([]);
  });
});
