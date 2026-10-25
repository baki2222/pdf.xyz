import { describe, expect, it } from "vitest";
import {
  DEFAULT_HTML_RENDER_OPTIONS,
  HTML_MARGINS,
  HTML_ONE_PAGE_MAX_INCHES,
  HTML_PAGE_SIZES,
  HTML_VIEWPORTS,
  htmlPrintGeometry,
  htmlRenderOptionsBag,
  isDefaultHtmlRenderOptions,
  onePageHeightInches,
  parseHtmlRenderOptions,
  type HtmlRenderOptions,
} from "./html-render-options";

const field = (r: ReturnType<typeof parseHtmlRenderOptions>) =>
  r.ok ? null : (r.error.body.error.details?.[0]?.field ?? null);

const opts = (o: Partial<HtmlRenderOptions>): HtmlRenderOptions => ({
  ...DEFAULT_HTML_RENDER_OPTIONS,
  ...o,
});

describe("parseHtmlRenderOptions", () => {
  it("{} is the job as it always ran, and is recognised as the default", () => {
    const r = parseHtmlRenderOptions({});
    expect(r).toEqual({ ok: true, value: DEFAULT_HTML_RENDER_OPTIONS });
    expect(r.ok && isDefaultHtmlRenderOptions(r.value)).toBe(true);
    // A webpage job's `url` is not this parser's to judge.
    expect(parseHtmlRenderOptions({ url: "https://example.com/" }).ok).toBe(
      true,
    );
  });

  it("accepts every value the menus offer", () => {
    for (const s of HTML_PAGE_SIZES)
      expect(parseHtmlRenderOptions({ pageSize: s.id }).ok).toBe(true);
    for (const m of HTML_MARGINS)
      expect(parseHtmlRenderOptions({ margin: m.id }).ok).toBe(true);
    for (const v of HTML_VIEWPORTS)
      expect(parseHtmlRenderOptions({ viewport: v.id }).ok).toBe(true);
    expect(
      parseHtmlRenderOptions({ orientation: "landscape", onePage: true }),
    ).toEqual({
      ok: true,
      value: opts({ orientation: "landscape", onePage: true }),
    });
  });

  it("the five sizes asked for are offered", () => {
    expect(HTML_PAGE_SIZES.map((s) => s.id)).toEqual(
      expect.arrayContaining(["A4", "Letter", "Legal", "A3", "A5"]),
    );
    expect(HTML_VIEWPORTS.map((v) => v.width)).toEqual(
      expect.arrayContaining([1280, 768, 390]),
    );
  });

  it("refuses an unknown value, naming the field, never coercing", () => {
    expect(field(parseHtmlRenderOptions({ pageSize: "a4" }))).toBe(
      "options.pageSize",
    );
    expect(field(parseHtmlRenderOptions({ pageSize: "B5" }))).toBe(
      "options.pageSize",
    );
    expect(field(parseHtmlRenderOptions({ orientation: "sideways" }))).toBe(
      "options.orientation",
    );
    expect(field(parseHtmlRenderOptions({ margin: 10 }))).toBe(
      "options.margin",
    );
    expect(field(parseHtmlRenderOptions({ viewport: "1280" }))).toBe(
      "options.viewport",
    );
    expect(field(parseHtmlRenderOptions({ onePage: "true" }))).toBe(
      "options.onePage",
    );
    const r = parseHtmlRenderOptions({ pageSize: "B5" });
    expect(!r.ok && r.error.body.error.code).toBe("invalid_request");
  });
});

describe("htmlRenderOptionsBag", () => {
  it("sends nothing for the defaults, and only what changed otherwise", () => {
    expect(htmlRenderOptionsBag(DEFAULT_HTML_RENDER_OPTIONS)).toEqual({});
    expect(
      htmlRenderOptionsBag(opts({ pageSize: "A4", onePage: true })),
    ).toEqual({ pageSize: "A4", onePage: true });
  });

  it("round-trips through the parser", () => {
    const o = opts({
      pageSize: "Legal",
      orientation: "landscape",
      margin: "none",
      viewport: "phone",
      onePage: true,
    });
    expect(parseHtmlRenderOptions(htmlRenderOptionsBag(o))).toEqual({
      ok: true,
      value: o,
    });
  });
});

describe("htmlPrintGeometry", () => {
  it("A4 landscape is 297 × 210 mm, and landscape swaps the sides", () => {
    const g = htmlPrintGeometry(
      opts({ pageSize: "A4", orientation: "landscape" }),
    );
    expect(g.paperInches[0] * 25.4).toBeCloseTo(297, 6);
    expect(g.paperInches[1] * 25.4).toBeCloseTo(210, 6);
    expect(g.preferCSSPageSize).toBe(false);
  });

  it("auto keeps the page's own @page size only while nothing needs a width", () => {
    expect(htmlPrintGeometry(DEFAULT_HTML_RENDER_OPTIONS)).toMatchObject({
      paperInches: [8.5, 11],
      marginInches: 0.4,
      scale: 1,
      preferCSSPageSize: true,
    });
    expect(
      htmlPrintGeometry(opts({ orientation: "landscape" })).preferCSSPageSize,
    ).toBe(true);
    expect(
      htmlPrintGeometry(opts({ viewport: "desktop" })).preferCSSPageSize,
    ).toBe(false);
    expect(htmlPrintGeometry(opts({ onePage: true })).preferCSSPageSize).toBe(
      false,
    );
  });

  it("a screen width is met by scaling: printable width ÷ screen width", () => {
    const g = htmlPrintGeometry(opts({ pageSize: "A4", viewport: "desktop" }));
    const printable = (210 / 25.4 - 0.8) * 96;
    expect(g.scale).toBeCloseTo(printable / 1280, 9);
    expect(g.layoutWidthPx).toBeCloseTo(1280, 6);
    expect(g.scaleClamped).toBe(false);
  });

  it("a phone width on paper too wide for it is clamped at 2, and says so", () => {
    const g = htmlPrintGeometry(
      opts({
        pageSize: "A3",
        orientation: "landscape",
        margin: "none",
        viewport: "phone",
      }),
    );
    expect(g.scale).toBe(2);
    expect(g.scaleClamped).toBe(true);
    expect(g.layoutWidthPx).toBeGreaterThan(390);
  });

  it("every offered paper and screen meet inside the scale range except the clamped ones", () => {
    for (const s of HTML_PAGE_SIZES)
      for (const v of HTML_VIEWPORTS)
        for (const m of HTML_MARGINS) {
          const g = htmlPrintGeometry(
            opts({ pageSize: s.id, viewport: v.id, margin: m.id }),
          );
          expect(g.scale).toBeGreaterThanOrEqual(0.1);
          expect(g.scale).toBeLessThanOrEqual(2);
          if (!g.scaleClamped && v.width)
            expect(g.layoutWidthPx).toBeCloseTo(v.width, 6);
        }
  });
});

describe("onePageHeightInches", () => {
  it("is the content, scaled, plus a 16px allowance and both margins", () => {
    const g = htmlPrintGeometry(opts({ onePage: true }));
    expect(onePageHeightInches(g, 960)).toBeCloseTo((960 + 16) / 96 + 0.8, 9);
  });

  it("never exceeds the ceiling", () => {
    const g = htmlPrintGeometry(opts({ onePage: true }));
    expect(onePageHeightInches(g, 10_000_000)).toBe(HTML_ONE_PAGE_MAX_INCHES);
  });
});
