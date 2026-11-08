// @vitest-environment jsdom
// @native-canvas
/**
 * The settings batches (batch plan P1), through the page's own runner: the
 * tool page's `<ToolRunner>`, three real Files dropped on its file input,
 * the batch's Run, and the ZIP "Download all" hands the browser — opened
 * and read back.
 *
 * Composed, not unit: a batch module that works on its own proves nothing
 * if the runner never forks to it (CLAUDE.md, "verify the composed chain").
 * The SET of tools is derived from what the page would do with two PDFs —
 * every in-browser tool whose hand-off mode is "batch" and that opens PDFs
 * — never typed; Compress is in it as the positive control, since its batch
 * shipped first.
 *
 * Each settings batch gets three files:
 *   - `report.pdf`: a plain two-page file (Flatten's has a filled field);
 *   - `report.pdf` again, digitally signed: same name, so the archive must
 *     hold two entries, and a signed file, held back until opted in;
 *   - `locked.pdf`: restricted by its author, which a batch must refuse in
 *     the single-file path's words, without opening it.
 * The archive's two files are each checked for the tool's own effect.
 *
 * No module is mocked (`src/tests/mock-isolation.test.ts`); `fetch` is
 * replaced by one that fails the test, because nothing here may leave the
 * browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import JSZip from "jszip";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
} from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import {
  __setHandoffStoreForTests,
  HandoffStore,
  MemoryHandoffBackend,
  stashHandoff,
} from "@/lib/handoff";
import { handoffCapabilityFor } from "@/lib/handoff/capability";
import { LOCKED_PDF_COPY } from "@/lib/pdf/encryption";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import {
  BATCH_LIMITS,
  overBytesReason,
  overCountReason,
} from "@/lib/batch/limits";
import {
  IMAGE_BATCH_TOOLS,
  SETTINGS_BATCH_TOOLS,
  batchMaxFilesFor,
} from "@/lib/batch/tools";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import { getToolBySlug } from "@/lib/tools";
import { ownerOnlyEncryptedPdf } from "@/tests/encrypted-pdf-fixture";
import { readAsViewer } from "@/tests/pdf-viewer-read";
import { runnerMounted } from "@/tests/runner-mounted";
import { makeSignedPdf } from "@/tests/signed-pdf";
import { ToolRunner } from "../tool-runner";
import { BATCH_VIEW_LOADED } from "./batch-view";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};
function Router({ children }: { children: ReactNode }) {
  return (
    <AppRouterContext.Provider value={router as never}>
      {children}
    </AppRouterContext.Provider>
  );
}

/**
 * Grayscale PDF's batch (batch plan P2) draws pages with pdf.js, which
 * needs a canvas with a 2D context: jsdom's has none, so `canvas` is
 * pdf.js's own Node canvas, as in `../grayscale-runner.test.tsx` — on
 * globals, restored after each test, never a `vi.mock`.
 */
const requireHere = createRequire(import.meta.url);
const napi = createRequire(requireHere.resolve("pdfjs-dist/package.json"))(
  "@napi-rs/canvas",
) as { createCanvas(width: number, height: number): HTMLCanvasElement };

let downloads: { name: string; blob: Blob }[] = [];
let pending: Blob | null = null;
let fetches: string[] = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const originalFetch = globalThis.fetch;
beforeEach(async () => {
  const worker: unknown = await import(
    // @ts-expect-error -- pdfjs-dist ships no type declarations for its worker.
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  vi.stubGlobal("pdfjsWorker", worker);
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) =>
    tag.toLowerCase() === "canvas"
      ? napi.createCanvas(1, 1)
      : createElement(tag, options)) as typeof document.createElement);
  downloads = [];
  fetches = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) pending = obj;
    return "blob:settings-batches-test";
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (pending) downloads.push({ name: this.download, blob: pending });
    pending = null;
  });
  globalThis.fetch = ((input: RequestInfo | URL) => {
    fetches.push(String(input));
    return Promise.reject(new Error("a browser batch made a request"));
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  resetAnnouncer();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** What the page does with two PDFs: every batch-mode tool that opens PDFs. */
const BATCH_PDF_SLUGS = [...supportedToolSlugs]
  .filter((slug) => handoffCapabilityFor(slug).mode === "batch")
  .filter((slug) => getToolBySlug(slug)?.accept.includes("PDF"))
  .sort();

const pdfFile = (bytes: Uint8Array, name: string) =>
  new File([bytes.slice()], name, { type: "application/pdf" });

/** A two-page file with a line of text on each page. */
async function plainPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i += 1) {
    doc
      .addPage([300, 400])
      .drawText(`Body ${i + 1}`, { x: 30, y: 300, font, size: 12 });
  }
  return doc.save();
}

