/**
 * "Target size" for deep compression (2026-10-31): the options parser, the
 * bounded descending ladder, and the chain from the engine's result to the
 * block a job record carries to the browser.
 *
 * The fake engine below plays Ghostscript as a DPI-to-size function — every
 * output a real, page-counted pdf-lib document whose size grows with the DPI
 * it was asked for — so "picks the first fit" is a claim about which rung
 * ran, not about which bytes a stub happened to return.
 */
import { describe, expect, it } from "vitest";
import { colourImagePdf } from "./colour-image-pdf";
import {
  parseCompressionOptions,
  runCompression,
  type CompressionDeps,
  type CompressionOptions,
  type NativeCompressor,
} from "./engine";
import {
  MAX_TARGET_ATTEMPTS,
  TARGET_DPI_LADDER,
  ladderRungs,
} from "./target-ladder";
import { createCompressionProcessor } from "../processor/compression";
import { sanitizeJobResults } from "@/lib/jobs/results";
import {
  MAX_TARGET_BYTES,
  MIN_TARGET_BYTES,
  TARGET_SIZE_PRESETS,
} from "@/lib/pdf/compress-target";
import { DEEP_COMPRESSION_PRESETS } from "@/lib/pdf/offered-kinds";

const KB = 1024;

/** One output per DPI, each about `dpi` KB, all two pages — built once. */
const BY_DPI = new Map<number, Uint8Array>();
async function outputAt(dpi: number, components: 1 | 3 = 3) {
  const key = dpi * 10 + components;
  let out = BY_DPI.get(key);
  if (!out) {
    out = await colourImagePdf({
      components,
      size: 8,
      pages: 2,
      // pdf-lib writes /Subject as UTF-16 hex: four bytes per character.
      pad: (dpi * KB) / 4,
    });
    BY_DPI.set(key, out);
  }
  return out;
}

const INPUT = colourImagePdf({
  components: 3,
  size: 8,
  pages: 2,
  pad: (600 * KB) / 4,
});

interface Call {
  dpi: number;
  grayscale: boolean | undefined;
  timeoutMs: number | undefined;
}

/** Ghostscript, played: output size follows the DPI asked for. */
function playedGs(calls: Call[], over: Partial<{ throwAt: number }> = {}) {
  const native: NativeCompressor = async (_input, ctx) => {
    calls.push({
      dpi: ctx.options.targetDpi,
      grayscale: ctx.options.grayscale,
      timeoutMs: ctx.timeoutMs,
    });
    if (over.throwAt === ctx.options.targetDpi) throw new Error("engine died");
    return outputAt(ctx.options.targetDpi, ctx.options.grayscale ? 1 : 3);
  };
  return native;
}

function gsDeps(
  native: NativeCompressor,
  extra: Partial<CompressionDeps> = {},
) {
  return {
    tools: { ghostscript: true, qpdf: false, mutool: false },
    native,
    ...extra,
  } satisfies CompressionDeps;
}

const deep = (over: Partial<CompressionOptions>): CompressionOptions => ({
  profile: "deep",
  targetDpi: 150,
  grayscale: false,
  ...over,
});

