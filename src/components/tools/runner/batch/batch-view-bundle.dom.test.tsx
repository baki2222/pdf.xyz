// @vitest-environment jsdom
/**
 * The batch view's bundling (batch plan P2), for the tools that make MANY
 * files of each input — PDF to JPG and PNG, Extract Images: "Download all"
 * puts each input's files in a folder named after it, two inputs of one
 * name get two folders (" (2)", the archive's own naming rule), a row that
 * made several files has ONE button saving them as its own ZIP, and a row
 * that made none (no images in it) has no button and is not counted.
 *
 * Over the real driver and the real ZIP builder; the archive the browser is
 * handed is opened and read back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import JSZip from "jszip";
import { useBatchRunner, type BatchUnit } from "../use-batch-runner";
import { ZIP_FAILED_MESSAGE } from "../use-zip-download";
import { BATCH_LIMITS } from "@/lib/batch/limits";
import { BatchView } from "./batch-view";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

interface Row {
  folder: string;
  zipName: string;
  files: { name: string; blob: Blob }[];
}

let downloads: { name: string; blob: Blob }[] = [];
let pending: Blob | null = null;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
beforeEach(() => {
  downloads = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) pending = obj;
    return "blob:batch-view-bundle";
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
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

/** Three inputs: two named report.pdf (two images each), one with none. */
const UNITS: BatchUnit[] = [
  ["r1", "report.pdf", 2],
  ["r2", "report.pdf", 2],
  ["e", "empty.pdf", 0],
].map(([id, name]) => ({
  id: String(id),
  name: String(name),
  file: new File([String(id)], String(name), { type: "application/pdf" }),
}));
const IMAGES: Record<string, number> = { r1: 2, r2: 2, e: 0, d1: 1, d2: 1 };

/**
 * How an input's image Blobs are read when a ZIP is built: unset, as a real
 * Blob is. A test sets it to hold a read open (a ZIP still building) or to
 * fail it (a ZIP that cannot be built).
 */
let readHook: ((id: string) => Promise<ArrayBuffer>) | null = null;
/** The size each image Blob reports, when set (a ZIP's input, without the bytes). */
let sizeEach: number | null = null;
afterEach(() => {
  readHook = null;
  sizeEach = null;
});
function imageBlob(id: string, n: number): Blob {
  const blob = new Blob([`${id}:${n}`]);
  const read = blob.arrayBuffer.bind(blob);
  Object.defineProperty(blob, "arrayBuffer", {
    value: () => (readHook ? readHook(id) : read()),
  });
  if (sizeEach !== null)
    Object.defineProperty(blob, "size", { value: sizeEach });
  return blob;
}

function Harness({ units = UNITS }: { units?: BatchUnit[] }) {
  const runner = useBatchRunner<Row>(units, async (file) => {
    const id = String(await file.text());
    return {
      folder: file.name.replace(/\.pdf$/i, ""),
      zipName: `${id}-images.zip`,
      files: Array.from({ length: IMAGES[id]! }, (_, i) => ({
        name: `page-${i + 1}.png`,
        blob: imageBlob(id, i + 1),
      })),
    };
  });
  return (
    <BatchView<Row>
      runner={runner}
      arrivedCount={units.length}
      banner={<p>banner</p>}
      countLabel={(n) => `${n} PDFs`}
      runLabel={(n) => `Convert ${n} PDFs`}
      runningLabel="Converting…"
      errorFallback="Couldn’t convert"
      progressLabel="Batch progress"
      footnote="On your device."
      outputs={(r) => r.files}
      describe={(r) => `${r.files.length} images`}
      downloadLabel={(item, r) =>
        `Download the ${r.files.length} images of ${item.name}`
      }
      doneSentence={(p) => `Batch complete. ${p.done} done.`}
      inputBytes={() => 1}
      zipName="pdfxyz-test-images.zip"
      zipFallback="Download a file's images from its row."
      bundle={(r) => ({ folder: r.folder, zipName: r.zipName })}
      onReset={() => {}}
    />
  );
}

async function entriesOf(blob: Blob): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const out: Record<string, string> = {};
  for (const [name, entry] of Object.entries(zip.files))
    if (!entry.dir) out[name] = await entry.async("string");
  return out;
}

describe("BatchView — one folder per input", () => {
  it("Download all nests each input's files in a folder of its name, two of one name told apart", async () => {
    render(
      <AppRouterContext.Provider value={router as never}>
        <Harness />
      </AppRouterContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Convert 3 PDFs" }));
    // The row with no images is not counted: two inputs made files.
    const all = await screen.findByRole("button", {
      name: "Download all (2)",
    });
    fireEvent.click(all);
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]!.name).toBe("pdfxyz-test-images.zip");
    expect(await entriesOf(downloads[0]!.blob)).toEqual({
      "report/page-1.png": "r1:1",
      "report/page-2.png": "r1:2",
      "report (2)/page-1.png": "r2:1",
      "report (2)/page-2.png": "r2:2",
    });
  });

  it("a row of several files has one button, saving them as that row's own ZIP; a row of none has none", async () => {
    render(
      <AppRouterContext.Provider value={router as never}>
        <Harness />
      </AppRouterContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Convert 3 PDFs" }));
    const rowButtons = await screen.findAllByRole("button", {
      name: "Download the 2 images of report.pdf",
    });
    // One button per row, not one per image.
    expect(rowButtons).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /images of empty\.pdf/ }),
    ).toBeNull();
    fireEvent.click(rowButtons[1]!);
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]!.name).toBe("r2-images.zip");
    expect(await entriesOf(downloads[0]!.blob)).toEqual({
      "page-1.png": "r2:1",
      "page-2.png": "r2:2",
    });
  });
});

