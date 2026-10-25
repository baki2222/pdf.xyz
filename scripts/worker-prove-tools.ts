/**
 * `pnpm worker:prove-tools` — submit ONE REAL JOB per worker-backed tool against a
 * live deployment and verify the artifact that comes back.
 *
 * Why this exists: every readiness surface in this codebase is presence-only. A
 * processor's `ready` is derived from a dependency being *wired*
 * (`deps.extract != null`), never from that dependency being able to run — so a
 * dependency that throws on every call still reports `ready: true`. On 2026-08-01
 * that hid five tools that were live and failing 100% of jobs. No unit test, status
 * endpoint, or log line could see it. A real job could.
 *
 * It is a deployment probe, not a unit test: it needs a running web app + worker,
 * so it is deliberately NOT part of `pnpm test`. Run it after every worker deploy.
 *
 *   BASE=https://pdf.xyz pnpm worker:prove-tools            # every tool
 *   BASE=https://pdf.xyz pnpm worker:prove-tools ocr-pdf    # just these
 *   PROOF_ARTIFACT_DIR=out pnpm worker:prove-tools pdf-to-powerpoint
 *                                         # …and keep each download in out/
 *
 * Privacy: it prints status codes, byte counts, and generated filenames only —
 * never a signed URL, token, or password. Every fixture is generated here; no user
 * document is ever read. Inputs and artifacts land in the deployment's own storage
 * under its normal retention policy.
 *
 * Outcomes (TASK-72): PASS — the tool did the thing and the artifact verified.
 * FAIL — evidence of a defect somewhere on the proof's path. UNPROVEN — the
 * deployment's own policy refused to run the job (the free AI allowance or the
 * AI spend ceiling), which is the limiter working, not evidence about the
 * tool. The license for claiming UNPROVEN, and its corpus, live in
 * `src/lib/probes/proof-outcome.ts`; everything unlicensed stays FAIL, because
 * a false alarm costs one investigation while a false "not evidence" is the
 * convenient defect that ships.
 *
 * Each AI proof declares what the browser declares for its file
 * (`@/lib/probes/ai-proof-declaration`), so it is charged what a user's run
 * of that file is charged. Until 2026-10-09 none declared anything, each
 * reserved a whole run, and one connection's free allowance could not cover
 * the five in a day; declared, one run of all five fits in a day on a worker
 * that proves its read cap (`ai-proof-declaration.test.tsx` prices it with
 * the route's own function). On a worker that does not, the route ignores a
 * per-call declaration and they still cannot all fit. This harness never
 * routes around the limiter — a probe that dodges the cost control stops
 * proving what users actually hit. Coverage is
 * spread over runs instead: AI tools are attempted least-recently-proven
 * first, ordered by a per-deployment ledger (`.worker-prove-tools-ledger.json`
 * at the repo root, gitignored, local to the operator's machine) that records
 * when each AI proof last PASSED; every run prints that table. A refused or
 * failed run does not advance a tool's position, so the rotation converges on
 * whatever remains unproven instead of marching past it.
 *
 * Exit codes: 0 = every selected proof passed (and, on a full run, every
 * worker-backed tool has a spec — a new tool must arrive with a proof).
 * 1 = evidence of a defect: a proof FAILED, or a worker tool has no spec.
 * 2 = incomplete, not failing: nothing failed, but at least one selected proof
 * could not be made — refused by the deployment's own policy, or waiting on an
 * artifact from a proof that was itself never made. Red (1) is reserved for
 * evidence so that red keeps meaning defect; a pipeline that stops on any
 * nonzero still stops on 2 — safe by default, an incomplete run never upgrades
 * itself to proven — but 2 means "rerun after the allowance resets", never
 * "page someone". The closing summary prints one line per cause OBSERVED,
 * never one sentence over the union: a proof nobody asked about was refused by
 * nobody.
 *
 * No CI job runs this today (see `.github/workflows/`); it is owner-run against
 * a live deployment, and the codes above are the contract for the day one does.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { declaredContentTypeFor } from "../src/lib/jobs/mime-by-format";
import { proveDeclaredPdfA } from "@/lib/workers/pdf-archive/pdfa-markers";
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { linearizationVerdict } from "@/lib/pdf/linearization";
import {
  docxDeploymentVerdict,
  docxProofPdf,
  docxRoundTripVerdict,
  pptxDeploymentVerdict,
  pptxProofPdf,
} from "@/lib/workers/pdf-office-export/deployment-proof";
import { compareFidelity } from "@/lib/workers/pdf-office-export/fidelity";
import {
  readXlsxSheet,
  sheetGridProblems,
} from "@/lib/workers/ooxml/sheet-read";
import {
  INVOICE_FOOTER,
  INVOICE_ROWS,
  invoicePdf,
  invoiceSheetMismatches,
} from "@/tests/pdf-office-fixtures";
import { handBuiltPptx } from "@/tests/pptx-fixture";
import {
  officeFontProofDocx,
  officeFontProofVerdict,
} from "@/tests/office-font-fixtures";
import { mixedScanPdf, mixedSidecarVerdict } from "@/tests/ocr-proof-fixtures";
import {
  scannedDocxVerdict,
  scannedTextPdf,
  scanOfFirstPage,
} from "@/tests/word-ocr-proof-fixtures";
import { PDF_TO_WORD_RTL_REFUSAL } from "@/lib/jobs/ocr";
import {
  OCR_LANGUAGE_SAMPLES,
  sampleVerdict,
  samplePageHtml,
} from "@/lib/workers/ocr-languages-proof";
import {
  layoutProofHtml,
  onePageVerdict,
  pageSizeVerdict,
  viewportVerdict,
} from "@/lib/workers/html-render/layout-proof";
import { grayscaleVerdict } from "@/lib/workers/compression/image-colour";
import { readEncryptPermissions } from "@/lib/workers/pdf-security/permission-bits";
import {
  ALL_PERMISSIONS_ALLOWED,
  permissionMismatches,
} from "@/lib/jobs/pdf-permissions";
import {
  reportTablesPdf,
  tablesProofVerdict,
} from "@/tests/table-extract-fixtures";
import {
  recoverablyDamagedPdf,
  repairProofVerdict,
  unrecoverablePdf,
} from "@/tests/repair-proof-fixtures";
import type { JobResults } from "@/lib/jobs/results";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { AI_PROOF_SPECS } from "@/tests/ai-proof-specs";
import {
  browserAiDeclaration,
  type AiJobDeclaration,
} from "@/lib/probes/ai-proof-declaration";
import { getAllToolSlugs, getToolBySlug } from "@/lib/tools";
import { printChromeLeaks } from "@/lib/workers/html-render/print-chrome";
import {
  pageShowsText,
  webpageProof404Url,
  webpageProofPage,
} from "@/lib/probes/webpage-proof";
import { spliceStartxrefPastEnd } from "@/tests/damaged-xref";
import { unsupportedEncryptionPdf } from "@/tests/unsupported-encryption";
import {
  UNREADABLE_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
} from "@/lib/workers/pdf-security/engine";
import { webpageFetchMessage } from "@/lib/workers/html-render/engine";
import { capabilityForMode, usesWorkerBackend } from "@/lib/jobs/capabilities";
import { browserStoppedWaitingAt } from "@/lib/jobs/client-wait";
import {
  harnessExitCode,
  judgeExpectedRefusal,
  orderSpecsForAllowance,
  refusalVerdict,
  specKey,
  unprovenSummaryLines,
  EXIT_DEFECT,
  EXIT_INCOMPLETE,
  type DeploymentProofLedger,
  type ProofOutcome,
  type UnprovenCause,
} from "@/lib/probes/proof-outcome";
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";

const BASE = process.env.BASE ?? "https://pdf.xyz";
/** When set, every downloaded artifact is also written here (see its use). */
const ARTIFACT_DIR = process.env.PROOF_ARTIFACT_DIR;
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const JOB_TIMEOUT_MS = 240_000;

// A per-run password so a proof job never reuses a fixed secret. It only ever
// protects a generated fixture and is never printed.
const PROOF_PASSWORD = `pdfxyz-proof-${process.pid}-${process.hrtime.bigint()}`;

/** What the permissions proof withholds; everything else must stay granted. */
const PROOF_RESTRICTIONS = { print: false, copy: false, modify: false };

/** The download's /P against {@link PROOF_RESTRICTIONS}, switch by switch. */
function permissionsVerdict(bytes: Uint8Array): {
  ok: boolean;
  detail: string;
} {
  const p = readEncryptPermissions(bytes);
  if (p === null)
    return {
      ok: false,
      detail: "no /Encrypt /P could be read from the output",
    };
  const wanted = { ...ALL_PERMISSIONS_ALLOWED, ...PROOF_RESTRICTIONS };
  const wrong = permissionMismatches(p, wanted);
  return wrong.length === 0
    ? {
        ok: true,
        detail: `/P ${p}: print, copy and modify withheld; the rest granted`,
      }
    : { ok: false, detail: `/P ${p} disagrees on: ${wrong.join(", ")}` };
}

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-";
/** OOXML and ZIP artifacts alike start with the local-file-header magic `PK\x03\x04`. */
const isZipContainer = (b: Buffer) =>
  b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

