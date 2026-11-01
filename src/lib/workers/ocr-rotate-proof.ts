/**
 * `pnpm worker:ocr-rotate-proof` — OCR PDF's "Turn pages upright" (OCRmyPDF
 * `--rotate-pages`, at `OCR_ROTATE_PAGES_THRESHOLD`) asked of the BUILT
 * worker image's own engine, and judged by MEASURING the page a reader
 * receives, not by reading the argv.
 *
 * Every unit test of the option runs where OCRmyPDF is not installed: they
 * prove the flags reach the argv (`ocr-native.test.ts`, and the panel → job
 * → processor → argv chain in `ocr-rotate.dom.test.tsx`), never that the
 * engine turns anything. And the argv alone is known to be worth nothing:
 * at OCRmyPDF's default threshold the same flag turned no page in the live
 * image. This runs inside the image, through the registry's OCR processor —
 * the one `ocr-pdf` jobs reach — and measures three things of each output:
 * its page 1 `/Rotate` (pdf-lib), the way up a viewer paints it (pdf.js,
 * {@link orientationOf}), and whether the fixture's sentinel sentence is in
 * its text layer (poppler). The checks:
 *
 *   1. INSTRUMENT — scans (pixels only, checked to carry no text) of a full
 *      page of body text under a heavy header bar, drawn upright, turned
 *      180° and turned 90°. The instrument must read them as upright,
 *      upside down and sideways, each at `/Rotate` 0, or nothing below
 *      means anything; the skew instrument must read a 3.5° copy as ~3.5°
 *      and the upright one as ~0°.
 *   2. TURNED — the 180° and the 90° scans with the option ON must come back
 *      painted upright, with `/Rotate` set and the sentinel read; the 180°
 *      one's page picture must be byte-for-byte the control's (the turn is
 *      a rotation setting, not a redrawn image).
 *   3. NEGATIVE CONTROL — the same two scans with the option OFF must come
 *      back at `/Rotate` 0, still upside down / sideways, sentinel not read.
 *   4. UPRIGHT CONTROL — an upright scan with the option ON is left at
 *      `/Rotate` 0: the false-positive guard on the threshold.
 *   5. TEXT PAGE — a TYPED page (it has text) turned 180°, option ON, under
 *      the default `--skip-text`: the page copy says such a page is kept as
 *      it is, so it must come back at `/Rotate` 0, still upside down. If an
 *      engine ever turns it, this goes red so the copy is re-decided.
 *   6. WITH REDO — the 180° scan with the option ON and `redoOcr`: the job
 *      must complete and the page come back upright (the pair is allowed).
 *   7. WITH DESKEW — a scan turned 180° AND 3.5°, with both options ON: the
 *      page must come back upright and level (under 0.5°).
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine this proof needs
 * is not in the image. Output names angles, counts and verdicts only — never
 * a path, never recognised text beyond the fixed sentinel.
 */
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  degrees,
  rgb,
} from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import type { GreyPage } from "./ocr-deskew-proof";
import type { Processor, ProcessorResult } from "./processor/types";

/** The fixed sentence on the fixture, under the header bar. */
export const UPRIGHT_SENTINEL = "Upright proof sentinel 6142";

/** The combined fixture's slight tilt, on top of its half turn. */
export const COMBINED_SKEW_DEGREES = 3.5;

/** A level page must measure under this many degrees. */
export const LEVEL_DEGREES = 0.5;

/** How close the skew instrument must read a fixture drawn at a known angle. */
export const SKEW_TOLERANCE_DEGREES = 0.75;

/** US Letter, in points, upright. */
const PAGE: [number, number] = [612, 792];

/**
 * The header bar, in points on the UPRIGHT page: long, heavy, at the top.
 * It is the instrument's mark: the heaviest row of a page is inside it, so
 * where that row lands says which way up the page is painted. Body text
 * rows are far lighter.
 */
const BAR = { x: 76, width: 460, top: 740, height: 24 };
const SENTINEL_BASELINE = 690;
const SENTINEL_SIZE = 16;

/**
 * A full page of body text: OSD reads orientation from rows of TEXT (the
 * deskew lesson — a fixture of shapes proves nothing), and the threshold's
 * measurements were made on 30 lines, so the fixture carries 30.
 */
