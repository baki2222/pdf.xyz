// @vitest-environment jsdom
/**
 * Clickable citations (audit #30, chat-with-pdf#3, 2026-11-15). The answer a
 * reader sees and copies is the model's text, verbatim; a marker that cites
 * pages of THIS file becomes a button, and nothing else does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatAnswer, citationLabel } from "./chat-answer";

afterEach(cleanup);

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
});
