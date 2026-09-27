// @vitest-environment jsdom
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
import { CropRunner } from "./crop-runner";

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

async function samplePdf(rotation = 0): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE.width, PAGE.height]).setRotation(degrees(rotation));
  const bytes = await doc.save();
  return new File([bytes.slice().buffer as ArrayBuffer], "sample.pdf", {
    type: "application/pdf",
  });
}

/** Render the runner and load a one-page PDF into it by dropping it. */
async function openRunner(rotation = 0) {
  const view = render(withRouter(<CropRunner />));
  const input = view.container.querySelector('input[type="file"]');
  expect(input, "the runner offers a file picker").not.toBeNull();
  fireEvent.drop(input!.closest("label")!, {
    dataTransfer: { files: [await samplePdf(rotation)] },
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
  await waitFor(() => expect(blobs).toHaveLength(1));
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
  });

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
  });

  it("the preview has the shape the reader sees: a /Rotate 90 portrait page is drawn landscape", async () => {
    // The composed chain behind the preview: getPageSizes → the schematic's
    // aspect ratio and inset percentages. On a /Rotate 90 page the reader sees
    // a page 600 wide and 400 tall (pdfjs confirms that shape in crop.test.ts).
    const view = await openRunner(90);
    chooseMode("Per side");
    setSlider("Top", 100);
    const frame = await waitFor(() => {
      const el = view.container.querySelector<HTMLElement>(
        '[style*="aspect-ratio"]',
      );
      expect(el, "the preview has rendered").not.toBeNull();
      return el!;
    });
    const [w, h] = frame.style.aspectRatio.split("/").map(Number);
    expect(w! / h!, "a landscape preview").toBeCloseTo(600 / 400, 6);
    // The Top inset is a share of the DISPLAYED height: 100 of 400 pt.
    const inset = frame.querySelector<HTMLElement>("span")!;
    expect(parseFloat(inset.style.top)).toBeCloseTo(25, 6);
  });
});