const BODY_SENTENCES = [
  "The quarterly report was scanned on the office copier last week.",
  "Every sheet went through the feeder in the order it was stacked.",
  "Some pages were placed face down and came out upside down.",
  "Others were turned on their side to fit the wide tables.",
  "Reading a page like that is slow work for anyone at a desk.",
  "Recognition needs each line of text to run the right way up.",
  "The minutes of the March meeting follow on the next page.",
  "Members agreed to review the budget again before the summer.",
  "A copy of this letter has been sent to every branch office.",
  "Please keep the original documents in the filing cabinet.",
] as const;
const BODY_LINES = 30;
const BODY_TOP = 662;
const BODY_STEP = 19;
const BODY_SIZE = 11;

/**
 * A TYPED page of the fixture, every item turned by `angle` degrees
 * counter-clockwise about the page centre. A quarter turn (90 or 270, plus
 * any tilt under 45°) lays the page on its side, so the sheet is landscape.
 * The caller makes it a scan, or keeps it typed for the text-page case.
 */
export async function turnedTextPage(angle: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const quarter = Math.round(angle / 90) % 2 !== 0;
  const size: [number, number] = quarter ? [PAGE[1], PAGE[0]] : PAGE;
  const page = doc.addPage(size);
  const font = await embedDrawingFont(doc, [
    UPRIGHT_SENTINEL,
    ...BODY_SENTENCES,
  ]);
  const [cx, cy] = [PAGE[0] / 2, PAGE[1] / 2];
  const [ox, oy] = [size[0] / 2, size[1] / 2];
  const t = (angle * Math.PI) / 180;
  const turn = (x: number, y: number) => ({
    x: ox + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t),
    y: oy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t),
  });
  page.drawRectangle({
    ...turn(BAR.x, BAR.top - BAR.height),
    width: BAR.width,
    height: BAR.height,
    color: rgb(0, 0, 0),
    rotate: degrees(angle),
  });
  page.drawText(UPRIGHT_SENTINEL, {
    ...turn(BAR.x, SENTINEL_BASELINE),
    size: SENTINEL_SIZE,
    font,
    color: rgb(0, 0, 0),
    rotate: degrees(angle),
  });
  for (let i = 0; i < BODY_LINES; i++) {
    page.drawText(BODY_SENTENCES[i % BODY_SENTENCES.length]!, {
      ...turn(BAR.x, BODY_TOP - i * BODY_STEP),
      size: BODY_SIZE,
      font,
      color: rgb(0, 0, 0),
      rotate: degrees(angle),
    });
  }
  return doc.save();
}

export type Orientation = "upright" | "upside down" | "sideways";

const DARK = 128;

/**
 * Which way up a rendered page is PAINTED, measured from the header bar.
 * A page wider than it is tall is sideways (the fixture is a portrait
 * page). Otherwise the heaviest row across the middle half of the page is
 * found: in the top fifth it is upright, in the bottom fifth upside down.
 *
 * Throws, rather than answering, on a page whose heaviest row is not a bar
 * (under half dark) or sits in the middle: a blank or garbled render must
 * not be read as either answer, least of all the convenient one.
 */
export function orientationOf(page: GreyPage): Orientation {
  const { width: w, height: h, grey } = page;
  if (grey.length !== w * h || w < 100 || h < 100)
    throw new Error(`implausible page raster ${w}x${h}`);
  let ink = 0;
  for (const v of grey) if (v < DARK) ink++;
  if (ink < grey.length * 0.01)
    throw new Error(`instrument: the page is blank (${ink} dark pixels)`);
  if (w > h * 1.05) return "sideways";
  const [x0, x1] = [Math.round(w * 0.25), Math.round(w * 0.75)];
  let best = -1;
  let bestRow = -1;
  for (let y = 0; y < h; y++) {
    let dark = 0;
    for (let x = x0; x < x1; x++) if (grey[y * w + x]! < DARK) dark++;
    const share = dark / (x1 - x0);
    if (share > best) [best, bestRow] = [share, y];
  }
  if (best < 0.5)
    throw new Error(
      `instrument: no header bar (heaviest row ${(best * 100).toFixed(0)}% dark)`,
    );
  if (bestRow < h * 0.2) return "upright";
  if (bestRow > h * 0.8) return "upside down";
  throw new Error(
    `instrument: header bar at ${((bestRow / h) * 100).toFixed(0)}% of the height`,
  );
}

