/**
 * Does THIS worker image write a .pptx with the chain PowerPoint needs?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * When this was written (2026-09-27) the web tier auto-deployed from `main`
 * and the worker image was built by hand. `publish.yml` now deploys both tiers
 * on every push to main, but merging is still not shipping: a publish can
 * fail (#167's did, on 2026-10-09) and leave production's worker behind main.
 * The fix that gave PDF to PowerPoint its slide master, layout and theme
 * changes nothing a user downloads until an image carrying it is running, and
 * nothing on the web tier could tell whether one is. The catalogue
 * promised "an editable PowerPoint slide" per page until 2026-10-09 (it now
 * says "its own slide in a .pptx file": nobody has edited one), so the
 * question is the 2026-08-21 one again (`translate/capability.ts`): does the
 * running image do what the copy says?
 *
 * ── WHAT IT RUNS ─────────────────────────────────────────────────────────────
 *
 * The real `runPdfOfficeExport`, the function the processor calls, then
 * `inspectPptxPackage` over the bytes it returned. It reads the engine's
 * OUTPUT, not the generator's source, so an engine that stopped writing a part
 * fails here however its code is arranged. Since 2026-10-09 the engine also
 * runs that inspector itself and refuses to deliver a deck that fails it, so
 * `false` here means the same thing whether the probe or the engine saw the
 * problem first.
 *
 * Until 2026-10-10 the input was a 4-byte stand-in and a synthetic three-page
 * extraction, which was all the engine read. Since then PDF to PowerPoint
 * reads the PAGES (`./page-scan`), and answers `unsupported` without that
 * reader, so the probe would have reported `false` on a healthy image. It now
 * generates a real three-page PDF (text, a blank page, text and a picture) and
 * runs it through the real page reader; only pdftotext, which the engine runs
 * to classify a refusal, is stood in for. An image without the page reader
 * publishes `false`.
 *
 * ── WHAT A PASS DOES AND DOES NOT MEAN ──────────────────────────────────────
 *
 * A pass means this image's engine writes the structural chain, one slide per
 * page, and every relationship in it resolves. It does NOT mean PowerPoint
 * opens the file; there is no PowerPoint on a Linux worker. That property was
 * measured on Windows with `scripts/prove-pptx-opens.ts`: on 2026-09-27 for
 * the writer of that day, and again on 2026-10-09 for the one that replaced it
 * (`./pptx-package`, behind the engine's delivery inspection). PowerPoint 16.0
 * build 20430 opened a real 3-page job as 3 slides with 1 master and read
 * every page's text back, reopened a deck it saved itself, and refused the
 * pre-fix package (0x80070570). The extractor on that host was Xpdf 4.00's
 * `pdftotext`, not the worker's poppler; the writer is the same either way.
 * The writer of 2026-10-10, with pictures, has been through the same COM open
 * (see the content docblock), not through a double-click.
 *
 * This probe says whether the running image's engine writes decks that pass
 * the inspection the measured one passed. It cannot tell two such writers
 * apart, and the name, `pptxPresentationChain`, promises no more than that.
 * Whether the deck carries the page's PICTURES is `provesPptxPictures`, a
 * separate key with a separate promise.
 *
 * An image built before this module publishes no such key, the reader parses
 * the absence as `false`, and the old image does not have to cooperate.
 *
 * Since 2026-10-17 the same question is asked of PDF to Word: does the
 * running image's .docx carry a page's picture, as a picture, between the
 * lines around it (`provesDocxPictures`, at the end of this file; the key
 * `docxPictures`)?
 */

import { PDFDocument, rgb } from "pdf-lib";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { decodePng } from "@/lib/png-probe";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import {
  proveThroughExecutorOrder,
  type ExecutorOrderJob,
} from "../capability-chain";
import { createProcessorRegistry } from "../processor";
import { createPdfOfficeExportProcessor } from "../processor/pdf-office-export";
import { ProcessorRegistry } from "../processor/registry";
import { readDocxBody } from "./docx-read";
import {
  asXmlCarries,
  docxPageTexts,
  docxStructureProblems,
  readDocxStructure,
  type DocxReadRun,
} from "./docx-structure";
import { flowPageText } from "../pdf-text/flow";
import { runPdfOfficeExport, type PdfOfficeExportDeps } from "./engine";
import { scanPdfPages, type PdfPageScanner } from "./page-scan";
import { inspectPptxPackage } from "./pptx-inspect";
import { encodePngImage } from "./png-encode";

