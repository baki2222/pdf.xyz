// @native-canvas
import { describe, expect, it } from "vitest";
import { malformedPdfs } from "../malformed-pdf-fixtures";
import { addHeaderFooter } from "@/lib/pdf/header-footer";
import { PdfEngineError } from "@/lib/pdf/engine-errors";
import { errorMessage } from "@/components/tools/runner/runner-kit";

// STAMP-05 verify: what the user sees for the two existing malformed fixtures
// (catalog /Pages is a number; page /Resources /XObject is a number).
describe("STAMP-05 verify", () => {
  for (const i of [0, 1]) {
    it(`fixture [${i}] through addHeaderFooter`, async () => {
      const bytes = (await malformedPdfs())[i]!;
      let caught: unknown;
      let out: Uint8Array | undefined;
      try {
        out = await addHeaderFooter(bytes, { header: { left: "x" } });
      } catch (e) {
        caught = e;
      }
      const stack = ((caught as Error | undefined)?.stack ?? "")
        .split("\n")
        .slice(0, 8)
        .join(" | ");
      console.log(
        `[${i}]`,
        out ? `OUTPUT ${out.length} bytes` : "",
        caught
          ? `typed=${caught instanceof PdfEngineError} ui=${JSON.stringify(errorMessage(caught))}`
          : "",
        `STACK ${stack}`,
      );
      expect(caught !== undefined || out !== undefined).toBe(true);
    }, 20_000);
  }

  it("pdfjs opens fixture [1]", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = (await malformedPdfs())[1]!;
    const task = pdfjs.getDocument({ data: bytes.slice() });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const ops = await page.getOperatorList();
    console.log("pdfjs pages", doc.numPages, "ops", ops.fnArray.length);
    await task.destroy();
  }, 20_000);
});
