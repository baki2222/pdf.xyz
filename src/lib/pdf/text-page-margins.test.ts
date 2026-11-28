// @vitest-environment node
/**
 * Text to PDF margins (audit wave 2, text-to-pdf#3). The margin was one fixed
 * 0.75 in; a person can now choose Narrow, Normal or Wide in the editor and
 * in the batch. Proved in the SAVED bytes: the x of every body line is the
 * chosen margin, the first line hangs from the chosen top margin, and the
 * lines per page are floor((page height - 2 margins) / line height), a count
 * computed here from the page box read back out of the file. The heading and
 * the page counter stay outside the text block at every margin.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { textToPdf } from "./text-to-pdf";
import {
  DEFAULT_TEXT_PAGE_OPTIONS,
  TEXT_MARGINS,
  TEXT_PAGE_SETUP_LABELS,
  textPageGeometry,
} from "./text-page-options";
import { TEXT_PAGE_MARGIN_PT } from "./page-geometry";
import { drawnRuns } from "@/tests/pdf-drawn-runs";

const LINES = Array.from({ length: 140 }, (_, i) => `line ${i + 1}`).join("\n");

describe("Text to PDF margins: the choices", () => {
  it("offers Narrow, Normal and Wide, each a different width (health check)", () => {
    expect(TEXT_MARGINS.map((m) => m.label)).toEqual([
      "Narrow",
      "Normal",
      "Wide",
    ]);
    const pts = TEXT_MARGINS.map((m) => m.points);
    expect(new Set(pts).size).toBe(3);
    expect([...pts].sort((a, b) => a - b)).toEqual(pts);
    expect(TEXT_PAGE_SETUP_LABELS.margin).toBe("Margins");
  });

  it("starts on Normal, the margin this tool always drew", () => {
    const normal = TEXT_MARGINS.find(
      (m) => m.id === DEFAULT_TEXT_PAGE_OPTIONS.margin,
    )!;
    expect(normal.label).toBe("Normal");
    expect(normal.points).toBe(TEXT_PAGE_MARGIN_PT);
  });

  it("refuses a margin the chips do not offer", () => {
    expect(() =>
      textPageGeometry({
        ...DEFAULT_TEXT_PAGE_OPTIONS,
        margin: "huge" as never,
      }),
    ).toThrow(/margin/);
  });
});

describe("Text to PDF margins: the saved PDF at each choice", () => {
  const perPage: number[] = [];
  it.each(TEXT_MARGINS.map((m) => [m.label, m] as const))(
    "%s: every line starts at the margin, and full pages hold floor(usable / line height)",
    async (_label, margin) => {
      const doc = await PDFDocument.load(
        await textToPdf(LINES, { margin: margin.id, title: "notes" }),
      );
      const M = margin.points;
      const lineHeight = 16; // 11 pt text on 16 pt lines, the default size
      const counts: number[] = [];
      for (let p = 0; p < doc.getPageCount(); p++) {
        const { width: W, height: H } = doc.getPage(p).getSize();
        const [title, footer, ...body] = drawnRuns(doc, p);
        expect(body.length).toBeGreaterThan(0);
        counts.push(body.length);
        body.forEach((run, k) => {
          expect(run.x).toBeCloseTo(M, 6);
          expect(run.y).toBeCloseTo(H - M - k * lineHeight, 6);
          expect(run.y - run.size * 0.2).toBeGreaterThanOrEqual(M - 1e-6);
        });
        // The heading sits above the first line's ascent, inside the page.
        expect(title!.x).toBeCloseTo(M, 6);
        expect(title!.y - title!.size * 0.2).toBeGreaterThan(
          body[0]!.y + body[0]!.size * 0.8,
        );
        expect(title!.y + title!.size * 0.8).toBeLessThanOrEqual(H);
        // The counter sits below the last possible line's descent.
        expect(footer!.y + footer!.size * 0.8).toBeLessThan(
          M - 0.2 * body[0]!.size,
        );
        expect(footer!.y).toBeGreaterThan(0);
        expect(footer!.x + 32).toBeCloseTo(W - M, 6);
        const expected = Math.floor((H - 2 * M) / lineHeight);
        if (p < doc.getPageCount() - 1) expect(body.length).toBe(expected);
      }
      perPage.push(counts[0]!);
    },
    30_000,
  );

  it("a wider margin holds fewer lines a page (the three runs above differ)", () => {
    expect(perPage).toHaveLength(3);
    expect(perPage[0]!).toBeGreaterThan(perPage[1]!);
    expect(perPage[1]!).toBeGreaterThan(perPage[2]!);
  });
});
