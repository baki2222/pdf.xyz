/**
 * `pnpm worker:translate-reading-order-proof` — Translate PDF's reading order
 * inside the built worker image (slice 3 of competitor audit #29,
 * 2026-11-16).
 *
 *  1. The start-up proof the heartbeat publishes (`translateReadingOrder`):
 *     a generated two-column page as one translate-pdf job through the
 *     executor's order, with the image's REAL Translate extractor
 *     (`pdftotext -layout`, then `-bbox-layout`). Must be true. Prints the
 *     verdict's `failed` list (empty) and `pdftotext -v`.
 *  2. The control: the same probe wired to the SHARED resolver every other AI
 *     tool reads (`resolveNativePdfTextExtractor`). Must be false, and false
 *     FOR ORDER — its `failed` list must include "order_sent" and
 *     "order_delivered" (printed), not merely "source".
 *  3. The measurement corpus, one row per page, never document text: the
 *     page's `-layout` characters, its flow characters, sameInk, the mode it
 *     was sent as and why, and per document the bbox stdout bytes and the
 *     milliseconds of each pdftotext run. Each document is also planned twice
 *     — as sent, and as `-layout` only — and must give the SAME text pages,
 *     chunk page-sets, oversize pages, withheld pages and bound; and it is run
 *     as a whole job (`runTranslate`, stub provider) that must succeed.
 *
 * Exit codes: 0 = proven; 1 = the probe false, the control true, a control
 * whose `failed` lacks "order_sent" or "order_delivered", a lost page, a
 * page-set difference, a corpus job that failed, or a corpus document that
 * was not generated or not measured (the corpus may not shrink); 2 = no pdftotext in this
 * image. Run by `.github/workflows/container.yml`; no secret, queue, store,
 * network, model or user document is touched — the model is a stub and every
 * document is generated here.
 */
import { spawnSync } from "node:child_process";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedDrawingFont, setFontByteSource } from "@/lib/pdf/unicode-font";
import { readNotoTtf } from "@/lib/pdf/noto-source";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { normalizeExtractedText, pageTextChunks } from "@/lib/pdf/text";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import { AI_CHARACTER_ALLOWANCE_DELIVERED } from "@/lib/jobs/ai-allowance";
import { TRANSLATE_FLOW_TIMEOUT_MS } from "@/lib/jobs/translate-reading-order";
import type { AiProvider } from "@/lib/workers/ai/provider";
import {
  defaultPdfTextExec,
  resolveNativePdfTextExtractor,
  type PdfTextExec,
} from "@/lib/workers/pdf-text/native";
import { resolveNativePdfTextConfig } from "@/lib/workers/pdf-text/native-config";
import { encodePngImage } from "@/lib/workers/pdf-office-export/png-encode";
import {
  capPagesToDelivery,
  planTranslateChunks,
  type PlannedPage,
} from "@/lib/workers/translate/chunking";
import { runTranslate } from "@/lib/workers/translate/engine";
import {
  nativeTranslatePdfRender,
  translateDeps,
} from "@/lib/workers/translate/native";
import { LANGUAGE_SAMPLES } from "@/lib/workers/translate/pdf-capability";
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";
import {
  sameInk,
  translatePageBlocks,
  type TranslateExtractor,
} from "@/lib/workers/translate/reading-order";
import {
  probeTranslateReadingOrder,
  proofCorpusShortfall,
  readingOrderProbePdf,
} from "@/lib/workers/translate/reading-order-capability";
import {
  highlightsPdf,
  newsletterPdf,
  quarterlyTablePdf,
  sidebarPdf,
} from "@/tests/pdf-office-fixtures";
import { ocrdScanPdf } from "@/tests/docx-picture-fixtures";

// ── Generated documents ────────────────────────────────────────────────────

// The CJK, Arabic and Hebrew pages embed a Noto face. A browser fetches it from
// `/fonts/`; here it is read from the same TTFs the copy step ships, as
// `worker-prove-tools.ts` does.
setFontByteSource(async (pack) => readNotoTtf(pack));

