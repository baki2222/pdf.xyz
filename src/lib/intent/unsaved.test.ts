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

  it("names every piece of unsaved work", () => {
    expect(leaveQuestion([])).toBeNull();
    expect(leaveQuestion(["A", "B", "C"])).toBe(
      "You have unsaved changes: A, B and C. Discard them?",
    );
  });
});
