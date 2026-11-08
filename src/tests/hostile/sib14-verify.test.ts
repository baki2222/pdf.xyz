// SIB-14 adversarial verification: header-only "%PDF-1.7\n" through the
// signature counter and the two compress entry points that call it.
import { describe, expect, it } from "vitest";

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const HEADER_ONLY = () => latin1("%PDF-1.7\n");

async function caught(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe("SIB-14 header-only PDF", () => {
  it(
    "pdf-lib loads it and countSignatures throws a raw TypeError",
    { timeout: 15_000 },
    async () => {
      const { loadPdfLib } = await import("@/lib/pdf/pdf-lib");
      const { loadPdf } = await import("@/lib/pdf/engine");
      const { countSignatures } = await import("@/lib/pdf/signed");
      const lib = await loadPdfLib();
      const doc = await loadPdf(HEADER_ONLY());
      const err = await caught(() => countSignatures(lib, doc));
      expect(err).toBeInstanceOf(TypeError);
      expect((err as Error).message).toMatch(/reading 'get'/);
    },
  );

  it(
    "analyzePdf surfaces the raw TypeError text through errorMessage",
    { timeout: 15_000 },
    async () => {
      const { analyzePdf } = await import("@/lib/pdf/analyze");
      const { errorMessage } =
        await import("@/components/tools/runner/runner-kit");
      const err = await caught(() => analyzePdf(HEADER_ONLY()));
      expect(err).toBeInstanceOf(TypeError);
      expect(errorMessage(err)).toMatch(/Cannot read properties of undefined/);
    },
  );

  it(
    "UI single-file gate (readPageBoard pdf-lib) fails BEFORE analyzePdf: what message?",
    { timeout: 15_000 },
    async () => {
      const { readPageBoard } =
        await import("@/components/tools/runner/use-single-pdf");
      const { errorMessage } =
        await import("@/components/tools/runner/runner-kit");
      const err = await caught(() => readPageBoard(HEADER_ONLY(), "pdf-lib"));
      expect(err).toBeDefined();
      // Recorded as an expectation so the run prints it on mismatch.
      expect({
        name: (err as Error).constructor.name,
        ui: errorMessage(err),
      }).toEqual({
        name: "TypeError",
        ui: expect.stringMatching(/Cannot read properties of undefined/),
      });
    },
  );

  it(
    "UI batch row (compressBatchFile) shows the raw TypeError text",
    { timeout: 15_000 },
    async () => {
      const { compressBatchFile } =
        await import("@/components/tools/runner/compress-batch");
      const { errorMessage } =
        await import("@/components/tools/runner/runner-kit");
      const file = new File([HEADER_ONLY()], "header-only.pdf", {
        type: "application/pdf",
      });
      const err = await caught(() => compressBatchFile(file));
      expect({
        name: (err as Error).constructor.name,
        ui: errorMessage(err),
      }).toEqual({
        name: "TypeError",
        ui: expect.stringMatching(
          /Cannot read properties of undefined \(reading 'get'\)/,
        ),
      });
    },
  );

  it(
    "optimizeLossless surfaces the raw TypeError",
    { timeout: 15_000 },
    async () => {
      const { optimizeLossless } = await import("@/lib/pdf/analyze");
      const err = await caught(() => optimizeLossless(HEADER_ONLY()));
      expect(err).toBeInstanceOf(TypeError);
    },
  );
});
