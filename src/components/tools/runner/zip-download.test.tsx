// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { outputName } from "@/lib/pdf/files";
import { pageImageName, zipOutputName } from "@/lib/pdf/pdf-to-image";
import type { RasterPage } from "@/lib/pdf/render";
import { withoutComments } from "@/lib/tools/copy-surface";
import { CompressBatchRunner } from "./compress-batch";
import { ExtractionResult } from "./extract-images-runner";
import { ImageResult } from "./pdf-to-image-runner";
import { SplitEditor } from "./split-runner";
import { zipFailureMessage } from "./use-zip-download";

/**
 * What a person gets when they press "Download ZIP" — the file the browser
 * saves, opened and read back — and what they are told when there is no file.
 *
 * THE DEFECT: four runners built their archive as
 * `setZipping(true); try { await zipFiles(...) } finally { setZipping(false) }`
 * (batch compress without even the `try`) and fired it with `void`. No
 * `catch`. When the archive could not be built — the lazily loaded JSZip chunk
 * failing to fetch, or an allocation failure on a large bundle — the button
 * flashed "Preparing ZIP…" back to "Download ZIP", no file arrived, and the
 * page said nothing. For PDF → PNG and PDF → JPG a multi-page result is ONLY
 * delivered as that ZIP past the first 24 previews.
 *
 * Nothing caught it because the one proof that exercises these tools
 * (e2e/client-proof) renders a single page, which downloads without a ZIP.
 *
 * The failure is injected at JSZip itself (`generateAsync` rejects), not by
 * mocking `@/lib/pdf/browser`: with `isolate: false` a module evaluated under a
 * `vi.mock` stays cached bound to the stub for the next file in the worker. A
 * prototype spy is undone by `restoreAllMocks` and leaves the real
 * `zipFiles` → `downloadBlob` chain in place for the success half.
 */

interface Download {
  name: string;
  blob: Blob | undefined;
}

let downloads: Download[] = [];
let blobs: Map<string, Blob>;

