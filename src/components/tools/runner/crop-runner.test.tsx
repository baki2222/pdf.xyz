// @vitest-environment jsdom
// @native-canvas
/**
 * The Crop PDF runner, driven the way a person drives it, and judged on the
 * file it hands them.
 *
 * The defect (audit 2026-09-27): switching Per side → Uniform only flipped a
 * flag. The four per-side values survived, hidden, so after "Left 150, then
 * Uniform" the slider read "All sides 24 pt" while the download lost 150 pt on
 * the left. Nothing caught it because no test rendered a runner: the engine's
 * own tests are right about whatever margins they are handed, and the e2e
 * proof never leaves Uniform.
 *
 * So the relationship pinned here is between two things a person sees — the
 * value on the Uniform control, and what each edge of the DOWNLOADED file lost
 * — not between the component and a mocked `cropPdf`. No module is mocked
 * (see `src/tests/mock-isolation.test.ts` for why that matters under
 * `isolate: false`); the app-router context `useRouter` needs is provided, and
 * the download is caught where the browser would receive it, at
 * `URL.createObjectURL`.
 */
import type { ReactNode } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { PDFDocument, degrees } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { NO_CROP, type CropMargins } from "@/lib/pdf/crop";
import { formatLength } from "@/lib/pdf/length-units";
import { dropSheetsLive } from "@/tests/drop-sheets-live";
import { CropRunner } from "./crop-runner";

/**
 * The timeout every wait in this file passes (CI-flake lane 3): its panels'
 * lazy chunks load cold per file in the native-canvas project, where waits have
 * outrun the 1 s default on CI (sign-runner's took 1855 ms in run 44931945692).
 *
 * CI: the slowest test here took 754 ms (run 44057329440, a passing run; 108 CI
 * runs, passing and failing, to 11-21). A wait cannot outlast its test, so 3 s
 * is at least 3.9x any wait in it, and it stays below the test's own timeout,
 * so a wait that times out fails with its DOM dump.
 */
const WAIT_MS = 3_000;

/** The edges a user can set, derived from the type's own zero value. */
const EDGES = Object.keys(NO_CROP) as (keyof CropMargins)[];

/** Capitalised as the runner labels its per-side sliders. */
const label = (edge: keyof CropMargins) =>
  edge.charAt(0).toUpperCase() + edge.slice(1);

const PAGE = { width: 400, height: 600 };

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};

function withRouter(children: ReactNode) {
  return (
    <AppRouterContext.Provider value={router as never}>
      {children}
    </AppRouterContext.Provider>
  );
}

async function samplePdf(
  rotation = 0,
  pages: [number, number][] = [[PAGE.width, PAGE.height]],
): Promise<File> {
  const doc = await PDFDocument.create();
  for (const size of pages) doc.addPage(size).setRotation(degrees(rotation));
  const bytes = await doc.save();
  return new File([bytes.slice().buffer as ArrayBuffer], "sample.pdf", {
    type: "application/pdf",
  });
}

/** Render the runner and load a one-page PDF into it by dropping it. */
async function openRunner(rotation = 0, pages?: [number, number][]) {
  const view = render(withRouter(<CropRunner />));
  await dropSheetsLive(view.container);
  const input = view.container.querySelector('input[type="file"]');
  expect(input, "the runner offers a file picker").not.toBeNull();
  fireEvent.drop(input!.closest("label")!, {
    dataTransfer: { files: [await samplePdf(rotation, pages)] },
  });
  await screen.findByRole(
    "radiogroup",
    { name: "Crop mode" },
    { timeout: WAIT_MS },
  );
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

function setSlider(name: string, value: number) {
  fireEvent.change(screen.getByLabelText(name), {
    target: { value: String(value) },
  });
}

function sliderValue(name: string): number {
  return Number((screen.getByLabelText(name) as HTMLInputElement).value);
}

/** Run the crop, click Download, and read back what each edge lost. */
async function cropAndDownload(): Promise<CropMargins> {
  const blobs: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:crop-runner-test";
  });
  // Plain writable stubs, put back exactly as found in afterEach: under
  // `isolate: false` the jsdom globals outlive this file, and a read-only stub
  // left behind broke browser.test.ts's own assignment on the first run.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  // jsdom logs "navigation not implemented" for an anchor click; silence it.
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});

  fireEvent.click(screen.getByRole("button", { name: /^crop pdf$/i }));
  const download = await screen.findByRole(
    "button",
    { name: /download cropped pdf/i },
    { timeout: 5000 },
  );
  fireEvent.click(download);
  await waitFor(() => expect(blobs).toHaveLength(1), { timeout: WAIT_MS });
  click.mockRestore();

  const out = await PDFDocument.load(
    new Uint8Array(await blobs[0]!.arrayBuffer()),
  );
  const box = out.getPage(0).getCropBox();
  return {
    left: box.x,
    bottom: box.y,
    right: PAGE.width - (box.x + box.width),
    top: PAGE.height - (box.y + box.height),
  };
}

