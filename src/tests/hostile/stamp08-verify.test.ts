// @native-canvas
/**
 * STAMP-08 adversarial verify: a page whose `/Rotate` is not a multiple of 90
 * (45, 1e9, 1e20). pdf.js and Acrobat ignore such a value (the page shows
 * upright); stamp placement snaps it to the nearest 90 instead
 * (`placeStamp` -> `normalizeRotation` = `normalizeAngle`), so a page number
 * lands as if the page were turned. The control is the same page at /Rotate 0.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFNumber, StandardFonts } from "pdf-lib";
import { addPageNumbers } from "@/lib/pdf/page-numbers";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";

async function fixture(rotate: number | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Body", { x: 72, y: 700, size: 12, font });
  if (rotate !== null) {
    page.node.set(PDFName.of("Rotate"), PDFNumber.of(rotate));
  }
  return doc.save({ useObjectStreams: false });
}

interface Seen {
  rotate: number;
  view: number[];
  items: { str: string; x: number; y: number; a: number; b: number }[];
}

async function readAsViewed(bytes: Uint8Array): Promise<Seen> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"));
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    ...PDFJS_DOCUMENT_DEFAULTS,
    useWorkerFetch: false,
    disableFontFace: true,
    standardFontDataUrl: `${pathToFileURL(join(dir, "standard_fonts")).href}/`,
  }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const items = (tc.items as { str?: string; transform?: number[] }[])
    .filter((i) => typeof i.str === "string" && i.str.trim() !== "")
    .map((i) => ({
      str: i.str!,
      a: i.transform![0]!,
      b: i.transform![1]!,
      x: i.transform![4]!,
      y: i.transform![5]!,
    }));
  const out = { rotate: page.rotate, view: page.view, items };
  await doc.cleanup();
  return out;
}

const CASES: (number | null)[] = [null, 45, 1e9, 1e20];

describe("STAMP-08 verify: page numbers on /Rotate non-multiple-of-90", () => {
  const results = new Map<string, Seen>();

  for (const r of CASES) {
    it(
      `rotate=${String(r)}`,
      async () => {
        const src = await fixture(r);
        const out = await addPageNumbers(src, { position: "top-center" });
        const seen = await readAsViewed(out);
        results.set(String(r), seen);
        console.log(`STAMP08 rotate=${String(r)}`, JSON.stringify(seen));
        // health: pdfjs ignores the non-multiple and shows the page upright
        expect(seen.rotate).toBe(0);
        expect(seen.items.some((i) => i.str === "Body")).toBe(true);
      },
      20_000,
    );
  }

  it("the number sits where the control puts it (fails = finding reproduced)", () => {
    const ctrl = results.get("null")!.items.find((i) => i.str !== "Body")!;
    expect(ctrl, "positive control drew a number").toBeTruthy();
    const diffs: string[] = [];
    for (const r of [45, 1e9, 1e20]) {
      const n = results.get(String(r))!.items.find((i) => i.str !== "Body");
      if (
        !n ||
        Math.abs(n.x - ctrl.x) > 1 ||
        Math.abs(n.y - ctrl.y) > 1 ||
        Math.abs(n.a - ctrl.a) > 0.01 ||
        Math.abs(n.b - ctrl.b) > 0.01
      ) {
        diffs.push(`${r}: ${JSON.stringify(n)} vs control ${JSON.stringify(ctrl)}`);
      }
    }
    console.log("STAMP08 diffs", diffs);
    expect(diffs).toEqual([]);
  });
});