// ───────────────────────────────── fixtures ──────────────────────────────────

/** A PDF with genuinely selectable text — the baseline input for most tools. */
async function textPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("pdf.xyz deployment proof", { x: 60, y: 770, size: 20, font });
  page.drawText("This document carries real, selectable text so that", {
    x: 60,
    y: 735,
    size: 11,
    font,
  });
  page.drawText("text-extracting tools have something honest to extract.", {
    x: 60,
    y: 718,
    size: 11,
    font,
  });
  return Buffer.from(await doc.save());
}

/**
 * A PDF that opens in every viewer but that qpdf must REPAIR first, so Protect
 * reaches qpdf's exit 3 ("warnings, output written"). How it is damaged, and
 * the two ways that could fail for the wrong reason, are in
 * `src/tests/damaged-xref.ts`.
 */
async function damagedXrefPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("pdf.xyz proof: a damaged xref", {
    x: 60,
    y: 770,
    size: 20,
    font,
  });
  // The splice (and why it is a splice) lives in one builder shared with the
  // real-qpdf integration suite, so the two cannot drift apart.
  return Buffer.from(
    spliceStartxrefPastEnd(await doc.save({ useObjectStreams: false })),
  );
}

/** A PDF carrying an embedded raster, so deep compression has real image work. */
async function imagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const size = 64;
  // Deterministic noise: incompressible by structural repack alone, so a size
  // change proves the image pipeline ran rather than a metadata rewrite.
  const raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251;
  const img = await embedRasterImage(doc, encodePng(raw, size, size), "png");
  await drawRasterImage(page, img, { x: 60, y: 400, width: 400, height: 400 });
  page.drawRectangle({
    x: 60,
    y: 300,
    width: 400,
    height: 40,
    color: rgb(0.2, 0.3, 0.9),
  });
  return Buffer.from(await doc.save());
}

/** Minimal PNG encoder — avoids adding an image dependency for one fixture. */
function encodePng(rgbData: Buffer, width: number, height: number): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgbData.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let CRC_TABLE: Int32Array | null = null;
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return c ^ 0xffffffff;
}

/** A standalone PNG of the same bar pattern — the raster path OCR also accepts. */
function rasterPng(): Buffer {
  const w = 600;
  const h = 200;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dark = y > 80 && y < 120 && x % 50 < 25;
      raw.fill(dark ? 0 : 255, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
  }
  return encodePng(raw, w, h);
}

/**
 * A minimal, valid 8×8 baseline JPEG.
 *
 * Built from explicit bytes rather than checked in as an opaque base64 blob so the
 * structure stays reviewable, and generated rather than borrowed so nothing here
 * depends on a binary fixture. It carries no legible text — it does not need to.
 * What it proves is the dispatch and the decode: that an `image/jpeg` upload reaches
 * Tesseract rather than OCRmyPDF, and that the worker image can actually decode a
 * JPEG (a libjpeg dependency a PNG fixture would never exercise).
 *
 * The entropy payload is one all-zero block: a DC difference of 0 followed by
 * end-of-block, using the standard Annex K luminance tables.
 */
function minimalJpeg(): Buffer {
  const seg = (marker: number, body: number[]) =>
    Buffer.from([
      0xff,
      marker,
      ((body.length + 2) >> 8) & 0xff,
      (body.length + 2) & 0xff,
      ...body,
    ]);

  // Quantization table 0 — a flat table; any value in 1..255 is valid.
  const dqt = seg(0xdb, [0x00, ...new Array<number>(64).fill(0x10)]);
  // Baseline, 8-bit, 8×8, one greyscale component with no subsampling.
  const sof = seg(0xc0, [0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00]);

  // Annex K luminance DC table.
  const dcBits = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  const dcVals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const dht0 = seg(0xc4, [0x00, ...dcBits, ...dcVals]);

  // Annex K luminance AC table (only the leading symbols matter here; the full
  // table is declared so the file is a conforming baseline JPEG).
  const acBits = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
  const acVals = [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
    0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
    0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
    0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ];
  const dht1 = seg(0xc4, [0x10, ...acBits, ...acVals]);

  const sos = seg(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  // DC symbol 0 is the 2-bit code `00`; AC end-of-block is the 4-bit code `1010`.
  // `00 1010` padded with 1s to a byte boundary is 0b00101011.
  const scan = Buffer.from([0b00101011]);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    dqt,
    sof,
    dht0,
    dht1,
    sos,
    scan,
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

function rasterJpg(): Buffer {
  return minimalJpeg();
}

/**
 * The title appears nowhere in the body, so finding it in the PDF means
 * Chromium's print header put it there (see `printChromeLeaks`).
 */
const HTML_PROOF_TITLE = "pdf.xyz proof";
/** The page Webpage to PDF is proven on — ours, see `@/lib/probes/webpage-proof`. */
const WEBPAGE_PROOF = webpageProofPage();

/**
 * The OCR samples proved on a live deployment: two scripts added 2026-10-25
 * (Greek, Tamil) and a right-to-left one (Hebrew). The in-image proof runs
 * every sample; these three keep a deploy run short.
 */
const LIVE_OCR_SAMPLES = (["ell", "tam", "heb"] as const).map((code) => {
  const sample = OCR_LANGUAGE_SAMPLES.find((s) => s.code === code);
  if (!sample) throw new Error(`no OCR sample for ${code}`);
  return sample;
});
const HTML_PROOF_VISIBLE = "HTML to PDF";
function htmlFile(): Buffer {
  return Buffer.from(
    `<!doctype html><html><head><meta charset="utf-8"><title>${HTML_PROOF_TITLE}</title>
<style>body{font-family:sans-serif;padding:40px}h1{color:#4c1d95}</style></head>
<body><h1>${HTML_PROOF_VISIBLE}</h1><p>Rendered by Chromium on the secure worker.</p>
<table border="1"><tr><th>Row</th><th>Value</th></tr><tr><td>1</td><td>alpha</td></tr></table>
</body></html>`,
    "utf8",
  );
}

/**
 * The renderer-isolation proof's page. Until 2026-09 the worker rendered an
 * uploaded page from `file://` with Chromium's network open, and this exact
 * page came back with the worker's local files and internal answers printed in
 * it. Each reach below must come back EMPTY, while the visible line proves the
 * page itself rendered (so an empty PDF cannot pass).
 */
const ISOLATION_VISIBLE = "pdf.xyz renderer isolation proof";
function isolationHtmlFile(): Buffer {
  return Buffer.from(
    `<!doctype html><html><head><meta charset="utf-8"><title>isolation</title></head>
<body><h1>${ISOLATION_VISIBLE}</h1>
<iframe src="file:///etc/passwd" width="600" height="200"></iframe>
<iframe src="file:///proc/self/environ" width="600" height="200"></iframe>
<iframe src="http://169.254.169.254/latest/meta-data/" width="600" height="200"></iframe>
<iframe src="http://127.0.0.1:3000/" width="600" height="200"></iframe>
<pre id="out"></pre>
<script>
for (const u of ["file:///etc/passwd", "http://169.254.169.254/latest/meta-data/"])
  fetch(u).then(r => r.text()).then(t => { out.textContent += "REACHED:" + t.slice(0, 200); })
    .catch(() => {});
</script></body></html>`,
    "utf8",
  );
}

/** Markers any one of which means the page read something it must not. */
const ISOLATION_LEAKS: readonly { marker: RegExp; what: string }[] = [
  { marker: /root:[^:\s]*:0:0/, what: "/etc/passwd" },
  { marker: /PDFXYZ_|PATH=|HOSTNAME=/, what: "a process environment" },
  { marker: /ami-id|instance-id|local-ipv4/, what: "a metadata service" },
  { marker: /REACHED:/, what: "a script-side read" },
];

/**
 * The PDF a user downloads must carry the page and nothing else: until 2026-09
 * every page came back with a print date and the `<title>` along the top and
 * the worker's `file:///tmp/pdfxyz-html-…/input.html` (or the webpage's URL)
 * along the bottom, and `isPdf` could not see any of it. `visible` is the
 * positive control — an empty PDF cannot pass by containing no header. It is
 * read ligature- and whitespace-tolerantly (`pageShowsText`): an extractor
 * gives "files" back as "ﬁles" or "fi les", and neither is a missing page.
 */
function verifyPageOnly(
  visible: string,
  context: Parameters<typeof printChromeLeaks>[1],
) {
  return async (bytes: Buffer) => {
    const text = await pdfPlainText(bytes);
    if (!pageShowsText(text, visible))
      return {
        ok: false,
        detail: `the page's own text is missing (${text.length} chars extracted), so an absent header proves nothing`,
      };
    const leaks = printChromeLeaks(text, context);
    return leaks.length === 0
      ? { ok: true, detail: "page rendered; no print header or footer" }
      : {
          ok: false,
          detail: `the PDF carries a print header/footer: ${leaks.join(", ")}`,
        };
  };
}

async function pdfPlainText(bytes: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    ...PDFJS_DOCUMENT_DEFAULTS,
    data: new Uint8Array(bytes),
  });
  const doc = await awaitPdfjsDocument(task);
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
  }
  await task.destroy();
  return text.replace(/\s+/g, " ");
}

