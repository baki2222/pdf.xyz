import { describe, expect, it } from "vitest";
import { provesPptxPresentationChain } from "./capability";
import type { runPdfOfficeExport } from "./engine";
import { pptxBefore20260927 } from "@/tests/pptx-before-2026-09-27";

type Run = typeof runPdfOfficeExport;

/** A stand-in engine that returns whatever package it is given. */
function engineReturning(make: () => Promise<Uint8Array>): Run {
  return async (tool, input) => {
    const output = await make();
    return {
      ok: true,
      output,
      filenameExt: "pptx",
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      meta: {
        engine: "pdftotext-office-openxml",
        tool,
        pageCount: 3,
        inputBytes: input.byteLength,
        outputBytes: output.byteLength,
        characterCount: 0,
      },
      coverage: {
        pageCount: 3,
        textPageCount: 2,
        pagesWithoutText: [2],
        littleTextPageCount: 0,
        pagesWithLittleText: [],
      },
    };
  };
}

describe("provesPptxPresentationChain", () => {
  it("is true for the engine in this tree", async () => {
    await expect(provesPptxPresentationChain()).resolves.toBe(true);
  });

  it("NEGATIVE CONTROL: is false for the engine as it was before 2026-09-27", async () => {
    // The image that was running when PowerPoint refused every export. If the
    // probe said `true` here, the heartbeat would certify exactly that worker.
    const before = engineReturning(() =>
      pptxBefore20260927([
        { pageNumber: 1, text: "Capability probe", characterCount: 16 },
        { pageNumber: 2, text: "", characterCount: 0 },
        { pageNumber: 3, text: "Third page", characterCount: 10 },
      ]),
    );
    await expect(provesPptxPresentationChain(before)).resolves.toBe(false);
  });

  it("is false when the engine refuses or throws", async () => {
    const refuses: Run = async () => ({
      ok: false,
      kind: "failed",
      message: "no",
    });
    const throws: Run = async () => {
      throw new Error("engine missing");
    };
    await expect(provesPptxPresentationChain(refuses)).resolves.toBe(false);
    await expect(provesPptxPresentationChain(throws)).resolves.toBe(false);
  });

  it("is false for a complete package with the wrong number of slides", async () => {
    // A package that is perfectly valid but is not one slide per page is not
    // what the copy promises either; the count is part of the proof.
    const { runPdfOfficeExport: real } = await import("./engine");
    const oneSlide: Run = (tool, input, deps) =>
      real(tool, input, {
        ...deps,
        extract: async () => ({
          pageCount: 1,
          pages: [{ pageNumber: 1, text: "only", characterCount: 4 }],
          text: "only",
          characterCount: 4,
          hasText: true,
        }),
      });
    await expect(provesPptxPresentationChain(oneSlide)).resolves.toBe(false);
  });
});