const PROOF_LINES = [["Capability probe", "First page"], [], ["Third page"]];

/** The probe's picture: 40 × 30 pixels, two flat colours, left and right. */
const PROOF_PICTURE = {
  width: 40,
  height: 30,
  left: [200, 40, 40],
  right: [40, 80, 200],
} as const;

/** The probe's PDF, generated here: no file ships with the image for it. */
export async function capabilityProbePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedDrawingFont(doc, PROOF_LINES.flat());
  const { width, height } = PROOF_PICTURE;
  const pixels = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    const left = p % width < width / 2;
    pixels.set(left ? PROOF_PICTURE.left : PROOF_PICTURE.right, p * 3);
  }
  const picture = await embedRasterImage(
    doc,
    encodePngImage(width, height, "rgb8", pixels),
    "png",
  );
  for (const [index, lines] of PROOF_LINES.entries()) {
    const page = doc.addPage([612, 792]);
    lines.forEach((text, k) =>
      page.drawText(text, { x: 72, y: 700 - k * 28, size: 16, font }),
    );
    if (index === 0)
      await drawRasterImage(page, picture, {
        x: 72,
        y: 500,
        width: 160,
        height: 120,
      });
  }
  return doc.save();
}

/** What pdftotext would report for the probe PDF; the engine only opens with it. */
function probeExtraction() {
  const pages = PROOF_LINES.map((lines, index) => {
    const text = lines.join("\n");
    return { pageNumber: index + 1, text, characterCount: text.length };
  });
  const text = pages.map((page) => page.text).join("\n\n");
  return {
    pageCount: pages.length,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}

/**
 * Does this image's PDF to PowerPoint engine write a package whose master →
 * layout → theme chain is present and resolves, one slide per page?
 *
 * `run` and `scanPages` are injectable so the negative controls can hand it
 * the package the engine wrote before the fix, or a reader that loses a page;
 * the daemon always uses the real ones.
 */
export async function provesPptxPresentationChain(
  run: typeof runPdfOfficeExport = runPdfOfficeExport,
  scanPages: PdfPageScanner = scanPdfPages,
): Promise<boolean> {
  try {
    const result = await run("pdf-to-powerpoint", await capabilityProbePdf(), {
      extract: async () => probeExtraction(),
      scanPages,
    });
    if (!result.ok) return false;
    const { problems, counts } = await inspectPptxPackage(result.output);
    return (
      problems.length === 0 &&
      counts.slides === PROOF_LINES.length &&
      counts.masters >= 1 &&
      counts.layouts >= 1 &&
      counts.themes >= 1
    );
  } catch {
    // A throw is an answer: this image cannot do it.
    return false;
  }
}

/**
 * Is `png` the probe's picture: its size, and each half's colour (opaque,
 * within 12 levels a channel) at the half's centre?
 */
function showsProofPicture(png: Uint8Array): boolean {
  try {
    const { width, height, data } = decodePng(png);
    if (width !== PROOF_PICTURE.width || height !== PROOF_PICTURE.height)
      return false;
    const at = (x: number, y: number, want: readonly number[]) => {
      const i = (y * width + x) * 4;
      return (
        data[i + 3] === 255 &&
        want.every((c, k) => Math.abs(data[i + k]! - c) <= 12)
      );
    };
    const y = Math.floor(height / 2);
    return (
      at(Math.floor(width / 4), y, PROOF_PICTURE.left) &&
      at(Math.floor((width * 3) / 4), y, PROOF_PICTURE.right)
    );
  } catch {
    return false;
  }
}

/** The probe picture's placement on its slide, in EMU (12,700 a point). */
const PROOF_PICTURE_EMU = {
  // Drawn at x 72 pt, from y 500 pt (bottom edge) up 120 pt, on a 792 pt
  // page: its top is 792 - 500 - 120 = 172 pt from the top. The first page
  // sets the slide size, so the page sits on its slide at scale 1.
  x: 72 * 12_700,
  y: 172 * 12_700,
  cx: 160 * 12_700,
  cy: 120 * 12_700,
} as const;

/**
 * Does THIS worker image put a page's picture on its slide AS a picture,
 * where the page paints it?
 *
 * The question the owner's report of 2026-10-10 asked of production — the
 * deck had no pictures — asked of the running image rather than of `main`.
 * The probe PDF's first page paints one 40 × 30 picture at a known box; the
 * deck must carry, on slide 1, a `p:pic` at that box (to a twentieth of a
 * point) whose blip resolves to a PNG of those pixel dimensions AND those
 * pixels — decoded (`@/lib/png-probe`, a reader that shares nothing with the
 * writer) and sampled in each half, opaque and within a few levels of the
 * probe's two colours — in a package the delivery inspector passes. A
 * text-only deck, a picture flattened into a page-sized background, one moved
 * or rescaled, or one of the right size with the wrong pixels (blank,
 * transparent, black), all answer `false`. Until 2026-10-11 the pixels were
 * not read: a deck whose every picture was transparent black passed.
 *
 * It does not say every PDF's pictures come through: the round trip
 * (`./fidelity`, `pnpm worker:pptx-fidelity-proof`) is the measure of how
 * closely a deck looks like its pages, on more than one picture.
 */
export async function provesPptxPictures(
  run: typeof runPdfOfficeExport = runPdfOfficeExport,
  scanPages: PdfPageScanner = scanPdfPages,
): Promise<boolean> {
  try {
    const result = await run("pdf-to-powerpoint", await capabilityProbePdf(), {
      extract: async () => probeExtraction(),
      scanPages,
    });
    if (!result.ok) return false;
    const { problems, counts } = await inspectPptxPackage(result.output);
    if (problems.length > 0 || counts.pictures < 1) return false;
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(result.output);
    const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
    const rels = await zip
      .file("ppt/slides/_rels/slide1.xml.rels")
      ?.async("string");
    if (!slide || !rels) return false;
    const tolerance = 635; // a twentieth of a point
    for (const pic of slide.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? []) {
      const off = /<a:off x="(\d+)" y="(\d+)"\/>/.exec(pic);
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic);
      const embed = /<a:blip r:embed="([^"]+)"/.exec(pic)?.[1];
      if (!off || !ext || !embed) continue;
      const box = [off[1], off[2], ext[1], ext[2]].map(Number);
      const want = [
        PROOF_PICTURE_EMU.x,
        PROOF_PICTURE_EMU.y,
        PROOF_PICTURE_EMU.cx,
        PROOF_PICTURE_EMU.cy,
      ];
      if (box.some((v, i) => Math.abs(v - want[i]!) > tolerance)) continue;
      const rel = (rels.match(/<Relationship [^>]*>/g) ?? []).find((r) =>
        r.includes(`Id="${embed}"`),
      );
      const target = rel?.split('Target="../media/')[1]?.split('"')[0];
      const media = target
        ? await zip.file(`ppt/media/${target}`)?.async("uint8array")
        : undefined;
      if (!media || media[0] !== 0x89 || media[1] !== 0x50) continue;
      if (showsProofPicture(media)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 *  Word: does THIS image's PDF to Word keep the picture, in its place?
 * ------------------------------------------------------------------ */

/** The Word probe's words: a line above the picture, one below, a page 2. */
export const DOCX_PROBE_TEXT = {
  above: "Word capability probe",
  below: "The line under the picture",
  second: "The second page",
} as const;
/** Where the Word probe's picture is shown: points, top-left origin. */
const DOCX_PROBE_BOX = { x: 72, y: 150, width: 160, height: 120 } as const;

/**
 * The Word probe's PDF, generated here: on a US Letter page, a line, the
 * probe's picture under it, a line under that; and a second page with a
 * line. Letter's text area is 468 points wide, so the picture needs no
 * fitting and must keep its 160 × 120 points.
 */
export async function docxProbePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const words = Object.values(DOCX_PROBE_TEXT);
  const font = await embedDrawingFont(doc, words);
  const { width, height } = PROOF_PICTURE;
  const pixels = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    const left = p % width < width / 2;
    pixels.set(left ? PROOF_PICTURE.left : PROOF_PICTURE.right, p * 3);
  }
  const picture = await embedRasterImage(
    doc,
    encodePngImage(width, height, "rgb8", pixels),
    "png",
  );
  const first = doc.addPage([612, 792]);
  first.drawText(DOCX_PROBE_TEXT.above, {
    x: 72,
    y: 792 - 120,
    size: 16,
    font,
  });
  const box = DOCX_PROBE_BOX;
  await drawRasterImage(first, picture, {
    x: box.x,
    y: 792 - box.y - box.height,
    width: box.width,
    height: box.height,
  });
  first.drawText(DOCX_PROBE_TEXT.below, {
    x: 72,
    y: 792 - 300,
    size: 16,
    font,
  });
  const second = doc.addPage([612, 792]);
  second.drawText(DOCX_PROBE_TEXT.second, {
    x: 72,
    y: 792 - 120,
    size: 16,
    font,
  });
  return doc.save();
}

