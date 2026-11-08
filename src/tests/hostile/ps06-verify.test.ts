// PS-06 adversarial verification: header-only and broken-object-stream PDFs.
import { describe, expect, it } from "vitest";
import {
  getPageCount,
  getPageRotations,
  loadPdf,
  mergePdfs,
} from "@/lib/pdf/engine";
import { readPageBoard } from "@/components/tools/runner/use-single-pdf";
import { errorMessage } from "@/components/tools/runner/runner-kit";
import { probePdf } from "@/lib/pdf/probe";
import { latin1, ONE_PAGE, xrefStreamPdf } from "./page-structure.raw";

const HEADER_ONLY = latin1("%PDF-1.7\n");
const OBJSTM_N = xrefStreamPdf({
  objects: ONE_PAGE,
  pack: [1, 2, 3],
  objStmN: "5000",
});
const OBJSTM_FIRST = xrefStreamPdf({
  objects: ONE_PAGE,
  pack: [1, 2, 3],
  objStmFirst: "99999",
});

async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    const v = await p;
    return `ok:${JSON.stringify(v)}`;
  } catch (err) {
    return `${(err as Error).constructor.name}|${errorMessage(err)}`;
  }
}

describe("PS-06", () => {
  for (const [name, bytes] of [
    ["header-only", HEADER_ONLY],
    ["objStm N=5000", OBJSTM_N],
    ["objStm First past end", OBJSTM_FIRST],
  ] as const) {
    it(name, { timeout: 15000 }, async () => {
      const rows = {
        load: await outcome(loadPdf(bytes).then(() => "loaded")),
        count: await outcome(getPageCount(bytes)),
        rotations: await outcome(getPageRotations(bytes)),
        board: await outcome(readPageBoard(bytes, "pdf-lib")),
        rotate: await outcome(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (mergePdfs as any)([bytes]).then((b: Uint8Array) => b.length),
        ),
        probe: await outcome(
          probePdf(bytes, { maxBytes: 1e8 }).then((r) => r),
        ),
      };
      console.log(name, JSON.stringify(rows, null, 1));
      expect(rows.load).toBeDefined();
    });
  }
});
