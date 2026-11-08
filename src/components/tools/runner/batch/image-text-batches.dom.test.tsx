// @vitest-environment jsdom
// @native-canvas
/**
 * Batch plan P2 through each page's own runner: PDF to JPG, PDF to PNG and
 * Extract Images (MANY images of each file, one folder per file in the ZIP)
 * and Text to PDF (its own drop box, one PDF per text file). Grayscale PDF,
 * whose batch makes one PDF per file, rides the settings batches' proof in
 * `./settings-batches.dom.test.tsx`.
 *
 * Composed, not unit: the page's `<ToolRunner>`, real Files on its file
 * input, the batch's Run, and the ZIP "Download all" hands the browser,
 * opened and read back (CLAUDE.md, "verify the composed chain").
 *
 * Each images batch gets three PDFs:
 *   - `report.pdf`, two pages (each with a picture, for Extract Images);
 *   - `report.pdf` again, three pages: the same name, so the archive must
 *     hold two folders, "report" and "report (2)";
 *   - `locked.pdf`, restricted by its author: pdf.js would draw it without
 *     asking, so the batch must refuse it on its row before any page is
 *     drawn.
 *
 * pdf.js draws on pdf.js's own Node canvas (jsdom's has no 2D context), on
 * globals restored after each test; no module is mocked. `fetch` fails the
 * test, because nothing here may leave the browser.
 */
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import {
  __setHandoffStoreForTests,
  HandoffStore,
  MemoryHandoffBackend,
  stashHandoff,
} from "@/lib/handoff";
import { BATCH_LIMITS, overCountReason } from "@/lib/batch/limits";
import {
  IMAGE_BATCH_TOOLS,
  TEXT_BATCH_TOOLS,
  batchMaxFilesFor,
} from "@/lib/batch/tools";
import { getRunnerKind } from "@/lib/pdf/registry";
import { ownerOnlyEncryptedPdf } from "@/tests/encrypted-pdf-fixture";
import { JPEG_30X20 } from "@/tests/jpeg-fixtures";
import { readAsViewer } from "@/tests/pdf-viewer-read";
import { runnerMounted } from "@/tests/runner-mounted";
import { ToolRunner } from "../tool-runner";
import { BATCH_VIEW_LOADED } from "./batch-view";
import { BATCH_OUT_OF_MEMORY } from "./halt";
import { ImagesBatchRunner } from "./images-batch-runner";
import { GRAYSCALE_BATCH_DEFAULT, grayscaleOneFile } from "./grayscale-batch";
import {
  PDF_TO_IMAGE_BATCH_DEFAULTS,
  renderOneFile,
} from "./pdf-to-image-batch";
import { SettingsBatchRunner } from "./settings-batch-runner";
import { grayscaleOutputName } from "@/lib/pdf/grayscale";

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
    return "blob:image-text-batches";
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

const pdfFile = (bytes: Uint8Array, name: string) =>
  new File([bytes.slice()], name, { type: "application/pdf" });
const textFile = (text: string, name: string) =>
  new File([text], name, { type: "text/plain" });

/** `pages` pages, a line of text and a small JPEG picture on each. */
async function picturePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const jpeg = await doc.embedJpg(JPEG_30X20);
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([200, 260]);
    page.drawText(`Body ${i + 1}`, { x: 20, y: 220, font, size: 12 });
    page.drawImage(jpeg, { x: 20, y: 60, width: 60, height: 40 });
  }
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
    { timeout: 40_000 },
  );
}

async function zipEntries(blob: Blob): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const out = new Map<string, Uint8Array>();
  for (const [name, entry] of Object.entries(zip.files))
    if (!entry.dir) out.set(name, await entry.async("uint8array"));
  return out;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const startsWith = (bytes: Uint8Array, magic: number[]) =>
  magic.every((b, i) => bytes[i] === b);

interface ImagesExpectation {
  run: RegExp;
  /** An archived image's own bytes: the format the tool says. */
  magic: number[];
  /** The entries each input's folder holds, from its page count. */
  entries: (folder: string, pages: number) => string[];
}

