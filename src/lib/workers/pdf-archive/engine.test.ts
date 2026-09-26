import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  GhostscriptRunError,
  runPdfToPdfA,
  type GhostscriptFailureReason,
  type GhostscriptPdfARunner,
} from "./engine";
import { inspectPdfAMarkers } from "./pdfa-markers";
import {
  buildPdfAFixture,
  declaredPdfA,
  withoutOutputIntent,
} from "@/tests/pdfa-fixtures";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const NOT_PDF = new TextEncoder().encode("not a pdf");

/**
 * What a working conversion returns: a PDF that DECLARES PDF/A-2b. Every
 * success case below used to hand the engine `PDF` (a bare `%PDF-` stub) as
 * the "converted" output, and the engine shipped it — which is exactly the
 * defect: nothing between Ghostscript and the user asked whether the file
 * said PDF/A at all.
 */
let DECLARED: Uint8Array;
beforeAll(async () => {
  DECLARED = await declaredPdfA();
});

function runner(output?: Uint8Array): GhostscriptPdfARunner {
  return {
    convertToPdfA: vi.fn(async () => ({
      bytes: output ?? DECLARED,
      notes: [],
    })),
  };
}

describe("pdf-archive engine", () => {
  it("reports unsupported without Ghostscript", async () => {
    await expect(runPdfToPdfA(PDF, {})).resolves.toMatchObject({
      ok: false,
      kind: "unsupported",
    });
  });

  it("rejects non-PDF input before invoking Ghostscript", async () => {
    const gs = runner();
    await expect(
      runPdfToPdfA(NOT_PDF, { ghostscript: gs }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "invalid_pdf",
    });
    expect(gs.convertToPdfA).not.toHaveBeenCalled();
  });

  it("enforces max input size", async () => {
    await expect(
      runPdfToPdfA(PDF, {
        ghostscript: runner(),
        limits: { maxInputBytes: 4 },
      }),
    ).resolves.toMatchObject({ ok: false, kind: "too_large", limitBytes: 4 });
  });

  it("converts valid PDFs and returns bounded metadata", async () => {
    // INVERTED: this case once fed the engine the bytes
    // "%PDF-1.7 … pdfa … %%EOF" as a successful PDF/A output and asserted
    // `ok: true`. That pinned the defect — a file with no PDF/A declaration
    // passed. The output here now declares PDF/A-2b; the one that does not is
    // refused below.
    const gs = runner();
    const result = await runPdfToPdfA(PDF, { ghostscript: gs });
    expect(result).toMatchObject({
      ok: true,
      meta: {
        engine: "ghostscript",
        standard: "PDF/A-2b",
        inputBytes: PDF.byteLength,
      },
    });
    expect(gs.convertToPdfA).toHaveBeenCalledWith(PDF, {
      standard: "PDF/A-2b",
    });
  });

  it("fails honestly when Ghostscript throws or output is not a PDF", async () => {
    await expect(
      runPdfToPdfA(PDF, {
        ghostscript: {
          convertToPdfA: vi.fn(async () => {
            throw new Error("boom");
          }),
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "failed",
      // An untyped throw is NOT assumed transient: nothing says the same bytes
      // would fare better, and a retry holds the serial worker.
      reason: "engine_exit",
    });

    await expect(
      runPdfToPdfA(PDF, { ghostscript: runner(NOT_PDF) }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "failed",
    });
  });
});

describe("what the conversion removed is reported, not discarded", () => {
  it("carries Ghostscript's notes onto the result meta", async () => {
    // The real production output, verbatim: gs 10.00.0, production argv, a
    // one-page PDF with transparency. Exit 0, valid file, metadata gone.
    const gsRunner = {
      convertToPdfA: vi.fn(async () => ({
        bytes: DECLARED,
        notes: [
          "Text string detected in DOCINFO cannot be represented in XMP for PDF/A1, discarding DOCINFO",
        ],
      })),
    };
    const run = await runPdfToPdfA(PDF, { ghostscript: gsRunner });

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    // A conversion that discarded something is NOT a failure: PDF/A cannot hold
    // what was removed, the user asked for PDF/A, and the file is correct.
    expect(run.meta.hadNotes).toBe(true);
    expect(run.meta.notes).toEqual([
      "Text string detected in DOCINFO cannot be represented in XMP for PDF/A1, discarding DOCINFO",
    ]);
  });

  it("reports a silent conversion as silent rather than as unknown", async () => {
    const run = await runPdfToPdfA(PDF, { ghostscript: runner() });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.hadNotes).toBe(false);
    expect(run.meta.notes).toEqual([]);
  });
});

describe("an output that does not DECLARE PDF/A-2b is never shipped as PDF/A", () => {
  it("refuses the pre-fix shape: part 2 in the XMP, no OutputIntent", async () => {
    // Fails against the pre-fix engine: its only output check was
    // `looksLikePdf`, so this file — a valid PDF whose PDF/A claim no validator
    // accepts — came back `ok: true` and was handed to the user as PDF/A-2b.
    const run = await runPdfToPdfA(PDF, {
      ghostscript: runner(await withoutOutputIntent()),
    });
    expect(run).toMatchObject({
      ok: false,
      kind: "failed",
      reason: "not_pdfa",
    });
    if (run.ok || run.kind !== "failed") return;
    expect(run.message).toMatch(/PDF\/A-2b/);
  });

  it.each([
    ["claims PDF/A-1", { xmp: { part: "1" } }],
    ["claims conformance U", { xmp: { conformance: "U" } }],
    ["has no XMP at all", { xmp: null }],
    ["has an intent with no ICC profile", { intent: "no-profile" as const }],
  ])("refuses an output that %s", async (_label, opts) => {
    const run = await runPdfToPdfA(PDF, {
      ghostscript: runner(await buildPdfAFixture(opts)),
    });
    expect(run).toMatchObject({ ok: false, reason: "not_pdfa" });
  });

  it("asks the question of the OUTPUT, after the PDF check, every time", async () => {
    const inspectOutput = vi.fn(inspectPdfAMarkers);
    const output = await declaredPdfA();
    const run = await runPdfToPdfA(PDF, {
      ghostscript: runner(output),
      inspectOutput,
    });
    expect(run.ok).toBe(true);
    expect(inspectOutput).toHaveBeenCalledTimes(1);
    expect(inspectOutput).toHaveBeenCalledWith(output);
    // Health check: the input (a bare stub) is not what was inspected.
    expect(inspectOutput.mock.calls[0]![0]).not.toBe(PDF);
  });
});

describe("the runner's failure reason reaches the run", () => {
  function throwing(reason: GhostscriptFailureReason): GhostscriptPdfARunner {
    return {
      convertToPdfA: vi.fn(async () => {
        throw new GhostscriptRunError(reason, "x");
      }),
    };
  }

  it.each([
    ["engine_exit", { kind: "failed", reason: "engine_exit" }],
    ["timeout", { kind: "failed", reason: "timeout" }],
    ["bad_output", { kind: "failed", reason: "bad_output" }],
    ["io", { kind: "failed", reason: "transient" }],
    ["spawn", { kind: "failed", reason: "transient" }],
    ["password_required", { kind: "password_required" }],
  ] as const)("%s", async (reason, expected) => {
    const run = await runPdfToPdfA(PDF, { ghostscript: throwing(reason) });
    expect(run).toMatchObject({ ok: false, ...expected });
  });

  it("points an open-password PDF at Unlock PDF", async () => {
    const run = await runPdfToPdfA(PDF, {
      ghostscript: throwing("password_required"),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.message).toMatch(/Unlock PDF/);
  });
});
