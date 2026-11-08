// PS-04 child: one page-copy entry point on a Form XObject chain, in a plain
// Node process. The default main-thread stack (~1 MB, close to a browser main
// thread) is the point: a vitest thread worker has a 4 MB stack and passes a
// 2,000-deep chain even on the recursive copier (verifier's note).
//
// argv: <fixture id from PAGE_STRUCTURE_FIXTURES> <entry point>
// Reports { ok, chain } where `chain` is how many forms the OUTPUT's first page
// still reaches through /Resources /XObject /F, or { ok: false, typed, ... }.
import { PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
import {
  extractPages,
  mergePdfs,
  organizePages,
  splitPdf,
} from "../../lib/pdf/engine";
import { PdfEngineError } from "../../lib/pdf/engine-errors";
import { mergeAlternating } from "../../lib/pdf/merge-alternate";
import { splitPagesInHalf } from "../../lib/pdf/split-half";
import { reportResult } from "./report";
import { PAGE_STRUCTURE_FIXTURES } from "./page-structure.fixtures";

const [id, entry] = process.argv.slice(2);

const ENTRIES: Record<string, (b: Uint8Array) => Promise<Uint8Array>> = {
  extract: (b) => extractPages(b, [0]),
  merge: (b) => mergePdfs([b, b]),
  mergeAlternate: (b) => mergeAlternating([b, b]),
  split: async (b) =>
    (await splitPdf(b, [{ name: "a.pdf", indices: [0] }]))[0]!.bytes,
  // Two copies of page 1: an identity plan rotates in place and copies nothing.
  organize: (b) =>
    organizePages(b, [
      { sourceIndex: 0, rotation: 0 },
      { sourceIndex: 0, rotation: 90 },
    ]),
  splitHalf: async (b) =>
    (
      await splitPagesInHalf(b, {
        direction: "left-right",
        order: "left-first",
      })
    ).bytes,
};

/** Forms reached from page 1, walked iteratively (the output may be deep). */
async function chainDepth(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let res: PDFDict | undefined = doc
    .getPage(0)
    .node.lookupMaybe(PDFName.of("Resources"), PDFDict);
  let depth = 0;
  for (;;) {
    const xo = res?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const form = xo?.lookup(PDFName.of("F"));
    if (!(form instanceof PDFStream)) return depth;
    depth += 1;
    res = form.dict.lookupMaybe(PDFName.of("Resources"), PDFDict);
  }
}

async function main() {
  const fixture = PAGE_STRUCTURE_FIXTURES.find((f) => f.id === id);
  const run = entry ? ENTRIES[entry] : undefined;
  if (!fixture || !run) throw new Error(`unknown case ${id} / ${entry}`);
  const bytes = await fixture.build();
  try {
    const out = await run(bytes);
    reportResult({ ok: true, chain: await chainDepth(out) });
  } catch (err) {
    reportResult({
      ok: false,
      typed: err instanceof PdfEngineError,
      name: (err as Error)?.name,
      message: (err as Error)?.message,
    });
  }
}
void main();
