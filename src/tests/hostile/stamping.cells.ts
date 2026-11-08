/**
 * The stamping family's matrix machinery: the nine entry points as one
 * `runEngine` switch, the cell runner that turns a run into an OUTCOME, and
 * the readers that hold an output to what a READER receives (pdfjs for text
 * and page count, a small content-stream interpreter for the graphics state
 * a stamp is drawn in). Shared by `stamping.hostile.test.ts` (in-process
 * cells) and `stamping.child.ts` (cells run in a child process, so a hang or
 * a heap blow-up is recorded instead of freezing or killing the run).
 */

import { PdfEngineError } from "@/lib/pdf/engine-errors";
import { addHeaderFooter, validateHeaderFooter } from "@/lib/pdf/header-footer";
import { overlayPdf } from "@/lib/pdf/overlay";
import { addPageNumbers, batesFormat } from "@/lib/pdf/page-numbers";
import { signPdf } from "@/lib/pdf/signature";
import { watermarkPdf } from "@/lib/pdf/watermark";
import {
  partnerPdf,
  STAMPING_INPUTS,
  type StampingInput,
} from "./stamping.fixtures";

/** A 1x1 opaque PNG: the image for image-watermark and image-signature cells. */
export const PNG_1PX = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export const ENGINES = [
  "watermark-text",
  "watermark-image",
  "page-numbers",
  "bates",
  "header-footer",
  "overlay-base",
  "overlay-top",
  "sign-typed",
  "sign-image",
] as const;
export type EngineId = (typeof ENGINES)[number];

/** What the engine visibly stamps, so the output check can look for it. */
export const STAMP_TEXT: Partial<Record<EngineId, string>> = {
  "watermark-text": "HOSTILE",
  "page-numbers": "Page 1 of",
  bates: "ACME-000001",
  "header-footer": "HDR-1",
  "sign-typed": "Jane Roe",
  // The partner page's own line, drawn onto the hostile base by the overlay.
  "overlay-base": "Hostile control",
};

/**
 * Run one entry point on `bytes`. `overlay-base` overlays the valid partner
 * ONTO the hostile file; `overlay-top` overlays the hostile file onto the
 * valid partner (the hostile file is the overlay).
 */
export async function runEngine(
  engine: EngineId,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  switch (engine) {
    case "watermark-text":
      return (await watermarkPdf(bytes, "HOSTILE")).bytes;
    case "watermark-image":
      return (await watermarkPdf(bytes, "", { image: { bytes: PNG_1PX } }))
        .bytes;
    case "page-numbers":
      return addPageNumbers(bytes);
    case "bates":
      return addPageNumbers(bytes, { format: batesFormat("ACME-", 6) });
    case "header-footer": {
      const options = { header: { left: "HDR-{n}" } };
      validateHeaderFooter(options);
      return addHeaderFooter(bytes, options);
    }
    case "overlay-base":
      return (await overlayPdf(bytes, partnerPdf())).bytes;
    case "overlay-top":
      return (await overlayPdf(partnerPdf(), bytes)).bytes;
    case "sign-typed":
      return signPdf(
        bytes,
        { kind: "typed", text: "Jane Roe", style: "signature" },
        { pageIndex: 0, position: "bottom-right", width: 200 },
      );
    case "sign-image":
      return signPdf(
        bytes,
        { kind: "image", bytes: PNG_1PX, format: "png" },
        { pageIndex: 0, position: "bottom-right", width: 200 },
      );
  }
}

export async function inputById(
  id: string,
): Promise<{ bytes: Uint8Array; input: StampingInput }> {
  const input = STAMPING_INPUTS.find((i) => i.id === id);
  if (!input) throw new Error(`hostile input ${id} not in the stamping corpus`);
  return { bytes: await input.build(), input };
}