const EXPECT: Record<keyof typeof IMAGE_BATCH_TOOLS, ImagesExpectation> = {
  "pdf-to-jpg": {
    run: /^Convert 3 PDFs$/,
    magic: JPEG_MAGIC,
    entries: (folder, pages) =>
      Array.from(
        { length: pages },
        (_, i) => `${folder}/report-page-${i + 1}.jpg`,
      ),
  },
  "pdf-to-png": {
    run: /^Convert 3 PDFs$/,
    magic: PNG_MAGIC,
    entries: (folder, pages) =>
      Array.from(
        { length: pages },
        (_, i) => `${folder}/report-page-${i + 1}.png`,
      ),
  },
  // One picture, reused on every page: extracted once, on page 1.
  "extract-images": {
    run: /^Extract from 3 PDFs$/,
    magic: JPEG_MAGIC,
    entries: (folder) => [`${folder}/page-001-image-001.jpg`],
  },
};

describe("the request trap", () => {
  it("records a request (positive control): an empty list below means none was made", async () => {
    await expect(fetch("/api/jobs")).rejects.toThrow();
    expect(fetches).toEqual(["/api/jobs"]);
  });
});

describe.each(Object.keys(IMAGE_BATCH_TOOLS) as (keyof typeof EXPECT)[])(
  "%s's batch, through the page",
  (slug) => {
    it(
      "refuses the locked file before drawing it, and zips each file's images in a folder of its own",
      { timeout: 120_000 },
      async () => {
        const want = EXPECT[slug];
        const { container, input } = await mount(slug);
        fireEvent.change(input, {
          target: {
            files: [
              pdfFile(await picturePdf(2), "report.pdf"),
              pdfFile(await picturePdf(3), "report.pdf"),
              pdfFile(ownerOnlyEncryptedPdf(), "locked.pdf"),
            ],
          },
        });
        const view = await batchViewOf(container);
        // Where the images go is said before Run.
        expect(view.textContent).toContain(
          "each one's images sit in a folder of the ZIP named after it",
        );
        fireEvent.click(
          await within(view).findByRole("button", { name: want.run }),
        );
        await within(view).findByRole(
          "heading",
          { name: /^Batch complete\. 2 done, 1 failed\.$/ },
          { timeout: 90_000 },
        );
        const lockedRow = within(view)
          .getByText("locked.pdf")
          .closest("li") as HTMLElement;
        expect(lockedRow).toHaveTextContent(
          "a batch leaves a restricted file alone",
        );

        fireEvent.click(
          within(view).getByRole("button", { name: "Download all (2)" }),
        );
        await waitFor(() => expect(downloads).toHaveLength(1), {
          timeout: 10_000,
        });
        expect(downloads[0]!.name).toBe(IMAGE_BATCH_TOOLS[slug].zipName);
        const entries = await zipEntries(downloads[0]!.blob);
        expect([...entries.keys()].sort()).toEqual(
          [
            ...want.entries("report", 2),
            ...want.entries("report (2)", 3),
          ].sort(),
        );
        for (const [name, bytes] of entries)
          expect(startsWith(bytes, want.magic), name).toBe(true);
        expect(fetches, "requests made by an in-browser batch").toEqual([]);
      },
    );
  },
);

describe("Extract Images' batch: a file with no images", () => {
  it(
    "is a finished row with the reason, with nothing to download, and the batch goes on",
    { timeout: 90_000 },
    async () => {
      const blank = await PDFDocument.create();
      blank.addPage([200, 200]);
      const { container, input } = await mount("extract-images");
      fireEvent.change(input, {
        target: {
          files: [
            pdfFile(await blank.save(), "blank.pdf"),
            pdfFile(await picturePdf(1), "photo.pdf"),
          ],
        },
      });
      const view = await batchViewOf(container);
      fireEvent.click(
        await within(view).findByRole("button", {
          name: /^Extract from 2 PDFs$/,
        }),
      );
      await within(view).findByRole(
        "heading",
        { name: /^Batch complete\. 2 done, 0 failed\.$/ },
        { timeout: 60_000 },
      );
      const blankRow = within(view)
        .getByText("blank.pdf")
        .closest("li") as HTMLElement;
      expect(blankRow).toHaveTextContent("No extractable images found");
      expect(within(blankRow).queryByRole("button")).toBeNull();
      // Only the file that made an image is counted.
      expect(
        within(view).getByRole("button", { name: "Download all (1)" }),
      ).toBeInTheDocument();
    },
  );
});

