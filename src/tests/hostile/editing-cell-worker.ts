import { parentPort, workerData } from "node:worker_threads";
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { PdfEncryptedError, PdfEngineError } from "@/lib/pdf/engine-errors";
import { checkEditTextFit, editPdf, getEditPageSizes } from "@/lib/pdf/edit";
import {
  exportEditedPdf,
  readEditorDocument,
  readExportFrames,
} from "@/lib/pdf/editor-export";
import {
  appendEditsAsUpdate,
  saveSignedEdit,
  signaturesKept,
} from "@/lib/pdf/editor/append-update";
import {
  annotatePdf,
  findNoteOverflows,
  getAnnotatePageSizes,
} from "@/lib/pdf/annotate";
import { applyFormValues, inspectFormFields } from "@/lib/pdf/forms";
import { createFormFields, readFormContext } from "@/lib/pdf/create-forms";
import { flattenPdf, inspectForm } from "@/lib/pdf/flatten";
import { readPdfMetadata, writePdfMetadata } from "@/lib/pdf/metadata";
import { cropPdf, getPageSizes, getUprightPageSizes } from "@/lib/pdf/crop";
import { resizePdf } from "@/lib/pdf/resize";
import { appliedMargins, planAutoCrop, findInkBox } from "@/lib/pdf/auto-crop";
import { NO_CROP } from "@/lib/pdf/crop";
import type { EditorObject } from "@/lib/pdf/editor/model";

/**
 * The editing family's cell runner, in a worker thread so the matrix can
 * bound a cell the event loop cannot: pdf-lib parses synchronously, and a
 * synchronous infinite loop never yields to a vitest timeout. The parent
 * terminates this worker past the bound (a HANG) and its resource limits
 * turn a runaway heap into ERR_WORKER_OUT_OF_MEMORY (a MEMORY finding).
 *
 * Every op takes the fixture bytes and returns plain facts: what a PDF
 * output reloads as, or what a size list holds. Judging them is the
 * matrix's job, against the fixture's own expected page count.
 */

export interface OutputFacts {
  /** Bytes of the output PDF. */
  bytes: number;
  /** Did the output reload in pdf-lib (lenient: encryption ignored)? */
  reloads: boolean;
  reloadError?: string;
  pages?: number;
  /** Page sizes of the reloaded output (first 5). */
  sizes?: [number, number][];
  /** Active-content keys still present anywhere in the output. */
  active?: string[];
  /** q minus Q over page 1's content streams, in order (H24). */
  qDepthBeforeLastStream?: number;
}

export type CellOutcome =
  | {
      status: "ok";
      value: unknown;
      output?: OutputFacts;
      /**
       * How far the process's PEAK resident set rose during the op, in MB.
       * Monotonic and process-wide, so it sees only a cell that exceeds every
       * earlier peak — enough for a 1 GiB inflation from a 1 MB file, and
       * stated so nobody reads a 0 as "allocated nothing".
       */
      peakRssGrowthMb?: number;
    }
  | {
      status: "threw";
      name: string;
      message: string;
      engine: boolean;
      encryptedError: boolean;
      kind?: string;
      verdict?: string | null;
      stack?: string;
    };

const ACTIVE = [
  "JavaScript",
  "JS",
  "Launch",
  "OpenAction",
  "AA",
  "EmbeddedFiles",
  "javascript:",
];