export type OutcomeKind =
  | "refused" // a PdfEngineError: its message is what the user reads
  | "output" // produced bytes
  | "internal" // threw something else: errorMessage() shows its raw message
  | "hang" // exceeded the time bound
  | "memory"; // died of heap / allocation failure

export interface Outcome {
  kind: OutcomeKind;
  message?: string;
  errorName?: string;
  errorKind?: string;
  bytes?: number;
  ms: number;
  peakRssMB?: number;
}

/** Race `work` against a bound; an ASYNC hang becomes a "hang" outcome. */
export function bounded<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof HANG> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<typeof HANG>((resolve) => {
      timer = setTimeout(() => resolve(HANG), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
export const HANG = Symbol("hang");

export async function runCell(
  engine: EngineId,
  bytes: Uint8Array,
  boundMs = 20_000,
): Promise<{ outcome: Outcome; output?: Uint8Array }> {
  const t0 = performance.now();
  try {
    const output = await bounded(runEngine(engine, bytes), boundMs);
    const ms = performance.now() - t0;
    if (output === HANG) return { outcome: { kind: "hang", ms } };
    return {
      outcome: { kind: "output", bytes: output.byteLength, ms },
      output,
    };
  } catch (error) {
    const ms = performance.now() - t0;
    const err = error as Error & { kind?: string };
    if (error instanceof PdfEngineError) {
      return {
        outcome: {
          kind: "refused",
          message: err.message,
          errorName: err.name,
          errorKind: err.kind,
          ms,
        },
      };
    }
    const message = String(err?.message ?? err);
    return {
      outcome: {
        kind: /allocation|heap out of memory|Array buffer/i.test(message)
          ? "memory"
          : "internal",
        message,
        errorName: err?.name ?? typeof error,
        ms,
      },
    };
  }
}

// ------------------------------------------------------------ output readers

export interface OutputCheck {
  /** Pages pdf-lib reads back from the output (-1: it cannot). */
  pages: number;
  /** Pages pdfjs — what our previews and Firefox show — reads back (-1: it cannot). */
  viewerPages: number;
  /** The engine's stamp text is visible to pdfjs on some page. */
  stampSeen: boolean | null;
  /** Page 1 as displayed. */
  size?: [number, number];
  /** Where the stamp text starts on page 1 (viewer frame, top-left origin). */
  stampAt?: [number, number];
  error?: string;
}

/** Read an engine's output back the way a reader receives it. */
export async function checkOutput(
  engine: EngineId,
  output: Uint8Array,
): Promise<OutputCheck> {
  const { PDFDocument } = await import("pdf-lib");
  let pages = -1;
  try {
    pages = (
      await PDFDocument.load(output, { ignoreEncryption: true })
    ).getPageCount();
  } catch {
    pages = -1;
  }
  const want = STAMP_TEXT[engine];
  try {
    const { readAsViewer } = await import("../pdfjs-viewer");
    const seen = await readAsViewer(output);
    const first = seen[0];
    const hit = want
      ? seen.flatMap((p) => p.runs).find((r) => r.str.includes(want))
      : undefined;
    return {
      pages,
      viewerPages: seen.length,
      stampSeen: want ? hit !== undefined : null,
      size: first ? [first.width, first.height] : undefined,
      stampAt: hit ? [Math.round(hit.x), Math.round(hit.y)] : undefined,
    };
  } catch (error) {
    return {
      pages,
      viewerPages: -1,
      stampSeen: want ? false : null,
      error: String((error as Error)?.message ?? error),
    };
  }
}

/** Where pdfjs shows the hand-built base line ("Hostile control") on page 1. */
export async function baseLineAt(
  bytes: Uint8Array,
): Promise<{ size: [number, number]; at: [number, number] } | null> {
  try {
    const { readAsViewer } = await import("../pdfjs-viewer");
    const seen = await readAsViewer(bytes);
    const first = seen[0];
    const run = first?.runs.find((r) => r.str.includes("Hostile control"));
    if (!first || !run) return null;
    return {
      size: [first.width, first.height],
      at: [Math.round(run.x), Math.round(run.y)],
    };
  } catch {
    return null;
  }
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/**
 * The current transformation matrix in force at the LAST `BT` or `Do` of page
 * 1 — the stamp, which every engine draws last — following `q`, `Q` and `cm`
 * exactly as a viewer does: a `Q` with nothing saved is ignored (pdfjs,
 * Acrobat). Strings, hex strings, comments and inline images are skipped so a
 * `q` inside `(…)` is not an operator. Independent of pdfjs, so it can read a
 * page pdfjs cannot finish.
 */
export async function ctmAtStamp(output: Uint8Array): Promise<Matrix | null> {
  const lib = await import("pdf-lib");
  const doc = await lib.PDFDocument.load(output, { ignoreEncryption: true });
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  if (!contents) return null;
  const refs =
    contents instanceof lib.PDFArray ? contents.asArray() : [contents];
  const chunks: string[] = [];
  for (const ref of refs) {
    const stream =
      ref instanceof lib.PDFRef ? doc.context.lookup(ref) : (ref as unknown);
    if (stream instanceof lib.PDFRawStream) {
      const data = lib.decodePDFRawStream(stream).decode();
      chunks.push(Buffer.from(data).toString("latin1"));
    } else if (stream instanceof lib.PDFContentStream) {
      chunks.push(Buffer.from(stream.getContents()).toString("latin1"));
    }
  }
  const src = chunks.join("\n");
  let ctm: Matrix = [...IDENTITY];
  const saved: Matrix[] = [];
  const operands: number[] = [];
  let atStamp: Matrix | null = null;
  let i = 0;
  const n = src.length;
  const isWs = (c: string) => " \t\r\n\f\0".includes(c);
  const isDelim = (c: string) => "()<>[]{}/%".includes(c);
  while (i < n) {
    const c = src[i]!;
    if (isWs(c)) {
      i += 1;
    } else if (c === "%") {
      while (i < n && src[i] !== "\n" && src[i] !== "\r") i += 1;
    } else if (c === "(") {
      let depth = 1;
      i += 1;
      while (i < n && depth > 0) {
        if (src[i] === "\\") i += 2;
        else {
          if (src[i] === "(") depth += 1;
          else if (src[i] === ")") depth -= 1;
          i += 1;
        }
      }
      operands.length = 0;
    } else if (c === "<" && src[i + 1] !== "<") {
      while (i < n && src[i] !== ">") i += 1;
      i += 1;
      operands.length = 0;
    } else if (
      c === "<" ||
      c === ">" ||
      c === "[" ||
      c === "]" ||
      c === "{" ||
      c === "}"
    ) {
      i += c === "<" || c === ">" ? 2 : 1;
    } else if (c === "/") {
      i += 1;
      while (i < n && !isWs(src[i]!) && !isDelim(src[i]!)) i += 1;
    } else {
      const start = i;
      while (i < n && !isWs(src[i]!) && !isDelim(src[i]!)) i += 1;
      const token = src.slice(start, i);
      const num = Number(token);
      if (token !== "" && Number.isFinite(num) && /^[+-]?[\d.]/.test(token)) {
        operands.push(num);
        continue;
      }
      if (token === "q") saved.push([...ctm]);
      else if (token === "Q") ctm = saved.pop() ?? ctm;
      else if (token === "cm" && operands.length >= 6) {
        const m = operands.slice(-6) as Matrix;
        ctm = multiply(m, ctm);
      } else if (token === "BT" || token === "Do") atStamp = [...ctm];
      else if (token === "BI") {
        const end = src.indexOf("EI", i);
        i = end < 0 ? n : end + 2;
      }
      operands.length = 0;
    }
  }
  return atStamp;
}

/** The linear scale of a matrix (sqrt of |det|): 1 for no scaling. */
export const scaleOf = (m: Matrix): number =>
  Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
