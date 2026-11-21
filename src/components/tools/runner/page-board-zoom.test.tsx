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
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
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
import { OWNER_OPENED_NOTE } from "./owner-password";
import {
  OWNER_PASSWORD_BUTTON,
  OWNER_PASSWORD_LABEL,
} from "@/lib/pdf/owner-password-copy";
import {
  AES256_BOTH_PASSWORDS_FIXTURE,
  GRANT_FIXTURE_TEXT,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";

/**
 * The timeout every wait in this file passes (CI-flake lane 3): its panels'
 * lazy chunks load cold per file in the native-canvas project, where waits have
 * outrun the 1 s default on CI (sign-runner's took 1855 ms in run 44931945692).
 *
 * CI: the slowest test here took 1118 ms (run 44331878323, "its pages are drawn
 * from the decrypted copy, interleave a…"; 19 passing runs, 11-18 to 11-21). A
 * wait cannot outlast its test, so 3 s is at least 2.7x any wait in it, and it
 * stays below the test's own timeout, so a wait that times out fails with its
 * DOM dump.
 */
const WAIT_MS = 3_000;

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
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), {
    timeout: WAIT_MS,
  });
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
    const cut = await screen.findByRole(
      "button",
      { name: cutAfterLabel(2) },
      { timeout: WAIT_MS },
    );
    const before = cut.getAttribute("aria-pressed");
    const box = screen.getByRole("textbox", {
      name: /page ranges/i,
    }) as HTMLInputElement;
    const typed = box.value;
    const opener = await screen.findByRole(
      "button",
      { name: zoomLabel(2) },
      { timeout: WAIT_MS },
    );
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
    const last = await screen.findByRole(
      "button",
      { name: zoomLabel(3) },
      { timeout: WAIT_MS },
    );
    const tabStops = () =>
      [1, 2, 3].map(
        (n) => screen.getByRole("button", { name: zoomLabel(n) }).tabIndex,
      );
    // The stop starts on page 1: only page 1's button is a Tab stop.
    expect(tabStops()).toEqual([0, -1, -1]);
    screen.getByRole("button", { name: cutAfterLabel(2) }).focus();
    // The last cut holds the stop: its page's button and the last page's.
    await waitFor(() => expect(tabStops()).toEqual([-1, 0, 0]), {
      timeout: WAIT_MS,
    });
    // Focus on the last page's button keeps the stop where it was.
    last.focus();
    await waitFor(() => expect(tabStops()).toEqual([-1, 0, 0]), {
      timeout: WAIT_MS,
    });
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
    const next = await screen.findByRole(
      "dialog",
      { name: "Page 2 of 3" },
      { timeout: WAIT_MS },
    );
    const img = await within(next).findByRole(
      "img",
      { name: "Page 2" },
      { timeout: 10_000 },
    );
    await waitFor(
      () =>
        expect(widthOf.get(img.getAttribute("src") ?? "")).toBe(
          zoomWidth(102, 200),
        ),
      { timeout: WAIT_MS },
    );
    fireEvent.click(
      within(next).getByRole("button", { name: /previous page/i }),
    );
    await screen.findByRole(
      "dialog",
      { name: "Page 1 of 3" },
      { timeout: WAIT_MS },
    );
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
    const next = await screen.findByRole(
      "dialog",
      {
        name: "Page 1, position 2 of 3",
      },
      { timeout: WAIT_MS },
    );
    const img = await within(next).findByRole(
      "img",
      { name: "Page 1, position 2 of 3" },
      { timeout: 10_000 },
    );
    // Page 1, turned a quarter by the press above.
    await waitFor(
      () =>
        expect(widthOf.get(img.getAttribute("src") ?? "")).toBe(
          zoomWidth(200, 101),
        ),
      { timeout: WAIT_MS },
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
    await waitFor(() => expect(insert).not.toHaveAttribute("aria-disabled"), {
      timeout: WAIT_MS,
    });
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
    const blank = await screen.findByRole(
      "dialog",
      {
        name: "Blank page, position 2 of 3",
      },
      { timeout: WAIT_MS },
    );
    expect(
      within(blank).getByRole("img", { name: "Blank page" }),
    ).toHaveAttribute("data-blank-sheet");
  }, 30_000);
});