async function facts(out: Uint8Array, measureQ: boolean): Promise<OutputFacts> {
  const result: OutputFacts = { bytes: out.length, reloads: false };
  try {
    const doc = await PDFDocument.load(out, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    result.reloads = true;
    // Read OBJECTS, not bytes: pdf-lib's default save packs dictionaries into
    // compressed object streams, where a byte search finds nothing at all.
    const text = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) =>
        obj instanceof PDFRawStream ? obj.dict.toString() : obj.toString(),
      )
      .join("\n");
    result.active = ACTIVE.filter((k) =>
      k === "javascript:"
        ? text.includes(k)
        : new RegExp(`/${k}\\b`).test(text),
    );
    result.pages = doc.getPageCount();
    result.sizes = doc
      .getPages()
      .slice(0, 5)
      .map((p) => {
        const { width, height } = p.getSize();
        return [width, height];
      });
    const first = doc.getPages()[0];
    // Decoding content is the HARNESS's cost, not the engine's: only where asked.
    if (first && measureQ) {
      const contents = first.node.Contents();
      const refs = contents
        ? "asArray" in contents
          ? (contents as unknown as { asArray(): unknown[] }).asArray()
          : [first.node.get(PDFName.of("Contents"))]
        : [];
      let depth = 0;
      const streams = refs.map((r) => doc.context.lookup(r as never));
      streams.forEach((s, i) => {
        if (i === streams.length - 1) result.qDepthBeforeLastStream = depth;
        if (!(s instanceof PDFRawStream)) return;
        let body = "";
        try {
          body = Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
        } catch {
          return;
        }
        for (const m of body.matchAll(/(?:^|\s)([qQ])(?=\s|$)/g))
          depth += m[1] === "q" ? 1 : -1;
      });
    }
  } catch (err) {
    result.reloadError =
      err instanceof Error ? err.message.slice(0, 200) : String(err);
  }
  return result;
}

const sizesOf = (value: unknown) => value;

/** A lenient re-save, standing in for "the editor's output" of `bytes`. */
async function resaved(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
    return await doc.save({ useObjectStreams: false });
  } catch {
    return bytes;
  }
}

const WHITEOUT: EditorObject = {
  id: "w",
  kind: "whiteout",
  page: 0,
  x: 10,
  y: 10,
  width: 20,
  height: 20,
} as EditorObject;

const noJpeg = { decodeJpeg: null };

type Op = (
  bytes: Uint8Array,
  plan?: unknown,
) => Promise<{ value: unknown; out?: Uint8Array }>;

