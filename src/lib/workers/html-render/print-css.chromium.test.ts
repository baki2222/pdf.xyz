// @native-canvas
/**
 * Review of audit wave 2 webpage-to-pdf#5 (2026-11-28), at THE POINT OF
 * CONSUMPTION: the font size of text in the PDF a real Chromium prints
 * through the production runner.
 *
 * Webpage to PDF starts on {@link HTML_START_VIEWPORT}.site (Desktop, 1280
 * px). The review measured a page whose print stylesheet sets `12pt` printing
 * at 6.72pt from that start, because a 1280 px layout is shrunk to the paper.
 * With "Use the site's print styles" ticked and print styles present —
 * inline, in a sheet from another origin, or in a `media="print"` link — the
 * text must come out at the 12pt the stylesheet asked for (`./print-css`).
 *
 * CONTROLS: the same start on a page with NO print styles still prints the
 * desktop layout, shrunk (its 16px text below 12pt, the desktop-only element
 * present); and with the box unticked the print-styled page prints its
 * screen styles at the Desktop width, shrunk too.
 *
 * NEGATIVES (verifier of lane w2r, 2026-11-28): the first version switched
 * to the paper width on ANY print rule, so a page whose print rules only hide
 * things (Bootstrap 5's `d-print-*` utilities, a theme's `nav{display:none}`)
 * printed its narrow layout at the screen's 16px — #5's defect back on the
 * default settings. Those pages must keep the desktop layout. The corpus
 * below pins the signal both ways: every shape it accepts and every shape it
 * refuses has a sentence, and every branch of `cssHasPrintRules` is reached.
 *
 * SKIPPED, visibly, where no Chromium exists (`findChromium`).
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_HTML_RENDER_OPTIONS,
  HTML_START_VIEWPORT,
} from "@/lib/jobs/html-render-options";
import {
  DEFAULT_WEBPAGE_CAPTURE_OPTIONS,
  type WebpageCaptureOptions,
} from "@/lib/jobs/webpage-capture-options";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import type { PinnedFetch, Resolve } from "./network";
import { cssHasPrintRules, inPageHasPrintRules } from "./print-css";
import { findChromium } from "./test-chromium";

const BIN = findChromium(resolveOnPath);
const WORD = "Printsizeword";
const DESKTOP = "Desktoponlyelement";

const page = (
  head: string,
) => `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-size:16px}.d{display:none}@media (min-width:1000px){.d{display:block}}</style>
${head}</head><body><p>${WORD}</p><p class="d">${DESKTOP}</p></body></html>`;

const PAGES: Record<string, string> = {
  "/inline": page(`<style>@media print { body { font-size: 12pt } }</style>`),
  "/style-media": page(`<style media="print">body { font-size: 12pt }</style>`),
  "/linked": page(
    `<link rel="stylesheet" href="https://cdn.other.example/site.css">`,
  ),
  "/media-link": page(
    `<link rel="stylesheet" media="print" href="https://cdn.other.example/paper.css">`,
  ),
  "/none": page(""),
  // Verifier of lane w2r (2026-11-28): print rules that only HIDE things
  // (Bootstrap 5's utilities, a theme's menu rule) are not a paper layout.
  "/bootstrap": page(
    `<link rel="stylesheet" href="https://cdn.other.example/bootstrap.css">`,
  ),
  "/navhide": page(`<style>@media print { nav { display: none } }</style>`),
};
const SHEETS: Record<string, string> = {
  "/site.css": "p{margin:0}\n@media print{body{font-size:12pt}}",
  "/paper.css": "body{font-size:12pt}",
  // The shape Bootstrap 5's dist CSS ships: display utilities only.
  "/bootstrap.css":
    "p{margin:0}@media print{.d-print-none{display:none!important}.d-print-block{display:block!important}}",
};

const resolve: Resolve = async () => [{ address: "93.184.215.14", family: 4 }];
const fetch: PinnedFetch = async (url) => {
  const css = url.hostname === "cdn.other.example";
  const body = css ? SHEETS[url.pathname] : PAGES[url.pathname];
  return {
    status: body === undefined ? 404 : 200,
    rawHeaders: [
      "Content-Type",
      css ? "text/css; charset=utf-8" : "text/html; charset=utf-8",
    ],
    body: new TextEncoder().encode(body ?? ""),
  };
};

/** The printed height (pt) of {@link WORD}, and whether the desktop element printed. */
async function measure(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await task.promise;
  let size: number | null = null;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    for (const item of (await p.getTextContent()).items) {
      if (!("str" in item)) continue;
      text += ` ${item.str}`;
      if (item.str.includes(WORD) && size === null)
        size = Math.hypot(item.transform[2]!, item.transform[3]!);
    }
  }
  await task.destroy();
  return { size, desktop: text.includes(DESKTOP) };
}

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-print-css-"));
afterAll(() => {
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 10 });
  } catch {
    /* the OS temp cleaner owns it now */
  }
});

