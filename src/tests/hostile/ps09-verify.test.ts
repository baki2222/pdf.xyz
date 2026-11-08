// @native-canvas
// PS-09 adversarial verification: an unparseable number in /MediaBox makes
// pdf-lib report 0 pages for a 1-page file. What do getPageCount,
// getPageRotations, probePdf and setPageRotations do with it?
import { describe, expect, it } from "vitest";
import {
  getPageCount,
  getPageRotations,
  setPageRotations,
} from "@/lib/pdf/engine";
import { probePdf } from "@/lib/pdf/probe";
import { countPagesWithPdfjs } from "@/lib/pdf/pdfjs-page-count";
import { ONE_PAGE, rawPdf } from "./page-structure.raw";
import { rotateWholeFile } from "@/components/tools/runner/batch/rotate-batch";

const pageWith = (mediaBox: string) =>
  `<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Contents 4 0 R  >>`;
const build = (mediaBox: string) =>
  rawPdf({
    objects: [ONE_PAGE[0]!, ONE_PAGE[1]!, pageWith(mediaBox), ONE_PAGE[3]!],
  });

const CASES: Array<[string, string]> = [
  ["control", "[0 0 200 200]"],
  ["exp", "[0 0 1e309 792]"],
  ["junk", "[-0 . --5 99999999999999999999]"],
];

async function settle<T>(f: () => Promise<T>): Promise<unknown> {
  try {
    return await f();
  } catch (e) {
    return `threw ${(e as Error).name}: ${(e as Error).message}`;
  }
}

describe("PS-09 verify", () => {
  for (const [id, box] of CASES) {
    it(
      id,
      async () => {
        const input = build(box);
        const row: Record<string, unknown> = { id };
        row.pdfjs = await settle(() => countPagesWithPdfjs(input));
        row.count = await settle(() => getPageCount(input));
        row.rot = await settle(() => getPageRotations(input));
        const probe = (await settle(() =>
          probePdf(input, { maxBytes: 1e8 }),
        )) as Record<string, unknown>;
        row.probe =
          typeof probe === "string"
            ? probe
            : { read: probe.read, pages: probe.pages };
        const plan = Array.isArray(row.rot) ? (row.rot as never[]) : [];
        const out = await settle(() => setPageRotations(input, plan));
        if (out instanceof Uint8Array) {
          row.outLibPages = await settle(() => getPageCount(out));
          row.outPdfjs = await settle(() => countPagesWithPdfjs(out));
        } else row.set = out;
        const batch = await settle(() =>
          rotateWholeFile(
            { file: new File([input.slice()], "h.pdf"), bytes: input } as never,
            90,
          ),
        );
        if (batch && typeof batch === "object" && "bytes" in batch) {
          const b = batch as { bytes: Uint8Array; detail: string };
          row.batch = {
            detail: b.detail,
            libPages: await settle(() => getPageCount(b.bytes)),
            rot: await settle(() => getPageRotations(b.bytes)),
            pdfjs: await settle(() => countPagesWithPdfjs(b.bytes)),
          };
        } else row.batch = batch;
        console.log("PS09", JSON.stringify(row));
        expect(row.pdfjs).toBe(1);
      },
      30_000,
    );
  }
});
