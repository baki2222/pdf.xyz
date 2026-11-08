/**
 * PS-03 adversarial verification: cyclic page trees reach pdf-lib's
 * unguarded PDFPageTree traversal after loadPdf() has already succeeded,
 * so the failure escapes pdfLoadError and reaches the user as a raw
 * "Maximum call stack size exceeded".
 */
import { describe, expect, it } from "vitest";
import { rawPdf } from "./page-structure.raw";
import * as engine from "@/lib/pdf/engine";
import { PdfEngineError } from "@/lib/pdf/engine-errors";
import { errorMessage } from "@/components/tools/runner/runner-kit";

const CAT = "<< /Type /Catalog /Pages 2 0 R >>";
const PAGE =
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>";
const CONTENT = { dict: "", stream: Uint8Array.from(Buffer.from("q Q")) };

const fixtures: Record<string, () => Uint8Array> = {
  kidsCycle: () =>
    rawPdf({
      objects: [
        CAT,
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Pages /Parent 2 0 R /Kids [2 0 R] /Count 1 >>",
      ],
    }),
  selfKid: () =>
    rawPdf({
      objects: [
        CAT,
        "<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>",
        PAGE.replace("/Contents 4 0 R", "/Contents 4 0 R"),
        CONTENT,
      ],
    }),
  parentCycle: () =>
    rawPdf({
      objects: [
        CAT,
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 3 0 R /Contents 4 0 R >>",
        CONTENT,
      ],
    }),
  // positive control: a well-formed one-page file must work.
  control: () =>
    rawPdf({
      objects: [
        CAT,
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        PAGE,
        CONTENT,
      ],
    }),
};

async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    const v = await fn();
    return `ok ${JSON.stringify(v)?.slice(0, 60)}`;
  } catch (e) {
    const typed =
      e instanceof PdfEngineError
        ? "PdfEngineError"
        : (e as Error)?.constructor?.name;
    return `throw ${typed}: ${errorMessage(e)}`;
  }
}

describe("PS-03 verify", () => {
  for (const [name, build] of Object.entries(fixtures)) {
    it(name, { timeout: 20_000 }, async () => {
      const bytes = build();
      const rows = {
        load: await outcome(async () =>
          (await engine.loadPdf(bytes)).getPageCount(),
        ),
        getPageCount: await outcome(() => engine.getPageCount(bytes)),
        getPageRotations: await outcome(() => engine.getPageRotations(bytes)),
        rotatePages: await outcome(() => engine.rotatePages(bytes, [0], 90)),
        extractPages: await outcome(() =>
          engine.extractPages(bytes, [0] as never),
        ),
      };
      // Recorded 2026-11-08 on 1df22156: every cyclic cell throws a raw
      // RangeError whose message reaches the user verbatim; the control passes.
      if (name === "control") {
        expect(Object.values(rows).every((r) => r.startsWith("ok"))).toBe(true);
      } else {
        expect(rows.getPageRotations).toBe(
          "throw RangeError: Maximum call stack size exceeded",
        );
      }
    });
  }
});