function csvFile(): Buffer {
  return Buffer.from("Region,Q1,Q2\nNorth,1200,1350\nSouth,980,1020\n", "utf8");
}

const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const ODOC_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const rootRels = (target: string, type: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${type}" Target="${target}"/></Relationships>`;

/** A real XLSX with one inline-string worksheet. */
async function xlsxFile(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    rootRels("xl/workbook.xml", `${ODOC_NS}/officeDocument`),
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${ODOC_NS}"><sheets><sheet name="Proof" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    rootRels("worksheets/sheet1.xml", `${ODOC_NS}/worksheet`),
  );
  const cell = (ref: string, text: string) =>
    `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1">${cell("A1", "Region")}${cell("B1", "Q1")}</row>
<row r="2">${cell("A2", "North")}${cell("B2", "1200")}</row>
</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

// ────────────────────────────────── specs ────────────────────────────────────

interface ProofSpec {
  tool: string;
  /** Distinguishes two specs for the same tool (e.g. xlsx vs csv input). */
  label?: string;
  make?: () => Promise<Uint8Array> | Uint8Array;
  /** Reuse a previous spec's artifact as this one's input (protect → unlock). */
  from?: string;
  /**
   * Turn the carried `from` artifact into this spec's input first — an OCR
   * proof scans the page another spec had the worker's Chromium type, so its
   * script is drawn in the image's own fonts (2026-10-25).
   */
  fromTransform?: (bytes: Buffer) => Promise<Uint8Array>;
  name?: string;
  type?: string;
  /** URL-input tools carry no file; the source goes in `options.url`. */
  url?: string;
  options?: Record<string, unknown>;
  /**
   * Build `options` from a previously kept artifact, for a spec whose dependency on
   * the earlier run is its CONTENT rather than its bytes-as-input. `from` re-uploads
   * a prior artifact as the new file; this instead reads a prior artifact to compose
   * the new request — which is what a chat follow-up needs, since it carries the
   * previous question and answer as conversation context while re-sending the same
   * document.
   */
  optionsFrom?: {
    artifact: string;
    build: (bytes: Buffer) => Promise<Record<string, unknown>>;
  };
  expect: (bytes: Buffer) => boolean;
  /**
   * Assert on what is INSIDE the artifact, once its container shape has passed.
   *
   * `expect` can only see the envelope — every AI tool returns a ZIP, so it answers
   * "a ZIP came back", which stays true even if the feature under test did nothing.
   * What is inside says more: for a conversation, the manifest's turn count says
   * the worker's engine was given the prior turns, and the answer can fail a worker
   * that dropped every prior turn before the model — not one that dropped only the
   * assistant's, nor one whose model guessed right (`@/lib/probes/ai-proof-content`,
   * `CHAT_PROOF_FOLLOW_UP`). (Until 2026-10-09 this said the manifest showed the
   * worker "received and used" them; it counts the turns the engine was handed.)
   * The returned detail is printed on success, so a measurement (rather than a
   * mere pass) reaches the operator.
   *
   * `job` is the completed job record exactly as GET /api/jobs/:id served it,
   * for a claim that lives on the record rather than in the bytes — what
   * repair-pdf reported it rebuilt is the sentence the panel shows.
   */
  verify?: (
    bytes: Buffer,
    job: ApiResponse,
  ) => Promise<{ ok: boolean; detail: string }>;
  /**
   * Which artifact to download, by filename, when a job returns several (OCR's
   * "both" mode returns the PDF first). Absent ⇒ the first. A job with no
   * artifact matching it is a FAIL, never a fall-back to another artifact.
   */
  artifact?: (filename: string) => boolean;
  /**
   * The proof passes only if the job FAILS with exactly this user-facing
   * message (see `judgeExpectedRefusal`). A delivered artifact is itself the
   * failure, so `expect` and `verify` are never reached for such a spec.
   */
  refuses?: string;
  /**
   * A proof that the tool REFUSES an input properly: the job must end `failed`
   * with exactly this code and retryability, and a message matching `message`.
   * A job that completes is the FAIL here. `expect` is then never reached.
   */
  expectFailure?: { code: string; retryable: boolean; message: RegExp };
  want: string;
  keepArtifactAs?: string;
}

const SPECS: ProofSpec[] = [
  {
    tool: "compress-pdf",
    make: imagePdf,
    name: "photo.pdf",
    type: PDF_MIME,
    options: { profile: "deep" },
    expect: isPdf,
    want: "PDF",
  },
  // Extreme + Grayscale (2026-10-24). `isPdf` passes a colour file under a
  // grayscale label; the verdict reads every image's colour space in the
  // download and fails unless each is one component — and fails a file with
  // no image at all, so a fixture that lost its picture cannot pass.
  {
    tool: "compress-pdf",
    label: "compress-pdf (extreme, grayscale)",
    make: imagePdf,
    name: "photo.pdf",
    type: PDF_MIME,
    options: { profile: "deep", targetDpi: 72, grayscale: true },
    expect: isPdf,
    want: "1-component gray images",
    verify: (bytes) => grayscaleVerdict(new Uint8Array(bytes)),
  },
  // Until 2026-09-27 this sent the healthy `textPdf` under the name
  // `broken.pdf`, so the only real-job proof of Repair PDF exercised qpdf's
  // exit 0 and nothing a damaged file goes through. Now it sends real damage —
  // the recipe measured on the production worker's qpdf, with the fixture
  // checking itself — and reads what the job record says was rebuilt.
  {
    tool: "repair-pdf",
    make: async () => Buffer.from(await recoverablyDamagedPdf()),
    name: "broken.pdf",
    type: PDF_MIME,
    expect: isPdf,
    want: "rebuilt PDF",
    verify: (bytes, job) => repairProofVerdict(bytes, job, "recovered"),
  },
  // The other half of the panel's sentence: a healthy file must come back
  // reported CLEAN, or "qpdf found no structural damage" would never show.
  {
    tool: "repair-pdf",
    label: "repair-pdf (clean)",
    make: textPdf,
    name: "healthy.pdf",
    type: PDF_MIME,
    expect: isPdf,
    want: "PDF reported clean",
    verify: (bytes, job) => repairProofVerdict(bytes, job, "clean"),
  },
  // Nothing to rebuild from. Until 2026-09-27 qpdf's refusal was a retryable
  // internal_error: three identical runs, then "could not process this file".
  {
    tool: "repair-pdf",
    label: "repair-pdf (unrecoverable)",
    make: async () => Buffer.from(await unrecoverablePdf()),
    name: "rubble.pdf",
    type: PDF_MIME,
    expectFailure: {
      code: OFFICE_EXPORT_ERROR_CODES.unreadable,
      retryable: false,
      message: /could not be rebuilt/,
    },
    expect: () => false,
    want: "a final refusal, not a retry",
  },
  // "linearized PDF" was printed on the strength of `%PDF-` at byte 0 until
  // 2026-09-27; the one property this tool sells was never read. `textPdf` is
  // pdf-lib output and NOT linearized, so a worker that skipped `--linearize`
  // and returned its input rewritten fails here — the verdict reads the
  // linearization dictionary and holds its /L to the artifact's length.
  {
    tool: "optimize-web",
    make: textPdf,
    name: "web.pdf",
    type: PDF_MIME,
    expect: isPdf,
    want: "linearized PDF",
    verify: async (bytes) => linearizationVerdict(bytes),
  },
  {
    tool: "ocr-pdf",
    make: imagePdf,
    name: "scan.pdf",
    type: PDF_MIME,
    expect: isPdf,
    want: "searchable PDF",
  },
  // `ocr-pdf` accepts PDF, JPG and PNG, and the two engines behind it read
  // different things — OCRmyPDF takes a PDF, Tesseract takes a raster. Proving
  // only the PDF path left the other two formats untested, and both were broken:
  // every image upload dispatched to OCRmyPDF and failed inside the engine.
  {
    tool: "ocr-pdf",
    label: "ocr-pdf (png)",
    make: rasterPng,
    name: "scan.png",
    type: "image/png",
    expect: isPdf,
    want: "searchable PDF",
  },
  {
    tool: "ocr-pdf",
    label: "ocr-pdf (jpg)",
    make: rasterJpg,
    name: "scan.jpg",
    type: "image/jpeg",
    expect: isPdf,
    want: "searchable PDF",
  },
  // A page that already has text beside a scanned one, with the panel's
  // defaults plus the text output. The job completing is half the proof (it
  // aborted on every such file until 2026-09-27); the .txt holding the typed
  // page's own words is the other half.
  {
    tool: "ocr-pdf",
    label: "ocr-pdf (text + scan)",
    make: async () => Buffer.from(await mixedScanPdf()),
    name: "mixed.pdf",
    type: PDF_MIME,
    options: { languages: ["eng"], outputMode: "both" },
    artifact: (filename) => filename.endsWith(".txt"),
    expect: (bytes) => bytes.length > 0,
    want: "text sidecar",
    // A page with text AND a scanned one (a scanner app's "searchable PDF", a
    // scan behind a typed cover). Until 2026-09-27 OCRmyPDF aborted every such
    // file; the pure-scan `imagePdf` proof above can never hit it. The same
    // verdict runs through real poppler in `ocr-native.test.ts`.
    verify: (bytes) => mixedSidecarVerdict(bytes),
  },
  {
    tool: "protect-pdf",
    make: textPdf,
    name: "secret.pdf",
    type: PDF_MIME,
    options: { password: PROOF_PASSWORD, keyLength: 256 },
    expect: isPdf,
    want: "encrypted PDF",
    keepArtifactAs: "encrypted",
  },
  // Permissions (2026-10-24): the /P bits of the DOWNLOAD, read without a
  // password, against what was asked — the restricted ones withheld, every
  // other one granted. A worker image older than the option would ignore it
  // and return an all-allowed file, which this fails.
  {
    tool: "protect-pdf",
    label: "protect-pdf (permissions)",
    make: textPdf,
    name: "restricted.pdf",
    type: PDF_MIME,
    options: {
      password: PROOF_PASSWORD,
      ownerPassword: `${PROOF_PASSWORD}-owner`,
      keyLength: 256,
      permissions: PROOF_RESTRICTIONS,
    },
    expect: isPdf,
    want: "encrypted PDF with print, copy and modify withheld",
    verify: async (bytes) => permissionsVerdict(new Uint8Array(bytes)),
  },
  // Chained deliberately: unlocking the artifact protect-pdf just produced proves
  // both directions against the same document.
  {
    tool: "unlock-pdf",
    from: "encrypted",
    name: "secret-protected.pdf",
    type: PDF_MIME,
    options: { password: PROOF_PASSWORD },
    expect: isPdf,
    want: "decrypted PDF",
  },
  // qpdf exits 2 for a wrong password AND for every other error; until 2026-09
  // the runner called every 2 a wrong password. The two specs below prove both
  // halves of the split on the running worker: a genuinely wrong password is
  // still named as one (established by qpdf's password check, not the 2), and
  // a file qpdf cannot open is not.
  {
    tool: "unlock-pdf",
    label: "unlock-pdf (wrong password)",
    from: "encrypted",
    name: "secret-protected.pdf",
    type: PDF_MIME,
    options: { password: `${PROOF_PASSWORD}-not-it` },
    expect: isPdf,
    refuses: WRONG_PASSWORD_MESSAGE,
    want: "the job refused with 'The password is incorrect'",
  },
  {
    tool: "unlock-pdf",
    label: "unlock-pdf (unsupported encryption)",
    make: async () => Buffer.from(await unsupportedEncryptionPdf()),
    name: "certificate-encrypted.pdf",
    type: PDF_MIME,
    options: { password: PROOF_PASSWORD },
    expect: isPdf,
    refuses: UNREADABLE_MESSAGE,
    want: "the job refused as damaged/unsupported — not 'incorrect password' or 'isn't password-protected'",
  },
  // A damaged-but-recoverable input. qpdf repairs it on the way in and exits 3;
  // until 2026-09 the security runner treated any non-zero exit as failure, so
  // Protect refused every such file with "could not process this file". The
  // clean `textPdf` above could never have shown that.
  {
    tool: "protect-pdf",
    label: "protect-pdf (damaged xref)",
    make: damagedXrefPdf,
    name: "scanner-export.pdf",
    type: PDF_MIME,
    options: { password: PROOF_PASSWORD, keyLength: 256 },
    expect: isPdf,
    verify: async (buf) =>
      buf.includes("/Encrypt")
        ? { ok: true, detail: "the output carries an /Encrypt dictionary" }
        : { ok: false, detail: "no /Encrypt in the output: not encrypted" },
    want: "encrypted PDF",
  },
  // `expect: isPdf` alone was this proof until the PDF/A gate existed: it passed
  // any PDF, so it could not fail on a file whose PDF/A claim no validator
  // accepts. `verify` asks the downloaded artifact the engine's own question.
  // The same locked document through OCR. It can never succeed, so the proof is
  // HOW it fails: final on the first attempt, naming the tool that fixes it.
  // Until 2026-09-27 it was retried three times and reported as "The OCR engine
  // could not process this file".
  {
    tool: "ocr-pdf",
    label: "ocr-pdf (encrypted)",
    from: "encrypted",
    name: "locked.pdf",
    type: PDF_MIME,
    expectFailure: {
      code: "unprocessable_entity",
      retryable: false,
      message: /Unlock PDF/,
    },
    // Never reached: with `expectFailure`, a completed job is itself the FAIL.
    expect: () => false,
    want: "a final refusal naming Unlock PDF",
  },
  // The commonest reason a PDF "won't open" is a password, and Repair PDF is
  // where a user takes it. Until 2026-09-27 that was retried three times and
  // then "could not process this file"; it must be one attempt, naming Unlock.
  {
    tool: "repair-pdf",
    label: "repair-pdf (encrypted)",
    from: "encrypted",
    name: "locked.pdf",
    type: PDF_MIME,
    expectFailure: {
      code: OFFICE_EXPORT_ERROR_CODES.passwordProtected,
      retryable: false,
      message: /Unlock PDF/,
    },
    expect: () => false,
    want: "a final refusal naming Unlock PDF",
  },
  {
    tool: "pdf-to-pdfa",
    make: textPdf,
    name: "archive.pdf",
    type: PDF_MIME,
    expect: isPdf,
    verify: proveDeclaredPdfA,
    want: "PDF/A",
  },
  {
    tool: "html-to-pdf",
    make: htmlFile,
    name: "page.html",
    type: "text/html",
    expect: isPdf,
    verify: verifyPageOnly(HTML_PROOF_VISIBLE, { title: HTML_PROOF_TITLE }),
    want: "PDF of the page with no print header or footer",
  },
  // The renderer must not read the worker's files or reach its private
  // network on an uploaded page's say-so. `verify` decodes the PDF the user
  // gets back; the visible line is the positive control.
  {
    tool: "html-to-pdf",
    label: "html-to-pdf (isolation)",
    make: isolationHtmlFile,
    name: "isolation.html",
    type: "text/html",
    expect: isPdf,
    verify: async (bytes) => {
      const text = await pdfPlainText(bytes);
      if (!text.includes(ISOLATION_VISIBLE))
        return {
          ok: false,
          detail: `the page's own text is missing (${text.length} chars extracted), so an absent leak proves nothing`,
        };
      const leaks = ISOLATION_LEAKS.filter((l) => l.marker.test(text));
      return leaks.length === 0
        ? {
            ok: true,
            detail: "page rendered; no local file or internal address reached",
          }
        : {
            ok: false,
            detail: `the PDF contains ${leaks.map((l) => l.what).join(", ")}`,
          };
    },
    want: "PDF showing the page and nothing of the worker",
  },
  {
    // A page of OURS, its expected text derived from our source
    // (`@/lib/probes/webpage-proof`). Until 2026-10-09 this rendered a
    // third-party example page and required text typed here; the page was
    // replaced, its text moved into the <title> a correct render never
    // prints, and the proof failed while the worker rendered correctly. The
    // guide's body never prints its own URL (held by webpage-proof.test.tsx),
    // so only the print footer can show it.
    tool: "webpage-to-pdf",
    url: WEBPAGE_PROOF.url,
    expect: isPdf,
    verify: verifyPageOnly(WEBPAGE_PROOF.visible, {
      sourceUrl: WEBPAGE_PROOF.url,
    }),
    want: "PDF of the page with no print header or footer",
  },
  {
    // The NEGATIVE control for the spec above, and the only proof that the
    // worker reads the site's answer at all: a guide slug our route answers
    // with a real 404 (`dynamicParams = false`). Until 2026-10-09 this asked a
    // third-party site that answered unknown paths with a 404 carrying its
    // home page, so until 2026-09 it printed a PDF of that page.
    tool: "webpage-to-pdf",
    label: "webpage-to-pdf (404 refused)",
    url: webpageProof404Url(),
    refuses: webpageFetchMessage({ reason: "http", status: 404 }),
    expect: () => false,
    want: "the job refused with the site's 404, not a PDF of the error page",
  },
  // Page layout (2026-10-25), read from the PDF the user downloads: every
  // page box A4 landscape; one long page holding the guide from its h1 to
  // its last FAQ question; and the proof page laid out at the phone and
  // desktop screen widths (its width-dependent heading read back). The
  // plain webpage spec above is the control: Letter pages, narrow.
  {
    tool: "webpage-to-pdf",
    label: "webpage-to-pdf (A4 landscape)",
    url: WEBPAGE_PROOF.url,
    options: { pageSize: "A4", orientation: "landscape" },
    expect: isPdf,
    want: "every page A4 landscape",
    verify: (bytes) =>
      pageSizeVerdict(new Uint8Array(bytes), "A4", "landscape"),
  },
  {
    tool: "webpage-to-pdf",
    label: "webpage-to-pdf (one long page)",
    url: WEBPAGE_PROOF.url,
    options: { onePage: true },
    expect: isPdf,
    want: "one page holding the whole guide",
    verify: async (bytes) =>
      onePageVerdict(
        new Uint8Array(bytes),
        await pdfPlainText(bytes),
        WEBPAGE_PROOF.landmarks,
      ),
  },
  ...(
    [
      ["phone", "narrow"],
      ["desktop", "wide"],
    ] as const
  ).map(([viewport, want]): ProofSpec => ({
    tool: "html-to-pdf",
    label: `html-to-pdf (${viewport} screen)`,
    make: () => layoutProofHtml(),
    name: "layout.html",
    type: "text/html",
    options: { pageSize: "A4", viewport },
    expect: isPdf,
    want: `the page laid out ${want}`,
    verify: async (bytes) => viewportVerdict(await pdfPlainText(bytes), want),
  })),
  // OCR in scripts added 2026-10-25 (and a right-to-left one): each page is
  // typed by the WORKER's Chromium in the image's fonts (and must carry its
  // words as text), scanned to pixels here, then sent to OCR PDF in that
  // language — whose .txt must hold every word in reading order. Hebrew
  // also goes through PDF to Word's OCR option, where right-to-left words
  // could come back reversed. Same samples and verdict as the in-image
  // proof (`@/lib/workers/ocr-languages-proof`).
  ...LIVE_OCR_SAMPLES.flatMap((sample): ProofSpec[] => [
    {
      tool: "html-to-pdf",
      label: `html-to-pdf (${sample.code} sample page)`,
      make: () => samplePageHtml(sample),
      name: `${sample.code}.html`,
      type: "text/html",
      expect: isPdf,
      want: `a typed ${sample.code} page`,
      // A text layer, not the sample's words: Chromium's ToUnicode for a
      // shaped script does not read back as its input (see the in-image
      // proof). The OCR spec below is the evidence about the words.
      verify: async (bytes) => {
        const text = (await pdfPlainText(bytes)).trim();
        return {
          ok: text.length > 0,
          detail: `${text.length} characters of text`,
        };
      },
      keepArtifactAs: `ocr-sample-${sample.code}`,
    },
    {
      tool: "ocr-pdf",
      label: `ocr-pdf (${sample.code}${sample.rtl ? ", rtl" : ""})`,
      from: `ocr-sample-${sample.code}`,
      fromTransform: (typed) => scanOfFirstPage(new Uint8Array(typed), 2200),
      name: "scan.pdf",
      type: PDF_MIME,
      options: { languages: [sample.code], outputMode: "text" },
      artifact: (filename) => filename.endsWith(".txt"),
      expect: (bytes) => bytes.length > 0,
      want: `the ${sample.code} words, in reading order`,
      verify: async (bytes) =>
        sampleVerdict(sample, new TextDecoder().decode(bytes)),
    },
    ...(sample.rtl
      ? [
          {
            tool: "pdf-to-word",
            label: `pdf-to-word (ocr, ${sample.code}, rtl)`,
            from: `ocr-sample-${sample.code}`,
            fromTransform: (typed: Buffer) =>
              scanOfFirstPage(new Uint8Array(typed), 2200),
            name: "scan.pdf",
            type: PDF_MIME,
            options: { ocr: true, languages: [sample.code] },
            // Withheld from PDF to Word's OCR option (its words came back
            // out of order in the image proof): the job must be REFUSED,
            // by name, not converted into a DOCX of scrambled words.
            refuses: PDF_TO_WORD_RTL_REFUSAL,
            expect: () => false,
            want: "a refusal naming the right-to-left languages",
          },
        ]
      : []),
  ]),
  // Until 2026-09-27 this sent one unstyled English line and accepted any
  // `%PDF-`, which the worker passed while its image had no fonts at all:
  // Calibri and Cambria came out in a face with other metrics, and CJK,
  // Bengali, Hindi and Thai as empty boxes. Now the document asks for every
  // Office font and writes every script `office-conversion/fonts.ts` names,
  // and the verdict reads which faces the returned PDF actually embeds.
  {
    tool: "word-to-pdf",
    make: officeFontProofDocx,
    name: "letter.docx",
    type: DOCX_MIME,
    expect: isPdf,
    want: "PDF",
    verify: (bytes) => officeFontProofVerdict(bytes),
  },
  {
    tool: "excel-to-pdf",
    make: xlsxFile,
    name: "sheet.xlsx",
    type: XLSX_MIME,
    expect: isPdf,
    want: "PDF",
  },
  {
    tool: "excel-to-pdf",
    label: "excel-to-pdf (csv)",
    make: csvFile,
    name: "rows.csv",
    type: "text/csv",
    expect: isPdf,
    want: "PDF",
  },
  {
    tool: "powerpoint-to-pdf",
    make: handBuiltPptx,
    name: "deck.pptx",
    type: PPTX_MIME,
    expect: isPdf,
    want: "PDF",
  },
  {
    tool: "pdf-to-word",
    make: async () => Buffer.from(await docxProofPdf()),
    name: "doc.pdf",
    type: PDF_MIME,
    expect: isZipContainer,
    want: "DOCX",
    // `PK` at byte 0 is true of a DOCX with an empty body, and was true of the
    // column-scrambled DOCX this tool shipped. Read the text a reader gets.
    //
    // AND, since 2026-10-17, the picture. Until then this sent `textPdf` and
    // passed every DOCX that carried the words — including the one with none
    // of the owner's 37 pictures that production returned that day. The proof
    // PDF now has a picture between its words and a line under it, and the
    // verdict fails unless the DOCX carries it there, at its size, its pixels
    // decoded (`deployment-proof.ts`, held to its controls by its test).
    verify: (bytes) => docxDeploymentVerdict(bytes),
    keepArtifactAs: "docx-from-pdf",
  },
  // OCR in the same job (2026-10-24): a real scan with no text layer, which
  // the export alone refuses. Passing means OCR ran on the worker AND its
  // words reached the DOCX as text (`@/tests/word-ocr-proof-fixtures`).
  {
    tool: "pdf-to-word",
    label: "pdf-to-word (ocr)",
    make: scannedTextPdf,
    name: "scan.pdf",
    type: PDF_MIME,
    options: { ocr: true, languages: ["eng"] },
    expect: isZipContainer,
    want: "DOCX with the scan's words as text",
    verify: (bytes) => scannedDocxVerdict(new Uint8Array(bytes)),
  },
  // A SECOND reader for the same document: the worker's own LibreOffice,
  // through Word to PDF. It is not Word (`pnpm prove:docx-opens` is), but it
  // is a real word processor laying the document out, so a picture whose
  // part or relationship it cannot resolve paints nothing here even where
  // the XML reads well (`docxRoundTripVerdict`, controls in its test).
  {
    tool: "word-to-pdf",
    label: "word-to-pdf (round-trip)",
    from: "docx-from-pdf",
    name: "doc.docx",
    type: DOCX_MIME,
    expect: isPdf,
    want: "PDF",
    verify: (bytes) => docxRoundTripVerdict(bytes),
  },
  {
    tool: "pdf-to-excel",
    make: async () =>
      Buffer.from(
        await invoicePdf(16, INVOICE_ROWS, { footer: INVOICE_FOOTER }),
      ),
    name: "invoice.pdf",
    type: PDF_MIME,
    expect: isZipContainer,
    want: "XLSX",
    // `PK` at byte 0 was true of the sheet this tool shipped, which put
    // `1,250.00` in two columns and moved every value after an empty cell
    // under the wrong header. Read every cell at its reference instead: the
    // invoice carries a thousands separator, a comma inside text, empty
    // cells, a leading-zero code and currency. And a two-run page footer a
    // blank line below the table, which until 2026-09-27 joined the table
    // and merged its first two columns; the footer's own row is not compared.
    verify: async (bytes) => {
      const sheet = await readXlsxSheet(bytes);
      const problems = [
        ...sheetGridProblems(sheet),
        ...invoiceSheetMismatches(sheet, "invoice"),
      ];
      return problems.length === 0
        ? {
            ok: true,
            detail: `${sheet.rows.length} row(s), every invoice cell at its reference`,
          }
        : {
            ok: false,
            detail: `sheet1.xml differs from the invoice in ${problems.length} place(s): ${problems.slice(0, 4).join("; ")}`,
          };
    },
  },
  {
    tool: "pdf-to-powerpoint",
    make: async () => Buffer.from(await pptxProofPdf()),
    name: "doc.pdf",
    type: PDF_MIME,
    expect: isZipContainer,
    want: "PPTX",
    // `PK` at byte 0 was true of every deck this tool shipped until
    // 2026-09-27, and PowerPoint refused every one of them as "corrupted and
    // unreadable": no master, layout or theme, no slide size, empty shape
    // properties. Walk the package the way PowerPoint does — the same two
    // readers the unit tests run on `main` (readPptx, and the package
    // inspector the worker runs before delivery and in its capability probe),
    // here run on the bytes the deployment returned — then read the
    // fixture's text off a slide.
    //
    // AND, since 2026-10-10, the picture. Until then this sent `textPdf` and
    // passed every deck that opened and carried the text — including the one
    // with no pictures the owner reported. The proof PDF now paints a picture
    // at a known box, and the verdict fails unless slide 1 carries it, as a
    // picture, there, at its pixel size, on a slide the page's size
    // (`deployment-proof.ts`, held to its controls by its test).
    // Keep a copy with PROOF_ARTIFACT_DIR and open it in PowerPoint with
    // `pnpm prove:pptx-opens --file`.
    verify: (bytes) => pptxDeploymentVerdict(bytes),
    keepArtifactAs: "pptx-from-pdf",
  },
  // A SECOND reader for the same deck: LibreOffice, through powerpoint-to-pdf
  // on the same worker. It is NOT the PowerPoint check and cannot stand in for
  // the verdict above: LibreOffice's importer is more forgiving than
  // PowerPoint's, and this round trip has never been shown to go red on a deck
  // PowerPoint refuses. What it adds is that a real office suite laid the deck
  // out, and since 2026-10-10 that what it laid out LOOKS like the page: the
  // PDF it returns is compared with the proof PDF by the fidelity instrument
  // (`fidelity.ts`, the bound the in-image proof holds the fixtures to). Until
  // then the verdict was "one page", which the deck with no pictures passed.
  {
    tool: "powerpoint-to-pdf",
    label: "powerpoint-to-pdf (round-trip)",
    from: "pptx-from-pdf",
    name: "doc.pptx",
    type: PPTX_MIME,
    expect: isPdf,
    want: "PDF",
    verify: async (bytes) => {
      const report = await compareFidelity(await pptxProofPdf(), bytes);
      return {
        ok: report.pass,
        detail: `LibreOffice laid the deck out as ${report.candidatePages} page(s); against the proof PDF: ${report.detail}`,
      };
    },
  },
  {
    tool: "extract-tables",
    make: async () => Buffer.from(await reportTablesPdf()),
    name: "report.pdf",
    type: PDF_MIME,
    expect: isZipContainer,
    want: "ZIP of CSV+XLSX",
    // `PK` at byte 0 was true of the ZIP this tool shipped until 2026-09-27,
    // whose one table had the title as a data row and an empty column in
    // every row. Read every CSV a user gets instead: a report page with a
    // title, a paragraph, two tables (multi-word cells, amounts set flush
    // right), a caption, a two-run note and a footer — both tables, every
    // cell, nothing else, and the workbook beside them. The same verdict runs
    // on real poppler in `table-extract/engine.poppler.test.ts`.
    verify: (bytes) => tablesProofVerdict(bytes),
  },
  {
    tool: "request-signatures",
    make: textPdf,
    name: "agreement.pdf",
    type: PDF_MIME,
    options: {
      signers: [{ name: "Proof Signer", email: "proof@pdf.xyz" }],
      fields: [
        {
          signer: 0,
          page: 1,
          type: "signature",
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.06,
          required: true,
        },
      ],
      routing: "sequential",
    },
    expect: isZipContainer,
    want: "signature-request ZIP",
  },

  // The AI tools, as values a test can run (`@/tests/ai-proof-specs`): what
  // each uploads, asks and accepts. Here they gain only the container check;
  // what each DECLARES is the browser's, added in `runSpec`.
  ...AI_PROOF_SPECS.map((spec): ProofSpec => ({
    ...spec,
    type: PDF_MIME,
    expect: isZipContainer,
  })),
];