describe("Text to PDF's batch, through its own drop box", () => {
  it(
    "makes one PDF per text file, lists a file it cannot take, fails an empty one on its row, and zips two of one name",
    { timeout: 90_000 },
    async () => {
      const { container, input } = await mount("text-to-pdf");
      // The drop box takes several files now.
      expect(input.multiple).toBe(true);
      fireEvent.change(input, {
        target: {
          files: [
            textFile("First note, plain.", "notes.txt"),
            textFile("Second note, plain.", "notes.txt"),
            textFile("   ", "empty.txt"),
            new File([JPEG_30X20.slice()], "photo.jpg", {
              type: "image/jpeg",
            }),
          ],
        },
      });
      const view = await batchViewOf(container);
      const alert = within(view).getByRole("alert");
      expect(alert).toHaveTextContent("photo.jpg");
      expect(alert).toHaveTextContent("It isn't a plain text file");
      fireEvent.click(
        await within(view).findByRole("button", {
          name: "Convert 3 text files",
        }),
      );
      await within(view).findByRole(
        "heading",
        { name: /^Batch complete\. 2 done, 1 failed\.$/ },
        { timeout: 60_000 },
      );
      expect(
        within(view).getByText("empty.txt").closest("li") as HTMLElement,
      ).toHaveTextContent("Add some text or choose a non-empty .txt file.");
      fireEvent.click(
        within(view).getByRole("button", { name: "Download all (2)" }),
      );
      await waitFor(() => expect(downloads).toHaveLength(1), {
        timeout: 10_000,
      });
      expect(downloads[0]!.name).toBe(TEXT_BATCH_TOOLS["text-to-pdf"].zipName);
      const entries = await zipEntries(downloads[0]!.blob);
      expect([...entries.keys()].sort()).toEqual([
        "notes-pdf (2).pdf",
        "notes-pdf.pdf",
      ]);
      const first = (await readAsViewer(entries.get("notes-pdf.pdf")!, 1)).texts
        .map((t) => t.str)
        .join(" ");
      const second = (
        await readAsViewer(entries.get("notes-pdf (2).pdf")!, 1)
      ).texts
        .map((t) => t.str)
        .join(" ");
      expect(first).toContain("First note, plain.");
      expect(second).toContain("Second note, plain.");
      expect(fetches).toEqual([]);
    },
  );

  it(
    "takes up to batchMaxFilesFor(text-to-pdf) files and lists the rest with the reason",
    { timeout: 60_000 },
    async () => {
      const max = batchMaxFilesFor("text-to-pdf");
      // Health: Text to PDF is not a raster batch.
      expect(max).toBe(BATCH_LIMITS.clientMaxFiles);
      const { container, input } = await mount("text-to-pdf");
      fireEvent.change(input, {
        target: {
          files: Array.from({ length: max + 1 }, (_, i) =>
            textFile(`note ${i + 1}`, `note-${i + 1}.txt`),
          ),
        },
      });
      const view = await batchViewOf(container);
      expect(
        within(view).getByRole("list", { name: "Files in this batch" })
          .children,
      ).toHaveLength(max);
      const alert = within(view).getByRole("alert");
      expect(alert).toHaveTextContent(`note-${max + 1}.txt`);
      expect(alert).toHaveTextContent(overCountReason(max));
    },
  );

  it(
    "a Remove that leaves one file opens it in the editor",
    { timeout: 60_000 },
    async () => {
      const { container, input } = await mount("text-to-pdf");
      fireEvent.change(input, {
        target: {
          files: [
            textFile("Kept text.", "keep.txt"),
            textFile("Gone text.", "gone.txt"),
          ],
        },
      });
      const view = await batchViewOf(container);
      fireEvent.click(
        within(view).getByRole("button", { name: "Remove gone.txt" }),
      );
      await waitFor(() =>
        expect(
          (container.querySelector("textarea") as HTMLTextAreaElement | null)
            ?.value,
        ).toBe("Kept text."),
      );
    },
  );
});