/** The executor's gates and registry a probe meets; each defaults to the daemon's. */
export type ProbeGates = Partial<
  Pick<ExecutorOrderJob, "soundness" | "manifest" | "registry">
>;

/**
 * The registry a PDF to Word probe's job is routed through: the one the
 * daemon builds (`createProcessorRegistry`) on the job's deps — or, for a
 * negative control that hands in an engine that regressed, the same
 * processor around that engine.
 */
function wordRegistry(
  deps: PdfOfficeExportDeps,
  run: typeof runPdfOfficeExport | undefined,
): ProcessorRegistry {
  if (!run) return createProcessorRegistry({ pdfOfficeExport: deps });
  return new ProcessorRegistry().register(
    createPdfOfficeExportProcessor(deps, { run }),
  );
}

/**
 * The .docx a real PDF to Word job on `pdf` would deliver, run in the
 * executor's order (`../capability-chain`: soundness gate, processor,
 * artifact-manifest gate on the processor's own content type and name) — or
 * null wherever the executor would have failed the job. Added 2026-11-15:
 * until then the Word probe called the engine directly, the shape the
 * 2026-11-14 HTML to PDF probe was caught in.
 */
async function wordThroughExecutor(
  pdf: Uint8Array,
  deps: PdfOfficeExportDeps,
  run: typeof runPdfOfficeExport | undefined,
  gates: ProbeGates,
): Promise<Uint8Array | null> {
  const artifact = await proveThroughExecutorOrder({
    tool: "pdf-to-word",
    input: {
      bytes: pdf,
      filename: "probe.pdf",
      contentType: "application/pdf",
    },
    registry: gates.registry ?? wordRegistry(deps, run),
    ...(gates.soundness ? { soundness: gates.soundness } : {}),
    ...(gates.manifest ? { manifest: gates.manifest } : {}),
  });
  return artifact?.bytes ?? null;
}