/** Worker-backed tools with no spec above — a new tool must arrive with a proof. */
function unspecifiedWorkerTools(): string[] {
  const specified = new Set(SPECS.map((s) => s.tool));
  return getAllToolSlugs().filter((slug) => {
    if (specified.has(slug)) return false;
    const tool = getToolBySlug(slug);
    return tool ? usesWorkerBackend(capabilityForMode(tool.processing)) : false;
  });
}

// ────────────────────────────────── runner ───────────────────────────────────

interface ProofResult {
  label: string;
  outcome: ProofOutcome;
  /**
   * Set on (and only on) an UNPROVEN result: which cause was OBSERVED for this
   * proof. Carried on the row rather than re-derived from `stage`, so the
   * roll-up groups by what happened instead of by how it was printed.
   */
  unprovenCause?: UnprovenCause;
  stage?: string;
  detail?: string;
  seconds?: number;
}

/** Only the response fields this probe actually reads. */
interface UploadSlot {
  url: string;
  method: string;
  headers: Record<string, string>;
  fileId: string;
}
interface ApiResponse {
  slots?: UploadSlot[];
  jobId?: string;
  id?: string;
  status?: string;
  error?: { code: string; message: string; retryable?: boolean };
  artifacts?: { artifactId: string; filename: string }[];
  results?: JobResults;
}

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "canceled",
  "expired",
]);

