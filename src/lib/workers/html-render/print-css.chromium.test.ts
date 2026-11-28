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
import { cssHasPrintRules } from "./print-css";
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
  "/linked": page(
    `<link rel="stylesheet" href="https://cdn.other.example/site.css">`,
  ),
  "/media-link": page(
    `<link rel="stylesheet" media="print" href="https://cdn.other.example/paper.css">`,
  ),
  "/none": page(""),
};
const SHEETS: Record<string, string> = {
  "/site.css": "p{margin:0}\n@media print{body{font-size:12pt}}",
  "/paper.css": "body{font-size:12pt}",
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

describe("cssHasPrintRules (no Chromium needed)", () => {
  it("sees each print shape the fixtures use, and not a screen-only sheet", () => {
    expect(cssHasPrintRules(SHEETS["/site.css"]!)).toBe(true);
    expect(cssHasPrintRules("@page { size: A4 }")).toBe(true);
    expect(cssHasPrintRules('@import url("p.css") print;')).toBe(true);
    expect(cssHasPrintRules("@media screen and (min-width:1px){a{b:c}}")).toBe(
      false,
    );
    expect(cssHasPrintRules("body{font-size:12pt}")).toBe(false);
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

    for (const pathname of ["/inline", "/linked", "/media-link"])
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

    it("CONTROL: print styles unticked: the screen styles print at the Desktop width", async () => {
      const { size, desktop } = await render("/inline", { printStyles: false });
      expect(desktop).toBe(true);
      expect(size!).toBeLessThan(10);
    }, 90_000);
  },
);
