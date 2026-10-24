import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { DEEP_COMPRESSION_PRESETS } from "@/lib/pdf/offered-kinds";
import { colourImagePdf } from "@/tests/colour-image-pdf";
import {
  parseCompressionOptions,
  planCompression,
  runCompression,
  type ToolAvailability,
} from "./engine";
import { nativeArgs } from "./native";
import { compressionJobError } from "../processor/compression";

/** A one-page PDF carrying one 16x16 image, in colour or in gray. */
const imagePdf = (kind: "rgb8" | "gray8", pad = 0) =>
  colourImagePdf({ components: kind === "rgb8" ? 3 : 1, pad });

async function textPdf(pages: number, lines = 8): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200, 200]);
    for (let line = 0; line < lines; line += 1)
      page.drawText(`content line ${line}`, {
        x: 10,
        y: 180 - line * 20,
        size: 9,
        font,
      });
  }
  return doc.save();
}

const noTools: ToolAvailability = {
  ghostscript: false,
  qpdf: false,
  mutool: false,
};
const gsOnly: ToolAvailability = { ...noTools, ghostscript: true };

describe("compress presets — Extreme sits below Smaller", () => {
  it("offers Extreme at 72 DPI first, then the three that shipped before", () => {
    expect(DEEP_COMPRESSION_PRESETS.map((p) => [p.label, p.dpi])).toEqual([
      ["Extreme", 72],
      ["Smaller", 96],
      ["Balanced", 150],
      ["High quality", 300],
    ]);
  });

  it("every preset is a DPI the worker accepts and Ghostscript is given", () => {
    for (const preset of DEEP_COMPRESSION_PRESETS) {
      expect(
        parseCompressionOptions({ profile: "deep", targetDpi: preset.dpi }).ok,
      ).toBe(true);
      expect(
        nativeArgs("ghostscript", "gs", "in", "out", preset.dpi).args,
      ).toContain(`-dColorImageResolution=${preset.dpi}`);
    }
  });
});

describe("grayscale — an option the deep path must keep, or fail", () => {
  it("parses: off by default, a boolean when sent, anything else refused", () => {
    const base = parseCompressionOptions({});
    expect(base.ok && base.value.grayscale).toBe(false);
    const on = parseCompressionOptions({ grayscale: true });
    expect(on.ok && on.value.grayscale).toBe(true);
    const bad = parseCompressionOptions({ grayscale: "yes" });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.error.body.error.details?.[0]?.field).toBe(
        "options.grayscale",
      );
    // The lossless repack cannot change colour, so asking it to is refused
    // rather than silently ignored.
    expect(
      parseCompressionOptions({ profile: "lossless", grayscale: true }).ok,
    ).toBe(false);
  });

  it("needs Ghostscript: qpdf and mutool cannot convert colour, so they are never picked", () => {
    const opts = { profile: "deep" as const, targetDpi: 150, grayscale: true };
    expect(
      planCompression(opts, { ghostscript: false, qpdf: true, mutool: true }),
    ).toMatchObject({ supported: false, requires: ["ghostscript"] });
    expect(planCompression(opts, gsOnly)).toEqual({
      supported: true,
      engine: "ghostscript",
    });
    // Control: without grayscale qpdf is still a fine deep engine.
    expect(
      planCompression(
        { profile: "deep", targetDpi: 150 },
        { ghostscript: false, qpdf: true, mutool: false },
      ),
    ).toEqual({ supported: true, engine: "qpdf" });
  });

  it("hands the grayscale flag to the native engine", async () => {
    let seen: boolean | undefined;
    await runCompression(
      await imagePdf("rgb8"),
      { profile: "deep", targetDpi: 150, grayscale: true },
      {
        tools: gsOnly,
        native: async (_b, ctx) => {
          seen = ctx.options.grayscale;
          return imagePdf("gray8");
        },
      },
    );
    expect(seen).toBe(true);
  });

  it("ships the gray output even when it is not smaller — the original is in colour", async () => {
    const input = await imagePdf("rgb8");
    const gray = await imagePdf("gray8", input.byteLength + 2048);
    expect(gray.byteLength).toBeGreaterThan(input.byteLength);
    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150, grayscale: true },
      { tools: gsOnly, native: async () => gray },
    );
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.output).toBe(gray);
      expect(run.meta.savedBytes).toBe(0);
      expect(run.meta.grayscale).toBe(true);
    }
  });

  it("fails a run whose output still carries a colour image", async () => {
    const input = await imagePdf("rgb8", 4096);
    const colourOut = await imagePdf("rgb8");
    expect(colourOut.byteLength).toBeLessThan(input.byteLength);
    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150, grayscale: true },
      // An engine that ignored the flag: same colour image, fewer bytes.
      { tools: gsOnly, native: async () => colourOut },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("colour_kept");
      // Final, not retried: the same flag keeps the same colour.
      expect(compressionJobError(run).retryable).toBe(false);
    }
  });

  it("control: without grayscale the same colour output is a success", async () => {
    const input = await imagePdf("rgb8", 4096);
    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      { tools: gsOnly, native: async () => imagePdf("rgb8") },
    );
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.meta.grayscale).toBe(false);
  });

  it("control: the no-worse swap still returns the original when grayscale is off", async () => {
    const input = await textPdf(2);
    const bigger = await textPdf(2, 9);
    expect(bigger.byteLength).toBeGreaterThan(input.byteLength);
    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      { tools: gsOnly, native: async () => bigger },
    );
    expect(run.ok && run.output).toBe(input);
  });
});

describe("nativeArgs — grayscale", () => {
  it("asks Ghostscript to convert every colour to gray", () => {
    const { args } = nativeArgs("ghostscript", "gs", "in", "out", 150, {
      grayscale: true,
    });
    expect(args).toContain("-sColorConversionStrategy=Gray");
    expect(args).toContain("-dProcessColorModel=/DeviceGray");
    // Paths still last, flags still before them.
    expect(args[args.length - 1]).toBe("in");
  });

  it("control: the default argv carries no colour conversion at all", () => {
    const { args } = nativeArgs("ghostscript", "gs", "in", "out", 150);
    expect(args.some((a) => /ColorConversion|ProcessColorModel/.test(a))).toBe(
      false,
    );
  });

  it("refuses to build a grayscale argv for an engine that cannot do it", () => {
    expect(() =>
      nativeArgs("qpdf", "qpdf", "in", "out", 150, { grayscale: true }),
    ).toThrow();
    expect(() =>
      nativeArgs("mutool", "mutool", "in", "out", 150, { grayscale: true }),
    ).toThrow();
  });
});