/**
 * Does THIS worker image's PDF to Word put a page's picture in the .docx AS
 * that picture, between the line above it and the line below it, at the
 * size the page shows it?
 *
 * The question production answered "no" to on 2026-10-17 — the owner's
 * tutorial came back with none of its 37 pictures — asked of the running
 * image rather than of `main`. The probe PDF ({@link docxProbePdf}) goes
 * through the real engine on the deps the image's JOBS run on
 * (`pdfOfficeExportDeps(env)`, whole): its own text extractor (poppler's
 * `-bbox-layout` on the worker: the order of a picture among the paragraphs
 * depends on poppler's frame and pdf.js's agreeing, so a stand-in would
 * prove the wrong thing), its page reader, its limits. Until the review of
 * 2026-10-17 it took the extractor alone and ran this module's page reader
 * with no limits, so it could answer for a job the image does not run. The
 * .docx is read
 * back by `./docx-read`, which shares nothing with the writer: page 1's body
 * must hold the line above, then exactly one picture, then the line below;
 * the picture's extent must be 160 × 120 points (to a twentieth); its media
 * must decode (`@/lib/png-probe`) to the probe's 40 × 30 pixels with its two
 * colours; and the second page's line must follow a page break. A text-only
 * document, a picture moved below its caption, rescaled, or swapped for
 * other pixels, all answer `false`, and so does an image without the
 * extractor or the page reader.
 *
 * An image built before this key publishes nothing, and the reader parses the
 * absence as `false`.
 *
 * Since 2026-11-15 the job runs in the EXECUTOR's order
 * ({@link wordThroughExecutor}): the soundness gate, the processor the
 * daemon's registry resolves, and the artifact-manifest gate on the
 * processor's own content type and name — so an image whose real jobs a gate
 * refuses answers `false` here too. `run` still stands in for the engine
 * (behind that processor), for the negative controls.
 */
