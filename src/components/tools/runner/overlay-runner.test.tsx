// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { PDFDocument, rgb } from "pdf-lib";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { getRunnerKind } from "@/lib/pdf/registry";
import { OVERLAY_LAYERS } from "@/lib/pdf/overlay";
import { regionMean, renderPdfPages, type Rgb } from "@/tests/pdf-render";
import { getToolBySlug } from "@/lib/tools";
import { pageSteps, stepText } from "@/lib/tools/page-copy";
import { ToolRunner } from "./tool-runner";

/**
 * The overlay tool, driven the way a visitor drives it, with the verdict read
 * off the PIXELS of the bytes the Download button hands the browser.
 *
 * The engine test proves each layer paints what it should. This proves the
 * chain a user actually runs: the layer control reaches `overlayPdf`, the
 * result the panel describes is the result that was built, and the file that
 * downloads is the one the panel describes. A letterhead with an opaque white
 * sheet — a scan, a design-tool export — hid the entire letter under it,
 * because the tool could only draw on top; the fix is only real if the choice
 * survives the trip through the UI.
 *
 * No `vi.mock` (the suite shares one module cache); the browser seams are
 * stubbed on the globals and restored, as in `rotate-runner.test.tsx`.
 */

const SLUG = "overlay-pdf";

/** The steps the tool page serves (also its HowTo), title and text. */
function servedSteps(): string[] {
  const tool = getToolBySlug(SLUG);
  if (!tool) throw new Error(`${SLUG} is not in the catalogue`);
  return pageSteps(tool).map(stepText);
}

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

let downloads: Blob[] = [];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) downloads.push(obj);
    return `blob:overlay-runner-test/${downloads.length}`;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

/** A letter: a dark block in the middle of the page. */
async function letter(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawRectangle({
    x: 150,
    y: 250,
    width: 312,
    height: 292,
    color: rgb(0, 0, 0),
  });
  return doc.save();
}

/** A letterhead on an opaque white sheet, with a red band across the top. */
async function letterhead(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 612,
    height: 792,
    color: rgb(1, 1, 1),
  });
  page.drawRectangle({
    x: 0,
    y: 712,
    width: 612,
    height: 80,
    color: rgb(0.9, 0.1, 0.1),
  });
  return doc.save();
}

function pdfFile(bytes: Uint8Array, name: string) {
  return new File([bytes.slice()], name, { type: "application/pdf" });
}

/** Upload both PDFs, pick `layerLabel` (or leave the default), run, download. */
async function overlayThroughTheUi(
  layerLabel?: string,
): Promise<{ bytes: Uint8Array; summary: string }> {
  const kind = getRunnerKind(SLUG);
  expect(kind, `the registry no longer maps ${SLUG} to a runner`).toBe(
    "overlay",
  );
  const { container } = render(
    <Router>
      <ToolRunner kind={kind!} slug={SLUG} />
    </Router>,
  );
  const baseInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(baseInput, "the base dropzone file input").not.toBeNull();
  fireEvent.change(baseInput!, {
    target: { files: [pdfFile(await letter(), "letter.pdf")] },
  });

  // Once the base loads, the only picker left belongs to the overlay zone.
  await screen.findByText(/drop the overlay pdf here/i);
  const overlayInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(overlayInput, "the overlay dropzone file input").not.toBeNull();
  fireEvent.change(overlayInput!, {
    target: { files: [pdfFile(await letterhead(), "letterhead.pdf")] },
  });
  await screen.findByText("letterhead.pdf");

  if (layerLabel) {
    fireEvent.click(screen.getByRole("radio", { name: layerLabel }));
  }
  const run = screen.getByRole("button", { name: /overlay onto 1 page/i });
  await waitFor(() => expect(run).toBeEnabled());
  fireEvent.click(run);

  const download = await screen.findByRole(
    "button",
    { name: /download overlaid pdf/i },
    { timeout: 10_000 },
  );
  const panel = download.closest('[role="group"]');
  const summary = panel?.textContent ?? "";
  fireEvent.click(download);
  expect(
    downloads,
    "the Download button handed the browser no Blob",
  ).toHaveLength(1);
  return {
    bytes: new Uint8Array(await downloads[0]!.arrayBuffer()),
    summary,
  };
}

const BODY = [0.35, 0.4, 0.65, 0.6] as const;
const BAND = [0.1, 0.01, 0.9, 0.08] as const;
const isDark = (c: Rgb) => c.every((v) => v < 60);
const isWhite = (c: Rgb) => c.every((v) => v > 240);
const isRed = (c: Rgb) => c[0] > 180 && c[1] < 90 && c[2] < 90;

describe("overlay-pdf: what the downloaded file shows", () => {
  it("'Behind content' keeps the letter readable under an opaque letterhead", async () => {
    const behind = OVERLAY_LAYERS.find((l) => l.id === "back")!;
    const { bytes, summary } = await overlayThroughTheUi(behind.label);
    const [page] = await renderPdfPages(bytes);
    expect(isDark(regionMean(page!, ...BODY))).toBe(true);
    expect(isRed(regionMean(page!, ...BAND))).toBe(true);
    expect(summary).toContain(behind.done);
  }, 30_000);

  it("POSITIVE CONTROL: the default, on top, hides the letter under the same letterhead", async () => {
    const front = OVERLAY_LAYERS.find((l) => l.id === "front")!;
    const { bytes, summary } = await overlayThroughTheUi();
    const [page] = await renderPdfPages(bytes);
    expect(isWhite(regionMean(page!, ...BODY))).toBe(true);
    expect(isRed(regionMean(page!, ...BAND))).toBe(true);
    expect(summary).toContain(front.done);
  }, 30_000);

  it("every layer the engine offers is a radio the visitor can pick", async () => {
    // Derived from the engine's list: a mode the UI forgot is a mode no user
    // can reach, however well the engine test proves it.
    expect(OVERLAY_LAYERS.length).toBeGreaterThanOrEqual(3);
    const { container } = render(
      <Router>
        <ToolRunner kind="overlay" slug={SLUG} />
      </Router>,
    );
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: { files: [pdfFile(await letter(), "letter.pdf")] },
    });
    const group = await screen.findByRole("radiogroup", {
      name: /overlay layer/i,
    });
    const radios = Array.from(group.querySelectorAll('[role="radio"]')).map(
      (el) => el.textContent,
    );
    expect(radios).toEqual(OVERLAY_LAYERS.map((l) => l.label));

    // …and the page's steps name each choice the visitor was just shown, in
    // quotes, read off the RENDERED radios of every Placement control. The
    // served FAQ said the overlay is "always drawn above the base page's
    // content, never beneath it" beside a Layer control offering "Behind
    // content", and its steps listed Scale and Opacity only: nothing compared
    // the page's words with the controls under them.
    const steps = servedSteps().join(" ");
    for (const name of [/overlay layer/i, /overlay scale mode/i]) {
      const control = screen.getByRole("radiogroup", { name });
      const labels = Array.from(control.querySelectorAll('[role="radio"]')).map(
        (el) => el.textContent?.trim() ?? "",
      );
      // Health: an empty list, or an empty label, is contained in anything.
      expect(labels.length).toBeGreaterThanOrEqual(3);
      for (const label of labels) {
        expect(label.length).toBeGreaterThan(0);
        expect(steps, `the steps never name "${label}"`).toContain(
          `"${label}"`,
        );
      }
    }
  }, 30_000);
});
