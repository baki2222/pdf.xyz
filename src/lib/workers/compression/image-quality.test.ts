// @vitest-environment node
/**
 * Image quality — the JPEG axis, separate from resolution (audit
 * compress-pdf#4, 2026-11-08). Before this the argv never set a QFactor, and
 * the Target size ladder could only lower the resolution: it bottomed out at
 * 72 DPI with JPEG quality never lowered.
 */
import { describe, expect, it } from "vitest";
import {
  parseCompressionOptions,
  planCompression,
  runCompression,
  type CompressionDeps,
  type NativeCompressor,
} from "./engine";
import { createNativeCompressor, nativeArgs, type NativeExec } from "./native";
import { MAX_TARGET_ATTEMPTS, TARGET_DPI_LADDER } from "./target-ladder";
import { colourImagePdf } from "./colour-image-pdf";
import { createCompressionProcessor } from "../processor/compression";
import { sanitizeJobResults } from "@/lib/jobs/results";
import {
  DEFAULT_IMAGE_QUALITY,
  IMAGE_QUALITY_LEVELS,
  imageQualityDistillerParams,
  type ImageQuality,
} from "@/lib/pdf/compress-image-quality";

const KB = 1024;

describe("nativeArgs: image quality", () => {
  const gs = (q?: ImageQuality) =>
    nativeArgs("ghostscript", "gs", "/t/in.pdf", "/t/out.pdf", 150, {
      ...(q ? { imageQuality: q } : {}),
    }).args;

  it("the default level sends nothing new: today's argv, byte for byte", () => {
    expect(gs(DEFAULT_IMAGE_QUALITY)).toEqual(gs());
    expect(gs()).not.toContain("-c");
  });

  it("every other level sets its QFactor through setdistillerparams, input still last", () => {
    const others = IMAGE_QUALITY_LEVELS.filter(
      (l) => l.id !== DEFAULT_IMAGE_QUALITY,
    );
    // Health check: there are levels to test.
    expect(others.length).toBeGreaterThanOrEqual(2);
    for (const level of others) {
      const args = gs(level.id);
      const c = args.indexOf("-c");
      expect(c).toBeGreaterThan(-1);
      expect(args[c + 1]).toBe(imageQualityDistillerParams(level.id));
      expect(args[c + 2]).toBe("-f");
      expect(args.at(-1)).toBe("/t/in.pdf");
      // The output switch comes before -c (everything after -c is PostScript).
      expect(args.indexOf("-sOutputFile=/t/out.pdf")).toBeLessThan(c);
      for (const dict of [
        "ColorACSImageDict",
        "GrayACSImageDict",
        "ColorImageDict",
        "GrayImageDict",
      ]) {
        expect(args[c + 1]).toContain(`/${dict} << /QFactor ${level.qFactor} `);
      }
    }
  });

  it("the PostScript is built only from the table (no request text can reach it)", () => {
    for (const level of IMAGE_QUALITY_LEVELS) {
      expect(imageQualityDistillerParams(level.id)).toMatch(
        /^[<>/A-Za-z0-9 .[\]{}]+ setpagedevice$/,
      );
    }
  });

  // INVERTED 2026-11-08. The first version set the level once, before the
  // input, and the PR's in-image options proof (container run 42431179352)
  // showed Ghostscript 10.00's PDF interpreter restoring the preset's
  // dictionaries after page 1: a photo shared by two pages came back as TWO
  // images (page 1 at the asked level, page 2 at /ebook's), so "Low" made the
  // file BIGGER (11,791 B against Medium's 7,900 B). Measured in a throwaway
  // container of the live worker image: re-setting the same dictionaries at
  // every page start (a BeginPage procedure) keeps one image per picture,
  // and Low then gives 6,871 B and Lowest 5,945 B.
  it("re-applies the same dictionaries at the start of every page", () => {
    for (const level of IMAGE_QUALITY_LEVELS) {
      const ps = imageQualityDistillerParams(level.id);
      const dicts = ps.match(/<< \/ColorACSImageDict .*? >> >>/g) ?? [];
      // Once before the input, once inside BeginPage: the same text.
      expect(dicts, ps).toHaveLength(2);
      expect(dicts[0]).toBe(dicts[1]);
      expect(ps).toContain(
        `<< /BeginPage { pop ${dicts[1]} setdistillerparams } >> setpagedevice`,
      );
    }
  });

  it("qpdf and mutool refuse a non-default level instead of ignoring it", () => {
    expect(() =>
      nativeArgs("qpdf", "qpdf", "/i", "/o", 150, { imageQuality: "low" }),
    ).toThrow();
    expect(() =>
      nativeArgs("mutool", "mutool", "/i", "/o", 150, {
        imageQuality: "lowest",
      }),
    ).toThrow();
  });

  it("the compressor hands the job's level to the subprocess it runs", async () => {
    const seen: string[][] = [];
    const exec: NativeExec = async (_cmd, args) => {
      seen.push([...args]);
    };
    const pdf = new TextEncoder().encode(
      `%PDF-1.7\n${"x".repeat(64)}\n%%EOF\n`,
    );
    const run = createNativeCompressor(
      {
        enabled: true,
        binaries: { ghostscript: "gs", qpdf: "qpdf", mutool: "mutool" },
        overridden: { ghostscript: false, qpdf: false, mutool: false },
        timeoutMs: 1_000,
        maxInputBytes: 1e9,
        maxOutputBytes: 1e9,
      },
      {
        exec,
        fs: {
          mkdtemp: async (p) => `${p}x`,
          writeFile: async () => {},
          readFile: async () => pdf,
          rm: async () => {},
        },
      },
    );
    await run(pdf, {
      engine: "ghostscript",
      options: { profile: "deep", targetDpi: 96, imageQuality: "low" },
    });
    expect(seen[0]).toContain(imageQualityDistillerParams("low"));
  });
});