/**
 * What "Download all" may bundle. Building the ZIP holds every output twice
 * over (the kept Blobs, each one's bytes, and the archive): measured at
 * 375px on 2026-11-08, five ten-page Letter PDFs through PDF to PNG at
 * 300 DPI made 808.6 MB of images and took the renderer's heap from 171.6
 * to 1,631 MB while the archive built. Past the batch's own total
 * (`BATCH_LIMITS.clientMaxTotalBytes`, what the batch holds its inputs to),
 * the button is replaced by a note sending the reader to each row's own
 * download, which bundles one file's outputs at a time.
 */
describe("BatchView — Download all has a ceiling on what it bundles", () => {
  const cap = BATCH_LIMITS.clientMaxTotalBytes;
  /** Four images in all (two rows of two) adding up to `total`. */
  async function settleWith(total: number) {
    sizeEach = total / 4;
    render(
      <AppRouterContext.Provider value={router as never}>
        <Harness />
      </AppRouterContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Convert 3 PDFs" }));
    return screen.findAllByRole("button", {
      name: "Download the 2 images of report.pdf",
    });
  }

  it("past it, Download all is replaced by a note sending the reader to each row", async () => {
    const rows = await settleWith(cap + 4);
    expect(screen.queryByRole("button", { name: /^Download all/ })).toBeNull();
    const mb = Math.round(cap / 1024 / 1024);
    expect(
      screen.getByText((text) =>
        text.includes(`more than one ZIP is built from here (${mb} MB)`),
      ),
    ).toHaveTextContent("Save each file's results from its own row.");
    // The rows' own ZIPs are still there, and still work.
    fireEvent.click(rows[0]!);
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]!.name).toBe("r1-images.zip");
  });

  it("control: at it exactly, Download all is offered", async () => {
    await settleWith(cap);
    expect(
      screen.getByRole("button", { name: "Download all (2)" }),
    ).toBeInTheDocument();
  });
});

describe("BatchView — folders of dotted names", () => {
  it("two inputs named scan.v2.pdf give folders scan.v2 and scan.v2 (2): a folder has no extension", async () => {
    const units: BatchUnit[] = ["d1", "d2"].map((id) => ({
      id,
      name: "scan.v2.pdf",
      file: new File([id], "scan.v2.pdf", { type: "application/pdf" }),
    }));
    render(
      <AppRouterContext.Provider value={router as never}>
        <Harness units={units} />
      </AppRouterContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Convert 2 PDFs" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Download all (2)" }),
    );
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(await entriesOf(downloads[0]!.blob)).toEqual({
      "scan.v2/page-1.png": "d1:1",
      "scan.v2 (2)/page-1.png": "d2:1",
    });
  });
});

describe("BatchView — a row's own ZIP, as a keyboard and a screen reader meet it", () => {
  function mount() {
    render(
      <AppRouterContext.Provider value={router as never}>
        <Harness />
      </AppRouterContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Convert 3 PDFs" }));
    return screen.findAllByRole("button", {
      name: "Download the 2 images of report.pdf",
    });
  }
  const rowOf = (button: HTMLElement) => button.closest("li")!;

  it("while a row's ZIP builds, its button is busy and every ZIP button is aria-disabled", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    readHook = async (id) => {
      await held;
      return new TextEncoder().encode(id).buffer;
    };
    const rows = await mount();
    fireEvent.click(rows[1]!);
    await waitFor(() => expect(rows[1]).toHaveAttribute("aria-busy", "true"));
    expect(rows[1]).toHaveAttribute("aria-disabled", "true");
    // The other row is held off too, but it is not the one building.
    expect(rows[0]).toHaveAttribute("aria-disabled", "true");
    expect(rows[0]).not.toHaveAttribute("aria-busy", "true");
    const all = screen.getByRole("button", { name: "Download all (2)" });
    expect(all).toHaveAttribute("aria-disabled", "true");
    // A second press while it builds starts nothing.
    fireEvent.click(rows[0]!);
    release();
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]!.name).toBe("r2-images.zip");
    await waitFor(() =>
      expect(rows[1]).not.toHaveAttribute("aria-busy", "true"),
    );
    expect(rows[0]).not.toHaveAttribute("aria-disabled");
  });

  it("while Download all builds, a row's button is aria-disabled and a press starts nothing", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    readHook = async (id) => {
      await held;
      return new TextEncoder().encode(id).buffer;
    };
    const rows = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Download all (2)" }));
    await waitFor(() =>
      expect(rows[0]).toHaveAttribute("aria-disabled", "true"),
    );
    expect(rows[0]).not.toHaveAttribute("aria-busy", "true");
    fireEvent.click(rows[0]!);
    release();
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]!.name).toBe("pdfxyz-test-images.zip");
  });

  it("a row's ZIP that fails says so at that row, not beside Download all", async () => {
    readHook = (id) =>
      id === "r2"
        ? Promise.reject(new Error("read failed"))
        : Promise.resolve(new TextEncoder().encode(id).buffer);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = await mount();
    fireEvent.click(rows[1]!);
    const alert = await within(rowOf(rows[1]!)).findByRole("alert");
    expect(alert).toHaveTextContent(ZIP_FAILED_MESSAGE);
    // One alert, at the row: none beside Download all, none at the other row.
    expect(screen.getAllByRole("alert")).toEqual([alert]);
    expect(downloads).toHaveLength(0);
    // The next ZIP clears it.
    readHook = null;
    fireEvent.click(rows[0]!);
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(screen.queryAllByRole("alert")).toEqual([]);
  });

  it("control: Download all's failure stays beside Download all, not at a row", async () => {
    readHook = () => Promise.reject(new Error("read failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Download all (2)" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ZIP_FAILED_MESSAGE);
    for (const row of rows) expect(rowOf(row)).not.toContainElement(alert);
  });
});