export async function provesDocxPictures(
  deps: PdfOfficeExportDeps,
  run?: typeof runPdfOfficeExport,
  gates: ProbeGates = {},
): Promise<boolean> {
  try {
    if (!deps.extractFlow || !deps.scanPages) return false;
    const docx = await wordThroughExecutor(
      await docxProbePdf(),
      deps,
      run,
      gates,
    );
    if (!docx) return false;
    const body = await readDocxBody(docx);
    const at = (text: string) =>
      body.paragraphs.findIndex((p) => p.text.includes(text));
    const above = at(DOCX_PROBE_TEXT.above);
    const below = at(DOCX_PROBE_TEXT.below);
    const second = at(DOCX_PROBE_TEXT.second);
    if (above < 0 || below < 0 || second < 0) return false;
    const onPage = body.pictures.filter((p) => p.segment === 0);
    if (onPage.length !== 1 || body.pictures.length !== 1) return false;
    const [pic] = onPage;
    const tolerance = 0.05;
    return (
      body.paragraphs[above]!.segment === 0 &&
      body.paragraphs[below]!.segment === 0 &&
      body.paragraphs[second]!.segment === 1 &&
      above < pic!.paragraph &&
      pic!.paragraph < below &&
      Math.abs(pic!.width - DOCX_PROBE_BOX.width) <= tolerance &&
      Math.abs(pic!.height - DOCX_PROBE_BOX.height) <= tolerance &&
      pic!.bytes !== null &&
      showsProofPicture(pic!.bytes)
    );
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 *  Word: does THIS image's PDF to Word keep each word's formatting?
 * ------------------------------------------------------------------ */

/**
 * The run-styles probe's words, each drawn in its own way on ONE baseline,
 * then a plain line under them. Standard fonts, none embedded: the probe
 * asks whether the image labels poppler's words with pdf.js's runs, not
 * whether a font embeds.
 */
export const DOCX_RUN_STYLES_PROBE = {
  plain: "Plain",
  bold: "bold",
  italic: "italic",
  red: "RED",
  big: "BIG",
  second: "Second plain line",
} as const;

/**
 * The run-styles probe's PDF: on a US Letter page, "Plain" (Helvetica 12),
 * "bold" (Helvetica-Bold 12), "italic" (Helvetica-Oblique 12), "RED"
 * (Helvetica 12 in pure red) and "BIG" (Helvetica 18) on one baseline, and a
 * plain 12-point line under them.
 */
export async function docxRunStylesProbePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await embedDrawingFont(
    doc,
    Object.values(DOCX_RUN_STYLES_PROBE),
    "sans",
  );
  const bold = await embedDrawingFont(
    doc,
    Object.values(DOCX_RUN_STYLES_PROBE),
    "sans-bold",
  );
  const italic = await embedDrawingFont(
    doc,
    Object.values(DOCX_RUN_STYLES_PROBE),
    "sans-oblique",
  );
  const page = doc.addPage([612, 792]);
  const words = DOCX_RUN_STYLES_PROBE;
  const line: [string, typeof regular, number, ReturnType<typeof rgb>][] = [
    [words.plain, regular, 12, rgb(0, 0, 0)],
    [words.bold, bold, 12, rgb(0, 0, 0)],
    [words.italic, italic, 12, rgb(0, 0, 0)],
    [words.red, regular, 12, rgb(1, 0, 0)],
    [words.big, regular, 18, rgb(0, 0, 0)],
  ];
  let x = 72;
  for (const [text, font, size, color] of line) {
    page.drawText(text, { x, y: 792 - 120, size, font, color });
    x += font.widthOfTextAtSize(`${text} `, size);
  }
  page.drawText(words.second, {
    x: 72,
    y: 792 - 160,
    size: 12,
    font: regular,
  });
  return doc.save();
}

/** Each word of the body's paragraphs, with the run it is in. */
function wordRuns(runs: readonly DocxReadRun[]): Map<string, DocxReadRun[]> {
  const out = new Map<string, DocxReadRun[]>();
  for (const run of runs)
    for (const word of run.text.split(/\s+/).filter(Boolean))
      out.set(word, [...(out.get(word) ?? []), run]);
  return out;
}

/**
 * Does THIS worker image's PDF to Word keep each word's bold, italics, size
 * and colour — on that word, and not on the words beside it?
 *
 * The probe PDF ({@link docxRunStylesProbePdf}) runs as a real job would, in
 * the executor's order (`../capability-chain`), on the deps the image's jobs
 * run on (`pdfOfficeExportDeps(env)`: poppler for the words, the page reader
 * for their formatting). The .docx is read back by `./docx-structure`, which
 * shares nothing with the writer, and a pass needs every one of:
 *   - "Plain" and the line under it: 12 points (`w:sz` 24), not bold, not
 *     italic, no colour;
 *   - "bold": `w:b` and `w:bCs`, not italic; "italic": `w:i` and `w:iCs`,
 *     not bold; "RED": colour FF0000; "BIG": 18 points (`w:sz` and `w:szCs`
 *     36);
 *   - the text read back, page by page, is EXACTLY the image's poppler text
 *     for the PDF (`flowPageText`), so no word was lost or doubled by the
 *     split into runs;
 *   - nothing in the file Word could refuse (`docxStructureProblems`).
 * A writer that drops the formatting, puts it on the whole paragraph, or
 * doubles a word answers `false`; so does an image without the extractor or
 * the page reader. An image built before this key publishes nothing, and the
 * reader parses the absence as `false`.
 */
export async function provesDocxRunStyles(
  deps: PdfOfficeExportDeps,
  run?: typeof runPdfOfficeExport,
  gates: ProbeGates = {},
): Promise<boolean> {
  try {
    if (!deps.extractFlow || !deps.scanPages) return false;
    const pdf = await docxRunStylesProbePdf();
    const docx = await wordThroughExecutor(pdf, deps, run, gates);
    if (!docx) return false;
    if ((await docxStructureProblems(docx)).length > 0) return false;
    const body = await readDocxStructure(docx);
    const flow = await deps.extractFlow(pdf);
    const want = flow.pages.map((p) => asXmlCarries(flowPageText(p)));
    const read = docxPageTexts(body).map(asXmlCarries);
    if (read.length !== want.length || read.some((t, k) => t !== want[k]))
      return false;
    const runs = body.blocks.flatMap((b) => (b.kind === "p" ? b.runs : []));
    const byWord = wordRuns(runs);
    const one = (word: string) => {
      const found = byWord.get(word) ?? [];
      return found.length === 1 ? found[0]! : null;
    };
    const w = DOCX_RUN_STYLES_PROBE;
    const plainAt = (r: DocxReadRun | null, sz: number) =>
      r !== null &&
      r.sz === sz &&
      r.szCs === sz &&
      !r.b &&
      !r.bCs &&
      !r.i &&
      !r.iCs &&
      r.color === undefined;
    const plain = one(w.plain);
    const bold = one(w.bold);
    const italic = one(w.italic);
    const red = one(w.red);
    const big = one(w.big);
    const second = w.second.split(" ").map(one);
    return (
      plainAt(plain, 24) &&
      second.every((r) => plainAt(r, 24)) &&
      bold !== null &&
      bold.b === true &&
      bold.bCs === true &&
      !bold.i &&
      bold.sz === 24 &&
      italic !== null &&
      italic.i === true &&
      italic.iCs === true &&
      !italic.b &&
      italic.sz === 24 &&
      red !== null &&
      red.color === "FF0000" &&
      !red.b &&
      !red.i &&
      big !== null &&
      big.sz === 36 &&
      big.szCs === 36 &&
      !big.b &&
      !big.i &&
      big.color === undefined
    );
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 *  Word: does THIS image's PDF to Word write a table as a Word table?
 * ------------------------------------------------------------------ */

/**
 * The tables probe's page (#28 slice 2): a wide-gapped line, a short
 * separator line, then a four-row table — a bold header and three rows, the
 * middle row with NO quantity — its columns left-aligned at 72, 300 and 420
 * points. The separator has under four words: a longer line in the header's
 * block would trim the header out of the table (flow.ts rule 5).
 */
export const DOCX_TABLES_PROBE = {
  lone: ["Invoice 1042", "Due in 30 days"],
  separator: "Order details",
  rows: [
    ["Item", "Qty", "Price"],
    ["Widget", "2", "9.50"],
    ["Gadget", "", "12.00"],
    ["Gizmo", "5", "3.25"],
  ],
  columns: [72, 300, 420],
} as const;

/**
 * The tables probe's PDF: on a US Letter page, the wide-gapped line at
 * y = 720 ("Invoice 1042" at 72, "Due in 30 days" at 300), the separator at
 * 690, the header (Helvetica-Bold 11) at 660, and the rows (Helvetica 11)
 * 16 points apart below it.
 */
export async function docxTablesProbePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p = DOCX_TABLES_PROBE;
  const texts = [...p.lone, p.separator, ...p.rows.flat()].filter(Boolean);
  const regular = await embedDrawingFont(doc, texts, "sans");
  const bold = await embedDrawingFont(doc, texts, "sans-bold");
  const page = doc.addPage([612, 792]);
  page.drawText(p.lone[0], { x: 72, y: 720, size: 11, font: regular });
  page.drawText(p.lone[1], { x: 300, y: 720, size: 11, font: regular });
  page.drawText(p.separator, { x: 72, y: 690, size: 11, font: regular });
  p.rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell)
        page.drawText(cell, {
          x: p.columns[c]!,
          y: 660 - r * 16,
          size: 11,
          font: r === 0 ? bold : regular,
        });
    }),
  );
  return doc.save();
}

