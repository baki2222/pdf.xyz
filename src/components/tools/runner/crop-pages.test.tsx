// @vitest-environment jsdom
// @native-canvas
/**
 * Audit crop-pdf#2 (2026-11-06): outside Auto the Crop preview was pinned to
 * page 1 — even when Selected pages left page 1 out, or the page being
 * cropped was another size — and the only scopes were All and Selected, so a
 * book scan's rectos and versos meant typing "1, 3, 5, …".
 *
 * Now every mode steps through the pages (Previous page / Next page), a page
 * outside the chosen pages says so instead of showing a box it will not get,
 * and Odd pages / Even pages are scopes of their own. Judged on the preview's
 * own proportions and on the CropBox of every page of the download.
 *
 * Still open, and said on the page: one set of manual margins per run — a
 * page cannot have its own manual box (Auto's per-page boxes are the
 * exception).
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { dropSheetsLive } from "@/tests/drop-sheets-live";
import { CropRunner } from "./crop-runner";

/** Page 2 is landscape, so the preview's proportions name the page shown. */
const SIZES: [number, number][] = [
  [400, 600],
  [600, 400],
  [400, 600],
];
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

let blobs: Blob[];
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
      return `blob:crop-pages/${blobs.length}`;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
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
  for (const size of SIZES) doc.addPage(size);
  const bytes = await doc.save();
  const view = render(withRouter(<CropRunner />));
  await dropSheetsLive(view.container);
  const input = view.container.querySelector('input[type="file"]');
  fireEvent.drop(input!.closest("label")!, {
    dataTransfer: {
      files: [
        new File([bytes.slice().buffer as ArrayBuffer], "book.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  await screen.findByRole("radiogroup", { name: "Crop mode" });
}

function scope(name: string) {
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "Page scope" })).getByRole(
      "radio",
      { name },
    ),
  );
}

async function shownRatio(): Promise<string> {
  return waitFor(() => {
    const sheet = document.querySelector<HTMLElement>("[data-crop-sheet]");
    expect(sheet).not.toBeNull();
    return sheet!.style.aspectRatio.replace(/\s+/g, "");
  });
}

/** What each page of the download lost on its left edge. */
async function cropAndReadLeft(): Promise<number[]> {
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
  return out.getPages().map((p) => p.getCropBox().x);
}

describe("Crop PDF · every page in the preview", () => {
  it("steps through the pages in Uniform, each drawn in its own proportions", async () => {
    await openRunner();
    expect(await shownRatio()).toBe("400/600");
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(await shownRatio()).toBe("600/400");
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /previous page/i }));
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  it("a page outside the chosen pages shows no box and says why", async () => {
    await openRunner();
    scope("Selected pages");
    fireEvent.change(screen.getByLabelText("Pages"), {
      target: { value: "2" },
    });
    await shownRatio();
    expect(document.querySelector("[data-crop-box]")).toBeNull();
    expect(screen.getByText(/not one of the pages you chose/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() =>
      expect(document.querySelector("[data-crop-box]")).not.toBeNull(),
    );
  });
});

describe("Crop PDF · odd and even pages", () => {
  it("Even pages crops pages 2, 4, … and leaves the rest whole", async () => {
    await openRunner();
    scope("Even pages");
    // The preview moves to the first page that will be cropped.
    expect(await shownRatio()).toBe("600/400");
    expect(await cropAndReadLeft()).toEqual([0, START, 0]);
  });

  it("Odd pages crops pages 1, 3, …", async () => {
    await openRunner();
    scope("Odd pages");
    expect(await cropAndReadLeft()).toEqual([START, 0, START]);
  });
});

describe("Crop PDF · the page says what the preview does", () => {
  it("names the new scopes, the stepper and the out-of-scope note", async () => {
    const { default: content } = await import("@/lib/tools/content/crop-pdf");
    const steps = content.steps.map((s) => s.body).join(" ");
    expect(steps).toMatch(/Odd pages or Even pages/);
    expect(steps).toMatch(/Previous page and Next page step through them/);
    expect(steps).toMatch(/One set of margins applies to every page/);
    expect(steps).not.toMatch(/page 1 itself/);
    const { OUT_OF_SCOPE_NOTE } = await import("./crop-runner");
    expect(OUT_OF_SCOPE_NOTE).toMatch(/stays uncropped/);
    expect(steps).toMatch(/says it stays uncropped/);
  });
});