const carried = new Map<string, Buffer>();

/**
 * The full result of every spec that offered an artifact under `keepArtifactAs`,
 * whatever its outcome — so a spec whose dependency is missing can say WHY
 * rather than reporting the producer's problem as its own. The 2026-08-21 run
 * printed `FAIL chat-with-pdf (follow-up) [options] no carried "chat-answer-1"`,
 * a line that read as a second defect when it was purely the first line's
 * shadow: turn one was refused by the allowance, so turn two never had an
 * artifact to build from.
 */
const producers = new Map<string, ProofResult>();

/**
 * The outcome of a spec whose input artifact never arrived. The tool was not
 * exercised, so this is never FAIL — the evidence (or the refusal) sits on the
 * producer's own line; repeating it here would double-count one cause as two
 * defects. It is always UNPROVEN, with the detail naming the producer so the
 * reader follows the arrow instead of hunting.
 */
function missingDependency(
  label: string,
  artifactKey: string,
  stage: string,
  seconds: number,
): ProofResult {
  const producer = producers.get(artifactKey);
  const detail = !producer
    ? `needs "${artifactKey}", which no spec produced in this run — select the producing spec too`
    : producer.outcome === "unproven"
      ? `needs "${artifactKey}" from "${producer.label}", which was not proven this run — nothing here is evidence about this tool`
      : `needs "${artifactKey}" from "${producer.label}", which did not pass — the defect is on that line, not this one`;
  return {
    label,
    outcome: "unproven",
    unprovenCause: "dependency",
    stage,
    seconds,
    detail,
  };
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json().catch(() => ({}))) as ApiResponse };
}

