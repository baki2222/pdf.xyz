import { describe, expect, it } from "vitest";
import content from "./content/pdf-viewer";
import { RUNNER_FILE_CEILINGS } from "./file-ceilings";
import {
  VIEWER_LIVE_PAGES,
  VIEWER_MAX_MATCHES,
  VIEWER_MAX_TEXT_ITEMS,
  VIEWER_PRINT_DPI,
  VIEWER_PRINT_MAX_PAGES,
  VIEWER_PRINT_MAX_PIXELS,
  printPlan,
} from "@/lib/pdf/viewer-geometry";
import {
  VIEWER_IMAGE_NOTE,
  VIEWER_LABELS,
  VIEWER_ZOOM_RANGE,
  viewerPrintNote,
} from "@/lib/pdf/viewer-copy";

/**
 * The PDF Viewer's page states its limits from the constants that enforce
 * them, so a changed cap changes the sentence. Each figure is looked for as
 * the constant renders it, never as a typed number (a typed "500" would
 * stay green while the cap moved — the mutation run of 2026-11-10 changed
 * VIEWER_MAX_MATCHES and read this file still passing, with the FAQ saying
 * the new number).
 */
const text = [
  ...content.intro,
  ...content.useCases.flatMap((u) => [u.title, u.body]),
  ...content.steps.flatMap((s) => [s.title, s.body]),
  ...content.faqs.flatMap((f) => [f.q, f.a]),
].join(" ");
const n = (x: number) => x.toLocaleString("en-US");

describe("PDF Viewer copy states the numbers it enforces", () => {
  it("the size ceiling, the live pages, the zoom range, the search and text caps, the print caps", () => {
    expect(text).toContain(
      `${Math.round(RUNNER_FILE_CEILINGS.view / (1024 * 1024))} MB`,
    );
    expect(text).toContain(`at most ${VIEWER_LIVE_PAGES} at a time`);
    expect(text).toContain(VIEWER_ZOOM_RANGE);
    expect(text).toContain(`at most ${n(VIEWER_MAX_MATCHES)} matches`);
    expect(text).toContain(`more than ${n(VIEWER_MAX_TEXT_ITEMS)} pieces`);
    expect(text).toContain(`${VIEWER_PRINT_DPI} dpi`);
    expect(text).toContain(`at most ${VIEWER_PRINT_MAX_PAGES} pages`);
  });

  it("names the controls by the labels the viewer draws", () => {
    for (const label of [
      VIEWER_LABELS.previous,
      VIEWER_LABELS.next,
      VIEWER_LABELS.thumbnails,
      VIEWER_LABELS.bookmarks,
      VIEWER_LABELS.zoomIn,
      VIEWER_LABELS.zoomOut,
      VIEWER_LABELS.fitWidth,
      VIEWER_LABELS.fitPage,
      VIEWER_LABELS.rotate,
      VIEWER_LABELS.search,
      VIEWER_LABELS.print,
      VIEWER_LABELS.download,
    ]) {
      expect(text, label).toContain(label);
    }
  });

  it("never claims what it does not do", () => {
    // A raster print is not an exact or vector one; nothing promises no
    // contact with the server; no page count is claimed as a limit.
    expect(text).not.toMatch(/\bvector\b|exact print|never contacts|offline/i);
    expect(text).not.toMatch(/up to [\d,]+ pages/i);
    // The image note names no page: pdf.js does not say which one.
    expect(VIEWER_IMAGE_NOTE).not.toMatch(/\bpage \d/i);
  });

  it("the print note says how many pages print and why, from the plan", () => {
    const letter = { width: 612, height: 792 };
    const byPixels = printPlan(Array.from({ length: 80 }, () => letter));
    const note = viewerPrintNote(byPixels, 80)!;
    expect(note).toContain(
      `Printing pages 1 to ${byPixels.pages.length} of 80`,
    );
    expect(note).toContain(`${VIEWER_PRINT_MAX_PIXELS / 1_000_000} megapixels`);
    const a5 = { width: 420, height: 595 };
    const byPages = printPlan(Array.from({ length: 80 }, () => a5));
    expect(viewerPrintNote(byPages, 80)).toContain(
      `at most ${VIEWER_PRINT_MAX_PAGES} pages`,
    );
    // A short document prints whole, and nothing is said.
    expect(viewerPrintNote(printPlan([letter, letter]), 2)).toBeNull();
  });
});