type ReadTable = Extract<
  Awaited<ReturnType<typeof readDocxStructure>>["blocks"][number],
  { kind: "tbl" }
>;

/**
 * Why `docx` is NOT what the tables probe expects, or null when it is — the
 * checks {@link provesDocxTables} makes after the job, one reason each, so
 * every negative control can be shown failing on its OWN check:
 *   2. "structure": something Word could refuse (`docxStructureProblems`);
 *   3. "text": the text read back is not poppler's, page by page;
 *   4. "shape": not exactly one top-level table of 3 grid columns and 4
 *      rows, each of 3 cells spanning 1. Its "exactly one" cannot fail ON
 *      ITS OWN (review round 2, 2026-11-15: `!== 1` mutated to `< 1` left
 *      every negative green): a second table either changes the text read
 *      back, even an empty one (an empty row reads as an empty line, and
 *      the engine refused that job), or stands before the probe's and
 *      fails the grid. Kept as the plain statement of what is expected;
 *      not counted as a check of its own;
 *   5. "cells": a cell's text is not the page's, or the middle row's
 *      quantity is not an EMPTY cell (no run at all);
 *   7. "bold": a header run without `w:b` and `w:bCs`, or a body-row run
 *      with `w:b`.
 * There is no check 6 on the wide-gapped line's FORM. Whether poppler keeps
 * its two halves on one `<line>` (one tabbed paragraph) or splits them into
 * two flows (two paragraphs) is poppler's to decide, the stand-in always
 * joins them, and no capture from the worker image's poppler exists yet; a
 * check on either form could certify a grouping the image never makes. That
 * the line stays OUT of the table is not a separate check either: with the
 * text conserved (3) and the one table exactly the probe's twelve cells
 * (4, 5), every other word is outside it — a check that cannot fail alone
 * would be decoration.
 */
