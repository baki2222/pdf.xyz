// @vitest-environment jsdom
// @native-canvas
/**
 * The options of the batches added for audit platform#1 (2026-11-22), each
 * read back from the saved files. The batches shipped with a composed test
 * per tool (`settings-batches.dom.test.tsx`) that ran every one on its
 * DEFAULTS, so a batch that dropped what a person typed stayed green: the
 * review of lane w1a landed eight such mutants and none went red —
 * metadata Remove all returning the bytes untouched, metadata blanking the
 * fields it promises to keep, header-footer ignoring the Header or the
 * Alignment, crop ignoring the margin, split-in-half ignoring Cut position
 * or "Only split pages wider than tall". Each test here sets the option to a
 * non-default value and reads the option's own effect out of every file in
 * the archive, three files a batch.
 *
 * No module is mocked (`src/tests/mock-isolation.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { readAsViewer } from "@/tests/pdf-viewer-read";
import { CropBatch, CROP_BATCH_START } from "./crop-batch";
import { HeaderFooterBatch } from "./header-footer-batch";
import { METADATA_BATCH_BLANK_KEEPS, MetadataBatch } from "./metadata-batch";
import { SplitHalfBatch } from "./split-half-batch";

/** As `settings-batch-behaviour.dom.test.tsx`: lazy chunks load cold here. */
const WAIT_MS = 3_000;
/** A whole batch of three small files, run and zipped. */
const RUN_MS = 30_000;

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

let downloads: Blob[] = [];
let pending: Blob | null = null;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
beforeEach(() => {
  downloads = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) pending = obj;
    return "blob:settings-batch-options";
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    if (pending) downloads.push(pending);
    pending = null;
  });
});
afterEach(() => {
  cleanup();
  resetAnnouncer();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

interface Made {
  sizes?: [number, number][];
  title?: string;
  author?: string;
  subject?: string;
}

/** A file of text pages (300 x 400 unless sized), with its own Info values. */
async function makePdf({
  sizes = [
    [300, 400],
    [300, 400],
  ],
  title,
  author,
  subject,
}: Made = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  sizes.forEach((size, i) =>
    doc
      .addPage(size)
      .drawText(`Body ${i + 1}`, { x: 30, y: 100, font, size: 12 }),
  );
  if (title) doc.setTitle(title);
  if (author) doc.setAuthor(author);
  if (subject) doc.setSubject(subject);
  return doc.save();
}

const pdfFile = (bytes: Uint8Array, name: string) =>
  new File([bytes.slice()], name, { type: "application/pdf" });

const batchProps = (files: File[]) => ({
  files,
  onReset: () => {},
  onSingle: () => {},
  arrival: null,
});

/** Run the batch, download its archive, and return every entry's bytes. */
async function runAndUnzip(runLabel: string, count: number) {
  fireEvent.click(screen.getByRole("button", { name: runLabel }));
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: `Download all (${count})` },
      { timeout: RUN_MS },
    ),
  );
  await waitFor(() => expect(downloads).toHaveLength(1), { timeout: WAIT_MS });
  const zip = await JSZip.loadAsync(await downloads[0]!.arrayBuffer());
  const out = new Map<string, Uint8Array>();
  for (const name of Object.keys(zip.files))
    out.set(name, await zip.file(name)!.async("uint8array"));
  // Health: every file came back, so a check below cannot pass on an
  // archive that lost one.
  expect(out.size).toBe(count);
  return out;
}

