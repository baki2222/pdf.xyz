import { describe, expect, it } from "vitest";
import { tools } from "./catalog";
import { pageIntro } from "./page-copy";
import { PDFJS_READER_KINDS, getRunnerKind } from "@/lib/pdf/registry";
import { PDFJS_BOARD_MAX_PAGES } from "@/lib/pdf/pdfjs-guard";
import { BOARD_PAGE_LIMIT_SENTENCE } from "@/lib/pdf/pdfjs-board-limit";
import {
  SPLIT_TOOL_HREF,
  SPLIT_TOOL_NAME,
} from "@/components/tools/runner/runner-kit";

/**
 * Every tool whose upload board pdf.js reads (`PDFJS_READER_KINDS`, held to
 * the runners by registry-readers.test.ts) refuses a file past
 * PDFJS_BOARD_MAX_PAGES. Review, 2026-11-10: those pages listed their size
 * limit and never this one, so a user met it only as a refusal. The set is
 * DERIVED from the registry, never typed, so a fifth pdf.js reader is held
 * to saying it too.
 */
const readers = tools.filter((t) => {
  const kind = getRunnerKind(t.slug);
  return kind !== undefined && kind !== null && PDFJS_READER_KINDS.has(kind);
});

describe("every reader:'pdfjs' tool page states the board's page limit", () => {
  it("the set is found, and is no smaller than it is today", () => {
    // Health (CLAUDE.md rule 4): an empty set would pass every case below.
    expect(readers.map((t) => t.slug).sort()).toEqual(
      expect.arrayContaining([
        "pdf-to-jpg",
        "pdf-to-markdown",
        "pdf-to-png",
        "pdf-to-text",
        "pdf-viewer",
      ]),
    );
  });

  it("the sentence states the guard's figure and names the tool the alert links", () => {
    expect(BOARD_PAGE_LIMIT_SENTENCE).toContain(
      `${PDFJS_BOARD_MAX_PAGES.toLocaleString("en-US")} pages`,
    );
    expect(BOARD_PAGE_LIMIT_SENTENCE).toContain(SPLIT_TOOL_NAME);
    expect(
      tools.find((t) => `/tools/${t.slug}` === SPLIT_TOOL_HREF)?.name,
    ).toBe(SPLIT_TOOL_NAME);
  });

  it.each(readers.map((t) => [t.slug, t] as const))(
    "%s says it, in its intro",
    (_, tool) => {
      expect(pageIntro(tool).join(" ")).toContain(BOARD_PAGE_LIMIT_SENTENCE);
    },
  );
});
