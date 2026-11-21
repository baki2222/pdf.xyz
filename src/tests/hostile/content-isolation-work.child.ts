// Child for content-isolation.test.ts, review-l06 round 2: the WORK isolation
// does is bounded, not just the bytes it decodes. A child, because the scan
// and the engines are synchronous: a quadratic regression would block vitest's
// event loop, so only a killable process turns it into a red result.
//
// Modes:
//   scan-ei-less <bytes>   scanContentBalance on `Q` + `BI /L 1 ID x` repeated
//                          (inline images no EI ever ends) up to <bytes>
//   stamp-ei-less <count>  addPageNumbers on one page holding that content
//                          with <count> images, deflated (the reviewer's file)
//   stamp-shared <pages>   addPageNumbers on <pages> pages that all reference
//                          ONE content stream of ~30 MB with a surplus Q
//   scan-dense-ei <bytes>  scanContentBalance on one inline image followed by
//                          `EI ` repeated: every one a candidate pdf.js tests
//   isolate-distinct <pages> isolatePageContent on <pages> pages, each with
//                          its OWN ~30 MB content stream with a surplus Q
//   stamp-costly <shape> <pages>   (review-l06 round 3) addPageNumbers on
//   isolate-costly <shape> <pages> <pages> DISTINCT pages of ~31 MiB decoded
//                          each, in the costliest scan shapes: `dense` (one
//                          inline image, then `EI ` repeated: every one a
//                          candidate pdf.js tests) or `eiless` (`BI /L 1 ID x`
//                          repeated). isolate-costly reports each outcome.
//                          Optional 5th argument: KiB per page (default
//                          31 MiB). stamp-costly also runs isolatePageContent
//                          over the same pages and reports each outcome
//                          (`kinds`): which pages the work meter stopped is a
//                          count no runner speed moves.
//   isolate-distinct also reports each page's own time (`pageMs`), and
//   isolate-costly the best of 3 scans of 4 MiB of ordinary operators
//   (`ctrlMs`), so its time can be read against the same machine.
//   The scan modes take an optional 3rd argument, `<small>:<big>` bytes: then
//   the same shape is also scanned at both sizes, warmed and interleaved,
//   best of 3 each (`ratio`), so linearity is a same-run size ratio
//   (CI-flake audit lane 2, content-isolation L830/L847).
import * as PdfLib from "pdf-lib";
import { deflateSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { PDFDocument, PDFName } from "pdf-lib";
import {
  isolatePageContent,
  scanContentBalance,
} from "../../lib/pdf/content-isolation";
import { addPageNumbers } from "../../lib/pdf/page-numbers";
import { reportResult } from "./report";

const [mode, arg] = process.argv.slice(2);
const count = Number(arg);
const latin1 = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));
const IMAGE = "BI /L 1 ID x\n";
// ~30 MB decoded: just under the 32 MiB per-page budget.
const BIG = "Q\n" + "1 0 0 1 0 0 cm\n".repeat(2_000_000);

async function stamp(doc: PDFDocument) {
  const bytes = await doc.save();
  const t0 = Date.now();
  const out = await addPageNumbers(bytes);
  return { ms: Date.now() - t0, inBytes: bytes.length, outBytes: out.length };
}

/** Each page's isolation outcome, as the engines' isolation sees it. */
async function kindsOf(bytes: Uint8Array) {
  const loaded = await PDFDocument.load(bytes);
  const kinds: string[] = [];
  for (const p of loaded.getPages()) {
    const o = await isolatePageContent(p, PdfLib);
    kinds.push(o.kind === "skipped" ? `skipped:${o.reason}` : o.kind);
  }
  return kinds;
}

/**
 * One sample of a scan's cost: repeated until at least 100 ms have passed,
 * read as time per scan with the monotonic clock, so a timer tick or one
 * stall is a small share of it.
 */
function timedScan(content: Uint8Array): number {
  let scans = 0;
  let ms = 0;
  const t0 = performance.now();
  do {
    scanContentBalance(content);
    scans += 1;
    ms = performance.now() - t0;
  } while (ms < 100);
  return ms / scans;
}

/**
 * The same shape at two sizes, each scanned once to warm, then interleaved,
 * best of 3 samples each: a linear scan reads about big/small, a quadratic
 * one its square. Both sides are the same workload on the same machine at
 * the same moment, so the runner's speed cancels.
 */