/** A two-page file with one filled text field, for Flatten. */
async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await plainPdf());
  const field = doc.getForm().createTextField("name");
  field.setText("Ada");
  field.addToPage(doc.getPage(0), { x: 30, y: 200, width: 120, height: 20 });
  return doc.save();
}

async function mount(slug: string) {
  const kind = getRunnerKind(slug);
  expect(kind, slug).toBeDefined();
  const { container } = render(
    <Router>
      <ToolRunner kind={kind!} slug={slug} />
    </Router>,
  );
  await runnerMounted(container);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, `${slug}: the drop box's file input`).not.toBeNull();
  return { container, input: input! };
}

async function batchViewOf(container: HTMLElement): Promise<HTMLElement> {
  return waitFor(
    () => {
      const view = container.querySelector<HTMLElement>(
        `[data-chunk="${BATCH_VIEW_LOADED}"]`,
      );
      if (!view) throw new Error("the batch view has not rendered");
      return view;
    },
    // 40 s: the batch module is a `next/dynamic` chunk imported cold in
    // this forked process, after the runner's own; under a full run one
    // hand-off case took past 20 s and passed alone.
    { timeout: 40_000 },
  );
}

interface Expectation {
  /** The Run button. */
  run: RegExp;
  /** Said after LOCKED_PDF_COPY.restricted, for a tool that has more. */
  restrictedNote?: RegExp;
  /** The tool's effect, read back from one archived output. */
  check: (bytes: Uint8Array, entry: string) => Promise<void>;
  /** The first file, when the tool needs more than a plain one. */
  first?: () => Promise<Uint8Array>;
}

const EXPECT: Record<keyof typeof SETTINGS_BATCH_TOOLS, Expectation> = {
  "rotate-pdf": {
    run: /^rotate 2 pdfs$/i,
    restrictedNote: /Rotate it on its own/,
    check: async (bytes, entry) => {
      const doc = await PDFDocument.load(bytes);
      for (const page of doc.getPages())
        expect(page.getRotation().angle, entry).toBe(90);
    },
  },
  "flatten-pdf": {
    run: /^flatten 2 pdfs$/i,
    first: formPdf,
    check: async (bytes, entry) => {
      const doc = await PDFDocument.load(bytes);
      const fields = doc
        .getForm()
        .getFields()
        .filter((f) => f.constructor.name !== "PDFSignature");
      expect(fields, entry).toHaveLength(0);
    },
  },
  "page-numbers": {
    run: /^number 2 pdfs$/i,
    check: async (bytes, entry) => {
      const doc = await PDFDocument.load(bytes);
      const total = doc.getPageCount();
      // Restarts in each file: page 1 of THIS file, never a count carried
      // on from the file before it.
      const first = (await readAsViewer(bytes, 1)).texts.map((t) => t.str);
      expect(first.join(" "), entry).toContain(`Page 1 of ${total}`);
    },
  },
  "watermark-pdf": {
    run: /^watermark 2 pdfs$/i,
    check: async (bytes, entry) => {
      const texts = (await readAsViewer(bytes, 1)).texts.map((t) => t.str);
      expect(texts.join(""), entry).toContain("CONFIDENTIAL");
    },
  },
  "grayscale-pdf": {
    run: /^convert 2 pdfs$/i,
    restrictedNote: /Open it on its own to enter its password/,
    check: async (bytes, entry) => {
      // Every page is one single-channel image: DeviceGray, not colour.
      const doc = await PDFDocument.load(bytes);
      for (const page of doc.getPages()) {
        const xobjects = page.node
          .Resources()
          ?.lookup(PDFName.of("XObject"), PDFDict);
        const images = (xobjects?.keys() ?? []).map((key) =>
          doc.context.lookup(xobjects!.get(key)),
        );
        expect(images.length, entry).toBeGreaterThan(0);
        for (const image of images) {
          expect(image, entry).toBeInstanceOf(PDFRawStream);
          expect(
            String((image as PDFRawStream).dict.get(PDFName.of("ColorSpace"))),
            entry,
          ).toBe("/DeviceGray");
        }
      }
    },
  },
  "split-pdf-pages-in-half": {
    run: /^split 2 pdfs$/i,
    check: async (bytes, entry) => {
      const doc = await PDFDocument.load(bytes);
      const box = doc.getPage(0).getCropBox();
      const media = doc.getPage(0).getMediaBox();
      // Left page first: the first page is the left half.
      expect(box.x, entry).toBe(media.x);
      expect(box.width, entry).toBeCloseTo(media.width / 2, 3);
    },
  },
};

