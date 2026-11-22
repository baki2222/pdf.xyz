// @native-canvas
/**
 * Audit wave 2, webpage-to-pdf#5, at THE POINT OF CONSUMPTION: a real
 * Chromium through the production runner, and the text of the PDF it
 * returns, for a page with NO print stylesheet whose layout switches at the
 * common 768 px breakpoint.
 *
 * Webpage to PDF's panel starts on {@link HTML_START_VIEWPORT}.site, on
 * either paper it can start on (A4, Letter): that render must print the
 * desktop-only element and not the mobile-only one. The job API's own
 * default (`viewport: "auto"`, a request that names no width) is the
 * CONTROL: on the same paper it lays the page out at about 739 px and prints
 * the mobile layout, so the verdict is seen to fail on a render that did not
 * take the new start. The 1440 and 1920 px presets each print the element
 * only a screen that wide shows.
 *
 * An image built before these presets refuses them with a field error
 * (`parseHtmlRenderOptions` is strict, `oneOf`), never a silent other
 * layout: `src/lib/jobs/html-render-options.test.ts` holds that refusal
 * (`viewport: "1280"`, a value outside the list, is refused by field).
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
  HTML_VIEWPORTS,
  type HtmlRenderOptions,
} from "@/lib/jobs/html-render-options";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import { findChromium } from "./test-chromium";

const BIN = findChromium(resolveOnPath);

const DESKTOP = "Breakpoint fixture desktop layout";
const MOBILE = "Breakpoint fixture mobile layout";
const W1440 = "Breakpoint fixture 1440 wide";
const W1920 = "Breakpoint fixture 1920 wide";

/** No print CSS; one element per layout, switched by screen width. */
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
.d,.w14,.w19{display:none}
@media (min-width:768px){.d{display:block}.m{display:none}}
@media (min-width:1400px){.w14{display:block}}
@media (min-width:1900px){.w19{display:block}}
</style></head><body>
<h1 class="d">${DESKTOP}</h1><h1 class="m">${MOBILE}</h1>
<p class="w14">${W1440}</p><p class="w19">${W1920}</p>
<p>Body text that is in every layout.</p>
</body></html>`;

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await task.promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
  }
  await task.destroy();
  return text.replace(/\s+/g, " ");
}

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-start-layout-"));
afterAll(() => {
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 10 });
  } catch {
    /* the OS temp cleaner owns it now */
  }
});

async function render(options: Partial<HtmlRenderOptions>): Promise<string> {
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
    {
      fileExists: () => true,
      network: {
        resolve: async () => {
          throw new Error("NXDOMAIN");
        },
      },
    },
  );
  const pdf = await runner.renderHtml(new TextEncoder().encode(FIXTURE), {
    ...DEFAULT_HTML_RENDER_OPTIONS,
    ...options,
  });
  return pdfText(pdf);
}

describe("Webpage to PDF's start width (no Chromium needed)", () => {
  it("the site panel starts on Desktop; the file panel keeps Paper width", () => {
    expect(HTML_START_VIEWPORT.site).toBe("desktop");
    expect(HTML_START_VIEWPORT.file).toBe(DEFAULT_HTML_RENDER_OPTIONS.viewport);
  });

  it("offers 1440 and 1920 px screens", () => {
    const widths = HTML_VIEWPORTS.map((v) => v.width);
    expect(widths).toEqual(expect.arrayContaining([1440, 1920]));
  });
});

describe.skipIf(!BIN)(
  `real Chromium start layout (${BIN ?? "no Chromium found"})`,
  () => {
    for (const pageSize of ["A4", "Letter"] as const) {
      it(`${pageSize}: the panel's start prints the desktop layout; the API default (CONTROL) the mobile one`, async () => {
        const start = await render({
          pageSize,
          viewport: HTML_START_VIEWPORT.site,
        });
        expect(start).toContain(DESKTOP);
        expect(start).not.toContain(MOBILE);
        const control = await render({ pageSize });
        expect(control).toContain(MOBILE);
        expect(control).not.toContain(DESKTOP);
      }, 120_000);
    }

    it("the 1440 and 1920 px screens print what only a screen that wide shows", async () => {
      const at = (width: number) =>
        HTML_VIEWPORTS.find((v) => v.width === width)!.id;
      const w1440 = await render({ pageSize: "A4", viewport: at(1440) });
      expect(w1440).toContain(W1440);
      expect(w1440).not.toContain(W1920);
      const w1920 = await render({ pageSize: "A4", viewport: at(1920) });
      expect(w1920).toContain(W1920);
      // CONTROL: the 1280 px desktop shows neither.
      const desktop = await render({ pageSize: "A4", viewport: "desktop" });
      expect(desktop).not.toContain(W1440);
    }, 120_000);
  },
);
