// @vitest-environment jsdom
// @native-canvas
/**
 * Audit crop-pdf#1 (2026-11-06): in Uniform and Per side the Crop preview was
 * an empty outline with a dashed box — the page itself was drawn only in Auto
 * — so a person trimming a scanner border set point values blind. Every
 * competitor crops ON the rendered page.
 *
 * Now the page is drawn under the box in every mode, and the box's four edges
 * are handles: drag one (or focus it and use the arrow keys) and the margin
 * moves with it. Judged on what the person gets: the image under the box, and
 * the CropBox of the file the Download button saves.
 *
 * WHAT IS STUBBED: pdfjs is its legacy build (the browser build needs
 * DOMMatrix, which jsdom lacks); `render` resolves without painting (jsdom
 * has no 2D context) and `toBlob` hands back a small PNG, so the thumbnail
 * path runs end to end and yields an object URL. The preview's on-screen
 * size is set with `getBoundingClientRect`, since jsdom lays nothing out.
 */
import type { ReactNode } from "react";
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
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument } from "pdf-lib";
import type { CropMargins } from "@/lib/pdf/crop";
import { dropSheetsLive } from "@/tests/drop-sheets-live";
import { CropRunner } from "./crop-runner";

vi.mock("pdfjs-dist", async () => import("pdfjs-dist/legacy/build/pdf.mjs"));

const PAGE = { width: 400, height: 600 };
/** The preview's on-screen size: half the page, so 1 px = 2 pt. */
const SHOWN = { width: 200, height: 300 };
const START = 24;

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

type Legacy = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let legacy: Legacy;
let savedWorkerSrc: string;
let pageProto: { render: (...args: unknown[]) => unknown };
let blobs: Blob[];

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

const ORIGINAL = (["createObjectURL", "revokeObjectURL"] as const).map(
  (key) => [key, Object.getOwnPropertyDescriptor(URL, key)] as const,
);

beforeEach(() => {
  blobs = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      blobs.push(blob);
      return `blob:crop-visual/${blobs.length}`;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(pageProto, "render").mockImplementation(() => ({
    promise: Promise.resolve(),
    cancel: () => {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    done: BlobCallback,
  ) {
    done(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const [key, descriptor] of ORIGINAL) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else Reflect.deleteProperty(URL, key);
  }
});

function withRouter(children: ReactNode) {
  return (
    <AppRouterContext.Provider value={router as never}>
      {children}
    </AppRouterContext.Provider>
  );
}

async function openRunner() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE.width, PAGE.height]);
  const bytes = await doc.save();
  const view = render(withRouter(<CropRunner />));
  await dropSheetsLive(view.container);
  const input = view.container.querySelector('input[type="file"]');
  fireEvent.drop(input!.closest("label")!, {
    dataTransfer: {
      files: [
        new File([bytes.slice().buffer as ArrayBuffer], "sample.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  await screen.findByRole("radiogroup", { name: "Crop mode" });
  return view;
}

function chooseMode(name: "Uniform" | "Per side") {
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "Crop mode" })).getByRole(
      "radio",
      { name },
    ),
  );
}

/** The preview sheet, laid out at SHOWN for pointer maths. */
async function sheet(): Promise<HTMLElement> {
  const el = await waitFor(() => {
    const found = document.querySelector<HTMLElement>("[data-crop-sheet]");
    expect(found, "the preview sheet is drawn").not.toBeNull();
    return found!;
  });
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: SHOWN.width,
    height: SHOWN.height,
    right: SHOWN.width,
    bottom: SHOWN.height,
    toJSON: () => ({}),
  });
  return el;
}

function drag(name: string, dx: number, dy: number) {
  const handle = screen.getByRole("slider", { name });
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(handle, {
    pointerId: 1,
    clientX: 100 + dx,
    clientY: 100 + dy,
  });
  fireEvent.pointerUp(handle, { pointerId: 1 });
}

async function cropAndRead(): Promise<CropMargins> {
  const before = blobs.length;
  fireEvent.click(screen.getByRole("button", { name: /^crop pdf$/i }));
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: /download cropped pdf/i },
      { timeout: 5000 },
    ),
  );
  await waitFor(() => expect(blobs.length).toBeGreaterThan(before));
  const out = await PDFDocument.load(
    new Uint8Array(await blobs[blobs.length - 1]!.arrayBuffer()),
  );
  const box = out.getPage(0).getCropBox();
  return {
    left: box.x,
    bottom: box.y,
    right: PAGE.width - (box.x + box.width),
    top: PAGE.height - (box.y + box.height),
  };
}