describe("parseCompressionOptions: targetBytes", () => {
  it("is absent by default, so a run without it is today's run", () => {
    const r = parseCompressionOptions({});
    expect(r.ok && r.value.targetBytes).toBe(undefined);
  });

  it("accepts an integer from the floor up", () => {
    const r = parseCompressionOptions({ targetBytes: 200 * KB });
    expect(r.ok && r.value.targetBytes).toBe(200 * KB);
    const floor = parseCompressionOptions({ targetBytes: MIN_TARGET_BYTES });
    expect(floor.ok).toBe(true);
  });

  it.each([
    ["below the floor", MIN_TARGET_BYTES - 1],
    ["above the ceiling", MAX_TARGET_BYTES + 1],
    ["fractional", 100_000.5],
    ["a string", "100000"],
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("rejects %s with a field error", (_name, value) => {
    const r = parseCompressionOptions({ targetBytes: value });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.body.error.code).toBe("invalid_request");
      expect(r.error.body.error.details?.[0]?.field).toBe(
        "options.targetBytes",
      );
    }
  });

  it("is refused on the lossless profile, which cannot honour it", () => {
    const r = parseCompressionOptions({
      profile: "lossless",
      targetBytes: 100 * KB,
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.body.error.details?.[0]?.field).toBe(
        "options.targetBytes",
      );
  });

  it("every UI preset is a value the parser accepts", () => {
    for (const p of TARGET_SIZE_PRESETS) {
      expect(parseCompressionOptions({ targetBytes: p.bytes }).ok).toBe(true);
    }
  });
});

describe("the ladder's shape", () => {
  it("ends at the worker's DPI floor, the Extreme preset", () => {
    expect(TARGET_DPI_LADDER.at(-1)).toBe(72);
    expect(Math.min(...DEEP_COMPRESSION_PRESETS.map((p) => p.dpi))).toBe(
      TARGET_DPI_LADDER.at(-1),
    );
    const r = parseCompressionOptions({ targetDpi: 71 });
    expect(r.ok).toBe(false);
  });

  it("strictly descends and holds every Quality preset", () => {
    for (let i = 1; i < TARGET_DPI_LADDER.length; i++) {
      expect(TARGET_DPI_LADDER[i]!).toBeLessThan(TARGET_DPI_LADDER[i - 1]!);
    }
    for (const p of DEEP_COMPRESSION_PRESETS) {
      expect(TARGET_DPI_LADDER).toContain(p.dpi);
    }
  });

  it("starts at the Quality the person chose and never exceeds the attempt bound", () => {
    expect(ladderRungs(150)).toEqual([150, 120, 96, 72]);
    expect(ladderRungs(72)).toEqual([72]);
    expect(ladderRungs(110)).toEqual([110, 96, 72]);
    for (let dpi = 72; dpi <= 600; dpi++) {
      const rungs = ladderRungs(dpi);
      expect(rungs[0]).toBe(dpi);
      expect(rungs.length).toBeLessThanOrEqual(MAX_TARGET_ATTEMPTS);
    }
  });
});

describe("runCompression with a target", () => {
  it("returns the FIRST (highest-quality) rung at or under the target", async () => {
    const input = await INPUT;
    const calls: Call[] = [];
    const run = await runCompression(
      input,
      deep({ targetDpi: 150, targetBytes: 130 * KB }),
      gsDeps(playedGs(calls)),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    // Floor first (does anything fit at all?), then from the top down.
    expect(calls.map((c) => c.dpi)).toEqual([72, 150, 120]);
    expect(run.output).toBe(await outputAt(120));
    expect(run.output.byteLength).toBeLessThanOrEqual(130 * KB);
    // Positive control: the rung above really was over, so 120 is the first fit.
    expect((await outputAt(150)).byteLength).toBeGreaterThan(130 * KB);
    expect(run.meta.target).toEqual({
      targetBytes: 130 * KB,
      met: true,
      attempts: 3,
      dpi: 120,
      tried: [
        { dpi: 72, bytes: (await outputAt(72)).byteLength },
        { dpi: 150, bytes: (await outputAt(150)).byteLength },
        { dpi: 120, bytes: (await outputAt(120)).byteLength },
      ],
      stoppedBy: "fit",
    });
    expect(run.meta.pageCheck).toBe("verified");
  });

  it("stops after ONE attempt and reports not-met with the smallest when the floor does not fit", async () => {
    const input = await INPUT;
    const calls: Call[] = [];
    const run = await runCompression(
      input,
      deep({ targetDpi: 300, targetBytes: 40 * KB }),
      gsDeps(playedGs(calls)),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(calls.map((c) => c.dpi)).toEqual([72]);
    expect(run.output).toBe(await outputAt(72));
    expect(run.output.byteLength).toBeGreaterThan(40 * KB);
    // The not-met path carries exactly the success path's metadata.
    expect(run.meta.target).toMatchObject({
      targetBytes: 40 * KB,
      met: false,
      attempts: 1,
      dpi: 72,
      stoppedBy: "floor_missed",
    });
    expect(run.meta.outputBytes).toBe(run.output.byteLength);
    expect(run.meta.pageCheck).toBe("verified");
  });

  it("keeps the floor's result when only the floor fits, after trying every rung once", async () => {
    const input = await INPUT;
    const calls: Call[] = [];
    const run = await runCompression(
      input,
      deep({ targetDpi: 300, targetBytes: 80 * KB }),
      gsDeps(playedGs(calls)),
    );
    expect(run.ok && run.meta.target?.met).toBe(true);
    expect(calls.map((c) => c.dpi)).toEqual([72, 300, 200, 150, 120, 96]);
    expect(calls.length).toBeLessThanOrEqual(MAX_TARGET_ATTEMPTS);
    if (run.ok) {
      expect(run.output).toBe(await outputAt(72));
      expect(run.meta.target?.dpi).toBe(72);
    }
  });

  it("never touches grayscale: off stays off on every rung, on stays on", async () => {
    const input = await INPUT;
    const off: Call[] = [];
    await runCompression(
      input,
      deep({ targetDpi: 300, targetBytes: 80 * KB }),
      gsDeps(playedGs(off)),
    );
    expect(off.length).toBeGreaterThan(1);
    expect(off.every((c) => c.grayscale === false)).toBe(true);

    const on: Call[] = [];
    const run = await runCompression(
      input,
      deep({ targetDpi: 300, targetBytes: 80 * KB, grayscale: true }),
      gsDeps(playedGs(on)),
    );
    expect(on.length).toBeGreaterThan(1);
    expect(on.every((c) => c.grayscale === true)).toBe(true);
    expect(run.ok && run.meta.grayscale).toBe(true);
  });

  it("refuses a target that is not below the file's own size", async () => {
    const input = await INPUT;
    const calls: Call[] = [];
    const run = await runCompression(
      input,
      deep({ targetBytes: input.byteLength }),
      gsDeps(playedGs(calls)),
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("invalid_target");
    expect(calls).toHaveLength(0);
  });

  it("runs once on an engine that does not read DPI (qpdf)", async () => {
    const input = await INPUT;
    const calls: Call[] = [];
    const run = await runCompression(input, deep({ targetBytes: 130 * KB }), {
      tools: { ghostscript: false, qpdf: true, mutool: false },
      native: playedGs(calls),
    });
    expect(calls).toHaveLength(1);
    expect(run.ok && run.meta.target?.attempts).toBe(1);
  });

  it("shares ONE time budget: each rung gets what is left, and no rung starts with less than a second", async () => {
    const input = await INPUT;
    const calls: Call[] = [];
    let clock = 0;
    const gs = playedGs(calls);
    const slow: NativeCompressor = async (bytes, ctx) => {
      clock += 4_000;
      return gs(bytes, ctx);
    };
    const run = await runCompression(
      input,
      deep({ targetDpi: 300, targetBytes: 80 * KB }),
      gsDeps(slow, { limits: { targetBudgetMs: 10_000 }, now: () => clock }),
    );
    // 10 s: 72 (budget 10 s), 300 (6 s left), 200 (2 s left), then 0 s left.
    expect(calls.map((c) => [c.dpi, c.timeoutMs])).toEqual([
      [72, 10_000],
      [300, 6_000],
      [200, 2_000],
    ]);
    expect(run.ok && run.meta.target).toMatchObject({
      met: true,
      dpi: 72,
      attempts: 3,
      stoppedBy: "budget",
    });
  });

  it("a rung that dies after the floor fit keeps the floor's file, and says why it stopped", async () => {
    const input = await INPUT;
    const calls: Call[] = [];
    const run = await runCompression(
      input,
      deep({ targetDpi: 300, targetBytes: 80 * KB }),
      gsDeps(playedGs(calls, { throwAt: 200 })),
    );
    expect(calls.map((c) => c.dpi)).toEqual([72, 300, 200]);
    expect(run.ok && run.meta.target).toMatchObject({
      met: true,
      dpi: 72,
      stoppedBy: "engine_error",
    });
  });

  it("a floor that dies is a failed run, and the failure still reports what it spent", async () => {
    const input = await INPUT;
    const calls: Call[] = [];
    const run = await runCompression(
      input,
      deep({ targetDpi: 150, targetBytes: 80 * KB }),
      gsDeps(playedGs(calls, { throwAt: 72 })),
    );
    expect(run.ok).toBe(false);
    if (!run.ok && run.kind === "failed") {
      expect(run.target).toMatchObject({
        targetBytes: 80 * KB,
        met: false,
        attempts: 1,
        stoppedBy: "engine_error",
      });
    } else throw new Error("expected a failed run");
  });

  it("met is computed from the FINAL artifact: a no-shrink run that swaps the original back is not met", async () => {
    // Every rung bigger than the input: the no-worse policy hands back the
    // original, and the target report must describe THAT file.
    const input = await colourImagePdf({
      components: 3,
      size: 8,
      pages: 2,
      pad: (30 * KB) / 4,
    });
    const calls: Call[] = [];
    const run = await runCompression(
      input,
      deep({ targetDpi: 150, targetBytes: 25 * KB }),
      gsDeps(playedGs(calls)),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.output).toBe(input);
    expect(run.meta.target).toMatchObject({ met: false, dpi: null });
  });
});

describe("the composed chain: engine → processor → job record → browser", () => {
  it("the target block reaches the job record the client reads, met and not met", async () => {
    const input = await INPUT;
    for (const [targetBytes, met] of [
      [130 * KB, true],
      [40 * KB, false],
    ] as const) {
      const processor = createCompressionProcessor(gsDeps(playedGs([])));
      const result = await processor.process({
        tool: "compress-pdf",
        options: { profile: "deep", targetDpi: 150, targetBytes },
        inputs: [
          {
            fileId: "f1",
            filename: "scan.pdf",
            contentType: "application/pdf",
            bytes: input,
          },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      // Through the one persistence boundary every write path funnels through.
      const onRecord = sanitizeJobResults(result.results);
      const bytes = result.artifacts[0]!.bytes.byteLength;
      expect(onRecord?.compression?.target).toEqual({
        targetBytes,
        met,
        attempts: met ? 3 : 1,
        outputBytes: bytes,
      });
    }
  });

  it("the record boundary refuses a block that claims met over the target", () => {
    const clean = sanitizeJobResults({
      compression: {
        pageCheck: "verified",
        pagesIn: 2,
        pagesOut: 2,
        target: {
          targetBytes: 100 * KB,
          met: true,
          attempts: 2,
          outputBytes: 100 * KB + 1,
        },
      },
    });
    expect(clean?.compression?.target?.met).toBe(false);
    // Control: the same block, honestly under, keeps its verdict.
    const honest = sanitizeJobResults({
      compression: {
        pageCheck: "verified",
        pagesIn: 2,
        pagesOut: 2,
        target: {
          targetBytes: 100 * KB,
          met: true,
          attempts: 2,
          outputBytes: 100 * KB,
        },
      },
    });
    expect(honest?.compression?.target?.met).toBe(true);
  });

  it("a run without a target carries no target block (today's record, unchanged)", async () => {
    const processor = createCompressionProcessor(gsDeps(playedGs([])));
    const result = await processor.process({
      tool: "compress-pdf",
      options: { profile: "deep", targetDpi: 150 },
      inputs: [
        {
          fileId: "f1",
          filename: "scan.pdf",
          contentType: "application/pdf",
          bytes: await INPUT,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const onRecord = sanitizeJobResults(result.results);
      expect(onRecord?.compression).toBeDefined();
      expect(onRecord?.compression).not.toHaveProperty("target");
    }
  });
});