const URL_STATICS = ["createObjectURL", "revokeObjectURL"] as const;
const ORIGINAL_URL_STATICS = URL_STATICS.map(
  (key) => [key, Object.getOwnPropertyDescriptor(URL, key)] as const,
);

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, descriptor] of ORIGINAL_URL_STATICS) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else Reflect.deleteProperty(URL, key);
  }
});

describe("CropRunner mode switch", () => {
  it("positive control: Per side values reach the download unequal", async () => {
    // Without this, a harness that could only ever observe four equal margins
    // would pass the Uniform test below for the wrong reason.
    await openRunner();
    chooseMode("Per side");
    setSlider("Left", 150);
    const shown = Object.fromEntries(
      EDGES.map((edge) => [edge, sliderValue(label(edge))]),
    ) as unknown as CropMargins;
    expect(new Set(Object.values(shown)).size).toBeGreaterThan(1);

    const lost = await cropAndDownload();
    for (const edge of EDGES) {
      expect(lost[edge], `${edge} lost what its slider shows`).toBeCloseTo(
        shown[edge],
        6,
      );
    }
  }, 20_000);

  it("back to Uniform: every edge of the download loses what 'All sides' shows", async () => {
    await openRunner();
    chooseMode("Per side");
    setSlider("Left", 150);
    chooseMode("Uniform");

    const allSides = sliderValue("All sides");
    const lost = await cropAndDownload();
    for (const edge of EDGES) {
      expect(
        lost[edge],
        `Uniform reads "All sides ${allSides} pt" but the ${edge} lost ${lost[edge]} pt`,
      ).toBeCloseTo(allSides, 6);
    }
  }, 20_000);

  it("the preview has the shape the reader sees: a /Rotate 90 portrait page is drawn landscape", async () => {
    // The composed chain behind the preview: getPageSizes → the schematic's
    // aspect ratio and inset percentages. On a /Rotate 90 page the reader sees
    // a page 600 wide and 400 tall (pdfjs confirms that shape in crop.test.ts).
    const view = await openRunner(90);
    chooseMode("Per side");
    setSlider("Top", 100);
    const frame = await waitFor(
      () => {
        const el = view.container.querySelector<HTMLElement>(
          '[style*="aspect-ratio"]',
        );
        expect(el, "the preview has rendered").not.toBeNull();
        return el!;
      },
      { timeout: WAIT_MS },
    );
    const [w, h] = frame.style.aspectRatio.split("/").map(Number);
    expect(w! / h!, "a landscape preview").toBeCloseTo(600 / 400, 6);
    // The Top inset is a share of the DISPLAYED height: 100 of 400 pt.
    const inset = frame.querySelector<HTMLElement>("span")!;
    expect(parseFloat(inset.style.top)).toBeCloseTo(25, 6);
  });
});

/** Two pages: ink with known margins on page 1, nothing at all on page 2. */
async function inkedAndBlankPdf(): Promise<File> {
  const doc = await PDFDocument.create();
  doc
    .addPage([PAGE.width, PAGE.height])
    .drawRectangle({ x: 80, y: 150, width: 200, height: 300 });
  doc.addPage([PAGE.width, PAGE.height]);
  const bytes = await doc.save();
  return new File([bytes.slice().buffer as ArrayBuffer], "inked.pdf", {
    type: "application/pdf",
  });
}

