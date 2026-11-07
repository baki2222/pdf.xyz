// @vitest-environment jsdom
// @native-canvas
/**
 * Audit remove-pages#3 (2026-11-06): Delete Pages' board showed small
 * thumbnails only, with no way to enlarge one — while its own use cases are
 * dropping the blank backs of a duplex scan and a page scanned twice, which
 * is exactly where a small thumbnail misleads.
 *
 * Each tile now has "View page N larger": a dialog with the page rendered
 * afresh at ZOOM_WIDTH, Previous page / Next page to compare neighbours, and
 * the tile's own selection toggle. Driven the way a visitor drives it —
 * ToolRunner, a real File, the dialog, Delete, Download PDF — and judged on
 * the size of the image the dialog draws and the pages of the download.
 *
 * WHAT IS STUBBED: pdfjs is its legacy build (jsdom lacks DOMMatrix);
 * `render` resolves without painting and `toBlob` encodes nothing but
 * remembers the canvas width it was handed, so a URL says how wide the page
 * it shows was rendered — the thumbnail path's own sizing, not a guess.
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
import { withAppRouter } from "@/tests/app-router";
import { runnerMounted } from "@/tests/runner-mounted";
import { ToolRunner } from "./tool-runner";
import { ZOOM_WIDTH } from "./page-zoom-dialog";
import {
  THUMBNAIL_TARGET_WIDTH,
  renderDimensions,
} from "@/lib/pdf/render-utils";
import { zoomLabel } from "./page-select-runner";

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

async function mount(count: number) {
  const kind = getRunnerKind("remove-pages");
  expect(kind, "the registry no longer maps remove-pages").toBeTruthy();
  const { container } = render(
    withAppRouter(<ToolRunner kind={kind!} slug="remove-pages" />),
  );
  await runnerMounted(container);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  fireEvent.change(input!, {
    target: {
      files: [
        new File([(await pagesPdf(count)).slice()], "scan.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  await screen.findByRole(
    "button",
    { name: /^select all$/i },
    { timeout: 10_000 },
  );
}

describe("Delete Pages · view a page larger", () => {
  it("every tile offers it, named for its page", async () => {
    await mount(3);
    for (const n of [1, 2, 3]) {
      expect(
        screen.getByRole("button", { name: zoomLabel(n) }),
      ).toBeInTheDocument();
    }
  }, 30_000);

  it("opens the page large, steps to its neighbours, and closes back to the board", async () => {
    await mount(3);
    const opener = screen.getByRole("button", { name: zoomLabel(2) });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole(
      "dialog",
      { name: "Page 2 of 3" },
      { timeout: 10_000 },
    );
    const img = await within(dialog).findByRole(
      "img",
      { name: "Page 2" },
      { timeout: 10_000 },
    );
    // Rendered for the dialog, not the board's thumbnail blown up.
    const rendered = widthOf.get(img.getAttribute("src") ?? "");
    expect(rendered, "the dialog's image came from the page renderer").toBe(
      renderDimensions(102, 200, ZOOM_WIDTH, 2).width,
    );
    // Well past what the board's tiles are drawn at.
    expect(rendered!).toBeGreaterThan(THUMBNAIL_TARGET_WIDTH * 2);
    fireEvent.click(within(dialog).getByRole("button", { name: /next page/i }));
    expect(
      await screen.findByRole("dialog", { name: "Page 3 of 3" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(
      await screen.findByRole("dialog", { name: "Page 2 of 3" }),
    ).toBeInTheDocument();
    // jsdom's showModal moves no focus, so without this the opener would
    // never lose focus and the restore below could not fail (review of
    // 340419bb: removing the restore line left this test green). A browser
    // puts focus inside the dialog; do the same, then prove it left.
    const inside = screen.getByRole("button", { name: /close/i });
    inside.focus();
    expect(screen.getByRole("dialog")).toContainElement(
      document.activeElement as HTMLElement,
    );
    expect(document.activeElement).not.toBe(opener);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  }, 30_000);

  it("its toggle selects the page on the board, and Delete removes it", async () => {
    await mount(3);
    fireEvent.click(screen.getByRole("button", { name: zoomLabel(3) }));
    const dialog = await screen.findByRole(
      "dialog",
      { name: "Page 3 of 3" },
      { timeout: 10_000 },
    );
    const toggle = within(dialog).getByRole("button", {
      name: "Select page 3",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Page 3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: /^delete 1 page$/i }));
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: /^download pdf$/i },
        { timeout: 10_000 },
      ),
    );
    await waitFor(() => expect(downloads).toHaveLength(1));
    const out = await PDFDocument.load(
      new Uint8Array(await downloads[0]!.arrayBuffer()),
    );
    expect(out.getPages().map((p) => Math.round(p.getWidth()) - 100)).toEqual([
      1, 2,
    ]);
  }, 30_000);
});

describe("Delete Pages · the page says what the board does", () => {
  it("names the enlarge button and the dialog's controls", async () => {
    const { default: content } =
      await import("@/lib/tools/content/remove-pages");
    const text = content.useCases.map((u) => u.body).join(" ");
    expect(text).toMatch(/enlarge button in a tile's (top )?corner/);
    expect(text).toMatch(/Previous page and Next page/);
    expect(text).toMatch(/Select page to mark it/);
  });
});