describe("parseCompressionOptions: imageQuality", () => {
  it("is absent by default", () => {
    const r = parseCompressionOptions({});
    expect(r.ok && r.value.imageQuality).toBe(undefined);
  });

  it("accepts every level and refuses anything else", () => {
    for (const level of IMAGE_QUALITY_LEVELS) {
      const r = parseCompressionOptions({ imageQuality: level.id });
      expect(r.ok && r.value.imageQuality).toBe(level.id);
    }
    for (const bad of ["Low", "0.4", 50, true, ""]) {
      expect(parseCompressionOptions({ imageQuality: bad }).ok).toBe(false);
    }
  });

  it("refuses a level on the lossless profile, which never re-encodes an image", () => {
    const r = parseCompressionOptions({
      profile: "lossless",
      imageQuality: "low",
    });
    expect(r.ok).toBe(false);
    // Control: the default level asks for nothing, so lossless accepts it.
    expect(
      parseCompressionOptions({
        profile: "lossless",
        imageQuality: DEFAULT_IMAGE_QUALITY,
      }).ok,
    ).toBe(true);
  });

  it("a non-default level needs Ghostscript; without it the plan says so", () => {
    const qpdfOnly = { ghostscript: false, qpdf: true, mutool: false };
    const plan = planCompression(
      { profile: "deep", targetDpi: 150, imageQuality: "low" },
      qpdfOnly,
    );
    expect(plan.supported).toBe(false);
    // Control: the default level still runs on qpdf.
    expect(
      planCompression(
        { profile: "deep", targetDpi: 150, imageQuality: "medium" },
        qpdfOnly,
      ).supported,
    ).toBe(true);
  });
});