/** Read every page's crop box back as the margins it lost. */
async function lostPerPage(blob: Blob): Promise<CropMargins[]> {
  const out = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  return out.getPages().map((page) => {
    const box = page.getCropBox();
    return {
      left: box.x,
      bottom: box.y,
      right: PAGE.width - (box.x + box.width),
      top: PAGE.height - (box.y + box.height),
    };
  });
}

describe("CropRunner Auto: the whole chain, pdf.js render to downloaded file", () => {
  it("finds the white around the ink, names the blank page, and leaves it uncropped", async () => {
    const view = render(withRouter(<CropRunner />));
    await dropSheetsLive(view.container);
    const input = view.container.querySelector('input[type="file"]');
    fireEvent.drop(input!.closest("label")!, {
      dataTransfer: { files: [await inkedAndBlankPdf()] },
    });
    await screen.findByRole(
      "radiogroup",
      { name: "Crop mode" },
      { timeout: WAIT_MS },
    );
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Crop mode" })).getByRole(
        "radio",
        { name: "Auto" },
      ),
    );
    // Nothing found yet, so nothing to crop.
    expect(screen.getByRole("button", { name: /^crop pdf$/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(
      screen.getByRole("button", { name: /find white margins/i }),
    );
    await screen.findByText(
      /found the content on 1 of 2 pages/i,
      {},
      { timeout: 15_000 },
    );
    expect(
      screen.getByText(/page 2 looks blank and is left uncropped/i),
    ).toBeTruthy();

    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob: Blob) => {
        if (blob.type === "application/pdf") blobs.push(blob);
        return "blob:crop-runner-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /^crop pdf$/i }));
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: /download cropped pdf/i },
        { timeout: 5000 },
      ),
    );
    expect(screen.getByText(/cropped 1 page ·/i)).toBeTruthy();
    await waitFor(() => expect(blobs).toHaveLength(1), { timeout: WAIT_MS });
    const [first, second] = await lostPerPage(blobs[0]!);
    // The ink sits 80 pt from the left, 120 from the right, 150 from the
    // top and bottom. The crop stays outside it and takes most of the white.
    const known = { left: 80, right: 120, top: 150, bottom: 150 };
    for (const edge of EDGES) {
      expect(first![edge], edge).toBeLessThan(known[edge]);
      expect(first![edge], edge).toBeGreaterThan(known[edge] * 0.8);
    }
    expect(second, "the blank page keeps its whole area").toEqual(NO_CROP);
  }, 30_000);
});