describe("Edit PDF Metadata's batch keeps what it says and removes what it says", () => {
  it(
    "Set values: the typed Title goes in; the Author and Subject left blank keep each file's own",
    { timeout: 60_000 },
    async () => {
      render(
        <Router>
          <MetadataBatch
            {...batchProps([
              pdfFile(
                await makePdf({ title: "Old A", author: "Ann", subject: "Sa" }),
                "a.pdf",
              ),
              pdfFile(
                await makePdf({ title: "Old B", author: "Bo", subject: "Sb" }),
                "b.pdf",
              ),
              pdfFile(await makePdf({ author: "Cy" }), "c.pdf"),
            ])}
          />
        </Router>,
      );
      // The claim under test, as the page shows it.
      expect(
        screen.getByText(new RegExp(METADATA_BATCH_BLANK_KEEPS)),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Title"), {
        target: { value: "Shared title" },
      });
      const zip = await runAndUnzip("Update 3 PDFs", 3);
      const read = async (bytes: Uint8Array) => {
        const doc = await PDFDocument.load(bytes, { updateMetadata: false });
        return {
          title: doc.getTitle(),
          author: doc.getAuthor(),
          subject: doc.getSubject(),
        };
      };
      const got = await Promise.all([...zip.values()].map(read));
      expect(got.map((g) => g.title)).toEqual([
        "Shared title",
        "Shared title",
        "Shared title",
      ]);
      expect(got.map((g) => g.author).sort()).toEqual(["Ann", "Bo", "Cy"]);
      expect(got.map((g) => g.subject ?? "").sort()).toEqual(["", "Sa", "Sb"]);
    },
  );

  it(
    "Remove all metadata: no file keeps its Title or Author",
    { timeout: 60_000 },
    async () => {
      const inputs = [
        await makePdf({ title: "T1", author: "A1" }),
        await makePdf({ title: "T2", author: "A2" }),
        await makePdf({ title: "T3", author: "A3" }),
      ];
      // Positive control: the inputs carry the values the run must remove.
      for (const bytes of inputs) {
        const doc = await PDFDocument.load(bytes, { updateMetadata: false });
        expect(doc.getTitle()).toMatch(/^T\d$/);
        expect(doc.getAuthor()).toMatch(/^A\d$/);
      }
      render(
        <Router>
          <MetadataBatch
            {...batchProps(
              inputs.map((bytes, i) => pdfFile(bytes, `${i}.pdf`)),
            )}
          />
        </Router>,
      );
      fireEvent.click(
        screen.getByRole("radio", { name: "Remove all metadata" }),
      );
      const zip = await runAndUnzip("Update 3 PDFs", 3);
      for (const [name, bytes] of zip) {
        const doc = await PDFDocument.load(bytes, { updateMetadata: false });
        expect(doc.getTitle(), name).toBeUndefined();
        expect(doc.getAuthor(), name).toBeUndefined();
        expect(doc.getPageCount(), name).toBe(2);
      }
    },
  );
});

describe("PDF Header & Footer's batch: the typed Header and the Alignment reach every file", () => {
  it(
    "a Header and the default footer, aligned Right, sit in the right half of every page, numbered per file",
    { timeout: 60_000 },
    async () => {
      render(
        <Router>
          <HeaderFooterBatch
            {...batchProps([
              pdfFile(await makePdf(), "a.pdf"),
              pdfFile(await makePdf(), "b.pdf"),
              pdfFile(
                await makePdf({
                  sizes: [
                    [300, 400],
                    [300, 400],
                    [300, 400],
                  ],
                }),
                "c.pdf",
              ),
            ])}
          />
        </Router>,
      );
      fireEvent.change(screen.getByLabelText("Header"), {
        target: { value: "HDR-{n}" },
      });
      fireEvent.click(screen.getByRole("radio", { name: "Right" }));
      const zip = await runAndUnzip("Stamp 3 PDFs", 3);
      for (const [name, bytes] of zip) {
        const pages = (await PDFDocument.load(bytes)).getPageCount();
        for (let p = 1; p <= pages; p += 1) {
          const view = await readAsViewer(bytes, p);
          const header = view.texts.find((t) => t.str.includes(`HDR-${p}`));
          const footer = view.texts.find((t) =>
            t.str.includes(`Page ${p} of ${pages}`),
          );
          expect(header, `${name} p${p} header`).toBeDefined();
          expect(footer, `${name} p${p} footer`).toBeDefined();
          // Right-aligned: the line starts past the middle of the page.
          // Centred, a line this short starts before it.
          expect(header!.x, `${name} p${p} header x`).toBeGreaterThan(
            view.width / 2,
          );
          expect(footer!.x, `${name} p${p} footer x`).toBeGreaterThan(
            view.width / 2,
          );
          // The header is at the top, the footer at the bottom.
          expect(header!.y).toBeGreaterThan(view.height / 2);
          expect(footer!.y).toBeLessThan(view.height / 2);
        }
      }
    },
  );
});