describe("the Target size ladder lowers image quality after resolution", () => {
  /** A played Ghostscript whose size falls with resolution AND with quality. */
  const FACTOR: Record<ImageQuality, number> = {
    high: 1.5,
    medium: 1,
    low: 0.6,
    lowest: 0.4,
  };
  const cache = new Map<number, Promise<Uint8Array>>();
  const sized = (kb: number) => {
    const key = Math.round(kb);
    if (!cache.has(key)) {
      cache.set(
        key,
        colourImagePdf({
          components: 3,
          size: 8,
          pages: 2,
          pad: (key * KB) / 4,
        }),
      );
    }
    return cache.get(key)!;
  };
  function played(calls: { dpi: number; q: ImageQuality }[]) {
    const native: NativeCompressor = async (_i, ctx) => {
      const q = ctx.options.imageQuality ?? DEFAULT_IMAGE_QUALITY;
      calls.push({ dpi: ctx.options.targetDpi, q });
      return sized(ctx.options.targetDpi * FACTOR[q]);
    };
    return {
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native,
    } satisfies CompressionDeps;
  }
  const input = colourImagePdf({
    components: 3,
    size: 8,
    pages: 2,
    pad: (600 * KB) / 4,
  });

  it("at the 72 DPI floor it steps the quality down, and ships the first fit", async () => {
    const calls: { dpi: number; q: ImageQuality }[] = [];
    // 72 DPI at Medium is ~72 KB; at Low ~43 KB: only a quality rung fits 50 KB.
    const run = await runCompression(
      await input,
      { profile: "deep", targetDpi: 150, targetBytes: 50 * KB },
      played(calls),
    );
    expect(calls).toEqual([
      { dpi: 150, q: "medium" },
      { dpi: 120, q: "medium" },
      { dpi: 96, q: "medium" },
      { dpi: 72, q: "medium" },
      { dpi: 72, q: "low" },
    ]);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.output).toBe(await sized(72 * FACTOR.low));
    expect(run.output.byteLength).toBeLessThanOrEqual(50 * KB);
    expect(run.meta.target).toMatchObject({
      met: true,
      dpi: 72,
      quality: "low",
      attempts: 5,
      stoppedBy: "fit",
    });
    expect(run.meta.target?.tried.at(-1)).toMatchObject({
      dpi: 72,
      quality: "low",
    });
  });

  it("starts from the level the person chose and never raises it", async () => {
    const calls: { dpi: number; q: ImageQuality }[] = [];
    await runCompression(
      await input,
      {
        profile: "deep",
        targetDpi: 96,
        imageQuality: "low",
        targetBytes: 20 * KB,
      },
      played(calls),
    );
    expect(calls).toEqual([
      { dpi: 96, q: "low" },
      { dpi: 72, q: "low" },
      { dpi: 72, q: "lowest" },
    ]);
  });

  it("the attempt bound covers the longest ladder", () => {
    expect(MAX_TARGET_ATTEMPTS).toBe(
      TARGET_DPI_LADDER.length + 1 + IMAGE_QUALITY_LEVELS.length - 1,
    );
  });
});

describe("the composed chain: the level the worker read reaches the job record", () => {
  const run = async (options: Record<string, unknown>) => {
    const processor = createCompressionProcessor({
      tools: { ghostscript: true, qpdf: false, mutool: false },
      native: async () => colourImagePdf({ components: 3, size: 8 }),
    });
    const result = await processor.process({
      tool: "compress-pdf",
      options,
      inputs: [
        {
          fileId: "f1",
          filename: "scan.pdf",
          contentType: "application/pdf",
          bytes: await colourImagePdf({ components: 3, size: 8, pad: 60_000 }),
        },
      ],
    });
    expect(result.ok).toBe(true);
    return result.ok ? sanitizeJobResults(result.results) : undefined;
  };

  it("a Low run's record says Low; a default run's record says nothing", async () => {
    const low = await run({ profile: "deep", imageQuality: "low" });
    expect(low?.compression?.imageQuality).toBe("low");
    const plain = await run({ profile: "deep" });
    expect(plain?.compression).toBeDefined();
    expect(plain?.compression).not.toHaveProperty("imageQuality");
    const medium = await run({
      profile: "deep",
      imageQuality: DEFAULT_IMAGE_QUALITY,
    });
    expect(medium?.compression).not.toHaveProperty("imageQuality");
  });

  it("the record boundary drops a value that is not a short lowercase word", () => {
    const base = { pageCheck: "verified" as const, pagesIn: 1, pagesOut: 1 };
    // Untrusted input: the record boundary sees whatever was written.
    const untrusted = (imageQuality: unknown) =>
      ({ compression: { ...base, imageQuality } }) as unknown as Parameters<
        typeof sanitizeJobResults
      >[0];
    for (const bad of ["Low", "<script>", "x".repeat(17), 3]) {
      const clean = sanitizeJobResults(untrusted(bad));
      expect(clean?.compression).not.toHaveProperty("imageQuality");
    }
    // Control: a real level survives.
    expect(
      sanitizeJobResults(untrusted("lowest"))?.compression?.imageQuality,
    ).toBe("lowest");
  });
});
