/**
 * ONE conversion-out matrix cell, run in a child process of its own:
 *
 *     node --import tsx conversion-out.cell.ts <engine> <input.pdf> <control.pdf> <boundMs>
 *
 * prints one line `@@CELL {json}` and exits. `conversion-out.hostile.test.ts`
 * spawns it, kills it at the cell's time bound (a hang is then a recorded
 * finding, not a frozen run — pdf-lib's decoders and pdf.js's parser are
 * synchronous, so no in-process timer can interrupt them), and caps its heap
 * (a blow-up is a crash of the child, not of the suite).
 *
 * The child stands up what the browser gives the shipped code and Node does
 * not, the same way `render-transparent.test.ts` does under jsdom: a
 * `document` whose `createElement("canvas")` is pdf.js's own Node canvas
 * (`@napi-rs/canvas`), and `globalThis.pdfjsWorker`, pdf.js's in-process
 * worker. With them `capturePdfPages` — and so PDF to JPG/PNG, Grayscale and
 * Redact — runs the code that ships, unmodified. Text engines get the legacy
 * build as their `loadReader`, as every text test does.
 *
 * What a cell reports is the engine's OWN result, summarised, plus a few
 * checks only the child can make (re-open the output, read its text back).
 * Judging it is the parent's job.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

type Json = Record<string, unknown>;

export const ENGINES = [
  "text",
  "text-items",
  "lines",
  "has-text",
  "markdown",
  "compare",
  "extract-images",
  "compress",
  "analyze",
  "redact-sizes",
  "redact",
  "grayscale",
  "to-jpg",
  "to-png",
] as const;
export type EngineId = (typeof ENGINES)[number];

/** Engines whose result is pixels (they go through `capturePdfPages`). */
export const RASTER_ENGINES: readonly EngineId[] = [
  "redact",
  "grayscale",
  "to-jpg",
  "to-png",
];

export interface CellError {
  name: string;
  /** `err instanceof PdfEngineError` — the runner shows its message as is. */
  engineError: boolean;
  kind?: string;
  message: string;
  /** First stack frame, for the report. */
  at?: string;
}

export interface CellRecord {
  engine: EngineId;
  ok: boolean;
  ms: number;
  /** Peak resident set of the child, MB. */
  rssMb: number;
  /** The signal handed to the engine had fired when it returned. */
  aborted?: boolean;
  out?: Json;
  error?: CellError;
}

async function setUpBrowserShims(): Promise<void> {
  const require = createRequire(import.meta.url);
  await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker: unknown = await import(
    // @ts-expect-error -- pdfjs-dist ships no type declarations for its worker.
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  (globalThis as Record<string, unknown>).pdfjsWorker = worker;
  const napi = createRequire(require.resolve("pdfjs-dist/package.json"))(
    "@napi-rs/canvas",
  ) as { createCanvas(w: number, h: number): unknown };
  (globalThis as Record<string, unknown>).document = {
    createElement(tag: string) {
      if (tag.toLowerCase() !== "canvas")
        throw new Error(`shim: no <${tag}> outside a browser`);
      return napi.createCanvas(1, 1);
    },
  };
}

const legacyReader = () =>
  import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as Promise<
    Pick<typeof import("pdfjs-dist"), "getDocument">
  >;

async function pdfLibPages(bytes: Uint8Array): Promise<number | string> {
  const { PDFDocument } = await import("pdf-lib");
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return doc.getPageCount();
  } catch (err) {
    return `pdf-lib: ${(err as Error).message}`.slice(0, 120);
  }
}

async function readBack(bytes: Uint8Array): Promise<Json> {
  const { extractPdfText } = await import("@/lib/pdf/text");
  try {
    const t = await extractPdfText(bytes, legacyReader);
    return {
      pages: t.pageCount,
      marker: t.text.includes("HOSTILE MARKER"),
      sample: t.text.slice(0, 60),
    };
  } catch (err) {
    return { error: (err as Error).message.slice(0, 120) };
  }
}

/** Peak resident set so far, MB — read BEFORE a cell's own checks run. */
const peakRssMb = () => Math.round(process.resourceUsage().maxRSS / 1024);

const latin = (b: Uint8Array) => Buffer.from(b).toString("latin1");

/** Share of an encoded image's pixels that are dark (luma < 128): 0 is blank. */
async function inkOf(image: Uint8Array): Promise<number | string> {
  const require = createRequire(import.meta.url);
  const napi = createRequire(require.resolve("pdfjs-dist/package.json"))(
    "@napi-rs/canvas",
  ) as {
    createCanvas(
      w: number,
      h: number,
    ): {
      getContext(k: "2d"): {
        drawImage(i: unknown, x: number, y: number): void;
        getImageData(
          x: number,
          y: number,
          w: number,
          h: number,
        ): {
          data: Uint8ClampedArray;
        };
      };
    };
    loadImage(src: Buffer): Promise<{ width: number; height: number }>;
  };
  try {
    const img = await napi.loadImage(Buffer.from(image));
    const ctx = napi.createCanvas(img.width, img.height).getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma =
        data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
      if (luma < 128 && data[i + 3]! > 0) dark += 1;
    }
    return Number((dark / (img.width * img.height)).toFixed(5));
  } catch (err) {
    return `decode: ${(err as Error).message}`.slice(0, 80);
  }
}

