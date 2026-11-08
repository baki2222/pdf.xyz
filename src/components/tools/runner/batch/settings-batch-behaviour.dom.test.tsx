// @vitest-environment jsdom
// @native-canvas
/**
 * What the settings batches promise beyond "each file comes back", each read
 * from the saved files or from what a person can operate (batch plan P1):
 *
 *   - Add Page Numbers restarts in each file, at First number (the owner's
 *     ruling): two files numbered from 5 each read "Page 5 of …" on page 1.
 *   - Add Watermark's page list is the same in every file and is never cut
 *     down to fit one: a file without those pages fails on its own row,
 *     unstamped, and the other file is stamped on exactly those pages.
 *     An open-ended token ("3-") is checked as typed, never expanded, and
 *     each file resolves it against its own page count (review 2026-11-08:
 *     the check expanded "1-" to Number.MAX_SAFE_INTEGER pages, froze the
 *     tab, and blocked Run with "Set maximum size exceeded").
 *   - Add Page Numbers skips a file its settings number no page of, says
 *     why on its row, leaves it out of the archive, and the ending counts it.
 *   - Split PDF Pages in Half's Page order reaches every file, on either cut.
 *   - A browser out of memory stops the batch there, keeps what finished,
 *     and never runs the files after it.
 *   - A Run whose settings are incomplete keeps its focus, says why, and
 *     starts nothing.
 *   - The batch's starting settings are the single-file editor's own
 *     (option drift): both forms are rendered and their controls compared.
 *   - A Remove that leaves one file opens it in the single-file editor, with
 *     focus, through the page's own runner.
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
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import JSZip from "jszip";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { WATERMARK_BATCH_PAGES_NOTE } from "@/lib/batch/tools";
import { addPageNumbers, PAGE_NUMBER_MARGINS } from "@/lib/pdf/page-numbers";
import { getRunnerKind } from "@/lib/pdf/registry";
import { DEFAULT_IMAGE_SCALE, watermarkPdf } from "@/lib/pdf/watermark";
import { readAsViewer } from "@/tests/pdf-viewer-read";
import { runnerMounted } from "@/tests/runner-mounted";
import { PageNumbersEditor } from "../page-numbers-runner";
import { SplitHalfEditor } from "../split-half-runner";
import { ToolRunner } from "../tool-runner";
import { WatermarkEditor } from "../watermark-runner";
import type { LoadedPdf } from "../use-single-pdf";
import { PAGE_NUMBER_BATCH_NONE, PageNumbersBatch } from "./page-numbers-batch";
import {
  BATCH_OUT_OF_MEMORY,
  SettingsBatchRunner,
} from "./settings-batch-runner";
import { SplitHalfBatch } from "./split-half-batch";
import { WatermarkBatch } from "./watermark-batch";

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

let downloads: { name: string; blob: Blob }[] = [];
let pending: Blob | null = null;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
beforeEach(() => {
  downloads = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) pending = obj;
    return "blob:settings-batch-behaviour";
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (pending) downloads.push({ name: this.download, blob: pending });
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

async function pdfOfPages(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i += 1)
    doc
      .addPage([300, 400])
      .drawText(`Body ${i + 1}`, { x: 30, y: 300, font, size: 12 });
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

async function zipOf(): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(await downloads.at(-1)!.blob.arrayBuffer());
  const out = new Map<string, Uint8Array>();
  for (const name of Object.keys(zip.files))
    out.set(name, await zip.file(name)!.async("uint8array"));
  return out;
}

const textOf = async (bytes: Uint8Array, page: number) =>
  (await readAsViewer(bytes, page)).texts.map((t) => t.str).join(" ");

describe("Add Page Numbers' batch restarts in each file", () => {
  it(
    "numbers page 1 of each file from First number",
    { timeout: 60_000 },
    async () => {
      render(
        <Router>
          <PageNumbersBatch
            {...batchProps([
              pdfFile(await pdfOfPages(3), "three.pdf"),
              pdfFile(await pdfOfPages(2), "two.pdf"),
            ])}
          />
        </Router>,
      );
      fireEvent.change(screen.getByLabelText("First number"), {
        target: { value: "5" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Number 2 PDFs" }));
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: "Download all (2)" },
          { timeout: 30_000 },
        ),
      );
      await waitFor(() => expect(downloads).toHaveLength(1));
      const zip = await zipOf();
      // {total} is the last number printed: 5 + pages - 1.
      expect(await textOf(zip.get("three-numbered.pdf")!, 1)).toContain(
        "Page 5 of 7",
      );
      expect(await textOf(zip.get("two-numbered.pdf")!, 1)).toContain(
        "Page 5 of 6",
      );
      // Control: a count carried on from the first file would read 8 here.
      expect(await textOf(zip.get("two-numbered.pdf")!, 1)).not.toContain(
        "Page 8",
      );
    },
  );
});

describe("Add Watermark's batch: one page list, never cut down", () => {
  it(
    "fails the file without those pages, unstamped, and stamps the other on exactly those pages",
    { timeout: 60_000 },
    async () => {
      render(
        <Router>
          <WatermarkBatch
            {...batchProps([
              pdfFile(await pdfOfPages(2), "short.pdf"),
              pdfFile(await pdfOfPages(4), "long.pdf"),
            ])}
          />
        </Router>,
      );
      fireEvent.click(screen.getByRole("radio", { name: "Selected pages" }));
      fireEvent.change(screen.getByLabelText(/^Pages in every file/), {
        target: { value: "3-4" },
      });
      expect(
        screen.getByText(new RegExp(WATERMARK_BATCH_PAGES_NOTE.slice(0, 40))),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Watermark 2 PDFs" }));
      await screen.findByRole(
        "heading",
        { name: "Batch complete. 1 done, 1 failed." },
        { timeout: 30_000 },
      );
      const shortRow = screen.getByText("short.pdf").closest("li")!;
      // The engine's own check, in its words, with this file's count.
      expect(shortRow).toHaveTextContent(
        'This PDF has 2 pages — "3-4" is out of range.',
      );
      fireEvent.click(screen.getByRole("button", { name: "Download all (1)" }));
      await waitFor(() => expect(downloads).toHaveLength(1));
      const zip = await zipOf();
      expect([...zip.keys()]).toEqual(["long-watermarked.pdf"]);
      const long = zip.get("long-watermarked.pdf")!;
      expect(await textOf(long, 3)).toContain("CONFIDENTIAL");
      expect(await textOf(long, 4)).toContain("CONFIDENTIAL");
      // Control: the pages outside the list are left as they were.
      expect(await textOf(long, 1)).not.toContain("CONFIDENTIAL");
    },
  );
});

describe("Add Watermark's batch: an open-ended page range", () => {
  it(
    'takes "1-" and "3-" as typed, and stamps page 3 to the end of each file',
    { timeout: 60_000 },
    async () => {
      render(
        <Router>
          <WatermarkBatch
            {...batchProps([
              pdfFile(await pdfOfPages(3), "three.pdf"),
              pdfFile(await pdfOfPages(5), "five.pdf"),
            ])}
          />
        </Router>,
      );
      fireEvent.click(screen.getByRole("radio", { name: "Selected pages" }));
      const field = screen.getByLabelText(/^Pages in every file/);
      const run = screen.getByRole("button", { name: "Watermark 2 PDFs" });
      // On the way to "1-3", the dash alone is a whole range, not an error.
      const typedAt = performance.now();
      fireEvent.change(field, { target: { value: "1-" } });
      expect(run).not.toHaveAttribute("aria-disabled");
      fireEvent.change(field, { target: { value: "3-" } });
      expect(run).not.toHaveAttribute("aria-disabled");
      // Checked, not expanded: two keystrokes, nowhere near a second.
      expect(performance.now() - typedAt).toBeLessThan(500);
      // Control: a token no file could meet still blocks Run, in the
      // parser's own words.
      fireEvent.change(field, { target: { value: "5-3" } });
      expect(run).toHaveAttribute("aria-disabled", "true");
      expect(run).toHaveAccessibleDescription(/backwards/);
      fireEvent.change(field, { target: { value: "3-" } });
      fireEvent.click(run);
      await screen.findByRole(
        "heading",
        { name: "Batch complete. 2 done, 0 failed." },
        { timeout: 30_000 },
      );
      fireEvent.click(screen.getByRole("button", { name: "Download all (2)" }));
      await waitFor(() => expect(downloads).toHaveLength(1));
      const zip = await zipOf();
      const stamped = async (name: string, pages: number) => {
        const out: number[] = [];
        for (let p = 1; p <= pages; p += 1)
          if ((await textOf(zip.get(name)!, p)).includes("CONFIDENTIAL"))
            out.push(p);
        return out;
      };
      // Each file resolves "3-" against its own page count.
      expect(await stamped("three-watermarked.pdf", 3)).toEqual([3]);
      expect(await stamped("five-watermarked.pdf", 5)).toEqual([3, 4, 5]);
    },
  );
});

describe("Add Page Numbers' batch: a file its settings number no page of", () => {
  it(
    "is skipped with the reason, left out of the archive, and counted in the ending",
    { timeout: 60_000 },
    async () => {
      render(
        <Router>
          <PageNumbersBatch
            {...batchProps([
              pdfFile(await pdfOfPages(1), "cover.pdf"),
              pdfFile(await pdfOfPages(3), "three.pdf"),
            ])}
          />
        </Router>,
      );
      fireEvent.click(
        screen.getByRole("checkbox", { name: /Leave the cover unnumbered/ }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Number 2 PDFs" }));
      await screen.findByRole(
        "heading",
        { name: "Batch complete. 1 done, 0 failed, 1 skipped." },
        { timeout: 30_000 },
      );
      const coverRow = screen.getByText("cover.pdf").closest("li")!;
      expect(coverRow).toHaveTextContent(`Skipped · ${PAGE_NUMBER_BATCH_NONE}`);
      fireEvent.click(screen.getByRole("button", { name: "Download all (1)" }));
      await waitFor(() => expect(downloads).toHaveLength(1));
      const zip = await zipOf();
      expect([...zip.keys()]).toEqual(["three-numbered.pdf"]);
      const three = zip.get("three-numbered.pdf")!;
      // The other file is numbered: its cover counted but bare, page 2 on.
      expect(await textOf(three, 1)).not.toMatch(/Page \d/);
      expect(await textOf(three, 2)).toContain("Page 2 of 3");
    },
  );
});

/** `pdfOfPages`' page size, for reading where each half went. */
const SHEET = { width: 300, height: 400 };