export async function docxTablesProblem(
  docx: Uint8Array,
  flowText: string[],
): Promise<string | null> {
  if ((await docxStructureProblems(docx)).length > 0) return "structure";
  const body = await readDocxStructure(docx);
  const want = flowText.map(asXmlCarries);
  const read = docxPageTexts(body).map(asXmlCarries);
  if (read.length !== want.length || read.some((t, k) => t !== want[k]))
    return "text";
  const tables = body.blocks.filter((b): b is ReadTable => b.kind === "tbl");
  const p = DOCX_TABLES_PROBE;
  const [tbl] = tables;
  if (
    tables.length !== 1 ||
    tbl!.gridCols.length !== 3 ||
    tbl!.rows.length !== p.rows.length ||
    tbl!.rows.some(
      (r) => r.cells.length !== 3 || r.cells.some((c) => c.span !== 1),
    )
  )
    return "shape";
  const runsOf = (
    blocks: ReadTable["rows"][number]["cells"][number]["blocks"],
  ) => blocks.flatMap((b) => (b.kind === "p" ? b.runs : []));
  const textOf = (
    blocks: ReadTable["rows"][number]["cells"][number]["blocks"],
  ) =>
    runsOf(blocks)
      .map((r) => r.text)
      .join("");
  const cellsOk = p.rows.every((row, r) =>
    row.every((cell, c) => {
      const blocks = tbl!.rows[r]!.cells[c]!.blocks;
      return cell === ""
        ? runsOf(blocks).length === 0
        : textOf(blocks) === cell;
    }),
  );
  if (!cellsOk) return "cells";
  const header = tbl!.rows[0]!.cells.flatMap((c) => runsOf(c.blocks));
  const rest = tbl!.rows
    .slice(1)
    .flatMap((r) => r.cells.flatMap((c) => runsOf(c.blocks)));
  if (
    header.length === 0 ||
    !header.every((r) => r.b && r.bCs) ||
    rest.some((r) => r.b)
  )
    return "bold";
  return null;
}

