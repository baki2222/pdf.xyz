// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComparablePdfText } from "@/lib/pdf/compare-pdf";
import type { CompareOptions } from "@/lib/pdf/compare/lines";
import {
  COMPARE_RESULT_CHUNK,
  CompareChanges,
  ROWS_SHOWN,
  compareExtractedPdfText,
} from "./compare-result";

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

const body = (tag: string) =>
  Array.from({ length: 10 }, (_, i) => `${tag} line ${i + 1}`);

/** Three pages, one edit on each: three hunks, one per page. */
function threeChanges() {
  const left = [body("alpha"), body("bravo"), body("charlie")];
  const right = left.map((page, p) =>
    page.map((line, i) => (i === 5 ? `${line} amended ${p + 1}` : line)),
  );
  return compareExtractedPdfText(doc("a.pdf", left), doc("b.pdf", right));
}

function mount(onOptions = vi.fn()) {
  const result = threeChanges();
  render(<CompareChanges result={result} options={{}} onOptions={onOptions} />);
  return { result, onOptions };
}

const status = () => screen.getByRole("status").textContent;

describe("the changes view", () => {
  it("health: the fixture makes three hunks, one per page", () => {
    const result = threeChanges();
    expect(result.hunks.map((h) => [h.leftPages, h.rightPages])).toEqual([
      [
        [1, 1],
        [1, 1],
      ],
      [
        [2, 2],
        [2, 2],
      ],
      [
        [3, 3],
        [3, 3],
      ],
    ]);
  });

  it("draws a section per hunk headed by its pages, with <del> and <ins> marks", () => {
    mount();
    const region = screen.getByRole("region", { name: "Changes" });
    expect(region).toHaveAttribute("data-chunk", COMPARE_RESULT_CHUNK);
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["Page 1 → page 1", "Page 2 → page 2", "Page 3 → page 3"]);
    const ins = [...document.querySelectorAll("ins")].map((e) => e.textContent);
    const del = [...document.querySelectorAll("del")].map((e) => e.textContent);
    // Word marks: only the words that differ are marked.
    expect(ins).toEqual([" amended 1", " amended 2", " amended 3"]);
    expect(del).toEqual([]);
    expect(screen.getAllByText("Added:")).toHaveLength(3);
    expect(status()).toBe("Change 1 of 3 · page 1 → page 1");
  });

  it("Next change and Previous change move the live line, and focus the hunk's heading", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(status()).toBe("Change 2 of 3 · page 2 → page 2");
    expect(document.activeElement?.textContent).toBe("Page 2 → page 2");
    fireEvent.click(screen.getByRole("button", { name: "Previous change" }));
    expect(status()).toBe("Change 1 of 3 · page 1 → page 1");
  });

  it("n and Shift+n step through the changes, but not while a checkbox has focus", () => {
    mount();
    const region = screen.getByRole("region", { name: "Changes" });
    fireEvent.keyDown(region, { key: "n" });
    expect(status()).toMatch(/^Change 2 of 3/);
    fireEvent.keyDown(region, { key: "j" });
    expect(status()).toMatch(/^Change 3 of 3/);
    fireEvent.keyDown(region, { key: "N", shiftKey: true });
    expect(status()).toMatch(/^Change 2 of 3/);
    const box = screen.getByRole("checkbox", { name: "Ignore case" });
    fireEvent.keyDown(box, { key: "n" });
    expect(status()).toMatch(/^Change 2 of 3/);
  });

  it("the two options call back with the option set", () => {
    const { onOptions } = mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ignore case" }));
    expect(onOptions).toHaveBeenLastCalledWith({ ignoreCase: true });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Ignore page headers and numbers" }),
    );
    expect(onOptions).toHaveBeenLastCalledWith({ ignoreFurniture: true });
  });

  it("an identical result under an option says what it ignored", () => {
    const result = compareExtractedPdfText(
      doc("a.pdf", [["Total due"]]),
      doc("b.pdf", [["TOTAL DUE"]]),
      { ignoreCase: true },
    );
    render(
      <CompareChanges
        result={result}
        options={{ ignoreCase: true }}
        onOptions={() => {}}
      />,
    );
    expect(status()).toBe("No changes: identical (ignoring case)");
  });
});

/**
 * The view draws a bounded number of ROWS (review of audit compare-pdf#4,
 * 2026-11-14). It used to bound hunks — 200 — and changes four or fewer
 * lines apart merge into one hunk, so 10,000 small edits made ONE hunk of
 * 30,000 rows and every one was drawn: about a second of main thread on a
 * desktop, more on a phone, and again on every option toggle.
 */
