// @vitest-environment jsdom
// @native-canvas
/**
 * Audit watermark-pdf#1: Add Watermark shows the page with the mark drawn
 * over it, and the drawing follows every setting as it changes: the text,
 * the size, the angle and the opacity. The mark can be moved on the preview;
 * the last check moves it with the keyboard (jsdom has no layout for a
 * pointer drag; e2e/watermark-preview.spec.ts drags it in a real browser),
 * runs, and decodes the DOWNLOADED file with pdf.js: the text sits in the
 * quadrant the preview showed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { OPTIONS_STORAGE_KEY } from "@/lib/intent/options-key";
import { getToolBySlug } from "@/lib/tools";
import { pageFaq, pageIntro, pageSteps, stepText } from "@/lib/tools/page-copy";
import { readAsViewer } from "@/tests/pdfjs-viewer";
import { WatermarkEditor } from "./watermark-runner";
import type { LoadedPdf } from "./use-single-pdf";

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
let pending: Blob | null = null;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
beforeEach(() => {
  downloads = [];
  window.localStorage.removeItem(OPTIONS_STORAGE_KEY);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) pending = obj;
    return "blob:watermark-preview";
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    if (pending) downloads.push(pending);
    pending = null;
  });
});
afterEach(() => {
  cleanup();
  resetAnnouncer();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

async function loaded(): Promise<LoadedPdf> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  doc.addPage([800, 600]);
  const bytes = await doc.save();
  return {
    file: new File([bytes.slice()], "doc.pdf", { type: "application/pdf" }),
    bytes,
    pageCount: 2,
    rotations: [0, 0],
    digitalSignatures: 0,
  };
}

const marks = () =>
  Array.from(document.querySelectorAll<SVGGElement>("[data-watermark-mark]"));
const mark = () => marks()[0]!;
const label = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const setValue = (name: string, value: string | number) =>
  fireEvent.change(label(name), { target: { value: String(value) } });

describe("live watermark preview (audit watermark-pdf#1)", () => {
  it("draws the mark over the page and follows text, size, angle and opacity", async () => {
    render(
      <Router>
        <WatermarkEditor pdf={await loaded()} onReset={() => {}} />
      </Router>,
    );
    await waitFor(() => expect(marks()).toHaveLength(1));
    const text = () => mark().querySelector("text")!;
    expect(text().textContent).toBe("CONFIDENTIAL");
    // The preview sheet is the first page's shape, as read.
    expect(
      screen.getByTestId("watermark-preview").getAttribute("style"),
    ).toMatch(/aspect-ratio:\s*600\s*\/\s*800/);

    setValue("Text", "DRAFT");
    await waitFor(() => expect(text().textContent).toBe("DRAFT"));

    const before = Number(text().getAttribute("font-size"));
    setValue("Max font size", 30);
    await waitFor(() =>
      expect(Number(text().getAttribute("font-size"))).toBeCloseTo(30),
    );
    expect(before).toBeCloseTo(60);

    setValue("Rotation", 10);
    await waitFor(() =>
      expect(mark().getAttribute("transform")).toMatch(/rotate\(-10\)/),
    );

    // Review finding 9 (2026-11-28): one value let a constant `0.5` pass.
    // The starting value and two different values each have to show.
    expect(mark().getAttribute("opacity")).toBe("0.18");
    setValue("Opacity", 50);
    await waitFor(() => expect(mark().getAttribute("opacity")).toBe("0.5"));
    setValue("Opacity", 73);
    await waitFor(() => expect(mark().getAttribute("opacity")).toBe("0.73"));
  });

  it("tiling draws every copy, and another preview page changes the sheet", async () => {
    render(
      <Router>
        <WatermarkEditor pdf={await loaded()} onReset={() => {}} />
      </Router>,
    );
    await waitFor(() => expect(marks()).toHaveLength(1));
    setValue("Max font size", 20);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Tile across the page/ }),
    );
    await waitFor(() => expect(marks().length).toBeGreaterThan(3));
    setValue("Preview page", 2);
    await waitFor(() =>
      expect(
        screen.getByTestId("watermark-preview").getAttribute("style"),
      ).toMatch(/aspect-ratio:\s*800\s*\/\s*600/),
    );
  });

  it(
    "a mark moved on the preview lands in the same quadrant of the download",
    { timeout: 60_000 },
    async () => {
      render(
        <Router>
          <WatermarkEditor pdf={await loaded()} onReset={() => {}} />
        </Router>,
      );
      setValue("Rotation", 0);
      setValue("Max font size", 30);
      await waitFor(() => expect(marks()).toHaveLength(1));
      const handle = screen.getByRole("button", { name: /Move the watermark/ });
      // Ten big steps left and up: from the centre to the top-left corner,
      // where the mark stops with its whole width still on the page.
      for (let i = 0; i < 10; i += 1) {
        fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
        fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: true });
      }
      // No cell of the grid claims the mark any more.
      expect(
        screen
          .getAllByRole("radio")
          .filter(
            (r) =>
              r.closest('[aria-label="Watermark position"]') &&
              r.getAttribute("aria-checked") === "true",
          ),
      ).toHaveLength(0);
      const [g] = marks();
      const [, cx, cy] = /translate\(([\d.]+) ([\d.]+)\)/.exec(
        g!.getAttribute("transform")!,
      )!;
      expect(Number(cx)).toBeLessThan(300);
      expect(Number(cy)).toBeLessThan(400);

      fireEvent.click(screen.getByRole("button", { name: /Add watermark/ }));
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: /Download watermarked PDF/ },
          { timeout: 30_000 },
        ),
      );
      await waitFor(() => expect(downloads).toHaveLength(1));
      const seen = await readAsViewer(
        new Uint8Array(await downloads[0]!.arrayBuffer()),
      );
      const run = seen[0]!.runs.find((r) => r.str.includes("CONFIDENTIAL"))!;
      expect((run.x + run.endX) / 2).toBeCloseTo(Number(cx), 0);
      expect((run.x + run.endX) / 2).toBeLessThan(300);
      expect(run.y).toBeLessThan(400);
    },
  );
});

describe("the page stops saying there is no preview", () => {
  /** Every sentence Watermark PDF shipped about having no preview. */
  const SHIPPED = [
    "There is no preview: to try other settings, press Back to adjust after a run, and the options come back as you left them with the same file still loaded.",
  ];
  const NO_PREVIEW = /\b(?:no|without a|without any)\s+preview\b/i;

  // Imported statically (review finding 7, 2026-11-28): a dynamic import of
  // the whole catalogue inside the test ran under the 5 s test timeout and
  // went red under load for a reason that had nothing to do with the copy.
  it("the ban catches what shipped, and the page now names the Preview", () => {
    for (const s of SHIPPED) expect(NO_PREVIEW.test(s), s).toBe(true);
    const tool = getToolBySlug("watermark-pdf")!;
    const served = [
      ...pageIntro(tool),
      ...pageSteps(tool).map(stepText),
      ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
    ].join("\n");
    // Health: the corpus is the real page.
    expect(served.length).toBeGreaterThan(2000);
    expect(served).not.toMatch(NO_PREVIEW);
    expect(served).toMatch(/\bPreview\b/);
  });
});
