// @vitest-environment jsdom
// @native-canvas
/**
 * "View page N larger" on every page board (backlog #9, 2026-11-17), driven
 * the way a visitor drives it: the board's own runner, a real PDF whose pages
 * differ in width (page n is 100 + n points wide, so a rendered width names
 * its page), the enlarge button, the dialog.
 *
 * Judged on two things. The enlarged image is the right page AS THE TILE
 * SHOWS IT: on Rotate and Organize that is after the pending turn and in the
 * new order, so a page turned a quarter is drawn as wide as it was tall. And
 * the button leaves the tile's own control alone: Split's cut, the picker's
 * selection, Rotate's selection, Organize's order.
 *
 * Same stubs as page-select-zoom.test.tsx: pdfjs is its legacy build, and
 * `toBlob` remembers the canvas width behind each object URL.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { getRunnerKind } from "@/lib/pdf/registry";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import { withAppRouter } from "@/tests/app-router";
import { runnerMounted } from "@/tests/runner-mounted";
import { renderDimensions } from "@/lib/pdf/render-utils";
import { ToolRunner } from "./tool-runner";
import { ZOOM_WIDTH } from "./page-zoom-dialog";
import { zoomLabel } from "./page-zoom-lazy";
import { cutAfterLabel } from "./page-picker";
import { SplitEditor } from "./split-runner";
import { PdfToImageRunner } from "./pdf-to-image-runner";

vi.mock("pdfjs-dist", async () => import("pdfjs-dist/legacy/build/pdf.mjs"));

type Legacy = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let legacy: Legacy;
let savedWorkerSrc: string;
let pageProto: { render: (...args: unknown[]) => unknown };

beforeAll(async () => {
  legacy = await import("pdfjs-dist/legacy/build/pdf.mjs");
  savedWorkerSrc = legacy.GlobalWorkerOptions.workerSrc;
  (globalThis as Record<string, unknown>).pdfjsWorker =
    // @ts-expect-error -- pdfjs-dist ships no .d.ts for its worker entry.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const doc = await PDFDocument.create();
  doc.addPage([10, 10]);
  const task = legacy.getDocument({ data: await doc.save() });
  const loaded = await task.promise;
  pageProto = Object.getPrototypeOf(await loaded.getPage(1));
  await task.destroy();
});

afterAll(() => {
  legacy.GlobalWorkerOptions.workerSrc = savedWorkerSrc;
  delete (globalThis as Record<string, unknown>).pdfjsWorker;
});

let downloads: Blob[] = [];
/** The canvas width behind each object URL the thumbnail path made. */
const widthOf = new Map<string, number>();
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  downloads = [];
  widthOf.clear();
  let n = 0;
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const url = `blob:page-zoom/${++n}`;
    if (obj instanceof Blob) {
      const w = (obj as Blob & { canvasWidth?: number }).canvasWidth;
      if (w !== undefined) widthOf.set(url, w);
      else downloads.push(obj);
    }
    return url;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(pageProto, "render").mockImplementation(() => ({
    promise: Promise.resolve(),
    cancel: () => {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    done: BlobCallback,
  ) {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], {
      type: "image/png",
    });
    done(Object.assign(blob, { canvasWidth: this.width }));
  });
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

/** Page n (1-based) is 100 + n points wide, so a width names its page. */
async function pagesPdf(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= count; n++) doc.addPage([100 + n, 200]);
  return doc.save();
}

/** The width the dialog renders a `w` x `h` point page at. */
const zoomWidth = (w: number, h: number) =>
  renderDimensions(w, h, ZOOM_WIDTH, 2).width;

