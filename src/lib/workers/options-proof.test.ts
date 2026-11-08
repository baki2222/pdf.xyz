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
import {
  colourImagePdf,
  noisePhotoPdf,
} from "@/lib/workers/compression/colour-image-pdf";
import { runCompression, type NativeCompressor } from "./compression/engine";
import type { QpdfRunner } from "./pdf-security/engine";
import { readEncryptPermissions } from "./pdf-security/permission-bits";
import { runWorkerOptionsProof, type OptionsProofDeps } from "./options-proof";
import {
  degrees,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
} from "pdf-lib";
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

/**
 * The sizes the REAL Ghostscript made of the proof's photo per rung, in KB
 * (container.yml run 41164786989) — not monotonic in DPI, and played that
 * way, so a ladder that assumes an order is caught here before CI.
 */
const MEASURED_KB: Record<number, number> = {
  300: 339,
  200: 155,
  150: 566,
  120: 383,
  96: 246,
  72: 140,
};

/** The rotation fixture is the only proof input with a /Rotate in it. */
const isRotationFixture = (bytes: Uint8Array) =>
  new TextDecoder("latin1").decode(bytes).includes("/Rotate");

/**
 * Ghostscript on the rotation fixture, played (2026-11-06, audit #21): the
 * input's own pages, photo shrunk so the file is smaller (as the real deep
 * step makes it), and `twist` applied — the identity for an engine that keeps
 * orientation, a re-orientation for one that does what /PageByPage does.
 */
async function faithfulCopy(
  input: Uint8Array,
  twist: (doc: PDFDocument) => void = () => {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input);
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (
      obj instanceof PDFRawStream &&
      obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
    ) {
      doc.context.assign(
        ref,
        doc.context.flateStream(new Uint8Array(8 * 8 * 3), {
          Type: "XObject",
          Subtype: "Image",
          Width: 8,
          Height: 8,
          BitsPerComponent: 8,
          ColorSpace: "DeviceRGB",
        }),
      );
    }
  }
  twist(doc);
  return doc.save({ useObjectStreams: false });
}

/**
 * Ghostscript, played: gray when asked, colour otherwise — and, since the
 * target-size proof (2026-10-31), a file of `MEASURED_KB[dpi]` KB (pdf-lib
 * writes the /Subject pad as UTF-16 hex, 4 B a character). Since audit
 * compress-pdf#4 (2026-11-08) a lower JPEG level makes a smaller file, as
 * the real engine does on a photo; `honourQuality: false` plays one that
 * ignores the level.
 */
const QUALITY_SCALE: Record<string, number> = { low: 0.8, lowest: 0.6 };
const playedGhostscript =
  (
    honourQuality: boolean | ((input: Uint8Array) => boolean) = true,
  ): NativeCompressor =>
  async (input, ctx) =>
    isRotationFixture(input)
      ? faithfulCopy(input)
      : ctx.options.grayscale
        ? colourImagePdf({ components: 1, size: 96, pages: 2 })
        : colourImagePdf({
            components: 3,
            size: 48,
            pages: 2,
            pad: Math.round(
              (MEASURED_KB[ctx.options.targetDpi] ?? 400) *
                256 *
                ((
                  typeof honourQuality === "function"
                    ? honourQuality(input)
                    : honourQuality
                )
                  ? (QUALITY_SCALE[ctx.options.imageQuality ?? ""] ?? 1)
                  : 1),
            ),
          });
const ghostscript = playedGhostscript();

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

/**
 * The deep step with its flag taken out, played: what gs 10.00.0's `/All` did
 * to the four-page fixture in the production image (2026-11-06) — every page
 * turned a quarter, the upright one included (stored `90L 90L 90L 90P`).
 */
const turningGhostscript: NativeCompressor = async (input, ctx) =>
  isRotationFixture(input)
    ? faithfulCopy(input, (doc) => {
        for (const page of doc.getPages())
          page.setRotation(degrees((page.getRotation().angle + 90) % 360));
      })
    : ghostscript(input, ctx);

function deps(over: Partial<OptionsProofDeps> = {}): OptionsProofDeps {
  return {
    compression: {
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native: ghostscript,
    },
    compressionAutoRotating: {
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native: turningGhostscript,
    },
    pdfSecurity: { qpdf: qpdf(pFor) },
    htmlRender: { chromium: playedChromium() },
    qpdfShowP: async (bytes) => readEncryptPermissions(bytes),
    log: () => {},
    ...over,
  };
}