describe("Merge PDF, Arrange pages across files", () => {
  it("walks the grid's order across files, each page drawn from its own file and turned as its tile is", async () => {
    const kind = getRunnerKind("merge-pdf");
    expect(kind, "the registry no longer maps merge-pdf").toBeTruthy();
    const { container } = render(
      withAppRouter(<ToolRunner kind={kind!} slug="merge-pdf" />),
    );
    await runnerMounted(container);
    const beta = await PDFDocument.create();
    for (const w of [201, 202]) beta.addPage([w, 200]);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: {
        files: [
          new File([(await pagesPdf(2)).slice()], "alpha.pdf", {
            type: "application/pdf",
          }),
          new File([(await beta.save()).slice()], "beta.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    await screen.findAllByText("beta.pdf", {}, { timeout: WAIT_MS });
    fireEvent.click(screen.getByRole("radio", { name: "Arrange pages" }));
    await screen.findByRole(
      "list",
      { name: /^Pages of every file/ },
      { timeout: 10_000 },
    );
    // a1 a2 b1 b2 -> a1 b1 a2 b2, and b1 turned a quarter.
    fireEvent.click(
      screen.getByRole("button", { name: "Move page 1 of beta.pdf earlier" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate page 1 of beta.pdf right" }),
    );
    const opener = screen.getByRole("button", { name: zoomLabel(2) });
    const { dialog, width } = await openZoom(
      opener,
      "Page 1 of beta.pdf, page 2 of 4 in the merged PDF",
    );
    // beta's page 1 (201 x 200), turned: drawn as wide as it was tall.
    expect(width).toBe(zoomWidth(200, 201));
    fireEvent.click(within(dialog).getByRole("button", { name: /next page/i }));
    const next = await screen.findByRole(
      "dialog",
      {
        name: "Page 2 of alpha.pdf, page 3 of 4 in the merged PDF",
      },
      { timeout: WAIT_MS },
    );
    const img = await within(next).findByRole(
      "img",
      { name: "Page 2 of alpha.pdf, page 3 of 4 in the merged PDF" },
      { timeout: 10_000 },
    );
    // alpha's page 2 (102 wide), from alpha's bytes, not beta's.
    await waitFor(
      () =>
        expect(widthOf.get(img.getAttribute("src") ?? "")).toBe(
          zoomWidth(102, 200),
        ),
      { timeout: WAIT_MS },
    );
    await closeBack(opener);
    // The grid did not move.
    expect(
      screen.getByRole("listitem", {
        name: /^Page 1 of beta\.pdf, page 2 of 4/,
      }),
    ).toBeInTheDocument();
  }, 30_000);

  // Re-review of 2026-11-17: once a page was left out, the dialog counted
  // every slot ("position 4 of 6") while the tile and the merged PDF counted
  // kept pages ("page 3 of 5"), and a left-out page's dialog never said so.
  // The relationship is pinned, not the string: the dialog's name IS the
  // tile's name, for every tile, left out or kept.
  it("names each page as its tile does, a left-out page included", async () => {
    const kind = getRunnerKind("merge-pdf");
    expect(kind, "the registry no longer maps merge-pdf").toBeTruthy();
    const { container } = render(
      withAppRouter(<ToolRunner kind={kind!} slug="merge-pdf" />),
    );
    await runnerMounted(container);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: {
        files: [
          new File([(await pagesPdf(3)).slice()], "alpha.pdf", {
            type: "application/pdf",
          }),
          new File([(await pagesPdf(2)).slice()], "beta.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    await screen.findAllByText("beta.pdf", {}, { timeout: WAIT_MS });
    fireEvent.click(screen.getByRole("radio", { name: "Arrange pages" }));
    const grid = await screen.findByRole(
      "list",
      { name: /^Pages of every file/ },
      { timeout: 10_000 },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Leave out page 2 of alpha\.pdf/ }),
    );
    const tiles = within(grid).getAllByRole("listitem");
    const names = tiles.map((t) => t.getAttribute("aria-label") ?? "");
    // Health check: five tiles, one of them left out, so the counts differ.
    expect(names).toHaveLength(5);
    expect(names[1]).toBe("Page 2 of alpha.pdf, left out");
    expect(names[2]).toBe("Page 3 of alpha.pdf, page 2 of 4 in the merged PDF");
    for (const [i, name] of names.entries()) {
      const opener = within(tiles[i]!).getByRole("button", {
        name: zoomLabel(i + 1),
      });
      await openZoom(opener, name);
      await closeBack(opener);
    }
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 *  The seam of #357 (owner password in the browser) and Arrange pages,
 *  merged 2026-11-17. Each was proven alone: #357 that an owner-opened
 *  file merges, this branch that the grid merges what it shows. Neither
 *  ever saw the other. The file here needs BOTH passwords, so the
 *  encrypted bytes do not open in pdf.js without one: a page drawn from
 *  them would be no image at all, and only the decrypted copy (what the
 *  adopt path hands the list) can be drawn, interleaved, turned and merged.
 * ------------------------------------------------------------------ */
describe("Merge PDF, an owner-opened file in Arrange pages", () => {
  /** Whether a page of the saved file carries an image (grant-base page 1). */
  function hasPicture(doc: PDFDocument, index: number): boolean {
    const resources = doc.getPage(index).node.Resources();
    const xobjects = resources?.lookup(PDFName.of("XObject"));
    return xobjects instanceof PDFDict && xobjects.keys().length > 0;
  }

  it("its pages are drawn from the decrypted copy, interleave and turn, and the merged PDF has them in that order with no encryption", async () => {
    const fixture = AES256_BOTH_PASSWORDS_FIXTURE;
    const kind = getRunnerKind("merge-pdf");
    expect(kind, "the registry no longer maps merge-pdf").toBeTruthy();
    const { container } = render(
      withAppRouter(<ToolRunner kind={kind!} slug="merge-pdf" />),
    );
    await runnerMounted(container);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: {
        files: [
          new File([(await pagesPdf(2)).slice()], "alpha.pdf", {
            type: "application/pdf",
          }),
          new File([readRestrictedFixture(fixture.file).slice()], "both.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    const field = await screen.findByLabelText(
      OWNER_PASSWORD_LABEL,
      {},
      { timeout: 15_000 },
    );
    fireEvent.change(field, { target: { value: fixture.owner } });
    fireEvent.click(
      screen.getByRole("button", { name: OWNER_PASSWORD_BUTTON }),
    );
    await screen.findByText(
      OWNER_OPENED_NOTE["merge-pdf"],
      {},
      { timeout: 15_000 },
    );
    // It is a row of the list now, not a refusal.
    await screen.findByRole(
      "listitem",
      {
        name: /^both\.pdf, file 2 of 2, 2 pages/,
      },
      { timeout: WAIT_MS },
    );
    expect(screen.queryByLabelText(OWNER_PASSWORD_LABEL)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Arrange pages" }));
    const grid = await screen.findByRole(
      "list",
      { name: /^Pages of every file/ },
      { timeout: 10_000 },
    );
    // Health check: both files' pages are in the grid, the opened file's too.
    expect(within(grid).getAllByRole("listitem")).toHaveLength(4);
    // a1 a2 b1 b2 -> a1 b1 a2 b2, and b1 turned a quarter.
    fireEvent.click(
      screen.getByRole("button", { name: "Move page 1 of both.pdf earlier" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rotate page 1 of both.pdf right" }),
    );
    const opener = screen.getByRole("button", { name: zoomLabel(2) });
    const { width } = await openZoom(
      opener,
      "Page 1 of both.pdf, page 2 of 4 in the merged PDF",
    );
    // A 612 x 792 page, from the decrypted bytes, turned: drawn landscape.
    expect(width).toBe(zoomWidth(792, 612));
    await closeBack(opener);

    const merge = screen.getByRole("button", { name: /^merge/i });
    await waitFor(() => expect(merge).toBeEnabled(), { timeout: WAIT_MS });
    fireEvent.click(merge);
    const download = await screen.findByRole(
      "button",
      { name: /download merged pdf/i },
      { timeout: 15_000 },
    );
    fireEvent.click(download);
    expect(downloads, "the Download button handed over no Blob").toHaveLength(
      1,
    );
    const out = new Uint8Array(await downloads[0]!.arrayBuffer());
    // pdf-lib refuses any /Encrypt: loading it proves there is none.
    const doc = await PDFDocument.load(out);
    expect(
      doc
        .getPages()
        .map((p) => [Math.round(p.getSize().width), p.getRotation().angle]),
    ).toEqual([
      [101, 0],
      [612, 90],
      [102, 0],
      [612, 0],
    ]);
    // both.pdf's page 1 (the one with the picture) is second, its page 2 last.
    expect([0, 1, 2, 3].map((i) => hasPicture(doc, i))).toEqual([
      false,
      true,
      false,
      false,
    ]);
    // And its text decodes: the streams were decrypted, not copied as-is.
    const task = legacy.getDocument({ data: out.slice(), verbosity: 0 });
    const read = await task.promise;
    try {
      const texts: string[] = [];
      for (let n = 1; n <= read.numPages; n += 1) {
        const content = await (await read.getPage(n)).getTextContent();
        texts.push(
          content.items.map((i) => ("str" in i ? i.str : "")).join(""),
        );
      }
      // The fixture's page 1 draws the line alone, its page 2 adds "page 2".
      expect(texts).toEqual([
        "",
        GRANT_FIXTURE_TEXT,
        "",
        `${GRANT_FIXTURE_TEXT} page 2`,
      ]);
    } finally {
      await task.destroy();
    }
  }, 60_000);
});
