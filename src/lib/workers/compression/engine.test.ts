import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { countPdfPagesDetailed } from "@/lib/pdf/page-count";
import { encryptPdf } from "@/tests/encrypted-pdf";
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
/**
 * Bytes SHAPED like a PDF — `%PDF-` header, `%%EOF` trailer, rubble between.
 *
 * Renamed from `tinyPdf` on 2026-08-11. It was called a PDF, and two tests
 * described it in comments as "a real, structurally-valid PDF"; it has no page
 * tree and pdf-lib cannot open it. The page-count gate failed both of those
 * tests the moment it was added, which is how the misdescription surfaced. The
 * name now says what it is, and it is used only where header-and-trailer rubble
 * is the POINT — chiefly in proving what `looksLikePdf` cannot see.
 */
function pdfShapedBytes(pad = 40): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(pad)}\n%%EOF\n`);
}

async function makePdf(
  pages = 3,
  opts: { withText?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = opts.withText
    ? await doc.embedFont(StandardFonts.Helvetica)
    : undefined;
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200, 200]);
    if (font) {
      for (let line = 0; line < 8; line += 1) {
        page.drawText(`content line ${line}`, {
          x: 10,
          y: 180 - line * 20,
          size: 9,
          font,
        });
      }
    }
  }
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
    const result = parseCompressionOptions({
      profile: "lossless",
      targetDpi: 300,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profile).toBe("lossless");
      expect(result.value.targetDpi).toBe(300);
    }
  });

  it("rejects an unknown profile", () => {
    const result = parseCompressionOptions({ profile: "extreme" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.body.error.code).toBe("invalid_request");
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
    const plan = planCompression(
      { profile: "lossless", targetDpi: 150 },
      noTools,
    );
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
    const input = await makePdf(3, { withText: true });
    // A real, structurally-valid PDF: SAME page count, fewer bytes — the genuine
    // deep-compression win case, and the only shape that should pass the gate.
    const fakeOutput = await makePdf(3);
    expect(fakeOutput.byteLength).toBeLessThan(input.byteLength);
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
      expect(run.meta.savedBytes).toBe(
        input.byteLength - fakeOutput.byteLength,
      );
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
    // Larger than the input, so the no-worse policy swaps the ORIGINAL back in
    // and the page check runs on that. These bytes are never counted, which is
    // why rubble is still an honest fixture here.
    const bigger = pdfShapedBytes(input.byteLength + 512);
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
          return pdfShapedBytes();
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
    expect(looksLikePdf(pdfShapedBytes())).toBe(true);
  });

  it("accepts a genuine pdf-lib document", async () => {
    expect(looksLikePdf(await makePdf(2))).toBe(true);
  });

  it("rejects empty, too-short, headerless, or trailerless bytes", () => {
    expect(looksLikePdf(new Uint8Array(0))).toBe(false);
    expect(looksLikePdf(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(
      looksLikePdf(
        new TextEncoder().encode("plainly not a pdf, no markers here at all"),
      ),
    ).toBe(false);
    // Header but no trailer.
    expect(
      looksLikePdf(new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(64)}`)),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The page-count gate (TASK-49)
// ---------------------------------------------------------------------------

describe("deep compression is rejected when it loses pages", () => {
  it("refuses a 200-page input that comes back as 3 pages", async () => {
    // The measured defect, reproduced. Before the gate this returned ok:true
    // with savedRatio 98.1% — the more pages the engine destroyed, the better
    // the run reported it had gone.
    const input = await makePdf(200, { withText: true });
    const gutted = await makePdf(3);

    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      {
        tools: { ghostscript: true, qpdf: false, mutool: false },
        native: async () => gutted,
      },
    );

    expect(run.ok).toBe(false);
    if (run.ok || run.kind !== "page_loss")
      throw new Error("expected page_loss");
    expect(run.pagesIn).toBe(200);
    expect(run.pagesOut).toBe(3);
    // The numbers are in the failure because "it lost pages" without saying how
    // many is not something a user can act on.
    expect(run.message).toMatch(/missing pages/i);
  });

  it("accepts an output that GAINED pages, and says so", async () => {
    // `>=`, not `===`. A native engine repairing a damaged xref can recover
    // pages pdf-lib could not reach; that is the best available outcome, and a
    // strict equality gate would reject it.
    const input = await makePdf(3, { withText: true });
    const recovered = await makePdf(5);

    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      {
        tools: { ghostscript: true, qpdf: false, mutool: false },
        native: async () => recovered,
      },
    );

    // The recovered file is larger, so the no-worse policy returns the original
    // — and the check then runs on THAT, which is the artifact the user gets.
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.pageCheck).toBe("verified");
  });
});

