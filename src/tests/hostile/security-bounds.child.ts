// One hostile case of lane l02 (our own security parser and the pdf.js access
// probe), run in a child process by `security-bounds.test.ts` through
// `runBounded`: each of these either looped synchronously or allocated about
// 1 GiB before the fix, so in-process they would stall or crash vitest.
//
// Usage: node --import tsx security-bounds.child.ts <case>
// Prints one `@@RESULT {...}` line with the entry point's outcome and the
// process's peak RSS in MB.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import {
  classifyPdfAccess,
  probePdfEncryption,
  type PdfjsForAccess,
} from "../../lib/pdf/encryption";
import { loadPdfLib } from "../../lib/pdf/pdf-lib";
import { awaitPdfjsDocument } from "../../lib/pdf/pdfjs";
import { readXref } from "../../lib/pdf/security/document";
import { openProtectedPdf } from "../../lib/pdf/security/protected-pdf";
import { PDFJS_DOCUMENT_DEFAULTS } from "../../lib/pdf/wasm-assets";
import { ZERO_WIDTH_ROW_LIMIT } from "../../lib/pdf/xref-prescan";
import { reportResult } from "./report";
import {
  ONE_PAGE,
  ownerOnlyEncrypted,
  reflate,
  standardR3,
  xrefStreamPdf,
  zeroBomb,
} from "./security-in-browser.fixtures";
import { objStmBombPdf } from "./security-bounds.fixtures";