async function mountTool(slug: string, count: number) {
  const kind = getRunnerKind(slug);
  expect(kind, `the registry no longer maps ${slug}`).toBeTruthy();
  const { container } = render(
    withAppRouter(<ToolRunner kind={kind!} slug={slug} />),
  );
  await runnerMounted(container);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  fireEvent.change(input!, {
    target: {
      files: [
        new File([(await pagesPdf(count)).slice()], "deck.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  await screen.findByRole(
    "button",
    { name: zoomLabel(count) },
    { timeout: 10_000 },
  );
}

/** Press an enlarge button; resolve the dialog and its image's width. */
async function openZoom(button: HTMLElement, title: string) {
  button.focus();
  fireEvent.click(button);
  const dialog = await screen.findByRole(
    "dialog",
    { name: title },
    { timeout: 10_000 },
  );
  const img = await within(dialog).findByRole("img", {}, { timeout: 10_000 });
  return { dialog, width: widthOf.get(img.getAttribute("src") ?? "") };
}

/** Escape closes it, and focus goes back to the button that opened it. */
async function closeBack(opener: HTMLElement) {
  // jsdom's showModal moves no focus; a browser does. Move it in, so the
  // return below can fail.
  screen.getByRole("button", { name: "Close" }).focus();
  expect(document.activeElement).not.toBe(opener);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(opener);
}

describe("Split · cut mode", () => {
  it("shows page 2 large and leaves its cut alone", async () => {
    const bytes = await pagesPdf(3);
    render(
      <SplitEditor
        pdf={{
          file: new File([bytes.slice()], "deck.pdf", {
            type: "application/pdf",
          }),
          bytes,
          pageCount: 3,
          rotations: [0, 0, 0],
          digitalSignatures: countDigitalSignatures(bytes),
        }}
        onReset={() => {}}
      />,
    );
    const cut = await screen.findByRole("button", { name: cutAfterLabel(2) });
    const before = cut.getAttribute("aria-pressed");
    const box = screen.getByRole("textbox", {
      name: /page ranges/i,
    }) as HTMLInputElement;
    const typed = box.value;
    const opener = await screen.findByRole("button", { name: zoomLabel(2) });
    const { width } = await openZoom(opener, "Page 2 of 3");
    expect(width).toBe(zoomWidth(102, 200));
    await closeBack(opener);
    expect(cut).toHaveAttribute("aria-pressed", before!);
    expect(box.value).toBe(typed);
    // The last page has no cut, and still has the enlarge button.
    expect(
      screen.getByRole("button", { name: zoomLabel(3) }),
    ).toBeInTheDocument();
  }, 30_000);
});

// Review of PR zoom, 2026-11-17: the last page's button was tabIndex -1 at
// every stop, because the grid's stop is capped at the last CUT and the last
// page has none. A keyboard user could not reach page 3's enlarge button.
describe("Split · cut mode keyboard", () => {
  it("lets Tab reach the last page's enlarge button from the last cut", async () => {
    const bytes = await pagesPdf(3);
    render(
      <SplitEditor
        pdf={{
          file: new File([bytes.slice()], "deck.pdf", {
            type: "application/pdf",
          }),
          bytes,
          pageCount: 3,
          rotations: [0, 0, 0],
          digitalSignatures: countDigitalSignatures(bytes),
        }}
        onReset={() => {}}
      />,
    );
    const last = await screen.findByRole("button", { name: zoomLabel(3) });
    const tabStops = () =>
      [1, 2, 3].map(
        (n) => screen.getByRole("button", { name: zoomLabel(n) }).tabIndex,
      );
    // The stop starts on page 1: only page 1's button is a Tab stop.
    expect(tabStops()).toEqual([0, -1, -1]);
    screen.getByRole("button", { name: cutAfterLabel(2) }).focus();
    // The last cut holds the stop: its page's button and the last page's.
    await waitFor(() => expect(tabStops()).toEqual([-1, 0, 0]));
    // Focus on the last page's button keeps the stop where it was.
    last.focus();
    await waitFor(() => expect(tabStops()).toEqual([-1, 0, 0]));
  }, 30_000);
});

describe("PDF to PNG · select mode", () => {
  it("shows the page large and does not toggle the tile", async () => {
    const { container } = render(
      withAppRouter(<PdfToImageRunner slug="pdf-to-png" />),
    );
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: {
        files: [
          new File([(await pagesPdf(3)).slice()], "deck.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    await screen.findByRole(
      "button",
      { name: /render 3 page/i },
      { timeout: 10_000 },
    );
    fireEvent.click(screen.getByRole("button", { name: /^select pages$/i }));
    const tile = await screen.findByRole(
      "button",
      { name: "Page 3" },
      { timeout: 10_000 },
    );
    const before = tile.getAttribute("aria-pressed");
    const opener = screen.getByRole("button", { name: zoomLabel(3) });
    const { width } = await openZoom(opener, "Page 3 of 3");
    expect(width).toBe(zoomWidth(103, 200));
    await closeBack(opener);
    expect(tile).toHaveAttribute("aria-pressed", before!);
  }, 30_000);
});

describe("Rotate · the page as it will come out", () => {
  it("draws a page turned by its pending rotation, and leaves selection alone", async () => {
    await mountTool("rotate-pdf", 3);
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate page 1 right" }),
    );
    const tile = screen.getByRole("button", { name: "Page 1" });
    const before = tile.getAttribute("aria-pressed");
    const opener = screen.getByRole("button", { name: zoomLabel(1) });
    const { dialog, width } = await openZoom(opener, "Page 1 of 3");
    // Turned a quarter: drawn 200 wide, not 101.
    expect(width).toBe(zoomWidth(200, 101));
    fireEvent.click(within(dialog).getByRole("button", { name: /next page/i }));
    const next = await screen.findByRole("dialog", { name: "Page 2 of 3" });
    const img = await within(next).findByRole(
      "img",
      { name: "Page 2" },
      { timeout: 10_000 },
    );
    await waitFor(() =>
      expect(widthOf.get(img.getAttribute("src") ?? "")).toBe(
        zoomWidth(102, 200),
      ),
    );
    fireEvent.click(
      within(next).getByRole("button", { name: /previous page/i }),
    );
    await screen.findByRole("dialog", { name: "Page 1 of 3" });
    await closeBack(opener);
    expect(tile).toHaveAttribute("aria-pressed", before!);
  }, 30_000);
});

describe("Organize · the new order", () => {
  it("walks the board's order and draws each page turned as its tile is", async () => {
    await mountTool("organize-pages", 3);
    fireEvent.click(screen.getByRole("button", { name: "Move page 1 right" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate page 1 right" }),
    );
    // Position 1 now holds page 2.
    const opener = screen.getByRole("button", { name: zoomLabel(2) });
    const { dialog, width } = await openZoom(opener, "Page 2, position 1 of 3");
    expect(width).toBe(zoomWidth(102, 200));
    fireEvent.click(within(dialog).getByRole("button", { name: /next page/i }));
    const next = await screen.findByRole("dialog", {
      name: "Page 1, position 2 of 3",
    });
    const img = await within(next).findByRole(
      "img",
      { name: "Page 1, position 2 of 3" },
      { timeout: 10_000 },
    );
    // Page 1, turned a quarter by the press above.
    await waitFor(() =>
      expect(widthOf.get(img.getAttribute("src") ?? "")).toBe(
        zoomWidth(200, 101),
      ),
    );
    await closeBack(opener);
    // The board did not move: page 2 still leads.
    expect(
      screen.getByRole("listitem", { name: "Page 2, position 1 of 3" }),
    ).toBeInTheDocument();
  }, 30_000);

  it("steps onto an inserted blank page and draws it as an empty sheet", async () => {
    await mountTool("organize-pages", 2);
    const insert = screen.getByRole("button", {
      name: "Insert blank page after page 1",
    });
    // The insert waits for the pages' sizes.
    await waitFor(() => expect(insert).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(insert);
    // A blank sheet has nothing to enlarge: no button of its own.
    expect(
      screen.queryAllByRole("button", { name: /^view .* larger$/i }),
    ).toHaveLength(2);
    const { dialog } = await openZoom(
      screen.getByRole("button", { name: zoomLabel(1) }),
      "Page 1, position 1 of 3",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /next page/i }));
    const blank = await screen.findByRole("dialog", {
      name: "Blank page, position 2 of 3",
    });
    expect(
      within(blank).getByRole("img", { name: "Blank page" }),
    ).toHaveAttribute("data-blank-sheet");
  }, 30_000);
});
