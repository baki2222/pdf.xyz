// @native-canvas
/**
 * The in-image options proof must be able to FAIL on each defect it exists
 * for. It runs for real only in the worker image (container.yml); here the
 * two binaries are played, correctly first, then wrongly one way at a time —
 * a proof that passes the wrong engines proves nothing in the image either.
 */
import { describe, expect, it } from "vitest";
import {
  PDF_PERMISSION_BITS,
  PDF_PERMISSION_KEYS,
  type PdfPermissions,
} from "@/lib/jobs/pdf-permissions";
import { colourImagePdf } from "@/lib/workers/compression/colour-image-pdf";
import type { NativeCompressor } from "./compression/engine";
import type { QpdfRunner } from "./pdf-security/engine";
import { readEncryptPermissions } from "./pdf-security/permission-bits";
import { runWorkerOptionsProof, type OptionsProofDeps } from "./options-proof";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  DEFAULT_HTML_RENDER_OPTIONS,
  htmlPrintGeometry,
  type HtmlRenderOptions,
} from "@/lib/jobs/html-render-options";
import type { ChromiumPdfRunner } from "./html-render/engine";
import {
  LAYOUT_NARROW_MARKER,
  LAYOUT_WIDE_MARKER,
} from "./html-render/layout-proof";

const enc = (s: string) => new TextEncoder().encode(s);

function pFor(perms: PdfPermissions): number {
  let p = -4;
  for (const key of PDF_PERMISSION_KEYS)
    if (!perms[key])
      for (const bit of PDF_PERMISSION_BITS[key]) p &= ~(1 << (bit - 1));
  return p;
}

const encryptedWithP = (p: number) =>
  enc(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n9 0 obj\n<< /Filter /Standard /V 5 /R 6 /P ${p} >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 9 0 R >>\n${"0".repeat(64)}\n%%EOF\n`,
  );

/** Ghostscript, played: gray when asked, smaller colour otherwise. */
const ghostscript: NativeCompressor = async (_input, ctx) =>
  ctx.options.grayscale
    ? colourImagePdf({ components: 1, size: 96, pages: 2 })
    : colourImagePdf({ components: 3, size: 48, pages: 2 });

function qpdf(writeP: (perms: PdfPermissions) => number): QpdfRunner {
  const outputs = new Set<Uint8Array>();
  return {
    isEncrypted: async (b) => outputs.has(b),
    requiresPassword: async (b) =>
      outputs.has(b) ? "needs-password" : "not-encrypted",
    protect: async (_b, opts) => {
      const out = encryptedWithP(writeP(opts.permissions!));
      outputs.add(out);
      return out;
    },
    unlock: async () => ({ ok: false, reason: "wrong-password" }),
  };
}

/**
 * Chromium, played with pdf-lib: the proof page's markers and paragraphs
 * laid out on the paper the options ask for — or, with `honour: false`, on
 * Letter pages, narrow, whatever was asked (the renderer before 2026-10-25).
 */
function playedChromium(honour = true): ChromiumPdfRunner {
  const render = async (options?: HtmlRenderOptions): Promise<Uint8Array> => {
    const o = honour && options ? options : DEFAULT_HTML_RENDER_OPTIONS;
    const g = htmlPrintGeometry(o);
    const [w, h] = g.paperInches.map((v) => v * 72) as [number, number];
    const wide = o.viewport === "desktop";
    const lines = [
      wide ? LAYOUT_WIDE_MARKER : LAYOUT_NARROW_MARKER,
      ...Array.from(
        { length: 60 },
        (_, i) => `Layout proof paragraph ${i + 1} of 60.`,
      ),
    ];
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const perPage = o.onePage ? lines.length : 25;
    for (let start = 0; start < lines.length; start += perPage) {
      const chunk = lines.slice(start, start + perPage);
      const page = doc.addPage([w, o.onePage ? chunk.length * 20 + 72 : h]);
      chunk.forEach((line, i) =>
        page.drawText(line, {
          x: 36,
          y: page.getHeight() - 36 - i * 20,
          size: 10,
          font,
        }),
      );
    }
    return doc.save();
  };
  return {
    renderHtml: (_input, options) => render(options),
    renderUrl: (_url, options) => render(options),
  };
}

function deps(over: Partial<OptionsProofDeps> = {}): OptionsProofDeps {
  return {
    compression: {
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native: ghostscript,
    },
    pdfSecurity: { qpdf: qpdf(pFor) },
    htmlRender: { chromium: playedChromium() },
    qpdfShowP: async (bytes) => readEncryptPermissions(bytes),
    log: () => {},
    ...over,
  };
}

describe("runWorkerOptionsProof", () => {
  it("passes engines that do what they are asked", async () => {
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(deps({ log: (l) => lines.push(l) })),
    ).toBe(0);
    // Health: every check ran, not just the first.
    expect(
      lines.filter((l) => l.startsWith("PASS")).length,
    ).toBeGreaterThanOrEqual(12);
  });

  it("FAILS a Ghostscript that ignores grayscale", async () => {
    const ignoring: NativeCompressor = async () =>
      colourImagePdf({ components: 3, size: 48, pages: 2 });
    expect(
      await runWorkerOptionsProof(
        deps({
          compression: {
            tools: { ghostscript: true, qpdf: false, mutool: false },
            native: ignoring,
          },
        }),
      ),
    ).toBe(1);
  });

  it("FAILS a qpdf that writes an all-allowed /P whatever it was asked", async () => {
    expect(
      await runWorkerOptionsProof(
        deps({ pdfSecurity: { qpdf: qpdf(() => -4) } }),
      ),
    ).toBe(1);
  });

  it("FAILS when qpdf's own reading of /P disagrees with ours", async () => {
    expect(
      await runWorkerOptionsProof(deps({ qpdfShowP: async () => -1 })),
    ).toBe(1);
  });

  it("says MISSING (2), not FAIL, in an image without Ghostscript or qpdf", async () => {
    expect(
      await runWorkerOptionsProof(
        deps({
          compression: {
            tools: { ghostscript: false, qpdf: true, mutool: true },
          },
        }),
      ),
    ).toBe(2);
    expect(await runWorkerOptionsProof(deps({ pdfSecurity: {} }))).toBe(2);
    expect(await runWorkerOptionsProof(deps({ htmlRender: {} }))).toBe(2);
  });

  it("FAILS a Chromium that ignores the page layout, on every layout check", async () => {
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(
        deps({
          htmlRender: { chromium: playedChromium(false) },
          log: (l) => lines.push(l),
        }),
      ),
    ).toBe(1);
    const failed = lines.filter((l) => l.startsWith("FAIL layout"));
    expect(failed.map((l) => l.split(":")[0])).toEqual([
      "FAIL layout A4 landscape",
      "FAIL layout one long page",
      "FAIL layout desktop screen",
    ]);
    // The controls still pass: the default render is what it always was.
    expect(lines.some((l) => l.startsWith("PASS layout control:"))).toBe(true);
  });
});
