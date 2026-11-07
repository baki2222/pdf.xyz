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
    expect(
      screen.getByRole("option", { name: "Paper width (739 px)" }),
    ).toBeInTheDocument();
    rerender(
      <HtmlRenderLayoutOptions
        value={opts({ orientation: "landscape" })}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("option", {
        name: `Paper width (${htmlPaperWidthPx(opts({ orientation: "landscape" }))} px)`,
      }),
    ).toBeInTheDocument();
  });

  it("the note says the default is narrower than a tablet, and names the way out", () => {
    const note = htmlLayoutNote(DEFAULT_HTML_RENDER_OPTIONS) ?? "";
    expect(note).toContain(`739px`);
    expect(note).toContain(`${tablet}px`);
    expect(note).toContain(desktop.label);
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