/**
 * Map a refused POST to the outcome it licenses (see proof-outcome.ts): the
 * deployment's own policy refusing the run is UNPROVEN, everything else FAIL.
 */
function refusalResult(
  label: string,
  stage: string,
  seconds: number,
  res: Response,
  body: ApiResponse,
): ProofResult {
  const verdict = refusalVerdict({
    status: res.status,
    code: body.error?.code ?? null,
    message: body.error?.message ?? null,
  });
  if (verdict.outcome === "unproven") {
    return {
      label,
      outcome: "unproven",
      unprovenCause: verdict.via,
      seconds,
      stage:
        verdict.via === "spend-ceiling" ? "spend ceiling" : "policy refusal",
      detail: verdict.reason,
    };
  }
  return {
    label,
    outcome: "failed",
    seconds,
    stage,
    detail: `HTTP ${res.status} ${JSON.stringify(body).slice(0, 240)}`,
  };
}

async function runSpec(spec: ProofSpec): Promise<ProofResult> {
  const label = spec.label ?? spec.tool;
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  let inputs: string[] = [];
  let inputNames: string[] | undefined;
  let aiDeclaration: AiJobDeclaration = {};

  if (!spec.url) {
    let bytes = spec.from
      ? carried.get(spec.from)
      : Buffer.from(await spec.make!());
    if (!bytes) {
      return missingDependency(label, spec.from!, "input", seconds());
    }
    if (spec.fromTransform) {
      try {
        bytes = Buffer.from(await spec.fromTransform(bytes));
      } catch (error) {
        return {
          label,
          outcome: "failed",
          stage: "input",
          seconds: seconds(),
          detail: `the carried artifact could not be made into this proof's input: ${(error as Error).message}`,
        };
      }
    }
    // Declare the characters (and, for translate, the text PAGES) the BROWSER
    // declares for this file, counted by its panel's own function
    // (`@/lib/probes/ai-proof-declaration`). Until 2026-10-09 every AI proof
    // went undeclared, so each reserved a whole run of the daily allowance
    // whatever its fixture held: one run of the AI proofs spent the day, and
    // the chat proofs were refused for it. Counted BEFORE the upload, as the
    // panel counts — a fixture the browser would refuse, or could not count,
    // is a defect in this proof, reported before anything is sent or charged.
    if (isAiSpec(spec)) {
      const verdict = await browserAiDeclaration(spec.tool, bytes);
      if (verdict.kind !== "declared") {
        return {
          label,
          outcome: "failed",
          stage: "declare",
          seconds: seconds(),
          detail:
            verdict.kind === "refused"
              ? `the browser would refuse this fixture before upload: ${verdict.reason}`
              : `${verdict.reason}, so it would go undeclared and reserve a whole run — fix the fixture; nothing was sent`,
        };
      }
      aiDeclaration = verdict.declaration;
    }
    // Declare what the BROWSER declares, not what this spec believes the type
    // to be. Until 2026-09-27 this sent `spec.type`, hand-typed per fixture,
    // and so reported Word, Excel, PowerPoint and HTML to PDF as PASS while
    // the browser's shared job runner declared every file `application/pdf`
    // and every real user was refused with 415. A proof that builds its own
    // request proves the request it built.
    const declared = declaredContentTypeFor(spec.name ?? "");
    if (!declared) {
      return {
        label,
        outcome: "failed",
        stage: "uploads",
        seconds: seconds(),
        detail: `the browser client would refuse "${spec.name}" locally — no declared type for its extension`,
      };
    }
    const up = await postJson("/api/uploads", {
      tool: spec.tool,
      files: [
        { filename: spec.name, contentType: declared, bytes: bytes.length },
      ],
    });
    if (!up.res.ok) {
      return refusalResult(label, "uploads", seconds(), up.res, up.body);
    }
    const slot = up.body.slots?.[0];
    if (!slot) {
      return {
        label,
        outcome: "failed",
        seconds: seconds(),
        stage: "uploads",
        detail: "the upload session returned no slot",
      };
    }
    const put = await fetch(slot.url, {
      method: slot.method,
      headers: slot.headers,
      // A Buffer view, not the Buffer itself: `fetch` takes a BodyInit.
      body: new Uint8Array(bytes),
    });
    if (!put.ok) {
      return {
        label,
        outcome: "failed",
        seconds: seconds(),
        stage: "storage PUT",
        detail: `HTTP ${put.status}`,
      };
    }
    inputs = [slot.fileId];
    inputNames = [spec.name!];
  }

  const request: Record<string, unknown> = {
    tool: spec.tool,
    inputs,
    ...(inputNames ? { inputNames } : {}),
    ...aiDeclaration,
  };
  // A URL spec's own options ride with the address — the address last, as
  // the panel's client sends it (`runWorkerWebpageToPdf`). Until 2026-10-25
  // a URL spec's `options` were dropped here, which no spec had needed.
  if (spec.url) request.options = { ...spec.options, url: spec.url };
  else if (spec.optionsFrom) {
    const prior = carried.get(spec.optionsFrom.artifact);
    if (!prior) {
      return missingDependency(
        label,
        spec.optionsFrom.artifact,
        "options",
        seconds(),
      );
    }
    try {
      request.options = await spec.optionsFrom.build(prior);
    } catch (error) {
      return {
        label,
        outcome: "failed",
        seconds: seconds(),
        stage: "options",
        detail: (error as Error).message,
      };
    }
  } else if (spec.options) request.options = spec.options;

  const created = await postJson("/api/jobs", request);
  if (!created.res.ok) {
    return refusalResult(
      label,
      "create job",
      seconds(),
      created.res,
      created.body,
    );
  }

  const jobId = created.body.jobId ?? created.body.id;
  if (!jobId) {
    return {
      label,
      outcome: "failed",
      seconds: seconds(),
      stage: "create job",
      detail: "the job was accepted but carried no id",
    };
  }
  const createdAt = Date.now();
  const deadline = createdAt + JOB_TIMEOUT_MS;
  let job = created.body;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await fetch(`${BASE}/api/jobs/${jobId}`);
    job = (await poll.json().catch(() => ({}))) as ApiResponse;
    if (job.status && TERMINAL_STATUSES.has(job.status)) break;
  }
  // This proof waits JOB_TIMEOUT_MS; a browser waits what `jobPollFor` gives
  // its tool. A job that finished between the two was a PASS here and a
  // "still working" to every real user (CLAUDE.md rule 5: check what the
  // reader receives). Measured from creation, as the browser's wait is.
  const stoppedAt = browserStoppedWaitingAt(spec.tool, Date.now() - createdAt);
  if (stoppedAt !== null && job.status && TERMINAL_STATUSES.has(job.status)) {
    return {
      label,
      outcome: "failed",
      seconds: seconds(),
      stage: "browser wait",
      detail: `the job ended "${job.status}" after ${Math.round((Date.now() - createdAt) / 1000)}s; a browser stops waiting for ${spec.tool} at ${Math.round(stoppedAt / 1000)}s`,
    };
  }
  if (spec.refuses !== undefined) {
    const verdict = judgeExpectedRefusal(spec.refuses, job);
    return verdict.ok
      ? {
          label,
          outcome: "proven",
          seconds: seconds(),
          detail: verdict.detail,
        }
      : {
          label,
          outcome: "failed",
          seconds: seconds(),
          stage: "expected refusal",
          detail: verdict.detail,
        };
  }
  if (spec.expectFailure) {
    const want = spec.expectFailure;
    const got = job.error;
    const matches =
      job.status === "failed" &&
      got?.code === want.code &&
      got.retryable === want.retryable &&
      want.message.test(got.message);
    return matches
      ? {
          label,
          outcome: "proven",
          seconds: seconds(),
          detail: `refused as ${want.code} (retryable: ${want.retryable}) — ${spec.want}`,
        }
      : {
          label,
          outcome: "failed",
          seconds: seconds(),
          stage: `job ${job.status ?? "timeout"}`,
          detail: `wanted ${spec.want}, got ${
            got
              ? `${got.code} (retryable: ${String(got.retryable)}): ${got.message}`
              : "no error"
          }`.slice(0, 240),
        };
  }
  if (job.status !== "completed") {
    return {
      label,
      outcome: "failed",
      seconds: seconds(),
      stage: `job ${job.status ?? "timeout"}`,
      detail: job.error
        ? `${job.error.code}: ${job.error.message}`.slice(0, 240)
        : "",
    };
  }

  const artifact = spec.artifact
    ? job.artifacts?.find((a) => spec.artifact!(a.filename))
    : job.artifacts?.[0];
  if (!artifact)
    return {
      label,
      outcome: "failed",
      seconds: seconds(),
      stage: "no artifact",
      detail: spec.artifact
        ? `none of ${job.artifacts?.length ?? 0} artifact(s) is the ${spec.want}`
        : "",
    };

  const download = await fetch(`${BASE}/api/artifacts/${artifact.artifactId}`, {
    redirect: "follow",
  });
  const buf = Buffer.from(await download.arrayBuffer());
  if (!download.ok) {
    return {
      label,
      outcome: "failed",
      seconds: seconds(),
      stage: "artifact download",
      detail: `HTTP ${download.status}`,
    };
  }
  // Opt-in: keep what a user would download, for instruments this harness
  // cannot run — e.g. `pnpm prove:pptx-opens --file <dir>/pdf-to-powerpoint.pptx`
  // opens the production .pptx in PowerPoint on Windows. Generated fixtures
  // only, so nothing kept here is a user's document.
  if (ARTIFACT_DIR) {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(
      path.join(
        ARTIFACT_DIR,
        `${label.replace(/[^\w.-]+/g, "-")}${path.extname(artifact.filename)}`,
      ),
      buf,
    );
  }
  if (!spec.expect(buf)) {
    return {
      label,
      outcome: "failed",
      seconds: seconds(),
      stage: "artifact shape",
      detail: `wanted ${spec.want}, got ${buf.length}B starting ${JSON.stringify(buf.subarray(0, 8).toString("latin1"))}`,
    };
  }
  // Contents, once the envelope is right. Kept separate from `expect` so a failure
  // here reads as "the tool ran but did not do the thing", not "wrong file type".
  let verified = "";
  if (spec.verify) {
    let outcome: { ok: boolean; detail: string };
    try {
      outcome = await spec.verify(buf, job);
    } catch (error) {
      outcome = { ok: false, detail: (error as Error).message };
    }
    if (!outcome.ok) {
      return {
        label,
        outcome: "failed",
        seconds: seconds(),
        stage: "artifact contents",
        detail: outcome.detail,
      };
    }
    verified = ` — ${outcome.detail}`;
  }
  if (spec.keepArtifactAs) carried.set(spec.keepArtifactAs, buf);
  return {
    label,
    outcome: "proven",
    seconds: seconds(),
    detail: `${artifact.filename} — ${buf.length}B ${spec.want}${verified}`,
  };
}

