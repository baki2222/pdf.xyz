// Shared by page-tree.test.ts and page-tree-cycles.child.ts: the entry
// points the hostile matrix ran, grouped by family, and an outcome recorder
// that tells a typed refusal from a raw throw. Relative imports, so the child
// (node --import tsx) and vitest load the same modules.
import { optimizeLossless } from "../../lib/pdf/analyze";
import { cropPdf } from "../../lib/pdf/crop";
import { editPdf, getEditPageSizes } from "../../lib/pdf/edit";
import { PdfEngineError } from "../../lib/pdf/engine-errors";
import { extractPdfImages } from "../../lib/pdf/extract-images";
import { inspectFormFields } from "../../lib/pdf/forms";
import { addHeaderFooter } from "../../lib/pdf/header-footer";
import { readPdfMetadata, writePdfMetadata } from "../../lib/pdf/metadata";
import { overlayPdf } from "../../lib/pdf/overlay";
import { addPageNumbers, batesFormat } from "../../lib/pdf/page-numbers";
import { getRedactPageSizes, redactPdf } from "../../lib/pdf/redact";
import { resizePdf } from "../../lib/pdf/resize";
import { signPdf } from "../../lib/pdf/signature";
import { watermarkPdf } from "../../lib/pdf/watermark";
import { editingFixtures } from "./editing.fixtures";
import { STAMPING_INPUTS, partnerPdf } from "./stamping.fixtures";

/** A 1x1 opaque PNG, for the image watermark and image signature. */
export const PNG_1PX = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export type Outcome =
  | { kind: "refused"; message: string; unreadable: boolean }
  | { kind: "raw"; message: string }
  | { kind: "output" };

export async function stamping(id: string): Promise<Uint8Array> {
  const input = STAMPING_INPUTS.find((i) => i.id === id);
  if (!input) throw new Error(`no stamping input ${id}`);
  return input.build();
}
let editing: Awaited<ReturnType<typeof editingFixtures>> | null = null;
export async function editingInput(id: string): Promise<Uint8Array> {
  editing ??= await editingFixtures();
  const found = editing.find((f) => f.id === id);
  if (!found) throw new Error(`no editing input ${id}`);
  return found.bytes.slice();
}

/** What a call did: the typed refusal, raw throw, or success. */
export async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    await run();
    return { kind: "output" };
  } catch (err) {
    if (err instanceof PdfEngineError) {
      return {
        kind: "refused",
        message: err.message,
        unreadable: err.kind === "unreadable",
      };
    }
    return { kind: "raw", message: String((err as Error)?.message ?? err) };
  }
}

/** The nine stamping entry points, as the matrix ran them. */
export const STAMPERS: Record<string, (b: Uint8Array) => Promise<unknown>> = {
  "watermark-text": (b) => watermarkPdf(b, "HOSTILE"),
  "watermark-image": (b) => watermarkPdf(b, "", { image: { bytes: PNG_1PX } }),
  "page-numbers": (b) => addPageNumbers(b),
  bates: (b) => addPageNumbers(b, { format: batesFormat("ACME-", 6) }),
  "header-footer": (b) => addHeaderFooter(b, { header: { left: "HDR-{n}" } }),
  "overlay-base": (b) => overlayPdf(b, partnerPdf()),
  "overlay-top": (b) => overlayPdf(partnerPdf(), b),
  "sign-typed": (b) =>
    signPdf(
      b,
      { kind: "typed", text: "Jane Roe", style: "signature" },
      { pageIndex: 0, position: "bottom-right", width: 200 },
    ),
  "sign-image": (b) =>
    signPdf(
      b,
      { kind: "image", bytes: PNG_1PX, format: "png" },
      { pageIndex: 0, position: "bottom-right", width: 200 },
    ),
};

/** The editing entry points whose first act is a page walk. */
export const EDITORS: Record<string, (b: Uint8Array) => Promise<unknown>> = {
  getEditPageSizes: (b) => getEditPageSizes(b),
  editPdf: (b) =>
    editPdf(b, [
      {
        type: "rect",
        page: 1,
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        color: "#ff0000",
      },
    ]),
  cropPdf: (b) =>
    cropPdf(b, { margins: { top: 5, right: 5, bottom: 5, left: 5 } }),
  resizePdf: (b) =>
    resizePdf(b, {
      width: 595.28,
      height: 841.89,
      orientation: "match",
      mode: "fit",
    }),
  inspectFormFields: (b) => inspectFormFields(b),
  readPdfMetadata: (b) => readPdfMetadata(b),
  "writePdfMetadata(remove-all)": (b) =>
    writePdfMetadata(b, { kind: "remove-all" } as never),
};

/** The conversion-out entry points (compress, analyze, images, redact). */
export const CONVERTERS: Record<string, (b: Uint8Array) => Promise<unknown>> = {
  optimizeLossless: (b) => optimizeLossless(b),
  extractPdfImages: (b) => extractPdfImages(b),
  getRedactPageSizes: (b) => getRedactPageSizes(b),
  redactPdf: (b) =>
    redactPdf(b, {
      rects: [{ page: 1, x: 0, y: 0, width: 1, height: 1 }],
      dpi: 72,
    }),
};

export async function each(
  runners: Record<string, (b: Uint8Array) => Promise<unknown>>,
  bytes: Uint8Array,
) {
  const out: Record<string, Outcome> = {};
  for (const [name, run] of Object.entries(runners)) {
    out[name] = await outcome(() => run(bytes.slice()));
  }
  return out;
}
export const all = <T>(names: Record<string, unknown>, value: T) =>
  Object.fromEntries(Object.keys(names).map((k) => [k, value]));
