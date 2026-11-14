// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComparablePdfText } from "@/lib/pdf/compare-pdf";
import {
  COMPARE_RESULT_CHUNK,
  CompareChanges,
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
