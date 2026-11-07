// @vitest-environment jsdom
/**
 * Audit webpage-to-pdf#5 (2026-11-07): Screen width's default, "Paper
 * width", lays the page out at the paper's printable width — about 739 CSS
 * px on Letter with Normal margins — which is under the 768 px tablet width
 * we offer, so a site with no print styles comes out in its tablet or phone
 * layout. Nothing told the user that number. The option now names its width
 * in pixels, and the note under the controls says when it is narrower than
 * a tablet screen and which choice gives the desktop layout.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  DEFAULT_HTML_RENDER_OPTIONS,
  HTML_VIEWPORTS,
  htmlPaperWidthPx,
  htmlPrintGeometry,
  type HtmlRenderOptions,
} from "@/lib/jobs/html-render-options";
import {
  HtmlRenderLayoutOptions,
  htmlLayoutNote,
} from "./html-render-layout-options";
import { htmlLayoutAnswer } from "@/lib/tools/html-layout-copy";

afterEach(cleanup);

const tablet = HTML_VIEWPORTS.find((v) => v.id === "tablet")!.width!;
const desktop = HTML_VIEWPORTS.find((v) => v.id === "desktop")!;
const opts = (o: Partial<HtmlRenderOptions>): HtmlRenderOptions => ({
  ...DEFAULT_HTML_RENDER_OPTIONS,
  ...o,
});

describe("Screen width · Paper width says how wide it is", () => {
  it("the width is the printable width Chromium lays the page out at", () => {
    // (8.5 - 2 × 0.4) × 96 = 739.2 on the default Letter paper.
    expect(htmlPaperWidthPx(DEFAULT_HTML_RENDER_OPTIONS)).toBe(
      Math.round(htmlPrintGeometry(DEFAULT_HTML_RENDER_OPTIONS).layoutWidthPx),
    );
    expect(htmlPaperWidthPx(DEFAULT_HTML_RENDER_OPTIONS)).toBe(739);
    // It follows the paper and margins, whatever screen width is chosen.
    expect(htmlPaperWidthPx(opts({ margin: "none", viewport: "phone" }))).toBe(
      816,
    );
    expect(
      htmlPaperWidthPx(opts({ pageSize: "A4", orientation: "landscape" })),
    ).toBe(Math.round((297 / 25.4 - 0.8) * 96));
  });

  it("the Paper width option names its pixel width, and moves with the paper", () => {
    const { rerender } = render(
      <HtmlRenderLayoutOptions
        value={DEFAULT_HTML_RENDER_OPTIONS}
        onChange={() => {}}
      />,
    );
    // Page size "As the page sets it": the page's own @page size picks the
    // paper, so 739 is only the Letter figure, and the label says so
    // (review of e7fc8e57: it read "Paper width (739 px)" unconditionally).
    expect(
      screen.getByRole("option", { name: "Paper width (739 px on Letter)" }),
    ).toBeInTheDocument();
    const a4 = opts({ pageSize: "A4", orientation: "landscape" });
    rerender(<HtmlRenderLayoutOptions value={a4} onChange={() => {}} />);
    expect(
      screen.getByRole("option", {
        name: `Paper width (${htmlPaperWidthPx(a4)} px)`,
      }),
    ).toBeInTheDocument();
  });

  it("the note says the default is narrower than a tablet, and names the way out", () => {
    const note = htmlLayoutNote(DEFAULT_HTML_RENDER_OPTIONS) ?? "";
    // One spelling of the unit, the menu's own ("Desktop (1280 px)").
    expect(note).toContain(`739 px wide on Letter`);
    expect(note).toContain(`${tablet} px`);
    expect(note).toContain(desktop.label);
    expect(note).not.toMatch(/\dpx\b/);
  });

  it("the Letter qualifier is on the label and the note only while Page size is As the page sets it", () => {
    expect(DEFAULT_HTML_RENDER_OPTIONS.pageSize).toBe("auto");
    const letter = opts({ pageSize: "Letter" });
    // Health: the chosen paper still warns, so the absence below is not
    // just a missing note.
    expect(htmlLayoutNote(letter) ?? "").toContain(`${tablet} px`);
    expect(htmlLayoutNote(letter) ?? "").not.toContain("on Letter");
    const { rerender } = render(
      <HtmlRenderLayoutOptions value={letter} onChange={() => {}} />,
    );
    expect(
      screen.getByRole("option", { name: "Paper width (739 px)" }),
    ).toBeInTheDocument();
    rerender(
      <HtmlRenderLayoutOptions
        value={DEFAULT_HTML_RENDER_OPTIONS}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("option", {
        name: /^Paper width \(\d+ px on Letter\)$/,
      }),
    ).toBeInTheDocument();
    expect(htmlLayoutNote(DEFAULT_HTML_RENDER_OPTIONS) ?? "").toContain(
      "on Letter",
    );
  });

  it("control: no tablet warning when the paper is wider than a tablet, or a width is chosen", () => {
    const wide = opts({ orientation: "landscape" });
    expect(htmlPaperWidthPx(wide)).toBeGreaterThanOrEqual(tablet);
    expect(htmlLayoutNote(wide) ?? "").not.toContain(`${tablet}px`);
    expect(htmlLayoutNote(opts({ viewport: "desktop" })) ?? "").not.toContain(
      `narrower than`,
    );
  });

  it("the FAQ answer states the default width from the same numbers", () => {
    for (const source of ["file", "site"] as const) {
      const answer = htmlLayoutAnswer(source);
      expect(answer).toContain(
        `${htmlPaperWidthPx(DEFAULT_HTML_RENDER_OPTIONS)} pixels`,
      );
      expect(answer).toContain(desktop.label);
    }
  });
});