beforeEach(() => {
  downloads = [];
  blobs = new Map();
  let n = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:zip-test-${++n}`;
    blobs.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({
      name: this.download,
      blob: blobs.get(this.getAttribute("href") ?? ""),
    });
  });
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
});

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Open the downloaded archive the way a person would, and list what is in it. */
async function openZip(blob: Blob | undefined) {
  expect(blob, "the download carried no archive").toBeDefined();
  const zip = await JSZip.loadAsync(await readBlob(blob!));
  const entries = new Map<string, Uint8Array>();
  for (const name of Object.keys(zip.files).sort()) {
    entries.set(name, await zip.file(name)!.async("uint8array"));
  }
  return entries;
}

async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([300 + i, 400]);
  return doc.save();
}

async function pageCountOf(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

function loaded(bytes: Uint8Array, name: string, pageCount: number) {
  return {
    file: new File([new Uint8Array(bytes)], name, { type: "application/pdf" }),
    bytes,
    pageCount,
    rotations: Array.from({ length: pageCount }, () => 0 as const),
  };
}

/**
 * One runner brought to the moment its ZIP button is on screen. `check`
 * opens the archive a successful press delivered and asserts on its contents,
 * derived from the same inputs the runner was given.
 */
interface Mounted {
  button: () => HTMLElement;
  filename: string;
  check: (entries: Map<string, Uint8Array>) => Promise<void>;
}

/**
 * Keyed by the file that calls `useZipDownload(`. The discovery test at the
 * bottom walks `src/` and fails if a caller exists that is not a key here — a
 * new ZIP download cannot ship without this proof running over it.
 */
const SCENARIOS: Record<string, () => Promise<Mounted>> = {
  "src/components/tools/runner/pdf-to-image-runner.tsx": async () => {
    const source = await pdfWithPages(3);
    const pdf = loaded(source, "report.pdf", 3);
    const pages: RasterPage[] = [0, 1, 2].map((index) => ({
      index,
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, index]),
      width: 1275,
      height: 1650,
      pageWidth: 612,
      pageHeight: 792,
      dpi: 150,
      dpiCapped: false,
      undecodedImages: 0,
    }));
    render(
      <ImageResult
        pdf={pdf}
        format="png"
        result={{
          pages,
          totalBytes: 15,
          zip: true,
          resolutionId: "high",
          resolutionLabel: "High",
          dpi: 150,
        }}
        onReset={() => {}}
        onStartOver={() => {}}
      />,
    );
    return {
      button: () =>
        screen.getByRole("button", { name: /download zip \(3 images\)/i }),
      filename: zipOutputName("report.pdf", "png"),
      check: async (entries) => {
        expect([...entries.keys()]).toEqual(
          pages.map((p) => pageImageName("report.pdf", p.index, 3, "png")),
        );
        pages.forEach((p) =>
          expect(
            entries.get(pageImageName("report.pdf", p.index, 3, "png")),
          ).toEqual(p.bytes),
        );
      },
    };
  },

  "src/components/tools/runner/extract-images-runner.tsx": async () => {
    const source = await pdfWithPages(2);
    const pdf = loaded(source, "brochure.pdf", 2);
    const images = [1, 2].map((page) => ({
      name: `page-00${page}-image-001.png`,
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, page]),
      format: "png" as const,
      width: 10,
      height: 10,
      page,
      colorSpace: "DeviceRGB",
    }));
    render(
      <ExtractionResult
        pdf={pdf}
        result={{ images, skipped: [], pageCount: 2, totalBytes: 10 }}
        onReset={() => {}}
        onStartOver={() => {}}
      />,
    );
    return {
      button: () =>
        screen.getByRole("button", { name: /download zip \(2 images\)/i }),
      filename: outputName("brochure.pdf", "images", "zip"),
      check: async (entries) => {
        expect([...entries.keys()]).toEqual(images.map((i) => i.name));
        images.forEach((i) => expect(entries.get(i.name)).toEqual(i.bytes));
      },
    };
  },

  "src/components/tools/runner/split-runner.tsx": async () => {
    const source = await pdfWithPages(4);
    render(
      <SplitEditor pdf={loaded(source, "deck.pdf", 4)} onReset={() => {}} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /split into 2 files/i }),
    );
    await screen.findByRole("button", { name: /download zip \(2 files\)/i });
    return {
      button: () =>
        screen.getByRole("button", { name: /download zip \(2 files\)/i }),
      filename: outputName("deck.pdf", "split", "zip"),
      check: async (entries) => {
        expect(entries.size).toBe(2);
        for (const [name, bytes] of entries) {
          expect(name).toMatch(/^deck-.*\.pdf$/);
          expect(await pageCountOf(bytes)).toBe(2);
        }
      },
    };
  },

  "src/components/tools/runner/compress-batch.tsx": async () => {
    const names = ["alpha.pdf", "beta.pdf"];
    const files = await Promise.all(
      names.map(
        async (name, i) =>
          new File([new Uint8Array(await pdfWithPages(i + 1))], name, {
            type: "application/pdf",
          }),
      ),
    );
    render(<CompressBatchRunner files={files} onReset={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /compress 2 pdfs/i }));
    await screen.findByRole(
      "button",
      { name: /download all \(2\)/i },
      { timeout: 10_000 },
    );
    return {
      button: () => screen.getByRole("button", { name: /download all \(2\)/i }),
      filename: "pdfxyz-compressed.zip",
      check: async (entries) => {
        expect([...entries.keys()]).toEqual(
          names.map((n) => outputName(n, "optimized")).sort(),
        );
        expect(
          await pageCountOf(entries.get(outputName("alpha.pdf", "optimized"))!),
        ).toBe(1);
        expect(
          await pageCountOf(entries.get(outputName("beta.pdf", "optimized"))!),
        ).toBe(2);
      },
    };
  },
};

describe("Download ZIP — a failed archive is reported, a good one is delivered", () => {
  it.each(Object.keys(SCENARIOS))(
    "%s: says the ZIP failed, frees the button, and the retry downloads the real archive",
    async (file) => {
      const mounted = await SCENARIOS[file]!();
      const generate = vi
        .spyOn(JSZip.prototype, "generateAsync")
        .mockRejectedValueOnce(new Error("Array buffer allocation failed"));

      fireEvent.click(mounted.button());

      // What the user is told. Before the fix: nothing — no alert at all.
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(zipFailureMessage());
      expect(generate).toHaveBeenCalledTimes(1);
      expect(downloads).toEqual([]);
      // The button is theirs again: not stuck in "Preparing ZIP…".
      await waitFor(() =>
        expect(mounted.button()).not.toHaveAttribute("aria-busy", "true"),
      );
      expect(mounted.button()).not.toHaveAttribute("aria-disabled", "true");

      // Positive control through the same button: the retry builds a real
      // archive, the stale error goes away, and the file holds the outputs.
      fireEvent.click(mounted.button());
      await waitFor(() => expect(downloads).toHaveLength(1));
      expect(generate).toHaveBeenCalledTimes(2);
      expect(downloads[0]!.name).toBe(mounted.filename);
      await mounted.check(await openZip(downloads[0]!.blob));
      await waitFor(() =>
        expect(screen.queryByText(zipFailureMessage(), { exact: false })).toBe(
          null,
        ),
      );
    },
    20_000,
  );
});

/* ------------------------------------------------------------------ *
 *  Discovery: every archive a runner builds goes through the hook,
 *  and every caller of the hook is proved above.
 * ------------------------------------------------------------------ */

const ROOT = process.cwd();

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
      out.push(path.relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}

/** A CALL of `name(`, not its definition. */
function calls(source: string, name: string): boolean {
  return new RegExp(`(?<!function\\s+)\\b${name}\\s*\\(`).test(
    withoutComments(source),
  );
}

describe("every ZIP download is the hook, and every hook caller is proved", () => {
  const files = sourceFiles(path.join(ROOT, "src"));
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("the walk saw the source tree, and the matcher sees a call but not a definition", () => {
    // Health: a walk that found nothing would pass every assertion below.
    expect(files.length, "the src/ walk is implausibly small").toBeGreaterThan(
      300,
    );
    expect(files).toContain("src/lib/pdf/browser.ts");
    // Positive and negative control for `calls` on real source.
    const browser = read("src/lib/pdf/browser.ts");
    expect(browser).toMatch(/function zipFiles\s*\(/);
    expect(calls(browser, "zipFiles")).toBe(false);
    expect(
      calls(
        read("src/components/tools/runner/use-zip-download.ts"),
        "zipFiles",
      ),
    ).toBe(true);
  });

  it("nothing but useZipDownload calls zipFiles( — a caller without a catch cannot come back", () => {
    const callers = files.filter((f) => calls(read(f), "zipFiles"));
    expect(
      callers,
      "these files build a ZIP outside useZipDownload, so a failed archive " +
        "is silent there again: " +
        callers.join(", "),
    ).toEqual(["src/components/tools/runner/use-zip-download.ts"]);
  });

  it("every caller of useZipDownload( has a failure-and-retry proof above", () => {
    const consumers = files
      .filter((f) => !f.endsWith("/use-zip-download.ts"))
      .filter((f) => calls(read(f), "useZipDownload"))
      .sort();
    expect(consumers.length, "no hook callers found").toBeGreaterThan(0);
    expect(consumers).toEqual(Object.keys(SCENARIOS).sort());
  });
});