describe("a hand-off of two files to a P2 tool", () => {
  afterEach(() => {
    __setHandoffStoreForTests(null);
    window.history.replaceState(null, "", "/");
  });

  it.each([
    ...Object.keys(IMAGE_BATCH_TOOLS).map((slug) => [slug, "pdf"] as const),
    ["text-to-pdf", "txt"] as const,
  ])(
    "%s: opens the batch with both files, never only the first",
    { timeout: 60_000 },
    async (slug, kind) => {
      window.sessionStorage.clear();
      __setHandoffStoreForTests(
        new HandoffStore({ backend: new MemoryHandoffBackend() }),
      );
      const files =
        kind === "pdf"
          ? [
              pdfFile(await picturePdf(1), "first.pdf"),
              pdfFile(await picturePdf(1), "second.pdf"),
            ]
          : [textFile("a", "first.txt"), textFile("b", "second.txt")];
      const id = await stashHandoff(slug, files, {
        origin: { kind: "workspace" },
      });
      window.history.replaceState(null, "", `/tools/${slug}?handoff=${id}`);
      const { container } = render(
        <Router>
          <ToolRunner kind={getRunnerKind(slug)!} slug={slug} />
        </Router>,
      );
      await runnerMounted(container);
      const view = await batchViewOf(container);
      expect(
        within(view).getByText(files[0]!.name, { selector: "span" }),
      ).toBeInTheDocument();
      expect(
        within(view).getByText(files[1]!.name, { selector: "span" }),
      ).toBeInTheDocument();
    },
  );
});

