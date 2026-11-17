// @vitest-environment jsdom
/**
 * Clickable citations (audit #30, chat-with-pdf#3, 2026-11-15). A marker
 * that cites pages of THIS file becomes a button, and nothing else does.
 * Since 2026-11-17 (competitor audit #4) the answer is drawn as formatted
 * Markdown: a plain answer still reads verbatim, and a formatted one keeps
 * its buttons wherever the markers sit (lists, bold, headings, tables).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { citedPagesIn } from "@/lib/jobs/chat-citations";
import { ChatAnswer, citationLabel } from "./chat-answer";

afterEach(cleanup);

const NL = String.fromCharCode(10);
const ANSWER =
  "Rent is due [p.2]; repairs [p.3, 5], see [p.9] and [Page 1] and [1].";

describe("ChatAnswer", () => {
  it("keeps the answer's text verbatim, buttons and all", () => {
    const { container } = render(
      <ChatAnswer answer={ANSWER} pageCount={5} onOpen={() => {}} />,
    );
    expect(container.textContent).toBe(ANSWER);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("only in-range markers become buttons, with their verbatim text", () => {
    render(<ChatAnswer answer={ANSWER} pageCount={5} onOpen={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["[p.2]", "[p.3, 5]"]);
    expect(buttons.every((b) => b.getAttribute("type") === "button")).toBe(
      true,
    );
  });

  it("names each button for what it shows", () => {
    render(<ChatAnswer answer={ANSWER} pageCount={5} onOpen={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Show page 2 of your PDF" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Show pages 3 and 5 of your PDF, starting at page 3",
      }),
    ).toBeTruthy();
    expect(citationLabel([1, 2, 3])).toBe(
      "Show pages 1, 2 and 3 of your PDF, starting at page 1",
    );
  });

  it("pressing a grouped marker opens its first page", () => {
    const onOpen = vi.fn();
    render(<ChatAnswer answer={ANSWER} pageCount={5} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /pages 3 and 5/ }));
    expect(onOpen).toHaveBeenCalledWith(3);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("with no page count, or nothing to open, the answer is inert text", () => {
    for (const props of [
      { pageCount: null, onOpen: () => {} },
      { pageCount: 5, onOpen: null },
    ]) {
      const { container, unmount } = render(
        <ChatAnswer answer={ANSWER} {...props} />,
      );
      expect(container.querySelectorAll("button")).toHaveLength(0);
      expect(container.textContent).toBe(ANSWER);
      unmount();
    }
  });

  it("positive control: the same answer on a 2-page file loses the [p.3, 5] button", () => {
    render(<ChatAnswer answer={ANSWER} pageCount={2} onOpen={() => {}} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "[p.2]",
    ]);
  });

  it("a Markdown answer is drawn formatted, with no marks and its buttons", () => {
    const answer = [
      "## Rent",
      "",
      "- Due on the **first [p.2]**",
      "- Late after `five days` [p.3]",
      "",
      "1. Pay by transfer [pp. 4-5]",
    ].join(NL);
    const { container } = render(
      <ChatAnswer answer={answer} pageCount={5} onOpen={() => {}} />,
    );
    expect(container.querySelector("h3")!.textContent).toBe("Rent");
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelector("strong")!.textContent).toBe("first [p.2]");
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("## ");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "[p.2]",
      "[p.3]",
      "[pp. 4-5]",
    ]);
  });

  it("the buttons open exactly the pages citedPagesIn counts, over a corpus of formatted answers", () => {
    const corpus = [
      ANSWER,
      `# Terms [p.1]${NL}${NL}Text [p.2, 4].`,
      `- a [p.1]${NL}  - b **[p.3]**${NL}${NL}> quoted [p.5]`,
      `| Item | Page |${NL}| - | - |${NL}| Rent | [p.2] |`,
      `\`code [p.4]\` and *em [p.1]*`,
      `\`\`\`${NL}block [p.3]${NL}\`\`\``,
    ];
    for (const answer of corpus) {
      const { unmount } = render(
        <ChatAnswer answer={answer} pageCount={5} onOpen={() => {}} />,
      );
      const opened = new Set<number>();
      for (const b of screen.queryAllByRole("button")) {
        const pages = b.getAttribute("aria-label")!.match(/\d+/g)!.map(Number);
        for (const p of pages) opened.add(p);
      }
      expect(
        [...opened].sort((a, b) => a - b),
        answer,
      ).toEqual(citedPagesIn(answer, 5));
      unmount();
    }
  });

  it("the one exception: a marker inside a link's text stays text", () => {
    const answer = "See [the clause [p.2]](https://example.com) and [p.3].";
    render(<ChatAnswer answer={answer} pageCount={5} onOpen={() => {}} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "[p.3]",
    ]);
    // Positive control: the grammar does count it, so this IS the exception.
    expect(citedPagesIn(answer, 5)).toEqual([2, 3]);
    expect(screen.getByRole("link").textContent).toBe("the clause [p.2]");
  });

  it("a hostile answer stays inert, its buttons intact", () => {
    const answer =
      "<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)> [p.2]";
    const { container } = render(
      <ChatAnswer answer={answer} pageCount={5} onOpen={() => {}} />,
    );
    expect(container.textContent).toBe(answer);
    expect(container.querySelectorAll("script, img, a")).toHaveLength(0);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "[p.2]",
    ]);
  });
});