export async function runEngine(
  engine: EngineId,
  bytes: Uint8Array,
  control: Uint8Array,
  signal: AbortSignal,
): Promise<Json> {
  switch (engine) {
    case "text": {
      const { extractPdfText } = await import("@/lib/pdf/text");
      const t = await extractPdfText(bytes, legacyReader);
      return {
        pageCount: t.pageCount,
        chars: t.characterCount,
        hasText: t.hasText,
        marker: t.text.includes("HOSTILE MARKER"),
        sample: t.text.slice(0, 80),
      };
    }
    case "text-items": {
      const { extractPdfTextItems } = await import("@/lib/pdf/text");
      const t = await extractPdfTextItems(bytes, legacyReader);
      const strs = t.pages.flat().map((i) => i.str ?? "");
      return {
        pageCount: t.pageCount,
        items: strs.length,
        marker: strs.join(" ").includes("HOSTILE MARKER"),
      };
    }
    case "lines": {
      const { extractPdfLines } = await import("@/lib/pdf/text");
      const t = await extractPdfLines(bytes, undefined, legacyReader);
      return {
        pageCount: t.pageCount,
        lines: t.pages.reduce((n, p) => n + p.lines.length, 0),
        marker: t.text.includes("HOSTILE MARKER"),
      };
    }
    case "has-text": {
      const { pdfHasSelectableText } = await import("@/lib/pdf/text");
      return { hasText: await pdfHasSelectableText(bytes) };
    }
    case "markdown": {
      const { pdfToMarkdown } = await import("@/lib/pdf/pdf-to-markdown-read");
      const r = await pdfToMarkdown(bytes, {}, legacyReader);
      return {
        pageCount: r.pageCount,
        chars: r.characterCount,
        hasMarkdown: r.hasMarkdown,
        linkCount: r.linkCount,
        marker: r.markdown.includes("HOSTILE MARKER"),
        javascriptLink: /\]\(\s*javascript:|<\s*javascript:/i.test(r.markdown),
        sample: r.markdown.slice(0, 120),
      };
    }
    case "compare": {
      const { extractPdfText } = await import("@/lib/pdf/text");
      const { compareExtractedPdfText } = await import("@/lib/pdf/compare-pdf");
      const left = await extractPdfText(bytes, legacyReader);
      const right = await extractPdfText(control, legacyReader);
      const r = compareExtractedPdfText(
        { name: "hostile.pdf", size: bytes.length, extracted: left },
        { name: "control.pdf", size: control.length, extracted: right },
      );
      return {
        verdict: r.verdict,
        hasComparableText: r.hasComparableText,
        leftPageCount: r.leftPageCount,
        reportChars: r.report.length,
      };
    }
    case "extract-images": {
      const { extractPdfImages } = await import("@/lib/pdf/extract-images");
      const r = await extractPdfImages(bytes);
      return {
        pageCount: r.pageCount,
        images: r.images.length,
        imageBytes: r.images.reduce((n, i) => n + i.bytes.length, 0),
        dims: r.images.slice(0, 3).map((i) => `${i.width}x${i.height}`),
        skipped: r.skipped.map((s) => s.reason).slice(0, 5),
      };
    }
    case "compress": {
      const { optimizeLossless } = await import("@/lib/pdf/analyze");
      const r = await optimizeLossless(bytes);
      const engineRssMb = peakRssMb();
      const text = latin(r.bytes);
      return {
        outBytes: r.bytes.length,
        engineRssMb,
        signatureCount: r.signatureCount,
        outPdfLibPages: await pdfLibPages(r.bytes),
        readBack: await readBack(r.bytes),
        keeps: {
          javascript: text.includes("/JavaScript"),
          launch: text.includes("/Launch"),
          embeddedFile: text.includes("/EmbeddedFile"),
          openAction: text.includes("/OpenAction"),
        },
      };
    }
    case "analyze": {
      const { analyzePdf } = await import("@/lib/pdf/analyze");
      const r = await analyzePdf(bytes);
      return {
        pageCount: r.analysis.pageCount,
        imageCount: r.analysis.imageCount,
        signatureCount: r.analysis.signatureCount,
        optimizedBytes: r.analysis.optimizedBytes,
        removed: r.analysis.removed,
      };
    }
    case "redact-sizes": {
      const { getRedactPageSizes } = await import("@/lib/pdf/redact");
      const sizes = await getRedactPageSizes(bytes);
      return {
        count: sizes.length,
        first: sizes[0],
        allFinitePositive: sizes.every(
          (s) =>
            Number.isFinite(s.width) &&
            Number.isFinite(s.height) &&
            s.width > 0 &&
            s.height > 0,
        ),
      };
    }
    case "redact": {
      const { redactPdf, getRedactPageSizes } =
        await import("@/lib/pdf/redact");
      const { rasterizePdf } = await import("@/lib/pdf/render");
      // The boxes are placed against pdf-lib's sizes (the UI's), and painted
      // against pdf.js's render: the two must agree or a box lands elsewhere.
      let rasterSize: { w: number; h: number } | null = null;
      const r = await redactPdf(
        bytes,
        {
          rects: [{ page: 1, x: 0, y: 0, width: 1, height: 1 }],
          dpi: 72,
          signal,
        },
        (pdf, opts) =>
          rasterizePdf(pdf, {
            ...opts,
            onCanvas: (canvas, page) => {
              if (page.index === 0)
                rasterSize = { w: page.pageWidth, h: page.pageHeight };
              opts.onCanvas?.(canvas, page);
            },
          }),
      );
      const engineRssMb = peakRssMb();
      const sizes = await getRedactPageSizes(bytes);
      return {
        pageCount: r.pageCount,
        outBytes: r.bytes.length,
        engineRssMb,
        undecodedImages: r.undecodedImages,
        outPdfLibPages: await pdfLibPages(r.bytes),
        pdfLibSize: sizes[0],
        pdfjsSize: rasterSize,
      };
    }
    case "grayscale": {
      const { grayscalePdf } = await import("@/lib/pdf/grayscale");
      const r = await grayscalePdf(bytes, { dpi: 72, signal });
      const engineRssMb = peakRssMb();
      return {
        pageCount: r.pageCount,
        outBytes: r.bytes.length,
        engineRssMb,
        undecodedImages: r.undecodedImages,
        outPdfLibPages: await pdfLibPages(r.bytes),
      };
    }
    case "to-jpg":
    case "to-png": {
      const { rasterizePdf } = await import("@/lib/pdf/render");
      const failures: string[] = [];
      const pages = await rasterizePdf(bytes, {
        format: engine === "to-jpg" ? "jpg" : "png",
        dpi: 72,
        signal,
        onPageFailed: ({ index, message }) =>
          failures.push(`${index}: ${message}`),
      });
      return {
        pages: pages.length,
        failures: failures.slice(0, 3),
        failureCount: failures.length,
        first: pages[0]
          ? {
              w: pages[0].width,
              h: pages[0].height,
              pageW: pages[0].pageWidth,
              pageH: pages[0].pageHeight,
              dpi: pages[0].dpi,
              capped: pages[0].dpiCapped,
              bytes: pages[0].bytes.length,
              ink: await inkOf(pages[0].bytes),
            }
          : null,
        undecodedImages: pages.reduce((n, p) => n + p.undecodedImages, 0),
      };
    }
  }
}

