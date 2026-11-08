// @native-canvas
// PS-12 adversarial verification: in-place rotate on a /Count -1 or 0 file
// with one real page. Does the OUTPUT fail in pdf.js where the INPUT did not?
// (If the input already fails in pdf.js, rotate did not make anything worse.)
import { describe, expect, it } from "vitest";
import { rotatePages, setPageRotations, getPageCount } from "@/lib/pdf/engine";
import { loadPdfjs } from "@/lib/pdf/pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { PAGE_STRUCTURE_FIXTURES } from "./page-structure.fixtures";

async function pdfjsOpen(bytes: Uint8Array): Promise<string> {
  try {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      ...PDFJS_DOCUMENT_DEFAULTS,
    });
    const d = await task.promise;
    const n = d.numPages;
    let p1 = "ok";
    try {
      await d.getPage(1);
    } catch (e) {
      p1 = `getPage(1) error: ${(e as Error).message}`;
    }
    await task.destroy();
    return `numPages=${n}; ${p1}`;
  } catch (e) {
    return `open error: ${(e as Error).name}: ${(e as Error).message}`;
  }
}

function countToken(bytes: Uint8Array): string[] {
  const s = Buffer.from(bytes).toString("latin1");
  return [...s.matchAll(/\/Count\s+(-?[\d.]+)/g)].map((m) => m[1]!);
}

describe("PS-12 verify", () => {
  for (const id of ["H09.countNeg", "H09.countZero", "control"]) {
    it(id, { timeout: 30_000 }, async () => {
      const fx =
        id === "control"
          ? PAGE_STRUCTURE_FIXTURES.find((f) => f.id === "H09.countMax")!
          : PAGE_STRUCTURE_FIXTURES.find((f) => f.id === id)!;
      const input = await fx.build();
      const libCount = await getPageCount(input);
      const inPdfjs = await pdfjsOpen(input);
      const rot = await rotatePages(input, [0], 90);
      const set = await setPageRotations(input, [90]);
      const report = {
        id,
        libCount,
        inCount: countToken(input),
        inPdfjs,
        rotCount: countToken(rot),
        rotPdfjs: await pdfjsOpen(rot),
        setCount: countToken(set),
        setPdfjs: await pdfjsOpen(set),
      };
      console.log(JSON.stringify(report));
      expect(libCount).toBeGreaterThan(0);
    });
  }
});
