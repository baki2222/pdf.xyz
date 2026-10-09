// @vitest-environment node
/**
 * The print-chrome detector reads the page URL in the shapes Chromium prints.
 *
 * Chromium's header/footer template truncates an overflowing URL with an
 * ellipsis, so a long URL appears as its prefix and "…". The detector once
 * matched only the whole URL; on CI's Linux Chromium the pre-fix positive
 * control (a long `file:///tmp/…` path) was then invisible as "the page URL",
 * while Windows printed the shorter path whole. These cases pin the shapes
 * without needing a browser; native.chromium.test.ts proves them on one.
 */
import { describe, expect, it } from "vitest";
import {
  ELIDED_PREFIX_MIN,
  containsElidedUrl,
  printChromeLeaks,
} from "./print-chrome";

const URL_LONG =
  "file:///tmp/pdfxyz-html-AbC123xyz/nested/deeper/still/input-document.html";
const WEB = "https://example.com/reports/2026/quarterly-results/summary.html";

describe("the page URL in the shapes Chromium prints it", () => {
  it("finds the whole URL", () => {
    expect(printChromeLeaks(`left ${WEB} 1/2`, { sourceUrl: WEB })).toContain(
      "the page URL",
    );
  });

  it("finds a URL truncated at the end with an ellipsis", () => {
    const shown = `${URL_LONG.slice(0, 40)}…`;
    expect(containsElidedUrl(`footer ${shown} 1/1`, URL_LONG)).toBe(true);
    expect(
      printChromeLeaks(`footer ${shown} 1/1`, { sourceUrl: URL_LONG }),
    ).toContain("the page URL");
  });

  it("finds one elided in the middle, and one with three dots", () => {
    const middle = `${URL_LONG.slice(0, 30)}…${URL_LONG.slice(-12)}`;
    expect(containsElidedUrl(middle, URL_LONG)).toBe(true);
    expect(containsElidedUrl(`${WEB.slice(0, 35)}...`, WEB)).toBe(true);
  });

  it("negative control: a prefix shorter than the minimum names no URL", () => {
    const tooShort = `${URL_LONG.slice(0, ELIDED_PREFIX_MIN - 1)}…`;
    expect(containsElidedUrl(tooShort, URL_LONG)).toBe(false);
    expect(containsElidedUrl("file://…", URL_LONG)).toBe(false);
  });

  it("finds a URL and file:// the extractor split at a ligature (the CI shape)", () => {
    // Verbatim shape from CI's Linux Chromium, 2026-10-08: "fi" was a
    // ligature and came out as "fi le".
    const url =
      "file:///tmp/pdfxyz-isolation-CkZTkW/pdfxyz-html-8piaAJ/chrome.html";
    const text = `Print chrome proof body 10/7/26, 10:03 PM Header-only title 2235 fi le:///tmp/pdfxyz-isolation-CkZTkW/pdfxyz-html-8piaAJ/chrome.html 1/1`;
    const leaks = printChromeLeaks(text, {
      title: "Header-only title",
      sourceUrl: url,
    });
    expect(leaks).toContain("the page URL");
    expect(leaks).toContain("a file:// URL (the worker's copy)");
    expect(leaks).toContain("the page <title>");
    expect(leaks).toContain("a print date");
  });

  it("negative control: clean output with the same words in prose reports nothing", () => {
    expect(
      printChromeLeaks("Invoice for the file you sent. Page body only.", {
        title: "Header-only title",
        sourceUrl: "https://example.com/a/b/c/report.html",
      }),
    ).toEqual([]);
  });

  it("negative control: an ellipsis after a different URL is not this one", () => {
    const other = "https://example.com/reports/2025/annual-review/x.html";
    expect(containsElidedUrl(`${other.slice(0, 40)}…`, WEB)).toBe(false);
    expect(containsElidedUrl("Loading… please wait", WEB)).toBe(false);
  });
});