describe("the request trap", () => {
  it("records a request (positive control): an empty list below means none was made", async () => {
    await expect(fetch("/api/jobs")).rejects.toThrow();
    expect(fetches).toEqual(["/api/jobs"]);
  });
});

describe("the batch set, derived from the page", () => {
  it("is every settings and images batch, plus Compress as the positive control", () => {
    // Health: a derivation that found nothing would pass every case below.
    expect(BATCH_PDF_SLUGS).toContain("compress-pdf");
    expect(BATCH_PDF_SLUGS.filter((s) => s !== "compress-pdf")).toEqual(
      [
        ...Object.keys(SETTINGS_BATCH_TOOLS),
        ...Object.keys(IMAGE_BATCH_TOOLS),
      ].sort(),
    );
  });

  it.each(BATCH_PDF_SLUGS)(
    "%s: two PDFs open the batch view",
    { timeout: 60_000 },
    async (slug) => {
      const { container, input } = await mount(slug);
      const bytes = await plainPdf();
      fireEvent.change(input, {
        target: {
          files: [pdfFile(bytes, "one.pdf"), pdfFile(bytes, "two.pdf")],
        },
      });
      const view = await batchViewOf(container);
      expect(within(view).getByText("one.pdf")).toBeInTheDocument();
      expect(within(view).getByText("two.pdf")).toBeInTheDocument();
    },
  );
});

/**
 * A PDF file that reports `size` bytes. The cap reads `File.size` before any
 * byte is opened, so the batch's total can be passed without holding 200 MB
 * in the test.
 */
function sizedPdf(bytes: Uint8Array, name: string, size: number): File {
  const f = pdfFile(bytes, name);
  Object.defineProperty(f, "size", { value: size });
  return f;
}

const rowsOf = (view: HTMLElement) =>
  within(view).getByRole("list", { name: "Files in this batch" }).children;

describe("the batch's file cap, through each page's runner", () => {
  // Review 2026-11-08: the cap override `{ maxFiles: 9999, maxTotalBytes:
  // 1e15 }` in settings-batch-runner.tsx left every test green; the claim
  // "A batch takes up to 20 PDFs, 200 MB in all." rests on the cap RUNNING,
  // which loading limits.ts does not show.
  // Batch plan P2: a raster batch's cap is `rasterMaxFiles`, the rest the
  // client cap (`batchMaxFilesFor`). Until then this read clientMaxFiles
  // for every page; the health check below keeps both caps exercised.
  it("health: both caps are exercised by the pages below", () => {
    const caps = new Set(BATCH_PDF_SLUGS.map(batchMaxFilesFor));
    expect(caps).toEqual(
      new Set([BATCH_LIMITS.clientMaxFiles, BATCH_LIMITS.rasterMaxFiles]),
    );
  });

  it.each(BATCH_PDF_SLUGS)(
    "%s: the first batchMaxFilesFor(slug) open, and every file past it is listed with the reason",
    { timeout: 60_000 },
    async (slug) => {
      const max = batchMaxFilesFor(slug);
      const { container, input } = await mount(slug);
      const bytes = await plainPdf();
      fireEvent.change(input, {
        target: {
          files: Array.from({ length: max + 1 }, (_, i) =>
            pdfFile(bytes, `scan-${i + 1}.pdf`),
          ),
        },
      });
      const view = await batchViewOf(container);
      expect(rowsOf(view)).toHaveLength(max);
      const alert = within(view).getByRole("alert");
      expect(alert).toHaveTextContent(`scan-${max + 1}.pdf`);
      expect(alert).toHaveTextContent(overCountReason(max));
      // Control: the last file taken is a row, not in the refusal.
      expect(within(view).getByText(`scan-${max}.pdf`)).toBeInTheDocument();
    },
  );

  it.each(BATCH_PDF_SLUGS)(
    "%s: a file that takes the total past clientMaxTotalBytes is listed with the reason",
    { timeout: 60_000 },
    async (slug) => {
      const total = BATCH_LIMITS.clientMaxTotalBytes;
      // Three files of 45% of the total each: two fit, the third would not.
      const each = Math.floor(total * 0.45);
      // Health: each file alone is one the single-file path takes.
      expect(each).toBeLessThanOrEqual(MAX_PDF_BYTES);
      const { container, input } = await mount(slug);
      const bytes = await plainPdf();
      fireEvent.change(input, {
        target: {
          files: [
            sizedPdf(bytes, "big-1.pdf", each),
            sizedPdf(bytes, "big-2.pdf", each),
            sizedPdf(bytes, "big-3.pdf", each),
          ],
        },
      });
      const view = await batchViewOf(container);
      expect(rowsOf(view)).toHaveLength(2);
      const alert = within(view).getByRole("alert");
      expect(alert).toHaveTextContent("big-3.pdf");
      expect(alert).toHaveTextContent(overBytesReason(total));
    },
  );
});

