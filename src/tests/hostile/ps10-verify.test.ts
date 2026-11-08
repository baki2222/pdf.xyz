// @native-canvas
/**
 * PS-10 verification: n-up on a page whose MediaBox is [0 0 0 0].
 * Records what the output's content streams contain (Infinity / NaN operands)
 * and how pdf-lib and pdfjs read the output back.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { DEFAULT_N_UP_OPTIONS, nUpPdf } from "@/lib/pdf/n-up";
import { splitPagesInHalf } from "@/lib/pdf/split-half";
import { PAGE_STRUCTURE_FIXTURES } from "./page-structure.fixtures";
import { appendFileSync } from "node:fs";
const LOGF = process.env.PS10_LOG ?? "ps10.log";
const LOG = (...a: unknown[]) => appendFileSync(LOGF, a.map(String).join(" ") + String.fromCharCode(10));

const fx = (id: string) => {
  const f = PAGE_STRUCTURE_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`no fixture ${id}`);
  return f;
};

async function streamsOf(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        out.push(new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode()));
      } catch {
        out.push("<undecodable>");
      }
    }
  }
  return out;
}

describe("PS-10", () => {
  for (const [id, borders] of [
    ["H10.zero", false],
    ["H10.zero", true],
    ["H10.inverted", false],
  ] as const) {
    it(`${id} borders=${borders}`, { timeout: 20_000 }, async () => {
      const bytes = await fx(id).build();
      let r: Awaited<ReturnType<typeof nUpPdf>>;
      try {
        r = await nUpPdf(bytes, { ...DEFAULT_N_UP_OPTIONS, perSheet: 4, borders });
      } catch (e) {
        LOG(id, borders, "THREW", (e as Error).message);
        return;
      }
      const streams = await streamsOf(r.bytes);
      const bad = streams.filter((s) => /Infinity|NaN/.test(s));
      LOG(id, borders, "sheets", r.sheets, "streams", streams.length);
      for (const s of streams) LOG("STREAM:", JSON.stringify(s.slice(0, 400)));
      LOG("bad streams", bad.length);
      // pdfjs readback
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjs.getDocument({ data: r.bytes.slice() }).promise;
      const page = await doc.getPage(1);
      const ops = await page.getOperatorList();
      LOG("pdfjs ops", ops.fnArray.length, "args", JSON.stringify(ops.argsArray).slice(0, 400));
      expect(streams.length).toBeGreaterThan(0);
    });
  }

  it("split-half control", { timeout: 20_000 }, async () => {
    const bytes = await fx("H10.zero").build();
    await expect(
      splitPagesInHalf(bytes, { direction: "left-right", order: "left-first" }),
    ).rejects.toThrow();
  });
});