describe("the gate's unknowns are asymmetric on purpose", () => {
  it("FAILS when the OUTPUT cannot be counted, even though looksLikePdf passes", async () => {
    // We produced that file and `looksLikePdf` blessed it, and our own parser
    // cannot find its page tree. That is evidence against the artifact, not
    // missing information.
    const input = await makePdf(4, { withText: true });
    const rubble = pdfShapedBytes(64);
    expect(looksLikePdf(rubble)).toBe(true);

    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      {
        tools: { ghostscript: true, qpdf: false, mutool: false },
        native: async () => rubble,
      },
    );

    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });

  it("SHIPS but stamps `unverified` when the INPUT is above the parse ceiling", async () => {
    // Failing here would break the largest files a user has — the pressure that
    // ends with the gate being deleted. The file ships; the CLAIM does not.
    const input = await makePdf(6, { withText: true });
    const smaller = await makePdf(6);

    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      {
        tools: { ghostscript: true, qpdf: false, mutool: false },
        native: async () => smaller,
        // Ceiling below the input but above the output: the input cannot be
        // counted, the output can.
        limits: { maxPageCountParseBytes: smaller.byteLength },
      },
    );

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.pageCheck).toBe("unverified");
    expect(run.meta.pagesIn).toBeNull();
    expect(run.meta.pagesOut).toBe(6);
  });

  it("marks the LOSSLESS path not-applicable rather than unverified", async () => {
    // The in-browser repack re-serializes a parsed document; it cannot lose
    // pages. Calling that "unverified" would invite a caveat on the one path
    // that never needed one.
    const run = await runCompression(
      await makePdf(3, { withText: true }),
      { profile: "lossless", targetDpi: 150 },
      { tools: { ghostscript: false, qpdf: false, mutool: false } },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.pageCheck).toBe("not-applicable");
  });
});

describe("an encrypted input the page check cannot read (restricted, object streams)", () => {
  /**
   * A permissions-only PDF from a modern producer — the bank statement or
   * e-invoice Compress now offers to the worker. Its page tree lives in an
   * ENCRYPTED object stream, which pdf-lib does not decrypt, so the page check
   * cannot count it even with `ignoreEncryption`.
   *
   * Until 2026-09-27 the no-shrink branch swapped the ORIGINAL back in and then
   * failed the job because that original could not be counted: the person was
   * told "The compression engine produced an unreadable PDF." about their own
   * intact file. The classic-xref fixture could not see it — its page tree is
   * plaintext — so this uses the object-stream layout.
   */
  async function restrictedModernPdf(): Promise<Uint8Array> {
    return encryptPdf(await makePdf(3, { withText: true }), {
      userPassword: "",
      ownerPassword: "owner-secret",
      objectStreams: true,
    });
  }
  const deepGs = {
    tools: { ghostscript: true, qpdf: false, mutool: false },
  } as const;

  it("health check: the fixture is one the page check really cannot count, and a PDF by every other measure", async () => {
    const input = await restrictedModernPdf();
    expect(looksLikePdf(input)).toBe(true);
    expect(
      await countPdfPagesDetailed(input, Number.POSITIVE_INFINITY),
    ).toEqual({ ok: false, unknown: "unparseable" });
  });

  it("no shrink: hands back the person's ORIGINAL as unverified, never 'unreadable'", async () => {
    const input = await restrictedModernPdf();
    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      // The engine could not make it smaller (a text-only statement).
      { ...deepGs, native: async (bytes) => bytes.slice() },
    );
    expect(run.ok ? "ok" : `${run.kind}: ${run.message}`).toBe("ok");
    if (!run.ok) return;
    expect(run.output).toBe(input);
    expect(run.meta.savedBytes).toBe(0);
    // Nothing was proven about the pages, and the verdict says so.
    expect(run.meta.pageCheck).toBe("unverified");
    expect(run.meta.pagesIn).toBeNull();
    expect(run.meta.pagesOut).toBeNull();
  });

  it("shrink to a readable file: ships as unverified, with the output's own page count", async () => {
    const input = await restrictedModernPdf();
    const smaller = await makePdf(3);
    expect(smaller.byteLength).toBeLessThan(input.byteLength);
    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      { ...deepGs, native: async () => smaller },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.output).toBe(smaller);
    expect(run.meta.pageCheck).toBe("unverified");
    expect(run.meta.pagesOut).toBe(3);
  });

  it("control: output the ENGINE made that cannot be counted still fails — the exemption is for the original only", async () => {
    const input = await restrictedModernPdf();
    const rubble = pdfShapedBytes(64);
    expect(rubble.byteLength).toBeLessThan(input.byteLength);
    expect(looksLikePdf(rubble)).toBe(true);
    const run = await runCompression(
      input,
      { profile: "deep", targetDpi: 150 },
      { ...deepGs, native: async () => rubble },
    );
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});
