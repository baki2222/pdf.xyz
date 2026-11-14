// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComparablePdfText } from "@/lib/pdf/compare-pdf";

/*
 * Every drawn row of a change calls `cn` twice (its row and its sign), so
 * counting `cn` counts the rows a render touched. The stub delegates to the
 * real one, so a module that caches it still renders correctly.
 */
const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/utils", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...real,
    cn: (...args: Parameters<typeof real.cn>) => {
      calls.n += 1;
      return real.cn(...args);
    },
  };
});

const { CompareChanges, ROWS_SHOWN, compareExtractedPdfText } =
  await import("./compare-result");

afterEach(cleanup);

function doc(name: string, pages: string[][]): ComparablePdfText {
  const texts = pages.map((p) => p.join("\n"));
  const text = texts.join("\n\n");
  return {
    name,
    size: text.length,
    extracted: {
      pageCount: pages.length,
      pages: texts.map((t, i) => ({
        pageNumber: i + 1,
        text: t,
        characterCount: t.length,
      })),
      text,
      characterCount: text.length,
      hasText: true,
    },
  };
}

/** `n` edits, every other line: one hunk of about 3n rows. */
function oneLongHunk(n: number) {
  const left = Array.from({ length: 2 * n }, (_, i) => `line ${i}`);
  const right = left.map((l, i) => (i % 2 === 0 ? `${l} edited` : l));
  return compareExtractedPdfText(doc("a.pdf", [left]), doc("b.pdf", [right]));
}

/** `pages` pages, one edit on each: one small hunk per page. */
function manyHunks(pages: number) {
  const left = Array.from({ length: pages }, (_, p) =>
    Array.from({ length: 10 }, (_, i) => `p${p} line ${i + 1}`),
  );
  const right = left.map((page) =>
    page.map((line, i) => (i === 5 ? `${line} x` : line)),
  );
  return compareExtractedPdfText(doc("a.pdf", left), doc("b.pdf", right));
}

/**
 * A press re-renders only what it changes (second review of audit
 * compare-pdf#4, 2026-11-14). Until then every Show more, every Next and
 * every n re-rendered every row drawn so far, so each press got slower as
 * rows were added: 922 ms for one Show more at 27,000 rows, 90-126 ms per n
 * once 3,000 rows were drawn.
 */
describe("the changes view: a press draws only new rows", () => {
  it("health: the first draw touches every drawn row", () => {
    const result = oneLongHunk(3_000);
    calls.n = 0;
    render(
      <CompareChanges result={result} options={{}} onOptions={() => {}} />,
    );
    const changed = document.querySelectorAll("tr[data-kind]").length;
    expect(document.querySelectorAll("tr")).toHaveLength(ROWS_SHOWN);
    expect(calls.n).toBeGreaterThanOrEqual(2 * changed);
  });

  it("each Show more of this change touches its new rows, not the ones before", () => {
    const result = oneLongHunk(3_000);
    render(
      <CompareChanges result={result} options={{}} onOptions={() => {}} />,
    );
    const more = () =>
      screen.getByRole("button", { name: /show more of this change/i });
    for (let press = 1; press <= 4; press += 1) {
      const before = document.querySelectorAll("tr[data-kind]").length;
      calls.n = 0;
      fireEvent.click(more());
      const added = document.querySelectorAll("tr[data-kind]").length - before;
      expect(added).toBeGreaterThan(0);
      // The new rows, at two calls each, plus the last block before them
      // (it grew) and a handful for the region: never the whole drawn list.
      // Health: re-rendering every drawn row would pass that bound.
      expect(2 * (before + added)).toBeGreaterThan(2 * added + 220);
      expect(calls.n, `press ${press}`).toBeLessThanOrEqual(2 * added + 220);
    }
  });

  it("Next change re-renders two headings, not the rows", () => {
    const result = manyHunks(60);
    render(
      <CompareChanges result={result} options={{}} onOptions={() => {}} />,
    );
    const drawnRows = document.querySelectorAll("tr[data-kind]").length;
    expect(drawnRows).toBeGreaterThan(50);
    for (let press = 0; press < 5; press += 1) {
      calls.n = 0;
      fireEvent.click(screen.getByRole("button", { name: "Next change" }));
      expect(calls.n, `press ${press}`).toBeLessThan(20);
    }
  });
});
