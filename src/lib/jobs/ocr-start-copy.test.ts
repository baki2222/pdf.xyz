// @vitest-environment node
/**
 * What the copy says the OCR language picker starts on is what the picker
 * starts on.
 *
 * Review of audit search-demand#5 (2026-11-07): the new scanned-PDF-to-Word
 * guide said "English is selected when the page opens; deselect it if the
 * document has no English in it", and three older guide sentences and the
 * OCR PDF page said the same. Each quoted describeOcrLanguage(
 * DEFAULT_OCR_LANGUAGE), a real constant, so every label guard passed — but
 * the property is decided in `useOcrLanguageChoice`, which starts from
 * `chosen ?? fromBrowser ?? [DEFAULT_OCR_LANGUAGE]`. A reader whose browser is
 * set to French or Bengali opens the page with that language selected too,
 * and the guide told them about English alone, so the French chip it never
 * mentioned stayed on for a Bengali scan.
 *
 * Pinned as a RELATIONSHIP, both ways: the hook's start expression is read
 * from its source, and the copy must mention the browser exactly when the
 * hook consults it. The corpus is DISCOVERED — every guide and every tool
 * page's content, serialised whole — and every sentence that states the
 * default language's starting state is held to it. A floor on that set keeps
 * the check from passing over nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guides } from "@/lib/guides/catalog";
import { toolContent } from "@/lib/tools/content";
import { DEFAULT_OCR_LANGUAGE, describeOcrLanguage } from "./ocr";
import {
  OCR_LANGUAGE_BY_BCP47,
  ocrLanguagesFromBrowser,
} from "./ocr-browser-languages";
import { OCR_START_SENTENCE } from "./ocr-start-copy";

const PICKER = path.join(
  process.cwd(),
  "src",
  "components",
  "tools",
  "ocr-language-picker.tsx",
);

/** The expression `useOcrLanguageChoice` starts its selection from. */
function startExpression(source: string): string | null {
  const m = /(\bchosen\s*\?\?[^;\n]*\[\s*DEFAULT_OCR_LANGUAGE\s*\])/.exec(
    source,
  );
  return m?.[1] ?? null;
}

const DEFAULT_NAME = describeOcrLanguage(DEFAULT_OCR_LANGUAGE);

/** A sentence stating what the default language does when the page opens. */
const STATES_START = new RegExp(
  `\\b${DEFAULT_NAME}\\b[^.;]*\\b(?:is selected when the page opens|starts selected|is selected to start with|is preselected|is selected by default)`,
);

/** Sentences of a text, bounded by . ; ? ! as well as line breaks. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.;?!])\s+|\n+/).filter(Boolean);
}

/** The start-state sentences that leave the browser's languages out. */
function startClaimsWithoutBrowser(text: string): string[] {
  return sentences(text).filter(
    (s) => STATES_START.test(s) && !/\bbrowser\b/.test(s),
  );
}

/** Every string a reader can get from guides and tool pages. */
function corpus(): string {
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(guides);
  walk(toolContent);
  return strings.join("\n");
}

describe("OCR picker start-state copy", () => {
  const source = readFileSync(PICKER, "utf8");
  const start = startExpression(source);
  const hookUsesBrowser = start !== null && /\bfromBrowser\b/.test(start);
  const text = corpus();

  it("finds the hook's start expression (health check)", () => {
    expect(start).not.toBeNull();
  });

  it("the shared sentence mentions the browser exactly when the hook reads it", () => {
    expect(/\bbrowser\b/.test(OCR_START_SENTENCE)).toBe(hookUsesBrowser);
  });

  it("the default language is kept in every browser pick, so naming it as selected is true", () => {
    const tags = Object.keys(OCR_LANGUAGE_BY_BCP47);
    expect(tags.length).toBeGreaterThan(20);
    for (const tag of tags)
      expect(ocrLanguagesFromBrowser([tag])).toContain(DEFAULT_OCR_LANGUAGE);
    // …and a browser pick adds languages beside it — the reason the copy
    // must say so (positive control on the behaviour itself).
    expect(ocrLanguagesFromBrowser(["fr-FR"])).toContain("fra");
  });

  it("catches the sentences this review found (positive control)", () => {
    const old = [
      `Under Languages, select every language the pages are written in, up to 3. ${DEFAULT_NAME} is selected when the page opens; deselect it if the document has no ${DEFAULT_NAME} in it.`,
      `${DEFAULT_NAME} starts selected; deselect it if the page has none.`,
      `Under Languages, ${DEFAULT_NAME} is selected to start with.`,
    ].join(" ");
    expect(startClaimsWithoutBrowser(old)).toHaveLength(3);
    expect(startClaimsWithoutBrowser(OCR_START_SENTENCE)).toEqual([]);
  });

  it("states the start through the shared sentence often enough to matter (corpus floor)", () => {
    const claims = sentences(text).filter((s) => STATES_START.test(s));
    // 7 at writing: two each in the OCR-in-other-languages, scanned PDF to
    // Word and Bangla guides, one on OCR PDF's page. A shrinking set is a
    // vacuous pass.
    expect(claims.length).toBeGreaterThanOrEqual(7);
  });

  it("no guide or tool page states the start without the browser's languages", () => {
    if (!hookUsesBrowser) return;
    expect(startClaimsWithoutBrowser(text)).toEqual([]);
  });
});
