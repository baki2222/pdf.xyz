import { describe, expect, it, vi } from "vitest";
import { runPdfToPdfA, type GhostscriptPdfARunner } from "./engine";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const NOT_PDF = new TextEncoder().encode("not a pdf");

function runner(output = PDF): GhostscriptPdfARunner {
  return { convertToPdfA: vi.fn(async () => ({ bytes: output, notes: [] })) };
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
    const gs = runner(
      new TextEncoder().encode(
        "%PDF-1.7\n1 0 obj<<>>endobj\npdfa\ntrailer<<>>\n%%EOF\n",
      ),
    );
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
    ).resolves.toMatchObject({ ok: false, kind: "failed" });

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
        bytes: PDF,
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
