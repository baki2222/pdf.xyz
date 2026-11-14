// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  ComparablePdfText,
  PdfCompareResult,
} from "@/lib/pdf/compare-pdf";
import {
  CompareChanges,
  ROWS_SHOWN,
  compareExtractedPdfText,
} from "./compare-result";

/*
 * A row is drawn by reading its step, `hunk.ops[i]`, so counting the index
 * reads of every hunk's steps counts the rows a render touched. No module
 * is mocked: the suite shares one module cache, and src/tests/mock-isolation
 * .test.ts forbids a stub the view could stay bound to. (The first version
 * of this file counted calls to a mocked `cn`, on 2026-11-14, and that guard
 * flagged it.) A hunk's heading is drawn by reading its `leftPages`, so
 * those reads count the sections a render touched (plus one for the live
 * line, which names the current hunk).
 */
const reads = { n: 0 };
const heads = { n: 0 };
function counted(result: PdfCompareResult): PdfCompareResult {
  const hunks = result.hunks.map((hunk) => {
    hunk.ops = new Proxy(hunk.ops, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads.n += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    return new Proxy(hunk, {
      get(target, key, receiver) {
        if (key === "leftPages") heads.n += 1;
        return Reflect.get(target, key, receiver);
      },
    });
  });
  return { ...result, hunks };
}

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
    const result = counted(oneLongHunk(3_000));
    reads.n = 0;
    render(
      <CompareChanges result={result} options={{}} onOptions={() => {}} />,
    );
    const changed = document.querySelectorAll("tr[data-kind]").length;
    expect(document.querySelectorAll("tr")).toHaveLength(ROWS_SHOWN);
    expect(changed).toBeGreaterThan(200);
    expect(reads.n).toBeGreaterThanOrEqual(ROWS_SHOWN);
  });

  it("each Show more of this change touches its new rows, not the ones before", () => {
    const result = counted(oneLongHunk(3_000));
    render(
      <CompareChanges result={result} options={{}} onOptions={() => {}} />,
    );
    const more = () =>
      screen.getByRole("button", { name: /show more of this change/i });
    for (let press = 1; press <= 4; press += 1) {
      const before = document.querySelectorAll("tr").length;
      reads.n = 0;
      fireEvent.click(more());
      const added = document.querySelectorAll("tr").length - before;
      expect(added).toBeGreaterThan(0);
      // The new rows, plus at most one block before them (it grew): never
      // the whole drawn list. Health: re-reading every drawn row would pass
      // that bound.
      expect(before + added).toBeGreaterThan(added + 100);
      expect(reads.n, `press ${press}`).toBeLessThanOrEqual(added + 100);
    }
  });

  it("Next change re-renders two headings, not the rows", () => {
    const result = counted(manyHunks(60));
    render(
      <CompareChanges result={result} options={{}} onOptions={() => {}} />,
    );
    const drawnRows = document.querySelectorAll("tr[data-kind]").length;
    expect(drawnRows).toBeGreaterThan(50);
    const sections = screen.getAllByRole("heading", { level: 3 }).length;
    expect(sections).toBeGreaterThan(20);
    for (let press = 0; press < 5; press += 1) {
      reads.n = 0;
      heads.n = 0;
      fireEvent.click(screen.getByRole("button", { name: "Next change" }));
      expect(reads.n, `press ${press}: rows`).toBe(0);
      // The heading it left, the heading it reached, and the live line
      // (which may read it twice): never every drawn section.
      expect(heads.n, `press ${press}: sections`).toBeLessThanOrEqual(6);
    }
  });
});