/** "shalom olam" in Hebrew, built from code points (tool-layer safe). */
const HEBREW_SAMPLE = String.fromCodePoint(
  0x5e9,
  0x5dc,
  0x5d5,
  0x5dd,
  0x20,
  0x5e2,
  0x5d5,
  0x5dc,
  0x5dd,
);

/** Deterministic prose: no document text is ever printed, only counted. */
const WORDS =
  "the report shows that revenue grew while costs fell across every region and the board expects steady growth next year as new products reach more customers in older markets where demand has held firm despite higher prices for energy and transport over the last two quarters".split(
    " ",
  );

function proseLines(seed: number, count: number, width: number): string[] {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
  const lines: string[] = [];
  for (let n = 0; n < count; n++) {
    let line = "";
    while (line.length < width) {
      const w = WORDS[next() % WORDS.length]!;
      line = line ? `${line} ${w}` : w;
    }
    lines.push(line);
  }
  return lines;
}

async function textFont(doc: PDFDocument, texts: string[]): Promise<PDFFont> {
  return embedDrawingFont(doc, texts);
}

function drawLines(
  page: PDFPage,
  lines: readonly string[],
  font: PDFFont,
  x: number,
  top: number,
  size: number,
  paragraphEvery = 6,
): void {
  let y = top;
  lines.forEach((line, i) => {
    page.drawText(line, { x, y, size, font });
    y -= size * 1.35;
    if ((i + 1) % paragraphEvery === 0) y -= size * 1.35;
  });
}

/** A single-column prose document, 40 lines a page. */
async function prosePdf(pages: number, seed: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const all = Array.from({ length: pages }, (_, p) =>
    proseLines(seed + p, 40, 88),
  );
  const font = await textFont(doc, all.flat());
  for (const lines of all)
    drawLines(doc.addPage([612, 792]), lines, font, 50, 740, 10);
  return doc.save();
}

/** A two-column paper: each page two columns of prose on shared baselines. */
async function twoColumnPaperPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const cols = Array.from({ length: pages }, (_, p) => [
    proseLines(100 + p * 2, 42, 44),
    proseLines(101 + p * 2, 42, 44),
  ]);
  const font = await textFont(doc, cols.flat(2));
  for (const [left, right] of cols) {
    const page = doc.addPage([612, 792]);
    drawLines(page, left!, font, 50, 740, 9.5);
    drawLines(page, right!, font, 320, 740, 9.5);
  }
  return doc.save();
}

/** One page of a script's sample, repeated over several lines. */
async function scriptPagePdf(sample: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const lines = Array.from({ length: 8 }, () => sample);
  const font = await textFont(doc, lines);
  drawLines(doc.addPage([612, 792]), lines, font, 50, 740, 14, 4);
  return doc.save();
}

/**
 * A right-to-left page. The text tools' pdf-lib drawing refuses RTL scripts
 * (it lays every line out left to right), so these pages are printed by the
 * image's Chromium through Translate's own reflowed-PDF renderer, which sets
 * them right to left. Absent Chromium, the page is not generated, and the
 * proof FAILS: an RTL row with no witness may not pass as measured.
 */
async function rtlPagePdf(
  text: string,
  target: TranslateLanguage,
): Promise<Uint8Array> {
  const render = nativeTranslatePdfRender(process.env);
  if (!render) throw new Error("no Chromium renderer in this image");
  const body = Array.from({ length: 8 }, () => text).join(" ");
  const result = await render({
    input: {
      parts: [{ kind: "body", pages: [1], text: body, chosen: null }],
      target,
      sourceName: "reading-order-proof.pdf",
    },
  });
  if (!result.ok) throw new Error(`render refused: ${result.reason}`);
  return result.bytes;
}

/** A text page, then a blank page, a whitespace-only page, an image-only page. */
async function emptyPagesPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const lines = proseLines(7, 20, 80);
  const font = await textFont(doc, [...lines, " "]);
  drawLines(doc.addPage([612, 792]), lines, font, 50, 740, 10);
  doc.addPage([612, 792]);
  doc.addPage([612, 792]).drawText("   ", { x: 50, y: 700, size: 12, font });
  const w = 60;
  const h = 40;
  const pixels = new Uint8Array(w * h * 3).fill(128);
  const picture = await embedRasterImage(
    doc,
    encodePngImage(w, h, "rgb8", pixels),
    "png",
  );
  const imagePage = doc.addPage([612, 792]);
  imagePage.drawRectangle({
    x: 40,
    y: 40,
    width: 20,
    height: 20,
    color: rgb(0.5, 0.5, 0.5),
  });
  await drawRasterImage(imagePage, picture, {
    x: 72,
    y: 400,
    width: 300,
    height: 200,
  });
  return doc.save();
}