const req = createRequire(import.meta.url);
async function legacyPdfjs(): Promise<PdfjsForAccess> {
  return (await import(
    pathToFileURL(req.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
  )) as PdfjsForAccess;
}

const peakMb = () => Math.round(process.resourceUsage().maxRSS / 1024);

const BIG_INDEX = "[0 2147483647]";

/** `bytes` with one `from` replaced by `to` (same length: offsets hold). */
function sameLength(bytes: Uint8Array, from: string, to: string): Uint8Array {
  if (from.length !== to.length) throw new Error("lengths differ");
  const t = new TextDecoder("latin1").decode(bytes);
  const at = t.indexOf(from);
  if (at < 0) throw new Error(`${from} not found`);
  const out = bytes.slice();
  for (let i = 0; i < to.length; i += 1) out[at + i] = to.charCodeAt(i);
  return out;
}

const FIXTURES: Record<string, () => Uint8Array | Promise<Uint8Array>> = {
  // SIB-01: an object stream that declares /N 999999999 but holds one member.
  "objstm-n-1e9": () =>
    ownerOnlyEncrypted([...ONE_PAGE, "<< /Unrelated true >>"], {
      pack: [5],
      objStmN: "999999999",
    }),
  // Its honest twin (/N 1): the positive control.
  "objstm-n-honest": () =>
    ownerOnlyEncrypted([...ONE_PAGE, "<< /Unrelated true >>"], { pack: [5] }),
  // SIB-02 / SIB-03: zero-width xref rows over a 2^31-entry /Index.
  "xref-w0-plain": () =>
    xrefStreamPdf({ objects: ONE_PAGE, w: "[0 0 0]", index: "[0 2147483647]" }),
  "xref-w0-owner": () => {
    const r3 = standardR3();
    return xrefStreamPdf({
      objects: [...ONE_PAGE, `<< ${r3.encryptDict} >>`],
      w: "[0 0 0]",
      index: "[0 2147483647]",
      trailer: `/Encrypt 5 0 R ${r3.idEntry}`,
    });
  },
  // SIB-03 (review): spellings pdf.js's lexer and dictionary read as a
  // zero-width /W, each over the same 2^31-entry /Index. The first two
  // drove pdf.js out of memory past the first, literal-only pre-scan.
  "xref-w0-real": () =>
    xrefStreamPdf({ objects: ONE_PAGE, w: "[0 0 0.0]", index: BIG_INDEX }),
  "xref-w0-negzero": () =>
    xrefStreamPdf({ objects: ONE_PAGE, w: "[0 0 -0]", index: BIG_INDEX }),
  // A negative width reads no bytes: [+0 -5 .0] is zero bytes a row.
  "xref-w0-signs": () =>
    xrefStreamPdf({ objects: ONE_PAGE, w: "[+0 -5 .0]", index: BIG_INDEX }),
  // A later key wins in pdf.js's dictionary.
  "xref-w0-dup": () =>
    xrefStreamPdf({
      objects: ONE_PAGE,
      index: BIG_INDEX,
      xrefDict: "/W [0 0 0]",
    }),
  // #57 is W: pdf.js decodes the name.
  "xref-w0-escaped": () =>
    xrefStreamPdf({
      objects: ONE_PAGE,
      index: BIG_INDEX,
      xrefDict: "/#57 [0 0 0]",
    }),
  // No /Index: pdf.js walks [0 /Size].
  "xref-w0-size": () =>
    xrefStreamPdf({ objects: ONE_PAGE, w: "[0 0 0]", size: "2147483647" }),
  // pdf.js reads the stream at startxref without asking its /Type.
  "xref-w0-notype": () =>
    sameLength(
      xrefStreamPdf({ objects: ONE_PAGE, w: "[0 0 0]", index: BIG_INDEX }),
      "/Type /XRef",
      "/Type /XReg",
    ),
  // An indirect /W (ISO 32000-1 7.5.8.2 says these "shall be direct").
  "xref-w-indirect": () =>
    xrefStreamPdf({
      objects: [...ONE_PAGE, "[0 0 0]"],
      w: "5 0 R",
      index: BIG_INDEX,
    }),
  // The zero-width bound's second, independent check: what pdf.js itself
  // spends walking ZERO_WIDTH_ROW_LIMIT such rows, against six.
  "xref-w0-six": () =>
    xrefStreamPdf({ objects: ONE_PAGE, w: "[0 0 0]", index: "[0 6]" }),
  "xref-w0-at-limit": () =>
    xrefStreamPdf({
      objects: ONE_PAGE,
      w: "[0 0 0]",
      index: `[0 ${ZERO_WIDTH_ROW_LIMIT}]`,
    }),
  // SIB-05: a 1 GiB zero bomb as the xref stream, single and chained.
  "xref-bomb": () =>
    ownerOnlyEncrypted(ONE_PAGE, {
      xrefBody: zeroBomb(1024),
      xrefDict: "/Filter /FlateDecode",
    }),
  "xref-bomb-chained": () =>
    ownerOnlyEncrypted(ONE_PAGE, {
      xrefBody: reflate(zeroBomb(1024)),
      xrefDict: "/Filter [/FlateDecode /FlateDecode]",
    }),
  // SIB-05 (object streams): the page lives in a 1 GiB object stream.
  "objstm-bomb": () => objStmBombPdf(1024),
  // SIB-06: /Encrypt /Length 1000000000.
  "encrypt-length-1e9": () =>
    ownerOnlyEncrypted(ONE_PAGE, {
      encryptDict: (d) => d.replace("/Length 128", "/Length 1000000000"),
    }),
};

const ENTRIES: Record<string, (bytes: Uint8Array) => Promise<unknown>> = {
  async readXref(bytes) {
    try {
      const x = await readXref(await loadPdfLib(), bytes);
      return { settled: "entries", entries: x.entries.size };
    } catch (err) {
      return { settled: "threw", name: (err as Error).name };
    }
  },
  async open(bytes) {
    const r = await openProtectedPdf(bytes);
    if (r.kind !== "opened") return { settled: r.kind };
    const doc = await PDFDocument.load(r.pdf.plain);
    return { settled: "opened", pages: doc.getPageCount() };
  },
  async classify(bytes) {
    return {
      settled: (await classifyPdfAccess(bytes, await legacyPdfjs())).kind,
    };
  },
  // pdf.js alone, no pre-scan: what it costs to be asked.
  async pdfjs(bytes) {
    const lib = await legacyPdfjs();
    const task = lib.getDocument({
      data: bytes.slice(),
      ...PDFJS_DOCUMENT_DEFAULTS,
    });
    try {
      const doc = await awaitPdfjsDocument(task);
      return { settled: "opened", pages: doc.numPages };
    } catch (err) {
      return { settled: "threw", name: (err as Error).name };
    } finally {
      await task.destroy().catch(() => {});
    }
  },
  async probe(bytes) {
    return { settled: await probePdfEncryption(bytes, legacyPdfjs) };
  },
};

const [, , fixture = "", entry = ""] = process.argv;
const build = FIXTURES[fixture];
const run = ENTRIES[entry];
if (!build || !run) throw new Error(`unknown case ${fixture} ${entry}`);
void (async () => {
  const bytes = await build();
  const t0 = Date.now();
  const value = (await run(bytes)) as Record<string, unknown>;
  reportResult({ ...value, ms: Date.now() - t0, peakMb: peakMb() });
  process.exit(0);
})();