describe("a hand-off of two PDFs", () => {
  afterEach(() => {
    __setHandoffStoreForTests(null);
    window.history.replaceState(null, "", "/");
  });

  it.each(Object.keys(SETTINGS_BATCH_TOOLS))(
    "%s: opens the batch with both files, never only the first",
    { timeout: 60_000 },
    async (slug) => {
      window.sessionStorage.clear();
      __setHandoffStoreForTests(
        new HandoffStore({ backend: new MemoryHandoffBackend() }),
      );
      const bytes = await plainPdf();
      const id = await stashHandoff(
        slug,
        [pdfFile(bytes, "first.pdf"), pdfFile(bytes, "second.pdf")],
        { origin: { kind: "workspace" } },
      );
      window.history.replaceState(null, "", `/tools/${slug}?handoff=${id}`);
      const { container } = render(
        <Router>
          <ToolRunner kind={getRunnerKind(slug)!} slug={slug} />
        </Router>,
      );
      await runnerMounted(container);
      const view = await batchViewOf(container);
      expect(within(view).getByText("first.pdf")).toBeInTheDocument();
      expect(within(view).getByText("second.pdf")).toBeInTheDocument();
    },
  );
});

describe.each(Object.keys(SETTINGS_BATCH_TOOLS) as (keyof typeof EXPECT)[])(
  "%s's batch, through the page",
  (slug) => {
    it(
      "refuses the locked file, holds the signed one back, and zips two outputs under two names",
      { timeout: 90_000 },
      async () => {
        const want = EXPECT[slug];
        const { container, input } = await mount(slug);
        const first = await (want.first ?? plainPdf)();
        fireEvent.change(input, {
          target: {
            files: [
              pdfFile(first, "report.pdf"),
              pdfFile(await makeSignedPdf(), "report.pdf"),
              pdfFile(ownerOnlyEncryptedPdf(), "locked.pdf"),
            ],
          },
        });
        const view = await batchViewOf(container);
        // Three listed: 3 PDFs, so the button says 3.
        const run = await within(view).findByRole("button", {
          name: new RegExp(want.run.source.replace("2", "3"), "i"),
        });
        fireEvent.click(run);

        await within(view).findByRole(
          "heading",
          { name: /^Batch complete\. 2 done, 1 failed\.$/ },
          { timeout: 60_000 },
        );

        // The locked file: refused in the single-file path's words.
        const lockedRow = within(view)
          .getByText("locked.pdf")
          .closest("li") as HTMLElement;
        expect(lockedRow).toHaveTextContent(LOCKED_PDF_COPY.restricted);
        if (want.restrictedNote)
          expect(lockedRow.textContent).toMatch(want.restrictedNote);

        // The signed file: flagged, and out of the archive until opted in.
        expect(
          within(view).getByText(/1 digital signature will show as invalid/),
        ).toBeInTheDocument();
        expect(
          within(view).getByRole("button", { name: "Download all (1)" }),
        ).toBeInTheDocument();
        fireEvent.click(
          within(view).getByRole("checkbox", {
            name: /Include 1 signed file in the download/,
          }),
        );
        fireEvent.click(
          within(view).getByRole("button", { name: "Download all (2)" }),
        );

        await waitFor(() => expect(downloads).toHaveLength(1), {
          timeout: 10_000,
        });
        expect(downloads[0]!.name).toBe(SETTINGS_BATCH_TOOLS[slug].zipName);
        const zip = await JSZip.loadAsync(
          await downloads[0]!.blob.arrayBuffer(),
        );
        const entries = Object.keys(zip.files).sort();
        expect(entries).toHaveLength(2);
        expect(new Set(entries.map((e) => e.toLowerCase())).size).toBe(2);
        for (const entry of entries) {
          const bytes = await zip.file(entry)!.async("uint8array");
          await want.check(bytes, entry);
        }
        expect(fetches, "requests made by an in-browser batch").toEqual([]);
      },
    );
  },
);
