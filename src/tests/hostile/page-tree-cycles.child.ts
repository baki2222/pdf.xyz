// PS-03 / STAMP-02 / CO-10 / EDIT-01 child: every /Kids-cycle fixture through
// every entry point, reported as one map. In a child process because the walk
// that refuses a cycle is the only thing between it and an endless loop:
// without its visited set (`page-tree.ts`), the walk pushes the same node
// forever and eats the heap, which in-process would take vitest down with it.
import { readPageBoard } from "../../components/tools/runner/use-single-pdf";
import {
  errorMessage,
  failureCode,
} from "../../components/tools/runner/runner-kit";
import { getPageCount, getPageRotations, loadPdf } from "../../lib/pdf/engine";
import { countPdfPagesDetailed } from "../../lib/pdf/page-count";
import { readPdfFrames } from "../../lib/pdf/page-frame";
import { probePdf } from "../../lib/pdf/probe";
import { reportResult } from "./report";
import { kidsSelfPdf } from "./conversion-out.fixtures";
import { rawPdf } from "./page-structure.raw";
import {
  CONVERTERS,
  EDITORS,
  STAMPERS,
  each,
  editingInput,
  outcome,
  stamping,
  type Outcome,
} from "./page-tree.entries";

const CAT = "<< /Type /Catalog /Pages 2 0 R >>";

/** The /Kids-cycle fixtures, one per finding that reported them. */
const CYCLE_FIXTURES = {
  // PS-03: two Pages nodes that are each other's kid; a node that is its own.
  "ps03-two-nodes": () =>
    rawPdf({
      objects: [
        CAT,
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Pages /Parent 2 0 R /Kids [2 0 R] /Count 1 >>",
      ],
    }),
  "ps03-self-kid": () =>
    rawPdf({
      objects: [
        CAT,
        "<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
      ],
    }),
  "stamp02-kids-contain-self": () => stamping("H07-kids-contain-self"),
  "edit01-kids-contains-self": () => editingInput("H07-kids-contains-self"),
  "co10-kids-self": async () => kidsSelfPdf(),
} as const;

const GATES: Record<string, (b: Uint8Array) => Promise<unknown>> = {
  loadPdf: (b) => loadPdf(b),
  getPageCount: (b) => getPageCount(b),
  getPageRotations: (b) => getPageRotations(b),
};

(async () => {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [id, build] of Object.entries(CYCLE_FIXTURES)) {
    const bytes = await build();
    const board = await readPageBoard(bytes.slice(), "pdf-lib").then(
      () => ({ kind: "output" }),
      (err: unknown) => ({
        message: errorMessage(err),
        code: failureCode(err) ?? null,
      }),
    );
    const outcomes: Record<string, Outcome | unknown> = {
      ...(await each(GATES, bytes)),
      ...(await each(STAMPERS, bytes)),
      ...(await each(EDITORS, bytes)),
      ...(await each(CONVERTERS, bytes)),
      readPageBoard: board,
      probe: (await probePdf(bytes.slice(), { maxBytes: Infinity })).read,
      count: await countPdfPagesDetailed(bytes.slice(), Infinity),
      frames: await outcome(async () => {
        if ((await readPdfFrames(bytes.slice())) !== null)
          throw new Error("frames read from a cyclic tree");
      }),
    };
    result[id] = outcomes;
  }
  reportResult(result);
})();