describe("Crop PDF · crop on the rendered page", () => {
  it("draws the page under the box in Uniform and Per side, not only in Auto", async () => {
    await openRunner();
    const preview = await sheet();
    await waitFor(() => expect(preview.querySelector("img")).not.toBeNull(), {
      timeout: 5000,
    });
    chooseMode("Per side");
    expect((await sheet()).querySelector("img")).not.toBeNull();
  });

  it("dragging an edge in Per side moves that margin, and the download loses it", async () => {
    await openRunner();
    chooseMode("Per side");
    await sheet();
    await screen.findByRole("slider", { name: "Left edge" });
    drag("Left edge", 50, 0); // 50 px at 2 pt/px
    drag("Top edge", 0, 10);
    expect(screen.getByRole("slider", { name: "Left edge" })).toHaveAttribute(
      "aria-valuenow",
      String(START + 100),
    );
    const lost = await cropAndRead();
    expect(lost.left).toBeCloseTo(START + 100, 6);
    expect(lost.top).toBeCloseTo(START + 20, 6);
    expect(lost.right).toBeCloseTo(START, 6);
    expect(lost.bottom).toBeCloseTo(START, 6);
  });

  it("in Uniform an edge moves every side, as the one slider shows", async () => {
    await openRunner();
    await sheet();
    await screen.findByRole("slider", { name: "Right edge" });
    drag("Right edge", -15, 0); // inward: 30 pt
    const lost = await cropAndRead();
    for (const edge of ["top", "right", "bottom", "left"] as const) {
      expect(lost[edge], edge).toBeCloseTo(START + 30, 6);
    }
  });

  it("an edge is a slider: the arrow keys move it a point, Shift ten", async () => {
    await openRunner();
    chooseMode("Per side");
    const handle = await screen.findByRole("slider", { name: "Bottom edge" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(handle).toHaveAttribute("aria-valuenow", String(START + 1));
    fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true });
    expect(handle).toHaveAttribute("aria-valuenow", String(START - 9));
    expect((await cropAndRead()).bottom).toBeCloseTo(START - 9, 6);
  });

  // Review of 5e22e05b: ArrowUp/ArrowRight always ADDED margin, so on the top
  // edge ArrowDown moved the dashed line up and on the right edge ArrowRight
  // moved it left — the hint says "use the arrow keys" on an edge you can
  // see. Now each edge moves the way the arrow points on screen.
  it("the arrow keys move the top and right edges the way they point", async () => {
    await openRunner();
    chooseMode("Per side");
    const top = await screen.findByRole("slider", { name: "Top edge" });
    fireEvent.keyDown(top, { key: "ArrowDown" }); // down the page: inward
    fireEvent.keyDown(top, { key: "ArrowDown" });
    fireEvent.keyDown(top, { key: "ArrowUp" }); // back up: outward
    expect(top).toHaveAttribute("aria-valuenow", String(START + 1));
    const right = screen.getByRole("slider", { name: "Right edge" });
    fireEvent.keyDown(right, { key: "ArrowLeft", shiftKey: true }); // inward
    fireEvent.keyDown(right, { key: "ArrowRight" }); // outward
    expect(right).toHaveAttribute("aria-valuenow", String(START + 9));
    const left = screen.getByRole("slider", { name: "Left edge" });
    fireEvent.keyDown(left, { key: "ArrowRight" }); // inward
    const lost = await cropAndRead();
    expect(lost.top).toBeCloseTo(START + 1, 6);
    expect(lost.right).toBeCloseTo(START + 9, 6);
    expect(lost.left).toBeCloseTo(START + 1, 6);
    expect(lost.bottom).toBeCloseTo(START, 6);
  });
});

describe("Crop PDF · the page says what the preview does", () => {
  it("the steps quote the line under the preview", async () => {
    const { default: content } = await import("@/lib/tools/content/crop-pdf");
    const { EDGE_HINT } = await import("./crop-runner");
    const step = content.steps.find(
      (s) => s.title === "Check the preview and crop",
    );
    expect(step, "the step exists by its title").toBeDefined();
    expect(step!.body).toContain(EDGE_HINT);
    expect(step!.body).not.toMatch(/blank outline|does not show the page/);
  });
});