// ─────────────────────── the AI set, and the proof ledger ────────────────────

/**
 * Whether a spec's job spends the free AI allowance — the SAME predicate
 * `POST /api/jobs` applies before charging `ai.run` (`capabilityForMode(...)
 * === "ai"`), imported rather than restated as a slug list, so a tool that
 * becomes (or stops being) AI moves this harness with it. A hand-typed list
 * here would be a set that cannot see a tool it does not name.
 */
function isAiSpec(spec: ProofSpec): boolean {
  const tool = getToolBySlug(spec.tool);
  return tool ? capabilityForMode(tool.processing) === "ai" : false;
}

/**
 * Where each deployment's "last proven" record lives. Local to the operator's
 * machine on purpose: the ledger informs THIS operator's rotation and report;
 * it is not a shared claim about the deployment (a different machine proves
 * for itself). Keyed by deployment origin so proving staging never marks
 * production proven.
 */
const LEDGER_PATH = path.resolve(
  process.cwd(),
  ".worker-prove-tools-ledger.json",
);

interface LedgerFile {
  version: 1;
  deployments: Record<string, DeploymentProofLedger>;
}

/**
 * Load the ledger. A missing file is a normal first run; an unreadable one is
 * loud and makes this run NON-persisting, so a corrupt history is never
 * silently overwritten — the operator inspects or deletes it deliberately
 * (a control needs a copy, not a clobber).
 */
