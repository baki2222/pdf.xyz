/**
 * The question asked before unsaved work is thrown away: asked only when
 * there is some, naming it, and answered by the visitor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmLeave,
  leaveQuestion,
  registerDirty,
  resetUnsavedForTests,
  unsavedLabels,
} from "./unsaved";

afterEach(() => resetUnsavedForTests());

describe("confirmLeave", () => {
  it("nothing unsaved: yes, and nobody is asked", () => {
    const ask = vi.fn(() => false);
    expect(confirmLeave(ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("something unsaved: the visitor is asked, by name, and their answer stands", () => {
    registerDirty("your signature in Sign PDF");
    const no = vi.fn(() => false);
    expect(confirmLeave(no)).toBe(false);
    expect(no).toHaveBeenCalledWith(
      "You have unsaved changes: your signature in Sign PDF. Discard them?",
    );
    expect(confirmLeave(() => true)).toBe(true);
  });

  it("released work is no longer asked about; each registration releases only itself", () => {
    const a = registerDirty("A");
    const b = registerDirty("B");
    expect(unsavedLabels()).toEqual(["A", "B"]);
    a();
    a();
    expect(unsavedLabels()).toEqual(["B"]);
    b();
    const ask = vi.fn(() => false);
    expect(confirmLeave(ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("one gesture is asked once: a yes stands for the rest of its task", async () => {
    registerDirty("your edits in Edit PDF");
    const ask = vi.fn(() => true);
    // The page's link guard asks, then the launch the same click starts.
    expect(confirmLeave(ask)).toBe(true);
    expect(confirmLeave(ask)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    // The next gesture is asked again.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmLeave(ask)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
    // A "no" is never remembered: the next ask is a real question.
    const no = vi.fn(() => false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmLeave(no)).toBe(false);
    expect(confirmLeave(no)).toBe(false);
    expect(no).toHaveBeenCalledTimes(2);
  });

  it("names every piece of unsaved work", () => {
    expect(leaveQuestion([])).toBeNull();
    expect(leaveQuestion(["A", "B", "C"])).toBe(
      "You have unsaved changes: A, B and C. Discard them?",
    );
  });
});
