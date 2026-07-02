import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  DEEP_COMPRESSION_TOOLS,
  looksLikePdf,
  parseCompressionOptions,
  planCompression,
  probeCompressionTools,
  runCompression,
  type ToolAvailability,
} from "./engine";

/** Minimal, structurally-valid PDF bytes (header + trailer) for deep-path fakes. */
function tinyPdf(pad = 40): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(pad)}\n%%EOF\n`);
}

async function makePdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save();
}

const noTools: ToolAvailability = {
  ghostscript: false,
  qpdf: false,
  mutool: false,
};

describe("parseCompressionOptions", () => {
  it("defaults to the deep profile at 150 DPI", () => {
    const result = parseCompressionOptions({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profile).toBe("deep");
      expect(result.value.targetDpi).toBe(150);
    }
  });

  it("accepts an explicit lossless profile and DPI", () => {
    const result = parseCompressionOptions({ profile: "lossless", targetDpi: 300 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profile).toBe("lossless");
      expect(result.value.targetDpi).toBe(300);
    }
  });

  it("rejects an unknown profile", () => {
    const result = parseCompressionOptions({ profile: "extreme" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.body.error.code).toBe("invalid_request");
  });

  it("rejects an out-of-range or non-integer DPI", () => {
    expect(parseCompressionOptions({ targetDpi: 50 }).ok).toBe(false);
    expect(parseCompressionOptions({ targetDpi: 1200 }).ok).toBe(false);
    expect(parseCompressionOptions({ targetDpi: 96.5 }).ok).toBe(false);
    expect(parseCompressionOptions({ targetDpi: 300 }).ok).toBe(true);
  });
});

describe("probeCompressionTools", () => {
  it("reports availability from the injected resolver only", () => {
    const tools = probeCompressionTools((bin) => bin === "qpdf");
    expect(tools).toEqual({ ghostscript: false, qpdf: true, mutool: false });
  });
});

describe("planCompression", () => {
  it("always supports lossless via the JS repacker", () => {
    const plan = planCompression({ profile: "lossless", targetDpi: 150 }, noTools);
    expect(plan).toEqual({ supported: true, engine: "lossless-js" });
  });

  it("picks the first available native engine for deep", () => {
    const plan = planCompression(
      { profile: "deep", targetDpi: 150 },
      { ghostscript: false, qpdf: true, mutool: true },
    );
    expect(plan.supported && plan.engine).toBe("qpdf");
  });

  it("prefers ghostscript when several engines are available", () => {
    const plan = planCompression(
      { profile: "deep", targetDpi: 150 },
      { ghostscript: true, qpdf: true, mutool: true },
    );
    expect(plan.supported && plan.engine).toBe("ghostscript");
  });

  it("reports unsupported deep when no native engine is installed", () => {
    const plan = planCompression({ profile: "deep", targetDpi: 150 }, noTools);
    expect(plan.supported).toBe(false);
    if (!plan.supported) expect(plan.requires).toEqual(DEEP_COMPRESSION_TOOLS);
  });
});

describe("runCompression", () => {
  it("really repacks a PDF losslessly and reports honest metrics", async () => {
    const input = await makePdf(5);
    const run = await runCompression(
      input,
      { profile: "lossless", targetDpi: 150 },
      { tools: noTools },
    );
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.meta.engine).toBe("lossless-js");
      expect(run.meta.profile).toBe("lossless");
      expect(run.output.byteLength).toBeGreaterThan(0);
      expect(run.meta.savedBytes).toBeGreaterThanOrEqual(0);
      expect(run.meta.savedRatio).toBeGreaterThanOrEqual(0);
      const reloaded = await PDFDocument.load(run.output);
      expect(reloaded.getPageCount()).toBe(5);
    }
  });

  it("reports invalid_pdf for non-PDF bytes on the lossless path", async () => {
    const run = await runCompression(
      new Uint8Array([1, 2, 3, 4]),
      { profile: "lossless", targetDpi: 150 },
      { tools: noTools },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("invalid_pdf");
  });

  it("never fakes deep compression when no native engine exists", async () => {
    const run = await runCompression(
      await makePdf(),
      { profile: "deep", targetDpi: 150 },
      { tools: noTools },
    );
    expect(run.ok).toBe(false);
    if (!run.ok && run.kind === "unsupported") {
      expect(run.requires).toContain("ghostscript");
    } else {
      throw new Error("expected an unsupported result");
    }
  });

  it("runs the deep path through an available native engine", async () => {
    const input = await makePdf();
    // A real, structurally-valid PDF that is smaller than the input — the genuine
    // deep-compression win case.
    const fakeOutput = tinyPdf();
    let calledWith: string | null = null;
    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      {
        tools: { ghostscript: true, qpdf: false, mutool: false },
        native: async (_bytes, ctx) => {
          calledWith = ctx.engine;
          return fakeOutput;
        },
      },
    );
    expect(calledWith).toBe("ghostscript");
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.meta.engine).toBe("ghostscript");
      expect(run.output).toBe(fakeOutput);
      expect(run.meta.savedBytes).toBe(input.byteLength - fakeOutput.byteLength);
    }
  });

  it("rejects unreadable deep output as an honest failed run (never a fake artifact)", async () => {
    const run = await runCompression(
      await makePdf(),
      { profile: "deep", targetDpi: 150 },
      {
        tools: { ghostscript: true, qpdf: false, mutool: false },
        // A wired engine that returns bytes which are not a valid PDF.
        native: async () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
      },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });

  it("never returns a file larger than the input (no-worse policy returns the original)", async () => {
    const input = await makePdf(2);
    // A valid PDF, but LARGER than the input — deep compression backfired.
    const bigger = tinyPdf(input.byteLength + 512);
    expect(bigger.byteLength).toBeGreaterThan(input.byteLength);
    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      {
        tools: { ghostscript: false, qpdf: true, mutool: false },
        native: async () => bigger,
      },
    );
    expect(run.ok).toBe(true);
    if (run.ok) {
      // The original bytes are returned unchanged, with honest zero-savings.
      expect(run.output).toBe(input);
      expect(run.meta.engine).toBe("qpdf");
      expect(run.meta.savedBytes).toBe(0);
      expect(run.meta.savedRatio).toBe(0);
      expect(run.meta.outputBytes).toBe(input.byteLength);
    }
  });

  it("rejects a deep input larger than the configured limit as too_large", async () => {
    const input = await makePdf(3);
    let spawned = false;
    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      {
        tools: { ghostscript: true, qpdf: false, mutool: false },
        limits: { maxInputBytes: 8 },
        native: async () => {
          spawned = true;
          return tinyPdf();
        },
      },
    );
    expect(run.ok).toBe(false);
    if (!run.ok && run.kind === "too_large") {
      expect(run.limitBytes).toBe(8);
    } else {
      throw new Error("expected a too_large result");
    }
    // The oversized input never reached the engine.
    expect(spawned).toBe(false);
  });

  it("does not apply the input-size limit to the lossless path", async () => {
    const input = await makePdf(3);
    const run = await runCompression(
      input,
      { profile: "lossless", targetDpi: 150 },
      { tools: noTools, limits: { maxInputBytes: 8 } },
    );
    // Lossless (in-process pdf-lib) is intentionally unaffected by the deep limit.
    expect(run.ok).toBe(true);
  });

  it("classifies a native engine crash as an honest failure", async () => {
    const run = await runCompression(
      await makePdf(),
      { profile: "deep", targetDpi: 150 },
      {
        tools: { ghostscript: true, qpdf: false, mutool: false },
        native: async () => {
          throw new Error("boom");
        },
      },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});

describe("looksLikePdf", () => {
  it("accepts bytes with a %PDF- header and a %%EOF trailer", () => {
    expect(looksLikePdf(tinyPdf())).toBe(true);
  });

  it("accepts a genuine pdf-lib document", async () => {
    expect(looksLikePdf(await makePdf(2))).toBe(true);
  });

  it("rejects empty, too-short, headerless, or trailerless bytes", () => {
    expect(looksLikePdf(new Uint8Array(0))).toBe(false);
    expect(looksLikePdf(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(looksLikePdf(new TextEncoder().encode("plainly not a pdf, no markers here at all"))).toBe(
      false,
    );
    // Header but no trailer.
    expect(looksLikePdf(new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(64)}`))).toBe(false);
  });
});