async function main(): Promise<void> {
  const [engine, input, controlPath, boundArg] = process.argv.slice(-4) as [
    EngineId,
    string,
    string,
    string,
  ];
  await setUpBrowserShims();
  const { PdfEngineError } = await import("@/lib/pdf/engine-errors");
  const bytes = new Uint8Array(readFileSync(input));
  const control = new Uint8Array(readFileSync(controlPath));
  // The engine's own abort, a little inside the parent's kill.
  const signal = AbortSignal.timeout(Math.max(1000, Number(boundArg) - 3000));
  const started = performance.now();
  const record: CellRecord = { engine, ok: false, ms: 0, rssMb: 0 };
  try {
    record.out = await runEngine(engine, bytes, control, signal);
    record.ok = true;
  } catch (err) {
    const e = err as Error & { kind?: string };
    record.error = {
      name: e?.name ?? typeof err,
      engineError: err instanceof PdfEngineError,
      ...(e?.kind ? { kind: e.kind } : {}),
      message: String(e?.message ?? err).slice(0, 300),
      at: String(e?.stack ?? "")
        .split("\n")
        .find((l) => l.trim().startsWith("at "))
        ?.trim()
        .slice(0, 160),
    };
  }
  record.ms = Math.round(performance.now() - started);
  record.aborted = signal.aborted;
  record.rssMb = Math.round(process.resourceUsage().maxRSS / 1024);
  process.stdout.write(`\n@@CELL ${JSON.stringify(record)}\n`, () =>
    process.exit(0),
  );
}

if (process.argv.some((a) => a.endsWith("conversion-out.cell.ts"))) {
  void main();
}