function sizeRatio(
  build: (n: number) => Uint8Array,
  small: number,
  big: number,
) {
  const a = build(small);
  const b = build(big);
  scanContentBalance(a);
  scanContentBalance(b);
  const smallMs: number[] = [];
  const bigMs: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    smallMs.push(timedScan(a));
    bigMs.push(timedScan(b));
  }
  return {
    smallBytes: a.length,
    bigBytes: b.length,
    smallMs: Math.min(...smallMs),
    bigMs: Math.min(...bigMs),
  };
}

async function main() {
  if (mode === "scan-ei-less" || mode === "scan-dense-ei") {
    const [head, unit] =
      mode === "scan-ei-less" ? ["Q\n", IMAGE] : ["Q BI /L 1 ID ", "EI "];
    const build = (n: number) =>
      latin1(head + unit.repeat(Math.floor((n - head.length) / unit.length)));
    const content = build(count);
    const t0 = Date.now();
    const got = scanContentBalance(content);
    const ms = Date.now() - t0;
    const sizes = process.argv[4]?.split(":").map(Number);
    reportResult({
      ms,
      bytes: content.length,
      surplus: got.surplus.length,
      open: got.open,
      uncertain: got.uncertain,
      ...(sizes ? { ratio: sizeRatio(build, sizes[0]!, sizes[1]!) } : {}),
    });
    return;
  }
  const doc = await PDFDocument.create();
  const raw = (s: string) =>
    doc.context.register(
      doc.context.stream(deflateSync(Buffer.from(s, "latin1"), { level: 9 }), {
        Filter: "FlateDecode",
      }),
    );
  if (mode === "stamp-ei-less") {
    const ref = raw(
      "Q\n0.1 0 0 0.1 0 0 cm\n" + IMAGE.repeat(count) + "BT ET\n",
    );
    doc.addPage([612, 792]).node.set(PDFName.of("Contents"), ref);
  } else if (mode === "stamp-shared") {
    const ref = raw(BIG);
    for (let i = 0; i < count; i += 1)
      doc.addPage([612, 792]).node.set(PDFName.of("Contents"), ref);
  } else if (mode === "isolate-distinct") {
    for (let i = 0; i < count; i += 1)
      // A distinct comment per page: no two streams are the same object.
      doc
        .addPage([612, 792])
        .node.set(PDFName.of("Contents"), raw(`%${i}\n${BIG}`));
    const loaded = await PDFDocument.load(await doc.save());
    const t0 = Date.now();
    const kinds: string[] = [];
    const pageMs: number[] = [];
    for (const p of loaded.getPages()) {
      const tp = performance.now();
      const o = await isolatePageContent(p, PdfLib);
      pageMs.push(performance.now() - tp);
      kinds.push(o.kind === "skipped" ? `skipped:${o.reason}` : o.kind);
    }
    reportResult({ ms: Date.now() - t0, kinds, pageMs });
    return;
  } else if (mode === "stamp-costly" || mode === "isolate-costly") {
    const pages = Number(process.argv[4]);
    const size = Number(process.argv[5] ?? 31 * 1024) * 1024; // KiB

    for (let i = 0; i < pages; i += 1) {
      const [head, unit] =
        arg === "dense"
          ? [`%${i}\nQ 0.1 0 0 0.1 0 0 cm BI /L 1 ID `, "EI "]
          : [`%${i}\nQ 0.1 0 0 0.1 0 0 cm\n`, IMAGE];
      const body =
        head + unit.repeat(Math.floor((size - head.length) / unit.length));
      doc.addPage([612, 792]).node.set(PDFName.of("Contents"), raw(body));
    }
    if (mode === "isolate-costly") {
      const loaded = await PDFDocument.load(await doc.save());
      const t0 = Date.now();
      const kinds: string[] = [];
      for (const p of loaded.getPages()) {
        const o = await isolatePageContent(p, PdfLib);
        kinds.push(o.kind === "skipped" ? `skipped:${o.reason}` : o.kind);
      }
      const ms = Date.now() - t0;
      // The meter's unit on this machine: 4 MiB of ordinary operators, the
      // shape one metered byte stands for, best of 3.
      const unitOp = "q 1 0 0 1 5.5 5 cm 0 0 m 10 10 l S Q\n";
      const ordinary = latin1(
        unitOp.repeat(Math.floor((4 * 2 ** 20) / unitOp.length)),
      );
      timedScan(ordinary);
      const ctrl = Math.min(
        timedScan(ordinary),
        timedScan(ordinary),
        timedScan(ordinary),
      );
      reportResult({ ms, kinds, ctrlMs: ctrl });
      return;
    }
    const stamped = await stamp(doc);
    reportResult({ ...stamped, kinds: await kindsOf(await doc.save()) });
    return;
  } else throw new Error(`no mode ${mode}`);
  reportResult(await stamp(doc));
}

void main();