function loadLedger(): { file: LedgerFile; writable: boolean; note?: string } {
  if (!existsSync(LEDGER_PATH)) {
    return { file: { version: 1, deployments: {} }, writable: true };
  }
  try {
    const parsed = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as LedgerFile;
    if (parsed?.deployments && typeof parsed.deployments === "object") {
      return {
        file: { version: 1, deployments: parsed.deployments },
        writable: true,
      };
    }
  } catch {
    // fall through to the non-persisting report below
  }
  return {
    file: { version: 1, deployments: {} },
    writable: false,
    note:
      `the proof ledger at ${LEDGER_PATH} is unreadable; running WITHOUT it ` +
      `and leaving the file untouched — inspect or delete it, then rerun`,
  };
}

const OUTCOME_TOKEN: Record<ProofOutcome, string> = {
  proven: "PASS",
  failed: "FAIL",
  unproven: "UNPROVEN",
};

async function main(): Promise<number> {
  // The harness's own corpus, bounded before anything runs (a blind predicate
  // reports the strongest possible pass): the AI predicate must match some
  // spec — this product ships AI tools, and an empty match means the predicate
  // broke, not that AI left the catalog — and spec keys must be unique, or two
  // proofs would share one ledger entry and the rotation would misread both.
  const keys = SPECS.map(specKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      "duplicate spec keys in SPECS — give the duplicates distinct labels",
    );
  }
  if (SPECS.filter(isAiSpec).length === 0) {
    throw new Error(
      "the AI-spec predicate matched nothing — capabilityForMode or the " +
        "catalog changed shape; fix the predicate before trusting this run",
    );
  }

  const missing = unspecifiedWorkerTools();
  const selected = SPECS.filter(
    (s) =>
      ONLY.length === 0 ||
      ONLY.includes(s.tool) ||
      ONLY.includes(s.label ?? ""),
  );
  if (selected.length === 0) {
    console.log(`No spec matches ${ONLY.join(", ")}.`);
    return EXIT_DEFECT;
  }

  const ledgerState = loadLedger();
  const deployment = (() => {
    try {
      return new URL(BASE).origin;
    } catch {
      return BASE;
    }
  })();
  const ledger: DeploymentProofLedger =
    ledgerState.file.deployments[deployment] ?? {};
  if (ledgerState.note) console.log(`WARNING: ${ledgerState.note}\n`);

  // Least-recently-proven AI tools first, so a partial allowance is spent on
  // whatever has gone longest without proof rather than on SPECS order.
  const ordered = orderSpecsForAllowance(selected, isAiSpec, ledger);

  console.log(`Proving ${ordered.length} tool run(s) against ${BASE}\n`);
  const results: ProofResult[] = [];
  for (const spec of ordered) {
    let result: ProofResult;
    try {
      result = await runSpec(spec);
    } catch (error) {
      result = {
        label: spec.label ?? spec.tool,
        outcome: "failed",
        stage: "threw",
        detail: (error as Error).message,
      };
    }
    results.push(result);
    if (spec.keepArtifactAs) producers.set(spec.keepArtifactAs, result);
    console.log(
      `${OUTCOME_TOKEN[result.outcome].padEnd(8)}  ${result.label.padEnd(24)} ` +
        `${String(result.seconds ?? "-") + "s"}`.padStart(5) +
        `  ${
          result.outcome === "proven"
            ? result.detail
            : `[${result.stage}] ${result.detail ?? ""}`
        }`,
    );
  }

  const byOutcome = (o: ProofOutcome) => results.filter((r) => r.outcome === o);
  const proven = byOutcome("proven").length;
  const failed = byOutcome("failed").length;
  const unproven = byOutcome("unproven");

  console.log(
    `\n${proven}/${results.length} proven end to end against ${BASE}`,
  );
  if (failed > 0) console.log(`${failed} FAILED — evidence of a defect.`);
  if (unproven.length > 0) {
    // One line per cause OBSERVED, never one sentence over the union: the
    // first production run of this feature printed "5 UNPROVEN — refused by
    // the deployment's own policy … chat-with-pdf (follow-up)" when the
    // follow-up was refused by nothing and never asked. A row that carries no
    // cause would silently vanish from the grouped lines, so it is fatal
    // rather than a count that quietly shrinks.
    const unprovenRows: { label: string; cause: UnprovenCause }[] = [];
    const uncaused: string[] = [];
    for (const r of unproven) {
      if (r.unprovenCause) {
        unprovenRows.push({ label: r.label, cause: r.unprovenCause });
      } else {
        uncaused.push(r.label);
      }
    }
    if (uncaused.length > 0) {
      throw new Error(
        `UNPROVEN with no observed cause: ${uncaused.join(", ")} — every site ` +
          `that returns outcome "unproven" must set unprovenCause`,
      );
    }
    for (const line of unprovenSummaryLines(unprovenRows)) console.log(line);
  }

  // Record this run's passes for the AI rotation, then say when every AI
  // proof last passed — the harness's answer to "when was each tool last
  // proven", printed every run so staleness is visible before it matters.
  const provenNow = new Date().toISOString();
  const aiKeys = new Set(SPECS.filter(isAiSpec).map(specKey));
  for (const r of byOutcome("proven")) {
    if (aiKeys.has(r.label)) ledger[r.label] = { lastProvenAt: provenNow };
  }
  if (ledgerState.writable) {
    ledgerState.file.deployments[deployment] = ledger;
    writeFileSync(
      LEDGER_PATH,
      `${JSON.stringify(ledgerState.file, null, 2)}\n`,
    );
  }
  console.log(`\nAI proofs — last proven against ${deployment}:`);
  for (const spec of SPECS.filter(isAiSpec)) {
    const at = ledger[specKey(spec)]?.lastProvenAt;
    console.log(
      `  ${specKey(spec).padEnd(28)} ${
        at ? `${at}${at === provenNow ? "  (this run)" : ""}` : "never"
      }`,
    );
  }

  // Only meaningful on a full run — a filtered run says nothing about coverage.
  if (ONLY.length === 0 && missing.length > 0) {
    console.log(
      `\nNO PROOF SPEC for ${missing.length} worker-backed tool(s): ${missing.join(", ")}` +
        `\nAdd one to SPECS in this file — an unproven tool is one nobody has checked works.`,
    );
  }

  const code = harnessExitCode({
    outcomes: results.map((r) => r.outcome),
    unspecifiedToolCount: missing.length,
    fullRun: ONLY.length === 0,
  });
  if (code === EXIT_INCOMPLETE) {
    console.log(
      `\nExit 2: incomplete, not failing — nothing failed, but not every ` +
        `selected proof could run. Rerun after the allowance resets; the ` +
        `rotation will spend it on the stalest AI proofs first.`,
    );
  }
  return code;
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