/** Print styles that lay the page out for paper: each branch of the signal. */
const PAPER_LAYOUT: Record<string, string> = {
  "font-size": "@media print{body{font-size:12pt}}",
  "font shorthand": "@media print { body { font: 11pt/1.4 Georgia, serif } }",
  zoom: "@media print{html{zoom:0.8}}",
  "width undone": "@media print{.container{width:auto!important}}",
  "max-width in a length": "@media print{main{max-width:17cm}}",
  "min-width (Bootstrap 4)":
    "@media print{.d-print-none{display:none!important}body{min-width:992px!important}}",
  "a list of media": "@media screen,print{body{font-size:12pt}}",
  nested: "@media print{@media (min-width:1px){body{font-size:12pt}}}",
  "@page": "@page { size: A4; margin: 2cm }",
  "@import print": '@import url("p.css") print;',
  "the /site.css fixture": SHEETS["/site.css"]!,
};
/** Print rules that only hide or recolour things, or are not print at all. */
const NOT_PAPER_LAYOUT: Record<string, string> = {
  "Bootstrap 5 utilities": SHEETS["/bootstrap.css"]!,
  "a hidden menu": "@media print { nav { display: none } }",
  "a print reset (colours, images kept in the page)":
    "@media print{*,*::before{background:#fff!important;color:#000!important}img{max-width:100%!important}a[href]::after{content:attr(href)}}",
  "a class NAMED for a size": "@media print{.font-size-lg{display:none}}",
  "not print": "@media not print{body{font-size:12pt}}",
  "screen only": "@media screen and (min-width:1px){body{font-size:12pt}}",
  "a print rule inside a comment": "/* @media print{body{font-size:12pt}} */",
  "a size with no media": "body{font-size:12pt}",
  "no CSS": "",
};

describe("cssHasPrintRules (no Chromium needed)", () => {
  it("the corpus is non-trivial (health check)", () => {
    expect(Object.keys(PAPER_LAYOUT).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(NOT_PAPER_LAYOUT).length).toBeGreaterThanOrEqual(8);
  });
  for (const [name, css] of Object.entries(PAPER_LAYOUT))
    it(`lays out for paper: ${name}`, () => {
      expect(cssHasPrintRules(css)).toBe(true);
    });
  for (const [name, css] of Object.entries(NOT_PAPER_LAYOUT))
    it(`does not: ${name}`, () => {
      expect(cssHasPrintRules(css)).toBe(false);
    });

  it("the in-page answer: a print link is enough; style texts go through the same reading", () => {
    expect(inPageHasPrintRules(true)).toBe(true);
    expect(inPageHasPrintRules([PAPER_LAYOUT["font-size"]!])).toBe(true);
    expect(inPageHasPrintRules(["@media print{body{font-size:12pt}}"])).toBe(
      true,
    );
    expect(inPageHasPrintRules([NOT_PAPER_LAYOUT["a hidden menu"]!])).toBe(
      false,
    );
    expect(inPageHasPrintRules([])).toBe(false);
    expect(inPageHasPrintRules(false)).toBe(false);
    expect(inPageHasPrintRules(undefined)).toBe(false);
  });
});

describe.skipIf(!BIN)(
  `real Chromium: print styles keep their size on the Desktop start (${BIN ?? "no Chromium found"})`,
  () => {
    const runner = createNativeChromiumPdfRunner(
      {
        enabled: true,
        candidates: [BIN ?? "chromium"],
        overridden: true,
        timeoutMs: 60_000,
        maxInputBytes: 10 * 1024 * 1024,
        maxOutputBytes: 50 * 1024 * 1024,
        tmpDir: work,
      },
      { fileExists: () => true, network: { resolve, fetch } },
    );
    const render = async (
      pathname: string,
      capture: Partial<WebpageCaptureOptions> = {},
    ) =>
      measure(
        await runner.renderUrl(
          `https://public.example${pathname}`,
          {
            ...DEFAULT_HTML_RENDER_OPTIONS,
            pageSize: "A4",
            viewport: HTML_START_VIEWPORT.site,
          },
          {},
          { ...DEFAULT_WEBPAGE_CAPTURE_OPTIONS, ...capture },
        ),
      );

    it("the start this file is about is a screen width, not Paper width (health check)", () => {
      expect(HTML_START_VIEWPORT.site).not.toBe("auto");
      expect(DEFAULT_WEBPAGE_CAPTURE_OPTIONS.printStyles).toBe(true);
    });

    for (const pathname of [
      "/inline",
      "/style-media",
      "/linked",
      "/media-link",
    ])
      it(`print styles ${pathname.slice(1)}: the text prints at the stylesheet's 12pt`, async () => {
        const { size } = await render(pathname);
        expect(size).not.toBeNull();
        expect(size!).toBeCloseTo(12, 0);
      }, 90_000);

    it("CONTROL: no print styles: the desktop layout prints, shrunk to the paper", async () => {
      const { size, desktop } = await render("/none");
      expect(desktop).toBe(true);
      expect(size).not.toBeNull();
      expect(size!).toBeLessThan(10);
    }, 90_000);

    for (const pathname of ["/bootstrap", "/navhide"])
      it(`print rules that only hide things (${pathname.slice(1)}): the desktop layout prints, shrunk`, async () => {
        const { size, desktop } = await render(pathname);
        expect(desktop).toBe(true);
        expect(size).not.toBeNull();
        expect(size!).toBeLessThan(10);
      }, 90_000);

    it("CONTROL: print styles unticked: the screen styles print at the Desktop width", async () => {
      const { size, desktop } = await render("/inline", { printStyles: false });
      expect(desktop).toBe(true);
      expect(size!).toBeLessThan(10);
    }, 90_000);
  },
);