describe("Split PDF Pages in Half's batch: Page order reaches every file", () => {
  it.each([
    // The bottom half of an unrotated page starts at y = 0.
    { direction: "Top and bottom", order: "Bottom half first", x: 0, y: 0 },
    {
      direction: "Top and bottom",
      order: "Top half first",
      x: 0,
      y: SHEET.height / 2,
    },
    {
      direction: "Left and right",
      order: "Right page first",
      x: SHEET.width / 2,
      y: 0,
    },
    { direction: "Left and right", order: "Left page first", x: 0, y: 0 },
  ])(
    "$direction, $order: page 1 of every output starts at ($x, $y)",
    { timeout: 60_000 },
    async ({ direction, order, x, y }) => {
      const sheet = await pdfOfPages(1);
      render(
        <Router>
          <SplitHalfBatch
            {...batchProps([pdfFile(sheet, "a.pdf"), pdfFile(sheet, "b.pdf")])}
          />
        </Router>,
      );
      fireEvent.click(screen.getByRole("radio", { name: direction }));
      fireEvent.click(screen.getByRole("radio", { name: order }));
      fireEvent.click(screen.getByRole("button", { name: "Split 2 PDFs" }));
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: "Download all (2)" },
          { timeout: 30_000 },
        ),
      );
      await waitFor(() => expect(downloads).toHaveLength(1));
      const zip = await zipOf();
      expect(zip.size).toBe(2);
      for (const [name, bytes] of zip) {
        const doc = await PDFDocument.load(bytes);
        expect(doc.getPageCount(), name).toBe(2);
        const [first, second] = doc.getPages().map((p) => p.getCropBox());
        expect({ x: first!.x, y: first!.y }, name).toEqual({ x, y });
        // Health: page 2 is the other half, not the same one again.
        expect({ x: second!.x, y: second!.y }, name).not.toEqual({ x, y });
      }
    },
  );
});

