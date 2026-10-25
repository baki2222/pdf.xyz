// @native-canvas
/**
 * THE POINT OF CONSUMPTION for the layout options: a real Chromium, through
 * the production runner, and the page boxes and text of the PDF it returns.
 * `print-params.test.ts` proves the arguments; only this proves Chromium
 * honours them (and that one long page's measured height really holds the
 * whole page). Each property has its control: the default render of the
 * same page is several Letter pages laid out narrow, so every verdict below
 * is seen to fail on a render that did not take the option.
 *
 * Runs wherever a Chromium exists (`findChromium`); SKIPPED, visibly, where
 * none does. In the worker image the same verdicts run through
 * `pnpm worker:options-proof`, and on a deployment through
 * `pnpm worker:prove-tools`.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_HTML_RENDER_OPTIONS,
  type HtmlRenderOptions,
} from "@/lib/jobs/html-render-options";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import { findChromium } from "./test-chromium";
import {
  LAYOUT_PROOF_ENDS,
  layoutProofHtml,
  onePageVerdict,
  pageSizeVerdict,
  pdfPageSizes,
  viewportVerdict,
} from "./layout-proof";

const BIN = findChromium(resolveOnPath);

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

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-layout-"));
afterAll(() => {
  try {
    rmSync(work, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch {
    /* the OS temp cleaner owns it now */
  }
});

function render(options: Partial<HtmlRenderOptions>) {
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
    // No network: the page is self-contained, and anything it asked for
    // would be refused by the policy before a fetch.
    {
      fileExists: () => true,
      network: {
        resolve: async () => {
          throw new Error("NXDOMAIN");
        },
      },
    },
  );
  return runner.renderHtml(layoutProofHtml(), {
    ...DEFAULT_HTML_RENDER_OPTIONS,
    ...options,
  });
}

describe.skipIf(!BIN)(
  `real Chromium layout options (${BIN ?? "no Chromium found"})`,
  () => {
    let defaultPdf: Uint8Array;

    it("CONTROL: the default render is several Letter pages, laid out narrow", async () => {
      defaultPdf = await render({});
      const pages = await pdfPageSizes(defaultPdf);
      expect(pages.length).toBeGreaterThan(1);
      expect((await pageSizeVerdict(defaultPdf, "Letter", "portrait")).ok).toBe(
        true,
      );
      // Each verdict below FAILS on it.
      expect((await pageSizeVerdict(defaultPdf, "A4", "landscape")).ok).toBe(
        false,
      );
      const text = await pdfText(defaultPdf);
      expect(
        (await onePageVerdict(defaultPdf, text, LAYOUT_PROOF_ENDS)).ok,
      ).toBe(false);
      expect(viewportVerdict(text, "narrow").ok).toBe(true);
      expect(viewportVerdict(text, "wide").ok).toBe(false);
    }, 90_000);

    it("A4 landscape prints every page A4 landscape", async () => {
      const pdf = await render({ pageSize: "A4", orientation: "landscape" });
      const verdict = await pageSizeVerdict(pdf, "A4", "landscape");
      expect(verdict, verdict.detail).toMatchObject({ ok: true });
    }, 90_000);

    it("A5, Legal and A3 portrait print at their own sizes", async () => {
      for (const size of ["A5", "Legal", "A3"] as const) {
        const pdf = await render({ pageSize: size, margin: "none" });
        const verdict = await pageSizeVerdict(pdf, size, "portrait");
        expect(verdict, `${size}: ${verdict.detail}`).toMatchObject({
          ok: true,
        });
      }
    }, 120_000);

    it("one long page is ONE page holding the content from first line to last", async () => {
      for (const options of [
        { onePage: true },
        { onePage: true, pageSize: "A4", viewport: "desktop" },
        { onePage: true, margin: "none", viewport: "phone" },
      ] as const) {
        const pdf = await render(options);
        const verdict = await onePageVerdict(
          pdf,
          await pdfText(pdf),
          LAYOUT_PROOF_ENDS,
        );
        expect(
          verdict,
          `${JSON.stringify(options)}: ${verdict.detail}`,
        ).toMatchObject({
          ok: true,
        });
      }
    }, 120_000);

    it("the desktop screen width lays the page out wide; phone and tablet narrow", async () => {
      const wide = await render({ pageSize: "A4", viewport: "desktop" });
      expect(viewportVerdict(await pdfText(wide), "wide")).toMatchObject({
        ok: true,
      });
      for (const viewport of ["phone", "tablet"] as const) {
        const pdf = await render({ pageSize: "A4", viewport });
        expect(
          viewportVerdict(await pdfText(pdf), "narrow"),
          viewport,
        ).toMatchObject({
          ok: true,
        });
      }
    }, 120_000);

    it("margins: none puts the text nearer the page edge than normal", async () => {
      const edge = async (pdf: Uint8Array) => {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const task = pdfjs.getDocument({ data: new Uint8Array(pdf) });
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const items = (await page.getTextContent()).items as {
          transform?: number[];
          str?: string;
        }[];
        const xs = items
          .filter((i) => i.str?.trim())
          .map((i) => i.transform![4]!);
        await task.destroy();
        return Math.min(...xs);
      };
      const none = await edge(await render({ pageSize: "A4", margin: "none" }));
      const small = await edge(
        await render({ pageSize: "A4", margin: "small" }),
      );
      const normal = await edge(
        await render({ pageSize: "A4", margin: "normal" }),
      );
      // 0, 0.2 and 0.4 inch: 0, 14.4 and 28.8 points from the left edge.
      expect(none).toBeLessThan(2);
      expect(Math.abs(small - 14.4)).toBeLessThan(2);
      expect(Math.abs(normal - 28.8)).toBeLessThan(2);
    }, 120_000);
  },
);
