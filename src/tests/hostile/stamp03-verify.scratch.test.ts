// @native-canvas
import { describe, it } from "vitest";
import { STAMPING_INPUTS } from "./stamping.fixtures";
import { ENGINES, runEngine } from "./stamping.cells";
import { PdfEngineError } from "@/lib/pdf/engine-errors";
import { addPageNumbers } from "@/lib/pdf/page-numbers";
import { loadPdf } from "@/lib/pdf/engine";
import { errorMessage } from "@/components/tools/runner/runner-kit";

const bound = <T,>(p: Promise<T>, ms = 15000) =>
  Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error("BOUND")), ms))]);

describe("STAMP-03 verify", () => {
  const input = STAMPING_INPUTS.find((i) => i.id === "H07-page-parent-self")!;
  it("fixture shape", () => {
    const s = Buffer.from(input.build()).toString("latin1");
    console.log(s.match(/3 0 obj[\s\S]*?endobj/)![0]);
  });
  it("addPageNumbers direct", async () => {
    try {
      const out = await bound(addPageNumbers(input.build()));
      console.log("OK", out.length);
    } catch (err) {
      const e = err as Error;
      console.log("THREW", e.constructor.name, err instanceof PdfEngineError, e.message);
      console.log("UI shows:", errorMessage(err));
      console.log((e.stack ?? "").split("\n").slice(0, 14).join("\n"));
    }
  }, 20000);
  it("loadPdf + getPageCount + page.getSize", async () => {
    const d = await loadPdf(input.build());
    console.log("count", d.getPageCount());
    try { console.log("size", d.getPage(0).getSize()); } catch (e) { console.log("getSize threw", String(e)); }
    try { console.log("rot", d.getPage(0).getRotation()); } catch (e) { console.log("getRotation threw", String(e)); }
  }, 20000);
  it("pdfjs reads it", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await bound(pdfjs.getDocument({ data: input.build() }).promise);
    const p = await doc.getPage(1);
    const tc = await p.getTextContent();
    console.log("pdfjs pages", doc.numPages, "view", p.view, "text", tc.items.map((i) => ("str" in i ? i.str : "")).join(""));
  }, 20000);
  for (const e of ENGINES) {
    it(`engine ${e}`, async () => {
      try {
        const out = await bound(runEngine(e, input.build()));
        console.log(e, "OK", out.length);
      } catch (err) {
        console.log(e, (err as Error).constructor.name, err instanceof PdfEngineError, (err as Error).message.slice(0, 100));
      }
    }, 20000);
  }
});