/**
 * The tilt of the header bar on an UPRIGHT rendered page, degrees, positive
 * = right end higher: its top edge is found in 25 columns across the middle
 * half of the page (the first dark run at least `minRun` tall, from the
 * top) and a straight line fitted through them. Throws when a column finds
 * no bar in the top quarter.
 */
export function measureHeaderSkew(page: GreyPage): number {
  const { width: w, height: h, grey } = page;
  const at = (x: number, y: number) => grey[y * w + x]!;
  const minRun = Math.max(3, Math.round(h * 0.008));
  const COLUMNS = 25;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < COLUMNS; i++) {
    const x = Math.round(w * (0.25 + (0.5 * i) / (COLUMNS - 1)));
    let y = Math.round(h * 0.01);
    let edge = -1;
    while (y < h * 0.25 && edge < 0) {
      if (at(x, y) >= DARK) {
        y++;
        continue;
      }
      let end = y;
      while (end < h && at(x, end) < DARK) end++;
      if (end - y >= minRun) {
        const above = y > 0 ? at(x, y - 1) : 255;
        const below = at(x, y);
        const frac = above === below ? 0 : (above - DARK) / (above - below);
        edge = y - 1 + frac;
      }
      y = end;
    }
    if (edge < 0)
      throw new Error(
        `instrument: column ${i + 1} of ${COLUMNS} (x=${x}) found no bar in the top quarter`,
      );
    points.push({ x, y: edge });
  }
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const my = points.reduce((s, p) => s + p.y, 0) / points.length;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  // Image rows grow downwards: negate, so a counter-clockwise tilt is positive.
  return (-Math.atan(sxy / sxx) * 180) / Math.PI;
}

/** Page 1's `/Rotate`, normalised to 0, 90, 180 or 270. */
export async function pageRotation(pdf: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const angle = doc.getPage(0).getRotation().angle;
  return ((angle % 360) + 360) % 360;
}

/**
 * The raw (still encoded) bytes of every image page 1 paints, including
 * those inside its form XObjects, largest first. Equal bytes mean the
 * picture was carried, not redrawn.
 */