describe("an images batch that runs out of memory", () => {
  const props = (files: File[]) => ({
    files,
    onReset: () => {},
    toolName: "Test Images",
    verb: "Test",
    runningLabel: "Testing…",
    zipName: "pdfxyz-test.zip",
    maxFiles: BATCH_LIMITS.rasterMaxFiles,
    restrictedRefusal: "restricted",
  });

  it(
    "stops there, keeps the finished file's images, and never runs the rest",
    { timeout: 30_000 },
    async () => {
      const ran: string[] = [];
      const bytes = await picturePdf(1);
      render(
        <Router>
          <ImagesBatchRunner
            {...props([
              pdfFile(bytes, "a.pdf"),
              pdfFile(bytes, "b.pdf"),
              pdfFile(bytes, "c.pdf"),
            ])}
            process={async ({ file }) => {
              ran.push(file.name);
              if (file.name === "b.pdf")
                throw new RangeError("Array buffer allocation failed");
              return {
                images: [1, 2].map((n) => ({
                  name: `p${n}.png`,
                  bytes: new Uint8Array([n]),
                  type: "image/png",
                })),
                zipName: `${file.name}-images.zip`,
                detail: "2 pages",
              };
            }}
          />
        </Router>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Test 3 PDFs" }));
      await screen.findByRole(
        "heading",
        { name: "Batch stopped." },
        { timeout: 10_000 },
      );
      expect(screen.getByRole("alert")).toHaveTextContent(BATCH_OUT_OF_MEMORY);
      expect(ran).toEqual(["a.pdf", "b.pdf"]);
      expect(screen.getByText("c.pdf").closest("li")).toHaveTextContent(
        "Canceled",
      );
      // The finished file's images are still there, from its row.
      expect(
        screen.getByRole("button", {
          name: "Download the 2 images of a.pdf as a ZIP",
        }),
      ).toBeInTheDocument();
    },
  );

  it(
    "control: any other failure fails its row and the batch goes on",
    { timeout: 30_000 },
    async () => {
      const ran: string[] = [];
      const bytes = await picturePdf(1);
      render(
        <Router>
          <ImagesBatchRunner
            {...props([
              pdfFile(bytes, "a.pdf"),
              pdfFile(bytes, "b.pdf"),
              pdfFile(bytes, "c.pdf"),
            ])}
            process={async ({ file }) => {
              ran.push(file.name);
              if (file.name === "b.pdf") throw new Error("b broke");
              return {
                images: [
                  { name: "p.png", bytes: new Uint8Array([1]), type: "x" },
                ],
                zipName: "z.zip",
                detail: "1 page",
              };
            }}
          />
        </Router>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Test 3 PDFs" }));
      await screen.findByRole(
        "heading",
        { name: /^Batch complete\. 2 done, 1 failed\.$/ },
        { timeout: 10_000 },
      );
      expect(ran).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    },
  );
});

/**
 * Out of memory through the REAL engines, not a stubbed `process`: the
 * runner's wiring above is necessary and not sufficient, because each
 * engine draws its pages through `capturePdfPages`, whose per-page catch
 * used to turn every error into a plain "Page N could not be rendered."
 * (Grayscale) or swallow it as a skipped page (PDF to JPG/PNG). Either way
 * the RangeError never reached `batchHalt` and the batch went on filling
 * memory (adversarial review of P2, CLAUDE.md rule 5).
 *
 * The browser's allocation failure is played by the canvas: a 2D context
 * wider than `limit` device pixels throws the RangeError a browser throws.
 * `b.pdf` has one large page, `a.pdf` and `c.pdf` small ones.
 */
describe("out of memory through the real engines", () => {
  const LIMIT_PX = 1500;
  /** Small pages: 200 pt is 833 px even at 300 DPI, below the limit. */
  async function smallPdf(): Promise<Uint8Array> {
    return picturePdf(2);
  }
  /** One 800 pt page: 1,667 px at 150 DPI and above, over the limit. */
  async function largePdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc
      .addPage([800, 800])
      .drawText("Large", { x: 20, y: 700, font, size: 24 });
    return doc.save();
  }
  /** Canvases whose 2D context fails over `limit` px wide, as a browser's would. */
  function canvasesFailAbove(limit: number) {
    vi.mocked(document.createElement).mockImplementation(((
      tag: string,
      options?: ElementCreationOptions,
    ) => {
      if (tag.toLowerCase() !== "canvas")
        return Document.prototype.createElement.call(document, tag, options);
      const canvas = napi.createCanvas(1, 1);
      const getContext = canvas.getContext.bind(canvas) as (
        ...args: unknown[]
      ) => unknown;
      (canvas as { getContext: unknown }).getContext = (...args: unknown[]) => {
        if (canvas.width > limit)
          throw new RangeError("Array buffer allocation failed");
        return getContext(...args);
      };
      return canvas;
    }) as typeof document.createElement);
  }
  async function threeFiles() {
    const small = await smallPdf();
    return [
      pdfFile(small, "a.pdf"),
      pdfFile(await largePdf(), "b.pdf"),
      pdfFile(small, "c.pdf"),
    ];
  }

  const imagesProps = (files: File[]) => ({
    files,
    onReset: () => {},
    toolName: "Test Images",
    verb: "Test",
    runningLabel: "Testing…",
    zipName: "pdfxyz-test.zip",
    maxFiles: BATCH_LIMITS.rasterMaxFiles,
    restrictedRefusal: "restricted",
  });

  async function runImages(format: "jpg" | "png", limit: number) {
    canvasesFailAbove(limit);
    const ran: string[] = [];
    render(
      <Router>
        <ImagesBatchRunner
          {...imagesProps(await threeFiles())}
          process={(opened, signal) => {
            ran.push(opened.file.name);
            return renderOneFile(
              opened,
              { ...PDF_TO_IMAGE_BATCH_DEFAULTS, format },
              signal,
            );
          }}
        />
      </Router>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Test 3 PDFs" }));
    return ran;
  }

  async function runGrayscale(limit: number) {
    canvasesFailAbove(limit);
    const ran: string[] = [];
    render(
      <Router>
        <SettingsBatchRunner
          files={await threeFiles()}
          onReset={() => {}}
          onSingle={() => {}}
          arrival={null}
          toolName="Test Tool"
          verb="Test"
          runningLabel="Testing…"
          zipName="pdfxyz-test.zip"
          maxFiles={BATCH_LIMITS.rasterMaxFiles}
          process={(opened, signal) => {
            ran.push(opened.file.name);
            return grayscaleOneFile(opened, GRAYSCALE_BATCH_DEFAULT, signal);
          }}
        />
      </Router>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Test 3 PDFs" }));
    return ran;
  }

  async function expectHalted(ran: string[], kept: string) {
    await screen.findByRole(
      "heading",
      { name: "Batch stopped." },
      { timeout: 40_000 },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(BATCH_OUT_OF_MEMORY);
    expect(ran).toEqual(["a.pdf", "b.pdf"]);
    expect(screen.getByText("c.pdf").closest("li")).toHaveTextContent(
      "Canceled",
    );
    expect(screen.getByRole("button", { name: kept })).toBeInTheDocument();
  }

  it.each(["jpg", "png"] as const)(
    "PDF to %s (renderOneFile): a page out of memory stops the batch, never a skipped page",
    { timeout: 60_000 },
    async (format) => {
      const ran = await runImages(format, LIMIT_PX);
      await expectHalted(ran, "Download the 2 images of a.pdf as a ZIP");
    },
  );

  it(
    "Grayscale (grayscaleOneFile): a page out of memory stops the batch, never a failed row",
    { timeout: 60_000 },
    async () => {
      const ran = await runGrayscale(LIMIT_PX);
      await expectHalted(ran, `Download ${grayscaleOutputName("a.pdf")}`);
    },
  );

  it(
    "control: with room for the large page, both engines finish all three",
    { timeout: 90_000 },
    async () => {
      const images = await runImages("png", Number.POSITIVE_INFINITY);
      await screen.findByRole(
        "heading",
        { name: /^Batch complete\. 3 done/ },
        { timeout: 40_000 },
      );
      expect(images).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
      cleanup();
      const gray = await runGrayscale(Number.POSITIVE_INFINITY);
      await screen.findByRole(
        "heading",
        { name: /^Batch complete\. 3 done/ },
        { timeout: 40_000 },
      );
      expect(gray).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    },
  );
});

/**
 * Text to PDF's arrival notice belongs to files that were HANDED OVER. A
 * visitor who arrived with one handed-over file (it opens in the editor) and
 * then picks two of their own was told those two had been handed over
 * (review of P2): `arrival` was read from the hand-off, whatever the source
 * of the batch's files.
 */
describe("Text to PDF's batch: the hand-off notice is for handed-over files only", () => {
  const NOTICE = "Still in this browser; nothing was uploaded.";
  afterEach(() => {
    __setHandoffStoreForTests(null);
    window.history.replaceState(null, "", "/");
  });
  async function arriveWith(files: File[]) {
    window.sessionStorage.clear();
    __setHandoffStoreForTests(
      new HandoffStore({ backend: new MemoryHandoffBackend() }),
    );
    const id = await stashHandoff("text-to-pdf", files, {
      origin: { kind: "workspace" },
    });
    window.history.replaceState(null, "", `/tools/text-to-pdf?handoff=${id}`);
    const { container } = render(
      <Router>
        <ToolRunner kind={getRunnerKind("text-to-pdf")!} slug="text-to-pdf" />
      </Router>,
    );
    await runnerMounted(container);
    return container;
  }

  it(
    "positive control: two handed-over files carry the notice",
    { timeout: 60_000 },
    async () => {
      const container = await arriveWith([
        textFile("a", "first.txt"),
        textFile("b", "second.txt"),
      ]);
      const view = await batchViewOf(container);
      expect(view).toHaveTextContent(NOTICE);
    },
  );

  it(
    "one handed-over file, then two picked: the batch carries no hand-off notice",
    { timeout: 60_000 },
    async () => {
      const container = await arriveWith([textFile("Handed.", "handed.txt")]);
      await waitFor(() =>
        expect(
          (container.querySelector("textarea") as HTMLTextAreaElement | null)
            ?.value,
        ).toBe("Handed."),
      );
      const input =
        container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input, "the editor's drop box").not.toBeNull();
      fireEvent.change(input!, {
        target: {
          files: [textFile("a", "mine-1.txt"), textFile("b", "mine-2.txt")],
        },
      });
      const view = await batchViewOf(container);
      expect(
        within(view).getByText("mine-1.txt", { selector: "span" }),
      ).toBeInTheDocument();
      expect(view).not.toHaveTextContent(NOTICE);
    },
  );
});