export const OPS: Record<string, Op> = {
  "edit.getEditPageSizes": async (b) => ({
    value: sizesOf(await getEditPageSizes(b)),
  }),
  "edit.editPdf": async (b, plan) => {
    const page = typeof plan === "number" ? plan : 1;
    const r = await editPdf(b, [
      {
        type: "rect",
        page,
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        color: "#ff0000",
      },
    ]);
    return { value: { pages: r.pageCount ?? undefined }, out: r.bytes };
  },
  "edit.checkEditTextFit(sizes)": async (b) => {
    const sizes = await getEditPageSizes(b);
    const issues = await checkEditTextFit(
      [
        {
          type: "text",
          page: 1,
          x: 10,
          y: 10,
          text: "Hello",
          color: "#000000",
          size: 14,
        },
      ],
      sizes,
    );
    return { value: { sizes, issues } };
  },
  "editor.readEditorDocument": async (b) => {
    const d = await readEditorDocument(b);
    return {
      value: {
        frames: d.frames.map((f) => [f.width, f.height]),
        links: d.links.length,
        fields: d.fields.length,
      },
    };
  },
  "editor.readExportFrames": async (b) => ({
    value: (await readExportFrames(b)).map((f) => [f.width, f.height]),
  }),
  "editor.exportEditedPdf": async (b, plan) => {
    const page = typeof plan === "number" ? plan : 0;
    const r = await exportEditedPdf(
      b,
      [{ ...WHITEOUT, page } as EditorObject],
      noJpeg,
    );
    return {
      value: { pageCount: r.pageCount, objectCount: r.objectCount },
      out: r.bytes,
    };
  },
  "append.appendEditsAsUpdate": async (b) => {
    const out = await appendEditsAsUpdate(b, await resaved(b));
    return {
      value: {
        prefixKept: Buffer.from(out.subarray(0, b.length)).equals(
          Buffer.from(b),
        ),
      },
      out,
    };
  },
  "append.saveSignedEdit": async (b) => {
    const edited = (
      await editPdf(b, [
        {
          type: "rect",
          page: 1,
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          color: "#ff0000",
        },
      ])
    ).bytes;
    const r = await saveSignedEdit(b, edited, []);
    return {
      value: {
        mode: r.mode,
        reason: r.reason,
        signatures: r.signatures,
        prefixKept: Buffer.from(r.bytes.subarray(0, b.length)).equals(
          Buffer.from(b),
        ),
      },
      out: r.bytes,
    };
  },
  "append.signaturesKept(self)": async (b) => ({
    value: await signaturesKept(b, b),
  }),
  "append.signaturesKept(resaved)": async (b) => ({
    value: await signaturesKept(b, await resaved(b)),
  }),
  "annotate.getAnnotatePageSizes": async (b) => ({
    value: await getAnnotatePageSizes(b),
  }),
  "annotate.annotatePdf": async (b, plan) => {
    const page = typeof plan === "number" ? plan : 1;
    const r = await annotatePdf(b, [
      {
        type: "highlight",
        page,
        x: 10,
        y: 10,
        width: 40,
        height: 12,
        color: "#ffff00",
      },
    ]);
    return { value: { pageCount: r.pageCount }, out: r.bytes };
  },
  "annotate.findNoteOverflows(sizes)": async (b) => {
    const sizes = await getAnnotatePageSizes(b);
    const issues = await findNoteOverflows(
      [{ type: "note", page: 1, x: 10, y: 10, text: "Note", color: "#000000" }],
      sizes,
    );
    return { value: { sizes, issues } };
  },
  "forms.inspectFormFields": async (b) => {
    const r = await inspectFormFields(b);
    return { value: { fields: r.fields.length } };
  },
  "forms.applyFormValues": async (b) => {
    const r = await applyFormValues(b, {
      name: "filled",
      loop: "filled",
      self: "filled",
    });
    return { value: { outcomes: r.outcomes?.length }, out: r.bytes };
  },
  "forms.applyFormValues(flatten)": async (b) => {
    const r = await applyFormValues(
      b,
      { name: "filled", loop: "filled", self: "filled" },
      { flatten: true },
    );
    return { value: { flattened: r.flattened }, out: r.bytes };
  },
  "createForms.readFormContext": async (b) => {
    const r = await readFormContext(b);
    return {
      value: {
        sizes: r.pageSizes,
        pageCount: r.pageCount,
        existing: r.existingNames.length,
      },
    };
  },
  "createForms.createFormFields": async (b, plan) => {
    const page = typeof plan === "number" ? plan : 1;
    const r = await createFormFields(b, [
      {
        type: "text",
        name: "hostile_new",
        page,
        x: 10,
        y: 10,
        width: 60,
        height: 18,
      },
    ]);
    return { value: { fieldCount: r.fieldCount }, out: r.bytes };
  },
  "flatten.inspectForm": async (b) => ({ value: await inspectForm(b) }),
  "flatten.flattenPdf": async (b) => {
    const r = await flattenPdf(b);
    return {
      value: { flattenedFields: r.flattenedFields, skipped: r.skipped.length },
      out: r.bytes,
    };
  },
  "metadata.readPdfMetadata": async (b) => {
    const r = await readPdfMetadata(b);
    return { value: { title: r.title, hasXmp: r.hasXmp } };
  },
  "metadata.writePdfMetadata(edit)": async (b) => {
    const r = await writePdfMetadata(b, {
      kind: "edit",
      values: {
        title: "Hostile",
        author: "",
        subject: "",
        keywords: "",
        creator: "",
        producer: "",
        creationDate: null,
        modificationDate: null,
      },
    });
    return { value: { title: r.saved?.title }, out: r.bytes };
  },
  "metadata.writePdfMetadata(remove-all)": async (b) => {
    const r = await writePdfMetadata(b, { kind: "remove-all" });
    return { value: {}, out: r.bytes };
  },
  "crop.getPageSizes": async (b) => ({ value: await getPageSizes(b) }),
  "crop.getUprightPageSizes": async (b) => ({
    value: await getUprightPageSizes(b),
  }),
  "crop.cropPdf": async (b, plan) => {
    const pages = Array.isArray(plan) ? (plan as number[]) : undefined;
    const out = await cropPdf(b, {
      margins: { top: 5, right: 5, bottom: 5, left: 5 },
      ...(pages ? { pages } : {}),
    });
    return { value: {}, out: out as unknown as Uint8Array };
  },
  /**
   * The composed auto-crop chain as the tool runs it: displayed sizes from
   * the file, an analysis raster per page (synthetic here: ink in the middle
   * third), the plan, and `cropPdf` with the plan's per-page margins.
   */
  "autoCrop.chain": async (b) => {
    const sizes = await getUprightPageSizes(b);
    const W = 42;
    const H = 42;
    const data = new Uint8Array(W * H * 4).fill(255);
    for (let y = 14; y < 28; y++)
      for (let x = 14; x < 28; x++) data.set([0, 0, 0, 255], (y * W + x) * 4);
    const raster = { width: W, height: H, data };
    const ink = findInkBox(raster);
    const plan = planAutoCrop(
      sizes.map(() => ({ ink, raster })),
      sizes,
    );
    const perPage = appliedMargins(plan, "per-page");
    const out = await cropPdf(b, { margins: NO_CROP, perPage });
    return {
      value: { perPage: perPage.slice(0, 3) },
      out: out as unknown as Uint8Array,
    };
  },
  "resize.resizePdf(fit)": async (b, plan) => {
    const pages = Array.isArray(plan) ? (plan as number[]) : undefined;
    const r = await resizePdf(b, {
      width: 595,
      height: 842,
      orientation: "match",
      mode: "fit",
      ...(pages ? { pages } : {}),
    });
    return {
      value: { pageCount: r.pageCount, resizedPages: r.resizedPages },
      out: r.bytes,
    };
  },
  "resize.resizePdf(canvas)": async (b) => {
    const r = await resizePdf(b, {
      width: 612,
      height: 792,
      orientation: "portrait",
      mode: "canvas",
    });
    return {
      value: { pageCount: r.pageCount, resizedPages: r.resizedPages },
      out: r.bytes,
    };
  },
};