export async function pageImageBytes(pdf: Uint8Array): Promise<Uint8Array[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const found: Uint8Array[] = [];
  const seen = new Set<unknown>();
  const visit = (resources: PDFDict | undefined, depth: number) => {
    if (!resources || depth > 4) return;
    const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
    if (!xobjects) return;
    for (const [, ref] of xobjects.entries()) {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream) || seen.has(stream)) continue;
      seen.add(stream);
      const subtype = stream.dict.get(PDFName.of("Subtype"));
      if (subtype === PDFName.of("Image")) found.push(stream.getContents());
      else if (subtype === PDFName.of("Form"))
        visit(
          stream.dict.lookupMaybe(PDFName.of("Resources"), PDFDict),
          depth + 1,
        );
    }
  };
  visit(doc.getPage(0).node.Resources(), 0);
  return found.sort((a, b) => b.byteLength - a.byteLength);
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined) {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface OcrRotateProofDeps {
  /** The registry's OCR processor (what `ocr-pdf` jobs reach). */
  ocr: Processor;
  /** A typed PDF → a scan of its first page (pixels only). */
  scan: (typed: Uint8Array) => Promise<Uint8Array>;
  /** Page 1 of a PDF as a viewer paints it (`/Rotate` applied), in grey. */
  render: (pdf: Uint8Array) => Promise<GreyPage>;
  /** poppler's text of a PDF; null when pdftotext is absent. */
  pdfText: ((pdf: Uint8Array) => Promise<string>) | null;
  log?: (line: string) => void;
}

const PDF = "application/pdf";

function job(bytes: Uint8Array, options: Record<string, unknown>) {
  return {
    tool: "ocr-pdf",
    options: {
      languages: ["eng"],
      outputMode: "searchable-pdf",
      ...options,
    } as Record<string, unknown>,
    inputs: [
      { fileId: "proof", filename: "turned.pdf", contentType: PDF, bytes },
    ],
  };
}

function outputPdf(result: ProcessorResult): Uint8Array | null {
  if (!result.ok) return null;
  return result.artifacts.find((a) => a.contentType === PDF)?.bytes ?? null;
}

const fmt = (d: number) => `${d.toFixed(2)}°`;

export async function runOcrRotateProof(
  deps: OcrRotateProofDeps,
): Promise<0 | 1 | 2> {
  const log = deps.log ?? ((line: string) => console.log(line));
  let failed = 0;
  const check = (ok: boolean, name: string, detail: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
    if (!ok) failed += 1;
  };
  const pdfText = deps.pdfText;
  if (!deps.ocr.capability().ready || !pdfText) {
    log(
      `MISSING ${!deps.ocr.capability().ready ? "a ready OCR engine" : "pdftotext"}: the rotate proof cannot run in this image.`,
    );
    return 2;
  }
  const orientation = async (pdf: Uint8Array): Promise<string> => {
    try {
      return orientationOf(await deps.render(pdf));
    } catch (error) {
      return (error as Error).message;
    }
  };
  const sentinelRead = async (pdf: Uint8Array) => {
    const words = (await pdfText(pdf)).toLowerCase();
    const want = UPRIGHT_SENTINEL.toLowerCase().split(" ");
    return {
      found: want.filter((w) => words.includes(w)).length,
      of: want.length,
    };
  };
  /** What a reader receives: the rotation flag, the paint, the text. */
  const observe = async (pdf: Uint8Array) => ({
    rotate: await pageRotation(pdf),
    way: await orientation(pdf),
    sentinel: await sentinelRead(pdf),
  });
  const say = (o: Awaited<ReturnType<typeof observe>>) =>
    `/Rotate ${o.rotate}, painted ${o.way}, ${o.sentinel.found} of ${o.sentinel.of} sentinel words in the text layer`;
  const run = async (
    name: string,
    bytes: Uint8Array,
    options: Record<string, unknown>,
  ): Promise<Uint8Array | null> => {
    const result = await deps.ocr.process(job(bytes, options));
    const pdf = outputPdf(result);
    if (!pdf)
      check(
        false,
        name,
        result.ok
          ? "no PDF artifact"
          : `${result.error.code}: ${result.error.message}`,
      );
    return pdf;
  };

  // ── 1. the instruments, on the fixtures themselves ───────────────────────
  const upright = await deps.scan(await turnedTextPage(0));
  const flipped = await deps.scan(await turnedTextPage(180));
  const sideways = await deps.scan(await turnedTextPage(90));
  for (const [label, pdf, want] of [
    ["upright", upright, "upright"],
    ["turned 180°", flipped, "upside down"],
    ["turned 90°", sideways, "sideways"],
  ] as const) {
    const leftover = (await pdfText(pdf)).trim().length;
    const rotate = await pageRotation(pdf);
    const way = await orientation(pdf);
    check(
      leftover === 0 && rotate === 0 && way === want,
      `instrument reads the ${label} fixture as ${want}`,
      `${leftover} characters of text, /Rotate ${rotate}, painted ${way}`,
    );
  }
  const skewOf = async (pdf: Uint8Array): Promise<number | string> => {
    try {
      return measureHeaderSkew(await deps.render(pdf));
    } catch (error) {
      return (error as Error).message;
    }
  };
  const tilted = await skewOf(
    await deps.scan(await turnedTextPage(COMBINED_SKEW_DEGREES)),
  );
  check(
    typeof tilted === "number" &&
      Math.abs(tilted - COMBINED_SKEW_DEGREES) <= SKEW_TOLERANCE_DEGREES,
    `skew instrument reads a ${fmt(COMBINED_SKEW_DEGREES)} fixture as ~${fmt(COMBINED_SKEW_DEGREES)}`,
    typeof tilted === "number" ? `measured ${fmt(tilted)}` : tilted,
  );
  const level = await skewOf(upright);
  check(
    typeof level === "number" && Math.abs(level) < LEVEL_DEGREES / 2,
    "skew instrument reads the upright fixture as ~0°",
    typeof level === "number" ? `measured ${fmt(level)}` : level,
  );

  // ── 3. negative control first: its page picture is check 2's reference ──
  const offFlipped = await run("option off, turned 180° (control)", flipped, {
    rotatePages: false,
  });
  if (offFlipped) {
    const o = await observe(offFlipped);
    check(
      o.rotate === 0 &&
        o.way === "upside down" &&
        o.sentinel.found < o.sentinel.of,
      "option off: the 180° scan stays upside down and unread (control)",
      say(o),
    );
  }
  const offSideways = await run("option off, turned 90° (control)", sideways, {
    rotatePages: false,
  });
  if (offSideways) {
    const o = await observe(offSideways);
    check(
      o.rotate === 0 &&
        o.way === "sideways" &&
        o.sentinel.found < o.sentinel.of,
      "option off: the 90° scan stays sideways and unread (control)",
      say(o),
    );
  }

  // ── 2. option on: the page a reader receives is upright ─────────────────
  const onFlipped = await run("option on, turned 180°", flipped, {
    rotatePages: true,
  });
  if (onFlipped) {
    const o = await observe(onFlipped);
    check(
      o.rotate === 180 &&
        o.way === "upright" &&
        o.sentinel.found === o.sentinel.of,
      "option on: the 180° scan comes back upright and read",
      say(o),
    );
    if (offFlipped) {
      const [on] = await pageImageBytes(onFlipped);
      const [off] = await pageImageBytes(offFlipped);
      const [input] = await pageImageBytes(flipped);
      check(
        sameBytes(on, off),
        "option on: the turned page keeps its picture (a /Rotate, not a redraw)",
        `largest image ${on?.byteLength ?? 0} B, control's ${off?.byteLength ?? 0} B, ${
          sameBytes(on, off) ? "identical" : "DIFFERENT"
        }; ${sameBytes(on, input) ? "identical to" : "re-encoded from"} the upload's ${input?.byteLength ?? 0} B`,
      );
    }
  }
  const onSideways = await run("option on, turned 90°", sideways, {
    rotatePages: true,
  });
  if (onSideways) {
    const o = await observe(onSideways);
    check(
      (o.rotate === 90 || o.rotate === 270) &&
        o.way === "upright" &&
        o.sentinel.found === o.sentinel.of,
      "option on: the 90° scan comes back upright and read",
      say(o),
    );
  }

  // ── 4. upright control: an upright page is left alone ───────────────────
  const onUpright = await run("option on, upright", upright, {
    rotatePages: true,
  });
  if (onUpright) {
    const o = await observe(onUpright);
    check(
      o.rotate === 0 && o.way === "upright",
      "option on: an upright scan is left at /Rotate 0 (false-positive guard)",
      say(o),
    );
  }

  // ── 5. a page that already has text, under the default --skip-text ──────
  const typed = await turnedTextPage(180);
  const typedWay = await orientation(typed);
  const onTyped = await run("option on, typed page turned 180°", typed, {
    rotatePages: true,
  });
  if (onTyped) {
    const o = await observe(onTyped);
    check(
      typedWay === "upside down" && o.rotate === 0 && o.way === "upside down",
      "option on: a page that already has text is kept as it is, not turned (what the page copy says)",
      `input painted ${typedWay}; output ${say(o)}${
        o.rotate !== 0 || o.way === "upright"
          ? " — the engine TURNED a text page: re-decide the copy that says such a page is kept as it is"
          : ""
      }`,
    );
  }

  // ── 6. with Redo existing OCR (the pair is allowed) ─────────────────────
  const withRedo = await run("option on with redo OCR", flipped, {
    rotatePages: true,
    redoOcr: true,
  });
  if (withRedo) {
    const o = await observe(withRedo);
    check(
      o.way === "upright" && o.sentinel.found === o.sentinel.of,
      "option on with Redo existing OCR: the 180° scan comes back upright and read",
      say(o),
    );
  }

  // ── 7. with Straighten crooked pages ────────────────────────────────────
  const both = await deps.scan(
    await turnedTextPage(180 + COMBINED_SKEW_DEGREES),
  );
  const bothWay = await orientation(both);
  const withDeskew = await run("option on with deskew", both, {
    rotatePages: true,
    deskew: true,
  });
  if (withDeskew) {
    const o = await observe(withDeskew);
    const skew = o.way === "upright" ? await skewOf(withDeskew) : "not upright";
    check(
      bothWay === "upside down" &&
        o.way === "upright" &&
        typeof skew === "number" &&
        Math.abs(skew) < LEVEL_DEGREES,
      `option on with Straighten crooked pages: a scan turned 180° + ${fmt(COMBINED_SKEW_DEGREES)} comes back upright and level`,
      `input painted ${bothWay}; output ${say(o)}; tilt ${
        typeof skew === "number" ? fmt(skew) : skew
      }`,
    );
  }

  log(
    failed === 0
      ? "PROVEN: Turn pages upright turns sideways and upside-down scans in this image, leaves upright and text pages alone, and its absence turns nothing."
      : `NOT PROVEN: ${failed} check(s) failed.`,
  );
  return failed === 0 ? 0 : 1;
}
