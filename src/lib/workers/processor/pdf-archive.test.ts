import { describe, expect, it, vi } from "vitest";
import { createPdfArchiveProcessor, pdfaOutputName } from "./pdf-archive";
import { PDF_ARCHIVE_PASSWORD_REQUIRED_CODE } from "../pdf-archive/contract";
import {
  GhostscriptRunError,
  type GhostscriptFailureReason,
} from "../pdf-archive/engine";
import {
  createNativeGhostscriptPdfARunner,
  type GhostscriptExecResult,
} from "../pdf-archive/native";
import { resolveNativePdfArchiveConfig } from "../pdf-archive/native-config";
import { declaredPdfA } from "@/tests/pdfa-fixtures";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

function input(tool = "pdf-to-pdfa") {
  return {
    tool,
    options: {},
    inputs: [
      {
        fileId: "file_1",
        filename: "report.final.pdf",
        contentType: "application/pdf",
        bytes: PDF,
      },
    ],
  };
}

describe("pdf-archive processor", () => {
  it("registers pdf-to-pdfa and reports readiness from Ghostscript", () => {
    const processor = createPdfArchiveProcessor({
      ghostscript: { convertToPdfA: vi.fn() },
    });
    expect(processor.tools).toEqual(["pdf-to-pdfa"]);
    expect(processor.supports("pdf-to-pdfa")).toBe(true);
    expect(processor.capability()).toMatchObject({
      id: "pdf-archive",
      ready: true,
    });
  });

  it("fails honestly without Ghostscript", async () => {
    const result = await createPdfArchiveProcessor({}).process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_implemented");
  });

  it("converts one PDF and names output safely", async () => {
    // The engine's output must DECLARE PDF/A-2b now; a bare `%PDF-` stub is
    // refused (see "not_pdfa" in engine.test.ts), as it should always have been.
    const output = await declaredPdfA();
    const processor = createPdfArchiveProcessor({
      ghostscript: {
        convertToPdfA: vi.fn(async () => ({ bytes: output, notes: [] })),
      },
    });
    const result = await processor.process(input());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifacts[0]?.filename).toBe("report.final-pdfa.pdf");
      expect(result.meta).toMatchObject({
        engine: "ghostscript",
        standard: "PDF/A-2b",
      });
    }
  });

  it("requires exactly one PDF input", async () => {
    const result = await createPdfArchiveProcessor({
      ghostscript: { convertToPdfA: vi.fn() },
    }).process({
      tool: "pdf-to-pdfa",
      options: {},
      inputs: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unprocessable_entity");
  });

  it("builds deterministic output names", () => {
    expect(pdfaOutputName("very.long.name.pdf")).toBe(
      "very.long.name-pdfa.pdf",
    );
  });
});

describe("retryable means the SAME BYTES might succeed", () => {
  // WAS: every `failed` run mapped to `retryable: true`. The executor then ran
  // the job up to three times (2 s, 8 s back-off) on the single serial worker:
  // an open-password PDF failed identically three times and ended in "could not
  // process this file"; a file that hit the 120 s Ghostscript timeout held the
  // worker for ~6 minutes, stalling every other tool for every user.
  function throwing(reason: GhostscriptFailureReason) {
    return createPdfArchiveProcessor({
      ghostscript: {
        convertToPdfA: vi.fn(async () => {
          throw new GhostscriptRunError(reason, "x");
        }),
      },
    });
  }

  it.each([
    ["engine_exit", false],
    ["timeout", false],
    ["bad_output", false],
    ["password_required", false],
    // POSITIVE CONTROL: a failure that is about the worker, not the file, is
    // still retried. Without these the table could pass by making nothing
    // retryable at all.
    ["io", true],
    ["spawn", true],
  ] as const)("%s → retryable %s", async (reason, retryable) => {
    const result = await throwing(reason).process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.retryable).toBe(retryable);
  });

  it("an open-password PDF gets its own code, so the panel can point at Unlock PDF", async () => {
    const result = await throwing("password_required").process(input());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(PDF_ARCHIVE_PASSWORD_REQUIRED_CODE);
    expect(result.error.message).toMatch(/Unlock PDF/);
  });

  it("an output that does not declare PDF/A is refused, and not retried", async () => {
    const processor = createPdfArchiveProcessor({
      ghostscript: {
        convertToPdfA: vi.fn(async () => ({ bytes: PDF, notes: [] })),
      },
    });
    const result = await processor.process(input());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.retryable).toBe(false);
  });
});

describe("COMPOSED: the real native runner, through the engine, to the job error", () => {
  // The typed reason is born in native.ts, carried by engine.ts, and decided on
  // here. Each hop has its own test; this one runs the chain, with only the
  // process and filesystem stubbed.
  const config = resolveNativePdfArchiveConfig({});

  function processorWhoseExecReturns(
    gs: GhostscriptExecResult,
    qpdf: GhostscriptExecResult = { code: 2, timedOut: false },
  ) {
    const exec = vi.fn(async (command: string) =>
      command === config.qpdfBinary ? qpdf : gs,
    );
    const ghostscript = createNativeGhostscriptPdfARunner(config, {
      resolveOnPath: () => true,
      fileExists: () => true,
      exec,
      fs: {
        mkdtemp: vi.fn(async () => "/tmp/pdfxyz-pdfa-1"),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => PDF),
        rm: vi.fn(async () => {}),
      },
    });
    return createPdfArchiveProcessor({ ghostscript });
  }

  it("Ghostscript exit 1 → failed, NOT retryable", async () => {
    const result = await processorWhoseExecReturns({
      code: 1,
      timedOut: false,
    }).process(input());
    expect(result).toMatchObject({
      ok: false,
      error: { code: "internal_error", retryable: false },
    });
  });

  it("Ghostscript timed out → failed, NOT retryable", async () => {
    const result = await processorWhoseExecReturns({
      code: -1,
      timedOut: true,
    }).process(input());
    expect(result).toMatchObject({ ok: false, error: { retryable: false } });
    if (!result.ok) expect(result.error.message).toMatch(/ran out of time/);
  });

  it("Ghostscript exit 1 on an open-password PDF → password_required", async () => {
    const result = await processorWhoseExecReturns(
      { code: 1, timedOut: false },
      { code: 0, timedOut: false },
    ).process(input());
    expect(result).toMatchObject({
      ok: false,
      error: { code: PDF_ARCHIVE_PASSWORD_REQUIRED_CODE, retryable: false },
    });
  });

  it("POSITIVE CONTROL: Ghostscript never started → retryable", async () => {
    const result = await processorWhoseExecReturns({
      code: -1,
      timedOut: false,
      spawnError: "EAGAIN",
    }).process(input());
    expect(result).toMatchObject({ ok: false, error: { retryable: true } });
  });
});