describe("a batch that runs out of memory", () => {
  it(
    "stops there, keeps the finished file, and never runs the rest",
    { timeout: 30_000 },
    async () => {
      const ran: string[] = [];
      const bytes = await pdfOfPages(1);
      render(
        <Router>
          <SettingsBatchRunner
            {...batchProps([
              pdfFile(bytes, "a.pdf"),
              pdfFile(bytes, "b.pdf"),
              pdfFile(bytes, "c.pdf"),
            ])}
            toolName="Test Tool"
            verb="Test"
            runningLabel="Testing…"
            zipName="pdfxyz-test.zip"
            process={async ({ file, bytes: input }) => {
              ran.push(file.name);
              if (file.name === "b.pdf")
                throw new RangeError("Array buffer allocation failed");
              return {
                name: `${file.name}-out.pdf`,
                bytes: input,
                detail: "done",
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
      expect(
        screen.getByRole("button", { name: "Download a.pdf-out.pdf" }),
      ).toBeInTheDocument();
    },
  );

  it(
    "control: any other failure fails its row and the batch goes on",
    { timeout: 30_000 },
    async () => {
      const ran: string[] = [];
      const bytes = await pdfOfPages(1);
      render(
        <Router>
          <SettingsBatchRunner
            {...batchProps([
              pdfFile(bytes, "a.pdf"),
              pdfFile(bytes, "b.pdf"),
              pdfFile(bytes, "c.pdf"),
            ])}
            toolName="Test Tool"
            verb="Test"
            runningLabel="Testing…"
            zipName="pdfxyz-test.zip"
            process={async ({ file, bytes: input }) => {
              ran.push(file.name);
              if (file.name === "b.pdf") throw new Error("b broke");
              return {
                name: `${file.name}-out.pdf`,
                bytes: input,
                detail: "done",
              };
            }}
          />
        </Router>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Test 3 PDFs" }));
      await screen.findByRole(
        "heading",
        { name: "Batch complete. 2 done, 1 failed." },
        { timeout: 10_000 },
      );
      expect(ran).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    },
  );
});

describe("a Run whose settings are incomplete", () => {
  it(
    "keeps its focus, says why, and starts nothing",
    { timeout: 30_000 },
    async () => {
      const bytes = await pdfOfPages(1);
      render(
        <Router>
          <WatermarkBatch
            {...batchProps([pdfFile(bytes, "a.pdf"), pdfFile(bytes, "b.pdf")])}
          />
        </Router>,
      );
      fireEvent.change(screen.getByLabelText("Text"), {
        target: { value: "  " },
      });
      const run = screen.getByRole("button", { name: "Watermark 2 PDFs" });
      expect(run).toHaveAttribute("aria-disabled", "true");
      expect(run).toHaveAccessibleDescription("Type the watermark text first.");
      run.focus();
      fireEvent.click(run);
      expect(document.activeElement).toBe(run);
      expect(screen.getByText("2 PDFs ready")).toBeInTheDocument();
      // Control: with text, the same press runs the batch.
      fireEvent.change(screen.getByLabelText("Text"), {
        target: { value: "DRAFT" },
      });
      expect(run).not.toHaveAttribute("aria-disabled");
      fireEvent.click(run);
      await screen.findByRole(
        "heading",
        { name: /^Batch complete/ },
        { timeout: 20_000 },
      );
    },
  );
});

/** A loaded single-file editor's input, for rendering an editor directly. */
async function loaded(): Promise<LoadedPdf> {
  const bytes = await pdfOfPages(2);
  return {
    file: pdfFile(bytes, "doc.pdf"),
    bytes,
    pageCount: 2,
    rotations: [0, 0],
    digitalSignatures: 0,
  };
}

/**
 * What page 1 draws: its content streams in order, decoded, with pdf-lib's
 * random resource-name suffixes taken out, and the fonts the file names.
 */
async function drawingOf(
  bytes: Uint8Array,
): Promise<{ ops: string; fonts: string[] }> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  const ops = streams
    .map((s) =>
      s instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(s).decode())
        : String(s),
    )
    .join("\n--\n")
    .replace(/\/([A-Za-z]+)-\d+/g, "/$1");
  const fonts = doc.context
    .enumerateIndirectObjects()
    .flatMap(([, obj]) => {
      if (!(obj instanceof PDFDict)) return [];
      if (obj.get(PDFName.of("Type")) !== PDFName.of("Font")) return [];
      const base = obj.get(PDFName.of("BaseFont"));
      return base ? [String(base).replace(/^\/[A-Z]{6}\+/, "/")] : [];
    })
    .sort();
  return { ops, fonts };
}

/** Which radio of a named group is checked. */
const checkedIn = (scope: HTMLElement, group: string) =>
  within(within(scope).getByRole("radiogroup", { name: group }))
    .getAllByRole("radio")
    .find((r) => r.getAttribute("aria-checked") === "true")
    ?.getAttribute("aria-label") ??
  within(within(scope).getByRole("radiogroup", { name: group }))
    .getAllByRole("radio")
    .find((r) => r.getAttribute("aria-checked") === "true")?.textContent;

describe("option drift: the batch starts where the single-file editor does", () => {
  it("Add Page Numbers: format preset and position", async () => {
    const one = render(
      <Router>
        <PageNumbersEditor pdf={await loaded()} onReset={() => {}} />
      </Router>,
    );
    const single = {
      format: checkedIn(one.container, "Number format preset"),
      position: checkedIn(one.container, "Position"),
    };
    one.unmount();
    const bytes = await pdfOfPages(1);
    const many = render(
      <Router>
        <PageNumbersBatch
          {...batchProps([pdfFile(bytes, "a.pdf"), pdfFile(bytes, "b.pdf")])}
        />
      </Router>,
    );
    expect({
      format: checkedIn(many.container, "Number format preset"),
      position: checkedIn(many.container, "Position"),
    }).toEqual(single);
    // Health: the comparison read real values.
    expect(single.format).toBeTruthy();
    expect(single.position).toBe("Bottom center");
  });

  it("Add Page Numbers: font size and margin, left to the engine, land where the editor's defaults do", async () => {
    const one = render(
      <Router>
        <PageNumbersEditor pdf={await loaded()} onReset={() => {}} />
      </Router>,
    );
    const fontSize = Number(
      (within(one.container).getByLabelText("Font size") as HTMLInputElement)
        .value,
    );
    const margin = checkedIn(
      one.container,
      "Margin from the page edge",
    )!.toLowerCase() as keyof typeof PAGE_NUMBER_MARGINS;
    one.unmount();
    // Health: the editor's controls were read.
    expect(fontSize).toBeGreaterThan(0);
    expect(PAGE_NUMBER_MARGINS[margin]).toBeGreaterThan(0);
    const bytes = await pdfOfPages(1);
    const place = async (options: Parameters<typeof addPageNumbers>[1]) =>
      (await readAsViewer(await addPageNumbers(bytes, options), 1)).texts
        .filter((t) => t.str.startsWith("Page"))
        .map(({ x, y, size }) => ({ x, y, size }));
    const batch = await place({});
    expect(batch).toHaveLength(1);
    expect(batch).toEqual(
      await place({ fontSize, margin: PAGE_NUMBER_MARGINS[margin] }),
    );
  });

  it("Add Watermark: text, opacity, rotation and position", async () => {
    const read = (scope: HTMLElement) => ({
      text: (within(scope).getByLabelText("Text") as HTMLInputElement).value,
      opacity: (within(scope).getByLabelText("Opacity") as HTMLInputElement)
        .value,
      rotation: (within(scope).getByLabelText("Rotation") as HTMLInputElement)
        .value,
      position: checkedIn(scope, "Watermark position"),
    });
    const one = render(
      <Router>
        <WatermarkEditor pdf={await loaded()} onReset={() => {}} />
      </Router>,
    );
    const single = read(one.container);
    one.unmount();
    const bytes = await pdfOfPages(1);
    const many = render(
      <Router>
        <WatermarkBatch
          {...batchProps([pdfFile(bytes, "a.pdf"), pdfFile(bytes, "b.pdf")])}
        />
      </Router>,
    );
    expect(read(many.container)).toEqual(single);
    expect(single.text).toBe("CONFIDENTIAL");
  });

  it("Add Watermark: the size, left to the engine, is the editor's default", async () => {
    const one = render(
      <Router>
        <WatermarkEditor pdf={await loaded()} onReset={() => {}} />
      </Router>,
    );
    const fontSize = Number(
      (
        within(one.container).getByLabelText(
          "Max font size",
        ) as HTMLInputElement
      ).value,
    );
    one.unmount();
    expect(fontSize).toBeGreaterThan(0);
    const bytes = await pdfOfPages(1);
    const sizeOf = async (options: Parameters<typeof watermarkPdf>[2]) =>
      (
        await readAsViewer(
          (await watermarkPdf(bytes, "MARK", options)).bytes,
          1,
        )
      ).texts
        .filter((t) => t.str.includes("MARK"))
        .map((t) => t.size);
    expect(await sizeOf({})).toEqual(await sizeOf({ fontSize }));
    // Control: another size is seen as another size.
    expect(await sizeOf({})).not.toEqual(
      await sizeOf({ fontSize: fontSize / 2 }),
    );
  });

  it(
    "Add Watermark: font, color, layer and size draw what the editor's defaults draw",
    { timeout: 60_000 },
    async () => {
      // The editor's own Run on a file, then the batch's on the same file.
      // Both pages are drawn by one engine, so a default the batch leaves
      // to the engine and the editor sets differently (font, ink, layer,
      // size) shows as a different drawing.
      const input = await pdfOfPages(1);
      const one = render(
        <Router>
          <WatermarkEditor
            pdf={{
              file: pdfFile(input, "doc.pdf"),
              bytes: input,
              pageCount: 1,
              rotations: [0],
              digitalSignatures: 0,
            }}
            onReset={() => {}}
          />
        </Router>,
      );
      fireEvent.click(
        within(one.container).getByRole("button", { name: /add watermark/i }),
      );
      fireEvent.click(
        await within(one.container).findByRole(
          "button",
          { name: /download watermarked pdf/i },
          { timeout: 20_000 },
        ),
      );
      await waitFor(() => expect(downloads).toHaveLength(1));
      const single = new Uint8Array(await downloads[0]!.blob.arrayBuffer());
      one.unmount();

      render(
        <Router>
          <WatermarkBatch
            {...batchProps([pdfFile(input, "a.pdf"), pdfFile(input, "b.pdf")])}
          />
        </Router>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Watermark 2 PDFs" }));
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: "Download all (2)" },
          { timeout: 30_000 },
        ),
      );
      await waitFor(() => expect(downloads).toHaveLength(2));
      const batch = (await zipOf()).get("a-watermarked.pdf")!;

      const drawn = await drawingOf(single);
      // Health: the mark was read, with its ink and its font.
      expect(drawn.ops).toMatch(/ rg\b/);
      expect(drawn.fonts.length).toBeGreaterThan(0);
      expect(await drawingOf(batch)).toEqual(drawn);
      // Controls: another ink, and the other layer, are seen as different.
      const other = async (options: Parameters<typeof watermarkPdf>[2]) =>
        drawingOf(
          (
            await watermarkPdf(input, "CONFIDENTIAL", {
              opacity: 0.18,
              rotation: 45,
              ...options,
            })
          ).bytes,
        );
      expect(await other({})).toEqual(drawn);
      expect(await other({ color: { r: 0.78, g: 0.12, b: 0.12 } })).not.toEqual(
        drawn,
      );
      expect(await other({ layer: "behind" })).not.toEqual(drawn);
      expect(await other({ font: "courier" })).not.toEqual(drawn);
    },
  );

  it("Add Watermark: an image mark starts at the size the batch uses", async () => {
    const one = render(
      <Router>
        <WatermarkEditor pdf={await loaded()} onReset={() => {}} />
      </Router>,
    );
    fireEvent.click(
      within(one.container).getByRole("radio", { name: "Image" }),
    );
    const scale = Number(
      (within(one.container).getByLabelText("Image size") as HTMLInputElement)
        .value,
    );
    // The batch passes DEFAULT_IMAGE_SCALE with every image mark.
    expect(scale).toBe(DEFAULT_IMAGE_SCALE);
  });

  it("Split PDF Pages in Half: direction and order", async () => {
    const read = (scope: HTMLElement) => ({
      direction: checkedIn(scope, "Direction"),
      order: checkedIn(scope, "Page order"),
    });
    const one = render(
      <Router>
        <SplitHalfEditor pdf={await loaded()} onReset={() => {}} />
      </Router>,
    );
    const single = read(one.container);
    one.unmount();
    const bytes = await pdfOfPages(1);
    const many = render(
      <Router>
        <SplitHalfBatch
          {...batchProps([pdfFile(bytes, "a.pdf"), pdfFile(bytes, "b.pdf")])}
        />
      </Router>,
    );
    expect(read(many.container)).toEqual(single);
    expect(single.direction).toBe("Left and right");
  });
});

describe("a Remove that leaves one file, through the page's runner", () => {
  it(
    "opens that file in the single-file editor, with focus",
    { timeout: 60_000 },
    async () => {
      const kind = getRunnerKind("rotate-pdf")!;
      const { container } = render(
        <Router>
          <ToolRunner kind={kind} slug="rotate-pdf" />
        </Router>,
      );
      await runnerMounted(container);
      const bytes = await pdfOfPages(2);
      fireEvent.change(container.querySelector('input[type="file"]')!, {
        target: {
          files: [pdfFile(bytes, "keep.pdf"), pdfFile(bytes, "drop.pdf")],
        },
      });
      const remove = await screen.findByRole(
        "button",
        { name: "Remove drop.pdf" },
        { timeout: 20_000 },
      );
      remove.focus();
      fireEvent.click(remove);
      // The single-file editor: its page tiles and its own Run.
      await screen.findByRole(
        "button",
        { name: /apply rotation/i },
        { timeout: 20_000 },
      );
      expect(screen.getByText("keep.pdf")).toBeInTheDocument();
      expect(
        screen.queryByRole("list", { name: "Files in this batch" }),
      ).toBeNull();
      const editor = container.querySelector(
        '[data-single-pdf-runner="loaded"]',
      );
      await waitFor(() => expect(document.activeElement).toBe(editor));
    },
  );
});