// Each run builds two 1380 px photos (target size, 2026-10-31) and the
// controls below run the proof twice: 5 s was 159% used on CI's runner.
describe("runWorkerOptionsProof", { timeout: 30_000 }, () => {
  it("passes engines that do what they are asked", async () => {
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(deps({ log: (l) => lines.push(l) })),
    ).toBe(0);
    // Health: every check ran, not just the first.
    expect(
      lines.filter((l) => l.startsWith("PASS")).length,
    ).toBeGreaterThanOrEqual(15);
    // The three target-size checks ran, by name, and the rungs were reported.
    for (const name of [
      "target rungs differ",
      "target met",
      "target not met",
    ]) {
      expect(lines.some((l) => l.startsWith(`PASS ${name}:`))).toBe(true);
    }
    expect(lines.filter((l) => l.startsWith("INFO target rungs"))).toHaveLength(
      2,
    );
    // The orientation checks ran, by name (audit #21).
    for (const name of [
      "rotation fixture",
      "rotation control",
      "rotation engine output",
      "rotation kept",
    ]) {
      expect(
        lines.some((l) => l.startsWith(`PASS ${name}:`)),
        name,
      ).toBe(true);
    }
  });

  it("FAILS when the deep step without -dAutoRotatePages turns nothing: 'rotation kept' could not fail", async () => {
    // What the real engine did with the fixture's first, three-page version.
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(
        deps({
          compressionAutoRotating: {
            tools: { ghostscript: true, qpdf: false, mutool: false },
            native: ghostscript,
          },
          log: (l) => lines.push(l),
        }),
      ),
    ).toBe(1);
    expect(lines.some((l) => l.startsWith("FAIL rotation control:"))).toBe(
      true,
    );
    expect(lines.some((l) => l.startsWith("PASS rotation kept:"))).toBe(true);
  });

  it("FAILS, not skips, when no engine without -dAutoRotatePages is wired", async () => {
    const lines: string[] = [];
    const { compressionAutoRotating: _unwired, ...rest } = deps({
      log: (l) => lines.push(l),
    });
    expect(await runWorkerOptionsProof(rest)).toBe(1);
    expect(lines.some((l) => l.startsWith("FAIL rotation control:"))).toBe(
      true,
    );
  });

  it("PASSES a Ghostscript that moves the /Rotate 90 into the page content (what gs 10.00.0 does with the fix)", async () => {
    // Measured 2026-11-06 in a throwaway container of the production image:
    // with -dAutoRotatePages=/None the deep step wrote the /Rotate 90 portrait
    // as an unrotated 792x612 page, its turn in the content. It renders as the
    // input page does, and this proof called it re-oriented:
    // `FAIL rotation kept: input 90P 0L 0P, output 0L 0L 0P`. `faithfulCopy`
    // keeps /Rotate as stored, which the real engine does not, so the played
    // engine that agreed with the old verdict could never have shown it.
    const baking: NativeCompressor = async (input, ctx) =>
      isRotationFixture(input)
        ? faithfulCopy(input, (doc) => {
            const page = doc.getPage(0);
            page.setRotation(degrees(0));
            page.setMediaBox(0, 0, 792, 612);
          })
        : ghostscript(input, ctx);
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(
        deps({
          compression: {
            tools: { ghostscript: true, qpdf: false, mutool: false },
            native: baking,
          },
          log: (l) => lines.push(l),
        }),
      ),
    ).toBe(0);
    expect(lines.some((l) => l.startsWith("PASS rotation kept:"))).toBe(true);
  });

  it("FAILS a Ghostscript that re-orients a page (what /PageByPage does)", async () => {
    // The /Rotate 90 page's text reads upright unrotated, so a text-direction
    // guess sets it back to 0.
    const reorienting: NativeCompressor = async (input, ctx) =>
      isRotationFixture(input)
        ? faithfulCopy(input, (doc) => doc.getPage(0).setRotation(degrees(0)))
        : ghostscript(input, ctx);
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(
        deps({
          compression: {
            tools: { ghostscript: true, qpdf: false, mutool: false },
            native: reorienting,
          },
          log: (l) => lines.push(l),
        }),
      ),
    ).toBe(1);
    expect(lines.some((l) => l.startsWith("FAIL rotation kept:"))).toBe(true);
    // Control: the fixture and the engine-output health checks still pass, so
    // the failure is the orientation, not a broken run.
    expect(lines.some((l) => l.startsWith("PASS rotation fixture:"))).toBe(
      true,
    );
    expect(
      lines.some((l) => l.startsWith("PASS rotation engine output:")),
    ).toBe(true);
  });

  it("FAILS when the engine's file is not what came back (the no-worse swap would pass blind)", async () => {
    // An engine that GROWS the file: the original is handed back, and a verdict
    // on the original's orientation would pass without testing the engine.
    const growing: NativeCompressor = async (input, ctx) => {
      if (!isRotationFixture(input)) return ghostscript(input, ctx);
      const doc = await PDFDocument.load(input);
      doc.setSubject("x".repeat(input.byteLength));
      return doc.save({ useObjectStreams: false });
    };
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(
        deps({
          compression: {
            tools: { ghostscript: true, qpdf: false, mutool: false },
            native: growing,
          },
          log: (l) => lines.push(l),
        }),
      ),
    ).toBe(1);
    expect(
      lines.some((l) => l.startsWith("FAIL rotation engine output:")),
    ).toBe(true);
  });

  it("FAILS a Ghostscript that ignores the image quality it is sent (audit compress-pdf#4)", async () => {
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(
        deps({
          compression: {
            tools: { ghostscript: true, qpdf: false, mutool: false },
            native: playedGhostscript(false),
          },
          log: (l) => lines.push(l),
        }),
      ),
    ).toBe(1);
    // Until the review of 4624d037 "target met" failed here too, on its
    // fixture guard (the tied JPEG rungs made the sharpest fit the smallest
    // file). It now takes its target over distinct sizes, so only the
    // quality check names this engine.
    expect(
      lines.filter((l) => l.startsWith("FAIL ")).map((l) => l.split(":")[0]),
    ).toEqual(["FAIL image quality lowers the file"]);
    expect(
      lines.filter((l) => l.startsWith("FAIL ")).map((l) => l.split(":")[0]),
    ).toContain("FAIL image quality lowers the file");
    // Control: the honouring engine passes the same check.
    const ok: string[] = [];
    await runWorkerOptionsProof(deps({ log: (l) => ok.push(l) }));
    expect(
      ok.some((l) => l.startsWith("PASS image quality lowers the file:")),
    ).toBe(true);
  });

  // Review of 4624d037: AutoFilter may keep the NOISE photo lossless, and
  // then its three JPEG rungs at the floor come out the same size. "target
  // met" took its target from the second-smallest SIZE over every rung, so a
  // tie made the sharpest fit the smallest file and the fixture guard failed
  // the proof for a reason unrelated to the ladder. Played here: quality is
  // honoured on the smooth photo only, as the real engine may do.
  it("PASSES 'target met' when the noise photo stays lossless and its JPEG rungs tie", async () => {
    const noiseLength = (await noisePhotoPdf({ px: 1380, inches: 3, pages: 2 }))
      .byteLength;
    const lines: string[] = [];
    const code = await runWorkerOptionsProof(
      deps({
        compression: {
          tools: { ghostscript: true, qpdf: false, mutool: false },
          native: playedGhostscript(
            (input) => input.byteLength !== noiseLength,
          ),
        },
        log: (l) => lines.push(l),
      }),
    );
    // Health: the noise photo's floor rungs really tie in this run.
    const noiseInfo = lines.find((l) =>
      l.startsWith("INFO target rungs, noise photo:"),
    );
    const floor = [...(noiseInfo ?? "").matchAll(/72:\w+ (\d+) B/g)].map(
      (m) => m[1],
    );
    expect(floor.length).toBeGreaterThan(1);
    expect(new Set(floor).size).toBe(1);
    expect(lines.filter((l) => l.startsWith("FAIL "))).toEqual([]);
    expect(lines.some((l) => l.startsWith("PASS target met:"))).toBe(true);
    expect(
      lines.some((l) => l.startsWith("PASS image quality lowers the file:")),
    ).toBe(true);
    expect(code).toBe(0);
  });

  // The real engine does not tie EXACTLY. Container run 42431179352 (PR
  // #287): the noise photo at the floor gave 72:medium 143,445 B and
  // 72:low / 72:lowest 143,452 B. The image was the same Flate stream; the
  // 7 B are the PostScript the level sends. "Distinct sizes" kept 143,452 as
  // the second-smallest, the target landed 512 B over it, 72:medium fitted
  // as the sharpest AND the smallest, and the fixture guard failed the proof
  // on its own fixture. Played here: the noise photo's JPEG rungs carry 7
  // extra bytes.
  it("PASSES 'target met' when the noise photo's JPEG rungs differ from the preset's by a few bytes", async () => {
    const noiseLength = (await noisePhotoPdf({ px: 1380, inches: 3, pages: 2 }))
      .byteLength;
    const played = playedGhostscript(
      (input) => input.byteLength !== noiseLength,
    );
    const native: NativeCompressor = async (input, ctx) => {
      const out = await played(input, ctx);
      const quality = ctx.options.imageQuality;
      if (input.byteLength !== noiseLength || !quality || quality === "medium")
        return out;
      const padded = new Uint8Array(out.byteLength + 7);
      padded.set(out);
      padded.set(new TextEncoder().encode("\n%pad\n "), out.byteLength);
      return padded;
    };
    const lines: string[] = [];
    const code = await runWorkerOptionsProof(
      deps({
        compression: {
          tools: { ghostscript: true, qpdf: false, mutool: false },
          native,
        },
        log: (l) => lines.push(l),
      }),
    );
    // Health: the noise photo's floor rungs differ, by exactly 7 bytes.
    const noiseInfo = lines.find((l) =>
      l.startsWith("INFO target rungs, noise photo:"),
    );
    const floor = [...(noiseInfo ?? "").matchAll(/72:\w+ (\d+) B/g)].map((m) =>
      Number(m[1]),
    );
    expect(floor).toHaveLength(3);
    expect(floor[1]! - floor[0]!).toBe(7);
    expect(lines.filter((l) => l.startsWith("FAIL "))).toEqual([]);
    expect(lines.some((l) => l.startsWith("PASS target met:"))).toBe(true);
    expect(code).toBe(0);
  });

  it("FAILS a ladder that returns a NON-minimal file when the target is not met", async () => {
    // The ladder as first written: on not-met, the floor's file — which, on
    // these non-monotonic sizes, is not the smallest one it made.
    const floorOnMiss: typeof runCompression = async (input, options, d) => {
      const run = await runCompression(input, options, d);
      if (!run.ok || run.meta.target?.met !== false) return run;
      const floor = await d.native!(input, {
        engine: "ghostscript",
        options: { ...options, targetDpi: 72 },
      });
      return {
        ...run,
        output: floor,
        meta: { ...run.meta, outputBytes: floor.length },
      };
    };
    // Sizes where the smallest file is NOT the floor's (96 DPI smallest),
    // as AutoFilter can make them; the second-smallest stays sharper than it.
    const kb: Record<number, number> = { ...MEASURED_KB, 200: 130, 96: 120 };
    const twisted: NativeCompressor = async (input, ctx) =>
      ctx.options.grayscale
        ? ghostscript(input, ctx)
        : colourImagePdf({
            components: 3,
            size: 48,
            pages: 2,
            pad: (kb[ctx.options.targetDpi] ?? 400) * 256,
          });
    const compression = {
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native: twisted,
    };
    // Health: with the REAL ladder these sizes pass every target check.
    const honest: string[] = [];
    await runWorkerOptionsProof(
      deps({ compression, log: (l) => honest.push(l) }),
    );
    expect(honest.filter((l) => /^(PASS|FAIL) target/.test(l))).toEqual(
      honest.filter((l) => /^PASS target/.test(l)),
    );
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(
        deps({ compression, compress: floorOnMiss, log: (l) => lines.push(l) }),
      ),
    ).toBe(1);
    expect(lines.some((l) => l.startsWith("FAIL target not met:"))).toBe(true);
    // Control: the met check, which this wrapper does not touch, still passes.
    expect(lines.some((l) => l.startsWith("PASS target met:"))).toBe(true);
  });

  it("FAILS a ladder that returns a fit that is not the sharpest", async () => {
    // Prefers the bottom of the ladder whenever it fits. Since audit
    // compress-pdf#4 that is 72 DPI at the lowest JPEG level (was 72 DPI
    // alone, which now ladders on to the same Low fit the real one finds).
    const floorFirst: typeof runCompression = async (input, options, d) => {
      if (options.targetBytes === undefined)
        return runCompression(input, options, d);
      const floor = await runCompression(
        input,
        { ...options, targetDpi: 72, imageQuality: "lowest" },
        d,
      );
      return floor.ok && floor.meta.target?.met
        ? floor
        : runCompression(input, options, d);
    };
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(
        deps({ compress: floorFirst, log: (l) => lines.push(l) }),
      ),
    ).toBe(1);
    expect(lines.some((l) => l.startsWith("FAIL target met:"))).toBe(true);
  });

  // INVERTED 2026-10-31: was "FAILS ... (the ladder's one assumption)", on a
  // check that sizes descend with DPI — false on the real engine. A
  // Ghostscript that ignores the resolution is still a defect the proof must
  // see, now as "the resolution changes nothing".
  it("FAILS a Ghostscript that ignores the resolution", async () => {
    const flat: NativeCompressor = async (_input, ctx) =>
      ctx.options.grayscale
        ? colourImagePdf({ components: 1, size: 96, pages: 2 })
        : colourImagePdf({ components: 3, size: 48, pages: 2, pad: 30_000 });
    const lines: string[] = [];
    expect(
      await runWorkerOptionsProof(
        deps({
          compression: {
            tools: { ghostscript: true, qpdf: false, mutool: false },
            native: flat,
          },
          log: (l) => lines.push(l),
        }),
      ),
    ).toBe(1);
    expect(lines.some((l) => l.startsWith("FAIL target rungs differ:"))).toBe(
      true,
    );
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
