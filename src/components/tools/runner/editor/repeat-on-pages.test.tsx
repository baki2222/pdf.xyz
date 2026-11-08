// @vitest-environment jsdom
/**
 * Audit sign-pdf#6 (2026-11-06): the "Repeat on" control a selected
 * signature, initials, name or date shows in the editor's properties.
 * Which pages it hands on is `repeatPages`' (its own tests); this holds the
 * control: named, keyboard-usable, 44px tall, and honest about a bad range.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { REPEAT_TARGET_LABEL } from "@/lib/pdf/editor/repeat-on-pages";
import { RepeatOnPages } from "./repeat-on-pages";

afterEach(cleanup);

function setup(pageCount = 5, from = 0) {
  const onRepeat = vi.fn();
  render(
    <RepeatOnPages pageCount={pageCount} from={from} onRepeat={onRepeat} />,
  );
  return onRepeat;
}

describe("RepeatOnPages", () => {
  it("offers every target by its label and repeats on all other pages", () => {
    const onRepeat = setup(5, 1);
    const select = screen.getByLabelText("Repeat on") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(
      Object.values(REPEAT_TARGET_LABEL),
    );
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    expect(onRepeat).toHaveBeenCalledWith([0, 2, 3, 4]);
  });

  it("custom pages take the range syntax and say what is wrong with one", () => {
    const onRepeat = setup(5, 0);
    fireEvent.change(screen.getByLabelText("Repeat on"), {
      target: { value: "custom" },
    });
    const pages = screen.getByLabelText("Pages");
    fireEvent.change(pages, { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    expect(onRepeat).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/5 pages/);
    fireEvent.change(pages, { target: { value: "2-3, 5" } });
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    expect(onRepeat).toHaveBeenCalledWith([1, 2, 4]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so instead of doing nothing when there is no other page", () => {
    const onRepeat = setup(5, 4);
    fireEvent.change(screen.getByLabelText("Repeat on"), {
      target: { value: "last" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    expect(onRepeat).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/already/i);
  });

  it("is absent from a one-page PDF", () => {
    setup(1, 0);
    expect(screen.queryByLabelText("Repeat on")).toBeNull();
  });

  it("its controls are at least 44px tall", () => {
    setup(5, 0);
    fireEvent.change(screen.getByLabelText("Repeat on"), {
      target: { value: "custom" },
    });
    for (const el of [
      screen.getByLabelText("Repeat on"),
      screen.getByLabelText("Pages"),
      screen.getByRole("button", { name: "Repeat" }),
    ])
      expect(el.className).toMatch(/\bh-11\b/);
  });
});