describe("the changes view draws a bounded number of rows", () => {
  /** `n` edits, every other line: one hunk, 3n - 1 + context rows. */
  function oneLongHunk(n: number) {
    const left = Array.from({ length: 2 * n }, (_, i) => `line ${i}`);
    const right = left.map((l, i) => (i % 2 === 0 ? `${l} edited` : l));
    return compareExtractedPdfText(doc("a.pdf", [left]), doc("b.pdf", [right]));
  }

  it("health: the fixture is one hunk, far longer than the budget", () => {
    const result = oneLongHunk(2_000);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0]!.ops.length).toBeGreaterThan(3 * ROWS_SHOWN);
  });

  it(`one long hunk draws at most ${ROWS_SHOWN} rows, and Show more draws the next ones`, () => {
    const result = oneLongHunk(2_000);
    render(
      <CompareChanges result={result} options={{}} onOptions={() => {}} />,
    );
    const rows = () => document.querySelectorAll("tr").length;
    expect(rows()).toBe(ROWS_SHOWN);
    const total = result.hunks[0]!.ops.length;
    fireEvent.click(screen.getByRole("button", { name: /show more changes/i }));
    expect(rows()).toBe(Math.min(total, 2 * ROWS_SHOWN));
    expect(
      screen.getByRole("button", { name: /show more changes/i }).textContent,
    ).toContain(
      `${(total - 2 * ROWS_SHOWN).toLocaleString("en-US")} more lines`,
    );
  });

  it("Next change past the drawn rows draws the change it moves to", () => {
    // Many small hunks, far apart: more rows than the budget in all.
    const pages = Array.from({ length: 40 }, (_, p) => body(`p${p}`));
    const right = pages.map((page) =>
      page.map((line, i) => (i === 5 ? `${line} x` : line)),
    );
    const result = compareExtractedPdfText(
      doc("a.pdf", pages),
      doc("b.pdf", right),
    );
    const rowsIn = result.hunks.reduce((n, h) => n + h.ops.length, 0);
    // Health: the hunks do not all fit, at this budget.
    const budget = Math.floor(rowsIn / 2);
    render(
      <CompareChanges
        result={result}
        options={{}}
        onOptions={() => {}}
        rowsShown={budget}
      />,
    );
    const drawn = screen.getAllByRole("heading", { level: 3 }).length;
    expect(drawn).toBeLessThan(result.hunks.length);
    for (let i = 0; i < drawn; i += 1)
      fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    expect(status()).toMatch(new RegExp(`^Change ${drawn + 1} of`));
    expect(document.activeElement?.tagName).toBe("H3");
    expect(document.activeElement?.textContent).toBe(
      `Page ${drawn + 1} → page ${drawn + 1}`,
    );
  });
});

describe("the changes view keeps focus where the user put it", () => {
  /** A host that re-runs the comparison when an option changes, as the runner does. */
  function Host() {
    const left = [body("alpha"), body("bravo"), body("charlie")];
    const right = left.map((page, p) =>
      page.map((line, i) => (i === 5 ? `${line} AMENDED ${p + 1}` : line)),
    );
    const [options, setOptions] = useState<CompareOptions>({});
    const result = compareExtractedPdfText(
      doc("a.pdf", left),
      doc("b.pdf", right),
      options,
    );
    return (
      <CompareChanges
        result={result}
        options={options}
        onOptions={setOptions}
      />
    );
  }

  it("Next change pressed at the last change, then a box ticked: focus stays on the box", () => {
    render(<Host />);
    const next = screen.getByRole("button", { name: "Next change" });
    for (let i = 0; i < 3; i += 1) fireEvent.click(next);
    expect(status()).toMatch(/^Change 3 of 3/);
    const box = screen.getByRole("checkbox", { name: "Ignore case" });
    box.focus();
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(document.activeElement).toBe(box);
  });
});

describe("the word marks are spoken, not only seen", () => {
  it("each marked run is wrapped in words a screen reader says", () => {
    const left = [["Alpha clause 5 stands as agreed now"]];
    const right = [["Alpha clause 5 stands as amended now"]];
    const result = compareExtractedPdfText(
      doc("a.pdf", left),
      doc("b.pdf", right),
    );
    render(
      <CompareChanges result={result} options={{}} onOptions={() => {}} />,
    );
    const text = (kind: string) =>
      document
        .querySelector(`tr[data-kind="${kind}"] td:last-child`)!
        .textContent!.replace(/\s+/g, " ");
    expect(text("removed")).toBe(
      "Removed: Alpha clause 5 stands as [removed: agreed] now",
    );
    expect(text("added")).toBe(
      "Added: Alpha clause 5 stands as [added: amended] now",
    );
    // The words around a mark are for screen readers only.
    const around = [...document.querySelectorAll("td span")].filter((e) =>
      /^(?:\[(?:added|removed): |\])$/.test(e.textContent ?? ""),
    );
    expect(around).toHaveLength(4);
    expect(around.filter((e) => !e.classList.contains("sr-only"))).toEqual([]);
    // The marks themselves hold only the words, so the visible text is unchanged.
    expect(document.querySelector("ins")!.textContent).toBe("amended");
    expect(document.querySelector("del")!.textContent).toBe("agreed");
  });
});