// ── Measurement ────────────────────────────────────────────────────────────

interface Run {
  mode: "layout" | "bbox" | "other";
  ms: number;
  bytes: number;
  error?: string;
}

const runs: Run[] = [];

/** The real exec, timed and counted per mode. Never logs stdout. */
const measuringExec: PdfTextExec = async (command, args, options) => {
  const mode = args.includes("-bbox-layout")
    ? "bbox"
    : args.includes("-layout")
      ? "layout"
      : "other";
  const t0 = performance.now();
  try {
    const out = await defaultPdfTextExec(command, args, options);
    runs.push({
      mode,
      ms: Math.round(performance.now() - t0),
      bytes: Buffer.byteLength(out, "utf8"),
    });
    return out;
  } catch (err) {
    runs.push({
      mode,
      ms: Math.round(performance.now() - t0),
      bytes: -1,
      error: err instanceof Error ? err.name : "unknown",
    });
    throw err;
  }
};

const constantProvider: AiProvider = {
  id: "anthropic",
  model: "capability-probe",
  async complete() {
    return {
      ok: true,
      text: "translated",
      model: "capability-probe",
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  },
};

const pageSets = (
  pages: readonly PlannedPage[],
  limit?: { characters: number; pages?: number },
) => {
  const plan = planTranslateChunks(pages, TRANSLATE_MAX_INPUT_CHARS);
  const capped = limit
    ? capPagesToDelivery(pages, TRANSLATE_MAX_INPUT_CHARS, limit)
    : null;
  return JSON.stringify({
    chunks: plan.chunks.map((c) => c.pages),
    oversize: plan.oversize.map((o) => o.pageNumber),
    capped: capped
      ? {
          chunks: capped.plan.chunks.map((c) => c.pages),
          withheld: capped.withheldPages,
          boundBy: capped.boundBy,
        }
      : null,
  });
};

interface DocResult {
  name: string;
  pages: number;
  layoutChars: number;
  flowChars: number;
  source: string;
  flowPages: number;
  fellBack: { ink: number; longer: number; rtl: number };
  bboxBytes: number;
  layoutMs: number;
  bboxMs: number;
  jobOk: boolean;
  jobMs: number;
  problems: string[];
}

async function measure(
  name: string,
  bytes: Uint8Array,
  extract: TranslateExtractor,
): Promise<DocResult> {
  runs.length = 0;
  const extracted = await extract(bytes);
  const layoutRun = runs.find((r) => r.mode === "layout");
  const bboxRun = runs.find((r) => r.mode === "bbox");
  const { blocks, tally } = translatePageBlocks(extracted.pages);
  const problems: string[] = [];

  // Lost pages: the text-page set must be exactly -layout's.
  const layoutPages = pageTextChunks(extracted.pages).map((p) => p.pageNumber);
  const sentPages = blocks.map((b) => b.pageNumber);
  if (JSON.stringify(layoutPages) !== JSON.stringify(sentPages))
    problems.push(
      `text pages differ: layout ${layoutPages.length} sent ${sentPages.length}`,
    );

  // Page sets: as sent vs -layout only, uncapped and at two caps.
  const layoutOnly = blocks.map(({ pageNumber, text }) => ({
    pageNumber,
    text,
  }));
  for (const limit of [
    undefined,
    { characters: AI_CHARACTER_ALLOWANCE_DELIVERED },
    { characters: Number.POSITIVE_INFINITY, pages: 2 },
  ]) {
    if (pageSets(blocks, limit) !== pageSets(layoutOnly, limit))
      problems.push(
        `page sets differ at ${JSON.stringify(limit ?? "uncapped")}`,
      );
  }

  console.log(
    `  ${name}: ${extracted.pageCount} pages, source ${extracted.readingOrder?.source ?? "(none)"}`,
  );
  let layoutChars = 0;
  let flowChars = 0;
  for (const page of extracted.pages) {
    const text = normalizeExtractedText(page.text);
    const send =
      page.send === undefined ? undefined : normalizeExtractedText(page.send);
    const one = translatePageBlocks([page]);
    const reason =
      text.length === 0
        ? "no text"
        : one.tally.flowPages === 1
          ? "flow"
          : page.send === undefined
            ? "no flow"
            : one.tally.fellBack.rtl
              ? "rtl"
              : one.tally.fellBack.ink
                ? "ink"
                : "longer";
    layoutChars += text.length;
    if (send !== undefined && text.length > 0) flowChars += send.length;
    const sent = blocks.find((b) => b.pageNumber === page.pageNumber);
    console.log(
      `    p${page.pageNumber}: layout ${text.length} flow ${send?.length ?? "-"} sameInk ${send === undefined ? "-" : sameInk(text, send)} sent ${sent ? (sent.send !== undefined ? "flow" : "layout") : "none"} (${reason})`,
    );
  }

  // The whole job: runTranslate on the same bytes with a stub provider.
  runs.length = 0;
  const t0 = performance.now();
  // Production's limits and a production-sized delivery cap: every real job
  // carries one, and the bucket fits a reservation of this size.
  const job = await runTranslate(
    bytes,
    { targetLanguage: "fr", sourceLanguage: "en" },
    {
      extract,
      provider: constantProvider,
      now: () => "1970-01-01T00:00:00.000Z",
      limits: {
        ...translateDeps(process.env).limits,
        delivery: { characters: AI_CHARACTER_ALLOWANCE_DELIVERED },
      },
    },
  );
  const jobMs = Math.round(performance.now() - t0);
  const textPages = layoutPages.length;
  const jobOk = textPages === 0 ? !job.ok : job.ok;
  if (!jobOk) problems.push(`job ${job.ok ? "ok" : `failed: ${job.kind}`}`);

  const result: DocResult = {
    name,
    pages: extracted.pageCount,
    layoutChars,
    flowChars,
    source: extracted.readingOrder?.source ?? "(none)",
    flowPages: tally.flowPages,
    fellBack: tally.fellBack,
    bboxBytes: bboxRun?.bytes ?? 0,
    layoutMs: layoutRun?.ms ?? 0,
    bboxMs: bboxRun?.ms ?? 0,
    jobOk,
    jobMs,
    problems,
  };
  console.log(
    `    => ratio ${layoutChars ? (flowChars / layoutChars).toFixed(4) : "-"} flowPages ${tally.flowPages} layoutPages ${tally.layoutPages} fellBack ink ${tally.fellBack.ink} longer ${tally.fellBack.longer} rtl ${tally.fellBack.rtl}; -layout ${result.layoutMs} ms ${layoutRun?.bytes ?? "-"} B; -bbox-layout ${bboxRun ? `${bboxRun.ms} ms ${bboxRun.bytes} B${bboxRun.error ? ` ERROR ${bboxRun.error}` : ""} (${extracted.pageCount ? Math.round(bboxRun.bytes / extracted.pageCount) : 0} B/page)` : "not run"}; job ${job.ok ? "ok" : `refused (${job.kind})`} ${jobMs} ms${problems.length ? `; PROBLEMS: ${problems.join("; ")}` : ""}`,
  );
  return result;
}

async function main(): Promise<number> {
  const config = resolveNativePdfTextConfig(process.env);
  const version = spawnSync(config.binary, ["-v"], { encoding: "utf8" });
  const banner = `${version.stdout ?? ""}${version.stderr ?? ""}`.trim();
  console.log(`pdftotext -v: ${banner.split("\n")[0] || "(no output)"}`);
  console.log(
    `bounds: flow timeout ${TRANSLATE_FLOW_TIMEOUT_MS} ms (config ${config.timeoutMs} ms), maxBuffer ${config.maxOutputBytes} B`,
  );

  const extract = translateDeps(
    process.env,
    {},
    {},
    { exec: measuringExec },
  ).extract;
  const shared = resolveNativePdfTextExtractor(process.env);
  if (!extract || !shared) {
    console.log("CANNOT CONCLUDE — pdftotext is not available in this image.");
    return 2;
  }

  const failures: string[] = [];

  const t0 = performance.now();
  const probe = await probeTranslateReadingOrder({
    extract: translateDeps(process.env).extract,
    env: process.env,
  });
  console.log(
    `probe (Translate's composite): ${probe.ok ? "PASS" : "FAIL"} failed=[${probe.failed.join(",")}] ${Math.round(performance.now() - t0)} ms`,
  );
  if (!probe.ok) failures.push("the probe is false");

  const control = await probeTranslateReadingOrder({
    extract: shared,
    env: process.env,
  });
  console.log(
    `control (shared resolver): ${control.ok ? "TRUE (WRONG)" : "false"} failed=[${control.failed.join(",")}]`,
  );
  if (control.ok) failures.push("the control is true");
  if (
    !control.failed.includes("order_sent") ||
    !control.failed.includes("order_delivered")
  )
    failures.push("the control did not fail on order");

  const corpus: [string, () => Promise<Uint8Array>][] = [
    ["probe page", readingOrderProbePdf],
    ["prose (3 pages)", () => prosePdf(3, 1)],
    ["two-column paper (3 pages)", () => twoColumnPaperPdf(3)],
    ["newsletter", newsletterPdf],
    ["sidebar", sidebarPdf],
    ["highlights", highlightsPdf],
    ["4-column table", quarterlyTablePdf],
    ["invisible text (OCR layer)", async () => (await ocrdScanPdf()).pdf],
    ["CJK (zh)", () => scriptPagePdf(LANGUAGE_SAMPLES.zh)],
    ["CJK (ja)", () => scriptPagePdf(LANGUAGE_SAMPLES.ja)],
    ["Arabic", () => rtlPagePdf(LANGUAGE_SAMPLES.ar, "ar")],
    ["Hebrew", () => rtlPagePdf(HEBREW_SAMPLE, "en")],
    ["blank, whitespace-only and image-only pages", emptyPagesPdf],
    ["prose (300 pages)", () => prosePdf(300, 1000)],
  ];

  console.log("measurement corpus:");
  const results: DocResult[] = [];
  for (const [name, make] of corpus) {
    let bytes: Uint8Array;
    try {
      bytes = await make();
    } catch (err) {
      const why =
        err instanceof Error
          ? `${err.name}: ${err.message.slice(0, 80)}`
          : "unknown";
      console.log(`  ${name}: NOT GENERATED (${why})`);
      // A document that is not generated is not measured; the corpus would
      // shrink and PASS would stand on what is left (CLAUDE.md rule 4).
      failures.push(`${name}: not generated (${why})`);
      continue;
    }
    const r = await measure(name, bytes, extract);
    results.push(r);
    for (const p of r.problems) failures.push(`${name}: ${p}`);
  }

  // Independent of the catch above: the set measured must BE the set
  // declared, whatever path a document took out of the loop.
  for (const s of proofCorpusShortfall(
    corpus.map(([name]) => name),
    results.map((r) => r.name),
  ))
    failures.push(s);
  console.log(`corpus: ${results.length} of ${corpus.length} measured`);

  console.log("summary:");
  for (const r of results)
    console.log(
      `  ${r.name}: layout ${r.layoutChars} flow ${r.flowChars} ratio ${r.layoutChars ? (r.flowChars / r.layoutChars).toFixed(4) : "-"} source ${r.source} flowPages ${r.flowPages}/${r.pages} fellBack ink ${r.fellBack.ink} longer ${r.fellBack.longer} rtl ${r.fellBack.rtl} bbox ${r.bboxBytes} B ${r.bboxMs} ms layout ${r.layoutMs} ms job ${r.jobOk ? "ok" : "FAILED"} ${r.jobMs} ms`,
    );

  if (failures.length > 0) {
    console.log(`READING ORDER PROOF: ${failures.length} FAILED`);
    for (const f of failures) console.log(`  - ${f}`);
    return 1;
  }
  console.log("READING ORDER PROOF: PASS");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.log(
      `FAIL — the proof threw: ${error instanceof Error ? error.name : "unknown"}`,
    );
    process.exit(1);
  },
);