describe("Crop PDF's batch: the typed margin reaches every page of every file", () => {
  it(
    "40 pt on every edge gives each page a CropBox 40 pt in from each side",
    { timeout: 60_000 },
    async () => {
      const MARGIN = 40;
      // Health: the value differs from the batch's starting one.
      expect(MARGIN).not.toBe(CROP_BATCH_START);
      const sizes: [number, number][][] = [
        [
          [300, 400],
          [300, 400],
        ],
        [[612, 792]],
        [
          [500, 300],
          [400, 400],
        ],
      ];
      render(
        <Router>
          <CropBatch
            {...batchProps(
              await Promise.all(
                sizes.map(async (s, i) =>
                  pdfFile(await makePdf({ sizes: s }), `f${i}.pdf`),
                ),
              ),
            )}
          />
        </Router>,
      );
      fireEvent.change(screen.getByLabelText("Margin on every side (pt)"), {
        target: { value: String(MARGIN) },
      });
      const zip = await runAndUnzip("Crop 3 PDFs", 3);
      const boxes = await Promise.all(
        [...zip.values()].map(async (bytes) =>
          (await PDFDocument.load(bytes)).getPages().map((page) => {
            const { x, y, width, height } = page.getCropBox();
            return [x, y, width, height];
          }),
        ),
      );
      const want = sizes.map((file) =>
        file.map(([w, h]) => [MARGIN, MARGIN, w - 2 * MARGIN, h - 2 * MARGIN]),
      );
      expect(
        boxes.sort((a, b) => a.length - b.length || a[0]![2]! - b[0]![2]!),
      ).toEqual(
        want.sort((a, b) => a.length - b.length || a[0]![2]! - b[0]![2]!),
      );
    },
  );
});

describe("Split PDF Pages in Half's batch: Cut position and the shape option reach every file", () => {
  it(
    "a cut at 30% gives every file a first half 30% of the page wide",
    { timeout: 60_000 },
    async () => {
      const sheet = await makePdf({ sizes: [[600, 400]] });
      render(
        <Router>
          <SplitHalfBatch
            {...batchProps([
              pdfFile(sheet, "a.pdf"),
              pdfFile(sheet, "b.pdf"),
              pdfFile(sheet, "c.pdf"),
            ])}
          />
        </Router>,
      );
      fireEvent.change(screen.getByLabelText("Cut position"), {
        target: { value: "30" },
      });
      const zip = await runAndUnzip("Split 3 PDFs", 3);
      for (const [name, bytes] of zip) {
        const widths = (await PDFDocument.load(bytes))
          .getPages()
          .map((page) => page.getCropBox().width);
        expect(widths, name).toEqual([180, 420]);
      }
    },
  );

  it(
    "Only split pages wider than tall leaves each file's portrait page whole",
    { timeout: 60_000 },
    async () => {
      // A spread, then a single portrait page, in every file.
      const mixed = await makePdf({
        sizes: [
          [600, 400],
          [300, 400],
        ],
      });
      render(
        <Router>
          <SplitHalfBatch
            {...batchProps([
              pdfFile(mixed, "a.pdf"),
              pdfFile(mixed, "b.pdf"),
              pdfFile(mixed, "c.pdf"),
            ])}
          />
        </Router>,
      );
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: /Only split pages wider than tall/,
        }),
      );
      const zip = await runAndUnzip("Split 3 PDFs", 3);
      for (const [name, bytes] of zip) {
        const widths = (await PDFDocument.load(bytes))
          .getPages()
          .map((page) => page.getCropBox().width);
        // Without the option the portrait page is cut too: [300, 300, 150, 150].
        expect(widths, name).toEqual([300, 300, 300]);
      }
    },
  );
});
