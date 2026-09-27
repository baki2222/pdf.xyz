// @vitest-environment jsdom
/**
 * What the Grayscale PDF result screen tells a reader about size.
 *
 * Grayscale rebuilds every page as an image, so a text PDF comes back far
 * larger than it went in: audited at 67e8d0f through the same pdf.js + JPEG
 * q=0.88 pipeline, 13,707 bytes became 4,245,048 at the default 150 DPI
 * (x310). The result screen said only `10 pages rasterized · 4.0 MB` — the
 * new size with nothing to compare it to — while Compress PDF's related band
 * and the compress guide were sending readers here to make files SMALLER.
 *
 * So the screen owes the reader both numbers, and a reason when the second is
 * bigger.
 *
 * ── REWRITTEN 2026-09-27, at the merge with L08 — history kept ──────────────
 *
 * This file was written (L07, 6eb730f) as `grayscale-runner.test.tsx` with
 * `vi.mock("@/lib/pdf/grayscale")` replacing the engine call, because jsdom
 * has no rasterizer. L08 (f7b04c6) wrote a test at the SAME path that runs the
 * real engine through the real component tree. Merged, they could not share a
 * file (a hoisted mock would have replaced L08's engine too), and apart they
 * could not coexist: under `isolate: false` the mocking file left
 * `grayscale-runner.tsx` in the shared module cache bound to the stub, and
 * L08's grayscale, overlay and rotate runner tests import it
 * (`src/tests/mock-isolation.test.ts` named all three). So this file now runs
 * the REAL engine the way L08's does — `@napi-rs/canvas` for the canvas and
 * pdf.js on the main thread, both as global stubs restored after each test —
 * and the two sizes it asserts are the ones a real conversion produces.
 */
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { formatBytes } from "@/lib/utils";
import { GRAYSCALE_GREW_NOTE } from "@/lib/pdf/grayscale";
import { GrayscaleEditor } from "./grayscale-runner";
import type { LoadedPdf } from "./use-single-pdf";

const requireHere = createRequire(import.meta.url);
const napi = createRequire(requireHere.resolve("pdfjs-dist/package.json"))(
  "@napi-rs/canvas",
) as { createCanvas(width: number, height: number): HTMLCanvasElement };

let canvasesMade = 0;

beforeEach(async () => {
  canvasesMade = 0;
  await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker: unknown = await import(
    // @ts-expect-error -- pdfjs-dist ships no type declarations for its worker.
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  vi.stubGlobal("pdfjsWorker", worker);
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) => {
    if (tag.toLowerCase() !== "canvas") return createElement(tag, options);
    canvasesMade++;
    return napi.createCanvas(1, 1);
  }) as typeof document.createElement);
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A small text-only PDF: a few KB of vectors, which rasterizing inflates. */
async function textPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i += 1) {
    const page = doc.addPage([288, 216]);
    for (let line = 0; line < 8; line += 1)
      page.drawText(`Page ${i}, line ${line + 1}: quarterly figures`, {
        x: 18,
        y: 190 - line * 22,
        size: 11,
        font,
      });
  }
  return doc.save();
}

/**
 * A heavy PDF whose pages are nearly empty: one page, plus 3 MB of stream
 * data no page draws. What a reader sees is tiny, so the rebuilt file is
 * smaller than the one that went in — the case a scanned, over-resolved
 * upload is in.
 */
async function heavyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([288, 216]);
  doc.context.register(doc.context.stream(new Uint8Array(3_000_000)));
  return doc.save({ useObjectStreams: false });
}

function loaded(bytes: Uint8Array, pageCount: number): LoadedPdf {
  return {
    file: new File([bytes.slice()], "report.pdf", {
      type: "application/pdf",
    }),
    bytes,
    pageCount,
    rotations: Array.from({ length: pageCount }, () => 0 as const),
  };
}

/** Convert through the editor a user sees; return the result panel's text. */
async function resultText(pdf: LoadedPdf): Promise<string> {
  render(<GrayscaleEditor pdf={pdf} onReset={() => {}} />);
  fireEvent.click(
    screen.getByRole("button", { name: /convert to grayscale/i }),
  );
  const panel = await waitFor(
    () => screen.getByRole("group", { name: /grayscale pdf ready/i }),
    { timeout: 20_000 },
  );
  // Health check: the engine really ran, page by page, through a canvas.
  expect(canvasesMade, "no page was rendered to a canvas").toBeGreaterThan(0);
  return panel.textContent ?? "";
}

const UNIT = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 } as const;

/**
 * The "input → output" sizes the summary states, in bytes (to formatBytes's
 * precision). The input must be the uploaded file's own size.
 */
function statedSizes(text: string, input: number): [number, number] {
  const m = /([\d.]+) (B|KB|MB|GB) → ([\d.]+) (B|KB|MB|GB)/.exec(text);
  expect(m, `no "input → output" sizes in: ${text}`).not.toBeNull();
  expect(`${m![1]} ${m![2]}`).toBe(formatBytes(input));
  const bytes = (value: string, unit: string) =>
    Number(value) * UNIT[unit as keyof typeof UNIT];
  return [bytes(m![1]!, m![2]!), bytes(m![3]!, m![4]!)];
}

describe("the grayscale result screen states the size change", () => {
  it("a text PDF that grew shows both sizes and says why", async () => {
    const bytes = await textPdf();
    const text = await resultText(loaded(bytes, 2));
    const [input, output] = statedSizes(text, bytes.byteLength);
    expect(output, "the fixture did not grow").toBeGreaterThan(input);
    expect(text).toContain(GRAYSCALE_GREW_NOTE);
  }, 30_000);

  it("a file that shrank shows both sizes and no warning", async () => {
    // Negative control: a heavy upload can shrink here, and a warning that
    // fires on every run would be a false claim of its own.
    const bytes = await heavyPdf();
    expect(bytes.byteLength).toBeGreaterThan(3_000_000);
    const text = await resultText(loaded(bytes, 1));
    const [input, output] = statedSizes(text, bytes.byteLength);
    expect(output, "the fixture did not shrink").toBeLessThan(input);
    expect(text).not.toContain(GRAYSCALE_GREW_NOTE);
  }, 30_000);
});