export async function runCell(
  op: string,
  bytes: Uint8Array,
  plan?: unknown,
  measureQ = false,
): Promise<CellOutcome> {
  const fn = OPS[op];
  if (!fn) throw new Error(`unknown op ${op}`);
  try {
    const before = process.resourceUsage().maxRSS;
    const { value, out } = await fn(bytes, plan);
    const peakRssGrowthMb = Math.round(
      (process.resourceUsage().maxRSS - before) / 1024,
    );
    const output =
      out instanceof Uint8Array ? await facts(out, measureQ) : undefined;
    return {
      status: "ok",
      value: JSON.parse(JSON.stringify(value ?? null)),
      peakRssGrowthMb,
      ...(output ? { output } : {}),
    };
  } catch (err) {
    const e = err as Error;
    return {
      status: "threw",
      name: e?.name ?? typeof err,
      message: String(e?.message ?? err).slice(0, 400),
      engine: err instanceof PdfEngineError,
      encryptedError: err instanceof PdfEncryptedError,
      kind: (err as PdfEngineError)?.kind,
      verdict: (err as PdfEncryptedError)?.verdict,
      stack: String(e?.stack ?? "")
        .split("\n")
        .slice(0, 6)
        .join("\n"),
    };
  }
}

// Only when spawned by the cell pool: vitest's own thread pool has a
// parentPort too, and a listener on it would read vitest's messages.
if ((workerData as { hostileCell?: boolean } | null)?.hostileCell)
  parentPort?.on(
    "message",
    async (msg: {
      id: number;
      op: string;
      bytes: Uint8Array;
      plan?: unknown;
      measureQ?: boolean;
    }) => {
      const outcome = await runCell(msg.op, msg.bytes, msg.plan, msg.measureQ);
      parentPort!.postMessage({ id: msg.id, outcome });
    },
  );