/**
 * Does THIS worker image's PDF to Word write a table whose cells each fit on
 * one line as a Word table — each value in its column, an empty cell left
 * empty, the words keeping their run styles (#28 slice 2, key `docxTables`)?
 *
 * The probe PDF ({@link docxTablesProbePdf}) runs as a real job would, in
 * the executor's order (`../capability-chain`: soundness gate, the
 * processor the daemon's registry resolves, the artifact-manifest gate), on
 * the deps the image's jobs run on (`pdfOfficeExportDeps(env)`). The .docx
 * is read back by `./docx-structure`, which shares nothing with the writer,
 * and a pass needs every check of {@link docxTablesProblem}. A writer that
 * writes tabbed paragraphs, drops the empty cell and shifts the price left,
 * places cells by index, strips the header's bold, collapses the grid to one
 * column, or puts the wide-gapped line in the table as a row answers
 * `false`; so
 * does an image without the extractor or the page reader, and one whose
 * real jobs a gate refuses. Wrapped-cell tables are NOT covered (a future
 * `docxTableWraps`). An image built before this key publishes nothing, and
 * the reader parses the absence as `false`.
 */
export async function provesDocxTables(
  deps: PdfOfficeExportDeps,
  run?: typeof runPdfOfficeExport,
  gates: ProbeGates = {},
): Promise<boolean> {
  try {
    if (!deps.extractFlow || !deps.scanPages) return false;
    const pdf = await docxTablesProbePdf();
    const docx = await wordThroughExecutor(pdf, deps, run, gates);
    if (!docx) return false;
    const flow = await deps.extractFlow(pdf);
    return (
      (await docxTablesProblem(docx, flow.pages.map(flowPageText))) === null
    );
  } catch {
    return false;
  }
}
