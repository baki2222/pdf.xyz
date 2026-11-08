import { describe, expect, it } from "vitest";
import {
  DEFAULT_HTML_RENDER_OPTIONS,
  type HtmlRenderOptions,
} from "@/lib/jobs/html-render-options";
import { planPrint, PRINT_TO_PDF_OPTIONS } from "./print-params";
import {
  STAMP_EMPTY_HEADER,
  STAMP_MIN_MARGIN_INCHES,
  WEBPAGE_OUTLINE_PARAMS,
  stampFooterTemplate,
} from "./stamp";

const plan = (o: Partial<HtmlRenderOptions>) =>
  planPrint({ ...DEFAULT_HTML_RENDER_OPTIONS, ...o });

describe("planPrint", () => {
  it("the defaults are EXACTLY the call made before these options existed", () => {
    const p = plan({});
    expect(p.viewport).toBeNull();
    expect(p.measure).toBeNull();
    expect(p.printParams()).toEqual(PRINT_TO_PDF_OPTIONS);
  });

  it("every call keeps the page alone: no print header or footer, backgrounds on", () => {
    for (const o of [
      { pageSize: "A4" },
      { onePage: true },
      { viewport: "phone" },
      { margin: "none" },
    ] as const) {
      const params = plan(o).printParams(1000);
      expect(params.displayHeaderFooter).toBe(false);
      expect(params.printBackground).toBe(true);
    }
  });

  it("A4 landscape states the turned paper and does not ask Chromium to turn it again", () => {
    const params = plan({
      pageSize: "A4",
      orientation: "landscape",
    }).printParams();
    expect(params).toMatchObject({
      preferCSSPageSize: false,
      landscape: false,
      marginTop: 0.4,
      marginLeft: 0.4,
    });
    expect((params.paperWidth as number) * 25.4).toBeCloseTo(297, 6);
    expect((params.paperHeight as number) * 25.4).toBeCloseTo(210, 6);
    expect(params).not.toHaveProperty("scale");
  });

  it("margins are the chosen inches on every edge", () => {
    const none = plan({ margin: "none" }).printParams();
    const small = plan({ margin: "small" }).printParams();
    for (const edge of [
      "marginTop",
      "marginBottom",
      "marginLeft",
      "marginRight",
    ]) {
      expect(none[edge]).toBe(0);
      expect(small[edge]).toBe(0.2);
    }
  });

  it("a screen width emulates that window and scales the print to it", () => {
    const p = plan({ pageSize: "A4", viewport: "phone" });
    expect(p.viewport).toEqual({ width: 390, height: 844 });
    const scale = p.printParams().scale as number;
    expect(scale).toBeCloseTo(((210 / 25.4 - 0.8) * 96) / 390, 9);
  });

  it("one long page measures at the printed width, and cannot print unmeasured", () => {
    const p = plan({ onePage: true, viewport: "desktop", pageSize: "A4" });
    expect(p.measure).toEqual({ widthPx: 1280 });
    expect(() => p.printParams()).toThrow(/measured height/);
    const params = p.printParams(5000);
    const scale = params.scale as number;
    expect(params.paperHeight as number).toBeCloseTo(
      ((5000 + 16) * scale) / 96 + 0.8,
      9,
    );
    expect(params.preferCSSPageSize).toBe(false);
  });
});

describe("planPrint · Webpage to PDF's extras (audit webpage-to-pdf#7)", () => {
  const FOOTER = stampFooterTemplate(
    "https://example.com/terms",
    new Date(Date.UTC(2026, 10, 8, 14, 3)),
  );

  it("no extras is the print as it was; the outline adds only its own key", () => {
    expect(planPrint(DEFAULT_HTML_RENDER_OPTIONS, {}).printParams()).toEqual(
      PRINT_TO_PDF_OPTIONS,
    );
    expect(
      planPrint(DEFAULT_HTML_RENDER_OPTIONS, { outline: true }).printParams(),
    ).toEqual({ ...PRINT_TO_PDF_OPTIONS, ...WEBPAGE_OUTLINE_PARAMS });
    expect(
      planPrint(
        { ...DEFAULT_HTML_RENDER_OPTIONS, pageSize: "A4" },
        { outline: true },
      ).printParams().generateDocumentOutline,
    ).toBe(true);
  });

  it("the stamp turns on the footer with an empty header, and only the stamp does", () => {
    for (const o of [{}, { pageSize: "A4" }, { margin: "none" }] as const) {
      const params = planPrint(
        { ...DEFAULT_HTML_RENDER_OPTIONS, ...o },
        { footerTemplate: FOOTER },
      ).printParams();
      expect(params).toMatchObject({
        displayHeaderFooter: true,
        headerTemplate: STAMP_EMPTY_HEADER,
        footerTemplate: FOOTER,
      });
      expect(
        planPrint(
          { ...DEFAULT_HTML_RENDER_OPTIONS, ...o },
          { outline: true },
        ).printParams().displayHeaderFooter,
      ).toBe(false);
    }
  });

  it("a stamped page keeps room at its foot: the bottom margin is at least the stamp's", () => {
    const none = planPrint(
      { ...DEFAULT_HTML_RENDER_OPTIONS, margin: "none" },
      { footerTemplate: FOOTER },
    ).printParams();
    expect(none.marginBottom).toBe(STAMP_MIN_MARGIN_INCHES);
    expect(none.marginTop).toBe(0);
    // One long page grows by the margin it gained, so no second page.
    const plain = planPrint({
      ...DEFAULT_HTML_RENDER_OPTIONS,
      margin: "none",
      onePage: true,
    }).printParams(2000);
    const stamped = planPrint(
      { ...DEFAULT_HTML_RENDER_OPTIONS, margin: "none", onePage: true },
      { footerTemplate: FOOTER },
    ).printParams(2000);
    expect(stamped.paperHeight as number).toBeCloseTo(
      (plain.paperHeight as number) + STAMP_MIN_MARGIN_INCHES,
      9,
    );
  });
});