describe("CropRunner units", () => {
  it("a margin typed in mm reaches the file in points; pt stays the default", async () => {
    await openRunner();
    const units = () => screen.getByRole("radiogroup", { name: "Units" });
    // The default is unchanged: points, and 24 on every side.
    expect(within(units()).getByRole("radio", { name: "pt" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(sliderValue("All sides")).toBe(24);
    fireEvent.click(within(units()).getByRole("radio", { name: "mm" }));
    fireEvent.change(screen.getByLabelText("All sides in mm"), {
      target: { value: "25.4" },
    });
    expect(screen.getByText("25.4 mm")).toBeTruthy();
    const lost = await cropAndDownload();
    for (const edge of EDGES) expect(lost[edge], edge).toBeCloseTo(72, 6);
  }, 20_000);
});

/**
 * Audit crop-pdf#3 (2026-11-22): every edge stopped at a fixed 300 pt, so a
 * 395 pt right margin on A4 took two runs ("crop the downloaded copy
 * again"). Each edge's most is now the page's own: its displayed size, less
 * the opposite margin, less the smallest strip a page may keep.
 */
describe("CropRunner limits come from the page", () => {
  const A4: [number, number] = [595.28, 841.89];

  /** Wait until the page sizes are read: the limits come from them. */
  const sizesRead = () =>
    waitFor(() =>
      expect(document.querySelector("[data-crop-sheet]")).not.toBeNull(),
    );

  /** The downloaded page 1's CropBox. */
  async function croppedBox() {
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob: Blob) => {
        blobs.push(blob);
        return "blob:crop-runner-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /^crop pdf$/i }));
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: /download cropped pdf/i },
        { timeout: 5000 },
      ),
    );
    await waitFor(() => expect(blobs).toHaveLength(1));
    const out = await PDFDocument.load(
      new Uint8Array(await blobs[0]!.arrayBuffer()),
    );
    return out.getPage(0).getCropBox();
  }

  it("crops 395 pt off the right of an A4 page in one run", async () => {
    await openRunner(0, [A4]);
    await sizesRead();
    chooseMode("Per side");
    setSlider("Right", 395);
    expect(sliderValue("Right")).toBe(395);
    const left = sliderValue("Left");
    expect(left).toBe(24);
    const box = await croppedBox();
    expect(box.x).toBeCloseTo(left, 6);
    expect(box.width).toBeCloseTo(A4[0] - 395 - left, 6);
  });

  // Named "is refused before the run" until the review of lane w1a
  // (2026-11-28): it typed 600 and asserted the clamp, while nothing told the
  // person their number had been replaced. It is held at the most, and the
  // field now says so and why.
  it("positive control: a margin typed past the page's own limit is held at the limit, and the field says why", async () => {
    await openRunner(0, [A4]);
    await sizesRead();
    chooseMode("Per side");
    // The most the right edge can take: the width, less the left margin
    // (24), less the smallest strip a page keeps (24).
    const most = A4[0] - 24 - 24;
    // Control: no note before anything is typed past it.
    expect(screen.queryByText(/is more than Right can take/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Right in pt"), {
      target: { value: "600" },
    });
    expect(screen.getByLabelText("Right")).toHaveAttribute("max", String(most));
    const note = screen.getByText(/is more than Right can take/);
    // Said politely to a screen reader too.
    expect(note).toHaveAttribute("role", "status");
    expect(note).toHaveTextContent(
      `600 pt is more than Right can take, so it is set to ${formatLength(most, "pt")}.`,
    );
    // One page: the reason is the page's own size, not another page.
    expect(note).not.toHaveTextContent(/choose pages/i);
    const box = await croppedBox();
    // Clamped to the most, not taken: the page keeps its smallest strip.
    expect(box.width).toBeCloseTo(24, 6);
  });

  it("a margin typed past what a smaller page allows names that page and says how to go deeper", async () => {
    // Page 1 is A4; page 2 is A5 (419.53 wide), which sets every edge's most.
    await openRunner(0, [A4, [419.53, 595.28]]);
    await sizesRead();
    chooseMode("Per side");
    const most = Math.floor((419.53 - 24 - 24) * 100) / 100;
    fireEvent.change(screen.getByLabelText("Right in pt"), {
      target: { value: "395" },
    });
    expect(sliderValue("Right")).toBe(most);
    const note = screen.getByText(/is more than Right can take/);
    expect(note).toHaveTextContent(
      `395 pt is more than Right can take, so it is set to ${formatLength(most, "pt")}.`,
    );
    expect(note).toHaveTextContent(/page 2/i);
    expect(note).toHaveTextContent(/choose pages/i);
    // A value inside the limit takes the note away.
    fireEvent.change(screen.getByLabelText("Right in pt"), {
      target: { value: "100" },
    });
    expect(screen.queryByText(/is more than Right can take/)).toBeNull();
  });

  it("a margin one page in scope cannot take stops the run and names that page", async () => {
    // Page 1 is A4; page 2 is 200 pt wide. 395 pt fits page 1 alone.
    await openRunner(0, [A4, [200, 300]]);
    await sizesRead();
    chooseMode("Per side");
    const scope = screen.getByRole("radiogroup", { name: "Page scope" });
    fireEvent.click(
      within(scope).getByRole("radio", { name: "Selected pages" }),
    );
    fireEvent.change(screen.getByLabelText("Pages"), {
      target: { value: "1" },
    });
    setSlider("Right", 395);
    expect(sliderValue("Right")).toBe(395);
    const run = screen.getByRole("button", { name: /^crop pdf$/i });
    // The Run button blocks with aria-disabled (it stays focusable).
    expect(run).not.toHaveAttribute("aria-disabled");
    // Back to every page: page 2 is too narrow for 395 pt.
    fireEvent.click(within(scope).getByRole("radio", { name: "All pages" }));
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/page 2/i);
  });
});
